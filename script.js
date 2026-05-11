// ============================================================
// CONFIG & STATE
// ============================================================
const CONFIG = {
  STARTING_BALANCE: 10000,
  CANDLES_VISIBLE: 80,
  LEARN_MODE: true,
};

let state = {
  balance: CONFIG.STARTING_BALANCE,
  realizedPnL: 0,
  positions: [],
  history: [],
  journal: [],
  candleData:[],
  currentCandle: null,
  currentPrice: 0,
  prevPrice: 0,
  tf: 5, // Default 5 minutes
  indicators: { sma: false, ema: false, rsi: false, vol: false },
  candleCount: 0,
  wins: 0,
  losses: 0,
  tradeId: 0,
  openPrice24h: 0,
  theme: 'dark',
  colors: {
    bull: '#00e67a',
    bear: '#ff3355'
  }
};

// ============================================================
// COINGECKO API INTEGRATION (REAL-TIME DATA)
// ============================================================
let pollInterval = null;

async function fetchInitialData() {
  document.getElementById('loading-overlay').style.display = 'flex';
  
  // Map our TF to CoinGecko days parameter for market_chart
  // days=1 gives 5m intervals. days=7 gives 1h intervals. days=14 gives 1h.
  let days = 1; 
  if (state.tf >= 60) days = 7;
  if (state.tf >= 240) days = 14;

  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`);
    const data = await res.json();
    
    if (data.prices && data.prices.length > 0) {
      buildCandles(data.prices, data.total_volumes);
      state.openPrice24h = data.prices[0][1];
    }
  } catch(e) {
    console.error("CoinGecko API Error:", e);
    showNotif('API Error', 'Failed to fetch historical data from CoinGecko. Rate limit may be exceeded.', 'danger');
  }
  
  document.getElementById('loading-overlay').style.display = 'none';
  renderChart();
  updateUI();
}

function buildCandles(prices, volumes) {
  state.candleData =[];
  const intervalMs = state.tf * 60 * 1000;
  let currentCandle = null;

  for (let i = 0; i < prices.length; i++) {
    const[t, p] = prices[i];
    const v = volumes[i] ? volumes[i][1] : 0;
    const candleTime = Math.floor(t / intervalMs) * intervalMs;

    if (!currentCandle || currentCandle.t !== candleTime) {
      if (currentCandle) state.candleData.push(currentCandle);
      currentCandle = { t: candleTime, o: p, h: p, l: p, c: p, v: v };
    } else {
      currentCandle.h = Math.max(currentCandle.h, p);
      currentCandle.l = Math.min(currentCandle.l, p);
      currentCandle.c = p;
      currentCandle.v += v;
    }
  }
  if (currentCandle) state.candleData.push(currentCandle);

  // Keep last 500 candles
  if (state.candleData.length > 500) {
    state.candleData = state.candleData.slice(-500);
  }

  if (state.candleData.length > 0) {
    state.currentPrice = state.candleData[state.candleData.length - 1].c;
    state.prevPrice = state.candleData.length > 1 ? state.candleData[state.candleData.length - 2].c : state.currentPrice;
  }
}

function startLiveUpdates() {
  if (pollInterval) clearInterval(pollInterval);
  
  // Poll CoinGecko /simple/price every 12 seconds to avoid rate limits
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`);
      const data = await res.json();
      
      if (data && data.bitcoin) {
        const p = data.bitcoin.usd;
        state.prevPrice = state.currentPrice;
        state.currentPrice = p;

        updateLiveCandle(p);
        updateUI();
        checkPositions();
        renderChart();
      }
    } catch(e) {
      console.log("Polling failed (Rate limit likely reached).", e);
    }
  }, 12000); 
}

function updateLiveCandle(price) {
  const now = Date.now();
  const intervalMs = state.tf * 60 * 1000;
  const currentCandleTime = Math.floor(now / intervalMs) * intervalMs;

  if (!state.currentCandle || state.currentCandle.t !== currentCandleTime) {
    if (state.currentCandle) {
      state.candleData.push(state.currentCandle);
      state.candleCount++;
      if (state.candleData.length > 500) state.candleData.shift();
    }
    state.currentCandle = { t: currentCandleTime, o: price, h: price, l: price, c: price, v: 0 };
  } else {
    state.currentCandle.c = price;
    state.currentCandle.h = Math.max(state.currentCandle.h, price);
    state.currentCandle.l = Math.min(state.currentCandle.l, price);
  }
}

// ============================================================
// SETTINGS (THEME & COLORS)
// ============================================================
function openSettings() { document.getElementById('settings-modal').classList.add('open'); }

function changeTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  renderChart();
}

function changeColors() {
  const bull = document.getElementById('bull-color').value;
  const bear = document.getElementById('bear-color').value;
  state.colors.bull = bull;
  state.colors.bear = bear;
  
  // Update CSS variables for UI elements
  document.documentElement.style.setProperty('--green', bull);
  document.documentElement.style.setProperty('--red', bear);
  
  // Create 15% opacity versions for glows/backgrounds
  const hexToRgba = (hex, alpha) => {
    let r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };
  
  document.documentElement.style.setProperty('--green-glow', hexToRgba(bull, 0.15));
  document.documentElement.style.setProperty('--red-glow', hexToRgba(bear, 0.15));
  
  renderChart();
}

// ============================================================
// CHART RENDERER
// ============================================================
let chartCanvas, chartCtx;
let chartW = 0, chartH = 0;
let mouseX = -1, mouseY = -1;

function initChart() {
  chartCanvas = document.getElementById('chart-canvas');
  chartCtx = chartCanvas.getContext('2d');
  resizeChart();
  chartCanvas.addEventListener('mousemove', onChartMouseMove);
  chartCanvas.addEventListener('mouseleave', onChartMouseLeave);
  window.addEventListener('resize', resizeChart);
}

function resizeChart() {
  const wrap = document.getElementById('chart-wrap');
  chartW = wrap.clientWidth;
  chartH = wrap.clientHeight;
  chartCanvas.width = chartW;
  chartCanvas.height = chartH;
  renderChart();

  const rsiPanel = document.getElementById('rsi-panel');
  const rsiCanvas = document.getElementById('rsi-canvas');
  rsiCanvas.width = rsiPanel.clientWidth;
  rsiCanvas.height = rsiPanel.clientHeight;

  const volPanel = document.getElementById('volume-panel');
  const volCanvas = document.getElementById('vol-canvas');
  volCanvas.width = volPanel.clientWidth;
  volCanvas.height = volPanel.clientHeight;
}

function renderChart() {
  if (!chartCtx) return;
  const ctx = chartCtx;
  const W = chartW, H = chartH;
  const PRICE_AXIS_W = 72;
  const TIME_AXIS_H = 28;
  const plotW = W - PRICE_AXIS_W;
  const plotH = H - TIME_AXIS_H;

  ctx.clearRect(0, 0, W, H);

  // Background based on theme
  ctx.fillStyle = state.theme === 'light' ? '#f8fafc' : '#0a0f1a';
  ctx.fillRect(0, 0, W, H);

  let candles = [...state.candleData];
  if (state.currentCandle) candles.push(state.currentCandle);

  const visible = Math.min(candles.length, CONFIG.CANDLES_VISIBLE);
  const displayCandles = candles.slice(-visible);
  if (displayCandles.length === 0) return;

  let minP = Infinity, maxP = -Infinity;
  for (const c of displayCandles) {
    minP = Math.min(minP, c.l);
    maxP = Math.max(maxP, c.h);
  }
  const pad = (maxP - minP) * 0.1;
  minP -= pad; maxP += pad;
  const priceRange = maxP - minP || 1;

  const toY = (p) => plotH - ((p - minP) / priceRange) * plotH;
  const candleW = (plotW / displayCandles.length) * 0.8;
  const spacing = plotW / displayCandles.length;

  const gridColor = state.theme === 'light' ? '#e2e8f0' : '#1a2535';
  const textColor = state.theme === 'light' ? '#64748b' : '#3d5a7a';

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  const gridLines = 6;
  for (let i = 0; i <= gridLines; i++) {
    const y = (plotH / gridLines) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
  }

  const vLines = Math.min(displayCandles.length, 8);
  for (let i = 0; i <= vLines; i++) {
    const x = (plotW / vLines) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke();
  }

  ctx.fillStyle = textColor;
  ctx.font = '11px IBM Plex Mono, monospace';
  ctx.textAlign = 'left';
  for (let i = 0; i <= gridLines; i++) {
    const price = maxP - (priceRange / gridLines) * i;
    const y = (plotH / gridLines) * i;
    ctx.fillText('$' + formatPrice(price), plotW + 4, y + 4);
  }

  // Draw candles
  for (let i = 0; i < displayCandles.length; i++) {
    const c = displayCandles[i];
    const x = i * spacing + spacing / 2;
    const bull = c.c >= c.o;
    const color = bull ? state.colors.bull : state.colors.bear;
    const bodyTop = toY(Math.max(c.o, c.c));
    const bodyBot = toY(Math.min(c.o, c.c));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, toY(c.h));
    ctx.lineTo(x, toY(c.l));
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  }

  // Open position lines
  for (const pos of state.positions) {
    const isLong = pos.type === 'long';
    const lineColor = isLong ? state.colors.bull : state.colors.bear;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const y = toY(pos.entry);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = lineColor;
    ctx.font = 'bold 10px IBM Plex Mono';
    ctx.textAlign = 'left';
    ctx.fillText(`${isLong ? 'LONG' : 'SHORT'} @$${formatPrice(pos.entry)}`, 4, y - 3);
  }

  // Current price line
  const cpY = toY(state.currentPrice);
  ctx.strokeStyle = 'rgba(0,200,255,0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath(); ctx.moveTo(0, cpY); ctx.lineTo(plotW, cpY); ctx.stroke();
  ctx.setLineDash([]);
  
  ctx.fillStyle = '#00c8ff';
  ctx.fillRect(plotW, cpY - 9, PRICE_AXIS_W, 18);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 10px Share Tech Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('$' + formatPrice(state.currentPrice), plotW + PRICE_AXIS_W / 2, cpY + 4);

  // Time axis
  ctx.fillStyle = textColor;
  ctx.font = '10px IBM Plex Mono';
  ctx.textAlign = 'center';
  const timeStep = Math.ceil(displayCandles.length / 6);
  for (let i = 0; i < displayCandles.length; i += timeStep) {
    const c = displayCandles[i];
    const x = i * spacing + spacing / 2;
    const d = new Date(c.t);
    const label = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    ctx.fillText(label, x, plotH + 18);
  }

  // Crosshair
  if (mouseX >= 0 && mouseX <= plotW && mouseY >= 0 && mouseY <= plotH) {
    ctx.strokeStyle = 'rgba(100,140,200,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mouseX, 0); ctx.lineTo(mouseX, plotH);
    ctx.moveTo(0, mouseY); ctx.lineTo(plotW, mouseY);
    ctx.stroke();

    const hoverPrice = maxP - (mouseY / plotH) * priceRange;
    const el = document.getElementById('crosshair-price');
    el.style.display = 'block';
    el.style.top = (mouseY - 9) + 'px';
    el.textContent = '$' + formatPrice(hoverPrice);

    const ci = Math.floor(mouseX / spacing);
    if (ci >= 0 && ci < displayCandles.length) {
      const hc = displayCandles[ci];
      document.getElementById('ohlc-o').textContent = '$' + formatPrice(hc.o);
      document.getElementById('ohlc-h').textContent = '$' + formatPrice(hc.h);
      document.getElementById('ohlc-l').textContent = '$' + formatPrice(hc.l);
      document.getElementById('ohlc-c').textContent = '$' + formatPrice(hc.c);
    }
  } else {
    document.getElementById('crosshair-price').style.display = 'none';
    const lc = state.currentCandle || state.candleData[state.candleData.length - 1];
    if (lc) {
      document.getElementById('ohlc-o').textContent = '$' + formatPrice(lc.o);
      document.getElementById('ohlc-h').textContent = '$' + formatPrice(lc.h);
      document.getElementById('ohlc-l').textContent = '$' + formatPrice(lc.l);
      document.getElementById('ohlc-c').textContent = '$' + formatPrice(lc.c);
    }
  }
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

// ============================================================
// TRADING ENGINE
// ============================================================
function executeTrade(type) {
  const sizeEl = document.getElementById('size-input');
  const slEl = document.getElementById('sl-input');
  const tpEl = document.getElementById('tp-input');
  const size = parseFloat(sizeEl.value) || 0;

  if (size <= 0) { showNotif('Invalid size', 'Enter a positive trade size.', 'danger'); return; }
  if (size > state.balance) { showNotif('Insufficient Balance', `You need $${formatNum(size)} but have $${formatNum(state.balance)}.`, 'danger'); return; }

  const sl = slEl.value ? parseFloat(slEl.value) : null;
  const tp = tpEl.value ? parseFloat(tpEl.value) : null;

  if (sl && type === 'long' && sl >= state.currentPrice) { showNotif('Invalid Stop Loss', 'For a long, SL must be below entry price.', 'warn'); return; }
  if (sl && type === 'short' && sl <= state.currentPrice) { showNotif('Invalid Stop Loss', 'For a short, SL must be above entry price.', 'warn'); return; }

  const pos = {
    id: ++state.tradeId,
    type,
    entry: state.currentPrice,
    size,
    sl: sl || null,
    tp: tp || null,
    openTime: Date.now(),
    pnl: 0,
  };

  state.balance -= size;
  state.positions.push(pos);

  showNotif(
    type === 'long' ? '📈 Long Opened' : '📉 Short Opened',
    `${type.toUpperCase()} $${formatNum(size)} @ $${formatPrice(state.currentPrice)}`,
    'success'
  );

  updatePortfolioUI();
  renderChart();
}

function closePosition(id) {
  const idx = state.positions.findIndex(p => p.id === id);
  if (idx === -1) return;
  closePositionByIdx(idx);
}

function calcPnL(pos) {
  const price = state.currentPrice;
  const diff = pos.type === 'long' ? (price - pos.entry) / pos.entry : (pos.entry - price) / pos.entry;
  return pos.size * diff;
}

function checkPositions() {
  for (let i = state.positions.length - 1; i >= 0; i--) {
    const pos = state.positions[i];
    pos.pnl = calcPnL(pos);

    if (pos.type === 'long') {
      if (pos.sl && state.currentPrice <= pos.sl) { showNotif('🛑 Stop Loss Hit', `Long closed at $${formatPrice(state.currentPrice)}`, 'warn'); closePositionByIdx(i); continue; }
      if (pos.tp && state.currentPrice >= pos.tp) { showNotif('🎯 Take Profit Hit', `Long closed at $${formatPrice(state.currentPrice)}`, 'success'); closePositionByIdx(i); continue; }
    } else {
      if (pos.sl && state.currentPrice >= pos.sl) { showNotif('🛑 Stop Loss Hit', `Short closed at $${formatPrice(state.currentPrice)}`, 'warn'); closePositionByIdx(i); continue; }
      if (pos.tp && state.currentPrice <= pos.tp) { showNotif('🎯 Take Profit Hit', `Short closed at $${formatPrice(state.currentPrice)}`, 'success'); closePositionByIdx(i); continue; }
    }

    if (pos.pnl < -pos.size * 0.95) {
      showNotif('💀 Liquidated', `Position liquidated. Total loss: $${formatNum(pos.size)}.`, 'danger');
      closePositionByIdx(i);
    }
  }
}

function closePositionByIdx(i) {
  const pos = state.positions[i];
  const pnl = calcPnL(pos);
  const total = Math.max(0, pos.size + pnl);
  state.balance += total;
  state.realizedPnL += pnl;
  if (pnl >= 0) state.wins++; else state.losses++;
  
  state.history.unshift({
    id: pos.id, type: pos.type,
    entry: pos.entry, exit: state.currentPrice,
    size: pos.size, pnl,
    duration: Math.floor((Date.now() - pos.openTime) / 1000),
  });
  state.positions.splice(i, 1);
  updatePortfolioUI();
  renderChart();
}

// ============================================================
// UI UPDATES
// ============================================================
function updateUI() {
  const price = state.currentPrice;
  const el = document.getElementById('nav-price');
  if (el) {
    el.textContent = '$' + formatPrice(price);
    el.style.color = price > state.prevPrice ? 'var(--green)' : price < state.prevPrice ? 'var(--red)' : 'var(--text-primary)';
  }

  const pct = state.openPrice24h ? ((price - state.openPrice24h) / state.openPrice24h * 100) : 0;
  const ch = document.getElementById('nav-change');
  if (ch) {
    ch.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    ch.className = 'nav-change ' + (pct >= 0 ? 'up' : 'dn');
  }

  updatePortfolioUI();
}

function updatePortfolioUI() {
  const unrealPnL = state.positions.reduce((sum, p) => sum + calcPnL(p), 0);
  const equity = state.balance + state.positions.reduce((s, p) => s + p.size, 0) + unrealPnL;

  const setEl = (id, val, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (cls !== undefined) el.className = 'stat-value ' + cls;
  };

  const moneyStr = (v) => (v >= 0 ? '+' : '') + '$' + formatNum(Math.abs(v));

  setEl('balance-display', '$' + formatNum(state.balance), 'accent');
  setEl('equity-display', '$' + formatNum(equity), equity >= CONFIG.STARTING_BALANCE ? '' : 'red');
  setEl('unreal-pnl', moneyStr(unrealPnL), unrealPnL >= 0 ? 'green' : 'red');
  setEl('real-pnl', moneyStr(state.realizedPnL), state.realizedPnL >= 0 ? 'green' : 'red');

  setEl('port-balance', '$' + formatNum(state.balance), 'accent');
  const totalPnL = state.realizedPnL + unrealPnL;
  setEl('port-total-pnl', moneyStr(totalPnL), totalPnL >= 0 ? 'green' : 'red');

  const totalTrades = state.wins + state.losses;
  setEl('port-winrate', totalTrades > 0 ? (state.wins / totalTrades * 100).toFixed(1) + '%' : '—');
  setEl('port-trades', totalTrades.toString());

  renderPositionCards();
  renderTradeHistory();
}

function renderPositionCards() {
  const container = document.getElementById('open-positions');
  if (state.positions.length === 0) {
    container.innerHTML = '<div class="empty-state">No open positions.<br>Place a trade above.</div>';
    return;
  }
  let html = '';
  for (const pos of state.positions) {
    const pnl = calcPnL(pos);
    const pnlColor = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    const pnlPct = (pnl / pos.size * 100).toFixed(2);
    html += `
      <div class="position-card">
        <div class="pos-header">
          <span class="pos-type ${pos.type === 'long' ? 'long' : 'short'}">${pos.type.toUpperCase()}</span>
          <button class="pos-close-btn" onclick="closePosition(${pos.id})">Close ×</button>
        </div>
        <div class="pos-row"><span>Entry</span><span>$${formatPrice(pos.entry)}</span></div>
        <div class="pos-row"><span>Current</span><span>$${formatPrice(state.currentPrice)}</span></div>
        <div class="pos-row"><span>Size</span><span>$${formatNum(pos.size)}</span></div>
        <div class="pos-pnl" style="color:${pnlColor}">${pnl >= 0 ? '+' : ''}$${formatNum(Math.abs(pnl))} (${pnl >= 0 ? '+' : ''}${pnlPct}%)</div>
      </div>`;
  }
  container.innerHTML = html;
}

function renderTradeHistory() {
  const container = document.getElementById('trade-history');
  if (state.history.length === 0) {
    container.innerHTML = '<div class="empty-state">No closed trades yet.</div>';
    return;
  }
  let html = '';
  for (const t of state.history.slice(0, 50)) {
    const win = t.pnl >= 0;
    html += `
      <div class="history-row">
        <span class="hist-badge ${win ? 'win' : 'loss'}">${t.type.toUpperCase()}</span>
        <div>
          <div>$${formatPrice(t.entry)} → $${formatPrice(t.exit)}</div>
          <div style="font-size:0.6rem;color:var(--text-dim)">$${formatNum(t.size)}</div>
        </div>
        <span class="hist-pnl" style="color:${win ? 'var(--green)' : 'var(--red)'}">${win ? '+' : ''}$${formatNum(Math.abs(t.pnl))}</span>
      </div>`;
  }
  container.innerHTML = html;
}

function updateRisk() {
  const size = parseFloat(document.getElementById('size-input').value) || 0;
  const pct = Math.min(100, (size / state.balance) * 100);
  document.getElementById('risk-fill').style.width = pct + '%';
  document.getElementById('risk-pct').textContent = pct.toFixed(1) + '%';
  document.getElementById('risk-hint').textContent = pct.toFixed(1) + '% of balance';
}

// ============================================================
// CONTROLS & UTILS
// ============================================================
function switchTab(tab, btn) {
  document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
}

document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tf = parseInt(btn.dataset.tf);
    fetchInitialData(); // Re-fetch based on new TF
  });
});

function openGlossary() { document.getElementById('glossary-modal').classList.add('open'); }
function openReset() { document.getElementById('reset-modal').classList.add('open'); }
function doReset() {
  state.balance = CONFIG.STARTING_BALANCE;
  state.realizedPnL = 0;
  state.positions = [];
  state.history =[];
  state.wins = 0; state.losses = 0;
  updatePortfolioUI();
  renderChart();
  document.getElementById('reset-modal').classList.remove('open');
  showNotif('↺ Reset Complete', 'Balance restored to $10,000.', 'success');
}

function showNotif(title, body, type) {
  const container = document.getElementById('notifications');
  const div = document.createElement('div');
  div.className = 'notif ' + (type || '');
  div.innerHTML = `<div class="notif-title">${title}</div>${body ? `<div>${body}</div>` : ''}`;
  container.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity 0.4s';
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 400);
  }, 3000);
}

function formatPrice(p) { return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatNum(n) { return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ============================================================
// TUTORIAL SYSTEM (Abbreviated for brevity)
// ============================================================
let tutStep = 0;
const TUTORIAL_STEPS =[
  { title: '👋 Welcome to APEX TRADER!', body: `This simulator uses <span class="highlight">REAL-TIME DATA</span> to teach you how to trade risk-free. Let's learn!`, target: null },
  { title: '📈 What is Trading?', body: `Trading is buying/selling assets. You buy when you think the price will go up, and sell when you think it will go down.`, target: null },
  { title: '💰 Your Balance', body: `You start with <span class="highlight">$10,000 virtual dollars</span>. This is your capital — you can't lose real money!`, target: 'balance-display' },
  { title: '🎓 You\'re Ready!', body: `Practice makes perfect! Place your first trade using live market data. Good luck! 🚀`, target: null },
];

function startTutorial() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  initApp();
  document.getElementById('tutorial-overlay').style.display = 'block';
  renderTutStep();
}

function skipToTrading() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  initApp();
}

function renderTutStep() {
  const step = TUTORIAL_STEPS[tutStep];
  document.getElementById('tut-badge').textContent = `STEP ${tutStep + 1} / ${TUTORIAL_STEPS.length}`;
  document.getElementById('tut-title').textContent = step.title;
  document.getElementById('tut-body').innerHTML = step.body;
  document.getElementById('tut-progress').style.width = ((tutStep + 1) / TUTORIAL_STEPS.length * 100) + '%';
  document.getElementById('tut-next-btn').textContent = tutStep === TUTORIAL_STEPS.length - 1 ? 'Finish 🎉' : 'Next →';
}

function tutNext() {
  if (tutStep < TUTORIAL_STEPS.length - 1) { tutStep++; renderTutStep(); }
  else { document.getElementById('tutorial-overlay').style.display = 'none'; showNotif('Tutorial Complete!', 'Start trading!', 'success'); }
}
function tutPrev() { if (tutStep > 0) { tutStep--; renderTutStep(); } }

// ============================================================
// APP INIT
// ============================================================
async function initApp() {
  initChart();
  await fetchInitialData();
  startLiveUpdates();
  updatePortfolioUI();
  updateRisk();
    } 
