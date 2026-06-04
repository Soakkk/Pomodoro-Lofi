/* ═══════════════════════════════════════════════════════════
   StudyFlow · lógica
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ── Modos / duraciones (segundos) ───────────────────────── */
const MODES = {
  '52-17': { work: 52 * 60, brk: 17 * 60, label: '52/17' },
  '90-20': { work: 90 * 60, brk: 20 * 60, label: '90 min' },
  '25-5':  { work: 25 * 60, brk: 5  * 60, label: '25/5'  },
  'custom':{ work: 45 * 60, brk: 15 * 60, label: 'a medida' },
};

const DEFAULTS = {
  theme: 'aurora',
  bg: 'dots',
  accent: '#8b7cf8',
  mode: '52-17',
  customWork: 45,
  customBreak: 15,
  spotify: 'https://open.spotify.com/embed/playlist/0vvXsWCC9xrXsKd4FyS8kM?utm_source=generator',
  ambientVol: 50,
};

/* ── Estado ───────────────────────────────────────────────── */
const settings = loadSettings();
const s = {
  mode: settings.mode in MODES ? settings.mode : '52-17',
  phase: 'work',
  running: false,
  cycle: 1,
  startTs: null,
  elapsedMs: 0,
  tick: null,
};
MODES.custom.work = settings.customWork * 60;
MODES.custom.brk  = settings.customBreak * 60;

/* ── Persistencia ─────────────────────────────────────────── */
function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('sf_settings') || '{}')); }
  catch { return Object.assign({}, DEFAULTS); }
}
function saveSettings() { localStorage.setItem('sf_settings', JSON.stringify(settings)); }

function todayKey() { return 'sf_log_' + new Date().toISOString().slice(0, 10); }
function loadLog() {
  try { return JSON.parse(localStorage.getItem(todayKey()) || '[]'); } catch { return []; }
}
function saveLog(log) { localStorage.setItem(todayKey(), JSON.stringify(log)); }

/* ── Audio compartido (campana + ambiente) ────────────────── */
let _ctx = null;
function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function playBell() {
  try {
    const ctx = getCtx();
    [[880, 0], [1108.7, 0.26], [1318.5, 0.52]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      const t = ctx.currentTime + delay;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 1.5);
      osc.start(t); osc.stop(t + 1.6);
    });
  } catch (e) {}
}

/* ── Motor de sonido ambiente (sintetizado, sin archivos) ─── */
const Ambient = (() => {
  let master = null;
  let buffers = {};
  let volume = settings.ambientVol / 100;
  const active = new Map();

  function makeBuffer(type) {
    const ctx = getCtx();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (type === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else if (type === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else { // pink
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179;
        b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520;
        b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522;
        b5 = -0.7616*b5 - w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
        b6 = w*0.115926;
      }
    }
    return buf;
  }

  function ensure() {
    if (master) return;
    const ctx = getCtx();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    buffers.white = makeBuffer('white');
    buffers.pink  = makeBuffer('pink');
    buffers.brown = makeBuffer('brown');
  }

  function src(buf) {
    const ctx = getCtx();
    const n = ctx.createBufferSource();
    n.buffer = buf; n.loop = true;
    return n;
  }
  function lfo(freq, depth, target, base) {
    const ctx = getCtx();
    const o = ctx.createOscillator(); o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(target);
    if (base !== undefined) target.value = base;
    return o;
  }

  function build(type) {
    const ctx = getCtx();
    const nodes = [];
    const out = ctx.createGain();
    out.connect(master);

    if (type === 'white') {
      const n = src(buffers.white); const g = ctx.createGain(); g.gain.value = 0.22;
      n.connect(g); g.connect(out); n.start(); nodes.push(n);
    } else if (type === 'brown') {
      const n = src(buffers.brown); const g = ctx.createGain(); g.gain.value = 0.7;
      n.connect(g); g.connect(out); n.start(); nodes.push(n);
    } else if (type === 'rain') {
      const n = src(buffers.white);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 440;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 5200;
      const g = ctx.createGain(); g.gain.value = 0.5;
      n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
      const l = lfo(0.3, 0.12, g.gain, 0.5); l.start();
      n.start(); nodes.push(n, l);
    } else if (type === 'waves') {
      const n = src(buffers.brown);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const g = ctx.createGain(); g.gain.value = 0.55;
      n.connect(lp); lp.connect(g); g.connect(out);
      const l1 = lfo(0.09, 0.42, g.gain, 0.55); l1.start();
      const l2 = lfo(0.09, 320, lp.frequency, 520); l2.start();
      n.start(); nodes.push(n, l1, l2);
    } else if (type === 'cafe') {
      const n = src(buffers.brown);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
      const g = ctx.createGain(); g.gain.value = 0.7;
      n.connect(lp); lp.connect(g); g.connect(out);
      const l = lfo(0.4, 0.18, g.gain, 0.7); l.start();
      const n2 = src(buffers.white);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
      const g2 = ctx.createGain(); g2.gain.value = 0.035;
      n2.connect(bp); bp.connect(g2); g2.connect(out);
      n.start(); n2.start(); nodes.push(n, n2, l);
    }
    return { nodes, out };
  }

  function toggle(type) {
    ensure();
    getCtx();
    if (active.has(type)) {
      const a = active.get(type);
      a.nodes.forEach(node => { try { node.stop(); } catch(e){} try { node.disconnect(); } catch(e){} });
      try { a.out.disconnect(); } catch(e){}
      active.delete(type);
      return false;
    } else {
      active.set(type, build(type));
      return true;
    }
  }
  function setVolume(v) {
    volume = v / 100;
    settings.ambientVol = v; saveSettings();
    if (master) master.gain.setTargetAtTime(volume, getCtx().currentTime, 0.05);
  }
  return { toggle, setVolume };
})();

/* ── Campo de estrellas (canvas) ──────────────────────────── */
const StarField = (() => {
  const cv = document.getElementById('stars');
  const cx = cv.getContext('2d');
  let stars = [], raf = null, W = 0, H = 0, dpr = 1, color = '#cdd6ff';

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.width = window.innerWidth * dpr;
    H = cv.height = window.innerHeight * dpr;
    cv.style.width = window.innerWidth + 'px';
    cv.style.height = window.innerHeight + 'px';
    init();
  }
  function init() {
    const n = Math.round((window.innerWidth * window.innerHeight) / 8500);
    stars = [];
    for (let i = 0; i < n; i++) stars.push({
      x: Math.random()*W, y: Math.random()*H,
      r: (Math.random()*1.2 + 0.3) * dpr,
      a: Math.random()*6.28, s: Math.random()*0.6 + 0.2,
      vx: (Math.random()-0.5)*0.05*dpr, vy: (Math.random()-0.5)*0.05*dpr,
    });
  }
  function frame(t) {
    cx.clearRect(0, 0, W, H);
    cx.fillStyle = color;
    for (const st of stars) {
      st.x += st.vx; st.y += st.vy;
      if (st.x < 0) st.x += W; else if (st.x > W) st.x -= W;
      if (st.y < 0) st.y += H; else if (st.y > H) st.y -= H;
      const tw = 0.5 + 0.5 * Math.sin(t * 0.001 * st.s + st.a);
      cx.globalAlpha = 0.15 + tw * 0.65;
      cx.beginPath(); cx.arc(st.x, st.y, st.r, 0, 6.2832); cx.fill();
    }
    cx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  function start() { if (raf) return; resize(); raf = requestAnimationFrame(frame); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = null; cx.clearRect(0, 0, W, H); }
  window.addEventListener('resize', () => { if (raf) resize(); });
  return { start, stop, setColor: c => { color = c; } };
})();

/* ── Helpers de tiempo ────────────────────────────────────── */
function totalSecs() { return s.phase === 'work' ? MODES[s.mode].work : MODES[s.mode].brk; }
function timeLeftSecs() {
  let ms = s.elapsedMs;
  if (s.running) ms += Date.now() - s.startTs;
  return Math.max(0, totalSecs() - Math.floor(ms / 1000));
}
function fmt(secs) {
  return String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
}

/* ── Anillo ───────────────────────────────────────────────── */
const ring = document.getElementById('ringProgress');
const R = 118, CIRC = 2 * Math.PI * R;
ring.style.strokeDasharray = CIRC;
function setRing() {
  const ratio = timeLeftSecs() / totalSecs();
  ring.style.strokeDashoffset = CIRC * (1 - ratio);
}

/* ── Color de fase ────────────────────────────────────────── */
function applyPhaseColor() {
  const root = document.documentElement.style;
  if (s.phase === 'work') {
    root.setProperty('--phase', 'var(--accent)');
    root.setProperty('--phase-glow', 'var(--accent-glow)');
  } else {
    root.setProperty('--phase', 'var(--break)');
    root.setProperty('--phase-glow', 'var(--break-glow)');
  }
}

/* ── Refresco de UI ───────────────────────────────────────── */
const timeDisplay = document.getElementById('timeDisplay');
const phaseBadge  = document.getElementById('phaseBadge');
const cycleInfo   = document.getElementById('cycleInfo');
const icPlay      = document.querySelector('.ic-play');
const icPause     = document.querySelector('.ic-pause');

function refreshDisplay() {
  const t = timeLeftSecs();
  timeDisplay.textContent = fmt(t);
  setRing();
  phaseBadge.textContent = s.phase === 'work' ? 'TRABAJO' : 'DESCANSO';
  cycleInfo.textContent  = `Ciclo ${s.cycle} · ${MODES[s.mode].label}`;
  icPlay.style.display  = s.running ? 'none' : 'block';
  icPause.style.display = s.running ? 'block' : 'none';
  document.title = `${fmt(t)} — ${s.phase === 'work' ? 'Enfoque' : 'Descanso'} · StudyFlow`;
}

function refreshSessions() {
  const log = loadLog();
  const n = log.filter(e => e.type === 'work').length;
  document.getElementById('sessionsCount').textContent = `${n} completada${n !== 1 ? 's' : ''}`;

  const total = Math.max(n, 8);
  const row = document.getElementById('dotsRow');
  row.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('div');
    d.className = 'sdot' + (i < n ? ' work' : '');
    row.appendChild(d);
  }

  const list = document.getElementById('logList');
  if (!log.length) {
    list.innerHTML = '<div class="log-empty">Aún no has completado sesiones hoy.</div>';
  } else {
    list.innerHTML = log.slice().reverse().map(e => {
      const icon = e.type === 'work' ? '📚' : '☕';
      const task = (e.task || 'Sin descripción').replace(/</g, '&lt;');
      return `<div class="log-item"><span class="log-task">${icon} ${task}</span>` +
             `<span class="log-meta">${e.time} · ${e.dur}m</span></div>`;
    }).join('');
  }
}

/* ── Fin de fase ──────────────────────────────────────────── */
function phaseComplete() {
  stop();
  playBell();
  document.body.classList.remove('flash');
  void document.body.offsetWidth;
  document.body.classList.add('flash');

  const log = loadLog();
  log.push({
    time: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
    type: s.phase,
    task: document.getElementById('taskInput').value.trim(),
    dur: Math.round(totalSecs() / 60),
  });
  saveLog(log);

  if (s.phase === 'work') { s.phase = 'brk'; }
  else { s.phase = 'work'; s.cycle++; }
  s.elapsedMs = 0; s.startTs = null;
  applyPhaseColor();
  refreshDisplay();
  refreshSessions();
}

/* ── Núcleo del temporizador ──────────────────────────────── */
function stop() {
  if (s.running) { s.elapsedMs += Date.now() - s.startTs; s.startTs = null; }
  clearInterval(s.tick); s.tick = null; s.running = false;
}
function start() {
  getCtx(); // desbloquea audio con el gesto del usuario
  s.startTs = Date.now(); s.running = true;
  s.tick = setInterval(() => {
    refreshDisplay();
    if (timeLeftSecs() <= 0) phaseComplete();
  }, 250);
}

/* ── Cambio de modo ───────────────────────────────────────── */
function setMode(mode) {
  if (!(mode in MODES)) return;
  stop();
  s.mode = mode; s.phase = 'work'; s.cycle = 1; s.elapsedMs = 0; s.startTs = null;
  settings.mode = mode; saveSettings();
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  applyPhaseColor();
  refreshDisplay();
}

/* ── Tema / fondo / acento ────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  settings.theme = theme; saveSettings();
  document.querySelectorAll('.tq').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  document.querySelectorAll('.theme-card').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  const meta = document.getElementById('metaTheme');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.content = bg;
  }
}
function applyBg(bg) {
  document.documentElement.setAttribute('data-bg', bg);
  settings.bg = bg; saveSettings();
  document.querySelectorAll('.bg-card').forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
  if (bg === 'stars') StarField.start(); else StarField.stop();
}
function applyAccent(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  settings.accent = hex; saveSettings();
  document.querySelectorAll('.acc[data-accent]').forEach(b =>
    b.classList.toggle('active', b.dataset.accent.toLowerCase() === hex.toLowerCase()));
  const picker = document.getElementById('accentCustom');
  if (picker) picker.value = hex;
  StarField.setColor(hex);
}

/* ── Spotify ──────────────────────────────────────────────── */
function parseSpotify(str) {
  if (!str) return null;
  str = str.trim();
  const re = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(playlist|album|track|artist|show|episode)[\/:]([A-Za-z0-9]+)/i;
  const m = str.match(re);
  if (!m) return null;
  return { type: m[1].toLowerCase(), id: m[2] };
}
function embedUrl(p) { return `https://open.spotify.com/embed/${p.type}/${p.id}?utm_source=generator`; }

function loadSpotify(raw) {
  const p = parseSpotify(raw);
  const frame = document.getElementById('spotifyFrame');
  if (!p) {
    const inp = document.getElementById('spotifyUrl');
    inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 500);
    inp.value = '';
    inp.placeholder = '✗ No reconozco ese enlace de Spotify. Pega una URL de playlist…';
    return;
  }
  const url = embedUrl(p);
  frame.src = url;
  settings.spotify = url; saveSettings();
  // resaltar chip coincidente
  document.querySelectorAll('.chip').forEach(c =>
    c.classList.toggle('active', url.includes(c.dataset.pl)));
}

/* ═══ EVENTOS ═══ */

// play / pause
document.getElementById('btnPlay').addEventListener('click', () => {
  if (s.running) stop(); else start();
  refreshDisplay();
});
// reiniciar fase
document.getElementById('btnReset').addEventListener('click', () => {
  stop(); s.elapsedMs = 0; s.startTs = null; refreshDisplay();
});
// saltar fase
document.getElementById('btnSkip').addEventListener('click', () => {
  stop();
  if (s.phase === 'work') s.phase = 'brk'; else { s.phase = 'work'; s.cycle++; }
  s.elapsedMs = 0; s.startTs = null;
  applyPhaseColor(); refreshDisplay();
});
// barra espaciadora = play/pause
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    if (s.running) stop(); else start();
    refreshDisplay();
  }
});

// tabs de modo
document.getElementById('modeTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.mode-tab'); if (!tab) return;
  setMode(tab.dataset.mode);
});

// tema rápido + panel
document.getElementById('themeQuick').addEventListener('click', (e) => {
  const b = e.target.closest('.tq'); if (b) applyTheme(b.dataset.theme);
});
document.getElementById('setThemes').addEventListener('click', (e) => {
  const b = e.target.closest('.theme-card'); if (b) applyTheme(b.dataset.theme);
});
document.getElementById('setBg').addEventListener('click', (e) => {
  const b = e.target.closest('.bg-card'); if (b) applyBg(b.dataset.bg);
});
document.getElementById('setAccents').addEventListener('click', (e) => {
  const b = e.target.closest('.acc[data-accent]'); if (b) applyAccent(b.dataset.accent);
});
document.getElementById('accentCustom').addEventListener('input', (e) => applyAccent(e.target.value));

// duraciones personalizadas
document.getElementById('btnApplyCustom').addEventListener('click', () => {
  const w = Math.min(180, Math.max(1, parseInt(document.getElementById('customWork').value)  || 45));
  const b = Math.min(90,  Math.max(1, parseInt(document.getElementById('customBreak').value) || 15));
  document.getElementById('customWork').value = w;
  document.getElementById('customBreak').value = b;
  MODES.custom.work = w * 60; MODES.custom.brk = b * 60;
  settings.customWork = w; settings.customBreak = b; saveSettings();
  setMode('custom');
});

// reset ajustes
document.getElementById('btnResetAll').addEventListener('click', () => {
  Object.assign(settings, DEFAULTS);
  saveSettings();
  MODES.custom.work = settings.customWork * 60;
  MODES.custom.brk  = settings.customBreak * 60;
  applyTheme(settings.theme); applyBg(settings.bg); applyAccent(settings.accent);
  document.getElementById('customWork').value = settings.customWork;
  document.getElementById('customBreak').value = settings.customBreak;
  document.getElementById('ambientVol').value = settings.ambientVol;
  loadSpotify(settings.spotify);
  setMode(settings.mode);
});

// panel ajustes abrir/cerrar
const panel = document.getElementById('settings');
const scrim = document.getElementById('scrim');
function openSettings()  { panel.classList.add('open');  scrim.classList.add('open');  panel.setAttribute('aria-hidden','false'); }
function closeSettings() { panel.classList.remove('open'); scrim.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }
document.getElementById('btnSettings').addEventListener('click', openSettings);
document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
scrim.addEventListener('click', closeSettings);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

// Spotify
document.getElementById('btnLoadSpotify').addEventListener('click', () =>
  loadSpotify(document.getElementById('spotifyUrl').value));
document.getElementById('spotifyUrl').addEventListener('keydown', e => {
  if (e.key === 'Enter') loadSpotify(e.target.value);
});
document.getElementById('spotifyPresets').addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  loadSpotify('https://open.spotify.com/playlist/' + c.dataset.pl);
});

// ambiente
document.getElementById('ambientBtns').addEventListener('click', (e) => {
  const b = e.target.closest('.amb'); if (!b) return;
  const on = Ambient.toggle(b.dataset.amb);
  b.classList.toggle('active', on);
});
document.getElementById('ambientVol').addEventListener('input', e => Ambient.setVolume(+e.target.value));

/* ═══ INIT ═══ */
applyTheme(settings.theme);
applyBg(settings.bg);
applyAccent(settings.accent);
document.getElementById('customWork').value = settings.customWork;
document.getElementById('customBreak').value = settings.customBreak;
document.getElementById('ambientVol').value = settings.ambientVol;
document.getElementById('spotifyFrame').src = settings.spotify;
document.querySelectorAll('.chip').forEach(c =>
  c.classList.toggle('active', settings.spotify.includes(c.dataset.pl)));
setMode(s.mode);
refreshSessions();

/* ═══ PWA: service worker + instalación ═══ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

let deferredPrompt = null;
const installGroup = document.getElementById('installGroup');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installGroup) installGroup.style.display = '';
});
document.getElementById('btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try { await deferredPrompt.userChoice; } catch (e) {}
  deferredPrompt = null;
  if (installGroup) installGroup.style.display = 'none';
});
window.addEventListener('appinstalled', () => {
  if (installGroup) installGroup.style.display = 'none';
});
