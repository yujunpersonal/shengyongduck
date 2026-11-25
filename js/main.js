/* Controls: dual ranges, environment, species, practice (mount / swing / fire), sound, persistence. */
(function () {
  const DF = window.DuckFlight;
  const $ = s => document.querySelector(s);
  const STORE = 'duckflight.settings.v1';
  const defaults = { freq: [20, 20], speed: [.8, 1.25], env: 'wetland', species: Object.keys(DF.SPECIES), sound: true, volume: .7, ghost: true };

  let cfg;
  try { cfg = Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { cfg = Object.assign({}, defaults); }
  if (!DF.ENVIRONMENTS[cfg.env]) cfg.env = defaults.env;
  if (!Array.isArray(cfg.freq) || (cfg.freq[0] === 2 && cfg.freq[1] === 5)) cfg.freq = defaults.freq.slice();   // old default -> new default
  cfg.species = (cfg.species || []).filter(k => DF.SPECIES[k]);
  if (!cfg.species.length) cfg.species = defaults.species.slice();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = $('#scene'), logEl = $('#log'), toast = $('#toast');
  const audio = DF.createAudio();
  audio.setVolume(cfg.volume);

  let fresh, cardTimer;
  const stats = { shots: 0, birds: 0 };
  const scene = DF.createScene(canvas, {
    cfg, audio, paused: reduced, reducedMotion: reduced,
    onEvent(ev) {
      logEl.textContent = `${ev.name} ${ev.sex}${ev.count > 1 ? ' + ' + (ev.count - 1) : ''} · ${ev.verb} · ${ev.yd} yd · ${ev.kmh} km/h`;
      toast.classList.add('fresh'); clearTimeout(fresh); fresh = setTimeout(() => toast.classList.remove('fresh'), 2500);
    },
    onGun(g) {
      canvas.classList.toggle('mounted', g.mounted);
      $('#gun-state').textContent = g.mounted ? 'Mounted' : 'Low ready';
      $('#shells').innerHTML = [0, 1, 2].map(i => `<i class="${i < g.shells ? '' : 'spent'}"></i>`).join('');
    },
    onShot(r) { stats.shots++; stats.birds += r.kills.length; showStats(); showShot(r); }
  });
  scene.setShowGhost(cfg.ghost);

  /* ---------- shot feedback ---------- */
  const ft = v => `${Math.abs(v).toFixed(1)} ft`;
  function showShot(r) {
    const card = $('#shot-card'), head = $('#shot-head'), det = $('#shot-detail');
    const t = r.target;
    if (r.hit) {
      const k = r.kills[0];
      head.textContent = `Bird down · ${k.name} ${k.sex}${r.kills.length > 1 ? ` + ${r.kills.length - 1}` : ''} · ${k.yd} yd`;
    } else if (t) {
      const parts = [];
      if (Math.abs(t.along) >= .3) parts.push(`${t.along < 0 ? 'behind' : 'ahead'} ${ft(t.along)}`);
      if (Math.abs(t.vert) >= .3) parts.push(`${t.vert < 0 ? 'high' : 'low'} ${ft(t.vert)}`);
      head.textContent = `Miss · ${parts.join(', ') || 'just off the pattern edge'}`;
    } else head.textContent = 'Shot · no bird in range';

    const lines = [];
    if (t) lines.push(t.kmh >= 2 ? `${t.name} ${t.sex} · ${t.yd} yd · ${t.kmh} km/h · lead needed ≈ ${t.leadNeeded.toFixed(1)} ft` : `${t.name} ${t.sex} · ${t.yd} yd · sitting`);
    const timing = [];
    if (r.sinceSight != null) timing.push(`shot ${r.sinceSight.toFixed(1)} s after the birds appeared`);
    timing.push(`${r.sinceMount.toFixed(2)} s after mount`);
    lines.push([...r.notes, ...timing].join(' · '));
    det.innerHTML = '';
    lines.forEach(l => { const s = document.createElement('span'); s.textContent = l; s.style.display = 'block'; det.appendChild(s); });
    if (r.flags.length) { const s = document.createElement('span'); s.className = 'flag'; s.style.display = 'block'; s.textContent = r.flags.join(' · '); det.appendChild(s); }

    card.classList.toggle('hit', r.hit);
    card.hidden = false;
    clearTimeout(cardTimer); cardTimer = setTimeout(() => { card.hidden = true; }, 4500);
  }
  function showStats() {
    const pct = stats.shots ? Math.round(stats.birds / stats.shots * 100) : 0;
    $('#stats').textContent = `${stats.birds} birds · ${stats.shots} shots${stats.shots ? ` · ${pct}%` : ''}`;
  }
  showStats();

  /* ---------- mouse: aim, mount, fire ---------- */
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const unlock = () => audio.unlock();
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);

  canvas.addEventListener('pointermove', e => { const [x, y] = pos(e); scene.setAim(x, y); });
  canvas.addEventListener('pointerdown', e => {
    const [x, y] = pos(e); scene.setAim(x, y);
    if (e.button === 2) { scene.mount(true); return; }
    if (e.button === 0) { if (scene.isMounted()) scene.fire(); else scene.launch(x, y); }
  });
  window.addEventListener('pointerup', e => { if (e.button === 2 && !mToggle) scene.mount(false); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  let mToggle = false;

  /* ---------- dual-thumb ranges ---------- */
  function dualRange(el, value, fmt, onChange) {
    const [a, b] = el.querySelectorAll('input'), fill = el.querySelector('.fill');
    const { min, max, step } = el.dataset;
    [a, b].forEach(i => { i.min = min; i.max = max; i.step = step; });
    a.value = value[0]; b.value = value[1];
    const draw = () => {
      const lo = +a.value, hi = +b.value, p = v => (v - min) / (max - min);
      fill.style.left = `calc(8px + ${p(lo)} * (100% - 16px))`;
      fill.style.width = `calc(${p(hi) - p(lo)} * (100% - 16px))`;
      fmt(lo, hi);
    };
    const upd = e => {
      if (+a.value > +b.value) { if (e.target === a) a.value = b.value; else b.value = a.value; }
      a.style.zIndex = e.target === a ? 2 : 1; b.style.zIndex = e.target === b ? 2 : 1;
      draw(); onChange([+a.value, +b.value]);
    };
    a.addEventListener('input', upd); b.addEventListener('input', upd);
    draw();
  }

  dualRange($('#freq'), cfg.freq, (lo, hi) => {
    $('#freq-v').textContent = lo === hi ? `${lo} / min` : `${lo}–${hi} / min`;
    const gap = v => { const g = 60 / v; return g < 10 ? g.toFixed(1).replace(/\.0$/, '') : Math.round(g); };
    $('#freq-h').textContent = lo === hi ? `One duck every ${gap(hi)} s on average.` : `One duck every ${gap(hi)}–${gap(lo)} s on average.`;
  }, v => { cfg.freq = v; scene.setConfig({ freq: v }); save(); });

  dualRange($('#speed'), cfg.speed, (lo, hi) => {
    $('#speed-v').textContent = `${lo.toFixed(2)}×–${hi.toFixed(2)}×`;
    $('#speed-h').textContent = `A Mallard at ${Math.round(70 * lo)}–${Math.round(70 * hi)} km/h (1× = real speed). Applies to the next birds.`;
  }, v => { cfg.speed = v; scene.setConfig({ speed: v }); save(); });

  /* volume (single range) */
  const vol = $('#vol input'), volFill = $('#vol .fill');
  vol.value = Math.round(cfg.volume * 100);
  const drawVol = () => { volFill.style.left = '8px'; volFill.style.width = `calc(${vol.value / 100} * (100% - 16px))`; $('#vol-v').textContent = `${vol.value}%`; };
  vol.addEventListener('input', () => { cfg.volume = vol.value / 100; audio.setVolume(cfg.volume); drawVol(); save(); });
  drawVol();

  /* ---------- environment ---------- */
  const envBtns = [...document.querySelectorAll('.dfs-env')];
  function showEnv() {
    envBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.env === cfg.env));
    $('#env-v').textContent = DF.ENVIRONMENTS[cfg.env].name;
  }
  envBtns.forEach(b => b.addEventListener('click', () => {
    if (b.dataset.env === cfg.env) return;
    cfg.env = b.dataset.env; showEnv(); scene.setConfig({ env: cfg.env }); save();
    logEl.textContent = `Watching the ${DF.ENVIRONMENTS[cfg.env].name.toLowerCase()}…`;
  }));
  showEnv();
  logEl.textContent = `Watching the ${DF.ENVIRONMENTS[cfg.env].name.toLowerCase()}…`;

  /* ---------- species ---------- */
  const chipBox = $('#species');
  const chips = Object.entries(DF.SPECIES).map(([k, s]) => {
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'dfs-chip'; c.textContent = s.short; c.dataset.k = k; c.title = s.name;
    chipBox.appendChild(c); return c;
  });
  function showSpecies() {
    chips.forEach(c => c.setAttribute('aria-pressed', cfg.species.includes(c.dataset.k)));
    $('#sp-v').textContent = `${cfg.species.length} of ${chips.length}`;
  }
  chips.forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.k, on = cfg.species.includes(k);
    if (on && cfg.species.length === 1) return;
    cfg.species = on ? cfg.species.filter(x => x !== k) : cfg.species.concat(k);
    showSpecies(); scene.setConfig({ species: cfg.species }); save();
  }));
  showSpecies();

  /* ---------- practice toggles ---------- */
  const snd = $('#snd'), ghost = $('#ghost');
  const showToggles = () => { snd.setAttribute('aria-pressed', cfg.sound); ghost.setAttribute('aria-pressed', cfg.ghost); };
  snd.addEventListener('click', () => { cfg.sound = !cfg.sound; audio.setEnabled(cfg.sound); showToggles(); save(); });
  ghost.addEventListener('click', () => { cfg.ghost = !cfg.ghost; scene.setShowGhost(cfg.ghost); showToggles(); save(); });
  $('#reset').addEventListener('click', () => { stats.shots = stats.birds = 0; showStats(); });
  audio.setEnabled(cfg.sound);     // starts on the first click or key press (browser rule)
  showToggles();

  /* ---------- actions & keys ---------- */
  const pauseBtn = $('#pause');
  const showPause = () => { pauseBtn.textContent = scene.isPaused() ? 'Play' : 'Pause'; };
  const togglePause = () => { scene.setPaused(!scene.isPaused()); mToggle = false; showPause(); };
  pauseBtn.addEventListener('click', togglePause);
  showPause();
  $('#flush').addEventListener('click', () => scene.launch());
  $('#full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  });
  document.addEventListener('keydown', e => {
    if ((e.target.closest && e.target.closest('input')) || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'p') togglePause();
    else if (k === 'f') scene.launch();
    else if (k === 'm') { mToggle = !scene.isMounted(); scene.mount(mToggle); }
  });

  /* ---------- panel ---------- */
  const panel = $('#panel'), toggle = $('#toggle');
  function setCollapsed(c) {
    panel.classList.toggle('collapsed', c);
    toggle.textContent = c ? 'Controls' : 'Hide';
    toggle.setAttribute('aria-expanded', !c);
  }
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
  if (matchMedia('(max-width: 640px)').matches) setCollapsed(true);
})();
