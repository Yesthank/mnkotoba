import { useCallback, useEffect, useRef, useState } from 'react';
import { loadEngine, suggest, isReady } from '../lib/handwriting';
import { toKana, toKatakana, toHiragana } from '../lib/romaji';

// 일본어 자판이 없는 기기에서 글자를 넣는 두 가지 길.
//   필기 — 한자를 그려서 고릅니다. 인식기가 한자 2213자만 알고 가나는 모릅니다.
//   가나 — 로마자를 치면 가나가 됩니다. saikou → さいこう
//
// 넓은 화면에서는 입력창 아래에 펼쳐지고, 좁은 화면에서는 자판처럼 바닥에 붙습니다.
// 붙는 쪽은 CSS 가 맡고, 여기서는 시트 높이와 자판에 가린 높이만 알려 줍니다.
//
// 그리기는 여기서 직접 합니다. 라이브러리의 캔버스 초기화를 쓰면 패널을 여닫을 때마다
// 리스너가 겹쳐 획이 두 번 기록되고, 화면 배율 보정도 없습니다.

const MAX_STROKES = 40;

/** 이 요소를 실제로 굴리는 칸. 이 앱은 window 가 아니라 .main 이 스크롤됩니다. */
function scrollerOf(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

export default function Handwriting({ onInsert, onClose, anchorRef }) {
  const [mode, setMode] = useState('draw');
  const rootRef = useRef(null);

  // 바닥에 붙었을 때 본문이 시트에 가리지 않도록 실제 높이를 알려 주고,
  // 입력창이 시트에 덮였으면 그 위로 끌어올립니다. 폰을 눕히면 특히 자리가 없습니다.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    document.body.classList.add('hw-open');

    // 시트가 화면에 붙어 있을 때만 끌어올립니다. 넓은 화면에서는 그냥 흐르는 칸입니다.
    const keepAnchorVisible = () => {
      const anchor = anchorRef?.current;
      if (!anchor || getComputedStyle(root).position !== 'fixed') return;

      // 시트는 화면에 고정이라 화면 좌표로 재면 됩니다.
      const room = window.innerHeight - root.getBoundingClientRect().height - 12;
      const gap = anchor.getBoundingClientRect().bottom - room;
      if (gap <= 0) return;

      // 부드럽게 굴리면 아직 움직이는 중인 위치를 다시 재게 되어 몇 픽셀이 모자란 채로
      // 끝납니다. 시트가 뜨는 순간이라 즉시 옮겨도 튀지 않습니다.
      (scrollerOf(anchor) ?? window).scrollBy({ top: gap, behavior: 'auto' });
    };

    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--hw-sheet-h', `${Math.round(entry.contentRect.height)}px`);
      // 콜백 안에서 굴리면 브라우저가 이어질 알림을 버립니다. 한 프레임 뒤로 미룹니다.
      requestAnimationFrame(keepAnchorVisible);
    });
    observer.observe(root);

    // 인식기를 받아오는 동안 시트 높이가 몇 번 더 바뀝니다. 잠시 따라가며 자리를 맞춥니다.
    let left = 8;
    const settle = setInterval(() => {
      keepAnchorVisible();
      if ((left -= 1) <= 0) clearInterval(settle);
    }, 60);

    return () => {
      observer.disconnect();
      clearInterval(settle);
      document.body.classList.remove('hw-open');
      document.documentElement.style.removeProperty('--hw-sheet-h');
    };
  }, [anchorRef]);

  // 가나 탭에서 자판이 올라오면 바닥에 붙은 시트가 그 아래로 숨습니다.
  // 자판이 먹은 높이만큼 시트를 띄웁니다. 이 앱의 다른 화면은 건드리지 않습니다.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const hidden = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty('--hw-keyboard', `${Math.round(hidden)}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--hw-keyboard');
    };
  }, []);

  return (
    <div className="hw" ref={rootRef}>
      <div className="hw-grab" aria-hidden="true" />
      <div className="hw-head">
        <div className="hw-tabs">
          <button className="hw-tab" aria-current={mode === 'draw'} onClick={() => setMode('draw')}>
            필기
          </button>
          <button className="hw-tab" aria-current={mode === 'kana'} onClick={() => setMode('kana')}>
            가나
          </button>
        </div>
        <button className="btn-quiet hw-close" onClick={onClose}>닫기</button>
      </div>

      {mode === 'draw' ? <Draw onInsert={onInsert} /> : <Kana onInsert={onInsert} />}
    </div>
  );
}

// ── 필기 ────────────────────────────────────────────────

function Draw({ onInsert }) {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]); // [[[x, y], …], …] CSS 픽셀
  const drawingRef = useRef(false);
  const sizeRef = useRef(0);
  const timerRef = useRef(0);

  const [strokeCount, setStrokeCount] = useState(0);
  const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState(isReady() ? 'ready' : 'loading');
  const [error, setError] = useState('');

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const size = sizeRef.current;
    if (!canvas || !size) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // 가운데 십자 안내선. 네모 안에 균형 있게 그리도록 돕습니다.
    ctx.save();
    ctx.strokeStyle = 'rgba(141, 135, 120, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = '#23211c';
    ctx.fillStyle = '#23211c';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 40);

    for (const stroke of strokesRef.current) {
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0][0], stroke[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0][0], stroke[0][1]);
      for (let i = 1; i < stroke.length; i += 1) ctx.lineTo(stroke[i][0], stroke[i][1]);
      ctx.stroke();
    }
  }, []);

  // 캔버스 픽셀 수를 화면 배율에 맞춥니다. 안 하면 고해상도 화면에서 획이 흐려집니다.
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = Math.round(canvas.getBoundingClientRect().width);
    if (!size || size === sizeRef.current) return;

    const ratio = window.devicePixelRatio || 1;
    const before = sizeRef.current;
    sizeRef.current = size;

    // 화면이 돌아가 캔버스 크기가 바뀌면 이미 그린 획도 같은 비율로 옮깁니다.
    if (before && strokesRef.current.length) {
      const k = size / before;
      strokesRef.current = strokesRef.current.map((s) => s.map(([x, y]) => [x * k, y * k]));
    }

    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
    paint();
  }, [paint]);

  useEffect(() => {
    resize();
    const observer = new ResizeObserver(resize);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [resize]);

  useEffect(() => {
    let alive = true;
    loadEngine().then(
      () => alive && setStatus('ready'),
      (e) => { if (alive) { setStatus('error'); setError(e.message); } },
    );
    return () => { alive = false; clearTimeout(timerRef.current); };
  }, []);

  function run() {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!isReady() || !strokesRef.current.length) return setCandidates([]);
      try {
        setCandidates(suggest(strokesRef.current, sizeRef.current));
      } catch (e) {
        setStatus('error');
        setError(e.message);
      }
    }, 80);
  }

  function pointOf(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  // preventDefault 는 부르지 않습니다. 스크롤은 CSS 의 touch-action 이 이미 막고 있고,
  // 여기서 기본 동작을 막으면 크롬이 이후 손가락 탭에서 클릭을 만들지 않아
  // 후보와 지우기 버튼이 먹통이 됩니다.
  function onPointerDown(e) {
    if (status !== 'ready' || strokesRef.current.length >= MAX_STROKES) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    strokesRef.current.push([pointOf(e)]);
    setStrokeCount(strokesRef.current.length);
    paint();
  }

  function onPointerMove(e) {
    if (!drawingRef.current) return;
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    const [x, y] = pointOf(e);
    const [px, py] = stroke[stroke.length - 1];
    if (Math.hypot(x - px, y - py) < 1.2) return; // 점이 너무 촘촘하면 버립니다

    stroke.push([x, y]);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function onPointerUp(e) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* 이미 풀림 */ }
    run();
  }

  function undo() {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    paint();
    run();
  }

  function clear() {
    strokesRef.current = [];
    setStrokeCount(0);
    setCandidates([]);
    paint();
  }

  function pick(char) {
    onInsert(char);
    clear();
  }

  const busy = status !== 'ready';

  return (
    <div className="hw-main">
      {/* 후보. 좁은 화면에서는 캔버스 위에서 가로로 넘깁니다. */}
      <div className="hw-cands">
        {candidates.length > 0 ? (
          candidates.map((char) => (
            <button key={char} className="hw-cand" onClick={() => pick(char)}>
              {char}
            </button>
          ))
        ) : (
          <p className="hw-note hw-cands-empty">
            {busy
              ? (status === 'loading' ? '인식기를 불러오는 중…' : error)
              : strokeCount === 0
                ? '한자를 그리면 닮은 글자가 여기에 뜹니다.'
                : '닮은 글자를 찾지 못했습니다. 조금 더 또렷하게 그어보세요.'}
          </p>
        )}
      </div>

      <div className="hw-pad">
        <canvas
          ref={canvasRef}
          className="hw-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
          aria-label="한자를 그리는 곳"
        />
        {busy && <div className="hw-veil">{status === 'loading' ? '불러오는 중…' : '불러오지 못했습니다'}</div>}
        {!busy && strokeCount === 0 && <div className="hw-veil hw-veil-hint">여기에 그리세요</div>}
      </div>

      <div className="hw-tools">
        <button className="btn" onClick={undo} disabled={strokeCount === 0}>1획 지우기</button>
        <button className="btn" onClick={clear} disabled={strokeCount === 0}>전부 지우기</button>
        <span className="hw-note hw-count">{strokeCount > 0 ? `${strokeCount}획` : ''}</span>
        <span className="hw-note hw-credit">
          <a href="https://github.com/asdfjkl/kanjicanvas" target="_blank" rel="noreferrer">KanjiCanvas</a> (MIT)
        </span>
      </div>
    </div>
  );
}

// ── 가나 ────────────────────────────────────────────────

function Kana({ onInsert }) {
  const [value, setValue] = useState('');
  const [katakana, setKatakana] = useState(false);
  const inputRef = useRef(null);

  function onChange(e) {
    setValue(toKana(e.target.value, { katakana }));
  }

  function switchKind(next) {
    setKatakana(next);
    setValue((v) => (next ? toKatakana(v) : toHiragana(v)));
    inputRef.current?.focus();
  }

  function insert() {
    const text = toKana(value, { katakana, flush: true });
    if (!text) return;
    onInsert(text);
    setValue('');
    inputRef.current?.focus();
  }

  return (
    <div className="hw-kana">
      <div className="hw-kana-row">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={onChange}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insert(); } }}
          placeholder={katakana ? 'ko-hi- → コーヒー' : 'nihongo → にほんご'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="로마자 입력"
        />
        <button className="btn btn-primary" onClick={insert} disabled={!value.trim()}>넣기</button>
      </div>

      <div className="hw-kana-row">
        <div className="hw-tabs">
          <button className="hw-tab" aria-current={!katakana} onClick={() => switchKind(false)}>ひらがな</button>
          <button className="hw-tab" aria-current={katakana} onClick={() => switchKind(true)}>カタカナ</button>
        </div>
        <span style={{ flex: 1 }} />
        <span className="hw-note">로마자를 치면 가나가 됩니다</span>
      </div>
    </div>
  );
}
