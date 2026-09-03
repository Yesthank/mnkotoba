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

const HISTORY_LIMIT = 20;
const GAP_MS = 600; // 무료 티어 분당 한도에 걸리지 않게 요청 사이에 두는 간격
const uid = () => Math.random().toString(36).slice(2, 10);

// 카드 뜻에는 사전형 뜻만 넣고, 원문에서 어떤 꼴로 나왔는지는 메모로 남깁니다.
// 앞면이 届く인데 뒷면이 "닿지 않았다"가 되면 카드가 거짓말을 하게 됩니다.
function noteOf(t) {
  if (t.surface === t.lemma) return t.note || '';
  const shape = t.inContext ? `${t.surface} — ${t.inContext}` : t.surface;
  return t.note ? `${shape} (${t.note})` : `원문에선 ${shape}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Analyzer({ decks, activeDeckId, savedKeys, onSave, onToast }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [tick, setTick] = useState(0);
  const [furigana, setFurigana] = useState(true);
  const [pick, setPick] = useState(null);

  const runningRef = useRef(false);
  const abortRef = useRef(null);

  const pending = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error');

  // ── 대기열 처리기 ────────────────────────────────────────
  // 한 번에 하나씩만 돕니다. 여러 개를 한꺼번에 던지면 무료 한도에 바로 걸립니다.
  useEffect(() => {
    if (runningRef.current) return;

    // jobs는 최신이 앞이므로, 뒤에서부터 찾으면 먼저 넣은 것이 먼저 나옵니다.
    const next = [...jobs].reverse().find((j) => j.status === 'queued');
    if (!next) return;

    runningRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = { id: next.id, ctrl };
    setJobs((js) => js.map((j) => (j.id === next.id ? { ...j, status: 'running' } : j)));

    (async () => {
      let patch;
      try {
        const result = await analyze({ text: next.text, image: next.image, signal: ctrl.signal });
        patch = { status: 'done', result };
      } catch (err) {
        patch = err.name === 'AbortError'
          ? { status: 'cancelled' }
          : { status: 'error', error: err.message };
      }

      abortRef.current = null;
      setJobs((js) =>
        patch.status === 'cancelled'
          ? js.filter((j) => j.id !== next.id)
          : js.map((j) => (j.id === next.id ? { ...j, ...patch } : j)),
      );

      await sleep(GAP_MS);
      runningRef.current = false;
      setTick((t) => t + 1); // 다음 작업을 깨웁니다
    })();
  }, [jobs, tick]);

  function submit() {
    if (!text.trim() && !image) return;
    const job = {
      id: uid(),
      text: text.trim(),
      image: image?.inline,
      label: text.trim() || image?.name || '이미지',
      status: 'queued',
    };
    setJobs((js) => [job, ...js].slice(0, HISTORY_LIMIT));
    setText('');
    setImage(null);
  }

  function onKeyDown(e) {
    if (e.key !== 'Enter') return;
    // 한글·가나 입력기가 글자를 조합하는 중에 누른 Enter는 확정용이지 전송이 아닙니다.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.shiftKey) return; // 줄바꿈
    e.preventDefault();
    submit();
  }

  function cancel(id) {
    if (abortRef.current?.id === id) abortRef.current.ctrl.abort();
    else setJobs((js) => js.filter((j) => j.id !== id));
  }

  function cancelAll() {
    const running = abortRef.current;
    setJobs((js) => js.filter((j) => j.status !== 'queued'));
    if (running) running.ctrl.abort();
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

  async function save(deckId) {
    const { item, type, source } = pick;
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
          lemma: item.lemma, meaning: item.meaning, note: noteOf(item),
          pos: item.pos, jlpt: item.jlpt || 'unknown',
          context: source.original, contextTranslation: source.translation,
        };
    await onSave(card);
    setPick(null);
  }

  return (
    <>
      <div className="composer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="일본어를 넣고 Enter. 계속 넣으면 순서대로 처리합니다."
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
          <span className="composer-hint">
            <kbd>Enter</kbd> 분석 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 줄바꿈
          </span>
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
          <button className="btn btn-primary" onClick={submit} disabled={!text.trim() && !image}>
            분석
          </button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="queue">
          <div className="queue-head">
            <span>
              {pending.length}건 처리 중
              {pending.length > 1 && ` · 대기 ${pending.length - 1}`}
            </span>
            <button className="btn-quiet" onClick={cancelAll}>전부 취소</button>
          </div>
          {pending.map((j) => (
            <div className="qitem" key={j.id}>
              <span className={`qdot ${j.status === 'running' ? 'qdot-live' : ''}`} />
              <span className="qlabel">{j.label}</span>
              <span className="qstatus">{j.status === 'running' ? '읽는 중' : '대기'}</span>
              <button className="btn-quiet" onClick={() => cancel(j.id)} aria-label="취소">×</button>
            </div>
          ))}
        </div>
      )}

      {finished.map((j) =>
        j.status === 'error' ? (
          <div className="error" key={j.id}>
            <strong>{j.label}</strong> — {j.error}
            <button className="btn-quiet" style={{ float: 'right' }} onClick={() => cancel(j.id)}>닫기</button>
          </div>
        ) : (
          <ResultCard
            key={j.id}
            result={j.result}
            furigana={furigana}
            savedKeys={savedKeys}
            onToggleFurigana={() => setFurigana((v) => !v)}
            onPick={(e, item, type) =>
              setPick({ item, type, source: j.result, rect: e.currentTarget.getBoundingClientRect() })
            }
            onCopy={() => {
              navigator.clipboard.writeText(`${j.result.original}\n${j.result.translation}`);
              onToast('원문과 번역을 복사했습니다.');
            }}
            onDismiss={() => cancel(j.id)}
          />
        ),
      )}

      {jobs.length === 0 && (
        <div className="empty" style={{ marginTop: 28 }}>
          <strong>아직 읽은 문장이 없습니다.</strong>
          위에 일본어를 넣고 Enter를 누르세요. 여러 개를 연달아 넣어도 됩니다.
        </div>
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

function ResultCard({ result, furigana, savedKeys, onToggleFurigana, onPick, onCopy, onDismiss }) {
  return (
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
                onClick={clickable ? (e) => onPick(e, t, 'word') : undefined}
                onKeyDown={clickable ? (e) => e.key === 'Enter' && onPick(e, t, 'word') : undefined}
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
          <button className="btn-quiet" onClick={onToggleFurigana}>
            {furigana ? '후리가나 끄기' : '후리가나 켜기'}
          </button>
          {canSpeak() && (
            <button className="btn-quiet" onClick={() => speak(result.original)}>소리로 듣기</button>
          )}
          <button className="btn-quiet" onClick={onCopy}>복사</button>
          <span style={{ flex: 1 }} />
          <button className="btn-quiet" onClick={onDismiss} aria-label="이 결과 치우기">×</button>
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
                <button className="btn-quiet" onClick={(e) => onPick(e, g, 'grammar')}>담기</button>
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
        <>
          <p className="pop-note">{POS_KO[item.pos] || item.pos}</p>
          {item.surface !== item.lemma && (
            <p className="pop-note">
              원문에선 <b>{item.surface}</b>
              {item.inContext ? ` — ${item.inContext}` : ''}
              {item.note ? ` (${item.note})` : ''}
            </p>
          )}
        </>
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
