/* ═══════════════════════════════════════════════════════════
   StudyFlow · lógica + motor de animación (rediseño)
   ═══════════════════════════════════════════════════════════ */
'use strict';

const MODES = {
  '52-17': { work: 52 * 60, brk: 17 * 60, label: '52/17' },
  '90-20': { work: 90 * 60, brk: 20 * 60, label: '90 min' },
  '25-5':  { work: 25 * 60, brk: 5  * 60, label: '25/5'  },
  'custom':{ work: 45 * 60, brk: 15 * 60, label: 'a medida' },
};

const DEFAULTS = {
  theme: 'nebula',
  bg: 'particles',
  accent: '#8b7cf8',
  mode: '52-17',
  customWork: 45,
  customBreak: 15,
  spotify: 'https://open.spotify.com/embed/playlist/0vvXsWCC9xrXsKd4FyS8kM?utm_source=generator',
  ambientVol: 50,
  bellVol: 50,
  visualAlarm: true,
  spotifyHeight: 'compact'
};

const TASKS_KEY = 'studyflow_tasks';
const STATE_KEY = 'sf_state';

const settings = loadSettings();
/* saneado: descarta temas/fondos de versiones anteriores */
const VALID_THEMES = ['nebula', 'pulse', 'aura', 'dusk', 'chalkboard'];
const VALID_BGS = ['particles', 'aurora', 'dots', 'clean'];
if (!VALID_THEMES.includes(settings.theme)) settings.theme = DEFAULTS.theme;
if (!VALID_BGS.includes(settings.bg)) settings.bg = DEFAULTS.bg;

const s = {
  mode: settings.mode in MODES ? settings.mode : '52-17',
  phase: 'work', running: false, cycle: 1,
  startTs: null, elapsedMs: 0, tick: null, endTime: null
};
MODES.custom.work = settings.customWork * 60;
MODES.custom.brk  = settings.customBreak * 60;

/* ── Persistencia ── */
function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('sf_settings') || '{}')); }
  catch { return Object.assign({}, DEFAULTS); }
}
function saveSettings() { localStorage.setItem('sf_settings', JSON.stringify(settings)); }
function todayKey() { return 'sf_log_' + new Date().toISOString().slice(0, 10); }
function loadLog() { try { return JSON.parse(localStorage.getItem(todayKey()) || '[]'); } catch { return []; } }
function saveLog(log) { localStorage.setItem(todayKey(), JSON.stringify(log)); }

function saveStateSnapshot() {
  const snapshot = {
    phase: s.phase,
    running: s.running,
    cycle: s.cycle,
    mode: s.mode,
    elapsedMs: s.elapsedMs,
    startTs: s.startTs,
    endTime: s.endTime
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(snapshot));
}

function loadStateSnapshot() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const snapshot = JSON.parse(raw);
    s.phase = snapshot.phase;
    s.cycle = snapshot.cycle;
    s.mode = snapshot.mode;
    s.elapsedMs = snapshot.elapsedMs;
    s.startTs = snapshot.startTs;
    s.endTime = snapshot.endTime;
    s.running = snapshot.running;
    
    applyPhaseColor();
    
    if (s.running && s.endTime) {
      const now = Date.now();
      if (now >= s.endTime) {
        s.elapsedMs = totalSecs() * 1000;
        s.running = false;
        phaseComplete();
      } else {
        start(true);
      }
    } else {
      refreshDisplay();
    }
  } catch (e) {}
}

/* ── Tasks Checklist ── */
function loadTasks() {
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); }
  catch { return []; }
}
function saveTasks(tasks) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}
function renderTodoList() {
  const list = document.getElementById('todoList');
  if (!list) return;
  const tasks = loadTasks();
  list.innerHTML = '';
  if (tasks.length === 0) {
    list.innerHTML = '<li class="log-empty" style="text-align:center; padding:0.5rem 0; width:100%;">Sin temas pendientes hoy</li>';
    return;
  }
  tasks.forEach(t => {
    const li = document.createElement('li');
    li.className = `todo-item ${t.completed ? 'completed' : ''}`;
    li.innerHTML = `
      <input type="checkbox" class="todo-checkbox" ${t.completed ? 'checked' : ''} />
      <span class="todo-text" title="${escapeHTML(t.text)}">${escapeHTML(t.text)}</span>
      <button class="btn-delete-todo" title="Eliminar">❌</button>
    `;
    li.querySelector('.todo-checkbox').addEventListener('change', () => {
      toggleTodo(t.id);
    });
    li.querySelector('.btn-delete-todo').addEventListener('click', () => {
      deleteTodo(t.id);
    });
    list.appendChild(li);
  });
}
function toggleTodo(id) {
  const tasks = loadTasks();
  const t = tasks.find(x => x.id === id);
  if (t) {
    t.completed = !t.completed;
    saveTasks(tasks);
    renderTodoList();
  }
}
function deleteTodo(id) {
  const tasks = loadTasks();
  const filtered = tasks.filter(x => x.id !== id);
  saveTasks(filtered);
  renderTodoList();
}
function addTodo() {
  const inp = document.getElementById('todoInput');
  const txt = inp.value.trim();
  if (!txt) return;
  const tasks = loadTasks();
  tasks.push({ id: Date.now(), text: txt, completed: false });
  saveTasks(tasks);
  inp.value = '';
  renderTodoList();
}
function getCurrentTaskText() {
  const tasks = loadTasks();
  const activeTask = tasks.find(x => !x.completed);
  return activeTask ? activeTask.text : 'Enfoque general';
}

/* ── Audio: campana ── */
let _ctx = null;
function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}
function playBell() {
  try {
    const ctx = getCtx();
    const factor = (settings.bellVol || 50) / 100;
    [[880, 0], [1108.7, 0.26], [1318.5, 0.52]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination); osc.type = 'sine';
      const t = ctx.currentTime + delay;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3 * factor, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 1.5);
      osc.start(t); osc.stop(t + 1.6);
    });
  } catch (e) {}
}

/* ── Motor de sonido ambiente (sintetizado) ── */
const Ambient = (() => {
  let master = null, buffers = {};
  let volume = settings.ambientVol / 100;
  const active = new Map();
  function makeBuffer(type) {
    const ctx = getCtx(); const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    if (type === 'white') { for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
    else if (type === 'brown') { let last = 0; for (let i = 0; i < len; i++) { const w = Math.random()*2-1; last=(last+0.02*w)/1.02; d[i]=last*3.5; } }
    else { let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i=0;i<len;i++){ const w=Math.random()*2-1;
        b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.96900*b2+w*0.1538520;
        b3=0.86650*b3+w*0.3104856; b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
        d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926; } }
    return buf;
  }
  function ensure() {
    if (master) return;
    const ctx = getCtx(); master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
    buffers.white = makeBuffer('white'); buffers.pink = makeBuffer('pink'); buffers.brown = makeBuffer('brown');
  }
  function src(buf) { const ctx = getCtx(); const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; return n; }
  function lfo(freq, depth, target, base) { const ctx = getCtx(); const o = ctx.createOscillator(); o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(target); if (base !== undefined) target.value = base; return o; }
  function build(type) {
    const ctx = getCtx(); const nodes = []; const out = ctx.createGain(); out.connect(master);
    if (type === 'white') { const n=src(buffers.white); const g=ctx.createGain(); g.gain.value=0.22; n.connect(g); g.connect(out); n.start(); nodes.push(n); }
    else if (type === 'brown') { const n=src(buffers.brown); const g=ctx.createGain(); g.gain.value=0.7; n.connect(g); g.connect(out); n.start(); nodes.push(n); }
    else if (type === 'rain') { const n=src(buffers.white); const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=440;
      const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=5200; const g=ctx.createGain(); g.gain.value=0.5;
      n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out); const l=lfo(0.3,0.12,g.gain,0.5); l.start(); n.start(); nodes.push(n,l); }
    else if (type === 'waves') { const n=src(buffers.brown); const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=500;
      const g=ctx.createGain(); g.gain.value=0.55; n.connect(lp); lp.connect(g); g.connect(out);
      const l1=lfo(0.09,0.42,g.gain,0.55); l1.start(); const l2=lfo(0.09,320,lp.frequency,520); l2.start(); n.start(); nodes.push(n,l1,l2); }
    else if (type === 'cafe') { const n=src(buffers.brown); const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=520;
      const g=ctx.createGain(); g.gain.value=0.7; n.connect(lp); lp.connect(g); g.connect(out); const l=lfo(0.4,0.18,g.gain,0.7); l.start();
      const n2=src(buffers.white); const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=2200; bp.Q.value=0.7;
      const g2=ctx.createGain(); g2.gain.value=0.035; n2.connect(bp); bp.connect(g2); g2.connect(out); n.start(); n2.start(); nodes.push(n,n2,l); }
    return { nodes, out };
  }
  function toggle(type) {
    ensure(); getCtx();
    if (active.has(type)) { const a=active.get(type); a.nodes.forEach(n=>{try{n.stop();}catch(e){}try{n.disconnect();}catch(e){}}); try{a.out.disconnect();}catch(e){} active.delete(type); return false; }
    active.set(type, build(type)); return true;
  }
  function setVolume(v) { volume = v/100; settings.ambientVol = v; saveSettings(); if (master) master.gain.setTargetAtTime(volume, getCtx().currentTime, 0.05); }
  return { toggle, setVolume };
})();

/* ── Campo de partículas (canvas) ── */
const ParticleField = (() => {
  const cv = document.getElementById('particles');
  const cx = cv ? cv.getContext('2d') : null;
  let parts = [], raf = null, W = 0, H = 0, dpr = 1, color = '#8b7cf8';
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    init();
  }
  function init() {
    const n = Math.round((innerWidth * innerHeight) / 14000);
    parts = [];
    for (let i = 0; i < n; i++) parts.push({
      x: Math.random()*W, y: Math.random()*H,
      r: (Math.random()*1.6 + 0.4) * dpr,
      drift: (Math.random()-0.5) * 0.12 * dpr,
      vy: -(Math.random()*0.18 + 0.05) * dpr,
      a: Math.random()*6.28, tw: Math.random()*0.5 + 0.4,
      tint: Math.random() < 0.32,
    });
  }
  function frame(t) {
    if (!cx) return;
    cx.clearRect(0, 0, W, H);
    const boost = s.running ? 1.7 : 1;
    for (const p of parts) {
      p.x += p.drift * boost; p.y += p.vy * boost;
      if (p.y < -10) { p.y = H + 10; p.x = Math.random()*W; }
      if (p.x < -10) p.x = W + 10; else if (p.x > W+10) p.x = -10;
      const flick = 0.45 + 0.55 * Math.sin(t * 0.001 * p.tw + p.a);
      cx.globalAlpha = (0.12 + flick * 0.5) * (p.tint ? 1 : 0.7);
      cx.fillStyle = p.tint ? color : '#cdd6ff';
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.2832); cx.fill();
    }
    cx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  function start() { if (raf || !cv) return; resize(); raf = requestAnimationFrame(frame); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = null; cx && cx.clearRect(0,0,W,H); }
  addEventListener('resize', () => { if (raf) resize(); });
  return { start, stop, setColor: c => { color = c; } };
})();

/* ── Marcas (ticks) alrededor del anillo ── */
(function buildTicks() {
  const g = document.getElementById('ticks');
  if (!g) return;
  const cxC = 140, cyC = 140, rOuter = 134, n = 60;
  let html = '';
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * 2 * Math.PI;
    const long = i % 5 === 0;
    const r1 = rOuter, r2 = rOuter - (long ? 9 : 5);
    const x1 = cxC + r1 * Math.cos(ang), y1 = cyC + r1 * Math.sin(ang);
    const x2 = cxC + r2 * Math.cos(ang), y2 = cyC + r2 * Math.sin(ang);
    html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" data-i="${i}" style="opacity:${long?0.9:0.5}"></line>`;
  }
  g.innerHTML = html;
})();
const tickEls = Array.from(document.querySelectorAll('#ticks line'));

/* ── Helpers de tiempo ── */
function totalSecs() { return s.phase === 'work' ? MODES[s.mode].work : MODES[s.mode].brk; }
function timeLeftSecs() {
  if (!s.running) {
    return Math.max(0, totalSecs() - Math.floor(s.elapsedMs / 1000));
  }
  return Math.max(0, Math.ceil((s.endTime - Date.now()) / 1000));
}
function fmt(secs) { return String(Math.floor(secs/60)).padStart(2,'0') + ':' + String(secs%60).padStart(2,'0'); }

/* ── Anillo ── */
const ring = document.getElementById('ringProgress');
const ringHead = document.getElementById('ringHead');
const R = 120, CIRC = 2 * Math.PI * R;
if (ring) ring.style.strokeDasharray = CIRC;
function setRing() {
  if (!ring) return;
  const ratio = timeLeftSecs() / totalSecs();
  ring.style.strokeDashoffset = CIRC * (1 - ratio);
  const theta = ratio * 2 * Math.PI;
  if (ringHead) {
    ringHead.setAttribute('cx', (140 + R * Math.cos(theta)).toFixed(1));
    ringHead.setAttribute('cy', (140 + R * Math.sin(theta)).toFixed(1));
    ringHead.style.opacity = (ratio > 0.001 && ratio < 0.999) ? 1 : 0;
  }
  const litCount = Math.round(ratio * tickEls.length);
  for (let i = 0; i < tickEls.length; i++) tickEls[i].classList.toggle('lit', i < litCount);
}

/* ── Color de fase ── */
function applyPhaseColor() {
  const root = document.documentElement.style;
  if (s.phase === 'work') { root.setProperty('--phase','var(--accent)'); root.setProperty('--phase-2','var(--accent-2)'); root.setProperty('--phase-glow','var(--accent-glow)'); }
  else { root.setProperty('--phase','var(--break)'); root.setProperty('--phase-2','var(--break-2)'); root.setProperty('--phase-glow','var(--break-glow)'); }
}

/* ── Refresco UI ── */
const timeDisplay = document.getElementById('timeDisplay');
const phaseBadge = document.getElementById('phaseBadge');
const cycleInfo = document.getElementById('cycleInfo');
const icPlay = document.querySelector('.ic-play');
const icPause = document.querySelector('.ic-pause');
const timerWrapper = document.getElementById('timerWrapper');

function refreshDisplay() {
  const t = timeLeftSecs();
  if (timeDisplay) timeDisplay.textContent = fmt(t);
  setRing();
  if (phaseBadge) phaseBadge.textContent = s.phase === 'work' ? 'Trabajo' : 'Descanso';
  if (cycleInfo) cycleInfo.textContent = `Ciclo ${s.cycle} · ${MODES[s.mode].label}`;
  if (icPlay) icPlay.style.display = s.running ? 'none' : 'block';
  if (icPause) icPause.style.display = s.running ? 'block' : 'none';
  if (timerWrapper) timerWrapper.classList.toggle('running', s.running);
  document.title = `${fmt(t)} — ${s.phase === 'work' ? 'Enfoque' : 'Descanso'} · StudyFlow`;
}

function refreshSessions() {
  const log = loadLog();
  const workEntries = log.filter(e => e.type === 'work');
  const n = workEntries.length;
  document.getElementById('focusMin').textContent = workEntries.reduce((a,e)=>a+(e.dur||0),0);
  document.getElementById('streakNum').textContent = n;
  document.getElementById('sessionsCount').textContent = `${n} completada${n!==1?'s':''}`;

  const total = Math.max(n, 8);
  const row = document.getElementById('dotsRow'); row.innerHTML = '';
  for (let i = 0; i < total; i++) { const d = document.createElement('div'); d.className = 'sdot' + (i < n ? ' work' : ''); row.appendChild(d); }

  const list = document.getElementById('logList');
  if (!log.length) { list.innerHTML = '<div class="log-empty">Aún no has completado sesiones hoy.</div>'; }
  else { list.innerHTML = log.slice().reverse().map(e => {
    const icon = e.type === 'work' ? '📚' : '☕';
    const task = (e.task || 'Sin descripción').replace(/</g, '&lt;');
    return `<div class="log-item"><span class="log-task">${icon} ${task}</span><span class="log-meta">${e.time} · ${e.dur}m</span></div>`;
  }).join(''); }
  
  renderNotesHistory();
}

/* ── Active Recall Modal Control ── */
function openRecallModal() {
  document.getElementById('recallModal').style.display = 'block';
  document.getElementById('recallScrim').classList.add('open');
  document.getElementById('recallInput').value = '';
  document.getElementById('recallInput').focus();
}

function closeRecallModal() {
  document.getElementById('recallModal').style.display = 'none';
  document.getElementById('recallScrim').classList.remove('open');
}

function saveRecallNote() {
  const txt = document.getElementById('recallInput').value.trim();
  if (!txt) {
    showNotification('Escribe una nota antes de guardar.');
    return;
  }
  const log = loadLog();
  const lastEntry = log[log.length - 1];
  if (lastEntry) {
    lastEntry.recall = txt;
    saveLog(log);
  }
  closeRecallModal();
  stopVisualAlarm();
  
  s.phase = 'brk';
  s.elapsedMs = 0; s.startTs = null; s.endTime = null;
  saveStateSnapshot();
  applyPhaseColor();
  refreshDisplay();
  refreshSessions();
  showNotification('🧠 Nota de repaso guardada.');
}

function renderNotesHistory() {
  const list = document.getElementById('notesList');
  if (!list) return;
  const log = loadLog();
  const notes = log.filter(e => e.type === 'work' && e.recall);
  list.innerHTML = '';
  if (notes.length === 0) {
    list.innerHTML = '<div class="log-empty">No hay notas de repaso guardadas hoy.</div>';
    return;
  }
  list.innerHTML = notes.map((e) => {
    const idx = log.indexOf(e);
    return `
      <div class="recall-note-item">
        <div class="recall-note-head">
          <span class="recall-note-date">⏱ ${e.time}</span>
          <span class="recall-note-intent">${escapeHTML(e.task)}</span>
        </div>
        <div class="recall-note-body">${escapeHTML(e.recall)}</div>
        <button class="btn-delete-note" onclick="deleteRecallNote(${idx})" title="Borrar nota">❌</button>
      </div>
    `;
  }).join('');
}

window.deleteRecallNote = function(index) {
  if (!confirm('¿Seguro que quieres borrar esta nota de repaso?')) return;
  const log = loadLog();
  if (log[index]) {
    log[index].recall = '';
    saveLog(log);
    renderNotesHistory();
  }
};

/* ── Alertas visuales ── */
function triggerVisualAlarm() {
  if (settings.visualAlarm) {
    document.body.classList.add('visual-alarm-active');
    document.getElementById('btnStopAlarm').style.display = 'block';
  }
}

function stopVisualAlarm() {
  document.body.classList.remove('visual-alarm-active');
  document.getElementById('btnStopAlarm').style.display = 'none';
}

/* ── Fin de fase ── */
function phaseBurst() {
  const p = document.getElementById('ringPulse');
  if (p) { p.classList.remove('burst'); void p.offsetWidth; p.classList.add('burst'); }
  document.body.classList.remove('flash'); void document.body.offsetWidth; document.body.classList.add('flash');
}

function phaseComplete() {
  stop();
  playBell();
  phaseBurst();
  triggerVisualAlarm();

  const log = loadLog();
  const taskName = getCurrentTaskText();
  log.push({
    time: new Date().toLocaleTimeString('es', { hour:'2-digit', minute:'2-digit' }),
    type: s.phase,
    task: taskName,
    dur: Math.round(totalSecs()/60),
    recall: ''
  });
  saveLog(log);

  if (s.phase === 'work') {
    openRecallModal();
  } else {
    s.phase = 'work';
    s.cycle++;
    s.elapsedMs = 0; s.startTs = null; s.endTime = null;
    saveStateSnapshot();
    applyPhaseColor();
    refreshDisplay();
    refreshSessions();
  }
}

/* ── Núcleo ── */
function stop() {
  if (s.running) {
    s.elapsedMs += Date.now() - s.startTs;
    s.startTs = null;
    s.endTime = null;
    s.running = false;
  }
  clearInterval(s.tick);
  s.tick = null;
  saveStateSnapshot();
}

function start(isResume = false) {
  getCtx();
  stopVisualAlarm();
  if (!s.running || isResume) {
    s.startTs = Date.now();
    s.endTime = Date.now() + (totalSecs() * 1000 - s.elapsedMs);
    s.running = true;
  }
  saveStateSnapshot();
  s.tick = setInterval(() => {
    refreshDisplay();
    if (timeLeftSecs() <= 0) {
      phaseComplete();
    }
  }, 250);
}

/* ── Modo ── */
function setMode(mode) {
  if (!(mode in MODES)) return;
  stop(); s.mode = mode; s.phase = 'work'; s.cycle = 1; s.elapsedMs = 0; s.startTs = null; s.endTime = null;
  settings.mode = mode; saveSettings();
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  applyPhaseColor(); refreshDisplay();
}

/* ── Tema / fondo / acento ── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  settings.theme = theme; saveSettings();
  document.querySelectorAll('.tq').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  document.querySelectorAll('.theme-card').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  const meta = document.getElementById('metaTheme');
  if (meta) { const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); if (bg) meta.content = bg; }
  syncParticleColor();
}
function applyBg(bg) {
  document.documentElement.setAttribute('data-bg', bg);
  settings.bg = bg; saveSettings();
  document.querySelectorAll('.bg-card').forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
  if (bg === 'particles') ParticleField.start(); else ParticleField.stop();
}
function applyAccent(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  settings.accent = hex; saveSettings();
  document.querySelectorAll('.acc[data-accent]').forEach(b => b.classList.toggle('active', b.dataset.accent.toLowerCase() === hex.toLowerCase()));
  const picker = document.getElementById('accentCustom'); if (picker) picker.value = hex;
  syncParticleColor();
}
function syncParticleColor() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if (c) ParticleField.setColor(c);
}

/* ── Spotify ── */
function parseSpotify(str) {
  if (!str) return null; str = str.trim();
  const re = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(playlist|album|track|artist|show|episode)[\/:]([A-Za-z0-9]+)/i;
  const m = str.match(re); if (!m) return null;
  return { type: m[1].toLowerCase(), id: m[2] };
}
function embedUrl(p) { return `https://open.spotify.com/embed/${p.type}/${p.id}?utm_source=generator`; }
function loadSpotify(raw) {
  const p = parseSpotify(raw); const frame = document.getElementById('spotifyFrame');
  if (!p) { const inp = document.getElementById('spotifyUrl'); inp.classList.add('shake'); setTimeout(()=>inp.classList.remove('shake'),500);
    inp.value=''; inp.placeholder='✗ Enlace de Spotify no válido.'; return; }
  const url = embedUrl(p); frame.src = url; settings.spotify = url; saveSettings();
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', url.includes(c.dataset.pl)));
}

function applySpotifyHeight(mode) {
  settings.spotifyHeight = mode;
  saveSettings();
  const frame = document.getElementById('spotifyFrame');
  if (frame) {
    if (mode === 'large') {
      frame.height = '380';
      document.getElementById('btnSpotifyLarge').classList.add('active');
      document.getElementById('btnSpotifyCompact').classList.remove('active');
    } else {
      frame.height = '152';
      document.getElementById('btnSpotifyCompact').classList.add('active');
      document.getElementById('btnSpotifyLarge').classList.remove('active');
    }
  }
}

/* ── Backup Data Exports ── */
function exportToCsv() {
  const log = loadLog();
  let csv = '\ufeff'; // UTF-8 BOM
  csv += '--- HISTORIAL DE HOY ---\n';
  csv += 'Hora,Tipo,Tema,Duración (min),Nota de Repaso\n';
  log.forEach(e => {
    const cleanRecall = (e.recall || '').replace(/"/g, '""');
    const cleanTask = (e.task || '').replace(/"/g, '""');
    csv += `${e.time},${e.type},"${cleanTask}",${e.dur},"${cleanRecall}"\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `studyflow_export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showNotification('📊 CSV generado y descargado.');
}

function exportBackup() {
  const backup = {
    settings: settings,
    tasks: loadTasks(),
    log: loadLog(),
    version: '2.0',
    timestamp: Date.now()
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `studyflow_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showNotification('💾 Copia JSON descargada.');
}

function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const backup = JSON.parse(evt.target.result);
      if (backup.settings && backup.log) {
        localStorage.setItem('sf_settings', JSON.stringify(backup.settings));
        localStorage.setItem(TASKS_KEY, JSON.stringify(backup.tasks || []));
        localStorage.setItem(todayKey(), JSON.stringify(backup.log));
        showNotification('📥 Copia restaurada con éxito.');
        setTimeout(() => window.location.reload(), 1200);
      } else {
        alert('Copia no válida o corrupta.');
      }
    } catch(err) {
      alert('Error al leer el archivo.');
    }
  };
  reader.readAsText(file);
}

function showNotification(msg) {
  const el = document.getElementById('notification');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3200);
  }
}

function escapeHTML(str) {
  return (str || '').replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

/* ═══ EVENTOS ═══ */
document.getElementById('btnPlay').addEventListener('click', () => { if (s.running) stop(); else start(); refreshDisplay(); });
document.getElementById('btnReset').addEventListener('click', () => { stop(); s.elapsedMs = 0; s.startTs = null; s.endTime = null; refreshDisplay(); });
document.getElementById('btnSkip').addEventListener('click', () => { stop(); if (s.phase === 'work') s.phase='brk'; else { s.phase='work'; s.cycle++; } s.elapsedMs=0; s.startTs=null; s.endTime=null; applyPhaseColor(); refreshDisplay(); });
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); stopVisualAlarm(); if (s.running) stop(); else start(); refreshDisplay(); } });
document.getElementById('modeTabs').addEventListener('click', (e) => { const tab = e.target.closest('.mode-tab'); if (tab) setMode(tab.dataset.mode); });
document.getElementById('themeQuick').addEventListener('click', (e) => { const b = e.target.closest('.tq'); if (b) applyTheme(b.dataset.theme); });
document.getElementById('setThemes').addEventListener('click', (e) => { const b = e.target.closest('.theme-card'); if (b) applyTheme(b.dataset.theme); });
document.getElementById('setBg').addEventListener('click', (e) => { const b = e.target.closest('.bg-card'); if (b) applyBg(b.dataset.bg); });
document.getElementById('setAccents').addEventListener('click', (e) => { const b = e.target.closest('.acc[data-accent]'); if (b) applyAccent(b.dataset.accent); });
document.getElementById('accentCustom').addEventListener('input', (e) => applyAccent(e.target.value));
document.getElementById('btnApplyCustom').addEventListener('click', () => {
  const w = Math.min(180, Math.max(1, parseInt(document.getElementById('customWork').value) || 45));
  const b = Math.min(90, Math.max(1, parseInt(document.getElementById('customBreak').value) || 15));
  document.getElementById('customWork').value = w; document.getElementById('customBreak').value = b;
  MODES.custom.work = w*60; MODES.custom.brk = b*60; settings.customWork = w; settings.customBreak = b; saveSettings(); setMode('custom');
});
document.getElementById('btnResetAll').addEventListener('click', () => {
  Object.assign(settings, DEFAULTS); saveSettings();
  MODES.custom.work = settings.customWork*60; MODES.custom.brk = settings.customBreak*60;
  applyTheme(settings.theme); applyBg(settings.bg); applyAccent(settings.accent);
  document.getElementById('customWork').value = settings.customWork; document.getElementById('customBreak').value = settings.customBreak;
  document.getElementById('ambientVol').value = settings.ambientVol; loadSpotify(settings.spotify); setMode(settings.mode);
  applySpotifyHeight(settings.spotifyHeight);
});

const panel = document.getElementById('settings'); const scrim = document.getElementById('scrim');
function openSettings() { panel.classList.add('open'); scrim.classList.add('open'); panel.setAttribute('aria-hidden','false'); }
function closeSettings() { panel.classList.remove('open'); scrim.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }
document.getElementById('btnSettings').addEventListener('click', openSettings);
document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
scrim.addEventListener('click', closeSettings);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

document.getElementById('btnLoadSpotify').addEventListener('click', () => loadSpotify(document.getElementById('spotifyUrl').value));
document.getElementById('spotifyUrl').addEventListener('keydown', e => { if (e.key === 'Enter') loadSpotify(e.target.value); });
document.getElementById('spotifyPresets').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) loadSpotify('https://open.spotify.com/playlist/' + c.dataset.pl); });
document.getElementById('ambientBtns').addEventListener('click', (e) => { const b = e.target.closest('.amb'); if (!b) return; const on = Ambient.toggle(b.dataset.amb); b.classList.toggle('active', on); });
document.getElementById('ambientVol').addEventListener('input', e => Ambient.setVolume(+e.target.value));

/* ── Alarma y volumen ── */
document.getElementById('bellVol').addEventListener('input', (e) => { settings.bellVol = parseInt(e.target.value); saveSettings(); });
document.getElementById('btnTestBell').addEventListener('click', () => { initAudioContext(); playBell(); showNotification('🔊 Tono de prueba reproducido.'); });
document.getElementById('settingVisualAlarm').addEventListener('change', (e) => { settings.visualAlarm = e.target.checked; saveSettings(); });
document.getElementById('btnStopAlarm').addEventListener('click', stopVisualAlarm);

/* ── Spotify Sizing ── */
document.getElementById('btnSpotifyCompact').addEventListener('click', () => applySpotifyHeight('compact'));
document.getElementById('btnSpotifyLarge').addEventListener('click', () => applySpotifyHeight('large'));

/* ── Tasks Checklist ── */
document.getElementById('btnAddTask').addEventListener('click', addTodo);
document.getElementById('todoInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

/* ── Save Active Recall Note ── */
document.getElementById('btnSaveRecall').addEventListener('click', saveRecallNote);

/* ── Sessions Tabs ── */
document.getElementById('btnShowLogs').addEventListener('click', () => {
  document.getElementById('btnShowLogs').classList.add('active');
  document.getElementById('btnShowNotes').classList.remove('active');
  document.getElementById('logList').style.display = 'block';
  document.getElementById('notesList').style.display = 'none';
});
document.getElementById('btnShowNotes').addEventListener('click', () => {
  document.getElementById('btnShowNotes').classList.add('active');
  document.getElementById('btnShowLogs').classList.remove('active');
  document.getElementById('logList').style.display = 'none';
  document.getElementById('notesList').style.display = 'flex';
  renderNotesHistory();
});

/* ── Backup Exporters ── */
document.getElementById('btnExportCsv').addEventListener('click', exportToCsv);
document.getElementById('btnExportBackup').addEventListener('click', exportBackup);
document.getElementById('btnImportBackup').addEventListener('click', () => document.getElementById('importBackupFile').click());
document.getElementById('importBackupFile').addEventListener('change', importBackup);

/* ── Reset stats ── */
const btnResetStats = document.getElementById('btn-reset-stats');
if (btnResetStats) {
  btnResetStats.addEventListener('click', () => {
    if (!confirm('¿Borrar todas las estadísticas? Esta acción no se puede deshacer.')) return;
    stopVisualAlarm();
    localStorage.removeItem(todayKey());
    renderStats();
    showNotification('📊 Estadísticas borradas.');
  });
}

/* ── Intro + aparición ── */
window.addEventListener('load', () => {
  setTimeout(() => document.getElementById('app').classList.add('ready'), 80);
  setTimeout(() => { const i = document.getElementById('intro'); if (i) i.classList.add('done'); }, 1900);
});

/* ═══ PWA ═══ */
let deferredPrompt = null;
const installGroup = document.getElementById('installGroup');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; if (installGroup) installGroup.style.display = ''; });
document.getElementById('btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) return; deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch (e) {}
  deferredPrompt = null; if (installGroup) installGroup.style.display = 'none';
});
window.addEventListener('appinstalled', () => { if (installGroup) installGroup.style.display = 'none'; });

// Alert protection when timer runs
window.addEventListener('beforeunload', (e) => {
  if (s.running) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ═══ BOOT ═══ */
applyTheme(settings.theme);
applyBg(settings.bg);
applyAccent(settings.accent);
document.getElementById('customWork').value = settings.customWork;
document.getElementById('customBreak').value = settings.customBreak;
document.getElementById('ambientVol').value = settings.ambientVol;
document.getElementById('bellVol').value = settings.bellVol || 50;
document.getElementById('settingVisualAlarm').checked = settings.visualAlarm !== false;

document.getElementById('spotifyFrame').src = settings.spotify;
document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', settings.spotify.includes(c.dataset.pl)));

applySpotifyHeight(settings.spotifyHeight || 'compact');
renderTodoList();

loadStateSnapshot();
refreshSessions();
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
})();
