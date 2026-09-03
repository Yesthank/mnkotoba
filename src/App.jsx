import { useEffect, useMemo, useRef, useState } from 'react';
import { watchAuth, signIn, signOut } from './lib/firebase';
import {
  watchDecks, watchCards, createDeck, renameDeck, deleteDeck, reorderDecks,
  addCard, updateCard, deleteCards, moveCards,
} from './lib/store';
import { toJsonBackup, download } from './lib/export';
import { dueCount } from './lib/srs';
import Analyzer from './components/Analyzer';
import DeckRail from './components/DeckRail';
import CardList from './components/CardList';
import Review from './components/Review';

const TABS = [
  { id: 'read', label: '읽기' },
  { id: 'list', label: '단어장' },
  { id: 'review', label: '복습' },
];

export default function App() {
  const [user, setUser] = useState(undefined);
  const [decks, setDecks] = useState([]);
  const [cards, setCards] = useState([]);
  const [activeDeckId, setActiveDeckId] = useState('__all__');
  const [tab, setTab] = useState('read');
  const [railOpen, setRailOpen] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => watchAuth(setUser), []);

  useEffect(() => {
    if (!user) return;
    const a = watchDecks(user.uid, setDecks);
    const b = watchCards(user.uid, setCards);
    return () => { a(); b(); };
  }, [user]);

  // 첫 로그인이면 기본 단어장 하나를 만들어 줍니다. 빈 화면부터 시작하지 않도록.
  // ref로 잠그지 않으면 목록 갱신이 오기 전에 두 번 실행돼 "기본"이 두 개 생깁니다.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (decks.length > 0) { seededRef.current = true; return; }
    if (seededRef.current) return;
    seededRef.current = true;
    createDeck(user.uid, '기본', 0).catch(() => { seededRef.current = false; });
  }, [user, decks.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const visibleCards = useMemo(
    () => (activeDeckId === '__all__' ? cards : cards.filter((c) => c.deckId === activeDeckId)),
    [cards, activeDeckId],
  );

  // 이미 담은 항목엔 원문에서 바로 표시가 뜨도록.
  const savedKeys = useMemo(
    () => new Set(cards.map((c) => `${c.lemma}|${c.pos}`)),
    [cards],
  );

  const due = dueCount(visibleCards);

  if (user === undefined) return <div className="loading">불러오는 중…</div>;

  if (user === null) {
    return (
      <div className="gate">
        <div>
          <div className="gate-jp">言葉</div>
          <h1 className="wordmark">코토바 노트</h1>
          <p style={{ marginTop: 14 }}>
            일본어를 붙여넣으면 통째로 풀어 읽고, 밑줄 그은 단어를 눌러 내 단어장에 담습니다.
          </p>
          <button className="btn btn-primary" onClick={signIn}>구글 계정으로 시작하기</button>
        </div>
      </div>
    );
  }

  const wrap = (fn) => async (...args) => {
    try { return await fn(...args); }
    catch (e) { setToast(e.message || '작업에 실패했습니다.'); }
  };

  const handleSave = wrap(async (card) => {
    await addCard(user.uid, card);
    setToast(`${card.surface} 담았습니다.`);
  });

  const handleCreateDeck = wrap(async () => {
    const name = prompt('새 단어장 이름');
    if (name === null) return;
    const id = await createDeck(user.uid, name, decks.length);
    setActiveDeckId(id);
  });

  const handleDeleteDeck = wrap(async (id) => {
    const deck = decks.find((d) => d.id === id);
    const n = cards.filter((c) => c.deckId === id).length;
    const others = decks.filter((d) => d.id !== id);
    if (!confirm(`"${deck.name}" 단어장을 지웁니다. 안에 든 ${n}개 카드는 어떻게 할까요?\n\n확인 = 카드도 함께 삭제\n취소 = 그만두기`)) return;
    await deleteDeck(user.uid, id, { moveTo: null });
    setActiveDeckId(others[0]?.id || '__all__');
    setToast('단어장을 지웠습니다.');
  });

  const exportAll = () => {
    download(`kotoba-backup-${new Date().toISOString().slice(0, 10)}.json`, toJsonBackup(decks, cards), 'application/json');
    setToast('전체 백업을 내려받았습니다.');
  };

  return (
    <div className="app">
      <main className="main">
        <div className="wrap">
          <header className="masthead">
            <h1 className="wordmark">코토바 <span>노트</span></h1>
            <div className="masthead-meta">
              <DesktopTabs tab={tab} setTab={setTab} due={due} />
              <button className="btn-quiet" onClick={signOut}>나가기</button>
            </div>
          </header>

          {tab === 'read' && (
            <Analyzer
              decks={decks}
              activeDeckId={activeDeckId === '__all__' ? decks[0]?.id : activeDeckId}
              savedKeys={savedKeys}
              onSave={handleSave}
              onToast={setToast}
            />
          )}

          {tab === 'list' && (
            <CardList
              cards={visibleCards}
              decks={decks}
              activeDeckId={activeDeckId}
              onMove={wrap((ids, deckId) => moveCards(user.uid, ids, deckId))}
              onDelete={wrap((ids) => deleteCards(user.uid, ids))}
              onUpdate={wrap((id, patch) => updateCard(user.uid, id, patch))}
              onToast={setToast}
            />
          )}

          {tab === 'review' && (
            <Review
              cards={visibleCards}
              onUpdate={wrap((id, patch) => updateCard(user.uid, id, patch))}
              onDone={() => setTab('list')}
            />
          )}
        </div>
      </main>

      {railOpen && <div className="scrim" onClick={() => setRailOpen(false)} />}
      <aside className={`rail ${railOpen ? 'open' : ''}`}>
        <DeckRail
          decks={decks}
          cards={cards}
          activeDeckId={activeDeckId}
          onSelect={(id) => { setActiveDeckId(id); setRailOpen(false); }}
          onCreate={handleCreateDeck}
          onRename={wrap((id, name) => renameDeck(user.uid, id, name))}
          onDelete={handleDeleteDeck}
          onReorder={wrap((ordered) => reorderDecks(user.uid, ordered))}
          onExportAll={exportAll}
        />
      </aside>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}{t.id === 'review' && due > 0 ? ` ${due}` : ''}
          </button>
        ))}
        <button onClick={() => setRailOpen(true)}>단어장 목록</button>
      </nav>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function DesktopTabs({ tab, setTab, due }) {
  return (
    <span style={{ display: 'flex', gap: 2 }} className="desktop-tabs">
      {TABS.map((t) => (
        <button
          key={t.id}
          className="btn-quiet"
          style={{
            color: tab === t.id ? 'var(--sumi)' : 'var(--sumi-3)',
            fontWeight: tab === t.id ? 600 : 400,
          }}
          onClick={() => setTab(t.id)}
        >
          {t.label}
          {t.id === 'review' && due > 0 && <span className="deck-due" style={{ marginLeft: 5 }}>{due}</span>}
        </button>
      ))}
    </span>
  );
}