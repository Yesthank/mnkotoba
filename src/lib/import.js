// 파일 가져오기. 네 가지를 읽습니다.
//
//   1. scripts/apkg2txt.py 가 만든 txt          → #columns 지시어로 열 이름이 적혀 있음
//   2. 이 앱이 내보낸 Anki txt                   → 앞면(루비) / 뒷면 / 태그
//   3. Anki에서 직접 내보낸 Basic 노트 txt        → 앞면 / 뒷면 (/ 태그)
//   4. 이 앱의 JSON 백업                          → 단어장과 진도까지 통째로 복원
//
// 결과는 store.addCard 가 받는 카드 모양으로 맞춰 돌려줍니다.

import { freshSrs, dayStart } from './srs';

const POS = new Set([
  'noun', 'verb', 'adj-i', 'adj-na', 'adverb', 'particle', 'auxiliary',
  'conjunction', 'pronoun', 'counter', 'interjection', 'expression', 'other',
]);

// 열 이름 별칭. apkg2txt 가 쓰는 이름이 기준이고, 손으로 만든 파일도 웬만하면 맞도록 넉넉히 둡니다.
const COLUMN_ALIASES = {
  surface: ['surface', 'word', 'expression', 'front', 'vocabulary', 'kanji', 'japanese', '단어', '표현', '表現', '単語'],
  reading: ['reading', 'kana', 'furigana', 'hiragana', 'yomi', '읽기', '읽는법', '読み', 'よみ'],
  meaning: ['meaning', 'definition', 'back', 'translation', 'english', 'korean', 'gloss', '뜻', '의미', '意味'],
  note: ['note', 'notes', 'memo', 'grammar', 'explanation', '메모', '설명', '備考'],
  context: ['context', 'sentence', 'example', '예문', '例文'],
  contextTranslation: ['contexttranslation', 'context_translation', 'sentencetranslation', 'sentence_translation', 'sentence-meaning', 'example_translation', '예문번역', '예문뜻', '例文訳'],
  tags: ['tags', 'tag', '태그'],
  type: ['type', '종류'],
  pos: ['pos', '품사'],
  jlpt: ['jlpt'],
  interval: ['interval', 'ivl', '간격'],
  ease: ['ease', 'factor'],
  reps: ['reps'],
  lapses: ['lapses'],
  due: ['due', '만기'],
};

const SEPARATORS = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };

/**
 * @returns {{ kind: 'cards', deckName: string, cards: object[], warnings: string[] }
 *         | { kind: 'backup', decks: object[], cards: object[], warnings: string[] }}
 */
export function parseImport(text, filename = '') {
  const src = String(text || '').replace(/^﻿/, '');
  const warnings = [];

  if (/^\s*\{/.test(src)) return parseBackup(src, warnings);

  const lines = src.split(/\r?\n/);
  const opts = { separator: '\t', deck: '', columns: null, tagsColumn: 0, html: true };

  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!line.startsWith('#')) break;
    const m = line.match(/^#([\w ]+?):(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    if (key === 'separator') opts.separator = SEPARATORS[val.toLowerCase()] || val;
    else if (key === 'deck') opts.deck = val;
    else if (key === 'columns') opts.columns = val.split(opts.separator === '\t' ? /\t| {2,}|,/ : opts.separator).map((c) => c.trim()).filter(Boolean);
    else if (key === 'tags column') opts.tagsColumn = Number(val) || 0;
    else if (key === 'html') opts.html = val.toLowerCase() !== 'false';
  }

  const rows = lines.slice(i).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split(opts.separator));
  if (rows.length === 0) return { kind: 'cards', deckName: opts.deck, cards: [], warnings: ['읽을 줄이 없습니다.'] };

  // 열 이름이 없으면 첫 줄이 헤더인지 봅니다. 알려진 이름이 둘 이상 보이면 헤더로 칩니다.
  let columns = opts.columns;
  if (!columns) {
    const guess = rows[0].map(canonicalColumn);
    if (guess.filter(Boolean).length >= 2 && guess.includes('surface')) {
      columns = rows[0];
      rows.shift();
    }
  }

  const cards = columns
    ? rows.map((r) => fromNamedRow(r, columns.map(canonicalColumn), opts))
    : rows.map((r) => fromAnkiRow(r, opts));

  const kept = cards.filter((c) => c && c.surface);
  if (kept.length < cards.length) warnings.push(`${cards.length - kept.length}줄은 앞면이 비어 있어 건너뜁니다.`);

  const deckName = opts.deck.split('::').pop().trim() || filename.replace(/\.[^.]+$/, '') || '가져온 단어장';
  return { kind: 'cards', deckName, cards: kept, warnings };
}

function parseBackup(src, warnings) {
  let data;
  try { data = JSON.parse(src); } catch { throw new Error('JSON을 읽지 못했습니다.'); }
  if (data.app !== 'kotoba-note' || !Array.isArray(data.cards)) {
    throw new Error('코토바 노트 백업 파일이 아닙니다.');
  }
  return {
    kind: 'backup',
    decks: (data.decks || []).map((d) => ({ id: d.id, name: d.name || '단어장', order: d.order ?? 0 })),
    cards: data.cards.map((c) => ({ ...normalizeCard(c), id: c.id, deckId: c.deckId, srs: c.srs })),
    warnings,
  };
}

// ── 열 이름이 있는 줄 ───────────────────────────────────

function fromNamedRow(cells, keys, opts) {
  const raw = {};
  keys.forEach((k, idx) => { if (k && cells[idx] != null) raw[k] = cells[idx].trim(); });

  const front = opts.html ? parseFront(raw.surface || '') : { surface: raw.surface || '', reading: '' };
  const card = {
    surface: front.surface,
    reading: raw.reading ? plain(raw.reading, opts.html) : front.reading,
    meaning: plain(raw.meaning || '', opts.html),
    note: plain(raw.note || '', opts.html),
    context: plain(raw.context || '', opts.html),
    contextTranslation: plain(raw.contextTranslation || '', opts.html),
    type: raw.type === 'grammar' || raw.type === '문법' ? 'grammar' : 'word',
    pos: POS.has(raw.pos) ? raw.pos : 'other',
    jlpt: /^N[1-5]$/i.test(raw.jlpt || '') ? raw.jlpt.toUpperCase() : 'unknown',
  };
  applyTags(card, raw.tags);

  const srs = srsFromRow(raw);
  return normalizeCard(srs ? { ...card, srs } : card);
}

// Anki 진도(간격·ease·횟수·틀림·만기)가 있으면 복습 카드로, 없으면 새 카드로.
function srsFromRow(raw) {
  const interval = Number(raw.interval);
  if (!raw.interval || !Number.isFinite(interval) || interval <= 0) return null;
  const s = { ...freshSrs(), state: 'review', interval: Math.round(interval) };
  const ease = Number(raw.ease);
  if (Number.isFinite(ease) && ease > 0) s.ease = ease > 10 ? ease / 1000 : ease; // Anki 는 2500 처럼 저장합니다
  s.ease = Math.max(1.3, s.ease);
  s.reps = Math.max(0, Number(raw.reps) || 0);
  s.lapses = Math.max(0, Number(raw.lapses) || 0);
  const dueDate = raw.due ? Date.parse(raw.due) : NaN;
  s.due = Number.isFinite(dueDate) ? dayStart(dueDate + 12 * 3600000) : Date.now();
  return s;
}

// ── 앞면 / 뒷면 / 태그 ──────────────────────────────────

function fromAnkiRow(cells, opts) {
  const [frontRaw = '', backRaw = ''] = cells;
  const tagIdx = (opts.tagsColumn || 3) - 1;
  const tags = cells.length > 2 ? cells[tagIdx] : '';

  const front = parseFront(frontRaw);
  const back = parseBack(backRaw, opts.html);

  const card = {
    surface: front.surface,
    reading: back.reading || front.reading,
    meaning: back.meaning,
    note: back.note,
    context: back.context,
    contextTranslation: back.contextTranslation,
    type: 'word',
    pos: 'other',
    jlpt: 'unknown',
  };
  applyTags(card, tags);
  return normalizeCard(card);
}

/** <ruby>漢字<rt>かんじ</rt></ruby> 나 漢字[かんじ] 꼴에서 표기와 읽기를 뽑습니다. */
export function parseFront(raw) {
  let s = String(raw);
  let reading = '';

  if (/<ruby>/i.test(s)) {
    let full = '';
    const surface = s.replace(/<ruby>([\s\S]*?)<rt>([\s\S]*?)<\/rt>\s*<\/ruby>/gi, (_, base, rt) => {
      full += stripTags(rt);
      return stripTags(base);
    });
    const plainSurface = stripTags(surface).trim();
    reading = readingFromMixed(plainSurface, s, full);
    return { surface: plainSurface, reading };
  }

  // Anki 일본어 지원 애드온 표기: 食[た]べる, 日本語[にほんご]
  if (/\[[぀-ヿ]+\]/.test(s)) {
    let kana = '';
    const surface = s.replace(/ ?([^\s\[\]]+?)\[([぀-ヿ]+)\]/g, (_, base, rt) => { kana += rt; return base; });
    // 괄호 밖의 가나는 읽기에도 그대로 들어가야 합니다: 食[た]べる → たべる
    reading = s.replace(/ ?([^\s\[\]]+?)\[([぀-ヿ]+)\]/g, (_, base, rt) => rt).replace(/\s+/g, '');
    return { surface: stripTags(surface).replace(/\s+/g, ''), reading: reading || kana };
  }

  return { surface: stripTags(s).trim(), reading: '' };
}

// 루비가 한자에만 달린 경우, 루비 밖의 가나까지 이어 붙여 전체 읽기를 만듭니다.
// 루비 밖에 한자가 남아 있으면 읽기를 완성할 수 없으니 비워 둡니다. 틀린 읽기보다 빈 읽기가 낫습니다.
function readingFromMixed(surface, marked, rubyOnly) {
  const parts = [];
  const re = /<ruby>([\s\S]*?)<rt>([\s\S]*?)<\/rt>\s*<\/ruby>|([^<]+)/gi;
  let m;
  while ((m = re.exec(marked))) {
    if (m[2] != null) parts.push(stripTags(m[2]));
    else if (m[3]) {
      const t = stripTags(m[3]);
      if (/[一-鿿]/.test(t)) return '';
      parts.push(t);
    }
  }
  const joined = parts.join('').trim();
  return joined && joined !== surface ? joined : rubyOnly;
}

/** 이 앱이 내보낸 뒷면: 【읽기】 뜻 <br><i>메모</i> <br><br>예문 <br>번역 */
function parseBack(raw, html = true) {
  let s = String(raw);
  const out = { reading: '', meaning: '', note: '', context: '', contextTranslation: '' };

  const rt = s.match(/^\s*【([^】]*)】\s*/);
  if (rt) { out.reading = rt[1].trim(); s = s.slice(rt[0].length); }

  const note = s.match(/<i>([\s\S]*?)<\/i>/i);
  if (note) { out.note = plain(note[1], html); s = s.replace(note[0], ''); }

  const blocks = s.split(/(?:<br\s*\/?>\s*){2,}|\n{2,}/i).map((b) => plain(b, html)).filter(Boolean);
  out.meaning = blocks.shift() || '';
  if (blocks.length) {
    const ctx = blocks.join('\n').split('\n').map((l) => l.trim()).filter(Boolean);
    out.context = ctx.shift() || '';
    out.contextTranslation = ctx.join(' ');
  }
  return out;
}

// ── 공통 ────────────────────────────────────────────────

// Anki 계층 태그(JLPT::N5::Day01)는 조각마다 살펴서 레벨·품사를 건지고, 태그 자체는 그대로 둡니다.
function applyTags(card, tags) {
  const rest = [];
  for (const t of String(tags || '').split(/[\s,]+/).filter(Boolean)) {
    if (t === '문법' || t.toLowerCase() === 'grammar') { card.type = 'grammar'; continue; }
    if (t === '단어') continue;
    if (POS.has(t)) { card.pos = t; continue; }
    if (/^N[1-5]$/i.test(t)) { card.jlpt = t.toUpperCase(); continue; }
    for (const part of t.split('::')) {
      if (/^N[1-5]$/i.test(part) && card.jlpt === 'unknown') card.jlpt = part.toUpperCase();
      else if (POS.has(part) && card.pos === 'other') card.pos = part;
      else if (part === '문법') card.type = 'grammar';
    }
    rest.push(t);
  }
  if (rest.length) card.tags = rest;
  if (card.type === 'grammar' && card.pos === 'other') card.pos = 'expression';
}

function normalizeCard(c) {
  const surface = (c.surface || '').trim();
  return {
    type: c.type === 'grammar' ? 'grammar' : 'word',
    surface,
    reading: (c.reading || '').trim(),
    lemma: (c.lemma || surface).trim(),
    meaning: (c.meaning || '').trim(),
    pos: POS.has(c.pos) ? c.pos : 'other',
    note: (c.note || '').trim(),
    jlpt: /^N[1-5]$/.test(c.jlpt || '') ? c.jlpt : 'unknown',
    context: (c.context || '').trim(),
    contextTranslation: (c.contextTranslation || '').trim(),
    starred: Boolean(c.starred),
    ...(c.tags?.length ? { tags: c.tags } : {}),
    ...(c.srs ? { srs: c.srs } : {}),
  };
}

function canonicalColumn(name) {
  const n = String(name || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => a.replace(/[\s_-]+/g, '') === n)) return key;
  }
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function stripTags(s) {
  return String(s)
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' ? e.slice(2) : e.slice(1), e[1] === 'x' ? 16 : 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

function plain(s, html = true) {
  const t = html ? stripTags(s) : String(s);
  return t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim();
}
