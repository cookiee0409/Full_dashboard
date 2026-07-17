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

// ===== Unified TradingView-style candlestick chart =====
// Every asset (stock, index, hyperliquid, coin, DEX memecoin) renders the same
// chart. Data is fetched per interval from /api/history (1h/4h/1d); 주/월 are
// aggregated on the client from the 1d series. chartRange/chartInterval are
// declared above.
const SERVER_INTERVAL = { '1h': '1h', '4h': '4h', day: '1d', week: '1d', month: '1d' };
const HL_SYMBOLS = new Set(['HYPE', 'SAMSUNG', 'SKHYNIX', 'LIT']);
const chartCache = new Map();   // `${key}:${serverInterval}` -> history
let chartRendered = null;       // last sliced {history,item} for the expand modal
const itemKey = item => String(item.id || item.symbol || item.name);
const looksCoinId = s => /^[a-z][a-z0-9-]+$/.test(s || '');
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
function sliceByRange(history, range) {
  const n = history.dates.length;
  if (range === 'all' || !n) return history;
  const days = { '1m': 31, '3m': 93, '6m': 186 }[range] || 93;
  const cutoff = parseBarDate(history.dates[n - 1]).getTime() - days * 864e5;
  let start = 0;
  for (let i = 0; i < n; i++) { if (parseBarDate(history.dates[i]).getTime() >= cutoff) { start = i; break; } }
  const s = k => history[k].slice(start);
  return { dates: s('dates'), open: s('open'), high: s('high'), low: s('low'), close: s('close'), volume: s('volume') };
}
async function fetchChartHistory(item) {
  const si = SERVER_INTERVAL[chartInterval], ck = `${itemKey(item)}:${si}`;
  if (chartCache.has(ck)) return chartCache.get(ck);
  const q = historyQuery(item);
  if (!q) return null;
  const d = await api(`history?interval=${si}&${q}`);
  if (d.history?.close?.length) chartCache.set(ck, d.history);
  return d.history?.close?.length ? d.history : null;
}
function processHistory(base) {
  let h = base;
  if (chartInterval === 'week') h = aggregateWeekMonth(h, 'week');
  else if (chartInterval === 'month') h = aggregateWeekMonth(h, 'month');
  return sliceByRange(h, chartRange);
}
function shortVolume(value) {
  if (!value) return '—';
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (value >= 1e4) return `${Math.round(value / 1e4)}만`;
  return Math.round(value).toLocaleString('ko-KR');
}
function ohlcLegend(history, i, item) {
  const o = history.open[i], h = history.high[i], l = history.low[i], c = history.close[i];
  const prev = i ? history.close[i - 1] : o, chg = c - prev, pctv = prev ? chg / prev * 100 : 0, up = chg >= 0;
  const cur = item.currency || 'USD';
  return `<span class="tvl-date">${esc(history.dates[i])}</span><span>시 <b>${money(o,cur)}</b></span><span>고 <b>${money(h,cur)}</b></span><span>저 <b>${money(l,cur)}</b></span><span>종 <b>${money(c,cur)}</b></span><span>거래량 <b>${shortVolume(history.volume[i])}</b></span><span class="${up?'cs-up':'cs-down'}">${up?'+':''}${axisNum(chg)} (${up?'+':''}${pctv.toFixed(2)}%)</span>`;
}
function tvChart(history, item, D) {
  const n = history.close.length;
  if (!n) return '<p class="empty-note">차트 데이터가 없습니다.</p>';
  const right = D.W - D.padR;
  const highs = history.high.map((v, i) => v ?? history.close[i]), lows = history.low.map((v, i) => v ?? history.close[i]);
  const { ticks, niceMin, niceMax } = niceTicks(Math.min(...lows), Math.max(...highs), 5);
  const range = niceMax - niceMin || 1, y = v => D.top + D.priceH - (v - niceMin) / range * D.priceH;
  const step = right / n, x = i => step * i + step / 2, bw = Math.max(1, Math.min(step * .7, 13));
  const maxVol = Math.max(...history.volume.map(v => v || 0), 1);
  let candles = '', vols = '';
  history.close.forEach((c, i) => {
    const o = history.open[i], h = history.high[i], l = history.low[i];
    if ([o, h, l, c].some(v => v == null)) return;
    const st = c >= o ? 'cs-up' : 'cs-down', bt = y(Math.max(o, c)), bb = y(Math.min(o, c));
    candles += `<g class="${st}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(h)}" y2="${y(l)}" stroke="currentColor" stroke-width="1"/><rect x="${x(i)-bw/2}" y="${bt}" width="${bw}" height="${Math.max(bb-bt,1)}" fill="currentColor"/></g>`;
    const vy = D.volBottom - ((history.volume[i]||0)/maxVol)*(D.volBottom-D.volTop);
    vols += `<rect class="${st}" x="${x(i)-bw/2}" y="${vy}" width="${bw}" height="${D.volBottom-vy}" fill="currentColor" opacity=".2"/>`;
  });
  const grid = ticks.map(v => `<line x1="0" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="research-grid"/><text x="${right+7}" y="${y(v)+4}" class="research-axis">${axisNum(v)}</text>`).join('');
  const spanDays = (parseBarDate(history.dates[n-1]) - parseBarDate(history.dates[0])) / 864e5;
  const timeMode = history.dates[0].includes(' ') && spanDays <= 3;
  const fmtX = label => { const d = parseBarDate(label); return timeMode ? `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}` : `${d.getUTCMonth()+1}.${d.getUTCDate()}`; };
  const cnt = Math.min(6, n);
  const xLabels = Array.from({ length: cnt }, (_, k) => { const i = Math.round(k*(n-1)/Math.max(cnt-1,1)); return `<text x="${x(i)}" y="${D.H-4}" class="research-axis" text-anchor="middle">${fmtX(history.dates[i])}</text>`; }).join('');
  const last = n-1, lastUp = history.close[last] >= history.open[last], lastY = y(history.close[last]);
  return `<div class="tv-legend">${ohlcLegend(history, last, item)}</div><div class="research-chart"><svg viewBox="0 0 ${D.W} ${D.H}" class="axis-chart research-axis-chart" preserveAspectRatio="none" aria-label="캔들 차트">${grid}<line x1="0" x2="${right}" y1="${lastY}" y2="${lastY}" class="last-price ${lastUp?'cs-up':'cs-down'}"/>${candles}<line x1="0" x2="${right}" y1="${D.volBottom}" y2="${D.volBottom}" class="research-volume-line"/>${vols}${xLabels}<line class="hover-crosshair" x1="0" x2="0" y1="${D.top}" y2="${D.volBottom}" hidden/></svg></div>`;
}
const CHART_DIMS = { W: 720, H: 300, padR: 62, top: 12, priceH: 196, volTop: 236, volBottom: 280 };
const MODAL_DIMS = { W: 1040, H: 520, padR: 70, top: 14, priceH: 360, volTop: 430, volBottom: 500 };
function bindChart(root, history, item, D) {
  const svg = $('.research-axis-chart', root), legend = $('.tv-legend', root), crosshair = $('.hover-crosshair', root);
  if (!svg || !crosshair) return;
  const step = (D.W - D.padR) / history.close.length;
  svg.addEventListener('mouseleave', () => { crosshair.hidden = true; if (legend) legend.innerHTML = ohlcLegend(history, history.close.length - 1, item); });
  svg.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(history.close.length - 1, Math.floor((e.clientX - rect.left) / rect.width * D.W / step)));
    const cx = step * i + step / 2;
    crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx); crosshair.hidden = false;
    if (legend) legend.innerHTML = ohlcLegend(history, i, item);
  });
}
async function renderChart() {
  const item = chartItem;
  if (!item) return;
  $('#chart-title').textContent = `${item.name}${item.symbol && item.symbol !== item.name ? ' · ' + item.symbol : ''}`;
  const panel = $('#chart-panel');
  let base;
  try { base = await fetchChartHistory(item); } catch { base = null; }
  if (chartItem !== item) return;              // superseded by a newer selection
  if (!base) { panel.innerHTML = '<p class="empty-note">이 자산은 차트 데이터를 표시할 수 없습니다.</p>'; chartRendered = null; return; }
  const history = processHistory(base);
  chartRendered = { history, item };
  panel.innerHTML = tvChart(history, item, CHART_DIMS);
  bindChart(panel, history, item, CHART_DIMS);
}
function setChart(item) {
  if (!item) return;
  chartItem = item;
  if (item.history?.close?.length > 1) chartCache.set(`${itemKey(item)}:1d`, item.history);  // seed embedded stock daily
  $('#chart-panel').innerHTML = '<p class="empty-note">불러오는 중…</p>';
  renderChart();
}
const chartWithHistory = setChart;
$$('#chart-range-toggle button').forEach(b => b.onclick = () => { chartRange = b.dataset.range; $$('#chart-range-toggle button').forEach(x => x.classList.toggle('active', x === b)); renderChart(); });
$$('#chart-interval-toggle button').forEach(b => b.onclick = () => { chartInterval = b.dataset.interval; $$('#chart-interval-toggle button').forEach(x => x.classList.toggle('active', x === b)); renderChart(); });
$('#chart-expand').onclick = () => {
  if (!chartRendered) return;
  const modal = $('#chart-modal');
  $('#chart-modal-title').textContent = `${chartRendered.item.name} · 차트`;
  $('#chart-modal-panel').innerHTML = tvChart(chartRendered.history, chartRendered.item, MODAL_DIMS);
  bindChart($('#chart-modal-panel'), chartRendered.history, chartRendered.item, MODAL_DIMS);
  modal.showModal();
};
$('#chart-modal-close').onclick = () => $('#chart-modal').close();
async function loadMarket(isRetry) { try { const d=await api('market'); marketItems=d.items; $('#market-ticker').innerHTML=d.items.map(x => x.error ? `<button type="button" class="ticker-item chart-select"><span class="ticker-name">${esc(x.name)}</span><strong>—</strong></button>` : `<button type="button" class="ticker-item chart-select"><span class="ticker-name">${esc(x.name)}</span>${pct(x.changePct)}<strong>${money(x.price,x.currency)}</strong></button>`).join(''); bindRowClicks('#market-ticker .chart-select', i=>chartWithHistory(marketItems[i])); $('#global-status').textContent='갱신됨 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}); } catch(e) { fail('#market-ticker',e,isRetry?null:()=>loadMarket(true)); } }
async function loadStocks(isRetry) { const symbols=activeMarket === 'kr' ? await krWatchlistSymbols() : settings.stocksUS; try { const d=await api('stocks?symbols='+encodeURIComponent(symbols.join(','))); $('#stock-rows').innerHTML=d.items.map(x=>`<button class="stock-row chart-select" data-symbol="${esc(x.symbol)}"><span class="stock-name">${esc(x.name)}<small>${esc(x.symbol)}</small></span><span class="price">${money(x.price,x.currency)}</span><span class="change">${pct(x.changePct)}</span><span class="marketcap">${x.marketCapText || marketCap(x.marketCap,x.currency)}</span></button>`).join(''); $$('.stock-row').forEach((row,i)=>row.onclick=()=>setChart(d.items[i])); if (!chartItem && d.items[0]) setChart(d.items[0]); updateTime('#stocks-updated'); } catch(e) { fail('#stock-rows',e,isRetry?null:()=>loadStocks(true)); } }
function mentionRow(x, i) { return `<div class="coin-row chart-select" role="button" tabindex="0" data-index="${i}"><span class="coin-rank">${x.mentions ?? '—'}</span><span class="coin-name"><img src="${esc(x.image)}" alt=""><span>${esc(x.name)}<small>${esc(x.symbol)}</small></span>${gmgnIcon(x.gmgn)}${xSearchIcon(x.x_search)}${teleIcon(x.sample_link)}</span><span class="coin-price">${money(x.price)}</span><span class="change">${pct(x.change24)}</span><span class="marketcap">${marketCap(x.marketCap)}</span></div>`; }
function renderMeme() {
  if (activeChain === 'mentions') {
    const items = mentionsData?.items || [];
    $('.meme-card h2').textContent = '밈코인 가격 보드 · 텔레그램 언급';
    $('.meme-card').classList.remove('alert');
    $('.meme-table-head span:first-child').textContent = '언급';
    $('#meme-rows').innerHTML = items.length ? items.map(mentionRow).join('') : '<p class="empty-note">아직 수집된 언급 데이터가 없습니다.</p>';
    bindRowClicks('#meme-rows .chart-select', i => chartWithHistory(items[i]));
    return;
  }
  $('.meme-table-head span:first-child').textContent = '#';
  if (!memeData) return;
  let items=memeData.items, chainLabel='GMGN 전체 TOP 80';
  if(activeChain==='radar'){ items=memeData.radar || []; chainLabel='급등 레이더'; }
  else if(activeChain !== 'all'){ const found=memeData.chains.find(x=>x.id===activeChain); items=found?.items || []; chainLabel=found?.name || activeChain; }
  $('.meme-card h2').textContent=`밈코인 가격 보드 · ${chainLabel}`;
  const alert=items.some(x=>Math.abs(x.change24)>=15); $('.meme-card').classList.toggle('alert',alert);
  $('#meme-rows').innerHTML=items.map((x,i)=>`<div class="coin-row chart-select" role="button" tabindex="0" data-index="${i}"><span class="coin-rank">${x.rank || i+1}</span><span class="coin-name"><img src="${esc(x.image)}" alt=""><span>${esc(x.name)}<small>${esc(x.symbol)}</small></span>${gmgnIcon(x.gmgn)}</span><span class="coin-price">${money(x.price)}</span><span class="change">${pct(x.change24)}</span><span class="marketcap">${marketCap(x.marketCap)}</span></div>`).join('');
  bindRowClicks('#meme-rows .chart-select', i=>chartWithHistory(items[i]));
}
async function loadMemeMentions(isRetry) {
  try { mentionsData = await api('meme-mentions'); if (activeChain === 'mentions') renderMeme(); }
  catch(e) { if (activeChain === 'mentions') fail('#meme-rows', e, isRetry ? null : () => loadMemeMentions(true)); }
}
async function loadMeme(isRetry) {
  try {
    memeData=await api('meme-chains');
    const tabs=$('#meme-chain-tabs');
    tabs.innerHTML=`<button data-chain="mentions">텔레그램 언급</button><button data-chain="all">GMGN 전체 TOP 80</button><button data-chain="radar">급등 레이더</button>${memeData.chains.map(c=>`<button data-chain="${esc(c.id)}">${esc(c.name)} <small>${c.count}</small></button>`).join('')}`;
    $$('button',tabs).forEach(b=>{b.classList.toggle('active',b.dataset.chain===activeChain);b.onclick=()=>{activeChain=b.dataset.chain;$$('button',tabs).forEach(x=>x.classList.toggle('active',x===b));renderMeme();};});
    renderMeme();
    updateTime('#meme-updated');
  } catch(e) { fail('#meme-rows',e,isRetry?null:()=>loadMeme(true)); }
  loadMemeMentions();
}
function renderRanking() { const items=[...rankingItems].sort((a,b)=>{ const av=a[rankSort.field],bv=b[rankSort.field]; const result=typeof av==='string'?av.localeCompare(bv):((av??0)-(bv??0)); return rankSort.asc?result:-result; }); $('#rank-rows').innerHTML=items.map((x,i)=>`<div class="rank-row chart-select" role="button" tabindex="0"><span class="coin-rank">${x.rank}</span><span class="coin-name"><img src="${esc(x.image)}" alt=""><span>${esc(x.name)}<small>${esc(x.symbol)}</small></span>${xIcon(x.twitter)}</span><span class="coin-price">${money(x.price)}</span><span class="change">${pct(x.change24)}</span><span class="marketcap">${marketCap(x.marketCap)}</span></div>`).join(''); bindRowClicks('#rank-rows .chart-select', i=>chartWithHistory(items[i])); $$('.rank-table-head button').forEach(b=>b.classList.toggle('sorted',b.dataset.sort===rankSort.field)); }
async function loadRanking(isRetry) { try { const d=await api(`coins?category=${activeCategory}&limit=20`); rankingItems=d.items; renderRanking(); updateTime('#ranking-updated'); } catch(e) { fail('#rank-rows',e,isRetry?null:()=>loadRanking(true)); } }
function relative(pub) { const h=Math.max(0,Math.round((Date.now()-new Date(pub))/36e5)); return h<1?'방금 전':h<24?`${h}시간 전`:`${Math.round(h/24)}일 전`; }
const IMPORTANT_NEWS_RE = /(실적|공시|수주|유상증자|자사주|인수합병|급등|급락)/;
async function loadNews(kind,id,timeId,isRetry) { try { const d=await api('news?kind='+kind); $(id).innerHTML=d.items.map(x=>`<a class="news-row" href="${esc(x.url)}" target="_blank" rel="noopener"><div class="news-title">${kind==='stocks'&&IMPORTANT_NEWS_RE.test(x.title)?'<span class="badge-important">주요</span>':''}${esc(x.title)}</div><div class="news-meta"><span>${esc(x.source)}</span><span>·</span><span>${relative(x.published)}</span></div></a>`).join(''); updateTime(timeId); } catch(e) { fail(id,e,isRetry?null:()=>loadNews(kind,id,timeId,true)); } }
async function loadFear() { try { const d=await api('fear-greed'); $('#gauge-fill').parentElement.style.setProperty('--value',d.value); $('#fear-value').textContent=d.value; $('#fear-label').textContent=d.label; } catch(e) { $('#fear-label').textContent='지수 연결 실패'; } }

function kstToday() { const d = new Date(Date.now() + 9*36e5); return { date: d.toISOString().slice(0,10), weekday: ['sun','mon','tue','wed','thu','fri','sat'][d.getUTCDay()] }; }
const airdropState = () => JSON.parse(localStorage.getItem('hub.airdrops.v1') || '{}');
const saveAirdropState = state => localStorage.setItem('hub.airdrops.v1', JSON.stringify(state));
let airdropTasks = [];
function airdropDday(deadline) {
  if (!deadline) return '';
  const diff = Math.round((new Date(deadline) - new Date(kstToday().date)) / 86400000);
  if (diff < 0) return '<span class="dday over">마감</span>';
  return `<span class="dday">${diff === 0 ? 'D-DAY' : 'D-' + diff}</span>`;
}
function renderAirdrops() {
  const { date: today, weekday } = kstToday();
  const state = airdropState();
  const isDone = t => state[t.id]?.date === today && state[t.id]?.done;
  const todays = airdropTasks.filter(t => t.active !== false && (!t.deadline || t.deadline >= today)
    && (t.cycle === 'daily' || t.cycle === `weekly:${weekday}`));
  if (!todays.length) { $('#airdrop-list').innerHTML = '<p class="empty-note">오늘 해당하는 태스크가 없습니다.</p>'; return; }
  const doneCount = todays.filter(isDone).length;
  const sorted = [...todays].sort((a, b) => isDone(a) - isDone(b));
  $('#airdrop-list').innerHTML = `<div class="airdrop-progress">${doneCount}/${todays.length} 완료</div><div class="airdrop-rows">${sorted.map(t => `<label class="airdrop-row${isDone(t) ? ' done' : ''}"><input type="checkbox" data-id="${esc(t.id)}" ${isDone(t) ? 'checked' : ''}><span class="airdrop-name">${esc(t.name)}${t.memo ? `<small>${esc(t.memo)}</small>` : ''}</span>${airdropDday(t.deadline)}${t.url ? `<a class="link-icon" href="${esc(t.url)}" target="_blank" rel="noopener" title="바로가기" onclick="event.stopPropagation()">↗</a>` : ''}</label>`).join('')}</div>`;
  $$('#airdrop-list input[type=checkbox]').forEach(box => box.onchange = () => {
    const s = airdropState();
    s[box.dataset.id] = { date: today, done: box.checked };
    saveAirdropState(s);
    renderAirdrops();
  });
}
async function loadAirdrops(isRetry) { try { const d = await (await fetch('/data/airdrops.json')).json(); airdropTasks = d.tasks || []; renderAirdrops(); updateTime('#airdrop-updated'); } catch(e) { fail('#airdrop-list', e, isRetry ? null : () => loadAirdrops(true)); } }

let briefingData = null, briefSort = 'hot';
function showTgView(link) {
  const src = link + '?embed=1' + (settings.theme === 'light' ? '' : '&dark=1');
  $('#tgview-panel').innerHTML = `<iframe class="tg-embed" src="${esc(src)}" loading="lazy" title="텔레그램 원문"></iframe>`;
  $('#tgview-updated').textContent = link.replace('https://t.me/', '');
}
const briefRow = h => `<div class="news-row brief-row" role="button" tabindex="0" data-link="${esc(h.link)}"><div class="news-title">${esc(h.text)}</div><div class="news-meta"><span>${esc(h.channel || '')}</span><span>·</span><span>${relative(h.ts)}</span>${h.cluster_size > 1 ? `<span class="brief-cluster">${h.cluster_size}건 언급</span>` : ''}<a class="link-icon" href="${esc(h.link)}" target="_blank" rel="noopener" title="t.me에서 열기" onclick="event.stopPropagation()">↗</a></div></div>`;
function bindBriefRows(root) { $$('.brief-row', root).forEach(row => { const open = () => showTgView(row.dataset.link); row.onclick = open; row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }; }); }
function renderBriefing() {
  const brief = briefingData?.crypto_brief || {};
  const highlights = [...(brief.highlights || [])].sort((a, b) => briefSort === 'hot'
    ? (b.cluster_size || 0) - (a.cluster_size || 0) || new Date(b.ts) - new Date(a.ts)
    : new Date(b.ts) - new Date(a.ts)).slice(0, 8);
  $('#brief-list').innerHTML = highlights.length ? highlights.map(briefRow).join('') : '<p class="empty-note">아직 수집된 브리핑이 없습니다.</p>';
  bindBriefRows($('#brief-list'));
}
function renderBriefRaw() {
  const byChannel = briefingData?.crypto_brief?.raw_by_channel || {};
  const channels = Object.keys(byChannel);
  $('#brief-raw').innerHTML = channels.length ? channels.map(ch => `<div class="brief-channel"><h4>${esc(ch)}</h4>${byChannel[ch].map(m => briefRow({ ...m, channel: ch })).join('')}</div>`).join('') : '<p class="empty-note">채널별 원문이 없습니다.</p>';
  bindBriefRows($('#brief-raw'));
}
async function loadBriefing(isRetry) {
  try {
    briefingData = await (await fetch('/data/briefing.json')).json();
    renderBriefing();
    if (!$('#brief-raw').hidden) renderBriefRaw();
    $('#brief-toggle-raw').hidden = Object.keys(briefingData.crypto_brief?.raw_by_channel || {}).length === 0;
    $('#brief-updated').textContent = briefingData.generated_at ? relative(briefingData.generated_at) : '—';
  } catch(e) { fail('#brief-list', e, isRetry ? null : () => loadBriefing(true)); }
}
$$('#brief-sort-tabs button').forEach(b => b.onclick = () => { briefSort = b.dataset.sort; $$('#brief-sort-tabs button').forEach(x => x.classList.toggle('active', x === b)); renderBriefing(); });
$('#brief-toggle-raw').onclick = () => { const raw = $('#brief-raw'), willShow = raw.hidden; if (willShow) renderBriefRaw(); raw.hidden = !willShow; $('#brief-toggle-raw').textContent = willShow ? '채널별 전체 보기 접기' : '채널별 전체 보기'; };

let promptItems = [];
function renderPrompts() {
  if (!promptItems.length) { $('#prompt-list').innerHTML = '<p class="empty-note">아직 수집된 프롬프트 소스가 없습니다.</p>'; return; }
  $('#prompt-list').innerHTML = promptItems.map(p => `<a class="news-row" href="${esc(p.link)}" target="_blank" rel="noopener"><div class="news-title">${esc(p.title)}</div><div class="news-meta"><span>${p.source === 'reddit' ? 'Reddit' : '텔레그램'}</span><span>·</span><span>${relative(typeof p.ts === 'number' ? p.ts * 1000 : p.ts)}</span>${p.upvotes ? `<span>· ▲${p.upvotes}</span>` : ''}</div></a>`).join('');
}
async function loadPrompts(isRetry) {
  try { const d = await (await fetch('/data/briefing.json')).json(); promptItems = d.prompt_sources?.items || []; renderPrompts(); $('#prompt-updated').textContent = d.generated_at ? relative(d.generated_at) : '—'; }
  catch(e) { fail('#prompt-list', e, isRetry ? null : () => loadPrompts(true)); }
}

function loadAll() { loadMarket();loadStocks();loadMeme();loadRanking();loadNews('stocks','#stocks-news','#stocks-news-updated');loadNews('world','#world-news','#world-news-updated');loadNews('crypto','#crypto-news','#crypto-news-updated');loadFear();loadAirdrops();loadBriefing();loadPrompts(); }
$$('.stock-tab').forEach(b=>b.onclick=()=>{activeMarket=b.dataset.market;$$('.stock-tab').forEach(x=>x.classList.toggle('active',x===b));loadStocks()});$$('.category-tabs button').forEach(b=>b.onclick=()=>{activeCategory=b.dataset.category;$$('.category-tabs button').forEach(x=>x.classList.toggle('active',x===b));loadRanking()});$$('.rank-table-head button').forEach(b=>b.onclick=()=>{rankSort.asc=rankSort.field===b.dataset.sort?!rankSort.asc:false;rankSort.field=b.dataset.sort;renderRanking()});
$('#refresh-all').onclick=loadAll; $$('.refresh').forEach(b=>b.onclick=()=>({stocks:loadStocks,meme:loadMeme,ranking:loadRanking,'stocks-news':()=>loadNews('stocks','#stocks-news','#stocks-news-updated'),'crypto-news':()=>{loadNews('crypto','#crypto-news','#crypto-news-updated');loadFear()},'world-news':()=>loadNews('world','#world-news','#world-news-updated'),airdrops:loadAirdrops,brief:loadBriefing,prompts:loadPrompts}[b.dataset.target]()));
const dialog=$('#settings'); $('#open-settings').onclick=()=>{ $('#theme').value=settings.theme;$('#color-mode').value=settings.colorMode;$('#stocks-kr').value=settings.stocksKR.join(', ');$('#stocks-us').value=settings.stocksUS.join(', ');$('#stock-search').value='';$('#stock-search-results').innerHTML='';dialog.showModal();};$('#add-stock').onclick=()=>$('#open-settings').click(); $$('dialog [value="cancel"]').forEach(b=>b.onclick=()=>dialog.close()); $('#save-settings').onclick=()=>{settings.theme=$('#theme').value;settings.colorMode=$('#color-mode').value;settings.stocksKR=$('#stocks-kr').value.split(',').map(x=>x.trim()).filter(Boolean);settings.stocksUS=$('#stocks-us').value.split(',').map(x=>x.trim()).filter(Boolean);localStorage.setItem('hub.settings.v1',JSON.stringify(settings));applySettings();loadStocks();};
let searchTimer; $('#stock-search').oninput=e=>{clearTimeout(searchTimer);const q=e.target.value.trim();if(q.length<2){$('#stock-search-results').innerHTML='';return;}searchTimer=setTimeout(async()=>{try{const d=await api('search-stocks?q='+encodeURIComponent(q));$('#stock-search-results').innerHTML=d.items.map(x=>`<button type="button" data-symbol="${x.symbol}" data-exchange="${x.exchange}"><b>${x.name}</b><span>${x.symbol} · ${x.exchange}</span></button>`).join('')||'<p>검색 결과가 없습니다.</p>';$$('#stock-search-results button').forEach(b=>b.onclick=()=>{const domestic=/Korea|KOSDAQ|Korea Stock/i.test(b.dataset.exchange)||/\.(KS|KQ)$/i.test(b.dataset.symbol);const field=$(domestic?'#stocks-kr':'#stocks-us');const symbols=field.value.split(',').map(x=>x.trim()).filter(Boolean);if(!symbols.includes(b.dataset.symbol))symbols.push(b.dataset.symbol);field.value=symbols.join(', ');$('#stock-search').value='';$('#stock-search-results').innerHTML='';});}catch{ $('#stock-search-results').innerHTML='<p>검색에 실패했습니다.</p>'; }},250);};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadAll()});applySettings();loadAll();setInterval(()=>{if(!document.hidden){loadMarket();loadMeme();loadStocks()}},60000);setInterval(()=>{if(!document.hidden){loadRanking();loadNews('stocks','#stocks-news','#stocks-news-updated');loadNews('world','#world-news','#world-news-updated');loadNews('crypto','#crypto-news','#crypto-news-updated')}},300000);
