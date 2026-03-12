// ── player.js ─────────────────────────────────────────────────
// Manages the audio element, queue, and playback state.
//
// iOS Safari requires audio.play() to be called synchronously
// within a user gesture. We solve this by:
// 1. Calling audio.play() immediately on click (unlocks audio context)
// 2. Then fetching the real src and re-playing
//
// Events dispatched on document:
//   player:track-changed  → { track, index }
//   player:state-changed  → { playing }
//   player:progress       → { currentTime, duration, percent }
//   player:error          → { message }

import { parseMp3, fetchPage } from './parser.js';
import { History, Offline } from './storage.js';

const audio = new Audio();
audio.preload = 'auto';

let queue      = [];
let queueIndex = -1;
let shuffle    = false;
let repeat     = false;
let loading    = false;

// ── iOS audio unlock ──────────────────────────────────────────
// Safari requires the very first play() call to be synchronous
// inside a user gesture. We keep track of whether audio is
// unlocked so we only need to do this once per session.
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  // Play silence synchronously — this satisfies iOS gesture requirement
  audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  audio.volume = 0;
  const p = audio.play();
  if (p) p.catch(() => {});
  audioUnlocked = true;
  audio.volume = 1;
}

// ── Public API ────────────────────────────────────────────────
export const Player = {
  get currentTrack() { return queue[queueIndex] || null; },
  get isPlaying()    { return !audio.paused; },
  get isShuffle()    { return shuffle; },
  get isRepeat()     { return repeat; },
  get queueLength()  { return queue.length; },

  setQueue(tracks, startIndex = 0) {
    // Called directly from click handler — unlock audio synchronously HERE
    unlockAudio();
    queue = tracks;
    queueIndex = startIndex;
    return this.playIndex(startIndex);
  },

  async playIndex(index) {
    if (index < 0 || index >= queue.length) return;
    queueIndex = index;
    const track = queue[queueIndex];
    loading = true;
    emit('player:track-changed', { track, index });

    try {
      // Check offline storage first
      const offlineEntry = await Offline.get(track.url);
      let src;
      if (offlineEntry?.blob) {
        src = URL.createObjectURL(offlineEntry.blob);
      } else {
        const html = await fetchPage(track.url);
        const mp3  = parseMp3(html);
        if (!mp3) throw new Error('MP3-ссылка не найдена на странице трека');
        track.mp3Url = mp3;
        src = mp3;
      }

      // Set src and play — audio is already unlocked from setQueue/gesture
      audio.src = src;
      audio.volume = 1;

      // Use load() + play() for better iOS compatibility
      audio.load();
      await audio.play();

      History.add(track.url);
      emit('player:state-changed', { playing: true });
    } catch (e) {
      // NotSupportedError on iOS = src not set yet or format issue
      // Try once more after a short delay
      if (e.name === 'NotSupportedError' || e.name === 'AbortError') {
        try {
          await new Promise(r => setTimeout(r, 300));
          await audio.play();
          emit('player:state-changed', { playing: true });
          return;
        } catch (e2) { /* fall through to error */ }
      }
      emit('player:error', { message: e.message });
    } finally {
      loading = false;
    }
  },

  togglePlay() {
    if (!audio.src || audio.src.startsWith('data:')) return;
    if (audio.paused) {
      unlockAudio();
      audio.play().then(() => emit('player:state-changed', { playing: true })).catch(() => {});
    } else {
      audio.pause();
      emit('player:state-changed', { playing: false });
    }
  },

  prev() {
    unlockAudio();
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (queueIndex > 0) this.playIndex(queueIndex - 1);
  },

  next() { unlockAudio(); playNext(); },

  seek(percent) {
    if (!audio.duration) return;
    audio.currentTime = (percent / 100) * audio.duration;
  },

  setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)); },
  getVolume()  { return audio.volume; },

  toggleShuffle() { shuffle = !shuffle; return shuffle; },
  toggleRepeat()  { repeat  = !repeat;  return repeat; },

  appendToQueue(tracks) { queue = queue.concat(tracks); },
  isLoading() { return loading; },
};

// ── Internal ──────────────────────────────────────────────────
function playNext() {
  if (!queue.length) return;
  let next;
  if (shuffle) {
    next = Math.floor(Math.random() * queue.length);
  } else if (queueIndex < queue.length - 1) {
    next = queueIndex + 1;
  } else if (repeat) {
    next = 0;
  } else {
    return;
  }
  Player.playIndex(next);
}

// ── Audio event listeners ─────────────────────────────────────
audio.addEventListener('ended', () => {
  if (repeat) {
    audio.currentTime = 0;
    audio.play();
  } else {
    playNext();
  }
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  emit('player:progress', {
    currentTime: audio.currentTime,
    duration:    audio.duration,
    percent:     (audio.currentTime / audio.duration) * 100,
  });
});

audio.addEventListener('loadedmetadata', () => {
  emit('player:progress', { currentTime: 0, duration: audio.duration, percent: 0 });
});

audio.addEventListener('pause', () => emit('player:state-changed', { playing: false }));
audio.addEventListener('play',  () => emit('player:state-changed', { playing: true }));

// ── Helper ────────────────────────────────────────────────────
function emit(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}
