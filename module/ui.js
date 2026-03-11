// ── ui.js ─────────────────────────────────────────────────────
// Pure rendering functions. No business logic here.
// Every function takes data → returns/mutates DOM.

import { Liked, Offline } from './storage.js';
import { Player } from './player.js';

// ── Track card ────────────────────────────────────────────────
export async function renderTrackList(container, tracks, { onPlay, onLikeToggle, onDownload, onDelete, onShare } = {}) {
  container.innerHTML = '';

  if (!tracks.length) {
    container.innerHTML = emptyHTML('Треки не найдены');
    return;
  }

  // Preload offline state for all tracks in one pass
  const offlineUrls = await Offline.getAllUrls();

  tracks.forEach((track, i) => {
    const liked     = Liked.isLiked(track.url);
    const isCurrent = Player.currentTrack?.url === track.url;
    const isOffline = offlineUrls.has(track.url);

    const el = document.createElement('div');
    el.className = 'track-item' + (isCurrent ? ' playing' : '');
    el.dataset.url = track.url;
    el.innerHTML = `
      <div class="track-num">${i + 1}</div>
      <div class="track-play-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </div>
      <div class="track-info">
        <div class="track-name">${esc(track.title || '—')}</div>
        <div class="track-artist">${esc(track.artist || '—')}</div>
      </div>
      <div class="track-duration">${track.duration || ''}</div>
      <div class="track-actions">
        <button class="action-btn share-btn" data-url="${esc(track.url)}" title="Поделиться">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
        <button class="action-btn download-btn ${isOffline ? 'downloaded' : ''}" data-url="${esc(track.url)}" title="${isOffline ? 'Удалить загрузку' : 'Скачать'}">
          ${isOffline ? downloadedIconSVG() : downloadIconSVG()}
        </button>
        <button class="like-btn ${liked ? 'liked' : ''}" data-url="${esc(track.url)}" title="${liked ? 'Убрать из избранного' : 'В избранное'}">
          ${liked ? '♥' : '♡'}
        </button>
      </div>
    `;

    // Play on row click
    el.addEventListener('click', e => {
      if (e.target.closest('.track-actions')) return;
      onPlay?.(track, i);
    });

    // Like toggle
    el.querySelector('.like-btn').addEventListener('click', e => {
      e.stopPropagation();
      onLikeToggle?.(track, el.querySelector('.like-btn'));
    });

    // Share
    el.querySelector('.share-btn').addEventListener('click', e => {
      e.stopPropagation();
      onShare?.(track);
    });

    // Download / Delete
    el.querySelector('.download-btn').addEventListener('click', e => {
      e.stopPropagation();
      const btn = el.querySelector('.download-btn');
      if (btn.classList.contains('downloaded')) {
        onDelete?.(track, btn);
      } else {
        onDownload?.(track, btn);
      }
    });

    container.appendChild(el);
  });
}

// ── Update single like button (no full re-render) ─────────────
export function updateLikeButton(btn, isLiked) {
  btn.textContent = isLiked ? '♥' : '♡';
  btn.classList.toggle('liked', isLiked);
  btn.title = isLiked ? 'Убрать из избранного' : 'В избранное';
}

// ── Update single download button ────────────────────────────
export function updateDownloadButton(btn, state, percent = 0) {
  // state: 'idle' | 'downloading' | 'downloaded'
  btn.classList.toggle('downloaded', state === 'downloaded');
  btn.classList.toggle('downloading', state === 'downloading');
  btn.disabled = state === 'downloading';

  if (state === 'downloading') {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" stroke-width="3"/><circle cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" stroke-width="3" stroke-dasharray="${Math.round(2*Math.PI*15)}" stroke-dashoffset="${Math.round(2*Math.PI*15*(1-percent/100))}" stroke-linecap="round" transform="rotate(-90 18 18)"/></svg>`;
    btn.title = `Загрузка ${percent}%`;
  } else if (state === 'downloaded') {
    btn.innerHTML = downloadedIconSVG();
    btn.title = 'Удалить загрузку';
  } else {
    btn.innerHTML = downloadIconSVG();
    btn.title = 'Скачать';
  }
}

// ── Mark playing track across all lists ───────────────────────
export function markPlayingTrack(url) {
  document.querySelectorAll('.track-item').forEach(el => {
    el.classList.toggle('playing', el.dataset.url === url);
  });
}

// ── Player bar ────────────────────────────────────────────────
export async function updatePlayerBar({ track, playing, percent, currentTime, duration }) {
  if (track) {
    document.getElementById('playerTitle').textContent  = track.title  || '—';
    document.getElementById('playerArtist').textContent = track.artist || '—';

    // Mobile track name above controls
    const mobileTitle = document.getElementById('mobileTrackTitle');
    if (mobileTitle) mobileTitle.textContent = `${track.artist || '—'} — ${track.title || '—'}`;

    const heartBtn = document.getElementById('heartBtn');
    if (heartBtn) {
      const liked = Liked.isLiked(track.url);
      heartBtn.textContent = liked ? '♥' : '♡';
      heartBtn.classList.toggle('liked', liked);
    }

    // Update player-bar download button
    const dlBtn = document.getElementById('playerDownloadBtn');
    if (dlBtn) {
      dlBtn.dataset.url = track.url;
      const isOff = await Offline.has(track.url);
      updateDownloadButton(dlBtn, isOff ? 'downloaded' : 'idle');
    }
  }

  if (playing !== undefined) {
    document.getElementById('playIcon')?.style.setProperty('display',  playing ? 'none'  : 'block');
    document.getElementById('pauseIcon')?.style.setProperty('display', playing ? 'block' : 'none');
  }

  if (percent !== undefined) {
    document.getElementById('progressFill').style.width = percent + '%';
    document.getElementById('currentTime').textContent  = formatTime(currentTime);
    document.getElementById('duration').textContent     = formatTime(duration);
  }
}

// ── Navigation ────────────────────────────────────────────────
export function initNav() {
  const btns  = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.view;
      btns.forEach(b  => b.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + target)?.classList.add('active');
    });
  });
}

// ── Wave screen helpers ───────────────────────────────────────
export function setWaveState(state) {
  const btn        = document.getElementById('wavePlayBtn');
  const spinner    = document.getElementById('waveSpinner');
  const nowPlaying = document.getElementById('waveNowPlaying');

  if (!btn) return;

  if (state === 'loading') {
    btn.disabled = true;
    btn.textContent = 'Загрузка...';
    spinner?.classList.remove('hidden');
  } else if (state === 'playing') {
    btn.disabled = false;
    btn.textContent = '⏹ Остановить волну';
    btn.classList.add('active');
    spinner?.classList.add('hidden');
    nowPlaying?.classList.remove('hidden');
  } else {
    btn.disabled = false;
    btn.textContent = '▶ Запустить волну';
    btn.classList.remove('active');
    spinner?.classList.add('hidden');
    nowPlaying?.classList.add('hidden');
  }
}

export function updateWaveNowPlaying(track) {
  const el = document.getElementById('waveTrackName');
  if (el && track) el.textContent = `${track.artist} — ${track.title}`;
}

// ── Shared helpers ────────────────────────────────────────────
export function loadingHTML(msg = 'Загрузка...') {
  return `<div class="loading-state"><div class="spinner"></div><p>${msg}</p></div>`;
}

export function emptyHTML(msg) {
  return `<div class="empty-state"><div class="empty-icon">♪</div><p>${esc(msg)}</p></div>`;
}

export function showToast(msg, type = 'info') {
  const existing = document.querySelector('.toast');
  existing?.remove();

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

// ── Confirm dialog ────────────────────────────────────────────
export function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <p class="confirm-msg">${esc(msg)}</p>
        <div class="confirm-btns">
          <button class="confirm-cancel">Отмена</button>
          <button class="confirm-ok">Удалить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const close = (result) => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
  });
}

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// ── SVG helpers ───────────────────────────────────────────────
export function downloadIconSVG() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`;
}

export function downloadedIconSVG() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;
}
