import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { freshSrs } from './srs';

// users/{uid}/decks/{deckId}
// users/{uid}/cards/{cardId}  ← deckId를 필드로 둡니다.
//
// 카드를 덱 하위에 중첩하지 않고 평평하게 둔 이유: 덱 이동이 필드 하나 수정으로 끝나고,
// "전체 단어장에서 검색"과 "오늘 복습할 카드 전부"를 한 번의 쿼리로 뽑을 수 있습니다.

const decksRef = (uid) => collection(db, 'users', uid, 'decks');
const cardsRef = (uid) => collection(db, 'users', uid, 'cards');

export function watchDecks(uid, cb) {
  return onSnapshot(query(decksRef(uid), orderBy('order')), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

export function watchCards(uid, cb) {
  return onSnapshot(query(cardsRef(uid), orderBy('createdAt', 'desc')), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

export async function createDeck(uid, name, order = Date.now()) {
  const ref = await addDoc(decksRef(uid), {
    name: name.trim() || '새 단어장',
    order,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export const renameDeck = (uid, deckId, name) =>
  updateDoc(doc(db, 'users', uid, 'decks', deckId), { name: name.trim() });

export const reorderDecks = (uid, ordered) => {
  const batch = writeBatch(db);
  ordered.forEach((d, i) => batch.update(doc(db, 'users', uid, 'decks', d.id), { order: i }));
  return batch.commit();
};

// 덱을 지울 때 카드를 같이 지울지, 다른 덱으로 옮길지 고르게 합니다.
export async function deleteDeck(uid, deckId, { moveTo = null } = {}) {
  const snap = await getDocs(query(cardsRef(uid), where('deckId', '==', deckId)));
  const batch = writeBatch(db);
  snap.docs.forEach((d) =>
    moveTo ? batch.update(d.ref, { deckId: moveTo }) : batch.delete(d.ref),
  );
  batch.delete(doc(db, 'users', uid, 'decks', deckId));
  return batch.commit();
}

export function addCard(uid, card) {
  const id = doc(cardsRef(uid)).id;
  return setDoc(doc(db, 'users', uid, 'cards', id), {
    type: 'word',
    surface: '',
    reading: '',
    lemma: '',
    meaning: '',
    pos: 'other',
    note: '',
    jlpt: 'unknown',
    context: '',
    contextTranslation: '',
    starred: false,
    srs: freshSrs(),
    createdAt: serverTimestamp(),
    ...card,
  }).then(() => id);
}

export const updateCard = (uid, cardId, patch) =>
  updateDoc(doc(db, 'users', uid, 'cards', cardId), patch);

export const deleteCard = (uid, cardId) => deleteDoc(doc(db, 'users', uid, 'cards', cardId));

export function moveCards(uid, cardIds, deckId) {
  const batch = writeBatch(db);
  cardIds.forEach((id) => batch.update(doc(db, 'users', uid, 'cards', id), { deckId }));
  return batch.commit();
}

export function deleteCards(uid, cardIds) {
  const batch = writeBatch(db);
  cardIds.forEach((id) => batch.delete(doc(db, 'users', uid, 'cards', id)));
  return batch.commit();
}

// Firestore 배치는 한 번에 500개까지라 400개씩 끊어 씁니다.
const CHUNK = 400;

function cardDoc(card) {
  return {
    type: 'word', surface: '', reading: '', lemma: '', meaning: '', pos: 'other', note: '',
    jlpt: 'unknown', context: '', contextTranslation: '', starred: false,
    srs: freshSrs(), createdAt: serverTimestamp(),
    ...card,
  };
}

/** 파일에서 읽은 카드를 한 단어장에 넣습니다. 담은 순서가 유지되도록 createdAt 을 1ms씩 띄웁니다. */
export async function importCards(uid, deckId, cards, onProgress) {
  const base = Date.now() - cards.length;
  for (let i = 0; i < cards.length; i += CHUNK) {
    const batch = writeBatch(db);
    cards.slice(i, i + CHUNK).forEach((c, j) => {
      const { id: _ignored, ...rest } = c;
      batch.set(doc(cardsRef(uid)), cardDoc({ ...rest, deckId, createdAt: new Date(base + i + j) }));
    });
    await batch.commit();
    onProgress?.(Math.min(cards.length, i + CHUNK), cards.length);
  }
}

/** JSON 백업 복원. 단어장은 이름이 같으면 재사용하고, 카드는 새 문서로 넣습니다(진도 포함). */
export async function restoreBackup(uid, existingDecks, decks, cards, onProgress) {
  const idMap = new Map();
  let order = existingDecks.length;
  for (const d of decks) {
    const found = existingDecks.find((e) => e.name === d.name);
    idMap.set(d.id, found ? found.id : await createDeck(uid, d.name, order++));
  }
  let fallback = null;
  const grouped = new Map();
  for (const c of cards) {
    let deckId = idMap.get(c.deckId);
    if (!deckId) {
      fallback ||= existingDecks[0]?.id || (await createDeck(uid, '가져온 단어장', order++));
      deckId = fallback;
    }
    if (!grouped.has(deckId)) grouped.set(deckId, []);
    grouped.get(deckId).push(c);
  }
  let done = 0;
  for (const [deckId, list] of grouped) {
    await importCards(uid, deckId, list.map((c) => {
      const { deckId: _d, createdAt: _c, ...rest } = c;
      return rest;
    }), (n) => onProgress?.(done + n, cards.length));
    done += list.length;
  }
}
