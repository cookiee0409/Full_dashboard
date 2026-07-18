const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaults = { theme:'dark', colorMode:'global', stocksKR:[], stocksUS:['^IXIC','AAPL','MSFT','NVDA','MU','TSLA'] };
const stored = JSON.parse(localStorage.getItem('hub.settings.v1') || '{}');
let settings = { ...defaults, ...stored, stocksKR: stored.stocksKR || defaults.stocksKR, stocksUS: stored.stocksUS || defaults.stocksUS };
let krTop10Symbols = null;
async function krWatchlistSymbols() { if (settings.stocksKR.length) return settings.stocksKR; if (!krTop10Symbols) { try { krTop10Symbols = (await api('kr-top10')).items.map(x=>x.symbol); } catch { krTop10Symbols = []; } } return krTop10Symbols; }
let activeMarket = 'kr', activeCategory = 'all', activeChain = 'mentions', rankSort = { field:'marketCap', asc:false };
let rankingItems = [], memeData = null, chartItem = null, marketItems = [];
const api = async path => { const r = await fetch('/api/' + path); const data = await r.json(); if (!r.ok) throw new Error(data.error || '요청 실패'); return data; };
const money = (n, currency = 'USD') => n == null ? '—' : n > 0 && n < 1 ? new Intl.NumberFormat('ko-KR', { style:'currency', currency, maximumSignificantDigits:4 }).format(n) : new Intl.NumberFormat('ko-KR', { style:'currency', currency, maximumFractionDigits:2 }).format(n);
function marketCap(n, currency = 'USD') {
  if (n == null) return '—';
  if (currency === 'KRW') {
    if (n >= 1e12) return (n/1e12).toFixed(1)+'조원';
    if (n >= 1e8) return (n/1e8).toFixed(1)+'억원';
    return new Intl.NumberFormat('ko-KR', { style:'currency', currency, maximumFractionDigits:0 }).format(n);
  }
  if (n >= 1e12) return '$'+(n/1e12).toFixed(2)+'T';
  if (n >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return '$'+(n/1e6).toFixed(2)+'M';
  return new Intl.NumberFormat('ko-KR', { style:'currency', currency, maximumFractionDigits:0 }).format(n);
}
const pct = n => `<span class="${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '▲' : '▼'} ${Math.abs(n || 0).toFixed(2)}%</span>`;
const ago = () => '방금 전';
function spark(values) { if (!values?.length) return ''; const min=Math.min(...values), max=Math.max(...values), d=max-min||1; const points=values.map((v,i)=>`${i/(values.length-1)*48},${20-(v-min)/d*17}`).join(' '); return `<svg class="spark" viewBox="0 0 48 20" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${points}"/></svg>`; }
const xIcon = handle => handle ? `<a class="link-icon" href="https://x.com/${esc(handle)}" target="_blank" rel="noopener" title="공식 X" aria-label="공식 X" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-7.6 8.7L23 22h-6.9l-5.4-6.7L4.4 22H1.3l8.2-9.4L1 2h7.1l4.9 6.2L18.9 2Zm-1.2 18h1.9L7.4 4h-2l12.3 16Z"/></svg></a>` : '';
const gmgnIcon = url => url ? `<a class="link-icon gmgn" href="${esc(url)}" target="_blank" rel="noopener" title="GMGN에서 보기" aria-label="GMGN에서 보기" onclick="event.stopPropagation()">G</a>` : '';
const xSearchIcon = url => url ? `<a class="link-icon" href="${esc(url)}" target="_blank" rel="noopener" title="X 검색" aria-label="X 검색" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-7.6 8.7L23 22h-6.9l-5.4-6.7L4.4 22H1.3l8.2-9.4L1 2h7.1l4.9 6.2L18.9 2Zm-1.2 18h1.9L7.4 4h-2l12.3 16Z"/></svg></a>` : '';
const teleIcon = url => url ? `<a class="link-icon tele" href="${esc(url)}" target="_blank" rel="noopener" title="텔레그램 원문" aria-label="텔레그램 원문" onclick="event.stopPropagation()">T</a>` : '';
function bindRowClicks(selector, onActivate) { $$(selector).forEach((row,i)=>{ row.onclick=()=>onActivate(i); row.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onActivate(i); } }; }); }
function fail(id, error, retry) { $(id).innerHTML = `<p class="error">${esc(error.message || '데이터를 불러오지 못했습니다.')}${retry ? ' · 잠시 후 자동 재시도' : ''}</p>`; if (retry) setTimeout(retry, 18000); }
function updateTime(id) { $(id).textContent = ago(); }
function applySettings() { document.body.classList.toggle('light', settings.theme === 'light'); document.body.classList.toggle('kr-colors', settings.colorMode === 'kr'); }
let chartRange = '3m', chartInterval = 'day';
function sliceHistory(history, range) {
  const total = history.dates.length;
  const days = range === '1m' ? Math.min(22, total) : total;
  const start = Math.max(0, total - days);
  const slice = k => history[k].slice(start);
  return { dates: slice('dates'), open: slice('open'), high: slice('high'), low: slice('low'), close: slice('close'), volume: slice('volume') };
}
function niceTicks(min, max, count) {
  if (!isFinite(min) || !isFinite(max) || min === max) { min = (min || 0) - 1; max = (max || 0) + 1; }
  const rawStep = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const niceMin = Math.floor(min / step) * step, niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { ticks, niceMin, niceMax };
}
function axisNum(n) {
  if (n == null) return '';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 1000) return Math.round(n).toLocaleString('ko-KR');
  if (abs >= 1) return n.toFixed(2);
  const digits = Math.min(10, Math.max(0, 3 - Math.floor(Math.log10(abs)) - 1));
  return n.toFixed(digits);
}
function fmtDate(d) { const p = d.split('-'); return `${+p[1]}.${+p[2]}`; }
function axisGrid(ticks, y, plotRight) { return ticks.map(t => `<line x1="0" x2="${plotRight}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${plotRight+6}" y="${y(t)+3}" class="axis-label">${axisNum(t)}</text>`).join(''); }
function candleChart(history) {
  const W=560, H=230, padR=54, padT=8, priceH=142, gapV=10, volH=38;
  const n = history.close.length;
  if (!n) return '<p class="empty-note">차트 데이터를 불러올 수 없습니다.</p>';
  const plotRight = W - padR;
  const highs = history.high.map((h,i)=>h ?? history.close[i]);
  const lows = history.low.map((l,i)=>l ?? history.close[i]);
  const { ticks, niceMin, niceMax } = niceTicks(Math.min(...lows), Math.max(...highs), 4);
  const range = (niceMax - niceMin) || 1;
  const y = v => padT + priceH - (v - niceMin) / range * priceH;
  const volMax = Math.max(...history.volume.map(v => v || 0), 1);
  const volBase = padT + priceH + gapV + volH;
  const volY = v => volBase - (v || 0) / volMax * volH;
  const stepX = plotRight / n;
  const cx = i => stepX * i + stepX / 2;
  const bw = Math.max(stepX * 0.55, 1.2);
  let candles = '', vols = '';
  for (let i = 0; i < n; i++) {
    const o=history.open[i], h=history.high[i], l=history.low[i], c=history.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    const cls = c >= o ? 'cs-up' : 'cs-down';
    const bodyTop = y(Math.max(o,c)), bodyBot = y(Math.min(o,c));
    candles += `<g class="${cls}"><line x1="${cx(i)}" x2="${cx(i)}" y1="${y(h)}" y2="${y(l)}" stroke="currentColor" stroke-width="1"/><rect x="${cx(i)-bw/2}" y="${bodyTop}" width="${bw}" height="${Math.max(bodyBot-bodyTop,1)}" fill="currentColor"/></g>`;
    vols += `<rect class="${cls}" x="${cx(i)-bw/2}" y="${volY(history.volume[i])}" width="${bw}" height="${volBase-volY(history.volume[i])}" fill="currentColor" opacity=".5"/>`;
  }
  const labelCount = Math.min(5, n);
  let xLabels = '';
  for (let k = 0; k < labelCount; k++) {
    const idx = Math.round(k * (n - 1) / Math.max(labelCount - 1, 1));
    xLabels += `<text x="${cx(idx)}" y="${H-4}" class="axis-label" text-anchor="middle">${fmtDate(history.dates[idx])}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="axis-chart" preserveAspectRatio="none">${axisGrid(ticks,y,plotRight)}${candles}${vols}${xLabels}</svg>`;
}
function lineChartWithAxes(values) {
  const n = values.length;
  const W=560, H=200, padR=54, padT=8, padB=20, plotH=H-padT-padB;
  const plotRight = W - padR;
  const { ticks, niceMin, niceMax } = niceTicks(Math.min(...values), Math.max(...values), 4);
  const range = (niceMax - niceMin) || 1;
  const y = v => padT + plotH - (v - niceMin) / range * plotH;
  const stepX = plotRight / Math.max(n - 1, 1);
  const x = i => stepX * i;
  const points = values.map((v,i) => `${x(i)},${y(v)}`).join(' ');
  const cls = values.at(-1) - values[0] >= 0 ? 'cs-up' : 'cs-down';
  const hoursPerPoint = n > 1 ? (7*24)/(n-1) : 0;
  const labelCount = Math.min(5, n);
  let xLabels = '';
  for (let k = 0; k < labelCount; k++) {
    const idx = Math.round(k * (n - 1) / Math.max(labelCount - 1, 1));
    const t = new Date(Date.now() - (n-1-idx)*hoursPerPoint*36e5);
    xLabels += `<text x="${x(idx)}" y="${H-4}" class="axis-label" text-anchor="middle">${t.getMonth()+1}.${t.getDate()}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="axis-chart ${cls}" preserveAspectRatio="none"><defs><linearGradient id="shade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>${axisGrid(ticks,y,plotRight)}<path fill="url(#shade)" d="M ${points} L ${x(n-1)} ${padT+plotH} L 0 ${padT+plotH} Z"/><polyline fill="none" stroke="currentColor" stroke-width="2" points="${points}"/>${xLabels}</svg>`;
}

// ===== TradingView-style candlestick chart (independent per-tab instances) =====
// Data is fetched per interval from /api/history (1h/4h/1d); 주/월 are aggregated
// from the 1d series. A view window (start,end) over the full series drives the
// period buttons AND wheel zoom. Crosshair shows a floating OHLCV tooltip plus a
// precise price label on the Y axis.
const SERVER_INTERVAL = { '1h': '1h', '4h': '4h', day: '1d', week: '1d', month: '1d' };
const HL_SYMBOLS = new Set(['HYPE', 'SAMSUNG', 'SKHYNIX', 'LIT']);
const RANGE_DAYS = { '1m': 31, '3m': 93, '6m': 186 };
const CHART_DIMS = { W: 720, H: 300, padR: 66, top: 12, priceH: 196, volTop: 236, volBottom: 280 };
const MODAL_DIMS = { W: 1120, H: 560, padR: 74, top: 14, priceH: 392, volTop: 462, volBottom: 540 };
const itemKey = item => String(item.id || item.symbol || item.name);
const looksCoinId = s => /^[a-z][a-z0-9-]+$/.test(s || '');
function isCoinLike(item) {
  if (item.chain && item.address) return true;
  if (item.symbol === 'HYPE' || item.symbol === 'LIT') return true;
  if (item.symbol === 'SAMSUNG' || item.symbol === 'SKHYNIX') return false;
  return looksCoinId(item.id) || looksCoinId(item.symbol);
}
function historyQuery(item) {
  if (item.chain && item.address) return `chain=${encodeURIComponent(item.chain)}&address=${encodeURIComponent(item.address)}`;
  if (HL_SYMBOLS.has(item.symbol)) return `hl=${item.symbol}`;
  const coinId = looksCoinId(item.id) ? item.id : looksCoinId(item.symbol) ? item.symbol : null;
  if (coinId) { const ticker = /^[A-Z0-9]{2,10}$/.test(item.symbol || '') ? item.symbol : (item.name || coinId); return `coin=${encodeURIComponent(coinId)}&sym=${encodeURIComponent(ticker)}`; }
  if (item.symbol) return `stock=${encodeURIComponent(item.symbol)}`;
  return '';
}
const parseBarDate = label => new Date(label.includes(' ') ? label.replace(' ', 'T') + ':00Z' : label + 'T00:00:00Z');
function aggregateWeekMonth(history, unit) {
  const grouped = new Map(), order = [];
  history.dates.forEach((date, i) => {
    const d = parseBarDate(date);
    const key = unit === 'week'
      ? `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 604800000)}`
      : `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const bar = { date, open: history.open[i], high: history.high[i], low: history.low[i], close: history.close[i], volume: history.volume[i] || 0 };
    const cur = grouped.get(key);
    if (!cur) { grouped.set(key, bar); order.push(key); }
    else { cur.high = Math.max(cur.high ?? cur.close, bar.high ?? bar.close); cur.low = Math.min(cur.low ?? cur.close, bar.low ?? bar.close); cur.close = bar.close; cur.volume += bar.volume; cur.date = date; }
  });
  const bars = order.map(k => grouped.get(k));
  return { dates: bars.map(b => b.date), open: bars.map(b => b.open), high: bars.map(b => b.high), low: bars.map(b => b.low), close: bars.map(b => b.close), volume: bars.map(b => b.volume) };
}
function shortVolume(value) {
  if (!value) return '—';
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (value >= 1e4) return `${Math.round(value / 1e4)}만`;
  return Math.round(value).toLocaleString('ko-KR');
}
function preciseNum(v) {   // Y-axis cursor readout: more decimals than the axis grid
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(3);
  if (a === 0) return '0';
  return v.toFixed(Math.min(10, Math.max(2, 3 - Math.floor(Math.log10(a)))));
}
const fmtBarLabel = label => { const d = parseBarDate(label); return label.includes(' ') ? `${d.getUTCMonth()+1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}` : `${d.getUTCFullYear()}.${d.getUTCMonth()+1}.${d.getUTCDate()}`; };
function ohlcLegend(history, i, item) {
  const o = history.open[i], h = history.high[i], l = history.low[i], c = history.close[i];
  const prev = i ? history.close[i - 1] : o, chg = c - prev, pctv = prev ? chg / prev * 100 : 0, up = chg >= 0;
  const cur = item.currency || 'USD';
  return `<span class="tvl-date">${esc(history.dates[i])}</span><span>시 <b>${money(o,cur)}</b></span><span>고 <b>${money(h,cur)}</b></span><span>저 <b>${money(l,cur)}</b></span><span>종 <b>${money(c,cur)}</b></span><span>거래량 <b>${shortVolume(history.volume[i])}</b></span><span class="${up?'cs-up':'cs-down'}">${up?'+':''}${axisNum(chg)} (${up?'+':''}${pctv.toFixed(2)}%)</span>`;
}
function tooltipHtml(history, i, item) {
  const cur = item.currency || 'USD', o = history.open[i], c = history.close[i];
  const chg = o ? (c - o) / o * 100 : 0, up = c >= o;
  return `<strong>${esc(history.dates[i])}</strong><span>시가 <b>${money(o,cur)}</b></span><span>고가 <b>${money(history.high[i],cur)}</b></span><span>저가 <b>${money(history.low[i],cur)}</b></span><span>종가 <b>${money(c,cur)}</b> <em class="${up?'cs-up':'cs-down'}">${up?'+':''}${chg.toFixed(2)}%</em></span><span>거래