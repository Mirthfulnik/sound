// ── sync.js ───────────────────────────────────────────────────
// Синхронизация лайков с Cloudflare KV.
// Стратегия: last-write-wins по timestamp.
// Push всегда немедленный при изменении (debounce 1.5s).

import { Auth } from './auth.js';

const SYNC_URL    = 'https://silent-boat-5c96.chatgptnik.workers.dev';
const DEBOUNCE_MS = 1500;
const timers      = {};

export const Sync = {

  // Загрузить лайки с KV при старте
  async pull() {
    if (!Auth.isLoggedIn()) return null;
    try {
      const liked   = await apiFetch('GET', '/sync/liked');
      const offline = await apiFetch('GET', '/sync/offline').catch(() => ({ data: [] }));
      return {
        liked:   liked?.data   || [],
        offline: offline?.data || [],
      };
    } catch (e) {
      console.warn('[sync] pull failed:', e.message);
      return null;
    }
  },

  // Немедленно сохранить лайки (с debounce чтобы не слать на каждый клик)
  pushLiked(tracks) {
    if (!Auth.isLoggedIn()) return;
    debounce('liked', () => {
      apiFetch('POST', '/sync/liked', tracks)
        .then(() => console.log('[sync] pushed', tracks.length, 'liked'))
        .catch(e => console.warn('[sync] pushLiked failed:', e.message));
    });
  },

  // Сохранить метаданные офлайн-треков
  pushOffline(tracks) {
    if (!Auth.isLoggedIn()) return;
    const meta = tracks.map(({ url, title, artist, duration, durationSec, genre }) =>
      ({ url, title, artist, duration, durationSec, genre })
    );
    debounce('offline', () => {
      apiFetch('POST', '/sync/offline', meta).catch(() => {});
    });
  },
};

// ── Внутренние утилиты ────────────────────────────────────────
async function apiFetch(method, path, body) {
  const token = Auth.token;
  if (!token) return null;

  const res = await fetch(SYNC_URL + path, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function debounce(key, fn) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, DEBOUNCE_MS);
}
