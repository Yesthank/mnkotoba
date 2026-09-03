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
