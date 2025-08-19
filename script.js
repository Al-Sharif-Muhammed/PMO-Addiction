// No-PMO — Local-first app
// All data stored in LocalStorage; no network, no cookies.

(function () {
  'use strict';

  // Storage keys
  const KEY = 'nopmo:v1';

  // DOM refs
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    rankBadge: $('#rankBadge'),
  rankImageLarge: $('#rankImageLarge'),
  rankLabel: $('#rankLabel'),
  nextRankAlt: $('#nextRankAlt'),
    levelValue: $('#levelValue'),
    nextRank: $('#nextRank'),
    ringVisual: $('#ringVisual'),
    countdown: $('#countdown'),
    progressBar: $('#progressBar'),
    progressText: $('#progressText'),

    pornTimer: $('#pornTimer'),
    mastTimer: $('#mastTimer'),
    pornLastReset: $('#pornLastReset'),
    mastLastReset: $('#mastLastReset'),
    pornRelapses: $('#pornRelapses'),
    mastRelapses: $('#mastRelapses'),

    logPorn: $('#logPorn'),
    logMast: $('#logMast'),
    logBoth: $('#logBoth'),

    heatmapGrid: $('#heatmapGrid'),

    setStreakBtn: $('#setStreakBtn'),
    exportBtn: $('#exportBtn'),
    importBtn: $('#importBtn'),
    importFile: $('#importFile'),
    resetBtn: $('#resetBtn'),

    modal: $('#modal'),
    modalClose: $('#modalClose'),
    modalDate: $('#modalDate'),
  modalSave: $('#modalSave'),

    streakModal: $('#streakModal'),
    streakModalClose: $('#streakModalClose'),
    streakModalSave: $('#streakModalSave'),
    pornStartDate: $('#pornStartDate'),
    mastStartDate: $('#mastStartDate'),
    updateHeatmapStart: $('#updateHeatmapStart'),
  };

  // App state shape
  // times in ms epoch; heatmap by YYYY-MM-DD => 'green' | 'yellow' | 'red'
  const defaultState = () => ({
    createdAt: Date.now(),
    // Streak anchors are last reset times
    porn: { lastResetAt: Date.now(), relapses: 0 },
    mast: { lastResetAt: Date.now(), relapses: 0 },
    // Heatmap starts first challenge day (first midnight after porn last reset)
    heatmap: {},
    // Optional: explicit startDay for heatmap
    startDayISO: null, // computed from porn.lastResetAt on first run
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      // schema migration if needed
      if (!parsed.porn) parsed.porn = { lastResetAt: Date.now(), relapses: 0 };
      if (!parsed.mast) parsed.mast = { lastResetAt: Date.now(), relapses: 0 };
      if (!parsed.heatmap) parsed.heatmap = {};
      if (!parsed.startDayISO) parsed.startDayISO = isoDayFromTs(parsed.porn.lastResetAt);
      return parsed;
    } catch (e) {
      console.warn('Failed to load state, resetting.', e);
      return defaultState();
    }
  }

  function saveState(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }

  let state = loadState();
  if (!state.startDayISO) {
    state.startDayISO = isoDayFromTs(state.porn.lastResetAt);
    saveState(state);
  }

  // Time helpers
  const DAY_SEC = 86400;
  const HOUR_SEC = 3600;
  const MIN_SEC = 60;

  function isoDayFromTs(ts) {
    // Returns YYYY-MM-DD in local time
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function toLocalDateMidnight(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function fmtDHMS(secs) {
    const d = Math.floor(secs / DAY_SEC);
    secs -= d * DAY_SEC;
    const h = Math.floor(secs / HOUR_SEC);
    secs -= h * HOUR_SEC;
    const m = Math.floor(secs / MIN_SEC);
    secs -= m * MIN_SEC;
    const s = Math.floor(secs);
    return `${String(d).padStart(2, '0')}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function fmtHMS(secs) {
    const h = Math.floor(secs / HOUR_SEC);
    secs -= h * HOUR_SEC;
    const m = Math.floor(secs / MIN_SEC);
    secs -= m * MIN_SEC;
    const s = Math.floor(secs);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function fmtDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString();
  }

  // Convert timestamp to datetime-local format (YYYY-MM-DDTHH:mm)
  function toDateTimeLocal(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  }

  // Convert datetime-local format back to timestamp
  function fromDateTimeLocal(dtStr) {
    if (!dtStr) return Date.now();
    const d = new Date(dtStr);
    return d.getTime();
  }

  // Rank mapping — 27-step progression using I/II/III divisions (Master+ lack III)
  // Order: Iron III, II, I, Bronze III..I, Silver III..I, Gold III..I, Platinum III..I, Emerald III..I, Diamond III..I, Master II, I, Grand Master II, I, Challenger II, I
  const ORDERED_RANKS = [
    'Iron III','Iron II','Iron I',
    'Bronze III','Bronze II','Bronze I',
    'Silver III','Silver II','Silver I',
    'Gold III','Gold II','Gold I',
    'Platinum III','Platinum II','Platinum I',
    'Emerald III','Emerald II','Emerald I',
    'Diamond III','Diamond II','Diamond I',
    'Master II','Master I',
    'Grand Master II','Grand Master I',
    'Challenger II','Challenger I',
  ];

  // Custom increasing spans so Challenger I starts at day 100 exactly (first 26 ranks sum to 100 days).
  // Spans (26 values): 1,1,1, 2x5, 3x6, 4x6, 5x4, 12,13 => total 100.
  // The 27th (Challenger I) is open-ended from day 100 onward.
  const STEP_SPANS = [
    1,1,1,
    2,2,2,2,2,
    3,3,3,3,3,3,
    4,4,4,4,4,4,
    5,5,5,5,
    12,13,
    Number.POSITIVE_INFINITY,
  ];

  const LEVEL_RANGES = (() => {
    let cur = 0;
    return ORDERED_RANKS.map((label, i) => {
      const span = STEP_SPANS[i] ?? Number.POSITIVE_INFINITY;
      const min = cur;
      const max = (span === Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : (cur + span - 1);
      if (span !== Number.POSITIVE_INFINITY) cur = max + 1; else cur = max; // keep cur at Infinity for completeness
      return { min, max, label };
    });
  })();

  function levelFromSeconds(pornSeconds) {
    return Math.floor(pornSeconds / DAY_SEC);
  }

  // Remaining time to next rank (not next day). If already at final rank, 0.
  function challengeRemainingSecondsToNextRank(pornSeconds) {
    const levelDays = Math.floor(pornSeconds / DAY_SEC);
    const current = rankFromLevel(levelDays);
    if (!current.next) return 0;
    const nextLabel = current.next;
    const nextRange = LEVEL_RANGES.find(r => r.label === nextLabel);
    if (!nextRange) return 0;
    // Next rank starts at nextRange.min days
    const targetSeconds = nextRange.min * DAY_SEC;
    return Math.max(targetSeconds - pornSeconds, 0);
  }

  function rankFromLevel(levelDays) {
    const last = LEVEL_RANGES[LEVEL_RANGES.length - 1];
    for (let i = LEVEL_RANGES.length - 1; i >= 0; i--) {
      const r = LEVEL_RANGES[i];
      if (levelDays >= r.min && levelDays <= r.max) {
        const current = r.label;
        const next = LEVEL_RANGES[i + 1] ? LEVEL_RANGES[i + 1].label : null;
        return { label: current, current, next };
      }
    }
    // below first range
    const first = LEVEL_RANGES[0];
    return { label: first.label, current: first.label, next: LEVEL_RANGES[1].label };
  }

  // Map rank labels to your new files: Tier + I/II/III (Master+ only I/II). E.g., GoldIII.png, GrandmasterII.png
  const RANK_IMAGE_MAP = (() => {
    const m = new Map();
    const baseName = (tier) => tier === 'Grand Master' ? 'Grandmaster' : tier.replace(/\s+/g, '');
    for (const label of ORDERED_RANKS) {
      const parts = label.split(' ');
      const division = parts.pop(); // I | II | III
      const tier = parts.join(' ');
      const file = `ranks/${baseName(tier)}${division}.png`;
      m.set(label, file);
    }
    return m;
  })();

  // Heatmap handling
  function setHeatmapDay(iso, status) {
    if (status === 'clear') {
      delete state.heatmap[iso];
    } else {
      state.heatmap[iso] = status; // 'green' | 'yellow' | 'red'
    }
    saveState(state);
    renderHeatmap();
  }

  function getHeatmapRange() {
    // From startDayISO up to today
    const start = new Date(state.startDayISO + 'T00:00:00');
    const today = new Date();
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.round((today.getTime() - start.getTime()) / 86400000) + 1);
    return { start, days };
  }

  function renderHeatmap() {
    const { start, days } = getHeatmapRange();
    els.heatmapGrid.innerHTML = '';
    const todayISO = isoDayFromTs(Date.now());
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = isoDayFromTs(d.getTime());
      let status = state.heatmap[iso] || null;
      // Default past days without explicit status to green (clean), keep today unset unless user marks it
      if (!status && iso < todayISO) status = 'green';
      const div = document.createElement('button');
      div.className = 'heatmap-day';
      div.setAttribute('role', 'gridcell');
      div.dataset.date = iso;
      if (status) div.dataset.status = status;
      div.title = `${iso}${status ? ` — ${status}` : ''}`;
      div.innerHTML = `<span class="tooltip">${iso}${status ? ` — ${status}` : ''}</span>`;
      div.addEventListener('click', () => openModalForDay(iso, status));
      els.heatmapGrid.appendChild(div);
    }
  }

  // Modal
  let modalCurrentISO = null;
  function openModalForDay(iso, status) {
    modalCurrentISO = iso;
    els.modalDate.textContent = iso;
    // Set radios
    const radios = $$('input[name="dayStatus"]');
    radios.forEach(r => { r.checked = (r.value === (status || '')); });
    els.modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    els.modal.setAttribute('aria-hidden', 'true');
    modalCurrentISO = null;
  }

  // Streak Modal
  function openStreakModal() {
    // Pre-populate with current streak start times
    els.pornStartDate.value = toDateTimeLocal(state.porn.lastResetAt);
    els.mastStartDate.value = toDateTimeLocal(state.mast.lastResetAt);
    els.updateHeatmapStart.checked = true;
    els.streakModal.setAttribute('aria-hidden', 'false');
  }
  function closeStreakModal() {
    els.streakModal.setAttribute('aria-hidden', 'true');
  }
  function saveStreakDates() {
    const pornStart = fromDateTimeLocal(els.pornStartDate.value);
    const mastStart = fromDateTimeLocal(els.mastStartDate.value);
    const updateHeatmap = els.updateHeatmapStart.checked;
    
    // Update state
    state.porn.lastResetAt = pornStart;
    state.mast.lastResetAt = mastStart;
    
    // Update heatmap start if requested
    if (updateHeatmap) {
      state.startDayISO = isoDayFromTs(pornStart);
    }
    
    saveState(state);
    renderAll();
    closeStreakModal();
  }

  // Relapse logging
  function logRelapse(kind) {
    const now = Date.now();
    const todayISO = isoDayFromTs(now);
    if (kind === 'porn' || kind === 'both') {
      state.porn.lastResetAt = now;
      state.porn.relapses += 1;
      state.startDayISO = state.startDayISO || isoDayFromTs(now); // if unset
      state.heatmap[todayISO] = 'red';
    }
    if (kind === 'mast' || kind === 'both') {
      state.mast.lastResetAt = now;
      state.mast.relapses += 1;
      // only set yellow if not already red
      if ((state.heatmap[todayISO] || null) !== 'red') {
        state.heatmap[todayISO] = 'yellow';
      }
    }
    saveState(state);
    // re-render aspects
    renderAll();
  }

  // Export/Import/Reset
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nopmo-data.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || '{}'));
        // basic validation
        if (!data || typeof data !== 'object') throw new Error('Bad JSON');
        state = Object.assign(defaultState(), data);
        if (!state.startDayISO) state.startDayISO = isoDayFromTs(state.porn.lastResetAt);
        saveState(state);
        renderAll();
        alert('Import successful.');
      } catch (e) {
        alert('Import failed: invalid JSON.');
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm('Reset ALL data? This cannot be undone.')) return;
    state = defaultState();
    state.startDayISO = isoDayFromTs(state.porn.lastResetAt);
    saveState(state);
    renderAll();
  }

  // Timers and rendering
  function computePornSeconds() {
    return Math.max(0, Math.floor((Date.now() - state.porn.lastResetAt) / 1000));
  }
  function computeMastSeconds() {
    return Math.max(0, Math.floor((Date.now() - state.mast.lastResetAt) / 1000));
  }

  function renderChallenge() {
    const pornSec = computePornSeconds();
    const level = levelFromSeconds(pornSec);
  // Progress within the current rank step
  const lvlDays = Math.floor(pornSec / DAY_SEC);
  const curRange = LEVEL_RANGES.find(r => lvlDays >= r.min && lvlDays <= r.max) || LEVEL_RANGES[0];
  const stepStartSec = curRange.min * DAY_SEC;
  const stepSpanSec = (curRange.max === Number.POSITIVE_INFINITY ? (lvlDays + 1) * DAY_SEC : (curRange.max + 1) * DAY_SEC) - stepStartSec;
  const stepProgSec = Math.max(0, pornSec - stepStartSec);
  const pct = Math.max(0, Math.min(100, Math.floor((stepProgSec / stepSpanSec) * 100)));
  const remain = challengeRemainingSecondsToNextRank(pornSec);

    els.levelValue.textContent = String(level);
    const rank = rankFromLevel(level);
    els.rankBadge.textContent = rank.label;
    els.nextRank.textContent = rank.next || '—';
    if (els.rankLabel) els.rankLabel.textContent = rank.label;
    if (els.nextRankAlt) els.nextRankAlt.textContent = rank.next || '—';

    // Update rank large image based on label mapping
    if (els.rankImageLarge) {
      const imgSrc = RANK_IMAGE_MAP.get(rank.label) || RANK_IMAGE_MAP.get('Diamond II');
      els.rankImageLarge.src = imgSrc;
      els.rankImageLarge.alt = rank.label;
    }

  els.countdown.textContent = fmtDHMS(remain);
  els.progressBar.style.width = `${pct}%`;
  els.progressText.textContent = `${pct}% of rank`;
    els.ringVisual.style.setProperty('--pct', pct);
  }

  function renderStreaks() {
    const pornSec = computePornSeconds();
    const mastSec = computeMastSeconds();
    els.pornTimer.textContent = fmtDHMS(pornSec);
    els.mastTimer.textContent = fmtDHMS(mastSec);
    els.pornLastReset.textContent = fmtDateTime(state.porn.lastResetAt);
    els.mastLastReset.textContent = fmtDateTime(state.mast.lastResetAt);
    els.pornRelapses.textContent = String(state.porn.relapses);
    els.mastRelapses.textContent = String(state.mast.relapses);
  }

  function renderAll() {
    renderChallenge();
    renderStreaks();
    renderHeatmap();
  }

  // Live clock
  let ticker = null;
  function startTicker() {
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => {
      renderChallenge();
      renderStreaks();
    }, 1000);
  }

  function initListeners() {
    els.logPorn.addEventListener('click', () => logRelapse('porn'));
    els.logMast.addEventListener('click', () => logRelapse('mast'));
    els.logBoth.addEventListener('click', () => logRelapse('both'));

    els.setStreakBtn.addEventListener('click', openStreakModal);
    els.exportBtn.addEventListener('click', exportData);
    els.importBtn.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importData(file);
      e.target.value = '';
    });

    els.resetBtn.addEventListener('click', resetAll);

    els.modalClose.addEventListener('click', closeModal);
    els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
    els.modalSave.addEventListener('click', () => {
      const selected = (document.querySelector('input[name="dayStatus"]:checked') || {}).value || 'clear';
      if (modalCurrentISO) setHeatmapDay(modalCurrentISO, selected);
      closeModal();
    });

    els.streakModalClose.addEventListener('click', closeStreakModal);
    els.streakModal.addEventListener('click', (e) => { if (e.target === els.streakModal) closeStreakModal(); });
    els.streakModalSave.addEventListener('click', saveStreakDates);

  // no test tools
  }

  // Initialize heatmap starting point if empty
  if (!state.startDayISO) state.startDayISO = isoDayFromTs(state.porn.lastResetAt);

  // Boot
  renderAll();
  startTicker();
  initListeners();
})();
