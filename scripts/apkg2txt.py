#!/usr/bin/env python3
"""Anki .apkg → 코토바 노트가 읽는 txt.

    python3 scripts/apkg2txt.py 덱.apkg                 # 덱.txt 가 생깁니다
    python3 scripts/apkg2txt.py 덱.apkg -o out.txt --deck "N5 단어"
    python3 scripts/apkg2txt.py 덱.apkg --list          # 노트 유형과 필드 이름만 보여줍니다
    python3 scripts/apkg2txt.py 덱.apkg --map surface=Expression,reading=Reading,meaning=Meaning
    python3 scripts/apkg2txt.py 덱.apkg --no-progress   # Anki 진도(간격·ease·만기)를 버리고 전부 새 카드로

표준 라이브러리만 씁니다. Anki 2.1.50 이후의 새 형식(collection.anki21b)은 zstd 로 압축돼 있어서
`pip install zstandard` 가 필요하고, 없으면 Anki 에서 내보낼 때 "이전 버전 지원" 을 켜서 다시 뽑으면 됩니다.

출력 형식은 앱의 가져오기가 그대로 읽는 TSV 입니다.

    #separator:tab
    #deck:N5 단어
    #columns:surface	reading	meaning	note	context	contextTranslation	tags	interval	ease	reps	lapses	due
    食べる	たべる	먹다		ご飯を食べる	밥을 먹다	verb N5	12	2.5	4	0	2026-09-20
"""

import argparse
import datetime as dt
import html
import json
import os
import re
import sqlite3
import sys
import tempfile
import zipfile

FIELD_SEP = "\x1f"
OUT_COLUMNS = [
    "surface", "reading", "meaning", "note", "context", "contextTranslation", "tags",
    "interval", "ease", "reps", "lapses", "due",
]

# 필드 이름으로 역할을 짐작합니다. 앞에 있을수록 우선입니다.
GUESS = {
    "surface": ["expression", "word", "vocabulary", "vocab", "kanji", "japanese", "front", "表現", "単語", "語彙", "단어", "표현"],
    "reading": ["reading", "kana", "furigana", "hiragana", "yomi", "pronunciation", "読み", "よみ", "読み方", "읽기"],
    "meaning": ["meaning", "definition", "english", "korean", "translation", "gloss", "back", "意味", "뜻", "의미"],
    "context": ["sentence", "example", "context", "例文", "예문", "sentence-japanese", "example sentence"],
    "contextTranslation": ["sentence-meaning", "sentence-english", "sentence translation", "example translation", "sentence-korean", "例文訳", "예문번역", "예문뜻"],
    "note": ["notes", "note", "grammar", "explanation", "memo", "備考", "메모", "설명"],
}

KANA = "぀-ヿ"


def die(msg):
    print(f"오류: {msg}", file=sys.stderr)
    sys.exit(1)


# ── apkg 열기 ───────────────────────────────────────────

def open_collection(path, tmpdir):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        for name in ("collection.anki21b", "collection.anki21", "collection.anki2"):
            if name not in names:
                continue
            data = z.read(name)
            if name.endswith("b"):
                try:
                    import zstandard  # type: ignore
                except ImportError:
                    die("이 apkg 는 새 형식(zstd)입니다. `pip install zstandard` 하거나, Anki 에서 '이전 버전 지원'을 켜서 다시 내보내세요.")
                data = zstandard.ZstdDecompressor().decompress(data, max_output_size=1 << 31)
            out = os.path.join(tmpdir, "collection.sqlite")
            with open(out, "wb") as f:
                f.write(data)
            return sqlite3.connect(out)
    die("apkg 안에 collection 파일이 없습니다.")


def load_meta(con):
    """노트 유형(필드 목록)과 덱 이름. 옛 스키마는 col 테이블의 JSON, 새 스키마는 별도 테이블."""
    crt, models_json, decks_json = con.execute("select crt, models, decks from col").fetchone()
    notetypes, decks = {}, {}

    if models_json and models_json.strip() not in ("", "{}"):
        for mid, m in json.loads(models_json).items():
            notetypes[int(mid)] = {"name": m["name"], "fields": [f["name"] for f in sorted(m["flds"], key=lambda f: f["ord"])]}
    else:
        for ntid, name in con.execute("select id, name from notetypes"):
            fields = [r[0] for r in con.execute("select name from fields where ntid=? order by ord", (ntid,))]
            notetypes[ntid] = {"name": name, "fields": fields}

    if decks_json and decks_json.strip() not in ("", "{}"):
        for did, d in json.loads(decks_json).items():
            decks[int(did)] = d["name"]
    else:
        for did, name in con.execute("select id, name from decks"):
            decks[did] = name.replace("\x1f", "::")

    return crt, notetypes, decks


# ── 텍스트 정리 ─────────────────────────────────────────

def strip_html(s):
    s = re.sub(r"\[sound:[^\]]*\]", "", s)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</?(div|p|li)\b[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return "\n".join(l.strip() for l in s.split("\n") if l.strip()).strip()


def split_ruby(raw):
    """<ruby>漢字<rt>かんじ</rt></ruby> 또는 漢字[かんじ] 에서 (표기, 읽기)를 뽑습니다."""
    s = raw
    if re.search(r"<ruby>", s, re.I):
        parts = []
        surface = ""
        complete = True  # 루비 밖에 한자가 남으면 읽기를 완성할 수 없습니다
        for m in re.finditer(r"<ruby>(.*?)<rt>(.*?)</rt>\s*</ruby>|([^<]+)|<[^>]+>", s, re.I | re.S):
            if m.group(2) is not None:
                surface += strip_html(m.group(1))
                parts.append(strip_html(m.group(2)))
            elif m.group(3):
                t = strip_html(m.group(3))
                surface += t
                if re.search(r"[一-鿿]", t):
                    complete = False
                parts.append(t)
        reading = "".join(parts).replace(" ", "").strip() if complete else ""
        return surface.strip(), reading

    if re.search(rf"\[[{KANA}]+\]", s):
        surface = re.sub(rf" ?([^\s\[\]]+?)\[([{KANA}]+)\]", r"\1", s)
        reading = re.sub(rf" ?([^\s\[\]]+?)\[([{KANA}]+)\]", r"\2", s)
        return strip_html(surface).replace(" ", ""), strip_html(reading).replace(" ", "")

    return strip_html(s), ""


def cell(s):
    return (s or "").replace("\t", " ").replace("\r", "").replace("\n", "<br>").strip()


# ── 필드 매핑 ───────────────────────────────────────────

def guess_mapping(fields):
    lower = [f.lower() for f in fields]
    mapping = {}
    used = set()
    for role, names in GUESS.items():
        for cand in names:
            for i, f in enumerate(lower):
                if i in used:
                    continue
                if f == cand or f.replace(" ", "").replace("_", "").replace("-", "") == cand.replace(" ", "").replace("-", ""):
                    mapping[role] = i
                    used.add(i)
                    break
            if role in mapping:
                break
    # 이름으로 못 맞춘 경우: 첫 필드 = 표기, 다음 = 뜻
    if "surface" not in mapping:
        for i in range(len(fields)):
            if i not in used:
                mapping["surface"] = i
                used.add(i)
                break
    if "meaning" not in mapping:
        for i in range(len(fields)):
            if i not in used:
                mapping["meaning"] = i
                used.add(i)
                break
    return mapping


def parse_map_arg(arg, fields):
    mapping = {}
    for pair in arg.split(","):
        if not pair.strip():
            continue
        role, _, name = pair.partition("=")
        role, name = role.strip(), name.strip()
        if role not in OUT_COLUMNS[:6] and role != "tags":
            die(f"--map 의 역할 이름이 이상합니다: {role} (surface/reading/meaning/note/context/contextTranslation 중 하나)")
        if name.isdigit():
            mapping[role] = int(name)
        elif name in fields:
            mapping[role] = fields.index(name)
        # 없는 필드는 그 노트 유형엔 해당 없음으로 봅니다(덱에 노트 유형이 여럿일 때).
    # --map 이 이 노트 유형에 하나도 안 맞으면 이름으로 짐작합니다.
    return mapping if "surface" in mapping else None


# ── 진도 ────────────────────────────────────────────────

def progress_of(card, crt):
    """cards 행 → (interval, ease, reps, lapses, due 'YYYY-MM-DD'). 새 카드는 전부 빈 값."""
    ctype, queue, due, ivl, factor, reps, lapses, odue = card
    if ctype == 0 or queue < 0 and ivl == 0:
        return ("", "", "", "", "")
    ease = f"{factor / 1000:.2f}" if factor else ""
    if ctype == 2 or ivl > 0:
        d = odue if odue else due
        due_date = dt.date.fromtimestamp(crt) + dt.timedelta(days=int(d)) if d < 100000 else dt.date.fromtimestamp(d)
        return (str(max(1, ivl)), ease, str(reps), str(lapses), due_date.isoformat())
    # 학습 단계 중이던 카드는 오늘 다시 보게 새 카드로 돌립니다
    return ("", "", "", "", "")


# ── 본체 ────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("apkg")
    ap.add_argument("-o", "--out", help="출력 파일 (기본: 입력 이름.txt)")
    ap.add_argument("--deck", help="단어장 이름 (기본: apkg 안의 덱 이름)")
    ap.add_argument("--map", help="필드 매핑. 예: surface=Expression,reading=Reading,meaning=Meaning")
    ap.add_argument("--list", action="store_true", help="노트 유형과 필드만 보여주고 끝냅니다")
    ap.add_argument("--no-progress", action="store_true", help="Anki 진도를 버리고 전부 새 카드로")
    args = ap.parse_args()

    if not os.path.exists(args.apkg):
        die(f"파일이 없습니다: {args.apkg}")

    with tempfile.TemporaryDirectory() as tmp:
        con = open_collection(args.apkg, tmp)
        crt, notetypes, decks = load_meta(con)

        rows = con.execute(
            "select n.id, n.mid, n.flds, n.tags, c.did, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.odue "
            "from notes n left join cards c on c.nid = n.id and c.ord = 0 order by n.id"
        ).fetchall()

        if args.list or not rows:
            print(f"노트 {len(rows)}개")
            for mid, nt in notetypes.items():
                n = sum(1 for r in rows if r[1] == mid)
                print(f"- {nt['name']} ({n}개): {', '.join(nt['fields'])}")
                print(f"    짐작한 매핑: {guess_mapping(nt['fields'])}")
            print("덱:", ", ".join(decks.values()) or "(없음)")
            if args.list:
                return

        deck_counts = {}
        for r in rows:
            deck_counts[r[4]] = deck_counts.get(r[4], 0) + 1
        main_did = max(deck_counts, key=deck_counts.get) if deck_counts else None
        deck_name = args.deck or (decks.get(main_did, "").split("::")[-1] if main_did else "") or os.path.splitext(os.path.basename(args.apkg))[0]

        mappings = {}
        for mid, nt in notetypes.items():
            mappings[mid] = (parse_map_arg(args.map, nt["fields"]) if args.map else None) or guess_mapping(nt["fields"])

        out_lines = ["#separator:tab", "#html:true", f"#deck:{deck_name}", "#columns:" + "\t".join(OUT_COLUMNS)]
        skipped = 0
        for nid, mid, flds, tags, did, ctype, queue, due, ivl, factor, reps, lapses, odue in rows:
            fields = flds.split(FIELD_SEP)
            m = mappings.get(mid) or {}

            def get(role):
                i = m.get(role)
                return fields[i] if i is not None and i < len(fields) else ""

            surface, ruby_reading = split_ruby(get("surface"))
            if not surface:
                skipped += 1
                continue
            reading = strip_html(get("reading")).replace(" ", "") or ruby_reading
            context, ctx_reading = split_ruby(get("context"))
            values = {
                "surface": surface,
                "reading": reading,
                "meaning": strip_html(get("meaning")),
                "note": strip_html(get("note")),
                "context": context,
                "contextTranslation": strip_html(get("contextTranslation")),
                "tags": " ".join(t for t in (tags or "").split() if t),
            }
            prog = ("", "", "", "", "") if (args.no_progress or ctype is None) else progress_of((ctype, queue, due, ivl, factor, reps, lapses, odue), crt)
            values.update(zip(OUT_COLUMNS[7:], prog))
            out_lines.append("\t".join(cell(values[c]) for c in OUT_COLUMNS))

        out = args.out or os.path.splitext(args.apkg)[0] + ".txt"
        with open(out, "w", encoding="utf-8") as f:
            f.write("\n".join(out_lines) + "\n")

        kept = len(out_lines) - 4
        print(f"{out} ← 카드 {kept}개 (단어장 '{deck_name}'){f', 앞면이 비어 건너뜀 {skipped}개' if skipped else ''}")
        for mid, nt in notetypes.items():
            m = mappings[mid]
            shown = ", ".join(f"{role}←{nt['fields'][i]}" for role, i in m.items() if i < len(nt["fields"]))
            print(f"  {nt['name']}: {shown}")


if __name__ == "__main__":
    main()
