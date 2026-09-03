// SM-2를 개인용으로 줄인 버전. 등급은 네 단계.
// again(0) / hard(1) / good(2) / easy(3)

const DAY = 86400000;

export const freshSrs = () => ({
  due: Date.now(),
  interval: 0, // 일 단위
  ease: 2.5,
  reps: 0,
  lapses: 0,
});

export function schedule(srs = freshSrs(), grade) {
  const s = { ...freshSrs(), ...srs };

  if (grade === 0) {
    return { ...s, interval: 0, reps: 0, lapses: s.lapses + 1, ease: Math.max(1.3, s.ease - 0.2), due: Date.now() + 10 * 60000 };
  }

  const ease = clamp(s.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0), 1.3, 3.0);
  let interval;

  if (s.reps === 0) interval = grade === 1 ? 1 : grade === 2 ? 1 : 3;
  else if (s.reps === 1) interval = grade === 1 ? 3 : grade === 2 ? 4 : 7;
  else interval = Math.round(s.interval * ease * (grade === 1 ? 0.6 : 1));

  interval = clamp(interval, 1, 365);

  return { due: Date.now() + interval * DAY, interval, ease, reps: s.reps + 1, lapses: s.lapses };
}

export const isDue = (card) => (card?.srs?.due ?? 0) <= Date.now();

export function dueCount(cards) {
  return cards.filter(isDue).length;
}

// 예습 결과를 미리 보여주면 어떤 버튼을 누를지 판단하기 쉬워집니다.
export function previewInterval(srs, grade) {
  const next = schedule(srs, grade);
  if (next.interval === 0) return '10분';
  if (next.interval === 1) return '1일';
  if (next.interval < 30) return `${next.interval}일`;
  return `${Math.round(next.interval / 30)}개월`;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
