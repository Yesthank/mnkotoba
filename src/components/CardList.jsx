import { useMemo, useState } from 'react';
import { speak, canSpeak } from '../lib/speech';
import { toAnkiTsv, toPlainText, download, safeName } from '../lib/export';
import { isDue } from '../lib/srs';

export default function CardList({
  cards, decks, activeDeckId, onMove, onDelete, onUpdate, onToast,
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [filter, setFilter] = useState('all'); // all | due | starred | grammar

  const deckName = activeDeckId === '__all__'
    ? '전체'
    : decks.find((d) => d.id === activeDeckId)?.name || '단어장';

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter === 'due' && !isDue(c)) return false;
      if (filter === 'starred' && !c.starred) return false;
      if (filter === 'grammar' && c.type !== 'grammar') return false;
      if (!needle) return true;
      return [c.surface, c.reading, c.meaning, c.lemma, c.context]
        .join(' ').toLowerCase().includes(needle);
    });
  }, [cards, q, filter]);

  const target = sel.size ? shown.filter((c) => sel.has(c.id)) : shown;

  function toggle(id) {
    setSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function exportAs(kind) {
    if (!target.length) return onToast('내보낼 카드가 없습니다.');
    const base = safeName(deckName);
    if (kind === 'anki') {
      download(`${base}_anki.txt`, toAnkiTsv(target, { deckName: `일본어::${deckName}` }), 'text/tab-separated-values;charset=utf-8');
      onToast(`${target.length}개를 Anki 형식으로 내보냈습니다.`);
    } else {
      download(`${base}.txt`, toPlainText(target, deckName));
      onToast(`${target.length}개를 텍스트로 내보냈습니다.`);
    }
  }

  return (
    <>
      <div className="list-head">
        <h2 className="list-title">{deckName}</h2>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="단어·뜻·예문 검색"
          style={{ width: 180 }}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">전부</option>
          <option value="due">오늘 볼 것</option>
          <option value="starred">표시한 것</option>
          <option value="grammar">문법만</option>
        </select>
      </div>

      <div className="list-head" style={{ marginTop: -4 }}>
        <span style={{ fontSize: 12.5, color: 'var(--sumi-3)' }}>
          {sel.size ? `${sel.size}개 선택함` : `${shown.length}개`}
        </span>
        {sel.size > 0 && (
          <>
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                onMove([...sel], e.target.value);
                onToast(`${sel.size}개를 옮겼습니다.`);
                setSel(new Set());
              }}
            >
              <option value="">옮길 단어장 고르기</option>
              {decks.filter((d) => d.id !== activeDeckId).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button className="btn btn-danger" onClick={() => {
              onDelete([...sel]);
              onToast(`${sel.size}개를 지웠습니다.`);
              setSel(new Set());
            }}>
              지우기
            </button>
            <button className="btn-quiet" onClick={() => setSel(new Set())}>선택 해제</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => exportAs('anki')}>Anki로 내보내기</button>
        <button className="btn" onClick={() => exportAs('txt')}>txt로 내보내기</button>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <strong>{q || filter !== 'all' ? '조건에 맞는 카드가 없습니다.' : '아직 담은 항목이 없습니다.'}</strong>
          {!q && filter === 'all' && '위쪽 입력창에 일본어를 넣고, 밑줄 그어진 단어를 눌러 담아보세요.'}
        </div>
      ) : (
        shown.map((c) => (
          <div className="card" key={c.id}>
            <input
              type="checkbox"
              checked={sel.has(c.id)}
              onChange={() => toggle(c.id)}
              style={{ marginTop: 6 }}
              aria-label={`${c.surface} 선택`}
            />
            <div className="card-body">
              <div className="card-jp">
                {c.surface}
                {c.reading && c.reading !== c.surface && (
                  <span style={{ fontSize: 13, color: 'var(--sumi-3)', marginLeft: 8 }}>{c.reading}</span>
                )}
                {isDue(c) && <span className="deck-due" style={{ marginLeft: 8 }}>복습</span>}
              </div>
              <div className="card-meaning">{c.meaning}</div>
              {c.note && <div className="card-note">{c.note}</div>}
              {c.context && <div className="card-note" style={{ fontFamily: 'var(--serif-jp)' }}>{c.context}</div>}
            </div>
            <div className="card-actions">
              <button
                className="btn-quiet"
                onClick={() => onUpdate(c.id, { starred: !c.starred })}
                aria-label="표시"
              >
                {c.starred ? '★' : '☆'}
              </button>
              {canSpeak() && (
                <button className="btn-quiet" onClick={() => speak(c.surface)} aria-label="발음 듣기">🔊</button>
              )}
              <button className="btn-quiet btn-danger" onClick={() => onDelete([c.id])} aria-label="지우기">×</button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
