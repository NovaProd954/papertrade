// ============================================================
// APEX TRADER — Paper Trading Simulator (Complete)
// ============================================================
(function() {
    // -------------------- CONFIG --------------------
    const CONFIG = {
        STARTING_BALANCE: 10000,
        BASE_PRICE: 42000,
        API_ENABLED: true,
        API_COIN: 'bitcoin',
        API_CURRENCY: 'usd',
        API_POLL_MS: 2000,
        MAX_CANDLES: 500,
    };

    // -------------------- STATE --------------------
    const state = {
        balance: CONFIG.STARTING_BALANCE,
        realizedPnL: 0,
        positions: [],
        history: [],
        journal: [],
        candleData: [],
        currentCandle: null,
        currentPrice: CONFIG.BASE_PRICE,
        prevPrice: CONFIG.BASE_PRICE,
        tf: 1,
        speed: 1,
        paused: false,
        indicators: { sma: false, ema: false, rsi: false, vol: false },
        candleCount: 0,
        wins: 0,
        losses: 0,
        tradeId: 0,
        tickCount: 0,
        volatility: 1.0,
        trend: 0,
        trendDuration: 0,
        trendTimer: 0,
        openPrice24h: CONFIG.BASE_PRICE,
        learnMode: true,
        theme: 'dark',
        apiConnected: false,
        mouseX: -1,
        mouseY: -1,
    };

    // -------------------- DOM ELEMENTS --------------------
    const $ = (id) => document.getElementById(id);
    const dom = {
        landing: $('landing'),
        app: $('app'),
        learnToggle: $('learn-toggle'),
        navPrice: $('nav-price'),
        navChange: $('nav-change'),
        liveDot: $('live-dot'),
        playBtn: $('play-btn'),
        marketStatus: $('market-status'),
        chartCanvas: $('chart-canvas'),
        chartCtx: null,
        balanceDisplay: $('balance-display'),
        equityDisplay: $('equity-display'),
        unrealPnl: $('unreal-pnl'),
        realPnl: $('real-pnl'),
        openPositions: $('open-positions'),
        portPositions: $('port-positions'),
        tradeHistory: $('trade-history'),
        journalEntries: $('journal-entries'),
        sizeInput: $('size-input'),
        slInput: $('sl-input'),
        tpInput: $('tp-input'),
        riskFill: $('risk-fill'),
        riskPct: $('risk-pct'),
        riskHint: $('risk-hint'),
        candleCount: $('candle-count'),
        winCount: $('win-count'),
        lossCount: $('loss-count'),
        sessionPnl: $('session-pnl'),
        tutorialOverlay: $('tutorial-overlay'),
        tutSpotlight: $('tut-spotlight'),
        tutCard: $('tut-card'),
        tutTitle: $('tut-title'),
        tutBody: $('tut-body'),
        tutProgress: $('tut-progress'),
        tutBadge: $('tut-badge'),
        glossaryModal: $('glossary-modal'),
        resetModal: $('reset-modal'),
        themeModal: $('theme-modal'),
        eduPanel: $('edu-panel'),
        eduMsg: $('edu-msg'),
        notifications: $('notifications'),
        ohlcO: $('ohlc-o'), ohlcH: $('ohlc-h'), ohlcL: $('ohlc-l'), ohlcC: $('ohlc-c'),
        crosshairPrice: $('crosshair-price'),
    };

    // -------------------- UTILS --------------------
    const formatPrice = (p) => p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatNum = (n) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatDuration = (s) => s < 60 ? `${s}s` : `${Math.floor(s/60)}m`;

    // -------------------- THEME MANAGEMENT --------------------
    const themes = {
        dark:  { bg:'#080c14', panel:'#111827', accent:'#00c8ff', accent2:'#0088cc', green:'#00e67a', red:'#ff3355', bull:'#00e67a', bear:'#ff3355' },
        blue:  { bg:'#0a1628', panel:'#0f1f3d', accent:'#4da6ff', accent2:'#1a73e8', green:'#4dff91', red:'#ff4d6d', bull:'#4dff91', bear:'#ff4d6d' },
        green: { bg:'#0a1a0a', panel:'#1a2a1a', accent:'#66ff66', accent2:'#33cc33', green:'#66ff66', red:'#ff6666', bull:'#66ff66', bear:'#ff6666' },
        purple:{ bg:'#150a20', panel:'#201a30', accent:'#cc66ff', accent2:'#9933cc', green:'#66ff99', red:'#ff6699', bull:'#66ff99', bear:'#ff6699' }
    };

    function applyTheme(name) {
        const t = themes[name] || themes.dark;
        state.theme = name;
        const root = document.documentElement;
        root.style.setProperty('--bg-deep', t.bg);
        root.style.setProperty('--bg-panel', t.panel);
        root.style.setProperty('--accent', t.accent);
        root.style.setProperty('--accent2', t.accent2);
        root.style.setProperty('--green', t.green);
        root.style.setProperty('--red', t.red);
        localStorage.setItem('apex-theme', name);
    }

    function loadThemeFromStorage() {
        const saved = localStorage.getItem('apex-theme') || 'dark';
        applyTheme(saved);
    }

    // -------------------- LIVE API INTEGRATION --------------------
    let liveTimer = null;
    let lastFetchedPrice = null;

    async function fetchLivePrice() {
        if (!CONFIG.API_ENABLED || state.paused) return;
        try {
            const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${CONFIG.API_COIN}&vs_currencies=${CONFIG.API_CURRENCY}`);
            const data = await resp.json();
            const price = data[CONFIG.API_COIN][CONFIG.API_CURRENCY];
            if (price && price !== lastFetchedPrice) {
                state.prevPrice = lastFetchedPrice || price;
                state.currentPrice = price;
                lastFetchedPrice = price;
                state.apiConnected = true;
                updateLiveCandle();
                updateUI();
                renderChart();
            }
        } catch (e) {
            state.apiConnected = false;
        }
    }

    function startLiveMarket() {
        if (liveTimer) clearInterval(liveTimer);
        if (marketTimer) clearInterval(marketTimer);
        const interval = Math.max(1000, CONFIG.API_POLL_MS / state.speed);
        liveTimer = setInterval(fetchLivePrice, interval);
        fetchLivePrice();
    }

    function pauseLiveMarket() {
        if (liveTimer) clearInterval(liveTimer);
    }

    // Fallback simulated market (if no API)
    let marketTimer = null;
    function startSimMarket() {
        if (liveTimer) clearInterval(liveTimer);
        if (marketTimer) clearInterval(marketTimer);
        const interval = Math.max(20, 200 / state.speed);
        marketTimer = setInterval(simTick, interval);
    }

    function simTick() {
        if (state.paused) return;
        const noise = state.currentPrice * 0.0008 * state.volatility * (Math.random() - 0.5);
        state.prevPrice = state.currentPrice;
        state.currentPrice += noise + (state.trend * state.currentPrice * 0.0002);
        updateLiveCandle();
        updateUI();
    }

    function updateLiveCandle() {
        if (!state.currentCandle) {
            state.currentCandle = { t: Date.now(), o: state.currentPrice, h: state.currentPrice, l: state.currentPrice, c: state.currentPrice, v: 0 };
        }
        state.currentCandle.c = state.currentPrice;
        state.currentCandle.h = Math.max(state.currentCandle.h, state.currentPrice);
        state.currentCandle.l = Math.min(state.currentCandle.l, state.currentPrice);
    }

    function candleTickHandler() {
        if (state.paused) return;
        state.tickCount++;
        if (state.tickCount >= getTicksPerCandle()) {
            closeCandle();
            state.tickCount = 0;
        }
    }

    function getTicksPerCandle() {
        const base = { 1: 50, 5: 250, 15: 750, 60: 3000 };
        return Math.ceil((base[state.tf] || 50) / state.speed);
    }

    function closeCandle() {
        if (!state.currentCandle) return;
        state.candleData.push({ ...state.currentCandle });
        if (state.candleData.length > CONFIG.MAX_CANDLES) state.candleData.shift();
        state.candleCount++;
        state.currentCandle = null;
        updateLiveCandle();
        renderChart();
    }

    // Generate initial historical data
    function initCandleHistory() {
        state.candleData = [];
        let price = CONFIG.BASE_PRICE;
        const now = Date.now();
        for (let i = 0; i < 120; i++) {
            const o = price;
            const vol = 0.5 + Math.random() * 2;
            const range = o * 0.008 * vol;
            const c = o + (Math.random() - 0.5) * range;
            const h = Math.max(o, c) + Math.random() * range * 0.5;
            const l = Math.min(o, c) - Math.random() * range * 0.5;
            state.candleData.push({ t: now - (120 - i) * 60000 * state.tf, o, h, l, c, v: 10000 + Math.random() * 80000 });
            price = c;
        }
        state.currentPrice = price;
        state.openPrice24h = state.candleData[0].o;
        updateLiveCandle();
    }

    // -------------------- TRADING --------------------
    function executeTrade(type) {
        const size = parseFloat(dom.sizeInput.value) || 0;
        const sl = dom.slInput.value ? parseFloat(dom.slInput.value) : null;
        const tp = dom.tpInput.value ? parseFloat(dom.tpInput.value) : null;
        if (size <= 0) return showNotif('Invalid size', '', 'danger');
        if (size > state.balance) return showNotif('Insufficient balance', '', 'danger');
        if (sl && ((type === 'long' && sl >= state.currentPrice) || (type === 'short' && sl <= state.currentPrice))) return showNotif('Invalid SL', '', 'warn');

        const pos = { id: ++state.tradeId, type, entry: state.currentPrice, size, sl, tp, openTime: Date.now(), pnl: 0 };
        state.balance -= size;
        state.positions.push(pos);
        showNotif(type === 'long' ? '📈 Long Opened' : '📉 Short Opened', `$${formatNum(size)} @ $${formatPrice(state.currentPrice)}`, 'success');
        updatePortfolioUI();
        renderChart();
    }

    function closePosition(id) {
        const idx = state.positions.findIndex(p => p.id === id);
        if (idx === -1) return;
        const pos = state.positions[idx];
        const pnl = ((state.currentPrice - pos.entry) / pos.entry * pos.size) * (pos.type === 'long' ? 1 : -1);
        const total = pos.size + pnl;
        state.balance += total;
        state.realizedPnL += pnl;
        if (pnl >= 0) state.wins++; else state.losses++;
        state.history.unshift({ type: pos.type, entry: pos.entry, exit: state.currentPrice, size: pos.size, pnl, duration: Math.floor((Date.now() - pos.openTime) / 1000) });
        state.positions.splice(idx, 1);
        showNotif(pnl >= 0 ? '✅ Profit' : '❌ Loss', `PnL: ${pnl>=0?'+':''}$${formatNum(Math.abs(pnl))}`, pnl >= 0 ? 'success' : 'danger');
        updatePortfolioUI();
        renderChart();
    }

    function checkPositions() {
        for (let i = state.positions.length - 1; i >= 0; i--) {
            const pos = state.positions[i];
            const pnl = ((state.currentPrice - pos.entry) / pos.entry * pos.size) * (pos.type === 'long' ? 1 : -1);
            pos.pnl = pnl;
            if ( (pos.sl && ((pos.type === 'long' && state.currentPrice <= pos.sl) || (pos.type === 'short' && state.currentPrice >= pos.sl))) ||
                 (pos.tp && ((pos.type === 'long' && state.currentPrice >= pos.tp) || (pos.type === 'short' && state.currentPrice <= pos.tp))) ) {
                closePosition(pos.id);
            }
        }
    }

    function getUnrealizedPnL() {
        return state.positions.reduce((s, p) => s + ((state.currentPrice - p.entry) / p.entry * p.size) * (p.type === 'long' ? 1 : -1), 0);
    }

    function getEquity() {
        return state.balance + state.positions.reduce((s, p) => s + p.size, 0) + getUnrealizedPnL();
    }

    // -------------------- UI UPDATES --------------------
    function updateUI() {
        dom.navPrice.textContent = '$' + formatPrice(state.currentPrice);
        const pct = ((state.currentPrice - state.openPrice24h) / state.openPrice24h * 100);
        dom.navChange.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
        dom.navChange.className = 'nav-change ' + (pct >= 0 ? 'up' : 'dn');
    }

    function updatePortfolioUI() {
        const unreal = getUnrealizedPnL();
        const equity = getEquity();
        dom.balanceDisplay.textContent = '$' + formatNum(state.balance);
        dom.equityDisplay.textContent = '$' + formatNum(equity);
        dom.unrealPnl.textContent = (unreal >= 0 ? '+' : '') + '$' + formatNum(Math.abs(unreal));
        dom.realPnl.textContent = (state.realizedPnL >= 0 ? '+' : '') + '$' + formatNum(Math.abs(state.realizedPnL));
        dom.unrealPnl.className = 'stat-value ' + (unreal >= 0 ? 'green' : 'red');
        dom.realPnl.className = 'stat-value ' + (state.realizedPnL >= 0 ? 'green' : 'red');

        const totalTrades = state.wins + state.losses;
        document.getElementById('port-winrate').textContent = totalTrades > 0 ? (state.wins / totalTrades * 100).toFixed(1) + '%' : '—';
        document.getElementById('port-trades').textContent = totalTrades;
        if (state.history.length) {
            const pnls = state.history.map(t => t.pnl);
            document.getElementById('port-best').textContent = '+$' + formatNum(Math.max(...pnls));
            document.getElementById('port-worst').textContent = '-$' + formatNum(Math.abs(Math.min(...pnls)));
        }
        dom.candleCount.textContent = state.candleCount;
        dom.winCount.textContent = state.wins;
        dom.lossCount.textContent = state.losses;
        const totalPnL = state.realizedPnL + unreal;
        dom.sessionPnl.textContent = (totalPnL >= 0 ? '+' : '') + '$' + formatNum(Math.abs(totalPnL));

        renderPositionCards();
        renderTradeHistory();
    }

    function renderPositionCards() {
        const html = state.positions.map(p => {
            const pnl = ((state.currentPrice - p.entry) / p.entry * p.size) * (p.type === 'long' ? 1 : -1);
            const pnlColor = pnl >= 0 ? 'var(--green)' : 'var(--red)';
            return `<div class="position-card">
                <div class="pos-header"><span class="pos-type ${p.type}">${p.type.toUpperCase()}</span><button class="pos-close-btn" onclick="window.closePos(${p.id})">Close ×</button></div>
                <div class="pos-row"><span>Entry</span><span>$${formatPrice(p.entry)}</span></div>
                <div class="pos-row"><span>Current</span><span>$${formatPrice(state.currentPrice)}</span></div>
                <div class="pos-row"><span>Size</span><span>$${formatNum(p.size)}</span></div>
                ${p.sl ? `<div class="pos-row"><span>SL</span><span style="color:var(--red)">$${formatPrice(p.sl)}</span></div>` : ''}
                ${p.tp ? `<div class="pos-row"><span>TP</span><span style="color:var(--green)">$${formatPrice(p.tp)}</span></div>` : ''}
                <div class="pos-pnl" style="color:${pnlColor}">${pnl>=0?'+':''}$${formatNum(Math.abs(pnl))} (${(pnl/p.size*100).toFixed(2)}%)</div>
            </div>`;
        }).join('');
        dom.openPositions.innerHTML = html || '<div class="empty-state">No open positions.</div>';
        dom.portPositions.innerHTML = html || '<div class="empty-state">No open positions.</div>';
    }

    function renderTradeHistory() {
        const html = state.history.slice(0, 50).map(t => {
            const win = t.pnl >= 0;
            return `<div class="history-row">
                <span class="hist-badge ${win ? 'win' : 'loss'}">${t.type.toUpperCase()}</span>
                <div><div>$${formatPrice(t.entry)} → $${formatPrice(t.exit)}</div>
                <div style="font-size:0.6rem;color:var(--text-dim)">${formatDuration(t.duration)} · $${formatNum(t.size)}</div></div>
                <span class="hist-pnl" style="color:${win ? 'var(--green)' : 'var(--red)'}">${win?'+':''}$${formatNum(Math.abs(t.pnl))}</span>
            </div>`;
        }).join('');
        dom.tradeHistory.innerHTML = html || '<div class="empty-state">No closed trades yet.</div>';
    }

    function updateRisk() {
        const size = parseFloat(dom.sizeInput.value) || 0;
        const pct = Math.min(100, (size / state.balance) * 100);
        dom.riskFill.style.width = pct + '%';
        dom.riskPct.textContent = pct.toFixed(1) + '%';
        dom.riskHint.textContent = pct.toFixed(1) + '% of balance';
    }

    // -------------------- NOTIFICATIONS & TIPS --------------------
    function showNotif(title, body, type) {
        const el = document.createElement('div');
        el.className = 'notif ' + (type || '');
        el.innerHTML = `<div class="notif-title">${title}</div>${body ? `<div>${body}</div>` : ''}`;
        dom.notifications.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3000);
    }

    function showEduMsg(msg, dur = 4000) {
        if (!state.learnMode) return;
        dom.eduMsg.textContent = msg;
        dom.eduPanel.classList.add('visible');
        clearTimeout(dom.eduPanel._timer);
        dom.eduPanel._timer = setTimeout(() => dom.eduPanel.classList.remove('visible'), dur);
    }

    // -------------------- CHART RENDERING --------------------
    function initChart() {
        dom.chartCtx = dom.chartCanvas.getContext('2d');
        resizeChart();
        dom.chartCanvas.addEventListener('mousemove', (e) => {
            const rect = dom.chartCanvas.getBoundingClientRect();
            state.mouseX = e.clientX - rect.left;
            state.mouseY = e.clientY - rect.top;
            renderChart();
        });
        dom.chartCanvas.addEventListener('mouseleave', () => { state.mouseX = -1; state.mouseY = -1; renderChart(); });
        window.addEventListener('resize', resizeChart);
    }

    function resizeChart() {
        const wrap = document.querySelector('.chart-wrap');
        dom.chartCanvas.width = wrap.clientWidth;
        dom.chartCanvas.height = wrap.clientHeight;
        renderChart();
        if (state.indicators.rsi) {
            const rsiC = document.getElementById('rsi-canvas');
            rsiC.width = document.getElementById('rsi-panel').clientWidth;
            rsiC.height = 80;
            renderRSI();
        }
        if (state.indicators.vol) {
            const volC = document.getElementById('vol-canvas');
            volC.width = document.getElementById('volume-panel').clientWidth;
            volC.height = 80;
            renderVolume();
        }
    }

    function renderChart() {
        const ctx = dom.chartCtx;
        const W = dom.chartCanvas.width, H = dom.chartCanvas.height;
        const PRICE_W = 72, TIME_H = 28;
        const plotW = W - PRICE_W, plotH = H - TIME_H;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep');
        ctx.fillRect(0, 0, W, H);

        let candles = [...state.candleData];
        if (state.currentCandle) candles.push(state.currentCandle);
        if (candles.length === 0) return;

        const visible = Math.min(candles.length, 80);
        const display = candles.slice(-visible);
        let minP = Infinity, maxP = -Infinity;
        display.forEach(c => { minP = Math.min(minP, c.l); maxP = Math.max(maxP, c.h); });
        const pad = (maxP - minP) * 0.1; minP -= pad; maxP += pad;
        const priceRange = maxP - minP || 1;
        const toY = p => plotH - ((p - minP) / priceRange) * plotH;
        const spacing = plotW / display.length;
        const candleW = spacing * 0.7;

        // Grid & price labels
        ctx.strokeStyle = '#1a2535'; ctx.lineWidth = 1;
        for (let i = 0; i <= 6; i++) {
            const y = (plotH / 6) * i;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
            const price = maxP - (priceRange / 6) * i;
            ctx.fillStyle = '#3d5a7a'; ctx.font = '10px IBM Plex Mono'; ctx.textAlign = 'left';
            ctx.fillText('$' + formatPrice(price), plotW + 4, y + 4);
        }

        // SMA
        if (state.indicators.sma && display.length >= 20) {
            ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 1.5; ctx.beginPath();
            for (let i = 19; i < display.length; i++) {
                const avg = display.slice(i-19, i+1).reduce((a,c) => a + c.c, 0) / 20;
                const x = i * spacing + spacing/2, y = toY(avg);
                i === 19 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        // EMA
        if (state.indicators.ema && display.length >= 12) {
            ctx.strokeStyle = '#ff88aa'; ctx.lineWidth = 1.5; ctx.beginPath();
            let ema = display[0].c; const k = 2/13;
            for (let i = 0; i < display.length; i++) {
                ema = display[i].c * k + ema * (1 - k);
                const x = i * spacing + spacing/2, y = toY(ema);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Candles
        display.forEach((c, i) => {
            const x = i * spacing + spacing/2;
            const bull = c.c >= c.o;
            const color = bull ? getComputedStyle(document.documentElement).getPropertyValue('--candle-bull').trim() || '#00e67a'
                              : getComputedStyle(document.documentElement).getPropertyValue('--candle-bear').trim() || '#ff3355';
            ctx.strokeStyle = color; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, toY(c.h)); ctx.lineTo(x, toY(c.l)); ctx.stroke();
            const bodyTop = toY(Math.max(c.o, c.c)), bodyBot = toY(Math.min(c.o, c.c));
            ctx.fillStyle = color;
            ctx.fillRect(x - candleW/2, bodyTop, candleW, Math.max(1, bodyBot - bodyTop));
        });

        // Position lines
        state.positions.forEach(pos => {
            const y = toY(pos.entry);
            ctx.strokeStyle = pos.type === 'long' ? '#00e67a' : '#ff3355'; ctx.lineWidth = 1;
            ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke(); ctx.setLineDash([]);
            if (pos.sl) { ctx.strokeStyle = '#ff3355'; ctx.beginPath(); ctx.moveTo(0, toY(pos.sl)); ctx.lineTo(plotW, toY(pos.sl)); ctx.stroke(); }
            if (pos.tp) { ctx.strokeStyle = '#00e67a'; ctx.beginPath(); ctx.moveTo(0, toY(pos.tp)); ctx.lineTo(plotW, toY(pos.tp)); ctx.stroke(); }
        });

        // Current price line
        const cpY = toY(state.currentPrice);
        ctx.strokeStyle = 'rgba(0,200,255,0.5)'; ctx.beginPath(); ctx.moveTo(0, cpY); ctx.lineTo(plotW, cpY); ctx.stroke();

        // Crosshair
        if (state.mouseX >= 0 && state.mouseX <= plotW && state.mouseY >= 0 && state.mouseY <= plotH) {
            ctx.strokeStyle = 'rgba(100,140,200,0.3)'; ctx.beginPath();
            ctx.moveTo(state.mouseX, 0); ctx.lineTo(state.mouseX, plotH);
            ctx.moveTo(0, state.mouseY); ctx.lineTo(plotW, state.mouseY); ctx.stroke();
            const hp = maxP - (state.mouseY / plotH) * priceRange;
            dom.crosshairPrice.style.display = 'block';
            dom.crosshairPrice.textContent = '$' + formatPrice(hp);
            const idx = Math.floor(state.mouseX / spacing);
            if (idx >= 0 && idx < display.length) {
                const hc = display[idx];
                dom.ohlcO.textContent = '$' + formatPrice(hc.o);
                dom.ohlcH.textContent = '$' + formatPrice(hc.h);
                dom.ohlcL.textContent = '$' + formatPrice(hc.l);
                dom.ohlcC.textContent = '$' + formatPrice(hc.c);
            }
        } else {
            dom.crosshairPrice.style.display = 'none';
        }
    }

    function renderRSI() {
        const canvas = document.getElementById('rsi-canvas');
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle = '#0a0f1a'; ctx.fillRect(0,0,W,H);
        const candles = [...state.candleData]; if (state.currentCandle) candles.push(state.currentCandle);
        if (candles.length < 14) return;
        const rsi = calcRSI(candles, 14);
        const spacing = (W - 72) / candles.length;
        ctx.fillStyle = '#aa44ff'; ctx.beginPath();
        rsi.forEach((v, i) => {
            const x = (i + candles.length - rsi.length) * spacing + spacing/2;
            const y = H - (v/100)*H;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    function calcRSI(candles, period) {
        if (candles.length < period+1) return [];
        const vals = []; let gains = 0, losses = 0;
        for (let i=1; i<=period; i++) {
            const d = candles[i].c - candles[i-1].c;
            d>0 ? gains+=d : losses-=d;
        }
        let avgG = gains/period, avgL = losses/period;
        for (let i=period; i<candles.length; i++) {
            const d = candles[i].c - candles[i-1].c;
            avgG = (avgG*(period-1) + (d>0?d:0)) / period;
            avgL = (avgL*(period-1) + (d<0?-d:0)) / period;
            vals.push(avgL===0 ? 100 : 100 - 100/(1 + avgG/avgL));
        }
        return vals;
    }

    function renderVolume() {
        const canvas = document.getElementById('vol-canvas');
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0,0,W,H);
        const display = [...state.candleData].slice(-80);
        const maxV = Math.max(...display.map(c=>c.v));
        const spacing = (W-72)/display.length;
        display.forEach((c,i) => {
            const x = i*spacing+spacing/2;
            const h = (c.v/maxV)*H*0.9;
            ctx.fillStyle = c.c>=c.o ? 'rgba(0,230,122,0.4)' : 'rgba(255,51,85,0.4)';
            ctx.fillRect(x-spacing*0.35, H-h, spacing*0.7, h);
        });
    }

    // -------------------- TUTORIAL SYSTEM --------------------
    const TUT_STEPS = [
        { title:'Welcome!', body:'Learn candlestick trading with virtual money. No risk!' },
        { title:'Candlestick Basics', body:'Each green/red bar shows price action over a time period.' },
        { title:'OHLC', body:'Open, High, Low, Close — hover over candles to see them.' },
        { title:'Trends', body:'Uptrend = higher highs, downtrend = lower lows.' },
        { title:'Indicators', body:'Enable SMA, EMA, RSI to analyze the market.' },
        { title:'Buying (Long)', body:'Click BUY LONG when you expect price to rise.' },
        { title:'Selling (Short)', body:'Click SELL SHORT when you expect price to fall.' },
        { title:'Stop Loss', body:'Set a Stop Loss to limit potential losses.' },
        { title:'Take Profit', body:'Set a Take Profit to lock in gains.' },
        { title:'Risk Management', body:'Never risk more than 2-5% per trade.' },
        { title:'Ready!', body:'Practice smartly — every trade teaches you something.' },
    ];
    let tutStep = 0, tutActive = false;

    function showTutorial() {
        tutActive = true; tutStep = 0;
        dom.tutorialOverlay.style.display = 'block';
        renderTutStep();
    }

    function endTutorial() {
        tutActive = false;
        dom.tutorialOverlay.style.display = 'none';
        document.getElementById('tut-resume-small').style.display = 'block';
    }

    function tutNext() {
        if (tutStep < TUT_STEPS.length-1) { tutStep++; renderTutStep(); }
        else endTutorial();
    }

    function tutPrev() {
        if (tutStep > 0) { tutStep--; renderTutStep(); }
    }

    function renderTutStep() {
        const s = TUT_STEPS[tutStep];
        dom.tutTitle.textContent = s.title;
        dom.tutBody.textContent = s.body;
        dom.tutProgress.style.width = ((tutStep+1)/TUT_STEPS.length*100) + '%';
        dom.tutBadge.textContent = `STEP ${tutStep+1}/${TUT_STEPS.length}`;
        positionTutCard(null);
    }

    function positionTutCard(target) {
        dom.tutSpotlight.style.display = 'none';
    }

    // -------------------- EVENT WIRING --------------------
    function wireEvents() {
        // Landing
        document.getElementById('btn-start-tutorial').addEventListener('click', startTutorial);
        document.getElementById('btn-skip-tutorial').addEventListener('click', skipToTrading);
        dom.learnToggle.addEventListener('click', function() {
            this.classList.toggle('on');
            state.learnMode = this.classList.contains('on');
        });

        // Nav
        dom.playBtn.addEventListener('click', togglePause);
        document.getElementById('btn-theme').addEventListener('click', () => dom.themeModal.classList.add('open'));
        document.getElementById('btn-glossary').addEventListener('click', () => dom.glossaryModal.classList.add('open'));
        document.getElementById('btn-reset').addEventListener('click', () => dom.resetModal.classList.add('open'));
        document.getElementById('btn-tutorial-resume').addEventListener('click', showTutorial);

        // Timeframe & Speed
        document.querySelectorAll('.tf-btn').forEach(b => b.addEventListener('click', (e) => {
            document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'));
            e.target.classList.add('active');
            state.tf = parseInt(e.target.dataset.tf);
            initCandleHistory();
        }));
        document.querySelectorAll('.speed-btn').forEach(b => b.addEventListener('click', (e) => {
            document.querySelectorAll('.speed-btn').forEach(b=>b.classList.remove('active'));
            e.target.classList.add('active');
            state.speed = parseInt(e.target.dataset.spd);
            restartMarket();
        }));

        // Indicators
        document.querySelectorAll('.ind-btn').forEach(b => b.addEventListener('click', (e) => {
            const ind = e.target.dataset.ind;
            state.indicators[ind] = !state.indicators[ind];
            e.target.classList.toggle('active');
            if (ind === 'rsi') document.getElementById('rsi-panel').classList.toggle('visible');
            if (ind === 'vol') document.getElementById('volume-panel').classList.toggle('visible');
            resizeChart();
        }));

        // Trading
        document.getElementById('buy-btn').addEventListener('click', () => executeTrade('long'));
        document.getElementById('sell-btn').addEventListener('click', () => executeTrade('short'));
        dom.sizeInput.addEventListener('input', updateRisk);
        dom.slInput.addEventListener('input', updateRisk);

        // Tabs
        document.querySelectorAll('.panel-tab').forEach(t => t.addEventListener('click', (e) => {
            document.querySelectorAll('.panel-tab, .panel-section').forEach(el => el.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById('tab-'+e.target.dataset.tab).classList.add('active');
        }));

        // Modals
        document.getElementById('glossary-close').addEventListener('click', () => dom.glossaryModal.classList.remove('open'));
        document.getElementById('btn-reset-cancel').addEventListener('click', () => dom.resetModal.classList.remove('open'));
        document.getElementById('btn-reset-confirm').addEventListener('click', doReset);
        document.getElementById('edu-close').addEventListener('click', () => dom.eduPanel.classList.remove('visible'));

        // Theme
        document.querySelectorAll('.preset-btns button').forEach(b => b.addEventListener('click', (e) => {
            applyTheme(e.target.dataset.theme);
            document.querySelectorAll('.preset-btns button').forEach(b=>b.classList.remove('active'));
            e.target.classList.add('active');
        }));
        document.getElementById('btn-close-theme').addEventListener('click', () => dom.themeModal.classList.remove('open'));
        document.getElementById('btn-reset-theme').addEventListener('click', () => applyTheme('dark'));

        // Tutorial buttons
        document.getElementById('tut-next-btn').addEventListener('click', tutNext);
        document.getElementById('tut-prev-btn').addEventListener('click', tutPrev);
        document.getElementById('tut-skip-btn').addEventListener('click', endTutorial);
        document.getElementById('tut-resume-small').addEventListener('click', showTutorial);

        // Journal
        document.getElementById('btn-save-journal').addEventListener('click', saveJournal);

        // Close modals on backdrop click
        document.getElementById('glossary-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) dom.glossaryModal.classList.remove('open'); });
        document.getElementById('reset-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) dom.resetModal.classList.remove('open'); });
        document.getElementById('theme-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) dom.themeModal.classList.remove('open'); });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === ' ' && !tutActive) { e.preventDefault(); togglePause(); }
        });
    }

    function togglePause() {
        state.paused = !state.paused;
        dom.playBtn.textContent = state.paused ? '▶' : '⏸';
        dom.liveDot.classList.toggle('paused', state.paused);
        dom.marketStatus.textContent = state.paused ? 'PAUSED' : 'LIVE';
        state.paused ? pauseLiveMarket() : startLiveMarket();
    }

    function restartMarket() {
        if (state.apiConnected || CONFIG.API_ENABLED) startLiveMarket();
        else startSimMarket();
    }

    function startTutorial() {
        dom.landing.classList.add('hidden');
        dom.app.classList.remove('hidden');
        initAll();
        showTutorial();
    }

    function skipToTrading() {
        dom.landing.classList.add('hidden');
        dom.app.classList.remove('hidden');
        initAll();
        document.getElementById('tut-resume-small').style.display = 'block';
    }

    function initAll() {
        initCandleHistory();
        initChart();
        updatePortfolioUI();
        updateRisk();
        if (CONFIG.API_ENABLED) startLiveMarket(); else startSimMarket();
        // Periodic check
        setInterval(() => {
            if (!state.paused) {
                if (!state.apiConnected) simTick();
                candleTickHandler();
                checkPositions();
                updatePortfolioUI();
                renderChart();
            }
        }, 200);
        // Auto tips
        setInterval(() => {
            if (!state.paused && state.learnMode) showEduMsg('Tip: Always use a stop loss.');
        }, 30000);
    }

    function doReset() {
        state.balance = CONFIG.STARTING_BALANCE;
        state.realizedPnL = 0;
        state.positions = [];
        state.history = [];
        state.wins = 0; state.losses = 0;
        initCandleHistory();
        updatePortfolioUI();
        renderChart();
        dom.resetModal.classList.remove('open');
        showNotif('Reset', 'Balance restored.', 'success');
    }

    function saveJournal() {
        const text = document.getElementById('journal-input').value.trim();
        if (!text) return;
        state.journal.unshift({ text, time: new Date().toLocaleString(), price: state.currentPrice });
        document.getElementById('journal-input').value = '';
        renderJournal();
    }

    function renderJournal() {
        dom.journalEntries.innerHTML = state.journal.slice(0,20).map(e =>
            `<div class="journal-entry"><div class="je-time">${e.time} · $${formatPrice(e.price)}</div>${e.text}</div>`
        ).join('') || '<div class="empty-state">No notes yet.</div>';
    }

    // Expose closePosition globally for inline onclick
    window.closePos = (id) => closePosition(id);

    // -------------------- BOOT --------------------
    window.addEventListener('load', () => {
        loadThemeFromStorage();
        wireEvents();
    });
})(); 
