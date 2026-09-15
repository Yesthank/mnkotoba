// Anki(v3 스케줄러)의 기본 설정을 그대로 옮긴 간격 반복 스케줄러.
//
// 카드는 네 상태 중 하나입니다.
//   new        아직 한 번도 안 본 카드
//   learning   학습 단계(1분 → 10분)를 밟는 중. 통과하면 review로 졸업
//   review     일 단위 간격으로 돌아오는 카드
//   relearning review에서 틀려서 재학습 단계(10분)를 밟는 중. 통과하면 review로 복귀
//
// 분 단위 단계에 있는 카드는 같은 세션 안에서 다시 돌아옵니다. 이게 Anki의 핵심이고,
// 예전 SM-2 축약판에는 없던 부분입니다.
//
// 저장 형태(card.srs)는 예전 필드(due/interval/ease/reps/lapses)를 그대로 두고
// state/step/lastReview/leech 를 선택적으로 더했습니다. 옛 카드는 normalizeSrs가 읽어 올립니다.

const MIN = 60000;
const DAY = 86400000;

// Anki 기본값. 필요하면 여기만 바꾸면 됩니다.
export const CONFIG = {
  learnSteps: [1, 10],        // 분. 새 카드가 밟는 학습 단계
  relearnSteps: [10],         // 분. 복습 카드를 틀렸을 때 밟는 재학습 단계
  graduatingInterval: 1,      // 일. 학습 단계를 '보통'으로 다 통과했을 때
  easyInterval: 4,            // 일. 학습 중 '쉬움'을 눌렀을 때
  startingEase: 2.5,
  easyBonus: 1.3,
  hardMultiplier: 1.2,
  intervalModifier: 1.0,
  lapseMultiplier: 0,         // 틀린 복습 카드의 새 간격 = 이전 간격 × 0 → 아래 최소값이 적용
  minimumLapseInterval: 1,    // 일
  maximumInterval: 36500,     // 일
  learnAheadMinutes: 20,      // 다른 카드가 없으면 학습 카드를 이만큼 앞당겨 보여줍니다
  newPerDay: 20,              // 하루에 새로 시작하는 카드 수. 가져온 큰 덱이 한꺼번에 쏟아지지 않게
  leechThreshold: 8,          // 이만큼 틀리면 leech 표시
  rolloverHour: 4,            // 하루의 경계. 새벽 4시 전은 '어제'로 칩니다
  minEase: 1.3,               // rslib MINIMUM_EASE_FACTOR
};

export const GRADE_KEYS = ['again', 'hard', 'good', 'easy'];

export const freshSrs = () => ({
  state: 'new',
  due: Date.now(),
  interval: 0, // 일 단위. review 상태에서만 의미가 있습니다
  ease: CONFIG.startingEase,
  reps: 0,
  lapses: 0,
  step: 0, // 학습 단계 인덱스
});

/** 옛 SM-2 데이터와 새 데이터를 모두 같은 모양으로 맞춥니다. */
export function normalizeSrs(srs) {
  const s = { ...freshSrs(), ...(srs || {}) };
  if (!srs?.state) s.state = s.reps === 0 && s.interval === 0 ? 'new' : 'review';
  if (typeof s.step !== 'number') s.step = 0;
  return s;
}

export const isLearning = (srs) => srs?.state === 'learning' || srs?.state === 'relearning';

export const isDue = (card, now = Date.now()) => (card?.srs?.due ?? 0) <= now;

/** 지금 세션에 들어갈 카드 수. 새 카드는 하루 한도만큼만 셉니다. */
export function dueCount(cards, now = Date.now()) {
  return sessionEntries(cards, now).length;
}

// ── 하루 경계 ──────────────────────────────────────────────
// Anki처럼 review 카드는 '몇 시'가 아니라 '어느 날'에 만기가 됩니다.
// 밤 9시에 1일 간격을 받으면 다음 날 새벽 4시부터 보입니다.

export function dayStart(t = Date.now()) {
  const d = new Date(t - CONFIG.rolloverHour * 3600000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), CONFIG.rolloverHour).getTime();
}

// 서머타임이 있어도 어긋나지 않도록 '오늘 시작 + 1.5일'의 하루 시작을 다시 구합니다.
export const nextDayStart = (t = Date.now()) => dayStart(dayStart(t) + DAY * 1.5);

const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);

// ── 퍼지 ──────────────────────────────────────────────────
// 같은 날 담은 카드가 전부 같은 날 돌아오지 않도록 간격을 살짝 흩뜨립니다.
// Anki와 같은 카드·같은 시도에 대해 같은 값이 나오도록 카드 id + reps 로 시드를 잡습니다.

function hashSeed(str, reps) {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h ^ (reps * 2654435761)) >>> 0;
}

function seededRandom(seed) {
  let a = seed + 0x6d2b79f5;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Anki의 FUZZ_RANGES. 2.5일 미만은 흔들지 않고, 길수록 비율이 줄어듭니다.
const FUZZ_RANGES = [
  [2.5, 7, 0.15],
  [7, 20, 0.1],
  [20, Infinity, 0.05],
];

// rslib/scheduler/states/fuzz.rs 의 fuzz_delta.
// 2.5일 미만은 흔들지 않고, 그 위로는 하루에 구간별 비율을 더합니다.
// 1.0 에서 시작하는 것이 핵심입니다. 0 에서 시작하면 퍼지 폭이 원본보다 하루씩 좁아집니다.
function fuzzDelta(ivl) {
  if (ivl < 2.5) return 0;
  let delta = 1;
  for (const [start, end, factor] of FUZZ_RANGES) {
    delta += factor * Math.max(0, Math.min(ivl, end) - start);
  }
  return delta;
}

// rslib 의 constrained_fuzz_bounds + with_review_fuzz.
function fuzzedInterval(seed, ivl, minimum = 1, maximum = CONFIG.maximumInterval) {
  minimum = Math.min(minimum, maximum);
  ivl = clamp(ivl, minimum, maximum);
  const delta = fuzzDelta(ivl);

  let lower = clamp(Math.round(ivl - delta), minimum, maximum);
  let upper = clamp(Math.round(ivl + delta), minimum, maximum);
  // 위아래가 같아지면 한 칸은 벌려 둡니다. 원본과 같은 조건입니다.
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;

  return lower + Math.floor(seededRandom(seed) * (upper - lower + 1));
}

// ── 학습 단계 ────────────────────────────────────────────

const stepDelay = (steps, idx) => (idx < steps.length ? steps[idx] * MIN : null);

// 첫 단계에서 '어려움' = 첫 두 단계의 평균.
// 단계가 하나뿐이면 1.5배로 하되 '다시 간격 + 하루'를 넘지 않습니다.
// rslib/scheduler/states/steps.rs 의 hard_delay_secs_for_first_step 과 같습니다.
function hardDelay(steps, idx) {
  const cur = stepDelay(steps, idx);
  if (cur == null) return null;
  if (idx > 0) return cur;
  const next = stepDelay(steps, 1);
  return next != null ? (cur + next) / 2 : Math.min(cur * 1.5, cur + DAY);
}

// rslib/scheduler/states/review.rs 의 leech_threshold_met.
// 문턱에서 한 번, 그 뒤로는 문턱의 절반(올림)마다 다시 표시합니다.
const isLeech = (lapses) => {
  const t = CONFIG.leechThreshold;
  if (!t || lapses < t) return false;
  return (lapses - t) % Math.max(1, Math.ceil(t / 2)) === 0;
};

// ── 다음 상태 계산 ────────────────────────────────────────
// 답 버튼 넷에 대해 각각 "이 버튼을 누르면 어떻게 되는가"를 미리 만들어 둡니다.
// 버튼 아래 '10분', '4일' 같은 표시와 실제 적용 결과가 반드시 같도록 하기 위해서입니다.
//
// 각 항목: { srs, kind: 'secs' | 'days', amount }
//   secs → 이 세션 안에서 amount 초 뒤에 다시 나옵니다
//   days → amount 일 뒤 하루 경계부터 만기가 됩니다

export function nextStates(srs, cardId = '', now = Date.now()) {
  const s = normalizeSrs(srs);
  const seed = hashSeed(cardId, s.reps);
  const base = { ...s, reps: s.reps + 1 };

  switch (s.state) {
    case 'new':
      return markFresh(learnStates({ ...base, step: 0 }, CONFIG.learnSteps, seed, null));
    case 'learning':
      return learnStates(base, CONFIG.learnSteps, seed, null);
    case 'relearning':
      return learnStates(base, CONFIG.relearnSteps, seed, base.interval);
    default:
      return reviewStates(base, seed, now);
  }
}

// 새 카드의 첫 답. applyState 가 introducedAt 을 찍어 하루 새 카드 한도를 셀 수 있게 합니다.
function markFresh(states) {
  for (const k of GRADE_KEYS) states[k].fresh = true;
  return states;
}

// relearnTo가 null이면 새 카드의 학습, 숫자면 틀린 복습 카드의 재학습(졸업 시 그 간격으로 복귀).
function learnStates(s, steps, seed, relearnTo) {
  const relearning = relearnTo != null;
  const idx = Math.max(0, Math.min(s.step, steps.length - 1));

  const learning = (step, ms) => ({
    srs: { ...s, state: relearning ? 'relearning' : 'learning', step },
    kind: 'secs',
    amount: ms / 1000,
  });

  // 졸업할 때 ease 는 새 카드면 초기값으로, 재학습 중이던 카드면 깎여 있던 값 그대로.
  // rslib/scheduler/states/learning.rs 는 네 버튼 모두 initial_ease_factor 를 쓰고,
  // relearning.rs 는 들고 있던 review 상태를 그대로 돌려줍니다.
  const graduate = (days) => ({
    srs: {
      ...s,
      state: 'review',
      step: 0,
      interval: days,
      ease: relearning ? s.ease : CONFIG.startingEase,
    },
    kind: 'days',
    amount: days,
  });

  const goodDays = relearning
    ? relearnTo
    : fuzzedInterval(seed, CONFIG.graduatingInterval, 1);
  const easyDays = relearning
    ? relearnTo + 1
    : fuzzedInterval(seed, CONFIG.easyInterval, goodDays + 1);

  const again = stepDelay(steps, 0);
  const hard = hardDelay(steps, idx);
  const good = stepDelay(steps, idx + 1);

  return {
    again: again == null ? graduate(goodDays) : learning(0, again),
    hard: hard == null ? graduate(goodDays) : learning(idx, hard),
    good: good == null ? graduate(goodDays) : learning(idx + 1, good),
    easy: graduate(easyDays),
  };
}

function reviewStates(s, seed, now) {
  const cur = Math.max(1, s.interval);
  const late = Math.max(0, daysBetween(s.due, now)); // 밀린 날짜만큼 보너스가 붙습니다
  const ease = s.ease;
  const mod = CONFIG.intervalModifier;

  // 어려움 < 보통 < 쉬움 순서가 절대 뒤집히지 않도록 하한을 물려 줍니다.
  const hardMin = CONFIG.hardMultiplier <= 1 ? 0 : cur + 1;
  const hardIvl = fuzzedInterval(seed, cur * CONFIG.hardMultiplier * mod, hardMin);
  const goodMin = CONFIG.hardMultiplier <= 1 ? cur + 1 : hardIvl + 1;
  const goodIvl = fuzzedInterval(seed, (cur + late / 2) * ease * mod, goodMin);
  const easyIvl = fuzzedInterval(seed, (cur + late) * ease * CONFIG.easyBonus * mod, goodIvl + 1);

  const review = (patch) => ({
    srs: { ...s, state: 'review', step: 0, ...patch },
    kind: 'days',
    amount: patch.interval,
  });

  // 틀림: 이전 간격 × lapseMultiplier(기본 0) → 최소 1일로 떨어지고, 재학습 단계를 거칩니다.
  const lapses = s.lapses + 1;
  const lapseIvl = fuzzedInterval(
    seed,
    Math.max(cur * CONFIG.lapseMultiplier, CONFIG.minimumLapseInterval),
    CONFIG.minimumLapseInterval,
  );
  const lapsed = {
    ...s,
    interval: lapseIvl,
    ease: Math.max(CONFIG.minEase, ease - 0.2),
    lapses,
    leech: s.leech || isLeech(lapses),
  };
  const firstRelearn = stepDelay(CONFIG.relearnSteps, 0);

  return {
    again: firstRelearn == null
      ? { srs: { ...lapsed, state: 'review', step: 0 }, kind: 'days', amount: lapseIvl }
      : { srs: { ...lapsed, state: 'relearning', step: 0 }, kind: 'secs', amount: firstRelearn / 1000 },
    hard: review({ interval: hardIvl, ease: Math.max(CONFIG.minEase, ease - 0.15) }),
    good: review({ interval: goodIvl }),
    easy: review({ interval: easyIvl, ease: ease + 0.15 }),
  };
}

/** nextStates의 한 항목을 실제 srs로 굳힙니다(만기 시각 계산). */
export function applyState(next, now = Date.now()) {
  let due;
  if (next.kind === 'secs') {
    // Anki v2 방식: 학습 단계엔 25%(최대 5분)까지 무작위로 더해 같은 카드끼리 뭉치지 않게 합니다.
    const extra = Math.random() * Math.min(300, next.amount * 0.25);
    due = now + Math.round((next.amount + extra) * 1000);
  } else {
    due = dayStart(now) + next.amount * DAY;
  }
  const srs = { ...next.srs, due, lastReview: now };
  if (next.fresh) srs.introducedAt = now;
  return srs;
}

/** 등급(0~3)으로 바로 답을 적용합니다. 미리보기 없이 쓸 때. */
export function answer(srs, cardId, grade, now = Date.now()) {
  return applyState(nextStates(srs, cardId, now)[GRADE_KEYS[grade]], now);
}

// ── 세션 큐 ──────────────────────────────────────────────
// Anki의 큐 순서를 그대로 따릅니다.
//   1. 지금 만기인 학습 카드
//   2. 만기인 복습 카드(오래 밀린 것부터)
//   3. 새 카드(담은 순서)
//   4. 다른 게 없으면 learnAhead 안에 만기인 학습 카드를 앞당겨서
//   5. 그래도 남은 학습 카드가 있으면 그 시각까지 대기
//
// entries: { id, srs, createdAt(ms) } 의 iterable

// extraNew: 이 세션에서 한도 위로 더 꺼내 볼 새 카드 수 (Anki의 '오늘 새 카드 한도 늘리기').
export function sessionEntries(cards, now = Date.now(), extraNew = 0) {
  const cutoff = nextDayStart(now);
  const today = dayStart(now);
  const entries = [];
  let introducedToday = 0;
  const fresh = [];

  for (const c of cards) {
    const s = normalizeSrs(c.srs);
    if (s.introducedAt >= today && s.introducedAt < cutoff) introducedToday += 1;
    const entry = { id: c.id, srs: s, createdAt: millis(c.createdAt) };
    if (s.state === 'new') { if (s.due <= now) fresh.push(entry); }
    else if (s.due <= now || (isLearning(s) && s.due < cutoff)) entries.push(entry);
  }

  // Anki의 '하루 새 카드' 한도. 오늘 이미 시작한 만큼을 빼고, 담은 순서대로 채웁니다.
  const room = Math.max(0, CONFIG.newPerDay + extraNew - introducedToday);
  fresh.sort((a, b) => a.createdAt - b.createdAt);
  return entries.concat(fresh.slice(0, room));
}

export function pickNext(entries, now = Date.now(), lastId = null) {
  const list = [...entries];
  const byDue = (a, b) => a.srs.due - b.srs.due;

  const learning = list.filter((e) => isLearning(e.srs)).sort(byDue);
  const dueNow = learning.filter((e) => e.srs.due <= now);
  if (dueNow.length) return { id: dueNow[0].id };

  const reviews = list.filter((e) => e.srs.state === 'review' && e.srs.due <= now).sort(byDue);
  if (reviews.length) return { id: reviews[0].id };

  const fresh = list.filter((e) => e.srs.state === 'new').sort((a, b) => a.createdAt - b.createdAt);
  if (fresh.length) return { id: fresh[0].id };

  const ahead = learning.filter((e) => e.srs.due <= now + CONFIG.learnAheadMinutes * MIN);
  if (ahead.length) {
    // 방금 답한 카드를 곧바로 또 보여주진 않습니다. 다른 카드가 있으면 그쪽이 먼저.
    const other = ahead.find((e) => e.id !== lastId);
    return { id: (other || ahead[0]).id };
  }

  if (learning.length) return { waitUntil: learning[0].srs.due };
  return null;
}

/** Anki 화면 아래 파랑/빨강/초록 숫자에 해당합니다. */
export function sessionCounts(entries, now = Date.now()) {
  const c = { new: 0, learn: 0, review: 0 };
  for (const e of entries) {
    if (e.srs.state === 'new') c.new += 1;
    else if (isLearning(e.srs)) c.learn += 1;
    else if (e.srs.due <= now) c.review += 1;
  }
  return c;
}

// ── 표시 ─────────────────────────────────────────────────

export function formatNext(next) {
  if (next.kind === 'secs') {
    const secs = next.amount;
    if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))}분`;
    if (secs < DAY / 1000) return `${Math.round(secs / 3600)}시간`;
    return `${Math.round(secs / 86400)}일`;
  }
  return formatDays(next.amount);
}

export function formatDays(d) {
  if (d < 30) return `${d}일`;
  if (d < 365) return `${trim((d / 30).toFixed(1))}개월`;
  return `${trim((d / 365).toFixed(1))}년`;
}

export function formatWait(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}분 ${s % 60}초` : `${s}초`;
}

const trim = (str) => str.replace(/\.0$/, '');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function millis(t) {
  if (!t) return Infinity; // 서버 시각이 아직 안 찍힌 카드 = 방금 담은 것 → 맨 뒤
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t.seconds != null) return t.seconds * 1000;
  return Infinity;
}
