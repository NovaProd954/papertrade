/**
 * APEX TRADER — app.js
 * Paper Trading Simulator | Educational Platform
 *
 * Features:
 *  - CoinGecko real-time price feed (free API, no key required)
 *  - Simulated market engine (procedural candlestick generation)
 *  - Full trading engine (long/short, SL, TP, liquidation)
 *  - Theme color system (5 presets + custom picker)
 *  - Candlestick color presets + custom color pickers
 *  - Interactive 20-step tutorial system
 *  - Technical indicators: SMA, EMA, RSI, Volume
 *  - Portfolio, trade history, trading journal
 *  - Achievement system, educational mentor tips
 */

'use strict';

// ================================================================
// CONFIGURATION
// ================================================================
const CONFIG = {
  STARTING_BALANCE : 10_000,
  CANDLES_VISIBLE  : 80,
  TICK_MS          : 200,       // base simulation tick interval (ms)
  COINGECKO_POLL   : 10_000,    // live price poll interval (ms)
  LEARN_MODE       : true,
  DATA_SOURCE      : 'sim',     // 'sim' | 'live'
};

// Coin IDs → display labels (CoinGecko ID : label)
const COIN_MAP = {
  'bitcoin'      : 'BTC/USD',
  'ethereum'     : 'ETH/USD',
  'solana'       : 'SOL/USD',
  'binancecoin'  : 'BNB/USD',
  'ripple'       : 'XRP/USD',
  'cardano'      : 'ADA/USD',
  'dogecoin'     : 'DOGE/USD',
  'avalanche-2'  : 'AVAX/USD',
  'chainlink'    : 'LINK/USD',
  'polkadot'     : 'DOT/USD',
};

// Approximate seed prices used before live data arrives
const SEED_PRICES = {
  'bitcoin'      : 65000,
  'ethereum'     : 3500,
  'solana'       : 155,
  'binancecoin'  : 580,
  'ripple'       : 0.52,
  'cardano'      : 0.45,
  'dogecoin'     : 0.15,
  'avalanche-2'  : 35,
  'chainlink'    : 14,
  'polkadot'     : 7.5,
};

// ================================================================
// APPLICATION STATE
// ================================================================
const state = {
  // Account
  balance      : CONFIG.STARTING_BALANCE,
  realizedPnL  : 0,
  positions    : [],
  history      : [],
  journal      : [],
  tradeId      : 0,
  wins         : 0,
  losses       : 0,

  // Market / chart
  coin         : 'bitcoin',
  candleData   : [],
  currentCandle: null,
  currentPrice : SEED_PRICES['bitcoin'],
  prevPrice    : SEED_PRICES['bitcoin'],
  openPrice24h : SEED_PRICES['bitcoin'],
  highPrice24h : SEED_PRICES['bitcoin'],
  lowPrice24h  : SEED_PRICES['bitcoin'],
  candleCount  : 0,
  tickCount    : 0,

  // Simulation engine
  tf           : 1,    // timeframe in minutes
  speed        : 1,
  paused       : false,
  trend        : 0,
  trendDur     : 50,
  trendTimer   : 0,
  volatility   : 1.0,

  // Indicators
  indicators   : { sma: false, ema: false, rsi: false, vol: false },

  // Theme
  bullColor    : '#00e67a',
  bearColor    : '#ff3355',
};

// ================================================================
// THEME / COLOR ENGINE
// ================================================================

/**
 * Apply a named accent theme preset.
 * Removes all theme-* classes and adds the new one.
 */
function setTheme(themeName, swatchEl) {
  const root = document.documentElement;
  ['cyan','amber','violet','emerald','rose'].forEach(t => root.classList.remove('theme-' + t));
  root.classList.add('theme-' + themeName);

  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
  if (swatchEl) swatchEl.classList.add('active');
}

/**
 * Apply an arbitrary hex colour as the accent (custom picker).
 */
function setCustomAccent(hex) {
  const root = document.documentElement;
  // Remove presets so custom rules take precedence
  ['cyan','amber','violet','emerald','rose'].forEach(t => root.classList.remove('theme-' + t));
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));

  // Build a dimmer version for --accent2 (darken ~30%)
  const accent2 = darkenHex(hex, 0.65);
  root.style.setProperty('--accent',      hex);
  root.style.setProperty('--accent2',     accent2);
  root.style.setProperty('--accent-glow', hexToRgba(hex, 0.15));
}

/**
 * Set candle colour for 'bull' or 'bear' side.
 */
function setCandleColor(side, hex) {
  const root = document.documentElement;
  if (side === 'bull') {
    state.bullColor = hex;
    root.style.setProperty('--bull-color', hex);
    root.style.setProperty('--bull-glow',  hexToRgba(hex, 0.15));
    document.getElementById('bull-hex').textContent = hex;
  } else {
    state.bearColor = hex;
    root.style.setProperty('--bear-color', hex);
    root.style.setProperty('--bear-glow',  hexToRgba(hex, 0.15));
    document.getElementById('bear-hex').textContent = hex;
  }
  renderChart();
}

/**
 * Apply a named candle colour preset.
 */
function applyCandlePreset(bullHex, bearHex) {
  document.getElementById('bull-color-input').value = bullHex;
  document.getElementById('bear-color-input').value = bearHex;
  setCandleColor('bull', bullHex);
  setCandleColor('bear', bearHex);
}

// Colour helpers
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function darkenHex(hex, factor) {
  const r = Math.round(parseInt(hex.slice(1,3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3,5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5,7), 16) * factor);
  return '#' + [r,g,b].map(v => Math.min(255,v).toString(16).padStart(2,'0')).join('');
}

// ================================================================
// MODAL HELPERS
// ================================================================
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ================================================================
// DATA SOURCE SWITCHER
// ================================================================
function switchDataSource(src) {
  CONFIG.DATA_SOURCE = src;
  const badge = document.getElementById('data-source-badge');
  const dm    = document.getElementById('data-mode');

  if (src === 'live') {
    badge.className   = 'nav-data-badge live-badge';
    badge.textContent = 'LIVE';
    dm.textContent    = 'LIVE';
    startLiveFeed();
    showNotif('🌐 Live Data Active', 'Pulling real prices from CoinGecko.', 'success');
  } else {
    badge.className   = 'nav-data-badge sim-badge';
    badge.textContent = 'SIM';
    dm.textContent    = 'SIM';
    stopLiveFeed();
    showNotif('🎲 Simulation Mode', 'Using procedural market engine.', '');
  }
}

// ================================================================
// COINGECKO LIVE PRICE FEED
// ================================================================
let liveInterval = null;
let lastLivePrice = null;

/**
 * Fetch current price from CoinGecko's free /simple/price endpoint.
 * No API key required. Rate limit: ~50 calls/min free tier.
 */
async function fetchLivePrice() {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${state.coin}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_last_updated_at=true`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error('CoinGecko ' + res.status);
    const data = await res.json();
    const info = data[state.coin];
    if (!info) return;

    const newPrice = info.usd;
    const change24 = info.usd_24h_change || 0;

    // Inject price into our engine
    if (lastLivePrice !== null && !state.paused) {
      injectLivePrice(newPrice);
    }
    lastLivePrice = newPrice;
    state.openPrice24h = newPrice / (1 + change24 / 100);

    // Update nav change display
    const pct  = change24;
    const chEl = document.getElementById('nav-change');
    chEl.textContent  = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    chEl.className    = 'nav-change ' + (pct >= 0 ? 'up' : 'dn');

  } catch (err) {
    console.warn('CoinGecko fetch failed, falling back to sim:', err.message);
    // Badge shows fallback
    const badge = document.getElementById('data-source-badge');
    badge.textContent = 'ERR';
    badge.style.color = 'var(--yellow)';
  }
}

/**
 * Smoothly walk the simulated price toward the live price
 * over several ticks so candles look natural.
 */
function injectLivePrice(targetPrice) {
  // Snap current price toward the real price gradually
  const diff  = targetPrice - state.currentPrice;
  const steps = Math.max(5, CONFIG.COINGECKO_POLL / CONFIG.TICK_MS);
  state._liveTarget = targetPrice;
  state._liveStep   = diff / steps;
}

function startLiveFeed() {
  stopLiveFeed();
  fetchLivePrice(); // immediate
  liveInterval = setInterval(fetchLivePrice, CONFIG.COINGECKO_POLL);
}

function stopLiveFeed() {
  if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
  lastLivePrice   = null;
  state._liveTarget = null;
  state._liveStep   = null;
}

// ================================================================
// MARKET SIMULATION ENGINE
// ================================================================
let marketTimer = null;

function startMarket() {
  if (marketTimer) clearInterval(marketTimer);
  const interval = Math.max(16, CONFIG.TICK_MS / state.speed);
  marketTimer = setInterval(marketTick, interval);
}

function marketTick() {
  if (state.paused) return;

  // --- Trend management ---
  state.trendTimer++;
  if (state.trendTimer >= state.trendDur) {
    const r = Math.random();
    state.trend    = r < 0.33 ? -1 : r < 0.66 ? 1 : 0;
    state.trendDur = 30 + Math.floor(Math.random() * 120);
    state.trendTimer = 0;
  }

  // --- Volatility cycles ---
  if (Math.random() < 0.003) {
    state.volatility = 0.4 + Math.random() * 3.2;
  } else {
    state.volatility += (1.0 - state.volatility) * 0.01;
  }

  // --- Price movement ---
  let delta;

  if (CONFIG.DATA_SOURCE === 'live' && state._liveStep != null) {
    // Guided walk toward CoinGecko price
    const remaining = state._liveTarget - state.currentPrice;
    const noise     = state.currentPrice * 0.0002 * state.volatility * (Math.random() - 0.5);
    delta = state._liveStep * 0.8 + noise;
    // Stop nudging when close
    if (Math.abs(remaining) < Math.abs(state._liveStep)) {
      state._liveStep   = null;
      state._liveTarget = null;
    }
  } else {
    // Pure simulation
    const baseMove  = state.currentPrice * 0.0008 * state.volatility;
    const trendBias = state.trend * state.currentPrice * 0.0003;
    const noise     = (Math.random() - 0.5) * 2 * baseMove;
    const momentum  = (state.currentPrice - state.prevPrice) * 0.15;
    delta = noise + trendBias + momentum;
  }

  state.prevPrice    = state.currentPrice;
  state.currentPrice = Math.max(0.00001, state.currentPrice + delta);

  // 24h stats
  state.highPrice24h = Math.max(state.highPrice24h, state.currentPrice);
  state.lowPrice24h  = Math.min(state.lowPrice24h,  state.currentPrice);

  // Live candle update
  updateLiveCandle();

  // Candle close?
  state.tickCount++;
  if (state.tickCount >= getTicksPerCandle()) {
    closeCandle();
    state.tickCount = 0;
  }

  updateUI();
  checkPositions();
}

function getTicksPerCandle() {
  const base = { 1: 50, 5: 250, 15: 750, 60: 3000 };
  return Math.ceil((base[state.tf] || 50) / state.speed);
}

function updateLiveCandle() {
  if (!state.currentCandle) {
    state.currentCandle = {
      t: Date.now(),
      o: state.currentPrice,
      h: state.currentPrice,
      l: state.currentPrice,
      c: state.currentPrice,
      v: 0,
    };
  }
  state.currentCandle.c = state.currentPrice;
  state.currentCandle.h = Math.max(state.currentCandle.h, state.currentPrice);
  state.currentCandle.l = Math.min(state.currentCandle.l, state.currentPrice);
  state.currentCandle.v += Math.abs(state.currentPrice - state.prevPrice) * (100 + Math.random() * 500);
}

function closeCandle() {
  if (!state.currentCandle) return;
  state.candleData.push({ ...state.currentCandle });
  if (state.candleData.length > 500) state.candleData.shift();
  state.candleCount++;
  state.currentCandle = null;
  updateLiveCandle();
}

/**
 * Seed historical candle data so the chart isn't empty on load.
 */
function initCandleHistory(seedPrice) {
  state.candleData  = [];
  state.currentCandle = null;
  let price   = seedPrice || state.currentPrice;
  let trend   = 0;
  let tTimer  = 0;
  let tDur    = 30;
  const count = 120;

  for (let i = 0; i < count; i++) {
    tTimer++;
    if (tTimer >= tDur) {
      trend  = [-1, 0, 1][Math.floor(Math.random() * 3)];
      tDur   = 20 + Math.floor(Math.random() * 60);
      tTimer = 0;
    }
    const vol   = 0.7 + Math.random() * 1.6;
    const range = price * 0.008 * vol;
    const open  = price;
    const bias  = trend * price * 0.003;
    const close = open + (Math.random() - 0.5) * range + bias;
    const high  = Math.max(open, close) + Math.random() * range * 0.5;
    const low   = Math.min(open, close) - Math.random() * range * 0.5;
    const volume = 10_000 + Math.random() * 90_000;
    state.candleData.push({
      t: Date.now() - (count - i) * 60_000 * state.tf,
      o: open, h: high, l: low, c: close, v: volume,
    });
    price = close;
  }
  state.currentPrice = price;
  state.prevPrice    = price;
  state.openPrice24h = state.candleData[0].o;
  state.highPrice24h = Math.max(...state.candleData.map(c => c.h));
  state.lowPrice24h  = Math.min(...state.candleData.map(c => c.l));
  updateLiveCandle();
}

// ================================================================
// COIN CHANGE
// ================================================================
function onCoinChange() {
  const sel      = document.getElementById('coin-select');
  state.coin     = sel.value;
  const label    = COIN_MAP[state.coin] || state.coin.toUpperCase() + '/USD';
  document.getElementById('nav-symbol').textContent = label;

  // Reset to seed price
  const seed = SEED_PRICES[state.coin] || 100;
  state.currentPrice = seed;
  state.prevPrice    = seed;
  lastLivePrice      = null;

  initCandleHistory(seed);
  if (CONFIG.DATA_SOURCE === 'live') fetchLivePrice();

  showNotif('🔄 Coin Switched', `Now trading ${label}`, '');
}

// ================================================================
// CHART RENDERER (Canvas)
// ================================================================
let chartCanvas, chartCtx;
let chartW = 0, chartH = 0;
let mouseX = -1, mouseY = -1;

const PRICE_AXIS_W = 74;
const TIME_AXIS_H  = 28;

function initChart() {
  chartCanvas = document.getElementById('chart-canvas');
  chartCtx    = chartCanvas.getContext('2d');
  resizeChart();
  chartCanvas.addEventListener('mousemove', onChartMouseMove);
  chartCanvas.addEventListener('mouseleave', onChartMouseLeave);
  window.addEventListener('resize', resizeChart);
}

function resizeChart() {
  const wrap = document.getElementById('chart-wrap');
  if (!wrap) return;
  chartW = wrap.clientWidth;
  chartH = wrap.clientHeight;
  if (chartCanvas) { chartCanvas.width = chartW; chartCanvas.height = chartH; }

  const rsi = document.getElementById('rsi-canvas');
  const rsiP = document.getElementById('rsi-panel');
  if (rsi && rsiP) { rsi.width = rsiP.clientWidth; rsi.height = rsiP.clientHeight; }

  const vol = document.getElementById('vol-canvas');
  const volP = document.getElementById('volume-panel');
  if (vol && volP) { vol.width = volP.clientWidth; vol.height = volP.clientHeight; }

  renderChart();
}

function renderChart() {
  if (!chartCtx) return;
  const ctx = chartCtx;
  const W = chartW, H = chartH;
  const plotW = W - PRICE_AXIS_W;
  const plotH = H - TIME_AXIS_H;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0f1a';
  ctx.fillRect(0, 0, W, H);

  // Build display candles
  const allCandles = [...state.candleData];
  if (state.currentCandle) allCandles.push(state.currentCandle);
  const visible  = Math.min(allCandles.length, CONFIG.CANDLES_VISIBLE);
  const candles  = allCandles.slice(-visible);
  if (candles.length === 0) return;

  // Price range with padding
  let minP = Infinity, maxP = -Infinity;
  candles.forEach(c => { minP = Math.min(minP, c.l); maxP = Math.max(maxP, c.h); });
  const pad    = (maxP - minP) * 0.1 || minP * 0.05;
  minP -= pad; maxP += pad;
  const range  = maxP - minP || 1;

  const toY      = p => plotH - ((p - minP) / range) * plotH;
  const spacing  = plotW / candles.length;
  const candleW  = spacing * 0.75;

  // Grid
  ctx.strokeStyle = '#131c2b';
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 6; i++) {
    const y = (plotH / 6) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
  }
  const vLines = Math.min(candles.length, 8);
  for (let i = 0; i <= vLines; i++) {
    const x = (plotW / vLines) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke();
  }

  // Price axis labels
  ctx.fillStyle  = '#3d5a7a';
  ctx.font       = '11px IBM Plex Mono,monospace';
  ctx.textAlign  = 'left';
  for (let i = 0; i <= 6; i++) {
    const price = maxP - (range / 6) * i;
    const y     = (plotH / 6) * i;
    ctx.fillText('$' + formatPrice(price), plotW + 4, y + 4);
  }

  // SMA
  if (state.indicators.sma && candles.length >= 20) {
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 19; i < candles.length; i++) {
      const sma = candles.slice(i - 19, i + 1).reduce((a, c) => a + c.c, 0) / 20;
      const x   = i * spacing + spacing / 2;
      i === 19 ? ctx.moveTo(x, toY(sma)) : ctx.lineTo(x, toY(sma));
    }
    ctx.stroke();
    ctx.fillStyle = '#ffcc00';
    ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'left';
    ctx.fillText('SMA20', 4, 14);
  }

  // EMA
  if (state.indicators.ema && candles.length >= 12) {
    ctx.strokeStyle = '#ff88aa';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    const k = 2 / (12 + 1);
    let ema = candles[0].c;
    for (let i = 0; i < candles.length; i++) {
      ema = candles[i].c * k + ema * (1 - k);
      const x = i * spacing + spacing / 2;
      i === 0 ? ctx.moveTo(x, toY(ema)) : ctx.lineTo(x, toY(ema));
    }
    ctx.stroke();
    ctx.fillStyle = '#ff88aa'; ctx.font = '10px IBM Plex Mono';
    ctx.fillText('EMA12', 4, state.indicators.sma ? 28 : 14);
  }

  // Candles
  for (let i = 0; i < candles.length; i++) {
    const c     = candles[i];
    const x     = i * spacing + spacing / 2;
    const bull  = c.c >= c.o;
    const color = bull ? state.bullColor : state.bearColor;
    const bodyTop = toY(Math.max(c.o, c.c));
    const bodyBot = toY(Math.min(c.o, c.c));
    const bodyH   = Math.max(1, bodyBot - bodyTop);
    const isLive  = i === candles.length - 1 && !!state.currentCandle;

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, toY(c.h)); ctx.lineTo(x, toY(c.l)); ctx.stroke();

    // Body
    ctx.fillStyle = isLive ? hexToRgba(color, 0.65) : color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  }

  // Position entry lines
  ctx.setLineDash([4, 4]);
  for (const pos of state.positions) {
    const isLong = pos.type === 'long';
    const lc     = isLong ? state.bullColor : state.bearColor;
    ctx.strokeStyle = lc;
    ctx.lineWidth   = 1;
    const ey = toY(pos.entry);
    ctx.beginPath(); ctx.moveTo(0, ey); ctx.lineTo(plotW, ey); ctx.stroke();
    ctx.fillStyle  = lc;
    ctx.font       = 'bold 9px IBM Plex Mono';
    ctx.textAlign  = 'left';
    ctx.fillText(`${isLong ? 'LONG' : 'SHORT'} @$${formatPrice(pos.entry)}`, 4, ey - 3);

    if (pos.sl) {
      ctx.strokeStyle = hexToRgba(state.bearColor, 0.6);
      ctx.lineWidth   = 1;
      const sy = toY(pos.sl);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(plotW, sy); ctx.stroke();
    }
    if (pos.tp) {
      ctx.strokeStyle = hexToRgba(state.bullColor, 0.6);
      ctx.lineWidth   = 1;
      const ty = toY(pos.tp);
      ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(plotW, ty); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // Current price line
  const cpY = toY(state.currentPrice);
  ctx.strokeStyle = 'rgba(0,200,255,0.45)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath(); ctx.moveTo(0, cpY); ctx.lineTo(plotW, cpY); ctx.stroke();
  ctx.setLineDash([]);

  // Current price box
  ctx.fillStyle   = 'var(--accent)';
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00c8ff';
  ctx.fillStyle   = accentColor;
  ctx.fillRect(plotW, cpY - 9, PRICE_AXIS_W, 18);
  ctx.fillStyle   = '#000';
  ctx.font        = 'bold 10px Share Tech Mono,monospace';
  ctx.textAlign   = 'center';
  ctx.fillText('$' + formatPrice(state.currentPrice), plotW + PRICE_AXIS_W / 2, cpY + 4);

  // Time axis
  ctx.fillStyle  = '#3d5a7a';
  ctx.font       = '10px IBM Plex Mono';
  ctx.textAlign  = 'center';
  const step = Math.ceil(candles.length / 6);
  for (let i = 0; i < candles.length; i += step) {
    const d   = new Date(candles[i].t);
    const lbl = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    ctx.fillText(lbl, i * spacing + spacing / 2, plotH + 18);
  }

  // Crosshair
  if (mouseX >= 0 && mouseX <= plotW && mouseY >= 0 && mouseY <= plotH) {
    ctx.strokeStyle = 'rgba(100,140,200,0.28)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(mouseX, 0); ctx.lineTo(mouseX, plotH);
    ctx.moveTo(0, mouseY); ctx.lineTo(plotW, mouseY);
    ctx.stroke();

    const hoverPrice = maxP - (mouseY / plotH) * range;
    const cpEl = document.getElementById('crosshair-price');
    cpEl.style.display = 'block';
    cpEl.style.top     = (mouseY - 9) + 'px';
    cpEl.textContent   = '$' + formatPrice(hoverPrice);

    const ci = Math.floor(mouseX / spacing);
    if (ci >= 0 && ci < candles.length) {
      const hc = candles[ci];
      setText('ohlc-o', '$' + formatPrice(hc.o));
      setText('ohlc-h', '$' + formatPrice(hc.h));
      setText('ohlc-l', '$' + formatPrice(hc.l));
      setText('ohlc-c', '$' + formatPrice(hc.c));
    }
  } else {
    document.getElementById('crosshair-price').style.display = 'none';
    document.getElementById('crosshair-time').style.display  = 'none';
    const lc = state.currentCandle || state.candleData[state.candleData.length - 1];
    if (lc) {
      setText('ohlc-o', '$' + formatPrice(lc.o));
      setText('ohlc-h', '$' + formatPrice(lc.h));
      setText('ohlc-l', '$' + formatPrice(lc.l));
      setText('ohlc-c', '$' + formatPrice(lc.c));
    }
  }

  // Sub-panels
  if (state.indicators.rsi) renderRSI(candles);
  if (state.indicators.vol) renderVolume(candles);
}

function renderRSI(candles) {
  const canvas = document.getElementById('rsi-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0f1a'; ctx.fillRect(0, 0, W, H);

  if (candles.length < 15) return;
  const plotW   = W - PRICE_AXIS_W;
  const rsiVals = calcRSI(candles, 14);
  const spacing = plotW / candles.length;

  ctx.fillStyle = 'rgba(255,51,85,0.05)';
  ctx.fillRect(0, 0, plotW, H * 0.3);
  ctx.fillStyle = 'rgba(0,230,122,0.05)';
  ctx.fillRect(0, H * 0.7, plotW, H * 0.3);

  ctx.strokeStyle = '#1e3050'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
  [0.3, 0.5, 0.7].forEach(p => {
    ctx.beginPath(); ctx.moveTo(0, H - p * H); ctx.lineTo(plotW, H - p * H); ctx.stroke();
  });
  ctx.setLineDash([]);

  ctx.strokeStyle = '#9944ee'; ctx.lineWidth = 1.5; ctx.beginPath();
  let first = true;
  for (let i = 0; i < rsiVals.length; i++) {
    const x = (i + (candles.length - rsiVals.length)) * spacing + spacing / 2;
    const y = H - (rsiVals[i] / 100) * H;
    first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    first = false;
  }
  ctx.stroke();

  ctx.fillStyle = '#3d5a7a'; ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'left';
  ctx.fillText('70', plotW + 4, H * 0.3 + 4);
  ctx.fillText('30', plotW + 4, H * 0.7 + 4);
  ctx.fillStyle = '#9944ee'; ctx.fillText('RSI14', plotW + 4, 12);

  const last = rsiVals[rsiVals.length - 1];
  if (last !== undefined) {
    ctx.fillStyle = last > 70 ? state.bearColor : last < 30 ? state.bullColor : '#9944ee';
    ctx.fillText(last.toFixed(1), plotW + 4, 24);
  }
}

function calcRSI(candles, period) {
  const vals = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period && i < candles.length; i++) {
    const d = candles[i].c - candles[i-1].c;
    d > 0 ? gains += d : losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].c - candles[i-1].c;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag * (period - 1) + g) / period;
    al = (al * (period - 1) + l) / period;
    const rs = al === 0 ? 100 : ag / al;
    vals.push(100 - 100 / (1 + rs));
  }
  return vals;
}

function renderVolume(candles) {
  const canvas = document.getElementById('vol-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0f1a'; ctx.fillRect(0, 0, W, H);

  const plotW   = W - PRICE_AXIS_W;
  const spacing = plotW / candles.length;
  const maxVol  = Math.max(...candles.map(c => c.v));

  candles.forEach((c, i) => {
    const bull  = c.c >= c.o;
    const x     = i * spacing + spacing / 2;
    const barH  = (c.v / maxVol) * (H - 4);
    const barW  = spacing * 0.75;
    ctx.fillStyle = hexToRgba(bull ? state.bullColor : state.bearColor, 0.4);
    ctx.fillRect(x - barW / 2, H - barH, barW, barH);
  });

  ctx.fillStyle = '#3d5a7a'; ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'left';
  ctx.fillText('VOL', plotW + 4, 12);
}

function onChartMouseMove(e) {
  const rect = chartCanvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
  renderChart();
}

function onChartMouseLeave() {
  mouseX = -1; mouseY = -1;
  renderChart();
}

// ================================================================
// TRADING ENGINE
// ================================================================
function executeTrade(type) {
  const size = parseFloat(document.getElementById('size-input').value) || 0;
  const sl   = parseFloat(document.getElementById('sl-input').value)   || null;
  const tp   = parseFloat(document.getElementById('tp-input').value)   || null;

  if (size <= 0) { showNotif('Invalid Size', 'Enter a positive trade size.', 'danger'); return; }
  if (size > state.balance) {
    showNotif('Insufficient Balance', `Need $${formatNum(size)}, have $${formatNum(state.balance)}.`, 'danger');
    return;
  }
  if (sl && type === 'long'  && sl >= state.currentPrice) {
    showNotif('Invalid Stop Loss', 'For a long, SL must be below entry.', 'warn'); return;
  }
  if (sl && type === 'short' && sl <= state.currentPrice) {
    showNotif('Invalid Stop Loss', 'For a short, SL must be above entry.', 'warn'); return;
  }

  const pos = {
    id       : ++state.tradeId,
    type,
    entry    : state.currentPrice,
    size,
    sl       : sl || null,
    tp       : tp || null,
    openTime : Date.now(),
    pnl      : 0,
  };

  state.balance -= size;
  state.positions.push(pos);

  showNotif(
    type === 'long' ? '📈 Long Opened' : '📉 Short Opened',
    `${type.toUpperCase()} $${formatNum(size)} @ $${formatPrice(state.currentPrice)}`,
    'success'
  );

  // Educational RSI warning
  if (CONFIG.LEARN_MODE && state.indicators.rsi) {
    const rsi = calcRSI(state.candleData, 14);
    if (rsi.length > 0) {
      const r = rsi[rsi.length - 1];
      if (type === 'long'  && r > 65) showEduMsg('⚠️ You bought with RSI above 65 — potentially overbought. Watch for a pullback before going long.');
      if (type === 'short' && r < 35) showEduMsg('⚠️ You shorted with RSI below 35 — potentially oversold. The market might bounce before falling further.');
    }
  }

  updatePortfolioUI();
  renderChart();
}

function closePosition(id) {
  const idx = state.positions.findIndex(p => p.id === id);
  if (idx === -1) return;
  const pos = state.positions[idx];
  const pnl = calcPnL(pos);
  finalizeClose(pos, pnl);
  state.positions.splice(idx, 1);
}

function closePositionAuto(idx, reason) {
  const pos = state.positions[idx];
  const pnl = calcPnL(pos);
  const cap = Math.max(0, pos.size + pnl);
  showNotif(reason.title, reason.body, reason.type);
  finalizeClose(pos, pnl, cap);
  state.positions.splice(idx, 1);
}

function finalizeClose(pos, pnl, capturedReturn) {
  const returned = capturedReturn !== undefined ? capturedReturn : Math.max(0, pos.size + pnl);
  state.balance     += returned;
  state.realizedPnL += pnl;

  if (pnl >= 0) { state.wins++;   checkAchievements('win'); }
  else          { state.losses++; }

  state.history.unshift({
    id       : pos.id,
    type     : pos.type,
    entry    : pos.entry,
    exit     : state.currentPrice,
    size     : pos.size,
    pnl,
    duration : Math.floor((Date.now() - pos.openTime) / 1000),
  });

  if (CONFIG.LEARN_MODE) {
    if (pnl >= 0)
      showEduMsg(`✅ Profit of $${formatNum(pnl)}! Entry $${formatPrice(pos.entry)} → Exit $${formatPrice(state.currentPrice)}. Great read on the market!`);
    else
      showEduMsg(`📉 Loss of $${formatNum(Math.abs(pnl))}. Review where the move went against you. Tight stop-losses prevent larger drawdowns.`);
  }

  updatePortfolioUI();
  renderChart();
}

function calcPnL(pos) {
  const diff = pos.type === 'long'
    ? (state.currentPrice - pos.entry) / pos.entry
    : (pos.entry - state.currentPrice) / pos.entry;
  return pos.size * diff;
}

function checkPositions() {
  for (let i = state.positions.length - 1; i >= 0; i--) {
    const pos = state.positions[i];
    pos.pnl = calcPnL(pos);

    if (pos.type === 'long') {
      if (pos.sl && state.currentPrice <= pos.sl) {
        closePositionAuto(i, { title: '🛑 Stop Loss Hit', body: `Long SL triggered @ $${formatPrice(state.currentPrice)}`, type: 'warn' }); continue;
      }
      if (pos.tp && state.currentPrice >= pos.tp) {
        closePositionAuto(i, { title: '🎯 Take Profit Hit', body: `Long TP triggered @ $${formatPrice(state.currentPrice)}`, type: 'success' }); continue;
      }
    } else {
      if (pos.sl && state.currentPrice >= pos.sl) {
        closePositionAuto(i, { title: '🛑 Stop Loss Hit', body: `Short SL triggered @ $${formatPrice(state.currentPrice)}`, type: 'warn' }); continue;
      }
      if (pos.tp && state.currentPrice <= pos.tp) {
        closePositionAuto(i, { title: '🎯 Take Profit Hit', body: `Short TP triggered @ $${formatPrice(state.currentPrice)}`, type: 'success' }); continue;
      }
    }

    // Liquidation at 95% loss
    if (pos.pnl < -pos.size * 0.95) {
      closePositionAuto(i, { title: '💀 Liquidated', body: `Position wiped. Total loss: $${formatNum(pos.size)}`, type: 'danger' });
    }
  }
}

// ================================================================
// UI UPDATES
// ================================================================
let _lastNavPrice = 0;

function updateUI() {
  const price = state.currentPrice;
  const priceEl = document.getElementById('nav-price');
  if (priceEl) {
    priceEl.textContent = '$' + formatPrice(price);
    priceEl.style.color = price > _lastNavPrice
      ? state.bullColor : price < _lastNavPrice
      ? state.bearColor : 'var(--text-primary)';
  }
  _lastNavPrice = price;

  // 24h change (when in SIM mode we compute from openPrice24h)
  if (CONFIG.DATA_SOURCE === 'sim') {
    const pct  = ((price - state.openPrice24h) / state.openPrice24h) * 100;
    const chEl = document.getElementById('nav-change');
    if (chEl) {
      chEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      chEl.className   = 'nav-change ' + (pct >= 0 ? 'up' : 'dn');
    }
  }

  updatePortfolioUI();
}

function updatePortfolioUI() {
  const unrealPnL = state.positions.reduce((s, p) => s + calcPnL(p), 0);
  const posValue  = state.positions.reduce((s, p) => s + p.size, 0);
  const equity    = state.balance + posValue + unrealPnL;

  const money = v => (v >= 0 ? '+' : '') + '$' + formatNum(Math.abs(v));

  setVal('balance-display', '$' + formatNum(state.balance), 'accent');
  setVal('equity-display',  '$' + formatNum(equity), equity >= CONFIG.STARTING_BALANCE ? '' : 'red');
  setVal('unreal-pnl', money(unrealPnL), unrealPnL >= 0 ? 'green' : 'red');
  setVal('real-pnl',   money(state.realizedPnL), state.realizedPnL >= 0 ? 'green' : 'red');

  setVal('port-balance',   '$' + formatNum(state.balance), 'accent');
  const totalPnL = state.realizedPnL + unrealPnL;
  setVal('port-total-pnl', money(totalPnL), totalPnL >= 0 ? 'green' : 'red');

  const total = state.wins + state.losses;
  setText('port-winrate', total > 0 ? (state.wins / total * 100).toFixed(1) + '%' : '—');
  setText('port-trades',  String(total));

  const pnls = state.history.map(h => h.pnl);
  if (pnls.length > 0) {
    setVal('port-best',  '+$' + formatNum(Math.max(...pnls)), 'green');
    setVal('port-worst', '-$' + formatNum(Math.abs(Math.min(...pnls))), 'red');
  }

  setText('candle-count', String(state.candleCount));
  setText('win-count',    String(state.wins));
  setText('loss-count',   String(state.losses));

  const spEl = document.getElementById('session-pnl');
  if (spEl) {
    spEl.textContent  = money(totalPnL);
    spEl.style.color  = totalPnL >= 0 ? state.bullColor : state.bearColor;
  }

  renderPositionCards();
  renderTradeHistory();
  checkAchievements('balance');
}

function renderPositionCards() {
  const html = state.positions.length === 0
    ? '<div class="empty-state">No open positions.<br>Place a trade above.</div>'
    : state.positions.map(pos => {
        const pnl     = calcPnL(pos);
        const pnlCol  = pnl >= 0 ? state.bullColor : state.bearColor;
        const pnlPct  = (pnl / pos.size * 100).toFixed(2);
        return `
          <div class="position-card">
            <div class="pos-header">
              <span class="pos-type ${pos.type}">${pos.type.toUpperCase()}</span>
              <button class="pos-close-btn" onclick="closePosition(${pos.id})">Close ×</button>
            </div>
            <div class="pos-row"><span>Entry</span><span>$${formatPrice(pos.entry)}</span></div>
            <div class="pos-row"><span>Current</span><span>$${formatPrice(state.currentPrice)}</span></div>
            <div class="pos-row"><span>Size</span><span>$${formatNum(pos.size)}</span></div>
            ${pos.sl ? `<div class="pos-row"><span>SL</span><span style="color:${state.bearColor}">$${formatPrice(pos.sl)}</span></div>` : ''}
            ${pos.tp ? `<div class="pos-row"><span>TP</span><span style="color:${state.bullColor}">$${formatPrice(pos.tp)}</span></div>` : ''}
            <div class="pos-pnl" style="color:${pnlCol}">
              ${pnl >= 0 ? '+' : ''}$${formatNum(Math.abs(pnl))}
              (${pnl >= 0 ? '+' : ''}${pnlPct}%)
            </div>
          </div>`;
      }).join('');

  const c1 = document.getElementById('open-positions');
  const c2 = document.getElementById('port-positions');
  if (c1) c1.innerHTML = html;
  if (c2) c2.innerHTML = html;
}

function renderTradeHistory() {
  const container = document.getElementById('trade-history');
  if (!container) return;
  if (state.history.length === 0) {
    container.innerHTML = '<div class="empty-state">No closed trades yet.<br>Close a position to see history.</div>';
    return;
  }
  container.innerHTML = state.history.slice(0, 60).map(t => {
    const win = t.pnl >= 0;
    return `
      <div class="history-row">
        <span class="hist-badge ${win ? 'win' : 'loss'}">${t.type.toUpperCase()}</span>
        <div>
          <div>$${formatPrice(t.entry)} → $${formatPrice(t.exit)}</div>
          <div style="font-size:.6rem;color:var(--text-dim)">${formatDuration(t.duration)} · $${formatNum(t.size)}</div>
        </div>
        <span class="hist-pnl" style="color:${win ? state.bullColor : state.bearColor}">
          ${win ? '+' : ''}$${formatNum(Math.abs(t.pnl))}
        </span>
      </div>`;
  }).join('');
}

function updateRisk() {
  const size = parseFloat(document.getElementById('size-input').value) || 0;
  const pct  = Math.min(100, (size / (state.balance || 1)) * 100);
  const fill = document.getElementById('risk-fill');
  const pctEl = document.getElementById('risk-pct');
  const hint  = document.getElementById('risk-hint');
  if (fill)  fill.style.width      = pct + '%';
  if (pctEl) pctEl.textContent     = pct.toFixed(1) + '%';
  if (hint)  hint.textContent      = pct.toFixed(1) + '% of balance';
  if (pct > 50 && CONFIG.LEARN_MODE) {
    showEduMsg('⚠️ Risk Warning: You are risking more than 50% of your balance on one trade. Pro traders risk 1-5% per trade to survive drawdowns.');
  }
}

// ================================================================
// CONTROLS
// ================================================================
function togglePause() {
  state.paused = !state.paused;
  document.getElementById('play-btn').textContent     = state.paused ? '▶' : '⏸';
  document.getElementById('live-dot').className       = 'live-dot' + (state.paused ? ' paused' : '');
  document.getElementById('market-status').textContent = state.paused ? 'PAUSED' : 'LIVE';
  showNotif(state.paused ? '⏸ Market Paused' : '▶ Market Resumed', '', '');
}

function switchTab(tab, btn) {
  document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  const sec = document.getElementById('tab-' + tab);
  if (sec) sec.classList.add('active');
}

function toggleIndicator(name, btn) {
  state.indicators[name] = !state.indicators[name];
  btn.classList.toggle('active', state.indicators[name]);
  document.getElementById('rsi-panel').classList.toggle('visible', state.indicators.rsi);
  document.getElementById('volume-panel').classList.toggle('visible', state.indicators.vol);
  resizeChart();
  renderChart();

  if (CONFIG.LEARN_MODE) {
    const tips = {
      sma: 'SMA smooths price over 20 candles. Price crossing above SMA = bullish signal; below = bearish.',
      ema: 'EMA (12) reacts faster to recent price changes than SMA — great for catching trend changes early.',
      rsi: 'RSI measures momentum. >70 = overbought (may drop), <30 = oversold (may bounce). Use at extremes.',
      vol: 'Volume confirms moves. Rising price + rising volume = strong trend. Breakout on low volume = caution.',
    };
    showEduMsg(tips[name]);
  }
}

function toggleLearnMode(el) {
  el.classList.toggle('on');
  CONFIG.LEARN_MODE = el.classList.contains('on');
  const lt = document.getElementById('learn-toggle');
  if (lt) lt.classList.toggle('on', CONFIG.LEARN_MODE);
}

function doReset() {
  state.balance     = CONFIG.STARTING_BALANCE;
  state.realizedPnL = 0;
  state.positions   = [];
  state.history     = [];
  state.wins        = 0;
  state.losses      = 0;
  state.tradeId     = 0;
  const seed = SEED_PRICES[state.coin] || 100;
  initCandleHistory(seed);
  updatePortfolioUI();
  renderChart();
  closeModal('reset-modal');
  showNotif('↺ Reset Complete', 'Balance restored to $10,000. Good luck!', 'success');
}

function saveJournal() {
  const input = document.getElementById('journal-input');
  const text  = (input.value || '').trim();
  if (!text) return;
  state.journal.unshift({ text, time: new Date().toLocaleString(), price: state.currentPrice });
  input.value = '';
  renderJournal();
}

function renderJournal() {
  const c = document.getElementById('journal-entries');
  if (!c) return;
  c.innerHTML = state.journal.slice(0, 20).map(e =>
    `<div class="journal-entry">
       <div class="je-time">${e.time} · $${formatPrice(e.price)}</div>
       ${e.text}
     </div>`
  ).join('') || '<div class="empty-state">No journal entries yet.</div>';
}

// Timeframe buttons
document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tf = parseInt(btn.dataset.tf);
    renderChart();
  });
});

// Speed buttons
document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.speed = parseInt(btn.dataset.spd);
    startMarket();
  });
});

// ================================================================
// NOTIFICATIONS & EDUCATION
// ================================================================
function showNotif(title, body, type) {
  if (!title) return;
  const container = document.getElementById('notifications');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'notif ' + (type || '');
  div.innerHTML = `<div class="notif-title">${title}</div>${body ? `<div>${body}</div>` : ''}`;
  container.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity 0.4s';
    div.style.opacity    = '0';
    setTimeout(() => div.remove(), 400);
  }, 3200);
}

let _eduTimer = null;
function showEduMsg(msg, duration = 7000) {
  if (!CONFIG.LEARN_MODE) return;
  const panel = document.getElementById('edu-panel');
  const msgEl = document.getElementById('edu-msg');
  if (!panel || !msgEl) return;
  msgEl.textContent = msg;
  panel.classList.add('visible');
  if (_eduTimer) clearTimeout(_eduTimer);
  _eduTimer = setTimeout(() => panel.classList.remove('visible'), duration);
}

function startEduTips() {
  const tips = [
    'Tip: Always use a Stop Loss to protect your capital from large losses.',
    'Tip: Never risk more than 2-5% of your balance on a single trade.',
    'Tip: High volume confirms the strength of a price move — low volume breakouts often fail.',
    'Tip: Trade with the trend — "the trend is your friend until it bends."',
    'Tip: RSI above 70 means overbought. Wait for a pullback before buying.',
    'Tip: RSI below 30 means oversold. Look for a bounce before shorting.',
    'Tip: Wait for full candle confirmation before entering a trade.',
    'Tip: Don\'t chase price — wait for the next setup to come to you.',
    'Tip: Emotional trading is the fastest way to blow your account.',
    'Tip: Keep a trading journal — reviewing past trades is how pros improve.',
  ];
  let idx = 0;
  setInterval(() => {
    if (!state.paused && CONFIG.LEARN_MODE && state.positions.length === 0) {
      showEduMsg(tips[idx % tips.length]);
      idx++;
    }
  }, 35_000);
}

// ================================================================
// ACHIEVEMENTS
// ================================================================
const achievements = {
  tutorial : { name: 'Scholar',          icon: '🎓', desc: 'Completed the full tutorial',    unlocked: false },
  win      : { name: 'First Profit',     icon: '💰', desc: 'Closed your first winning trade', unlocked: false },
  fivewins : { name: 'Hot Streak',       icon: '🔥', desc: 'Won 5 trades',                   unlocked: false },
  tenk     : { name: 'Growing Account',  icon: '💎', desc: 'Balance exceeded $15,000',        unlocked: false },
  losers   : { name: 'Hard Lesson',      icon: '📉', desc: 'Took 3 losses — learn and adapt', unlocked: false },
};

function checkAchievements(event) {
  if (event === 'tutorial' && !achievements.tutorial.unlocked) {
    achievements.tutorial.unlocked = true;
    showAchievement(achievements.tutorial);
  }
  if (event === 'win') {
    if (!achievements.win.unlocked) { achievements.win.unlocked = true; showAchievement(achievements.win); }
    if (state.wins >= 5 && !achievements.fivewins.unlocked) { achievements.fivewins.unlocked = true; showAchievement(achievements.fivewins); }
  }
  if (state.losses >= 3 && !achievements.losers.unlocked) { achievements.losers.unlocked = true; showAchievement(achievements.losers); }
  if (state.balance >= 15_000 && !achievements.tenk.unlocked) { achievements.tenk.unlocked = true; showAchievement(achievements.tenk); }
}

function showAchievement(ach) {
  const el = document.createElement('div');
  el.className = 'achievement-toast';
  el.innerHTML = `<div class="achievement-icon">${ach.icon}</div>
    <div class="achievement-text"><strong>Achievement: ${ach.name}</strong>${ach.desc}</div>`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.5s'; el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  }, 4500);
}

// ================================================================
// GLOSSARY
// ================================================================
const GLOSSARY = [
  { term: 'Candlestick',     def: 'A chart showing Open, High, Low, Close for a time period. Green = price up, Red = price down.' },
  { term: 'Bullish',        def: 'Expectation that price will rise. Bull candles close higher than they opened.' },
  { term: 'Bearish',        def: 'Expectation that price will fall. Bear candles close lower than they opened.' },
  { term: 'Long Position',  def: 'Buy expecting price to rise. Profit when you close higher than your entry.' },
  { term: 'Short Position', def: 'Sell expecting price to fall. Profit when you close lower than your entry.' },
  { term: 'Stop Loss (SL)', def: 'Auto-closes trade at a set price to limit losses. Non-negotiable risk tool.' },
  { term: 'Take Profit (TP)',def: 'Auto-closes trade at your profit target.' },
  { term: 'PnL',            def: 'Profit and Loss. Unrealized = open position. Realized = closed position.' },
  { term: 'Support',        def: 'Price level where buying interest prevents further decline.' },
  { term: 'Resistance',     def: 'Price level where selling pressure prevents further rise.' },
  { term: 'Trend',          def: 'General direction: uptrend (higher highs), downtrend (lower lows), sideways.' },
  { term: 'Volume',         def: 'Amount traded in a period. Confirms or questions the strength of a move.' },
  { term: 'RSI',            def: 'Relative Strength Index 0-100. >70 overbought, <30 oversold.' },
  { term: 'SMA',            def: 'Simple Moving Average — average close price over N periods.' },
  { term: 'EMA',            def: 'Exponential Moving Average — weighted toward recent prices.' },
  { term: 'Paper Trading',  def: 'Practice with virtual money. No real risk — ideal for learning.' },
  { term: 'Liquidation',    def: 'Forced close of a losing position when losses consume the margin.' },
  { term: 'Equity',         def: 'Total account value = cash + open position values.' },
  { term: 'Timeframe',      def: 'Duration each candle represents: 1m, 5m, 1h, etc.' },
  { term: 'Breakout',       def: 'Price moves beyond support/resistance — often signals a new trend.' },
  { term: 'CoinGecko',      def: 'Free public crypto price API used by this app for live market data.' },
];

function buildGlossary() {
  const el = document.getElementById('glossary-list');
  if (!el) return;
  el.innerHTML = GLOSSARY.map(g =>
    `<div class="glossary-item">
       <div class="glossary-term">${g.term}</div>
       <div class="glossary-def">${g.def}</div>
     </div>`
  ).join('');
}

// ================================================================
// NEWS TICKER
// ================================================================
const NEWS_ITEMS = [
  'BTC tests key resistance at $65K — traders eye breakout   •   ',
  'CoinGecko data: ETH/BTC ratio holds steady amid macro uncertainty   •   ',
  'Fed meeting minutes signal "higher for longer" — crypto reacts   •   ',
  'Whale alert: 4,200 BTC moved to Coinbase — watch for sell pressure   •   ',
  'RSI on daily BTC chart approaching overbought — analysts cautious   •   ',
  'SOL rises 8% on strong developer activity data   •   ',
  'Market update: Total crypto market cap crosses $2.4T   •   ',
  'Options data shows $68K BTC call wall — gamma squeeze possible   •   ',
  'Fear & Greed Index: 71 — market in "Greed" territory   •   ',
  'On-chain: Long-term holders accumulating — supply shock building?   •   ',
  'LINK rallies 12% after oracle partnership announcement   •   ',
  'Liquidation cascade: $180M wiped in 4 hours as BTC dropped to $62K   •   ',
];

function startNewsTicker() {
  const el = document.getElementById('news-ticker-content');
  if (!el) return;
  const text = [...NEWS_ITEMS, ...NEWS_ITEMS].join('');
  el.textContent = text;
}

// ================================================================
// TUTORIAL SYSTEM
// ================================================================
const TUTORIAL_STEPS = [
  {
    title: '👋 Welcome to APEX TRADER!',
    body: `This simulator lets you practice trading with <span class="highlight">real crypto prices</span> via CoinGecko — completely risk-free using virtual money. Let's learn step by step!`,
    target: null,
  },
  {
    title: '📈 What is Trading?',
    body: `Trading is buying and selling assets to make a profit. You <span class="green">buy (Long)</span> if you think the price will rise, or <span class="red">sell (Short)</span> if you think it will fall.`,
    target: null,
  },
  {
    title: '🌐 Live Market Data',
    body: `APEX TRADER connects to <span class="highlight">CoinGecko's free API</span> for real cryptocurrency prices. Switch coins using the dropdown in the top bar. Enable live mode in Settings.`,
    target: 'coin-select',
  },
  {
    title: '🕯️ What is a Candlestick?',
    body: `Each bar on the chart is a <span class="highlight">candlestick</span>. The body shows the Open and Close price; the wicks show the High and Low for that time period.`,
    target: 'chart-canvas',
    demo: 'candle',
  },
  {
    title: '🟢 Bullish Candles',
    body: `A <span class="green">GREEN candle</span> (bullish) means the price <span class="green">closed higher</span> than it opened. Buyers were in control during this period.`,
    target: 'chart-canvas',
  },
  {
    title: '🔴 Bearish Candles',
    body: `A <span class="red">RED candle</span> (bearish) means the price <span class="red">closed lower</span> than it opened. Sellers dominated. (Colors are customizable in Settings!)`,
    target: 'chart-canvas',
  },
  {
    title: '📊 OHLC — Candle Data',
    body: `Every candle has 4 values: <span class="highlight">O</span>pen, <span class="highlight">H</span>igh, <span class="highlight">L</span>ow, <span class="highlight">C</span>lose. Hover over the chart to see live OHLC values update!`,
    target: 'ohlc-display',
  },
  {
    title: '⏱ Timeframes',
    body: `Change the candle time interval using the timeframe buttons: <span class="highlight">1m, 5m, 15m, 1h</span>. Shorter timeframes = more detail + more noise. Longer = smoother trends.`,
    target: 'topnav',
  },
  {
    title: '📊 Technical Indicators',
    body: `Enable <span class="highlight">SMA, EMA, RSI, VOL</span> using the indicator buttons. Each adds a layer of analysis. They're overlaid directly on the chart.`,
    target: 'chart-header',
  },
  {
    title: '📈 SMA & EMA Lines',
    body: `The SMA (yellow line) averages the last 20 candle closes. The EMA (pink) weights recent candles more. <span class="green">Price above line = bullish</span>, <span class="red">below = bearish</span>.`,
    target: null,
  },
  {
    title: '🔄 RSI — Momentum',
    body: `RSI measures buying/selling momentum (0-100). <span class="red">Above 70 = overbought</span> (watch for reversal down). <span class="green">Below 30 = oversold</span> (watch for bounce up).`,
    target: null,
  },
  {
    title: '💰 Your Balance',
    body: `You start with <span class="highlight">$10,000 virtual dollars</span>. Your balance, equity and PnL are displayed in the Trade panel on the right. No real money involved!`,
    target: 'balance-display',
  },
  {
    title: '📤 Buy Long',
    body: `Click <span class="green">BUY LONG</span> when you think the price will go UP. Set your position size first. You profit when you close at a higher price than your entry.`,
    target: 'buy-btn',
  },
  {
    title: '📥 Sell Short',
    body: `Click <span class="red">SELL SHORT</span> when you think price will go DOWN. You profit when price falls after your entry. Close the position to lock in gains.`,
    target: 'sell-btn',
  },
  {
    title: '🛑 Stop Loss',
    body: `A <span class="red">Stop Loss</span> auto-closes your trade to limit loss. For a long, set it below entry. For a short, set it above. <span class="highlight">Always use one!</span>`,
    target: 'sl-input',
  },
  {
    title: '🎯 Take Profit',
    body: `A <span class="green">Take Profit</span> auto-closes at your target profit price. Set it above entry for longs, below for shorts. Removes emotional decision-making.`,
    target: 'tp-input',
  },
  {
    title: '⚖️ Risk Management',
    body: `The <span class="highlight">risk bar</span> shows what % of your balance you're risking. Keep it under 5% per trade. The bar turns red when you're over-risking.`,
    target: 'trade-form',
  },
  {
    title: '▶ Speed & Pause',
    body: `Use <span class="highlight">speed controls</span> (1×–10×) to fast-forward the simulation. Hit <span class="highlight">⏸</span> to pause and study the chart without the market moving.`,
    target: 'topnav',
  },
  {
    title: '🎨 Customization',
    body: `Open <span class="highlight">⚙ Settings</span> to change the accent theme color, customize candle colors (presets or custom picker), and switch between Live and Simulated data.`,
    target: null,
  },
  {
    title: '🎓 You\'re Ready!',
    body: `You now know the essentials. <span class="highlight">Switch to Live mode</span> in Settings to trade with real prices. Remember: always use a stop loss, manage your risk, and learn from every trade. Good luck! 🚀`,
    target: null,
  },
];

let tutStep   = 0;
let tutActive = false;

function startTutorial() {
  fadeLanding(() => {
    initApp();
    setTimeout(() => {
      tutStep  = 0;
      tutActive = true;
      document.getElementById('tutorial-overlay').style.display = 'block';
      renderTutStep();
    }, 600);
  });
}

function skipToTrading() {
  fadeLanding(() => {
    initApp();
    const r = document.getElementById('tut-resume-small');
    if (r) r.style.display = 'block';
  });
}

function fadeLanding(cb) {
  const landing = document.getElementById('landing');
  landing.style.opacity    = '0';
  landing.style.transition = 'opacity 0.5s';
  setTimeout(() => {
    landing.style.display = 'none';
    document.getElementById('app').classList.add('visible');
    cb();
  }, 500);
}

function resumeTutorial() {
  if (!document.getElementById('app').classList.contains('visible')) return;
  tutActive = true;
  document.getElementById('tutorial-overlay').style.display = 'block';
  const r = document.getElementById('tut-resume-small');
  if (r) r.style.display = 'none';
  renderTutStep();
}

function endTutorial() {
  tutActive = false;
  document.getElementById('tutorial-overlay').style.display = 'none';
  clearSpotlight();
  const r = document.getElementById('tut-resume-small');
  if (r) r.style.display = 'block';
}

function tutNext() {
  if (tutStep < TUTORIAL_STEPS.length - 1) {
    tutStep++;
    renderTutStep();
  } else {
    endTutorial();
    showNotif('🎓 Tutorial Complete!', 'Start trading — your $10,000 awaits!', 'success');
    checkAchievements('tutorial');
  }
}

function tutPrev() {
  if (tutStep > 0) { tutStep--; renderTutStep(); }
}

function renderTutStep() {
  const step = TUTORIAL_STEPS[tutStep];
  setText('tut-badge',  `STEP ${tutStep + 1} / ${TUTORIAL_STEPS.length}`);
  setText('tut-title',  step.title);
  document.getElementById('tut-body').innerHTML = step.body;
  document.getElementById('tut-progress').style.width =
    ((tutStep + 1) / TUTORIAL_STEPS.length * 100) + '%';
  document.getElementById('tut-next-btn').textContent =
    tutStep === TUTORIAL_STEPS.length - 1 ? 'Finish 🎉' : 'Next →';
  document.getElementById('tut-prev').style.display = tutStep === 0 ? 'none' : '';

  if (step.demo === 'candle') {
    document.getElementById('tut-body').innerHTML += `
      <div class="tut-candle-demo">
        <div class="demo-candle bull">
          <div class="demo-wick" style="height:18px"></div>
          <div class="demo-body" style="height:38px;background:currentColor"></div>
          <div class="demo-wick" style="height:10px"></div>
          <span>BULL</span>
        </div>
        <div class="demo-candle bear">
          <div class="demo-wick" style="height:12px"></div>
          <div class="demo-body" style="height:34px;background:currentColor"></div>
          <div class="demo-wick" style="height:16px"></div>
          <span>BEAR</span>
        </div>
      </div>`;
  }

  positionTutCard(step.target);
}

function positionTutCard(targetId) {
  const card      = document.getElementById('tut-card');
  const spotlight = document.getElementById('tut-spotlight');

  if (!targetId) {
    clearSpotlight();
    card.style.top       = '50%';
    card.style.left      = '50%';
    card.style.transform = 'translate(-50%, -50%)';
    return;
  }

  const el = document.getElementById(targetId);
  if (!el) { positionTutCard(null); return; }

  const rect = el.getBoundingClientRect();
  const pad  = 8;
  spotlight.style.display = 'block';
  spotlight.style.top     = (rect.top  - pad) + 'px';
  spotlight.style.left    = (rect.left - pad) + 'px';
  spotlight.style.width   = (rect.width  + pad * 2) + 'px';
  spotlight.style.height  = (rect.height + pad * 2) + 'px';

  const cw = 340, ch = 320;
  let cx = rect.right + 20;
  let cy = rect.top;
  if (cx + cw > window.innerWidth)  cx = rect.left - cw - 20;
  if (cy + ch > window.innerHeight) cy = window.innerHeight - ch - 20;
  if (cy < 0)  cy = 16;
  if (cx < 0)  cx = 16;

  card.style.top       = cy + 'px';
  card.style.left      = cx + 'px';
  card.style.transform = 'none';
}

function clearSpotlight() {
  const s = document.getElementById('tut-spotlight');
  if (s) s.style.display = 'none';
}

// ================================================================
// LANDING CANVAS ANIMATION
// ================================================================
function animateLanding() {
  const canvas = document.getElementById('landing-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = Array.from({ length: 65 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.4 + 0.3,
    dx: (Math.random() - 0.5) * 0.28,
    dy: (Math.random() - 0.5) * 0.28,
    a: Math.random() * 0.45 + 0.08,
  }));

  const bgCandles = Array.from({ length: 22 }, (_, i) => ({
    x: i * (window.innerWidth / 22) + Math.random() * 20,
    y: canvas.height * 0.3 + Math.random() * canvas.height * 0.4,
    h: 22 + Math.random() * 80,
    bull: Math.random() > 0.5,
    w: 8 + Math.random() * 14,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = 'rgba(30,48,80,0.28)'; ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Ghost candles
    bgCandles.forEach(c => {
      ctx.fillStyle   = c.bull ? 'rgba(0,230,122,0.06)' : 'rgba(255,51,85,0.06)';
      ctx.fillRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h);
      ctx.strokeStyle = c.bull ? 'rgba(0,230,122,0.1)' : 'rgba(255,51,85,0.1)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(c.x, c.y - c.h / 2 - 14); ctx.lineTo(c.x, c.y + c.h / 2 + 9); ctx.stroke();
      c.y += (Math.random() - 0.5) * 0.15;
    });

    // Particles
    particles.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,200,255,${p.a})`; ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
    });

    if (document.getElementById('landing') &&
        document.getElementById('landing').style.display !== 'none') {
      requestAnimationFrame(draw);
    }
  }
  draw();
}

// ================================================================
// INIT
// ================================================================
function initApp() {
  // Read learn mode from toggle
  const lt = document.getElementById('learn-toggle');
  CONFIG.LEARN_MODE = lt ? lt.classList.contains('on') : true;

  const seed = SEED_PRICES[state.coin] || 100;
  initCandleHistory(seed);
  initChart();
  buildGlossary();
  startNewsTicker();
  startMarket();
  startEduTips();
  updatePortfolioUI();
  renderChart();
  updateRisk();

  // Continuous render loop
  setInterval(() => { if (!state.paused) renderChart(); }, 120);
}

// ================================================================
// HELPER UTILITIES
// ================================================================
function formatPrice(p) {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function formatNum(n) {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDuration(s) {
  if (s < 60)   return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setVal(id, val, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  if (cls !== undefined) el.className = 'stat-value ' + cls;
}

// hexToRgba is defined earlier in the theme section but re-exported here
// for use in chart renderer without dependency order issues.
// (Already defined above — no duplicate needed.)

// ================================================================
// BOOT
// ================================================================
window.addEventListener('load', () => {
  animateLanding();
});
