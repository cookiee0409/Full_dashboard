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

function aggregateChartHistory(history) {
  if (chartInterval === 'day') return history;
  const grouped = new Map();
  history.dates.forEach((date, i) => {
    const d = new Date(`${date}T00:00:00Z`);
    const key = chartInterval === 'week'
      ? `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 604800000)}`
      : `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const current = grouped.get(key);
    const bar = { date, open: history.open[i], high: history.high[i], low: history.low[i], close: history.close[i], volume: history.volume[i] || 0 };
    if (!current) grouped.set(key, bar);
    else {
      current.high = Math.max(current.high ?? current.close, bar.high ?? bar.close);
      current.low = Math.min(current.low ?? current.close, bar.low ?? bar.close);
      current.close = bar.close;
      current.volume += bar.volume;
      current.date = date;
    }
  });
  const bars = [...grouped.values()];
  return { dates: bars.map(x => x.date), open: bars.map(x => x.open), high: bars.map(x => x.high), low: bars.map(x => x.low), close: bars.map(x => x.close), volume: bars.map(x => x.volume) };
}

function researchHistory(history) {
  const source = aggregateChartHistory(history);
  if (chartRange === 'all') return source;
  const days = { '1m': 31, '3m': 93, '6m': 186 }[chartRange] || 93;
  const end = new Date(`${source.dates.at(-1)}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - days);
  const start = Math.max(0, source.dates.findIndex(date => new Date(`${date}T00:00:00Z`) >= end));
  const slice = key => source[key].slice(start);
  return { dates: slice('dates'), open: slice('open'), high: slice('high'), low: slice('low'), close: slice('close'), volume: slice('volume') };
}

function shortVolume(value) {
  if (!value) return '—';
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (value >= 1e4) return `${Math.round(value / 1e4)}만`;
  return Math.round(value).toLocaleString('ko-KR');
}

function researchCandleChart(history) {
  const W = 680, H = 262, padR = 58, top = 10, priceH = 164, volumeTop = 198, volumeBottom = 240;
  const n = history.close.length;
  if (!n) return '<p class="empty-note">차트 데이터가 없습니다.</p>';
  const right = W - padR, highs = history.high.map((v, i) => v ?? history.close[i]), lows = history.low.map((v, i) => v ?? history.close[i]);
  const { ticks, niceMin, niceMax } = niceTicks(Math.min(...lows), Math.max(...highs), 4);
  const range = niceMax - niceMin || 1, y = value => top + priceH - (value - niceMin) / range * priceH;
  const step = right / n, x = index => step * index + step / 2, bodyW = Math.max(1.4, Math.min(step * .62, 14));
  const maxVolume = Math.max(...history.volume.map(v => v || 0), 1);
  let candles = '', volumes = '';
  history.close.forEach((close, i) => {
    const open = history.open[i], high = history.high[i], low = history.low[i];
    if ([open, high, low, close].some(value => value == null)) return;
    const state = close >= open ? 'cs-up' : 'cs-down';
    const bodyTop = y(Math.max(open, close)), bodyBottom = y(Math.min(open, close));
    candles += `<g class="${state}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(high)}" y2="${y(low)}" stroke="currentColor" stroke-width="1.25"/><rect x="${x(i) - bodyW / 2}" y="${bodyTop}" width="${bodyW}" height="${Math.max(bodyBottom - bodyTop, 1.4)}" rx="1" fill="currentColor"/></g>`;
    const volumeY = volumeBottom - ((history.volume[i] || 0) / maxVolume) * (volumeBottom - volumeTop);
    volumes += `<rect class="${state}" x="${x(i) - bodyW / 2}" y="${volumeY}" width="${bodyW}" height="${volumeBottom - volumeY}" fill="currentColor" opacity=".19"/>`;
  });
  const grid = ticks.map(value => `<line x1="0" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="research-grid"/><text x="${right + 7}" y="${y(value) + 4}" class="research-axis">${axisNum(value)}</text>`).join('');
  const xLabels = Array.from({ length: Math.min(6, n) }, (_, k) => {
    const index = Math.round(k * (n - 1) / Math.max(Math.min(6, n) - 1, 1));
    return `<text x="${x(index)}" y="258" class="research-axis" text-anchor="middle">${fmtDate(history.dates[index])}</text>`;
  }).join('');
  const last = n - 1, lastUp = history.close[last] >= history.open[last], lastY = y(history.close[last]);
  return `<div class="research-chart"><div class="chart-tooltip" hidden></div><svg viewBox="0 0 ${W} ${H}" class="axis-chart research-axis-chart" preserveAspectRatio="none" aria-label="캔들스틱 가격 차트">${grid}<line x1="0" x2="${right}" y1="${lastY}" y2="${lastY}" class="last-price ${lastUp ? 'cs-up' : 'cs-down'}"/>${candles}<line x1="0" x2="${right}" y1="${volumeBottom}" y2="${volumeBottom}" class="research-volume-line"/>${volumes}${xLabels}<line class="hover-crosshair" x1="0" x2="0" y1="${top}" y2="${volumeBottom}" hidden/></svg></div>`;
}

function bindResearchChart(root, history, item) {
  const wrap = $('.research-chart', root), svg = $('.research-axis-chart', root), tooltip = $('.chart-tooltip', root), crosshair = $('.hover-crosshair', root);
  if (!wrap || !svg || !tooltip || !crosshair) return;
  const W = 680, right = 622, step = right / history.close.length;
  const hide = () => { tooltip.hidden = true; crosshair.hidden = true; };
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('mousemove', event => {
    const rect = svg.getBoundingClientRect();
    const point = (event.clientX - rect.left) / rect.width * W;
    const index = Math.max(0, Math.min(history.close.length - 1, Math.floor(point / step)));
    const cx = step * index + step / 2;
    crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx); crosshair.hidden = false;
    const previous = index ? history.close[index - 1] : history.open[index];
    const change = previous ? (history.close[index] - previous) / previous * 100 : 0;
    tooltip.innerHTML = `<strong>${history.dates[index]}</strong><span>시가 ${money(history.open[index], item.currency || 'USD')}</span><span>고가 ${money(history.high[index], item.currency || 'USD')}</span><span>저가 ${money(history.low[index], item.currency || 'USD')}</span><span>종가 ${money(history.close[index], item.currency || 'USD')} <b class="${change >= 0 ? 'up' : 'down'}">(${change >= 0 ? '+' : ''}${change.toFixed(2)}%)</b></span><span>거래량 ${shortVolume(history.volume[index])}</span>`;
    tooltip.style.left = `${Math.max(2, Math.min(72, (cx / W) * 100 + 2))}%`;
    tooltip.hidden = false;
  });
}
function setChart(item) {
  if (!item) return;
  chartItem = item;
  $('#chart-title').textContent = `${item.name} · ${item.symbol}`;
  $('#chart-title').textContent = '주가 차트';
  const hasHistory = item.history?.close?.length > 1;
  $('#chart-range-toggle').style.display = hasHistory ? '' : 'none';
  let body, summaryPct;
  if (hasHistory) {
    const history = researchHistory(item.history);
    body = researchCandleChart(history);
    summaryPct = item.changePct;
  } else if (item.spark?.length > 1) {
    body = lineChartWithAxes(item.spark);
    summaryPct = item.changePct ?? item.change24 ?? ((item.spark.at(-1)-item.spark[0])/item.spark[0]*100);
  } else {
    $('#chart-panel').innerHTML = '<p class="empty-note">이 종목은 차트를 표시할 데이터가 없습니다.</p>';
    return;
  }
  $('#chart-panel').innerHTML = body;
  if (hasHistory) bindResearchChart($('#chart-panel'), researchHistory(item.history), item);
}
$$('#chart-range-toggle button').forEach(b => b.onclick = () => { chartRange = b.dataset.range; $$('#chart-range-toggle button').forEach(x => x.classList.toggle('active', x === b)); if (chartItem) setChart(chartItem); });
$$('#chart-interval-toggle button').forEach(b => b.onclick = () => { chartInterval = b.dataset.interval; $$('#chart-interval-toggle button').forEach(x => x.classList.toggle('active', x === b)); if (chartItem) setChart(chartItem); });
$('#chart-expand').onclick = () => {
  if (!chartItem?.history?.close?.length) return;
  const modal = $('#chart-modal'), history = researchHistory(chartItem.history);
  $('#chart-modal-title').textContent = `${chartItem.name} · 주가 차트`;
  $('#chart-modal-panel').innerHTML = researchCandleChart(history);
  bindResearchChart($('#chart-modal-panel'), history, chartItem);
  modal.showModal();
};
$('#chart-modal-close').onclick = () => $('#chart-modal').close();
async function loadMarket(isRetry) { try { const d=await api('market'); marketItems=d.items; $('#market-ticker').innerHTML=d.items.map(x => x.error ? `<button type="button" class="ticker-item chart-select"><span class="ticker-name">${esc(x.name)}</span><strong>—</strong></button>` : `<button type="button" class="ticker-item chart-select"><span class="ticker-name">${esc(x.name)}</span>${pct(x.changePct)}<strong>${money(x.price,x.currency)}</strong></button>`).join(''); bindRowClicks('#market-ticker .chart-select', i=>setChart(marketItems[i])); $('#global-status').textContent='갱신됨 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}); } catch(e) { fail('#market-ticker',e,isRetry?null:()=>loadMarket(true)); } }
async function loadStocks(isRetry) { const symbols=activeMarket === 'kr' ? await krWatchlistSymbols() : settings.stocksUS; try { const d=await api('stocks?symbols='+encodeURIComponent(symbols.join(','))); $('#stock-rows').innerHTML=d.items.map(x=>`<button class="stock-row chart-select" data-symbol="${esc(x.symbol)}"><span class="stock-name">${esc(x.name)}<small>${esc(x.symbol)}</small></span><span class="price">${money(x.price,x.currency)}</span><span class="change">${pct(x.changePct)}</span><span class="marketcap">${x.marketCapText || marketCap(x.marketCap,x.currency)}</span></button>`).join(''); $$('.stock-row').forEach((row,i)=>row.onclick=()=>setChart(d.items[i])); if (!chartItem && d.items[0]) setChart(d.items[0]); updateTime('#stocks-updated'); } catch(e) { fail('#stock-rows',e,isRetry?null:()=>loadStocks(true)); } }
function mentionRow(x, i) { return `<div class="coin-row chart-select" role="button" tabindex="0" data-index="${i}"><span class="coin-rank">${x.mentions ?? '—'}</span><span class="coin-name"><img src="${esc(x.image)}" alt=""><span>${esc(x.name)}<small>${esc(x.symbol)}</small></span>${gmgnIcon(x.gmgn)}${xSearchIcon(x.x_search)}${teleIcon(x.sample_link)}</span><span class="coin-price">${money(x.price)}</span><span class="change">${pct(x.change24)}</span><span class="marketcap">${marketCap(x.marketCap)}</span></div>`; }
function renderMeme() {
  if (activeChain === 'mentions') {
    const items = mentionsData?.items || [];
    $('.meme-card h2').textContent = '밈코인 가격 보드 · 텔레그램 언급';
    $('.meme-card').classList.remove('alert');
    $('.meme-table-head span:first-child').textContent = '언급';
    $('#meme-rows').innerHTML = items.length ? items.map(mentionRow).join('') : '<p class="empty-note">아직 수집된 언급 데이터가 없습니다.</p>';
    bindRowClicks('#meme-rows .chart-select', i => setChart(items[i]));
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
  bindRowClicks('#meme-rows .chart-select', i=>setChart(items[i]));
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
function renderRanking() { const items=[...rankingItems].sort((a,b)=>{ const av=a[rankSort.field],bv=b[rankSort.field]; const result=typeof av==='string'?av.localeCompare(bv):((av??0)-(bv??0)); return rankSort.asc?result:-result; }); $('#rank-rows').innerHTML=items.map((x,i)=>`<div class="rank-row chart-select" role="button" tabindex="0"><span class="coin-rank">${x.rank}</span><span class="coin-name"><img src="${esc(x.image)}" alt=""><span>${esc(x.name)}<small>${esc(x.symbol)}</small></span>${xIcon(x.twitter)}</span><span class="coin-price">${money(x.price)}</span><span class="change">${pct(x.change24)}</span><span class="marketcap">${marketCap(x.marketCap)}</span></div>`).join(''); bindRowClicks('#rank-rows .chart-select', i=>setChart(items[i])); $$('.rank-table-head button').forEach(b=>b.classList.toggle('sorted',b.dataset.sort===rankSort.field)); }
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

let briefingData = null;
function renderBriefRaw() {
  const byChannel = briefingData?.crypto_brief?.raw_by_channel || {};
  const channels = Object.keys(byChannel);
  $('#brief-raw').innerHTML = channels.length ? channels.map(ch => `<div class="brief-channel"><h4>${esc(ch)}</h4>${byChannel[ch].map(m => `<a class="news-row" href="${esc(m.link)}" target="_blank" rel="noopener"><div class="news-title">${esc(m.text)}</div><div class="news-meta"><span>${relative(m.ts)}</span></div></a>`).join('')}</div>`).join('') : '<p class="empty-note">채널별 원문이 없습니다.</p>';
}
async function loadBriefing(isRetry) {
  try {
    briefingData = await (await fetch('/data/briefing.json')).json();
    const brief = briefingData.crypto_brief || {};
    const highlights = (brief.highlights || []).slice(0, 8);
    $('#brief-list').innerHTML = highlights.length ? highlights.map(h => `<a class="news-row" href="${esc(h.link)}" target="_blank" rel="noopener"><div class="news-title">${esc(h.text)}</div><div class="news-meta"><span>${esc(h.channel)}</span><span>·</span><span>${relative(h.ts)}</span>${h.cluster_size > 1 ? `<span class="brief-cluster">${h.cluster_size}건 언급</span>` : ''}</div></a>`).join('') : '<p class="empty-note">아직 수집된 브리핑이 없습니다.</p>';
    $('#brief-toggle-raw').hidden = Object.keys(brief.raw_by_channel || {}).length === 0;
    $('#brief-updated').textContent = briefingData.generated_at ? relative(briefingData.generated_at) : '—';
  } catch(e) { fail('#brief-list', e, isRetry ? null : () => loadBriefing(true)); }
}
$('#brief-toggle-raw').onclick = () => { const raw = $('#brief-raw'), willShow = raw.hidden; if (willShow) renderBriefRaw(); raw.hidden = !willShow; $('#brief-toggle-raw').textContent = willShow ? '채널별 전체 보기 접기' : '채널별 전체 보기'; };

let keywordItems = [];
const trendBadge = trend => ({ new: '<span class="trend-badge new">NEW</span>', rising: '<span class="trend-badge rising">급등</span>', steady: '<span class="trend-badge steady">유지</span>' }[trend] || '');
function keywordMarkdown(item) {
  return [`### ${item.word} (오늘 ${item.count}회 · ${item.trend})`, '', ...(item.evidence || []).map(e => `- ${e.text} (${e.link})`)].join('\n');
}
function renderKeywords() {
  if (!keywordItems.length) { $('#keyword-list').innerHTML = '<p class="empty-note">아직 수집된 키워드가 없습니다.</p>'; return; }
  $('#keyword-list').innerHTML = keywordItems.map((item, i) => `<div class="keyword-row"><div class="keyword-main"><button type="button" class="keyword-toggle" data-index="${i}"><span class="keyword-rank">${i + 1}</span><span class="keyword-word">${esc(item.word)}</span>${trendBadge(item.trend)}<span class="keyword-count">${item.count}회</span></button><button type="button" class="keyword-copy" data-index="${i}" title="블로그 재료 복사">복사</button></div><div class="keyword-evidence" hidden>${(item.evidence || []).map(e => `<a class="news-row" href="${esc(e.link)}" target="_blank" rel="noopener"><div class="news-title">${esc(e.text)}</div><div class="news-meta"><span>${e.type === 'news' ? '뉴스' : '텔레그램'}</span></div></a>`).join('') || '<p class="empty-note">근거 없음</p>'}</div></div>`).join('');
  $$('.keyword-toggle').forEach(btn => btn.onclick = () => { const ev = btn.closest('.keyword-row').querySelector('.keyword-evidence'); ev.hidden = !ev.hidden; });
  $$('.keyword-copy').forEach(btn => btn.onclick = async () => {
    try { await navigator.clipboard.writeText(keywordMarkdown(keywordItems[+btn.dataset.index])); const original = btn.textContent; btn.textContent = '복사됨'; setTimeout(() => btn.textContent = original, 1500); } catch {}
  });
}
async function loadKeywords(isRetry) {
  try { const d = await (await fetch('/data/briefing.json')).json(); keywordItems = d.keywords?.items || []; renderKeywords(); $('#keyword-updated').textContent = d.generated_at ? relative(d.generated_at) : '—'; }
  catch(e) { fail('#keyword-list', e, isRetry ? null : () => loadKeywords(true)); }
}

let promptItems = [];
function renderPrompts() {
  if (!promptItems.length) { $('#prompt-list').innerHTML = '<p class="empty-note">아직 수집된 프롬프트 소스가 없습니다.</p>'; return; }
  $('#prompt-list').innerHTML = promptItems.map(p => `<a class="news-row" href="${esc(p.link)}" target="_blank" rel="noopener"><div class="news-title">${esc(p.title)}</div><div class="news-meta"><span>${p.source === 'reddit' ? 'Reddit' : '텔레그램'}</span><span>·</span><span>${relative(typeof p.ts === 'number' ? p.ts * 1000 : p.ts)}</span>${p.upvotes ? `<span>· ▲${p.upvotes}</span>` : ''}</div></a>`).join('');
}
async function loadPrompts(isRetry) {
  try { const d = await (await fetch('/data/briefing.json')).json(); promptItems = d.prompt_sources?.items || []; renderPrompts(); $('#prompt-updated').textContent = d.generated_at ? relative(d.generated_at) : '—'; }
  catch(e) { fail('#prompt-list', e, isRetry ? null : () => loadPrompts(true)); }
}

function loadAll() { loadMarket();loadStocks();loadMeme();loadRanking();loadNews('stocks','#stocks-news','#stocks-news-updated');loadNews('world','#world-news','#world-news-updated');loadNews('crypto','#crypto-news','#crypto-news-updated');loadFear();loadAirdrops();loadBriefing();loadKeywords();loadPrompts(); }
$$('.stock-tab').forEach(b=>b.onclick=()=>{activeMarket=b.dataset.market;$$('.stock-tab').forEach(x=>x.classList.toggle('active',x===b));loadStocks()});$$('.category-tabs button').forEach(b=>b.onclick=()=>{activeCategory=b.dataset.category;$$('.category-tabs button').forEach(x=>x.classList.toggle('active',x===b));loadRanking()});$$('.rank-table-head button').forEach(b=>b.onclick=()=>{rankSort.asc=rankSort.field===b.dataset.sort?!rankSort.asc:false;rankSort.field=b.dataset.sort;renderRanking()});
$('#refresh-all').onclick=loadAll; $$('.refresh').forEach(b=>b.onclick=()=>({stocks:loadStocks,meme:loadMeme,ranking:loadRanking,'stocks-news':()=>loadNews('stocks','#stocks-news','#stocks-news-updated'),'crypto-news':()=>{loadNews('crypto','#crypto-news','#crypto-news-updated');loadFear()},'world-news':()=>loadNews('world','#world-news','#world-news-updated'),airdrops:loadAirdrops,brief:loadBriefing,keywords:loadKeywords,prompts:loadPrompts}[b.dataset.target]()));
const dialog=$('#settings'); $('#open-settings').onclick=()=>{ $('#theme').value=settings.theme;$('#color-mode').value=settings.colorMode;$('#stocks-kr').value=settings.stocksKR.join(', ');$('#stocks-us').value=settings.stocksUS.join(', ');$('#stock-search').value='';$('#stock-search-results').innerHTML='';dialog.showModal();};$('#add-stock').onclick=()=>$('#open-settings').click(); $$('dialog [value="cancel"]').forEach(b=>b.onclick=()=>dialog.close()); $('#save-settings').onclick=()=>{settings.theme=$('#theme').value;settings.colorMode=$('#color-mode').value;settings.stocksKR=$('#stocks-kr').value.split(',').map(x=>x.trim()).filter(Boolean);settings.stocksUS=$('#stocks-us').value.split(',').map(x=>x.trim()).filter(Boolean);localStorage.setItem('hub.settings.v1',JSON.stringify(settings));applySettings();loadStocks();};
let searchTimer; $('#stock-search').oninput=e=>{clearTimeout(searchTimer);const q=e.target.value.trim();if(q.length<2){$('#stock-search-results').innerHTML='';return;}searchTimer=setTimeout(async()=>{try{const d=await api('search-stocks?q='+encodeURIComponent(q));$('#stock-search-results').innerHTML=d.items.map(x=>`<button type="button" data-symbol="${x.symbol}" data-exchange="${x.exchange}"><b>${x.name}</b><span>${x.symbol} · ${x.exchange}</span></button>`).join('')||'<p>검색 결과가 없습니다.</p>';$$('#stock-search-results button').forEach(b=>b.onclick=()=>{const domestic=/Korea|KOSDAQ|Korea Stock/i.test(b.dataset.exchange)||/\.(KS|KQ)$/i.test(b.dataset.symbol);const field=$(domestic?'#stocks-kr':'#stocks-us');const symbols=field.value.split(',').map(x=>x.trim()).filter(Boolean);if(!symbols.includes(b.dataset.symbol))symbols.push(b.dataset.symbol);field.value=symbols.join(', ');$('#stock-search').value='';$('#stock-search-results').innerHTML='';});}catch{ $('#stock-search-results').innerHTML='<p>검색에 실패했습니다.</p>'; }},250);};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadAll()});applySettings();loadAll();setInterval(()=>{if(!document.hidden){loadMarket();loadMeme();loadStocks()}},60000);setInterval(()=>{if(!document.hidden){loadRanking();loadNews('stocks','#stocks-news','#stocks-news-updated');loadNews('world','#world-news','#world-news-updated');loadNews('crypto','#crypto-news','#crypto-news-updated')}},300000);
