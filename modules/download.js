// ── download.js ───────────────────────────────────────────────
import { fetchPage, parseMp3 } from './parser.js';
import { Offline } from './storage.js';

const PROXIES = [
  'https://functions.yandexcloud.net/d4ebfvpcafvdghfva6fs?url=',
  'https://silent-boat-5c96.chatgptnik.workers.dev/?url=',
];

const active = new Map();

export const Download = {
  isDownloading(url) { return active.has(url); },

  async start(track, { onProgress, onDone, onError } = {}) {
    if (active.has(track.url)) return;

    const ctrl = new AbortController();
    active.set(track.url, ctrl);

    try {
      // Шаг 1: получаем MP3 URL
      let mp3Url = track.mp3Url;
      if (!mp3Url) {
        onProgress?.({ phase: 'resolving', percent: 0 });
        const html = await fetchPage(track.url);
        mp3Url = parseMp3(html);
        if (!mp3Url) throw new Error('MP3-ссылка не найдена');
        track.mp3Url = mp3Url;
      }

      // Логируем домен для диагностики
      try {
        const mp3Host = new URL(mp3Url).hostname;
        console.log('[download] MP3 hostname:', mp3Host);
      } catch {}

      // Шаг 2: качаем бинарник
      onProgress?.({ phase: 'downloading', percent: 0 });
      const blob = await fetchBlobSafari(mp3Url, ctrl.signal, pct => {
        onProgress?.({ phase: 'downloading', percent: pct });
      });

      // Шаг 3: сохраняем
      onProgress?.({ phase: 'saving', percent: 100 });
      await Offline.save(track, blob);

      active.delete(track.url);
      onDone?.();
    } catch (e) {
      active.delete(track.url);
      if (e.name === 'AbortError') return;
      onError?.(e.message);
    }
  },

  cancel(url) {
    const ctrl = active.get(url);
    if (ctrl) { ctrl.abort(); active.delete(url); }
  },
};

// ── Умный fetch: прямой → прокси fallback ─────────────────────
// Сначала пробуем прямой fetch (работает в Яндекс, Chrome).
// Если CORS-ошибка (Safari/iOS) — идём через прокси.
async function fetchBlobSafari(mp3Url, signal, onPercent) {
  // Попытка 1: прямой fetch
  try {
    const blob = await fetchBlobDirect(mp3Url, signal, onPercent);
    console.log('[download] direct fetch OK');
    return blob;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    console.warn('[download] direct fetch failed, trying proxies:', e.message);
  }

  // Попытка 2: через каждый прокси
  let lastError;
  for (const proxy of PROXIES) {
    try {
      const proxyUrl = proxy + encodeURIComponent(mp3Url);
      console.log('[download] trying proxy:', proxy);
      const blob = await fetchBlobDirect(proxyUrl, signal, onPercent);
      console.log('[download] proxy OK:', proxy);
      return blob;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastError = e;
      console.warn('[download] proxy failed:', e.message);
    }
  }

  throw new Error('Не удалось скачать трек. ' + (lastError?.message || ''));
}

// ── Базовый fetch с прогрессом ─────────────────────────────────
async function fetchBlobDirect(url, signal, onPercent) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);

  // Прокси может вернуть JSON-ошибку
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    const txt = await res.text();
    throw new Error('Proxy error: ' + txt.slice(0, 100));
  }

  const contentLength = res.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onPercent(Math.round((received / total) * 100));
  }

  const all = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return new Blob([all], { type: 'audio/mpeg' });
}
