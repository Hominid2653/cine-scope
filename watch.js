// ─────────────────────────────────────────────
//  CINESCOPE — watch.js  (TMDB only)
//  Includes: progress tracking, resume, history
// ─────────────────────────────────────────────

const TMDB_KEY  = '2a90a66535588ab6ad8c190707a04852';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG       = 'https://image.tmdb.org/t/p/';

// Video source domain (easily switch to test ads)
// Options: vidsrcme.ru, vidsrc-embed.ru, vsrc.su, vidsrcme.su, vidsrc-me.ru, vidsrc-me.su, vidsrc-embed.su
const VIDEO_DOMAIN = 'vidsrc-embed.ru'; // Recommended: fewest ads

const urlParams = new URLSearchParams(location.search);
const id        = urlParams.get('id');
const type      = urlParams.get('type') || 'movie';

// Progress tracking state
let progressInterval  = null;
let sessionStartTime  = null;
let estimatedDuration = 0;   // in seconds, from TMDB runtime
let currentProgress   = 0;   // 0–100
let movieData         = null;
let currentSeason     = null; // for TV shows
let currentEpisode    = null; // for TV shows
const SAVE_INTERVAL   = 15000; // save every 15s

// DOM
const playerWrap      = document.getElementById('playerWrap');
const episodeControls = document.getElementById('episodeControls');
const movieInfo       = document.getElementById('movieInfo');
const recScroll       = document.getElementById('recScroll');
const recMovieName    = document.getElementById('recMovieName');
const backdropTint    = document.getElementById('backdropTint');
const resumeBanner    = document.getElementById('resumeBanner');
const resumeText      = document.getElementById('resumeText');
const resumeBar       = document.getElementById('resumeBar');

// Cache
const cache = new Map();

async function fetchTMDB(path, extraParams = {}) {
  const url = new URL(`${TMDB_BASE}/${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
  const key = url.toString();
  if (cache.has(key)) return cache.get(key);
  const res  = await fetch(key);
  const data = await res.json();
  cache.set(key, data);
  return data;
}

// ── INIT ────────────────────────────────────
async function init() {
  if (!id) {
    playerWrap.innerHTML = `<div class="absolute inset-0 flex items-center justify-center">
      <p class="text-danger text-xs tracking-widest uppercase">No title specified.
        <a href="index.html" class="underline text-accent ml-2">Go back</a>
      </p></div>`;
    return;
  }

  try {
    const endpoint = type === 'tv'
      ? `tv/${id}?append_to_response=credits,external_ids`
      : `movie/${id}?append_to_response=credits,release_dates,external_ids`;

    const data = await fetchTMDB(endpoint);
    movieData  = data;
    document.title = `${data.title || data.name} — Cinescope`;

    // Set estimated duration for progress calculation
    if (type === 'movie' && data.runtime) {
      estimatedDuration = data.runtime * 60;
    } else if (type === 'tv' && data.episode_run_time?.[0]) {
      estimatedDuration = data.episode_run_time[0] * 60;
    } else {
      estimatedDuration = 90 * 60; // fallback 90 min
    }

    // Check for existing progress
    const existing = getMainProgress() || getProgress();
    let autoLoadEpisode = null;
    if (existing && existing.progress > 2) {
      showResumeBanner(existing);
      // For TV, prepare to auto-load last watched episode
      if (type === 'tv' && existing.season && existing.episode) {
        autoLoadEpisode = { season: existing.season, episode: existing.episode };
      }
    }

    renderInfo(data);
    if (type === 'tv') {
      await setupEpisodeControls(data, autoLoadEpisode);
    } else {
      loadPlayer();
    }
    saveHistory(data);
    loadRecs(data.title || data.name);
    startProgressTracking();

  } catch (err) {
    playerWrap.innerHTML = `<div class="absolute inset-0 flex items-center justify-center">
      <p class="text-danger text-xs tracking-widest uppercase p-8">${err.message}</p></div>`;
  }
}

// ── PROGRESS: localStorage keys ─────────────
function progressKey() { 
  // For TV: track per-episode. For movies: single progress entry
  return type === 'tv' && currentSeason && currentEpisode 
    ? `cs_progress_${type}_${id}_s${currentSeason}e${currentEpisode}`
    : `cs_progress_${type}_${id}`;
}

function mainProgressKey() { 
  // Main key for tracking last watched episode (TV only)
  return `cs_progress_${type}_${id}`;
}

function historyKey()   { return 'cs_watch_history'; }

function getProgress() {
  try { return JSON.parse(localStorage.getItem(progressKey())); } catch { return null; }
}

function getMainProgress() {
  // For TV shows, get the main entry to find last watched episode
  if (type !== 'tv') return null;
  try { return JSON.parse(localStorage.getItem(mainProgressKey())); } catch { return null; }
}

function saveProgress(pct) {
  if (!movieData) return;
  try {
    const entry = {
      id, type,
      title:     movieData.title || movieData.name || '',
      poster:    movieData.poster_path  || null,
      backdrop:  movieData.backdrop_path || null,
      progress:  Math.min(Math.round(pct), 99), // never save 100 — treat as finished
      savedAt:   Date.now(),
      duration:  estimatedDuration,
    };
    
    // For TV, include season and episode
    if (type === 'tv' && currentSeason && currentEpisode) {
      entry.season = currentSeason;
      entry.episode = currentEpisode;
    }
    
    localStorage.setItem(progressKey(), JSON.stringify(entry));
    
    // For TV, also save main progress entry with last episode info
    if (type === 'tv' && currentSeason && currentEpisode) {
      const mainEntry = { ...entry };
      localStorage.setItem(mainProgressKey(), JSON.stringify(mainEntry));
    }
    
    updateHistory(entry);
  } catch {}
}

function markFinished() {
  try { localStorage.removeItem(progressKey()); } catch {}
}

// ── HISTORY ─────────────────────────────────
function updateHistory(entry) {
  try {
    let h = JSON.parse(localStorage.getItem(historyKey()) || '[]');
    h = h.filter(i => !(i.id === entry.id && i.type === entry.type));
    h.unshift(entry);
    localStorage.setItem(historyKey(), JSON.stringify(h.slice(0, 40)));
  } catch {}
}

function saveHistory(m) {
  updateHistory({
    id, type,
    title:    m.title || m.name || '',
    poster:   m.poster_path   || null,
    backdrop: m.backdrop_path || null,
    progress: getProgress()?.progress || 0,
    savedAt:  Date.now(),
    duration: estimatedDuration,
  });
}

// ── PROGRESS TRACKING ───────────────────────
// vidsrc iframes don't expose a JS API, so we use
// elapsed wall-clock time as a reliable estimator.
function startProgressTracking() {
  sessionStartTime = Date.now();
  const saved = getProgress();
  // Restore previous progress as starting offset
  const offsetPct = saved?.progress || 0;

  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    if (!estimatedDuration) return;
    const elapsedSec  = (Date.now() - sessionStartTime) / 1000;
    const offsetSec   = (offsetPct / 100) * estimatedDuration;
    const totalSec    = offsetSec + elapsedSec;
    currentProgress   = Math.min((totalSec / estimatedDuration) * 100, 99);

    saveProgress(currentProgress);
    updateProgressUI(currentProgress);

    // Mark finished at 95%+
    if (currentProgress >= 95) {
      markFinished();
      clearInterval(progressInterval);
    }
  }, SAVE_INTERVAL);
}

function updateProgressUI(pct) {
  const bar = document.getElementById('watchProgressBar');
  if (bar) bar.style.width = `${pct}%`;
  const label = document.getElementById('watchProgressLabel');
  if (label) label.textContent = `${Math.round(pct)}% watched`;
}

// Save on page leave
window.addEventListener('beforeunload', () => {
  if (currentProgress > 2) saveProgress(currentProgress);
  clearInterval(progressInterval);
});

// ── RESUME BANNER ────────────────────────────
function showResumeBanner(entry) {
  resumeBanner.classList.remove('hidden');
  let resumeMsg = `${Math.round(entry.progress)}% watched`;
  
  // For TV shows, show season and episode
  if (type === 'tv' && entry.season && entry.episode) {
    resumeMsg += ` — S${entry.season}E${entry.episode}`;
  }
  
  resumeMsg += ' — resume where you left off';
  resumeText.textContent = resumeMsg;
  resumeBar.style.width  = `${entry.progress}%`;
}

function dismissResume() {
  resumeBanner.classList.add('hidden');
  // Reset progress so it starts fresh
  try { localStorage.removeItem(progressKey()); } catch {}
  try { localStorage.removeItem(mainProgressKey()); } catch {}
  sessionStartTime = Date.now();
  currentProgress  = 0;
}

// ── PLAYER ──────────────────────────────────
function loadPlayer(season, episode) {
  // Update current tracking for TV shows
  if (type === 'tv') {
    currentSeason = season || currentSeason || 1;
    currentEpisode = episode || currentEpisode || 1;
  }
  
  let src;
  if (type === 'tv') {
    src = season && episode
      ? `https://${VIDEO_DOMAIN}/embed/tv/${id}/${season}/${episode}`
      : `https://${VIDEO_DOMAIN}/embed/tv/${id}`;
  } else {
    src = `https://${VIDEO_DOMAIN}/embed/movie/${id}`;
  }

  // Reset session timer when player (re)loads
  sessionStartTime = Date.now();

  playerWrap.innerHTML = `
    <iframe
      src="${src}"
      allowfullscreen
      allow="autoplay; fullscreen; picture-in-picture"
      referrerpolicy="no-referrer"
    ></iframe>`;
}

// ── MOVIE INFO ───────────────────────────────
function renderInfo(m) {
  const title    = m.title || m.name || '—';
  const year     = (m.release_date || m.first_air_date || '').slice(0, 4);
  const runtime  = m.runtime
    ? `${m.runtime} min`
    : m.episode_run_time?.[0] ? `${m.episode_run_time[0]} min/ep` : '';
  const rating   = m.vote_average ? m.vote_average.toFixed(1) : '—';
  const votes    = m.vote_count   ? m.vote_count.toLocaleString() : '';
  const genres   = (m.genres || []).map(g => g.name).join(' · ');
  const overview = m.overview || 'No overview available.';
  const tagline  = m.tagline || '';
  const poster   = m.poster_path   ? `${IMG}w342${m.poster_path}`   : null;
  const backdrop = m.backdrop_path ? `${IMG}w1280${m.backdrop_path}` : null;
  const director = (m.credits?.crew || []).find(c => c.job === 'Director')?.name || '';
  const creator  = type === 'tv' ? (m.created_by || []).map(c => c.name).join(', ') : '';
  const cast     = (m.credits?.cast || []).slice(0, 8).map(c => c.name).join(', ');

  if (backdrop) {
    backdropTint.style.backgroundImage = `url('${backdrop}')`;
    setTimeout(() => { backdropTint.style.opacity = '1'; }, 100);
  }

  const saved        = getProgress();
  const savedPct     = saved?.progress || 0;
  const progressHTML = `
    <div class="flex flex-col gap-1.5 border-t border-border pt-4">
      <div class="flex items-center justify-between">
        <span class="text-xs tracking-widest uppercase text-muted">Watch Progress</span>
        <span id="watchProgressLabel" class="text-xs tracking-widest text-accent">${savedPct > 0 ? `${savedPct}% watched` : 'Not started'}</span>
      </div>
      <div class="w-full h-1 bg-border overflow-hidden">
        <div id="watchProgressBar" class="h-full bg-accent transition-all duration-1000" style="width:${savedPct}%"></div>
      </div>
    </div>`;

  const statusBadge = m.status
    ? `<span class="text-xs tracking-widest uppercase px-2.5 py-1 border border-border text-muted">${escHtml(m.status)}</span>`
    : '';

  const seasonInfo = type === 'tv' && m.number_of_seasons
    ? `<div><p class="label">Seasons</p><p class="val">${m.number_of_seasons} season${m.number_of_seasons > 1 ? 's' : ''} · ${m.number_of_episodes} episodes</p></div>`
    : '';

  movieInfo.innerHTML = `
    <style>
      #movieInfo .label { color:#64647a; font-size:10px; letter-spacing:.2em; text-transform:uppercase; margin-bottom:2px; }
      #movieInfo .val   { color:#eeecea; font-size:14px; line-height:1.4; }
    </style>
    <div class="flex gap-6 flex-wrap md:flex-nowrap">
      ${poster ? `
        <div class="shrink-0 self-start shadow-2xl ring-1 ring-border hidden sm:block" style="width:160px;aspect-ratio:2/3;overflow:hidden">
          <img src="${poster}" alt="${escHtml(title)}" class="w-full h-full object-cover" style="filter:saturate(.9)"/>
        </div>` : ''}
      <div class="flex flex-col gap-4 flex-1 min-w-0">
        <div>
          <h1 class="font-display tracking-widest leading-none text-light" style="font-size:clamp(2rem,5vw,3.5rem)">${escHtml(title)}</h1>
          ${tagline ? `<p class="mt-1 italic text-sm" style="color:#64647a">"${escHtml(tagline)}"</p>` : ''}
        </div>
        <div class="flex flex-wrap gap-2 items-center">
          ${year    ? `<span class="text-xs tracking-widest uppercase px-2.5 py-1 border border-accent text-accent">${year}</span>` : ''}
          ${runtime ? `<span class="text-xs tracking-widest uppercase px-2.5 py-1 border border-border text-muted">${runtime}</span>` : ''}
          ${statusBadge}
          ${genres.split(' · ').map(g => `<span class="text-xs tracking-widest uppercase px-2.5 py-1 border border-border text-muted">${escHtml(g)}</span>`).join('')}
        </div>
        <div class="flex items-end gap-2">
          <span class="font-display text-4xl text-accent tracking-wide leading-none">★ ${rating}</span>
          ${votes ? `<span class="text-muted text-xs tracking-wide mb-1">${votes} votes</span>` : ''}
        </div>
        <p class="text-sm leading-relaxed max-w-2xl" style="color:#9090a8">${escHtml(overview)}</p>
        ${progressHTML}
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-4 border-t border-border pt-4">
          ${(director || creator) ? `<div><p class="label">${type === 'tv' ? 'Creator' : 'Director'}</p><p class="val">${escHtml(director || creator)}</p></div>` : ''}
          ${cast      ? `<div class="col-span-2 sm:col-span-1"><p class="label">Starring</p><p class="val">${escHtml(cast)}</p></div>` : ''}
          ${seasonInfo}
          ${m.original_language ? `<div><p class="label">Language</p><p class="val">${m.original_language.toUpperCase()}</p></div>` : ''}
          ${m.budget  > 0 ? `<div><p class="label">Budget</p><p class="val">$${(m.budget/1e6).toFixed(1)}M</p></div>`  : ''}
          ${m.revenue > 0 ? `<div><p class="label">Revenue</p><p class="val">$${(m.revenue/1e6).toFixed(1)}M</p></div>` : ''}
          ${m.production_companies?.[0] ? `<div><p class="label">Studio</p><p class="val">${escHtml(m.production_companies[0].name)}</p></div>` : ''}
        </div>
      </div>
    </div>`;
}

// ── EPISODE CONTROLS ─────────────────────────
async function setupEpisodeControls(data, autoLoad) {
  const seasons = (data.seasons || []).filter(s => s.season_number > 0);
  if (!seasons.length) return;
  episodeControls.classList.remove('hidden');
  episodeControls.style.display = 'flex';
  const seasonSel = document.getElementById('seasonSelect');
  seasonSel.innerHTML = seasons.map(s =>
    `<option value="${s.season_number}">Season ${s.season_number} (${s.episode_count} eps)</option>`
  ).join('');
  
  // Set to last watched season if available, else first season
  if (autoLoad && autoLoad.season) {
    seasonSel.value = autoLoad.season;
  }
  
  await populateEpisodes(autoLoad?.episode);
  
  // Auto-load last watched episode, or default to S1E1
  if (autoLoad && autoLoad.season && autoLoad.episode) {
    currentSeason = autoLoad.season;
    currentEpisode = autoLoad.episode;
    loadPlayer(autoLoad.season, autoLoad.episode);
  } else {
    // Default to first season, first episode
    currentSeason = 1;
    currentEpisode = 1;
    loadPlayer(1, 1);
  }
}

async function onSeasonChange() { await populateEpisodes(); }

async function populateEpisodes(autoEpisode) {
  const season = document.getElementById('seasonSelect').value;
  const data   = await fetchTMDB(`tv/${id}/season/${season}`);
  const sel    = document.getElementById('episodeSelect');
  sel.innerHTML = (data.episodes || []).map(e =>
    `<option value="${e.episode_number}">Ep ${e.episode_number}: ${escHtml(e.name)}</option>`
  ).join('');
  
  // Set to last watched episode if available
  if (autoEpisode) {
    sel.value = autoEpisode;
  }
}

function playEpisode() {
  const s = document.getElementById('seasonSelect').value;
  const e = document.getElementById('episodeSelect').value;
  loadPlayer(s, e);
}

// ── RECOMMENDATIONS ──────────────────────────
async function loadRecs(watchedTitle) {
  recMovieName.textContent = watchedTitle || '';
  try {
    const [recData, simData] = await Promise.all([
      fetchTMDB(`${type}/${id}/recommendations`),
      fetchTMDB(`${type}/${id}/similar`),
    ]);
    const seen  = new Set([+id]);
    const items = [...(recData.results || []), ...(simData.results || [])]
      .filter(m => { if (seen.has(m.id) || !m.poster_path) return false; seen.add(m.id); return true; })
      .sort((a, b) => {
        const sA = (a.vote_average||0)*0.6 + Math.min((a.popularity||0)/200,5)*0.4;
        const sB = (b.vote_average||0)*0.6 + Math.min((b.popularity||0)/200,5)*0.4;
        return sB - sA;
      })
      .slice(0, 20);
    renderRecs(items);
  } catch {
    recScroll.innerHTML = `<p class="text-muted text-xs tracking-widest uppercase py-4">Could not load recommendations.</p>`;
  }
}

function renderRecs(items) {
  if (!items.length) {
    recScroll.innerHTML = `<p class="text-muted text-xs tracking-widest uppercase py-4">No recommendations found.</p>`;
    return;
  }
  recScroll.innerHTML = '';
  items.forEach(m => {
    const title  = m.title || m.name || '';
    const year   = (m.release_date || m.first_air_date || '').slice(0, 4);
    const rating = m.vote_average ? m.vote_average.toFixed(1) : '';
    const mType  = m.media_type || type;
    const saved  = (() => { try { return JSON.parse(localStorage.getItem(`cs_progress_${mType}_${m.id}`)); } catch { return null; } })();
    const pct    = saved?.progress || 0;

    const card = document.createElement('div');
    card.className = 'rec-card';
    card.title     = title;
    card.onclick   = () => { location.href = `watch.html?id=${m.id}&type=${mType}`; };
    card.innerHTML = `
      <img src="${IMG}w342${m.poster_path}" alt="${escHtml(title)}" loading="lazy"/>
      ${rating ? `<div style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.8);color:#e8c547;font-family:'Bebas Neue',cursive;font-size:13px;padding:2px 7px;letter-spacing:.05em;line-height:1.4">★${rating}</div>` : ''}
      ${pct > 2 ? `<div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:#272736"><div style="height:100%;width:${pct}%;background:#e8c547"></div></div>` : ''}
      <div class="rec-label">
        ${year ? `<p style="color:#e8c547;font-size:10px;letter-spacing:.15em;text-transform:uppercase;margin-bottom:2px">${year}</p>` : ''}
        <p style="font-family:'Bebas Neue',cursive;font-size:15px;letter-spacing:.05em;line-height:1.15;color:#eeecea">${escHtml(title)}</p>
        <p style="font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#64647a;margin-top:2px">${mType === 'tv' ? 'TV Show' : 'Movie'}</p>
        ${pct > 2 ? `<p style="font-size:10px;color:#e8c547;margin-top:3px">${pct}% watched</p>` : ''}
      </div>`;
    recScroll.appendChild(card);
  });
}

// ── UTIL ─────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── START ─────────────────────────────────────
init();