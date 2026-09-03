import { useEffect, useMemo, useState } from 'react';
import { schedule, previewInterval, isDue } from '../lib/srs';
import { speak, canSpeak } from '../lib/speech';

const GRADES = [
  { g: 0, label: '다시', cls: 'grade-again' },
  { g: 1, label: '어려움' },
  { g: 2, label: '보통' },
  { g: 3, label: '쉬움' },
];

export default function Review({ cards, onUpdate, onDone }) {
  const queue = useMemo(() => cards.filter(isDue), [cards.length]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);

  const card = queue[i];

  useEffect(() => {
    function onKey(e) {
      if (!card) return;
      if (e.code === 'Space') { e.preventDefault(); setShown(true); return; }
      if (shown && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function grade(g) {
    onUpdate(card.id, { srs: schedule(card.srs, g) });
    setShown(false);
    setI((n) => n + 1);
  }

  if (!card) {
    return (
      <div className="empty">
        <strong>{queue.length ? '오늘 몫을 다 봤습니다.' : '지금 복습할 카드가 없습니다.'}</strong>
        내일 다시 오면 새로 밀린 카드가 기다리고 있습니다.
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={onDone}>단어장으로 가기</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="progress">
        <i style={{ width: `${(i / queue.length) * 100}%` }} />
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
              {GRADES.map(({ g, label, cls }) => (
                <button key={g} className={`grade ${cls || ''}`} onClick={() => grade(g)}>
                  {label}
                  <small>{previewInterval(card.srs, g)}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 28 }}>
            <button className="btn btn-primary" onClick={() => setShown(true)}>뜻 보기</button>
            <p style={{ fontSize: 12, color: 'var(--sumi-3)', marginTop: 12 }}>
              <kbd>Space</kbd> 로 뒤집고 <kbd>1</kbd>–<kbd>4</kbd> 로 채점합니다.
            </p>
          </div>
        )}
      </div>

      <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--sumi-3)', marginTop: 14 }}>
        {i + 1} / {queue.length}
      </p>
    </>
  );
}
