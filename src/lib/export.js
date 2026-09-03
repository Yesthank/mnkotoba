// 내보내기. Anki는 .apkg 대신 TSV를 씁니다.
// .apkg를 브라우저에서 만들려면 sqlite를 통째로 싣어야 하는데,
// Anki가 2.1.55부터 파일 상단의 #directive 를 읽기 때문에 TSV만으로 덱/노트타입/태그가 다 지정됩니다.

const esc = (s = '') => String(s).replace(/\t/g, ' ').replace(/\r?\n/g, '<br>').trim();

/** 한자에 후리가나를 붙인 HTML. Anki 카드 앞면에서 그대로 렌더됩니다. */
export function ruby(surface = '', reading = '') {
  if (!reading || surface === reading || !/[\u4e00-\u9faf]/.test(surface)) return surface;
  return `<ruby>${surface}<rt>${reading}</rt></ruby>`;
}

/**
 * Anki 가져오기용 TSV.
 * Anki에서 파일 > 가져오기로 열면 필드 매핑이 자동으로 잡힙니다.
 */
export function toAnkiTsv(cards, { deckName = '일본어', withRuby = true } = {}) {
  const head = [
    '#separator:tab',
    '#html:true',
    '#notetype:Basic',
    `#deck:${deckName}`,
    '#tags column:3',
  ].join('\n');

  const rows = cards.map((c) => {
    const front = withRuby ? ruby(c.surface, c.reading) : c.surface;
    const back = [
      c.reading && c.reading !== c.surface ? `【${c.reading}】` : '',
      esc(c.meaning),
      c.note ? `<br><i>${esc(c.note)}</i>` : '',
      c.context ? `<br><br>${esc(c.context)}` : '',
      c.contextTranslation ? `<br>${esc(c.contextTranslation)}` : '',
    ].filter(Boolean).join(' ');

    const tags = [c.type === 'grammar' ? '문법' : '단어', c.pos, c.jlpt]
      .filter((t) => t && t !== 'unknown' && t !== 'other')
      .join(' ');

    return [esc(front), back, tags].join('\t');
  });

  return `${head}\n${rows.join('\n')}\n`;
}

/** 사람이 읽는 용도. 메모장이나 옵시디언에 그대로 붙이기 좋게. */
export function toPlainText(cards, deckName = '단어장') {
  const lines = [`# ${deckName}`, `# ${cards.length}개 · ${new Date().toLocaleDateString('ko-KR')}`, ''];
  for (const c of cards) {
    const head = c.reading && c.reading !== c.surface ? `${c.surface} (${c.reading})` : c.surface;
    lines.push(`${head} — ${c.meaning}`);
    if (c.note) lines.push(`  · ${c.note}`);
    if (c.context) lines.push(`  예) ${c.context}`);
    if (c.contextTranslation) lines.push(`      ${c.contextTranslation}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** 전체 백업 겸 재가져오기용. 복습 진도까지 보존됩니다. */
export function toJsonBackup(decks, cards) {
  return JSON.stringify(
    { app: 'kotoba-note', version: 1, exportedAt: new Date().toISOString(), decks, cards },
    null,
    2,
  );
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  // Anki와 엑셀이 한글/일본어를 깨뜨리지 않도록 BOM을 붙입니다.
  const blob = new Blob(['\uFEFF', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const safeName = (s) => (s || 'deck').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
