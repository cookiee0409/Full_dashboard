const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaults = { theme:'dark', colorMode:'global', stocksKR:[], stocksUS:['^IXIC','AAPL','MSFT','NVDA','MU','TSLA'] };
const stored = JSON.parse(localStorage.getItem('hub.settings.v1') || '{}');
let settings = { ...defaults, ...stored, stocksKR: stored.stocksKR || defaults.stocksKR, stocksUS: stored.stocksUS || defaults.stocksUS };
let krTop10Symbols = null;
async function krWatchlistSymbols() { if (settings.stocksKR.length) return settings.stocksKR; if (!krTop10Symbols) { try { krTop10Symbols = (await api('kr-top10')).items.map(x=>x.symbol); } catch { krTop10Symbols = []; } } return krTop10Symbols; }
let activeMarket = 'kr', activeCategory = 'all', activeChain = 'all', rankSort = { field:'marketCap', asc:false };
let rankingItems = [], memeData = null, chartItem = null;
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
function bindRowClicks(selector, onActivate) { $$(selector).forEach((row,i)=>{ row.onclick=()=>onActivate(i); row.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onActivate(i); } }; }); }
function fail(id, error, retry) { $(id).innerHTML = `<p class="error">${esc(error.message || '데이터를 불러오지 못했습니다.')}${retry ? ' · 잠시 후 자동 재시도' : ''}</p>`; if (retry) setTimeout(retry, 18000); }
function updateTime(id) { $(id).textContent = ago(); }
function applySettings() { document.body.classList.toggle('light', settings.theme === 'light'); document.body.classList.toggle('kr-colors', settings.colorMode === 'kr'); }
let chartRange = '1m';
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
function setChart(item) {
  if (!item) return;
  chartItem = item;
  $('#chart-title').textContent = `${item.name} · ${item.symbol}`;
  const hasHistory = item.history?.close?.length > 1;
  $('#chart-range-toggle').style.display = hasHistory ? '' : 'none';
  let body, summaryPct;
  if (hasHistory) {
    body = candleChart(sliceHistory(item.history, chartRange));
    summaryPct = item.changePct;
  } else if (item.spark?.length > 1) {
    body = lineChartWithAxes(item.spark);
    summaryPct = item.changePct ?? item.change24 ?? ((item.spark.at(-1)-item.spark[0])/item.spark[0]*100);
  } else {
    $('#chart-panel').innerHTML = '<p class="empty-note">이 종목은 차트를 표시할 데이터가 없습니다.</p>';
    return;
  }
  $('#chart-panel').innerHTML = `<div class="chart-summary"><strong>${money(item.price,item.currency || 'USD')}</strong>${pct(summaryPct)}</div>${body}`;
}
$$('#chart-range-toggle button').forEach(b => b.onclick = () => { chartRange = b.dataset.range; $$('#chart-range-toggle button').forEach(x => x.classList.toggle('active', x === b)); if (chartItem) setChart(chartItem); });
async function loadMarket(isRetry) { try { const d=await api('market'); $('#market-ticker').innerHTML=d.items.map(x => x.error ? `<div class="ticker-item"><span class="ticker-name">${esc(x.name)}</span><strong>—</strong></div>` : `<div class="ticker-item"><span class="ticker-name">${esc(x.name)}</span>${pct(x.changePct)}<strong>${money(x.price,x.currency)}</strong></div>`).join(''); $('#global-status').textContent='갱신됨 '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}); } catch(e) { fail('#market-ticker',e,isRetry?null:()=>loadMarket(true)); } }
async function loadStocks(isRetry) { const symbols=activeMarket === 'kr' ? await krWatchlistSymbols() : settings.stocksUS; try { const d=await api('stocks?symbols='+encodeURIComponent(symbols.join(','))); $('#stock-rows').innerHTML=d.items.map(x=>`<button class="stock-row chart-select" data-symbol="${esc(x.symbol)}"><span class="stock-name">${esc(x.name)}<small>${esc(x.symbol)}</small></span><span class="price">${money(x.price,x.currency)}</span><span class="change">${pct(x.changePct)}</span><span class="marketcap">${x.marketCapText || marketCap(x.marketCap,x.currency)}</span></button>`).join(''); $$('.stock-row').forEach((row,i)=>row.onclick=()=>setChart(d.items[i])); if (!chartItem && d.items[0]) setChart(d.items[0]); updateTime('#stocks-updated'); } catch(e) { fail('#stock-rows',e,isRetry?null:()=>loadStocks(true)); } }
function renderMeme() { if (!memeData) return; let items=memeData.items, chainLabel='Top 30'; if(activeChain==='radar'){ items=memeData.radar || []; chainLabel='급등 레이더'; } else if(activeChain !== 'all'){ const found=memeData.chains.find(x=>x.id===activeChain); items=found?.items || []; chainLabel=found?.name || activeChain; } $('.meme-card h2').textContent=`밈코인 가격 보드 · ${chainLabel}`; const alert=items.some(x=>Math.abs(x.change24)>=15); $('.meme-card').classList.toggle('alert',alert); $('#meme-rows').innerHTML=items.map((x,i)=>`<div class="coin-row chart-select" role="button" tabindex="0" data-index="${i}"><span class="coin-rank">${x.rank || i+1}</span><span class="coin-name"><img src="${esc(x.image)}" alt=""><span>${esc(x.name)}<small>${esc(x.symbol)}</small></span>${gmgnIcon(x.gmgn)}</span><span class="coin-price">${money(x.price)}</span><span class="change">${pct(x.change24)}</span><span class="marketcap">${marketCap(x.marketCap)}</span></div>`).join(''); bindRowClicks('#meme-rows .chart-select', i=>setChart(items[i])); }
async function loadMeme(isRetry) { try { memeData=await api('meme-chains'); const tabs=$('#meme-chain-tabs'); tabs.innerHTML=`<button data-chain="all">시가총액 TOP 30</button><button data-chain="radar">급등 레이더</button>${memeData.chains.map(c=>`<button data-chain="${esc(c.id)}">${esc(c.name)} <small>${c.count}</small></button>`).join('')}`; $$('button',tabs).forEach(b=>{b.classList.toggle('active',b.dataset.chain===activeChain);b.onclick=()=>{activeChain=b.dataset.chain;$$('button',tabs).forEach(x=>x.classList.toggle('active',x===b));renderMeme();};}); renderMeme(); updateTime('#meme-updated'); } catch(e) { fail('#meme-rows',e,isRetry?null:()=>loadMeme(true)); } }
function renderRanking() { const items=[...rankingItems].sort((a,b)=>{ const av=a[rankSort.field],bv=b[rankSort.field]; const result=typeof av==='string'?av.localeCompare(bv):((av??0)-(bv??0)); return rankSort.asc?result:-result; }); $('#rank-rows').innerHTML=items.map((x,i)=>`<div class="rank-row chart-select" role="button" tabindex="0"><span class="coin-rank">${x.rank}</span><span class="coin-name"><img src="${esc(x.image)}" alt=""><span>${esc(x.name)}<small>${esc(x.symbol)}</small></span>${xIcon(x.twitter)}</span><span class="coin-price">${money(x.price)}</span><span class="change">${pct(x.change24)}</span><span class="marketcap">${marketCap(x.marketCap)}</span></div>`).join(''); bindRowClicks('#rank-rows .chart-select', i=>setChart(items[i])); $$('.rank-table-head button').forEach(b=>b.classList.toggle('sorted',b.dataset.sort===rankSort.field)); }
async function loadRanking(isRetry) { try { const d=await api(`coins?category=${activeCategory}&limit=20`); rankingItems=d.items; renderRanking(); updateTime('#ranking-updated'); } catch(e) { fail('#rank-rows',e,isRetry?null:()=>loadRanking(true)); } }
function relative(pub) { const h=Math.max(0,Math.round((Date.now()-new Date(pub))/36e5)); return h<1?'방금 전':h<24?`${h}시간 전`:`${Math.round(h/24)}일 전`; }
async function loadNews(kind,id,timeId,isRetry) { try { const d=await api('news?kind='+kind); $(id).innerHTML=d.items.map(x=>`<a class="news-row" href="${esc(x.url)}" target="_blank" rel="noopener"><div class="news-title">${esc(x.title)}</div><div class="news-meta"><span>${esc(x.source)}</span><span>·</span><span>${relative(x.published)}</span></div></a>`).join(''); updateTime(timeId); } catch(e) { fail(id,e,isRetry?null:()=>loadNews(kind,id,timeId,true)); } }
async function loadFear() { try { const d=await api('fear-greed'); $('#gauge-fill').parentElement.style.setProperty('--value',d.value); $('#fear-value').textContent=d.value; $('#fear-label').textContent=d.label; } catch(e) { $('#fear-label').textContent='지수 연결 실패'; } }
function loadAll() { loadMarket();loadStocks();loadMeme();loadRanking();loadNews('stocks','#stocks-news','#stocks-news-updated');loadNews('world','#world-news','#world-news-updated');loadNews('crypto','#crypto-news','#crypto-news-updated');loadFear(); }
$$('.stock-tab').forEach(b=>b.onclick=()=>{activeMarket=b.dataset.market;$$('.stock-tab').forEach(x=>x.classList.toggle('active',x===b));loadStocks()});$$('.category-tabs button').forEach(b=>b.onclick=()=>{activeCategory=b.dataset.category;$$('.category-tabs button').forEach(x=>x.classList.toggle('active',x===b));loadRanking()});$$('.rank-table-head button').forEach(b=>b.onclick=()=>{rankSort.asc=rankSort.field===b.dataset.sort?!rankSort.asc:false;rankSort.field=b.dataset.sort;renderRanking()});
$('#refresh-all').onclick=loadAll; $$('.refresh').forEach(b=>b.onclick=()=>({stocks:loadStocks,meme:loadMeme,ranking:loadRanking,'stocks-news':()=>loadNews('stocks','#stocks-news','#stocks-news-updated'),'crypto-news':()=>{loadNews('crypto','#crypto-news','#crypto-news-updated');loadFear()},'world-news':()=>loadNews('world','#world-news','#world-news-updated')}[b.dataset.target]()));
const dialog=$('#settings'); $('#open-settings').onclick=()=>{ $('#theme').value=settings.theme;$('#color-mode').value=settings.colorMode;$('#stocks-kr').value=settings.stocksKR.join(', ');$('#stocks-us').value=settings.stocksUS.join(', ');$('#stock-search').value='';$('#stock-search-results').innerHTML='';dialog.showModal();};$('#add-stock').onclick=()=>$('#open-settings').click(); $$('dialog [value="cancel"]').forEach(b=>b.onclick=()=>dialog.close()); $('#save-settings').onclick=()=>{settings.theme=$('#theme').value;settings.colorMode=$('#color-mode').value;settings.stocksKR=$('#stocks-kr').value.split(',').map(x=>x.trim()).filter(Boolean);settings.stocksUS=$('#stocks-us').value.split(',').map(x=>x.trim()).filter(Boolean);localStorage.setItem('hub.settings.v1',JSON.stringify(settings));applySettings();loadStocks();};
let searchTimer; $('#stock-search').oninput=e=>{clearTimeout(searchTimer);const q=e.target.value.trim();if(q.length<2){$('#stock-search-results').innerHTML='';return;}searchTimer=setTimeout(async()=>{try{const d=await api('search-stocks?q='+encodeURIComponent(q));$('#stock-search-results').innerHTML=d.items.map(x=>`<button type="button" data-symbol="${x.symbol}" data-exchange="${x.exchange}"><b>${x.name}</b><span>${x.symbol} · ${x.exchange}</span></button>`).join('')||'<p>검색 결과가 없습니다.</p>';$$('#stock-search-results button').forEach(b=>b.onclick=()=>{const domestic=/Korea|KOSDAQ|Korea Stock/i.test(b.dataset.exchange)||/\.(KS|KQ)$/i.test(b.dataset.symbol);const field=$(domestic?'#stocks-kr':'#stocks-us');const symbols=field.value.split(',').map(x=>x.trim()).filter(Boolean);if(!symbols.includes(b.dataset.symbol))symbols.push(b.dataset.symbol);field.value=symbols.join(', ');$('#stock-search').value='';$('#stock-search-results').innerHTML='';});}catch{ $('#stock-search-results').innerHTML='<p>검색에 실패했습니다.</p>'; }},250);};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadAll()});applySettings();loadAll();setInterval(()=>{if(!document.hidden){loadMarket();loadMeme();loadStocks()}},60000);setInterval(()=>{if(!document.hidden){loadRanking();loadNews('stocks','#stocks-news','#stocks-news-updated');loadNews('world','#world-news','#world-news-updated');loadNews('crypto','#crypto-news','#crypto-news-updated')}},300000);
