// ─────────────────────────────────────────────────────────────
//  CINESCOPE — script.js  (TMDB only)
// ─────────────────────────────────────────────────────────────

const TMDB_KEY  = '2a90a66535588ab6ad8c190707a04852';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE  = 'https://image.tmdb.org/t/p/';
const NOW_YEAR  = new Date().getFullYear();

let genreMap = {};

// ── State ──────────────────────────────────────────────────
let mode          = 'browse';
let currentQuery  = '';
let currentYear   = null;
let currentPage   = 1;
let totalPages    = 1;
let isFetching    = false;
let exhausted     = false;
let sortMode      = 'smart';

let filterType      = 'all';
let filterGenreId   = '';
let filterMinRating = '';
let filterMinVotes  = '';
let filterOpen      = false;

const BROWSE_SOURCES = [
  { endpoint: 'movie/top_rated',   type: 'movie', pages: 5 },
  { endpoint: 'tv/top_rated',      type: 'tv',    pages: 5 },
  { endpoint: 'movie/popular',     type: 'movie', pages: 3 },
  { endpoint: 'tv/popular',        type: 'tv',    pages: 3 },
  { endpoint: 'trending/all/week', type: 'all',   pages: 3 },
];
let browseSourceIdx = 0;
let browsePage      = 1;

let pickerOpen  = false;
let decadeStart = Math.floor(NOW_YEAR / 10) * 10;

let bannerMovies  = [];
let bannerIndex   = 0;
let bannerTimer   = null;
const BANNER_COUNT    = 7;
const BANNER_INTERVAL = 6000;

const tmdbCache = new Map();

// ── DOM ────────────────────────────────────────────────────
const grid           = document.getElementById('grid');
const statusEl       = document.getElementById('status');
const spinner        = document.getElementById('spinner');
const sentinel       = document.getElementById('sentinel');
const searchInput    = document.getElementById('searchInput');
const clearBtn       = document.getElementById('clearBtn');
const bannerWrap     = document.getElementById('bannerWrap');
const bannerEl       = document.getElementById('banner');
const bannerControls = document.getElementById('bannerControls');
const bannerDots     = document.getElementById('bannerDots');
const sectionTitle   = document.getElementById('sectionTitle');
const sectionSub     = document.getElementById('sectionSub');
const sortWrap       = document.getElementById('sortWrap');
const yearDropdown   = document.getElementById('yearDropdown');
const yearLabel      = document.getElementById('yearLabel');
const yearGridEl     = document.getElementById('yearGrid');
const decadeLabel    = document.getElementById('decadeLabel');
const yearChevron    = document.getElementById('yearChevron');
const modalBd        = document.getElementById('modalBackdrop');
const modalPoster    = document.getElementById('modalPoster');
const modalBody      = document.getElementById('modalBody');
const continueSection = document.getElementById('continueSection');
const continueScroll  = document.getElementById('continueScroll');

// ── Events ─────────────────────────────────────────────────
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerSearch(); });
searchInput.addEventListener('input',   () => clearBtn.classList.toggle('hidden', !searchInput.value));
document.addEventListener('keydown',    e => { if (e.key === 'Escape') { closeModal(); closeYearPicker(); } });
document.addEventListener('click', e => {
  if (pickerOpen && !document.getElementById('yearPickerWrap').contains(e.target)) closeYearPicker();
});

// ── Infinite scroll ────────────────────────────────────────
const observer = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && !isFetching && !exhausted) loadNextPage();
}, { rootMargin: '400px' });
observer.observe(sentinel);

// ── Bootstrap ──────────────────────────────────────────────
(async () => {
  await fetchGenres();
  buildYearGrid();
  renderContinueWatching();
  renderSkeletons(16);
  loadBanner();
  loadNextPage();
})();

// ──────────────────────────────────────────────────────────
//  CONTINUE WATCHING
// ──────────────────────────────────────────────────────────
function getHistory() {
  try { return JSON.parse(localStorage.getItem('cs_watch_history') || '[]'); } catch { return []; }
}

function removeFromHistory(id, type) {
  try {
    let h = getHistory().filter(i => !(String(i.id) === String(id) && i.type === type));
    localStorage.setItem('cs_watch_history', JSON.stringify(h));
    // Also remove progress entry
    localStorage.removeItem(`cs_progress_${type}_${id}`);
    renderContinueWatching();
  } catch {}
}

function renderContinueWatching() {
  const history = getHistory().filter(i => i.progress > 2 && i.progress < 95);
  if (!history.length) {
    continueSection.classList.add('hidden');
    return;
  }

  continueSection.classList.remove('hidden');
  continueScroll.innerHTML = '';

  history.forEach(item => {
    const posterUrl = item.poster ? `${IMG_BASE}w342${item.poster}` : null;
    const pct       = item.progress || 0;
    const savedDate = item.savedAt  ? timeAgo(item.savedAt) : '';

    const card = document.createElement('div');
    card.className = 'continue-card';
    card.style.cssText = 'flex:0 0 150px;position:relative;cursor:pointer;aspect-ratio:2/3;overflow:hidden;background:#18181f;scroll-snap-align:start;';

    card.innerHTML = `
      ${posterUrl
        ? `<img src="${posterUrl}" alt="${escHtml(item.title)}" loading="lazy"
                style="width:100%;height:100%;object-fit:cover;display:block;filter:brightness(.8) saturate(.7);transition:filter .3s,transform .45s"/>`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#18181f;color:#64647a;font-size:11px;letter-spacing:.1em;text-transform:uppercase">${escHtml(item.title)}</div>`
      }

      <!-- Progress bar -->
      <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:#272736">
        <div style="height:100%;width:${pct}%;background:#e8c547;transition:width .5s"></div>
      </div>

      <!-- Remove button -->
      <button
        onclick="event.stopPropagation(); removeFromHistory('${item.id}','${item.type}')"
        style="position:absolute;top:6px;right:6px;width:22px;height:22px;background:rgba(0,0,0,.8);border:1px solid #272736;color:#64647a;font-size:11px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;z-index:2"
        class="remove-btn"
        title="Remove">✕</button>

      <!-- Hover overlay -->
      <div class="continue-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:10px;background:linear-gradient(to top,rgba(9,9,15,.96) 0%,transparent 60%);opacity:0;transition:opacity .3s">
        <p style="color:#e8c547;font-size:10px;letter-spacing:.15em;text-transform:uppercase;margin-bottom:2px">${pct}% watched</p>
        <p style="font-family:'Bebas Neue',cursive;font-size:15px;letter-spacing:.05em;line-height:1.15;color:#eeecea">${escHtml(item.title)}</p>
        ${savedDate ? `<p style="font-size:10px;color:#64647a;margin-top:2px;letter-spacing:.05em">${savedDate}</p>` : ''}
        <div style="margin-top:6px;display:flex;align-items:center;gap:4px;background:#e8c547;color:#09090f;font-family:'Bebas Neue',cursive;font-size:12px;letter-spacing:.1em;padding:4px 8px;width:fit-content">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          Resume
        </div>
      </div>`;

    // Hover effects
    card.addEventListener('mouseenter', () => {
      card.querySelector('.continue-overlay').style.opacity = '1';
      card.querySelector('.remove-btn').style.opacity = '1';
      const img = card.querySelector('img');
      if (img) { img.style.transform = 'scale(1.05)'; img.style.filter = 'brightness(1) saturate(1)'; }
    });
    card.addEventListener('mouseleave', () => {
      card.querySelector('.continue-overlay').style.opacity = '0';
      card.querySelector('.remove-btn').style.opacity = '0';
      const img = card.querySelector('img');
      if (img) { img.style.transform = 'scale(1)'; img.style.filter = 'brightness(.8) saturate(.7)'; }
    });

    card.addEventListener('click', () => {
      location.href = `watch.html?id=${item.id}&type=${item.type}`;
    });

    continueScroll.appendChild(card);
  });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'Just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ──────────────────────────────────────────────────────────
//  TMDB FETCH (cached)
// ──────────────────────────────────────────────────────────
async function tmdb(path, params = {}) {
  const url = new URL(`${TMDB_BASE}/${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const key = url.toString();
  if (tmdbCache.has(key)) return tmdbCache.get(key);
  const res  = await fetch(key);
  const data = await res.json();
  tmdbCache.set(key, data);
  return data;
}

// ──────────────────────────────────────────────────────────
//  GENRES
// ──────────────────────────────────────────────────────────
async function fetchGenres() {
  const [mG, tG] = await Promise.all([tmdb('genre/movie/list'), tmdb('genre/tv/list')]);
  const all = [...(mG.genres || []), ...(tG.genres || [])];
  const seen = new Set();
  const unique = all.filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; });
  unique.forEach(g => { genreMap[g.id] = g.name; });
  const sel = document.getElementById('genreSelect');
  unique.sort((a, b) => a.name.localeCompare(b.name)).forEach(g => {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name;
    sel.appendChild(o);
  });
}

// ──────────────────────────────────────────────────────────
//  BANNER
// ──────────────────────────────────────────────────────────
async function loadBanner() {
  try {
    const [topMovies, topTV, trending] = await Promise.all([
      tmdb('movie/top_rated', { page: 1 }),
      tmdb('tv/top_rated',    { page: 1 }),
      tmdb('trending/all/week'),
    ]);
    const pool = [
      ...(topMovies.results || []).map(m => ({ ...m, media_type: 'movie' })),
      ...(topTV.results     || []).map(m => ({ ...m, media_type: 'tv'    })),
      ...(trending.results  || []),
    ];
    const seen = new Set();
    bannerMovies = pool
      .filter(m => m.backdrop_path && m.vote_average >= 7.8 && m.vote_count >= 5000 && !seen.has(m.id) && seen.add(m.id))
      .sort((a, b) => (b.vote_average * 0.6 + (b.popularity/1000) * 0.4) - (a.vote_average * 0.6 + (a.popularity/1000) * 0.4))
      .slice(0, BANNER_COUNT);
    if (!bannerMovies.length) { bannerWrap.classList.add('hidden'); return; }
    buildBannerSlides();
    buildBannerDots();
    showBannerSlide(0);
    startBannerTimer();
    document.querySelector('.banner-shimmer')?.remove();
    bannerControls.classList.remove('hidden');
    bannerControls.style.display = 'block';
  } catch { bannerWrap.classList.add('hidden'); }
}

function buildBannerSlides() {
  document.querySelector('.banner-shimmer')?.remove();
  bannerMovies.forEach((m) => {
    const title    = m.title || m.name || '';
    const type     = m.media_type || 'movie';
    const year     = (m.release_date || m.first_air_date || '').slice(0, 4);
    const rating   = m.vote_average ? m.vote_average.toFixed(1) : '';
    const overview = (m.overview || '').slice(0, 200);
    const backdrop = `${IMG_BASE}original${m.backdrop_path}`;
    const poster   = m.poster_path ? `${IMG_BASE}w342${m.poster_path}` : null;
    const genres   = (m.genre_ids || []).slice(0, 3).map(id => genreMap[id]).filter(Boolean).join(' · ');
    const saved    = (() => { try { return JSON.parse(localStorage.getItem(`cs_progress_${type}_${m.id}`)); } catch { return null; } })();
    const pct      = saved?.progress || 0;

    const slide = document.createElement('div');
    slide.className = 'banner-slide';
    slide.innerHTML = `
      <div class="banner-bg" style="background-image:url('${backdrop}')"></div>
      <div class="banner-fade"></div>
      <div class="absolute inset-0 flex flex-col justify-end px-5 md:px-12 pb-10">
        <div class="relative z-10 flex items-end gap-6 flex-wrap">
          ${poster ? `<div class="hidden md:block shrink-0 shadow-2xl" style="width:110px;aspect-ratio:2/3;overflow:hidden"><img src="${poster}" class="w-full h-full object-cover" style="filter:saturate(.85)"/></div>` : ''}
          <div class="flex flex-col gap-2.5 flex-1 min-w-0">
            ${genres ? `<p class="text-xs tracking-widest uppercase" style="color:#9090a8">${escHtml(genres)}</p>` : ''}
            <div class="flex items-center gap-3 flex-wrap">
              ${year   ? `<span class="text-xs tracking-widest uppercase px-2.5 py-1 border border-accent text-accent">${year}</span>` : ''}
              ${rating ? `<span class="font-display text-xl text-accent tracking-wide leading-none">★ ${rating}</span>` : ''}
              <span class="text-xs tracking-widest uppercase px-2.5 py-1 border border-border text-muted">${type.toUpperCase()}</span>
              ${pct > 2 ? `<span class="text-xs tracking-widest uppercase px-2.5 py-1 border border-accent/40 text-accent/70">${pct}% watched</span>` : ''}
            </div>
            <h3 class="font-display leading-none text-light" style="font-size:clamp(2rem,6vw,4rem);text-shadow:0 2px 24px rgba(0,0,0,.9)">${escHtml(title)}</h3>
            ${overview ? `<p class="text-sm leading-relaxed max-w-xl hidden md:block" style="color:#a0a0b8;text-shadow:0 1px 8px rgba(0,0,0,.9)">${escHtml(overview)}${m.overview?.length > 200 ? '…' : ''}</p>` : ''}
            ${pct > 2 ? `<div class="w-full max-w-sm h-0.5 bg-border/60 overflow-hidden"><div class="h-full bg-accent" style="width:${pct}%"></div></div>` : ''}
            <div class="flex gap-3 mt-1 flex-wrap">
              <button onclick="goWatch(${m.id},'${type}')"
                      class="bg-accent hover:bg-yellow-300 transition-colors text-bg font-display tracking-widest px-6 py-2.5 text-base flex items-center gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                ${pct > 2 ? 'Resume' : 'Watch'}
              </button>
              <button onclick="openModal(${m.id},'${type}')"
                      class="border border-border hover:border-accent text-muted hover:text-accent transition-colors font-display tracking-widest px-6 py-2.5 text-base">
                Details
              </button>
            </div>
          </div>
        </div>
      </div>`;
    bannerEl.appendChild(slide);
  });
}

function buildBannerDots() {
  bannerDots.innerHTML = '';
  bannerMovies.forEach((_, i) => {
    const d = document.createElement('button');
    d.className = 'banner-dot transition-all';
    d.onclick   = () => bannerGoTo(i);
    bannerDots.appendChild(d);
  });
}

function showBannerSlide(i) {
  document.querySelectorAll('.banner-slide').forEach((s, j) => s.classList.toggle('active', j === i));
  document.querySelectorAll('.banner-dot').forEach((d, j) => d.classList.toggle('active', j === i));
  bannerIndex = i;
}

function startBannerTimer() {
  clearInterval(bannerTimer);
  bannerTimer = setInterval(() => bannerGoTo((bannerIndex + 1) % bannerMovies.length), BANNER_INTERVAL);
}

function bannerGoTo(i) { showBannerSlide(i); startBannerTimer(); }
function bannerNext()   { bannerGoTo((bannerIndex + 1) % bannerMovies.length); }
function bannerPrev()   { bannerGoTo((bannerIndex - 1 + bannerMovies.length) % bannerMovies.length); }

// ──────────────────────────────────────────────────────────
//  ROUTING
// ──────────────────────────────────────────────────────────
function loadNextPage() { mode === 'browse' ? loadBrowse() : loadSearch(); }

// ──────────────────────────────────────────────────────────
//  BROWSE FEED
// ──────────────────────────────────────────────────────────
async function loadBrowse() {
  if (isFetching || exhausted) return;
  isFetching = true; showSpinner(true);
  try {
    const source = BROWSE_SOURCES[browseSourceIdx % BROWSE_SOURCES.length];
    const params = buildDiscoverParams(source.type, browsePage);
    const data   = await tmdb(source.endpoint, params);
    const items  = (data.results || []).map(m => normalise(m, source.type === 'all' ? (m.media_type || 'movie') : source.type));
    const filtered = applyClientFilters(items);
    const sorted   = filtered.sort((a, b) => browseScore(b) - browseScore(a));
    if (sorted.length) {
      if (grid.querySelector('.shimmer-bar')) grid.innerHTML = '';
      renderCards(sorted);
    }
    if (browsePage >= Math.min(source.pages, data.total_pages || 1)) {
      browseSourceIdx++; browsePage = 1;
      if (browseSourceIdx >= BROWSE_SOURCES.length * 2) { exhausted = true; setStatus("You've seen everything."); }
    } else { browsePage++; }
    setStatus('');
  } catch { setStatus('Failed to load.', true); }
  isFetching = false; showSpinner(false);
}

function buildDiscoverParams(type, page) {
  const p = { page, sort_by: 'vote_average.desc', 'vote_count.gte': 500 };
  if (currentYear) {
    if (type === 'movie') p['primary_release_year'] = currentYear;
    else if (type === 'tv') p['first_air_date_year'] = currentYear;
  }
  if (filterGenreId)   p['with_genres']     = filterGenreId;
  if (filterMinRating) p['vote_average.gte'] = filterMinRating;
  if (filterMinVotes)  p['vote_count.gte']   = filterMinVotes;
  return p;
}

// ──────────────────────────────────────────────────────────
//  SEARCH FEED
// ──────────────────────────────────────────────────────────
async function loadSearch() {
  if (isFetching || exhausted) return;
  isFetching = true; showSpinner(true);
  try {
    const searchType = (filterType === 'all' || filterType === 'tv') ? 'multi' : 'movie';
    const params = { query: currentQuery, page: currentPage, include_adult: false };
    if (currentYear && filterType === 'movie') params.year = currentYear;
    const data  = await tmdb(`search/${searchType}`, params);
    let items   = (data.results || [])
      .map(m => normalise(m, m.media_type || filterType || 'movie'))
      .filter(m => m.type === 'movie' || m.type === 'tv');
    items = applyClientFilters(items);
    items = applySortMode(items, currentQuery);
    totalPages = data.total_pages || 1;
    if (currentPage === 1) grid.innerHTML = '';
    if (items.length) renderCards(items);
    else if (currentPage === 1) renderEmpty('No results found.');
    setStatus(data.total_results ? `${data.total_results.toLocaleString()} results · page ${currentPage} of ${totalPages}` : '');
    currentPage++;
    if (currentPage > totalPages) exhausted = true;
  } catch { setStatus('Search failed.', true); }
  isFetching = false; showSpinner(false);
}

// ──────────────────────────────────────────────────────────
//  NORMALISE
// ──────────────────────────────────────────────────────────
function normalise(m, type) {
  return {
    id:         m.id,
    type:       type === 'tv' ? 'tv' : 'movie',
    title:      m.title || m.name || 'Untitled',
    year:       (m.release_date || m.first_air_date || '').slice(0, 4),
    poster:     m.poster_path   ? `${IMG_BASE}w342${m.poster_path}`  : null,
    backdrop:   m.backdrop_path ? `${IMG_BASE}w780${m.backdrop_path}` : null,
    rating:     m.vote_average  ? +m.vote_average.toFixed(1) : 0,
    votes:      m.vote_count    || 0,
    popularity: m.popularity    || 0,
    overview:   m.overview      || '',
    genreIds:   m.genre_ids     || [],
    raw:        m,
  };
}

// ──────────────────────────────────────────────────────────
//  CLIENT FILTERS
// ──────────────────────────────────────────────────────────
function applyClientFilters(items) {
  return items.filter(m => {
    if (filterType !== 'all' && m.type !== filterType) return false;
    if (filterGenreId   && !m.genreIds.includes(+filterGenreId)) return false;
    if (filterMinRating && m.rating < +filterMinRating) return false;
    if (filterMinVotes  && m.votes  < +filterMinVotes)  return false;
    return true;
  });
}

// ──────────────────────────────────────────────────────────
//  SCORING
// ──────────────────────────────────────────────────────────
function browseScore(m) {
  const year    = parseInt(m.year, 10) || 1900;
  const recency = Math.min(1, Math.max(0, (year - 1900) / (NOW_YEAR - 1900)));
  return (m.rating * 0.55) + (Math.min(m.popularity, 1000) / 1000 * 10 * 0.25) + (recency * 10 * 0.20);
}

function applySortMode(items, query) {
  const q = (query || '').toLowerCase().trim();
  switch (sortMode) {
    case 'rating':     return [...items].sort((a, b) => b.rating - a.rating);
    case 'popularity': return [...items].sort((a, b) => b.popularity - a.popularity);
    case 'year_desc':  return [...items].sort((a, b) => (+b.year||0) - (+a.year||0));
    case 'year_asc':   return [...items].sort((a, b) => (+a.year||0) - (+b.year||0));
    case 'relevance':  return [...items].sort((a, b) => relevanceScore(b,q) - relevanceScore(a,q));
    default:
      return [...items].sort((a, b) => {
        const rel = relevanceScore(b,q) - relevanceScore(a,q);
        const scr = browseScore(b) - browseScore(a);
        return rel * 0.5 + scr * 0.5;
      });
  }
}

function relevanceScore(m, q) {
  if (!q) return 0;
  const t = m.title.toLowerCase();
  if (t === q)          return 100;
  if (t.startsWith(q))  return 80;
  if (t.includes(q))    return 60;
  return q.split(/\s+/).filter(w => t.includes(w)).length * 20;
}

// ──────────────────────────────────────────────────────────
//  RENDER CARDS  (with progress bars for in-progress titles)
// ──────────────────────────────────────────────────────────
function renderCards(items) {
  items.forEach((m, i) => {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(`cs_progress_${m.type}_${m.id}`)); } catch { return null; } })();
    const pct   = saved?.progress || 0;

    const card = document.createElement('div');
    card.className = 'movie-card relative overflow-hidden cursor-pointer bg-card animate-fadeUp';
    card.style.aspectRatio    = '2/3';
    card.style.animationDelay = `${(i % 10) * 45}ms`;
    card.onclick = () => openModal(m.id, m.type);

    card.innerHTML = m.poster
      ? `<img src="${m.poster}" alt="${escHtml(m.title)}" loading="lazy" class="card-img w-full h-full object-cover block absolute inset-0"/>`
      : `<div class="w-full h-full flex flex-col items-center justify-center gap-2 text-muted select-none">
           <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"/></svg>
           <span class="text-xs tracking-widest uppercase">No Poster</span>
         </div>`;

    if (m.rating) {
      card.innerHTML += `<div class="absolute top-2 right-2 bg-black/70 text-accent font-display text-sm px-1.5 py-0.5 leading-none tracking-wide">★${m.rating}</div>`;
    }

    // Progress bar on card bottom
    if (pct > 2) {
      card.innerHTML += `
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-border/60">
          <div class="h-full bg-accent" style="width:${pct}%"></div>
        </div>`;
    }

    card.innerHTML += `
      <div class="card-overlay absolute inset-0 flex flex-col justify-end p-3"
           style="background:linear-gradient(to top,rgba(9,9,15,.97) 0%,rgba(9,9,15,.2) 55%,transparent 100%)">
        <p class="text-accent text-xs tracking-widest uppercase mb-0.5">${m.year}</p>
        <p class="font-display text-lg leading-tight tracking-wide text-light">${escHtml(m.title)}</p>
        <p class="text-muted text-xs tracking-widest uppercase mt-1">${m.type === 'tv' ? 'TV Show' : 'Movie'}</p>
        ${pct > 2 ? `<p class="text-accent text-xs mt-1">${pct}% watched</p>` : ''}
      </div>`;

    grid.appendChild(card);
  });
}

// ──────────────────────────────────────────────────────────
//  SKELETONS / EMPTY
// ──────────────────────────────────────────────────────────
function renderSkeletons(n) {
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'shimmer-bar bg-card';
    s.style.aspectRatio = '2/3';
    grid.appendChild(s);
  }
}

function renderEmpty(msg) {
  grid.innerHTML = `
    <div class="col-span-full flex flex-col items-center justify-center py-24 gap-4">
      <span class="text-5xl grayscale">🎬</span>
      <h3 class="font-display text-3xl tracking-widest text-border">No Results</h3>
      <p class="text-muted text-sm tracking-wide">${escHtml(msg)}</p>
    </div>`;
}

function setStatus(msg, err = false) {
  statusEl.textContent = msg;
  statusEl.className   = `px-5 md:px-12 pb-3 text-xs tracking-widest uppercase min-h-5 ${err ? 'text-danger' : 'text-muted'}`;
}

function showSpinner(v) { spinner.classList.toggle('hidden', !v); }

// ──────────────────────────────────────────────────────────
//  TRIGGERS
// ──────────────────────────────────────────────────────────
function triggerSearch() {
  const q = searchInput.value.trim();
  if (!q) { resetToHome(); return; }
  mode = 'search'; currentQuery = q; currentPage = 1; exhausted = false;
  grid.innerHTML = '';
  bannerWrap.classList.add('hidden'); clearInterval(bannerTimer);
  sectionTitle.textContent = `"${q}"`;
  sectionSub.textContent   = '';
  sortWrap.classList.remove('hidden');
  setStatus('Searching…'); renderSkeletons(12);
  loadSearch();
}

function clearSearch() { searchInput.value = ''; clearBtn.classList.add('hidden'); resetToHome(); }

function resetToHome() {
  mode = 'browse'; currentQuery = ''; currentPage = 1; exhausted = false;
  browseSourceIdx = 0; browsePage = 1;
  searchInput.value = ''; clearBtn.classList.add('hidden');
  grid.innerHTML = '';
  bannerWrap.classList.remove('hidden');
  sectionTitle.textContent = 'Discover';
  sectionSub.textContent   = 'Top rated & popular';
  sortWrap.classList.add('hidden');
  setStatus(''); renderSkeletons(16);
  renderContinueWatching();
  startBannerTimer();
  loadNextPage();
}

function onSortChange() {
  sortMode = document.getElementById('sortSelect').value;
  currentPage = 1; exhausted = false;
  grid.innerHTML = ''; renderSkeletons(12); loadSearch();
}

// ──────────────────────────────────────────────────────────
//  FILTER BAR
// ──────────────────────────────────────────────────────────
function toggleFilterBar() {
  filterOpen = !filterOpen;
  document.getElementById('filterBar').classList.toggle('open', filterOpen);
}

function setTypeFilter(val) {
  filterType = val;
  ['All','Movie','Tv'].forEach(t => {
    document.getElementById(`type${t}`)?.classList.toggle('active', val === t.toLowerCase());
  });
  rerun();
}

function setGenreFilter(val)  { filterGenreId    = val; rerun(); updateFilterCount(); }
function setRatingFilter(val) { filterMinRating   = val; rerun(); updateFilterCount(); }
function setVotesFilter(val)  { filterMinVotes    = val; rerun(); updateFilterCount(); }

function clearAllFilters() {
  filterType = 'all'; filterGenreId = ''; filterMinRating = ''; filterMinVotes = '';
  ['All','Movie','Tv'].forEach(t => document.getElementById(`type${t}`)?.classList.toggle('active', t === 'All'));
  document.getElementById('genreSelect').value  = '';
  document.getElementById('ratingSelect').value = '';
  document.getElementById('votesSelect').value  = '';
  rerun(); updateFilterCount();
}

function updateFilterCount() {
  const n = [filterGenreId, filterMinRating, filterMinVotes].filter(Boolean).length + (filterType !== 'all' ? 1 : 0);
  const el = document.getElementById('filterCount');
  el.textContent = n; el.classList.toggle('hidden', n === 0);
}

function rerun() {
  currentPage = 1; exhausted = false; grid.innerHTML = '';
  if (mode === 'browse') { browseSourceIdx = 0; browsePage = 1; renderSkeletons(16); loadBrowse(); }
  else { renderSkeletons(12); loadSearch(); }
}

// ──────────────────────────────────────────────────────────
//  YEAR PICKER
// ──────────────────────────────────────────────────────────
function selectYear(y) {
  currentYear = y;
  yearLabel.textContent = y ? String(y) : 'All Years';
  buildYearGrid(); closeYearPicker(); rerun();
}

function toggleYearPicker() { pickerOpen ? closeYearPicker() : openYearPicker(); }
function openYearPicker()   { pickerOpen = true;  yearDropdown.classList.remove('hidden'); yearChevron.style.transform = 'rotate(180deg)'; }
function closeYearPicker()  { pickerOpen = false; yearDropdown.classList.add('hidden');    yearChevron.style.transform = 'rotate(0deg)'; }
function shiftDecade(dir)   { decadeStart += dir * 10; buildYearGrid(); }

function buildYearGrid() {
  decadeLabel.textContent = `${decadeStart} – ${decadeStart + 9}`;
  yearGridEl.innerHTML = '';
  for (let y = decadeStart; y <= decadeStart + 9; y++) {
    const btn = document.createElement('button');
    const active = currentYear === y, future = y > NOW_YEAR;
    btn.textContent = y; btn.disabled = future;
    btn.className = ['py-2 text-sm tracking-wide transition-colors',
      active  ? 'bg-accent text-bg font-medium'
      : future ? 'text-border cursor-not-allowed'
      :          'text-muted hover:text-accent hover:bg-white/5'].join(' ');
    if (!future) btn.onclick = () => selectYear(y);
    yearGridEl.appendChild(btn);
  }
}

// ──────────────────────────────────────────────────────────
//  MODAL
// ──────────────────────────────────────────────────────────
async function openModal(id, type) {
  modalBd.classList.add('open'); document.body.style.overflow = 'hidden';
  modalPoster.innerHTML = `<div class="w-full h-full min-h-64 flex items-center justify-center text-muted text-xs tracking-widest uppercase bg-card">Loading…</div>`;
  modalBody.innerHTML   = `<p class="text-muted text-xs tracking-widest uppercase p-8">Fetching details…</p>`;

  try {
    const endpoint = type === 'tv'
      ? `tv/${id}?append_to_response=credits`
      : `movie/${id}?append_to_response=credits,release_dates`;
    const m = await tmdb(endpoint);

    const title   = m.title || m.name || '—';
    const year    = (m.release_date || m.first_air_date || '').slice(0, 4);
    const runtime = m.runtime ? `${m.runtime} min` : (m.episode_run_time?.[0] ? `${m.episode_run_time[0]} min/ep` : '');
    const rating  = m.vote_average ? m.vote_average.toFixed(1) : '—';
    const votes   = m.vote_count   ? m.vote_count.toLocaleString() : '';
    const genres  = (m.genres || []).map(g => g.name).join(', ') || '—';
    const overview= m.overview || 'No overview available.';
    const poster  = m.poster_path ? `${IMG_BASE}w342${m.poster_path}` : null;
    const director= (m.credits?.crew || []).find(c => c.job === 'Director')?.name || '';
    const cast    = (m.credits?.cast || []).slice(0, 6).map(c => c.name).join(', ');
    const tagline = m.tagline ? `<p class="italic text-sm" style="color:#6b6b82">"${escHtml(m.tagline)}"</p>` : '';

    // Progress for this title
    const saved = (() => { try { return JSON.parse(localStorage.getItem(`cs_progress_${type}_${id}`)); } catch { return null; } })();
    const pct   = saved?.progress || 0;
    const progressHTML = pct > 2 ? `
      <div class="flex flex-col gap-1.5">
        <div class="flex justify-between">
          <span class="text-xs tracking-widest uppercase text-muted">Progress</span>
          <span class="text-xs text-accent">${pct}% watched</span>
        </div>
        <div class="w-full h-1 bg-border overflow-hidden">
          <div class="h-full bg-accent" style="width:${pct}%"></div>
        </div>
      </div>` : '';

    const seasons = type === 'tv' && m.number_of_seasons
      ? `<div><p class="text-muted text-xs tracking-widest uppercase mb-0.5">Seasons</p><p class="text-light text-sm">${m.number_of_seasons} seasons · ${m.number_of_episodes} episodes</p></div>`
      : '';

    modalPoster.innerHTML = `
      ${poster
        ? `<img src="${poster}" alt="${escHtml(title)}" class="w-full h-full object-cover block" style="filter:saturate(.85)">`
        : `<div class="w-full h-full min-h-64 flex items-center justify-center bg-card text-muted text-xs tracking-widest uppercase">No Poster</div>`}
      <div class="absolute top-3 left-3 bg-accent text-bg font-display text-xl tracking-wide px-2.5 py-1 leading-none">★ ${rating}</div>
      ${pct > 2 ? `<div class="absolute bottom-0 left-0 right-0 h-1 bg-border/60"><div class="h-full bg-accent" style="width:${pct}%"></div></div>` : ''}`;

    const pills = [
      { t: year, accent: true },
      { t: type === 'tv' ? 'TV Show' : 'Movie' },
      ...(runtime ? [{ t: runtime }] : []),
    ].map(p => `<span class="text-xs tracking-widest uppercase px-2.5 py-1 border ${p.accent ? 'border-accent text-accent' : 'border-border text-muted'}">${p.t}</span>`).join('');

    const details = [
      ['Genre',    genres],
      ...(director ? [['Director', escHtml(director)]] : []),
      ...(cast     ? [['Starring', escHtml(cast)]]     : []),
      ['Rating',   `<span class="text-accent font-display text-lg">★ ${rating}</span> <span class="text-muted text-xs">(${votes} votes)</span>`],
      ['Status',   escHtml(m.status || '—')],
      ['Language', (m.original_language || '').toUpperCase()],
      ...(m.budget  ? [['Budget',  `$${(m.budget/1e6).toFixed(1)}M`]]  : []),
      ...(m.revenue ? [['Revenue', `$${(m.revenue/1e6).toFixed(1)}M`]] : []),
    ].map(([l, v]) => `<div><p class="text-muted text-xs tracking-widest uppercase mb-0.5">${l}</p><p class="text-light text-sm leading-snug">${v}</p></div>`).join('');

    modalBody.innerHTML = `
      <div class="flex flex-wrap gap-2">${pills}</div>
      <h2 class="font-display text-4xl md:text-5xl tracking-widest leading-none">${escHtml(title)}</h2>
      ${tagline}
      <p class="text-sm leading-relaxed" style="color:#9090a8">${escHtml(overview)}</p>
      ${progressHTML}
      <button onclick="goWatch(${m.id},'${type}')"
              class="bg-accent hover:bg-yellow-300 transition-colors text-bg font-display tracking-widest px-6 py-2.5 text-base flex items-center gap-2 w-fit">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        ${pct > 2 ? 'Resume' : 'Watch Now'}
      </button>
      <div class="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4">${details}${seasons}</div>`;

  } catch (err) {
    modalBody.innerHTML = `<p class="text-danger text-xs tracking-widest uppercase p-8">${err.message}</p>`;
  }
}

function backdropClose(e) { if (e.target === modalBd) closeModal(); }
function closeModal() { modalBd.classList.remove('open'); document.body.style.overflow = ''; }

// ──────────────────────────────────────────────────────────
//  NAVIGATION
// ──────────────────────────────────────────────────────────
function goWatch(id, type) { location.href = `watch.html?id=${id}&type=${type}`; }

// ──────────────────────────────────────────────────────────
//  UTIL
// ──────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}