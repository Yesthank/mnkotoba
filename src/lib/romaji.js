// 로마자를 가나로. 필기 인식기가 한자만 알기 때문에 가나는 이쪽으로 넣습니다.
//
// 일본어 자판을 깔지 않은 기기에서 「さいこう」를 넣으려면 이 길밖에 없습니다.
// 흔히 쓰는 IME 규칙을 따릅니다.
//   ki      → き          촉음: kka  → っか (같은 자음이 겹치면)
//   shi/si  → し          발음: kanji → かんじ (n 뒤에 자음이 오면 ん)
//   kyo     → きょ         onna  → おんな
//   -       → ー          아직 글자가 안 된 꼬리(ky, 끝의 n)는 그대로 두어 다음 입력을 기다립니다

const BASE = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wo: 'を', "n'": 'ん',
  vu: 'ゔ',

  // 요음
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', kye: 'きぇ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ', she: 'しぇ',
  sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ', je: 'じぇ',
  jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', che: 'ちぇ',
  cya: 'ちゃ', cyu: 'ちゅ', cyo: 'ちょ',
  tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
  pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
  rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  dya: 'ぢゃ', dyu: 'ぢゅ', dyo: 'ぢょ',

  // 외래어 표기
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', fyu: 'ふゅ',
  va: 'ゔぁ', vi: 'ゔぃ', ve: 'ゔぇ', vo: 'ゔぉ',
  tsa: 'つぁ', tsi: 'つぃ', tse: 'つぇ', tso: 'つぉ',
  thi: 'てぃ', dhi: 'でぃ', twu: 'とぅ', dwu: 'どぅ',
  wi: 'うぃ', we: 'うぇ',

  // 작은 가나
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ',
  lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ',
  xtsu: 'っ', xtu: 'っ', ltsu: 'っ', ltu: 'っ',
  xwa: 'ゎ', lwa: 'ゎ', xka: 'ゕ', xke: 'ゖ',

  // 기호
  '-': 'ー', '.': '。', ',': '、', '?': '？', '!': '！',
  '[': '「', ']': '」', '/': '・', '~': '〜',
};

const MAX_KEY = Math.max(...Object.keys(BASE).map((k) => k.length));
const VOWELS = 'aiueo';

// 아직 글자가 안 됐지만 더 치면 될 수 있는 꼬리인지. ky, sh, n 같은 것들.
const PREFIXES = new Set();
for (const key of Object.keys(BASE)) {
  for (let i = 1; i < key.length; i++) PREFIXES.add(key.slice(0, i));
}

/** 히라가나를 가타카나로. ー 같은 기호는 그대로 둡니다. */
export const toKatakana = (s) =>
  String(s ?? '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** 가타카나를 히라가나로. */
export const toHiragana = (s) =>
  String(s ?? '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * 로마자를 가나로 바꿉니다.
 * @param {string} input
 * @param {{katakana?: boolean, flush?: boolean}} opts
 *   katakana 켜면 가타카나로. flush 켜면 끝에 남은 n 을 ん 으로 확정합니다.
 * @returns {string} 바뀐 가나 + 아직 글자가 안 된 꼬리
 */
export function toKana(input, { katakana = false, flush = false } = {}) {
  const src = String(input ?? '').toLowerCase();
  let out = '';
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    // 촉음. 같은 자음이 겹치면 앞의 하나가 っ 가 됩니다. tt, kk, pp …
    if (c === src[i + 1] && c >= 'a' && c <= 'z' && !VOWELS.includes(c) && c !== 'n') {
      out += 'っ';
      i += 1;
      continue;
    }

    // 발음. n 뒤에 모음도 y 도 아닌 글자가 오면 ん 으로 굳고, n 하나만 먹습니다.
    // 이래야 onna 가 おんな 로, kinnyou 가 きんにょう 로 갑니다. n' 은 아래 표에서 잡습니다.
    if (c === 'n') {
      const next = src[i + 1];
      if (next && next !== "'" && !VOWELS.includes(next) && next !== 'y') {
        out += 'ん';
        i += 1;
        continue;
      }
    }

    let matched = false;
    for (let len = Math.min(MAX_KEY, src.length - i); len >= 1; len -= 1) {
      const kana = BASE[src.slice(i, i + len)];
      if (kana) {
        out += kana;
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 더 치면 글자가 될 꼬리는 로마자 그대로 남겨 둡니다.
    if (PREFIXES.has(src.slice(i))) break;

    out += src[i];
    i += 1;
  }

  let tail = src.slice(i);
  if (flush && tail === 'n') {
    out += 'ん';
    tail = '';
  }

  return (katakana ? toKatakana(out) : out) + tail;
}

/** 아직 가나가 되지 못한 꼬리가 남아 있는지. 입력창에 표시를 띄울 때 씁니다. */
export const hasPending = (s) => /[a-z]$/i.test(String(s ?? ''));
