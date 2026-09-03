import { useState } from 'react';
import { dueCount } from '../lib/srs';

export default function DeckRail({
  decks, cards, activeDeckId, onSelect, onCreate, onRename, onDelete, onReorder, onExportAll,
}) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [dragId, setDragId] = useState(null);

  const countOf = (id) => cards.filter((c) => c.deckId === id).length;
  const dueOf = (id) => dueCount(cards.filter((c) => c.deckId === id));

  function commit(id) {
    if (draft.trim()) onRename(id, draft);
    setEditing(null);
  }

  function drop(targetId) {
    if (!dragId || dragId === targetId) return;
    const next = [...decks];
    const from = next.findIndex((d) => d.id === dragId);
    const to = next.findIndex((d) => d.id === targetId);
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorder(next);
    setDragId(null);
  }

  return (
    <>
      <div className="rail-head">
        <span>단어장</span>
        <button className="btn-quiet" onClick={onCreate}>+ 새로 만들기</button>
      </div>

      <button
        className="deck"
        aria-current={activeDeckId === '__all__'}
        onClick={() => onSelect('__all__')}
      >
        <span className="deck-name">전체</span>
        <span className="deck-count">{cards.length}</span>
      </button>

      {decks.map((d) => (
        <div
          key={d.id}
          draggable={editing !== d.id}
          onDragStart={() => setDragId(d.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(d.id)}
          style={{ opacity: dragId === d.id ? 0.4 : 1 }}
        >
          {editing === d.id ? (
            <input
              type="text"
              autoFocus
              value={draft}
              style={{ width: '100%' }}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(d.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(d.id);
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <button
              className="deck"
              aria-current={activeDeckId === d.id}
              onClick={() => onSelect(d.id)}
              onDoubleClick={() => { setEditing(d.id); setDraft(d.name); }}
            >
              <span className="deck-name">{d.name}</span>
              {dueOf(d.id) > 0 && <span className="deck-due">{dueOf(d.id)}</span>}
              <span className="deck-count">{countOf(d.id)}</span>
            </button>
          )}
        </div>
      ))}

      {decks.length > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--sumi-3)', marginTop: 10, lineHeight: 1.5 }}>
          이름을 두 번 누르면 바꿀 수 있고, 끌어서 순서를 바꿉니다.
        </p>
      )}

      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
        <div className="rail-head"><span>보관</span></div>
        <button className="btn" style={{ width: '100%' }} onClick={onExportAll}>
          전체 백업 내려받기
        </button>
        {activeDeckId !== '__all__' && (
          <button
            className="btn btn-danger"
            style={{ width: '100%', marginTop: 6 }}
            onClick={() => onDelete(activeDeckId)}
          >
            현재 단어장 삭제
          </button>
        )}
      </div>
    </>
  );
}
