import { useEffect, useMemo, useState } from 'react';
import {
  nextStates, applyState, pickNext, sessionEntries, sessionCounts,
  formatNext, formatWait, isLearning,
} from '../lib/srs';
import { speak, canSpeak } from '../lib/speech';

const GRADES = [
  { key: 'again', label: '다시', cls: 'grade-again' },
  { key: 'hard', label: '어려움' },
  { key: 'good', label: '보통' },
  { key: 'easy', label: '쉬움' },
];

// 세션은 복습 탭에 들어온 순간 만들어집니다. 그때 만기인 카드 + 오늘 안에 돌아올 학습 카드가 재료이고,
// 답할 때마다 카드가 큐 안에서 자리를 옮깁니다(Anki의 new/learn/review 큐).
// 분 단위 학습 단계에 있는 카드는 졸업할 때까지 이 세션을 떠나지 않습니다.
function initSession(cards) {
  const now = Date.now();
  const pool = new Map(sessionEntries(cards, now).map((e) => [e.id, e]));
  return {
    pool,
    total: pool.size,
    current: pickNext(pool.values(), now),
    lastId: null,
    answered: 0,
    again: 0,
    history: [], // 되돌리기용. { entry, key }
    startedAt: now,
  };
}

export default function Review({ cards, onUpdate, onDone }) {
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const [s, setS] = useState(() => initSession(cards));
  const [shown, setShown] = useState(false);
  const [, setTick] = useState(0);

  const entry = s.current?.id ? s.pool.get(s.current.id) : null;
  const card = entry ? byId.get(entry.id) : null;

  // 버튼 넷의 결과를 카드가 보일 때 한 번만 계산해 두고, 표시와 적용에 같은 값을 씁니다.
  const states = useMemo(() => (entry ? nextStates(entry.srs, entry.id) : null), [entry]);

  // 남은 학습 카드가 learn-ahead 밖이라 기다리는 중이면 그 시각에 다시 뽑고, 초 단위로 화면을 갱신합니다.
  useEffect(() => {
    if (!s.current?.waitUntil) return;
    const wake = setTimeout(
      () => setS((prev) => ({ ...prev, current: pickNext(prev.pool.values(), Date.now(), prev.lastId) })),
      Math.max(0, s.current.waitUntil - Date.now()) + 50,
    );
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => { clearTimeout(wake); clearInterval(tick); };
  }, [s.current]);

  // 세션 도중 다른 곳에서 지워진 카드는 조용히 건너뜁니다.
  useEffect(() => {
    if (!entry || card) return;
    setS((prev) => {
      const pool = new Map(prev.pool);
      pool.delete(entry.id);
      return { ...prev, pool, current: pickNext(pool.values(), Date.now(), prev.lastId) };
    });
  }, [entry, card]);

  useEffect(() => {
    function onKey(e) {
      if (!card || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); return; }
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        // Anki처럼 뒷면에서 Space/Enter 는 '보통'입니다.
        if (shown) grade('good'); else setShown(true);
        return;
      }
      if (shown && ['1', '2', '3', '4'].includes(e.key)) grade(GRADES[Number(e.key) - 1].key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function grade(key) {
    if (!entry || !states) return;
    const now = Date.now();
    const nextSrs = applyState(states[key], now);
    onUpdate(entry.id, { srs: nextSrs });
    setShown(false);
    setS((prev) => {
      const pool = new Map(prev.pool);
      // 일 단위로 넘어간 카드는 오늘 세션을 떠나고, 학습 단계 카드는 남아서 다시 돌아옵니다.
      if (isLearning(nextSrs)) pool.set(entry.id, { ...entry, srs: nextSrs });
      else pool.delete(entry.id);
      return {
        ...prev,
        pool,
        lastId: entry.id,
        answered: prev.answered + 1,
        again: prev.again + (key === 'again' ? 1 : 0),
        history: [...prev.history.slice(-49), { entry, key }],
        current: pickNext(pool.values(), now, entry.id),
      };
    });
  }

  function undo() {
    const last = s.history[s.history.length - 1];
    if (!last) return;
    onUpdate(last.entry.id, { srs: last.entry.srs });
    setShown(false);
    setS((prev) => {
      const pool = new Map(prev.pool);
      pool.set(last.entry.id, last.entry);
      return {
        ...prev,
        pool,
        lastId: null,
        answered: prev.answered - 1,
        again: prev.again - (last.key === 'again' ? 1 : 0),
        history: prev.history.slice(0, -1),
        current: { id: last.entry.id },
      };
    });
  }

  const counts = sessionCounts(s.pool.values());
  const remaining = counts.new + counts.learn + counts.review;
  const progress = s.total ? Math.max(0, Math.min(1, 1 - remaining / s.total)) : 0;

  if (s.current?.waitUntil) {
    const ms = s.current.waitUntil - Date.now();
    return (
      <div className="empty">
        <strong>지금 볼 카드는 다 봤습니다.</strong>
        학습 중인 카드 {counts.learn}장이 남아 있습니다. 다음 카드는 <b>{formatWait(ms)}</b> 뒤에 나옵니다.
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
          {s.history.length > 0 && <button className="btn" onClick={undo}>되돌리기</button>}
          <button className="btn" onClick={onDone}>단어장으로 가기</button>
        </div>
      </div>
    );
  }

  if (!card) {
    const minutes = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
    return (
      <div className="empty">
        <strong>{s.total ? '오늘 몫을 다 봤습니다.' : '지금 복습할 카드가 없습니다.'}</strong>
        {s.total
          ? `${s.answered}번 답했고, 그중 ${s.again}번은 '다시'였습니다. ${minutes}분 걸렸습니다.`
          : '내일 다시 오면 새로 밀린 카드가 기다리고 있습니다.'}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
          {s.history.length > 0 && <button className="btn" onClick={undo}>되돌리기</button>}
          <button className="btn" onClick={onDone}>단어장으로 가기</button>
        </div>
      </div>
    );
  }

  const kind = entry.srs.state === 'new' ? 'new' : isLearning(entry.srs) ? 'learn' : 'review';

  return (
    <>
      <div className="progress">
        <i style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="review">
        <div className="review-front">
          {card.surface}
          {canSpeak() && (
            <button
              className="btn-quiet"
              style={{ fontSize: 16, verticalAlign: 'middle', marginLeft: 10 }}
              onClick={() => speak(card.surface)}
              aria-label="발음 듣기"
            >
              🔊
            </button>
          )}
        </div>

        {shown ? (
          <div className="review-back">
            {card.reading && card.reading !== card.surface && (
              <div style={{ color: 'var(--sumi-3)' }}>{card.reading}</div>
            )}
            <div className="review-meaning">{card.meaning}</div>
            {card.note && <div style={{ fontSize: 13, color: 'var(--sumi-3)', marginTop: 6 }}>{card.note}</div>}
            {card.context && (
              <div className="review-context">
                {card.context}
                <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--sumi-3)' }}>
                  {card.contextTranslation}
                </div>
              </div>
            )}
            <div className="grades">
              {GRADES.map(({ key, label, cls }) => (
                <button key={key} className={`grade ${cls || ''}`} onClick={() => grade(key)}>
                  {label}
                  <small>{formatNext(states[key])}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 28 }}>
            <button className="btn btn-primary" onClick={() => setShown(true)}>뜻 보기</button>
            <p style={{ fontSize: 12, color: 'var(--sumi-3)', marginTop: 12 }}>
              <kbd>Space</kbd> 로 뒤집고 <kbd>1</kbd>–<kbd>4</kbd> 로 채점합니다. 뒷면에서 <kbd>Space</kbd> 는 '보통', <kbd>Z</kbd> 는 되돌리기.
            </p>
          </div>
        )}
      </div>

      <div className="counts" aria-label="남은 카드">
        <span className="count-new" aria-current={kind === 'new'}>새 카드 {counts.new}</span>
        <span className="count-learn" aria-current={kind === 'learn'}>학습 {counts.learn}</span>
        <span className="count-review" aria-current={kind === 'review'}>복습 {counts.review}</span>
        {entry.srs.leech && <span className="count-leech" title="여덟 번 넘게 틀린 카드입니다. 뜻이나 예문을 손보는 게 좋습니다.">leech</span>}
        {s.history.length > 0 && (
          <button className="btn-quiet" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={undo}>되돌리기</button>
        )}
      </div>
    </>
  );
}
