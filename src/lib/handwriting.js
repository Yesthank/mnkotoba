// 손글씨 한자 인식. KanjiCanvas(MIT) 의 인식 수학만 빌려 씁니다.
// https://github.com/asdfjkl/kanjicanvas
//
// 라이브러리가 제공하는 init/recognize 는 쓰지 않습니다. 그쪽은 캔버스에 직접 리스너를 달고
// 지우지 않아서, 패널을 열고 닫을 때마다 리스너가 겹쳐 획이 두 번 기록됩니다.
// 그리기는 Handwriting.jsx 가 포인터 이벤트로 직접 하고, 여기서는 좌표만 넘겨 후보를 받습니다.
//
// 라이브러리가 document 에 Ctrl+Z/X/F 키 리스너를 하나 답니다. 그 핸들러는
// KanjiCanvas["canvas_" + 포커스된요소id] 가 있을 때만 동작하는데, init 을 부르지 않으면
// 그 키가 생기지 않으므로 아무 일도 하지 않습니다.

const BASE = `${import.meta.env.BASE_URL || '/'}kanji`.replace(/\/{2,}/g, '/');

// 참조 패턴이 그려진 캔버스 크기. 정규화 함수가 최소값 탐색을 256 에서 시작하기 때문에
// 좌표가 이 범위를 벗어나면 경계를 잘못 잡습니다. 넘기기 전에 반드시 여기에 맞춥니다.
const BOX = 256;
const CANVAS_KEY = 'kotoba'; // 라이브러리가 recordedPattern_<key> 에서 획을 읽습니다

let engine = null;
let loading = null;

export const isReady = () => engine !== null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-kanji-canvas]`);
    if (existing) {
      if (existing.dataset.loaded) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('인식기를 불러오지 못했습니다.')));
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.dataset.kanjiCanvas = '1';
    el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve(); });
    el.addEventListener('error', () => { el.remove(); reject(new Error('인식기를 불러오지 못했습니다.')); });
    document.head.appendChild(el);
  });
}

/** 엔진과 참조 패턴을 받아옵니다. 여러 번 불러도 한 번만 받습니다. */
export function loadEngine() {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;

  loading = (async () => {
    await loadScript(`${BASE}/kanji-canvas.min.js`);
    const kc = window.KanjiCanvas;
    if (!kc?.momentNormalize) throw new Error('인식기를 불러오지 못했습니다.');

    const res = await fetch(`${BASE}/ref-patterns.json`);
    if (!res.ok) throw new Error(`글자 데이터를 받지 못했습니다. (${res.status})`);
    const patterns = await res.json();
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new Error('글자 데이터가 비어 있습니다.');
    }

    kc.refPatterns = patterns;
    engine = kc;
    return kc;
  })();

  // 실패하면 다음에 다시 시도할 수 있게 풀어 둡니다.
  loading.catch(() => { loading = null; });
  return loading;
}

/**
 * 획 좌표를 참조 패턴과 같은 256 상자로 옮깁니다.
 * 글자를 어디에 얼마나 크게 그렸는지는 그대로 두고 캔버스 크기만 맞춥니다.
 * 나머지 정규화(중심 이동·크기 맞춤)는 라이브러리의 momentNormalize 가 합니다.
 */
function fitToBox(strokes, canvasSize) {
  const k = BOX / (canvasSize || BOX);
  const clamp = (n) => Math.min(BOX, Math.max(0, n * k));
  return strokes.map((stroke) => stroke.map(([x, y]) => [clamp(x), clamp(y)]));
}

/**
 * 획을 넘기면 닮은 글자 후보를 돌려줍니다.
 * @param {number[][][]} strokes 획마다 [x, y] 점의 배열
 * @param {number} canvasSize 그 좌표가 찍힌 캔버스 한 변의 길이(CSS 픽셀)
 * @returns {string[]} 닮은 순서대로 최대 열 자
 */
export function recognize(strokes, canvasSize) {
  if (!engine) throw new Error('인식기가 아직 준비되지 않았습니다.');
  if (!strokes.length) return [];

  engine[`recordedPattern_${CANVAS_KEY}`] = fitToBox(strokes, canvasSize);
  const normalized = engine.momentNormalize(CANVAS_KEY);
  const features = engine.extractFeatures(normalized, 20);
  const coarse = engine.coarseClassification(features);
  const result = engine.fineClassification(features, coarse);

  return String(result).trim().split(/\s+/).filter(Boolean);
}

/**
 * 화면에 띄울 후보를 만듭니다. 그은 그대로 한 번, 획을 합쳐 한 번 보고 합칩니다.
 * 합치기만 하면 정상 입력이 망가질 수 있고, 안 하면 획을 잘게 끊어 그린 글자가 통째로 빠집니다.
 * @param {number[][][]} strokes
 * @param {number} canvasSize CSS 픽셀
 * @param {number} limit 최대 후보 수
 */
export function suggest(strokes, canvasSize, limit = 12) {
  const direct = recognize(strokes, canvasSize);

  const merged = mergeStrayStrokes(strokes, Math.max(8, canvasSize * 0.05));
  if (merged.length === strokes.length) return direct.slice(0, limit);

  // 둘을 번갈아 끼웁니다. 뒤에 붙이기만 하면 획을 끊어 그린 사람이 찾는 글자가
  // 늘 열한 번째에 앉아 화면 밖으로 밀립니다.
  const out = [];
  const seen = new Set();
  const second = recognize(merged, canvasSize);
  for (let i = 0; i < Math.max(direct.length, second.length); i += 1) {
    for (const ch of [direct[i], second[i]]) {
      if (ch && !seen.has(ch)) {
        seen.add(ch);
        out.push(ch);
      }
    }
  }
  return out.slice(0, limit);
}

/**
 * 펜을 자주 떼는 사람을 위한 보정.
 * 앞 획이 끝난 자리 바로 옆에서 곧바로 시작한 획은 한 획으로 봅니다.
 * 인식기가 참조 획수의 -2 ~ +1 범위만 후보로 올리기 때문에, 이걸 안 하면
 * 획을 잘게 끊어 그린 글자가 후보에서 통째로 빠집니다.
 */
export function mergeStrayStrokes(strokes, gapPx = 10) {
  const out = [];
  for (const stroke of strokes) {
    const prev = out[out.length - 1];
    if (prev && stroke.length) {
      const [ax, ay] = prev[prev.length - 1];
      const [bx, by] = stroke[0];
      if (Math.hypot(bx - ax, by - ay) <= gapPx) {
        prev.push(...stroke);
        continue;
      }
    }
    out.push([...stroke]);
  }
  return out;
}
