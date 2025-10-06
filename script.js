/* Herd Immunity Explorer - KS3
   Simple grid simulation of infection spread with vaccination.
   States: 0=susceptible, 1=vaccinated, 2=infected, 3=recovered
*/

const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');
const arrowCanvas = document.getElementById('arrowCanvas');
const arrowCtx = arrowCanvas ? arrowCanvas.getContext('2d') : null;
const chartCanvas = document.getElementById('chartCanvas');
const chartCtx = chartCanvas.getContext('2d');

const r0Range = document.getElementById('r0Range');
const r0Value = document.getElementById('r0Value');
const vaccRange = document.getElementById('vaccRange');
const vaccValue = document.getElementById('vaccValue');
const btnStart = document.getElementById('btnStart');
const btnPause = document.getElementById('btnPause');
const btnStep = document.getElementById('btnStep');
const btnReset = document.getElementById('btnReset');
const speedRange = document.getElementById('speedRange');
const gridSizeSel = document.getElementById('gridSize');
const showArrowsEl = document.getElementById('showArrows');
const arrowSpeedEl = document.getElementById('arrowSpeed');

const susCountEl = document.getElementById('susCount');
const vacCountEl = document.getElementById('vacCount');
const infCountEl = document.getElementById('infCount');
const recCountEl = document.getElementById('recCount');
const dayCountEl = document.getElementById('dayCount');
const thresholdText = document.getElementById('thresholdText');

// Colors
const COLORS = {
  susceptible: '#64748b',
  vaccinated: '#22c55e',
  infected: '#ef4444',
  recovered: '#f59e0b'
};

// Prepare in-memory colored person icons for fast canvas drawing
let iconCanvas = {
  0: null, // susceptible
  1: null, // vaccinated
  2: null, // infected
  3: null  // recovered
};

let arrowIconCanvas = null; // offscreen arrow image for arrows

function createColoredIcon(color) {
  // Use the inline SVG and recolor via currentColor. Render to an offscreen canvas for speed.
  const svg = document.getElementById('icon-person');
  if (!svg) return null;
  const svgText = svg.outerHTML.replace(/currentColor/g, color);
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = 64; off.height = 64;
      const octx = off.getContext('2d');
      octx.drawImage(img, 0, 0, 64, 64);
      URL.revokeObjectURL(url);
      resolve(off);
    };
    img.src = url;
  });
}

function createArrowIcon(color) {
  const svg = document.getElementById('icon-arrow');
  if (!svg) return null;
  const svgText = svg.outerHTML.replace(/currentColor/g, color);
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = 64; off.height = 64;
      const octx = off.getContext('2d');
      octx.drawImage(img, 0, 0, 64, 64);
      URL.revokeObjectURL(url);
      resolve(off);
    };
    img.src = url;
  });
}

let N = parseInt(gridSizeSel.value, 10); // grid side
let cellSize; // computed based on canvas
let grid; // state grid
let nextGrid; // next state buffer
let day = 0;
let timer = null;
let infectedHistory = [];
let animations = []; // active arrow animations
// Arrow duration (ms) is dynamic from the UI slider
function getArrowDuration() {
  return parseInt(arrowSpeedEl?.value || '900', 10);
}

function computeCellSize() {
  cellSize = Math.floor(Math.min(canvas.width, canvas.height) / N);
  if (arrowCanvas) {
    arrowCanvas.width = canvas.width;
    arrowCanvas.height = canvas.height;
  }
}

function allocGrid(n) {
  const g = new Array(n);
  for (let i = 0; i < n; i++) g[i] = new Uint8Array(n); // values 0..3
  return g;
}

function clearGrid(g, val = 0) {
  for (let i = 0; i < g.length; i++) g[i].fill(val);
}

function cloneGrid(g) {
  const n = g.length;
  const c = allocGrid(n);
  for (let i = 0; i < n; i++) c[i].set(g[i]);
  return c;
}

function initGrid() {
  N = parseInt(gridSizeSel.value, 10);
  computeCellSize();
  grid = allocGrid(N);
  nextGrid = allocGrid(N);
  clearGrid(grid, 0);

  // Seed vaccination
  const vaccPct = parseInt(vaccRange.value, 10) / 100;
  let total = N * N;
  let vaccCount = Math.round(total * vaccPct);

  // Randomly choose vaccinated cells
  const allIdx = new Uint32Array(total);
  for (let i = 0; i < total; i++) allIdx[i] = i;
  shuffle(allIdx);

  for (let i = 0; i < vaccCount; i++) {
    const idx = allIdx[i];
    const r = Math.floor(idx / N);
    const c = idx % N;
    grid[r][c] = 1; // vaccinated
  }

  // Seed one initial infected in a random susceptible cell
  for (let tries = 0; tries < total; tries++) {
    const r = Math.floor(Math.random() * N);
    const c = Math.floor(Math.random() * N);
    if (grid[r][c] === 0) { grid[r][c] = 2; break; }
  }

  day = 0;
  infectedHistory = [countState(2)];
  updateStats();
  draw();
  drawChart();
  updateThresholdText();
}

function updateThresholdText() {
  const R0 = parseFloat(r0Range.value);
  if (R0 <= 1) {
    thresholdText.textContent = 'Below 0% (outbreaks die out)';
  } else {
    const thr = Math.max(0, Math.min(1, 1 - 1 / R0));
    thresholdText.textContent = Math.round(thr * 100) + '%';
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

function stepOnce() {
  const R0 = parseFloat(r0Range.value);

  // We model R0 by giving each infected a number of random contact attempts per day
  // and a fixed infectious period of 5 days. To avoid tracking per-cell age, we use SIR-like 
  // with probability to recover each day p_rec = 1/5.
  const pRecover = 1 / 5;

  // Constrain spread to 8 neighbors only. Approximate per-neighbor transmission probability
  // so that expected secondary cases over infectious period (~1/pRecover days) is ~ R0:
  // E[sec] ≈ 8 * (1/pRecover) * pTransmitNeighbor => pTransmitNeighbor ≈ R0 * pRecover / 8
  const pTransmitNeighbor = Math.min(1, Math.max(0, (R0 * pRecover) / 8));

  // Start with copy
  for (let r = 0; r < N; r++) {
    nextGrid[r].set(grid[r]);
  }

  const newInfections = [];

  // For each infected, try to infect only neighboring cells (no long-distance jumps)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== 2) continue;

      // Local neighborhood (Moore 8)
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
          if (grid[nr][nc] === 0 && Math.random() < pTransmitNeighbor) {
            nextGrid[nr][nc] = 2; // become infected
            newInfections.push({ from: { r, c }, to: { r: nr, c: nc } });
          }
        }
      }

      // Recover with probability pRecover
      if (Math.random() < pRecover) {
        nextGrid[r][c] = 3; // recovered
      }
    }
  }

  // Commit next grid
  const tmp = grid; grid = nextGrid; nextGrid = tmp;

  // Queue arrow animations for new infections
  const nowT = performance.now ? performance.now() : Date.now();
  if (showArrowsEl?.checked && arrowIconCanvas) {
    for (const ev of newInfections) {
      const sx = ev.from.c * cellSize + cellSize / 2;
      const sy = ev.from.r * cellSize + cellSize / 2;
      const tx = ev.to.c * cellSize + cellSize / 2;
      const ty = ev.to.r * cellSize + cellSize / 2;
      animations.push({ sx, sy, tx, ty, start: nowT, end: nowT + getArrowDuration() });
    }
  }

  day++;
  infectedHistory.push(countState(2));
  updateStats();
  draw();
  drawChart();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const pad = Math.max(0, Math.floor(cellSize * 0.1));
  const iconSize = Math.max(12, cellSize - pad * 2);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const state = grid[r][c];
      // draw faint background grid cell for clarity
      ctx.fillStyle = '#0b1022';
      ctx.fillRect(c * cellSize, r * cellSize, cellSize - 1, cellSize - 1);

      const off = iconCanvas[state];
      if (off) {
        ctx.drawImage(
          off,
          c * cellSize + (cellSize - iconSize) / 2,
          r * cellSize + (cellSize - iconSize) / 2,
          iconSize,
          iconSize
        );
      } else {
        // fallback colored square if icons not ready
        let color = COLORS.susceptible;
        if (state === 1) color = COLORS.vaccinated;
        else if (state === 2) color = COLORS.infected;
        else if (state === 3) color = COLORS.recovered;
        ctx.fillStyle = color;
        ctx.fillRect(c * cellSize + pad, r * cellSize + pad, iconSize, iconSize);
      }
    }
  }
}

function drawArrows() {
  if (!arrowCtx) return;
  arrowCtx.clearRect(0, 0, arrowCanvas.width, arrowCanvas.height);
  if (!arrowIconCanvas || !showArrowsEl?.checked) return;

  const nowT = performance.now ? performance.now() : Date.now();
  const keep = [];
  for (const a of animations) {
    const t = (nowT - a.start) / (a.end - a.start);
    if (t >= 1) {
      continue; // finished
    }
    const tt = Math.max(0, t);
    const x = a.sx + (a.tx - a.sx) * tt;
    const y = a.sy + (a.ty - a.sy) * tt;
    const angle = Math.atan2(a.ty - a.sy, a.tx - a.sx);
    const size = Math.max(16, Math.floor(cellSize * 0.6));

    arrowCtx.save();
    arrowCtx.translate(x, y);
    arrowCtx.rotate(angle);
    arrowCtx.globalAlpha = 0.85;
    arrowCtx.drawImage(arrowIconCanvas, -size / 2, -size / 2, size, size);
    arrowCtx.restore();

    keep.push(a);
  }
  animations = keep;
}

function animLoop() {
  drawArrows();
  requestAnimationFrame(animLoop);
}

function countState(state) {
  let n = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) if (grid[r][c] === state) n++;
  }
  return n;
}

function updateStats() {
  const sus = countState(0);
  const vac = countState(1);
  const inf = countState(2);
  const rec = countState(3);
  susCountEl.textContent = sus;
  vacCountEl.textContent = vac;
  infCountEl.textContent = inf;
  recCountEl.textContent = rec;
  dayCountEl.textContent = day;
}

function drawChart() {
  // Clear
  chartCtx.fillStyle = '#0b1022';
  chartCtx.fillRect(0, 0, chartCanvas.width, chartCanvas.height);

  if (infectedHistory.length < 2) return;
  const w = chartCanvas.width - 40;
  const h = chartCanvas.height - 30;
  const x0 = 30, y0 = chartCanvas.height - 20;

  // Axes
  chartCtx.strokeStyle = '#9ca3af';
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(x0, y0);
  chartCtx.lineTo(x0, y0 - h);
  chartCtx.moveTo(x0, y0);
  chartCtx.lineTo(x0 + w, y0);
  chartCtx.stroke();

  const maxInf = Math.max(1, ...infectedHistory);
  chartCtx.strokeStyle = '#ef4444';
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  for (let i = 0; i < infectedHistory.length; i++) {
    const x = x0 + (i / (infectedHistory.length - 1)) * w;
    const y = y0 - (infectedHistory[i] / maxInf) * h;
    if (i === 0) chartCtx.moveTo(x, y); else chartCtx.lineTo(x, y);
  }
  chartCtx.stroke();
}

function startLoop() {
  if (timer) return;
  btnStart.disabled = true;
  btnPause.disabled = false;
  const delay = 1000 - parseInt(speedRange.value, 10); // faster when slider higher
  timer = setInterval(() => {
    stepOnce();
    if (countState(2) === 0) { // stop when no infected remain
      stopLoop();
      btnStart.disabled = false;
      btnPause.disabled = true;
    }
  }, Math.max(50, delay));
}

function stopLoop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function resetSim() {
  stopLoop();
  btnStart.disabled = false;
  btnPause.disabled = true;
  animations = [];
  if (arrowCtx) arrowCtx.clearRect(0, 0, arrowCanvas.width, arrowCanvas.height);
  initGrid();
}

// Event wiring
r0Range.addEventListener('input', () => {
  r0Value.textContent = parseFloat(r0Range.value).toFixed(1);
  updateThresholdText();
});
vaccRange.addEventListener('input', () => {
  vaccValue.textContent = `${vaccRange.value}%`;
});
btnStart.addEventListener('click', startLoop);
btnPause.addEventListener('click', () => { stopLoop(); btnStart.disabled = false; btnPause.disabled = true; });
btnStep.addEventListener('click', () => { stopLoop(); stepOnce(); btnStart.disabled = false; btnPause.disabled = true; });
btnReset.addEventListener('click', resetSim);
speedRange.addEventListener('input', () => { if (timer) { stopLoop(); startLoop(); } });
gridSizeSel.addEventListener('change', resetSim);

// Initial UI labels
r0Value.textContent = parseFloat(r0Range.value).toFixed(1);
vaccValue.textContent = `${vaccRange.value}%`;

// Resize handling to keep squares crisp
function resizeCanvasForDisplay() {
  // Keep canvas square; base on its CSS size
  const rect = canvas.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  // For simplicity keep fixed internal size, CSS will scale
  computeCellSize();
  draw();
  drawChart();
}
window.addEventListener('resize', resizeCanvasForDisplay);

// Kick off
Promise.all([
  createColoredIcon(COLORS.susceptible),
  createColoredIcon(COLORS.vaccinated),
  createColoredIcon(COLORS.infected),
  createColoredIcon(COLORS.recovered),
  createArrowIcon(COLORS.infected)
]).then(([sus, vac, inf, rec, arr]) => {
  iconCanvas[0] = sus;
  iconCanvas[1] = vac;
  iconCanvas[2] = inf;
  iconCanvas[3] = rec;
  arrowIconCanvas = arr;
  initGrid();
  requestAnimationFrame(animLoop);
}).catch(() => {
  // If SVG preparation fails for some reason, still initialize
  initGrid();
});
