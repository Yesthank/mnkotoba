import { useCallback, useEffect, useRef, useState } from 'react';
import { loadEngine, suggest, isReady } from '../lib/handwriting';
import { toKana, toKatakana, toHiragana } from '../lib/romaji';

// 일본어 자판이 없는 기기에서 글자를 넣는 두 가지 길.
//   필기 — 한자를 그려서 고릅니다. 인식기가 한자 2213자만 알고 가나는 모릅니다.
//   가나 — 로마자를 치면 가나가 됩니다. saikou → さいこう
//
// 그리기는 여기서 직접 합니다. 라이브러리의 캔버스 초기화를 쓰면 패널을 여닫을 때마다
// 리스너가 겹쳐 획이 두 번 기록되고, 화면 배율 보정도 없습니다.

const MAX_STROKES = 40;

export default function Handwriting({ onInsert, onClose }) {
  const [mode, setMode] = useState('draw');
  return (
    <div className="hw">
      <div className="hw-head">
        <div className="hw-tabs">
          <button className="hw-tab" aria-current={mode === 'draw'} onClick={() => setMode('draw')}>
            필기
          </button>
          <button className="hw-tab" aria-current={mode === 'kana'} onClick={() => setMode('kana')}>
            가나
          </button>
        </div>
        <button className="btn-quiet" onClick={onClose}>닫기</button>
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
    sizeRef.current = size;
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

  function onPointerDown(e) {
    if (status !== 'ready' || strokesRef.current.length >= MAX_STROKES) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    strokesRef.current.push([pointOf(e)]);
    setStrokeCount(strokesRef.current.length);
    paint();
  }

  function onPointerMove(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
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

  return (
    <>
      <div className="hw-body">
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
          {status !== 'ready' && (
            <div className="hw-veil">
              {status === 'loading' ? '인식기를 불러오는 중…' : error}
            </div>
          )}
          {status === 'ready' && strokeCount === 0 && (
            <div className="hw-veil hw-veil-hint">여기에 한자를 그리세요</div>
          )}
        </div>

        <div className="hw-side">
          <div className="hw-cands">
            {candidates.length > 0
              ? candidates.map((char) => (
                  <button key={char} className="hw-cand" onClick={() => pick(char)}>
                    {char}
                  </button>
                ))
              : (
                <p className="hw-note">
                  {strokeCount === 0
                    ? '획을 그으면 닮은 글자가 여기에 뜹니다.'
                    : '닮은 글자를 찾지 못했습니다. 획을 조금 더 또렷하게 그어보세요.'}
                </p>
              )}
          </div>
        </div>
      </div>

      <div className="hw-bar">
        <span className="hw-note">
          {strokeCount > 0 ? `${strokeCount}획` : '가나는 위쪽 가나 탭에서 넣습니다'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={undo} disabled={strokeCount === 0}>1획 지우기</button>
        <button className="btn" onClick={clear} disabled={strokeCount === 0}>전부 지우기</button>
      </div>

      <p className="hw-credit">
        한자 인식{' '}
        <a href="https://github.com/asdfjkl/kanjicanvas" target="_blank" rel="noreferrer">
          KanjiCanvas
        </a>{' '}
        (MIT)
      </p>
    </>
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
      <div className="hw-bar" style={{ marginTop: 0 }}>
        <span className="hw-note">로마자를 치면 가나가 됩니다. saikou → さいこう</span>
        <span style={{ flex: 1 }} />
        <div className="hw-tabs">
          <button className="hw-tab" aria-current={!katakana} onClick={() => switchKind(false)}>
            ひらがな
          </button>
          <button className="hw-tab" aria-current={katakana} onClick={() => switchKind(true)}>
            カタカナ
          </button>
        </div>
      </div>

      <div className="hw-bar">
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
          style={{ flex: 1, minWidth: 0 }}
          aria-label="로마자 입력"
        />
        <button className="btn btn-primary" onClick={insert} disabled={!value.trim()}>
          넣기
        </button>
      </div>
    </div>
  );
}
