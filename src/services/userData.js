import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { auth, db, firebaseReady } from './firebase.js';

const HISTORY_KEY = 'cs_watch_history';
const LIST_KEYS = {
  favorites: 'cs_favorites',
  watchlist: 'cs_watchlist',
};

let activeUser = null;
const authListeners = new Set();

export function getCurrentUser() {
  return activeUser;
}

export function onUserChange(callback) {
  authListeners.add(callback);
  callback(activeUser);
  return () => authListeners.delete(callback);
}

export function initUserSession() {
  if (!firebaseReady || !auth) {
    notify();
    return;
  }

  onAuthStateChanged(auth, async user => {
    activeUser = user;
    if (user) await hydrateUserData(user.uid);
    notify();
  });
}

export async function registerAccount(email, password, displayName = '') {
  ensureFirebase();
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName.trim()) {
    await updateProfile(credential.user, { displayName: displayName.trim() });
  }
  return credential.user;
}

export async function loginAccount(email, password) {
  ensureFirebase();
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logoutAccount() {
  ensureFirebase();
  await signOut(auth);
}

export function getHistory() {
  return readJson(HISTORY_KEY, []);
}

export async function saveHistoryEntry(entry) {
  const next = getHistory().filter(item => item.id !== entry.id || item.type !== entry.type);
  next.unshift(entry);
  writeJson(HISTORY_KEY, next.slice(0, 40));

  if (activeUser && db) {
    await setDoc(userDoc('history', listId(entry)), {
      ...entry,
      updatedAt: serverTimestamp(),
    });
  }
}

export async function removeHistoryEntry(id, type) {
  const next = getHistory().filter(item => String(item.id) !== String(id) || item.type !== type);
  writeJson(HISTORY_KEY, next);
  localStorage.removeItem(progressKey(type, id));

  if (activeUser && db) {
    await deleteDoc(userDoc('history', `${type}_${id}`));
    await deleteDoc(userDoc('progress', `${type}_${id}`));
  }
}

export function getProgress(type, id, season, episode) {
  return readJson(progressKey(type, id, season, episode), null);
}

export async function saveProgressEntry(entry, season, episode) {
  const key = progressKey(entry.type, entry.id, season, episode);
  writeJson(key, entry);

  if (entry.type === 'tv' && season && episode) {
    writeJson(progressKey(entry.type, entry.id), entry);
  }

  if (activeUser && db) {
    await setDoc(userDoc('progress', key.replace('cs_progress_', '')), {
      ...entry,
      updatedAt: serverTimestamp(),
    });
    if (entry.type === 'tv' && season && episode) {
      await setDoc(userDoc('progress', `${entry.type}_${entry.id}`), {
        ...entry,
        updatedAt: serverTimestamp(),
      });
    }
  }
}

export function getList(listName) {
  return readJson(LIST_KEYS[listName], []);
}

export function isInList(listName, id, type) {
  return getList(listName).some(item => String(item.id) === String(id) && item.type === type);
}

export async function toggleListItem(listName, item) {
  const storageKey = LIST_KEYS[listName];
  if (!storageKey) throw new Error(`Unknown list: ${listName}`);

  const exists = isInList(listName, item.id, item.type);
  const next = exists
    ? getList(listName).filter(saved => String(saved.id) !== String(item.id) || saved.type !== item.type)
    : [{ ...item, savedAt: Date.now() }, ...getList(listName)];

  writeJson(storageKey, next);

  if (activeUser && db) {
    const ref = userDoc(listName, listId(item));
    if (exists) await deleteDoc(ref);
    else await setDoc(ref, { ...item, savedAt: Date.now(), updatedAt: serverTimestamp() });
  }

  return !exists;
}

async function hydrateUserData(uid) {
  if (!db) return;
  await Promise.all([
    hydrateCollection(uid, 'history', HISTORY_KEY),
    hydrateCollection(uid, 'favorites', LIST_KEYS.favorites),
    hydrateCollection(uid, 'watchlist', LIST_KEYS.watchlist),
    hydrateProgress(uid),
  ]);
}

async function hydrateCollection(uid, name, storageKey) {
  const snapshot = await getDocs(collection(db, 'users', uid, name));
  const remote = snapshot.docs.map(item => item.data());
  if (remote.length) writeJson(storageKey, mergeByTitle(remote, readJson(storageKey, [])));
}

async function hydrateProgress(uid) {
  const snapshot = await getDocs(collection(db, 'users', uid, 'progress'));
  snapshot.docs.forEach(item => writeJson(`cs_progress_${item.id}`, item.data()));
}

function mergeByTitle(remote, local) {
  const seen = new Set();
  return [...remote, ...local]
    .filter(item => {
      const key = listId(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

function notify() {
  authListeners.forEach(callback => callback(activeUser));
}

function ensureFirebase() {
  if (!firebaseReady || !auth) {
    throw new Error('Firebase env vars are missing. Add VITE_FIREBASE_* values to your .env file.');
  }
}

function userDoc(name, id) {
  return doc(db, 'users', activeUser.uid, name, id);
}

function listId(item) {
  return `${item.type}_${item.id}`;
}

function progressKey(type, id, season, episode) {
  return type === 'tv' && season && episode
    ? `cs_progress_${type}_${id}_s${season}e${episode}`
    : `cs_progress_${type}_${id}`;
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
