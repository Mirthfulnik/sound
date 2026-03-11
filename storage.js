// ── storage.js ────────────────────────────────────────────────
// Single module for ALL LocalStorage operations.
// Schema:
//   ss_liked:         Track[]
//   ss_playlists:     { [name]: Track[] }
//   ss_wave_settings: WaveSettings
//   ss_history:       string[]  (played track URLs, last 200)
//
// Track shape: { url, artist, title, duration, genre?, likedAt? }
// WaveSettings: { genre, mood, skipPlayed }

const KEYS = {
  LIKED:     'ss_liked',
  PLAYLISTS: 'ss_playlists',
  WAVE:      'ss_wave_settings',
  HISTORY:   'ss_history',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[storage] write failed:', key, e);
    return false;
  }
}

// ── Liked tracks ──────────────────────────────────────────────
export const Liked = {
  getAll() {
    return read(KEYS.LIKED, []);
  },

  add(track) {
    const all = this.getAll();
    if (all.find(t => t.url === track.url)) return false; // already liked
    all.unshift({ ...track, likedAt: Date.now() });
    write(KEYS.LIKED, all);
    return true;
  },

  remove(url) {
    const all = this.getAll().filter(t => t.url !== url);
    write(KEYS.LIKED, all);
  },

  isLiked(url) {
    return this.getAll().some(t => t.url === url);
  },

  toggle(track) {
    if (this.isLiked(track.url)) {
      this.remove(track.url);
      return false;
    } else {
      this.add(track);
      return true;
    }
  },
};

// ── Playlists ─────────────────────────────────────────────────
export const Playlists = {
  getAll() {
    return read(KEYS.PLAYLISTS, {});
  },

  get(name) {
    return this.getAll()[name] || [];
  },

  create(name) {
    const all = this.getAll();
    if (all[name]) return false; // already exists
    all[name] = [];
    write(KEYS.PLAYLISTS, all);
    return true;
  },

  addTrack(name, track) {
    const all = this.getAll();
    if (!all[name]) all[name] = [];
    if (all[name].find(t => t.url === track.url)) return false;
    all[name].push(track);
    write(KEYS.PLAYLISTS, all);
    return true;
  },

  removeTrack(name, url) {
    const all = this.getAll();
    if (!all[name]) return;
    all[name] = all[name].filter(t => t.url !== url);
    write(KEYS.PLAYLISTS, all);
  },

  delete(name) {
    const all = this.getAll();
    delete all[name];
    write(KEYS.PLAYLISTS, all);
  },

  names() {
    return Object.keys(this.getAll());
  },
};

// ── Wave settings ─────────────────────────────────────────────
export const WaveSettings = {
  defaults: {
    genre: '',          // '' = all genres
    mood: 'all',        // 'all' | 'energetic' | 'calm'
    skipPlayed: false,  // skip recently played tracks
  },

  get() {
    return { ...this.defaults, ...read(KEYS.WAVE, {}) };
  },

  save(settings) {
    write(KEYS.WAVE, { ...this.get(), ...settings });
  },
};

// ── Play history (for "skip played" in Wave) ──────────────────
export const History = {
  MAX: 200,

  getAll() {
    return read(KEYS.HISTORY, []);
  },

  add(url) {
    const all = this.getAll();
    const filtered = all.filter(u => u !== url);
    filtered.unshift(url);
    write(KEYS.HISTORY, filtered.slice(0, this.MAX));
  },

  has(url) {
    return this.getAll().includes(url);
  },

  clear() {
    write(KEYS.HISTORY, []);
  },
};

// ── Offline downloads (IndexedDB) ─────────────────────────────
// Stores full track blobs for offline playback.
// Schema: { url, artist, title, duration, durationSec, genre, blob, savedAt }

const DB_NAME    = 'ss_offline';
const DB_VERSION = 1;
const STORE      = 'tracks';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

export const Offline = {
  async save(track, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readwrite');
      const st  = tx.objectStore(STORE);
      const req = st.put({ ...track, blob, savedAt: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror   = e => reject(e.target.error);
    });
  },

  async remove(url) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).delete(url);
      req.onsuccess = () => resolve(true);
      req.onerror   = e => reject(e.target.error);
    });
  },

  async get(url) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  },

  async getAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  },

  async has(url) {
    const entry = await this.get(url);
    return entry !== null;
  },

  async getAllUrls() {
    const all = await this.getAll();
    return new Set(all.map(t => t.url));
  },
};
