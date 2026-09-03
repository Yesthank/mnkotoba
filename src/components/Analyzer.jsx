import { useEffect, useRef, useState } from 'react';
import { analyze, fileToInline } from '../lib/api';
import { speak, canSpeak } from '../lib/speech';

const POS_VAR = {
  noun: 'var(--pos-noun)',
  pronoun: 'var(--pos-noun)',
  counter: 'var(--pos-noun)',
  verb: 'var(--pos-verb)',
  'adj-i': 'var(--pos-adj)',
  'adj-na': 'var(--pos-adj)',
  adverb: 'var(--pos-adverb)',
  particle: 'var(--pos-particle)',
  auxiliary: 'var(--pos-aux)',
  conjunction: 'var(--pos-aux)',
  expression: 'var(--pos-aux)',
};

const POS_KO = {
  noun: '명사', pronoun: '대명사', counter: '조수사', verb: '동사',
  'adj-i': 'い형용사', 'adj-na': 'な형용사', adverb: '부사', particle: '조사',
  auxiliary: '조동사', conjunction: '접속사', interjection: '감탄사',
  expression: '표현', other: '기타',
};

export default function Analyzer({ decks, activeDeckId, savedKeys, onSave, onToast }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [furigana, setFurigana] = useState(true);
  const [pick, setPick] = useState(null); // { item, type, rect }
  const areaRef = useRef(null);

  async function run() {
    if (!text.trim() && !image) return;
    setBusy(true);
    setError('');
    setPick(null);
    try {
      setResult(await analyze({ text, image: image?.inline }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  }

  // 스크린샷을 그대로 붙여넣을 수 있게. 만화 컷이나 메뉴판에 특히 잘 듣습니다.
  useEffect(() => {
    async function onPaste(e) {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      setImage({ url: URL.createObjectURL(file), name: file.name, inline: await fileToInline(file) });
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // 팝오버 바깥을 누르면 닫습니다.
  useEffect(() => {
    if (!pick) return;
    const close = (e) => { if (!e.target.closest('.pop, .tok')) setPick(null); };
    const esc = (e) => e.key === 'Escape' && setPick(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [pick]);

  function openPick(e, item, type) {
    const r = e.currentTarget.getBoundingClientRect();
    setPick({ item, type, rect: r });
  }

  async function save(deckId) {
    const { item, type } = pick;
    const card = type === 'grammar'
      ? {
          type: 'grammar', deckId,
          surface: item.pattern, reading: item.reading || '', lemma: item.pattern,
          meaning: item.meaning, note: item.explanation, pos: 'expression',
          jlpt: item.jlpt || 'unknown',
          context: item.example, contextTranslation: item.exampleTranslation,
        }
      : {
          type: 'word', deckId,
          surface: item.lemma, reading: item.lemmaReading || item.reading,
          lemma: item.lemma, meaning: item.meaning, note: item.note || '',
          pos: item.pos, jlpt: item.jlpt || 'unknown',
          context: result.original, contextTranslation: result.translation,
        };
    await onSave(card);
    setPick(null);
  }

  return (
    <>
      <div className="composer">
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="일본어 문장이나 단어를 붙여넣으세요. 스크린샷을 붙여넣어도 읽어냅니다."
          spellCheck={false}
        />
        {image && (
          <div className="thumb">
            <img src={image.url} alt="" />
            <span>{image.name}</span>
            <button className="btn-quiet" onClick={() => setImage(null)}>빼기</button>
          </div>
        )}
        <div className="composer-bar">
          <span className="composer-hint"><kbd>⌘</kbd>+<kbd>Enter</kbd> 로 분석</span>
          <label className="btn" style={{ cursor: 'pointer' }}>
            이미지
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setImage({ url: URL.createObjectURL(f), name: f.name, inline: await fileToInline(f) });
                e.target.value = '';
              }}
            />
          </label>
          <button className="btn btn-primary" onClick={run} disabled={busy || (!text.trim() && !image)}>
            {busy ? '읽는 중' : '분석'}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {busy && <div className="loading">문장을 뜯어보는 중입니다…</div>}

      {result && !busy && (
        <>
          <div className="sheet">
            <p className={`source ${furigana ? '' : 'no-furigana'}`}>
              {result.tokens.map((t, i) => {
                const clickable = t.worth;
                const key = `${t.lemma}|${t.pos}`;
                return (
                  <span
                    key={i}
                    className={[
                      'tok',
                      clickable ? '' : 'tok-plain',
                      savedKeys.has(key) ? 'tok-saved' : '',
                    ].join(' ')}
                    style={{ '--tok': POS_VAR[t.pos] || 'var(--pos-other)' }}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? (e) => openPick(e, t, 'word') : undefined}
                    onKeyDown={clickable ? (e) => e.key === 'Enter' && openPick(e, t, 'word') : undefined}
                  >
                    <Ruby surface={t.surface} reading={t.reading} />
                  </span>
                );
              })}
            </p>

            <p className="translation">{result.translation}</p>
            {result.literal && <p className="subline">직역 · {result.literal}</p>}

            <div className="tags">
              {result.jlpt !== 'unknown' && <span className="tag">{result.jlpt}</span>}
              {result.register && <span className="tag">{result.register}</span>}
              <button className="btn-quiet" onClick={() => setFurigana((v) => !v)}>
                {furigana ? '후리가나 끄기' : '후리가나 켜기'}
              </button>
              {canSpeak() && (
                <button className="btn-quiet" onClick={() => speak(result.original)}>소리로 듣기</button>
              )}
              <button
                className="btn-quiet"
                onClick={() => {
                  navigator.clipboard.writeText(`${result.original}\n${result.translation}`);
                  onToast('원문과 번역을 복사했습니다.');
                }}
              >
                복사
              </button>
            </div>
          </div>

          {result.grammar.length > 0 && (
            <>
              <h2 className="grammar-head">문법</h2>
              {result.grammar.map((g, i) => (
                <div className="gcard" key={i}>
                  <div className="gcard-top">
                    <span className="gpattern">{g.pattern}</span>
                    <span className="gmeaning">{g.meaning}</span>
                    <span style={{ flex: 1 }} />
                    <button className="btn-quiet" onClick={(e) => openPick(e, g, 'grammar')}>
                      담기
                    </button>
                  </div>
                  <p>{g.explanation}</p>
                  <div className="gexample">
                    {g.example}
                    <small>{g.exampleTranslation}</small>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {pick && (
        <Popover
          pick={pick}
          decks={decks}
          activeDeckId={activeDeckId}
          saved={savedKeys.has(`${pick.item.lemma ?? pick.item.pattern}|${pick.item.pos ?? 'expression'}`)}
          onSave={save}
        />
      )}
    </>
  );
}

function Ruby({ surface, reading }) {
  const hasKanji = /[\u4e00-\u9faf]/.test(surface);
  if (!hasKanji || !reading || reading === surface) return surface;
  return (
    <ruby>
      {surface}
      <rt>{reading}</rt>
    </ruby>
  );
}

function Popover({ pick, decks, activeDeckId, saved, onSave }) {
  const { item, type, rect } = pick;
  const [deckId, setDeckId] = useState(activeDeckId || decks[0]?.id || '');

  const left = Math.min(Math.max(12, rect.left - 20), window.innerWidth - 302);
  const above = rect.bottom + 210 > window.innerHeight;
  const style = above
    ? { left, bottom: window.innerHeight - rect.top + 8 }
    : { left, top: rect.bottom + 8 };

  const word = type === 'grammar' ? item.pattern : item.lemma;
  const reading = type === 'grammar' ? item.reading : item.lemmaReading || item.reading;

  return (
    <div className="pop" style={style}>
      <div className="pop-word">{word}</div>
      {reading && reading !== word && <div className="pop-reading">{reading}</div>}
      <p className="pop-meaning">{item.meaning}</p>
      {type === 'word' && (
        <p className="pop-note">
          {POS_KO[item.pos] || item.pos}
          {item.note ? ` · ${item.note}` : ''}
          {item.surface !== item.lemma ? ` · 원문에선 ${item.surface}` : ''}
        </p>
      )}
      <div className="pop-actions">
        {canSpeak() && <button className="btn btn-quiet" onClick={() => speak(word)} aria-label="발음 듣기">🔊</button>}
        <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => onSave(deckId)}>
          {saved ? '또 담기' : '담기'}
        </button>
      </div>
      {saved && <p className="pop-note" style={{ marginTop: 8 }}>이미 단어장에 있는 항목입니다.</p>}
    </div>
  );
}
