// ===== Review (복기) — 그때 차트 + 진입 사유 메모 =====
// stock_overview의 차트 렌더러(charts_main/macd/vol/popup.js)를 그대로 재사용한다.

const templates = { header: '', charts: '', indicators: '' };
let lastStock = null;            // 현재 표시 중인 차트 JSON
let currentTicker = '';
let currentDate = '';
let currentQty = '';
let currentAmount = '';
let currentFee = '';
let editingReviewId = null;      // 현재 ticker+date에 대응하는 기존 복기 id (있으면 수정)
let reviewsCache = [];
let activeIndicator = 'rsi';     // MACD 아래 4번째(지표) 차트에 표시 중인 지표

function getUid() { return sessionStorage.getItem('user_id') || ''; }

// ===== 차트 표시 옵션 (Stock Overview와 동일 localStorage 키 공유) =====
const CHART_OPTS_KEY = 'chartOpts';
const CHART_OPTS_DEFAULT = { bb: true, ma5: false, ma20: true, ma60: true, ma120: false };
function getChartOpts() {
    try { return Object.assign({}, CHART_OPTS_DEFAULT, JSON.parse(localStorage.getItem(CHART_OPTS_KEY) || '{}')); }
    catch (e) { return Object.assign({}, CHART_OPTS_DEFAULT); }
}
function setChartOpt(k, v) {
    const o = getChartOpts(); o[k] = v;
    try { localStorage.setItem(CHART_OPTS_KEY, JSON.stringify(o)); } catch (e) {}
}

// 미국 거래일(yfinance) → 한국시간(KST) 표시일(+1일) — 차트 렌더러가 참조
function toKstDateStr(usDateStr) {
    const d = new Date(usDateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
}

function showError(message) {
    const popup = document.getElementById('error-popup');
    const msgBox = document.getElementById('error-message');
    if (msgBox) msgBox.innerText = message;
    if (popup) { popup.style.display = 'flex'; setTimeout(() => popup.style.display = 'none', 5000); }
}
function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) { toast.innerText = message; toast.style.display = 'block'; setTimeout(() => toast.style.display = 'none', 2500); }
}

function formatValue(val, isWon = false) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    const num = parseFloat(val);
    if (isWon) return Math.round(num).toLocaleString('ko-KR');
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function getIndicatorClass(val, upper, lower) {
    if (val === null || val === undefined || isNaN(val)) return '';
    if (val >= upper) return 'up';
    if (val <= lower) return 'down';
    return '';
}
function getAdxClass(val) {
    if (val === null || val === undefined || isNaN(val)) return '';
    if (val >= 40) return 'adx-red';
    if (val >= 25) return 'adx-orange';
    return '';
}
function getDiClass(plus, minus) {
    if (plus > 30) return 'up';
    if (minus > 30) return 'down';
    return '';
}

// 헤더 템플릿의 ticker onclick=refreshAndCopy 대응 (복기 화면에선 티커 복사만)
function refreshAndCopy(ticker) {
    try { navigator.clipboard.writeText(ticker); showToast(ticker + ' 복사됨'); } catch (e) {}
}

async function loadTemplates() {
    const fetchT = async (n) => {
        const res = await fetch(`/static/${n}.html?v=${new Date().getTime()}`);
        if (!res.ok) throw new Error(`${n}.html 로드 실패`);
        return res.text();
    };
    const [h, c, i] = await Promise.all([fetchT('header'), fetchT('charts'), fetchT('indicators')]);
    templates.header = h; templates.charts = c; templates.indicators = i;
}

// ----- 단일 카드 렌더 (renderStockCards 단일판) -----
function renderCard(stock) {
    const wrap = document.getElementById('review-card');
    wrap.innerHTML = '';
    window.lastRenderedStocks = [stock];   // charts_popup.js가 참조
    const index = 0;

    const card = document.createElement('div');
    card.className = 'stock-card';
    const isWon = stock.currency_symbol === '₩';

    const headerHtml = templates.header
        .replaceAll('{{ticker}}', stock.ticker).replace('{{name}}', stock.name)
        .replace('{{currency}}', stock.currency_symbol || '$').replace('{{price}}', formatValue(stock.current_price, isWon))
        .replace('{{changeClass}}', stock.change_pct >= 0 ? 'up' : 'down')
        .replace('{{changeSign}}', stock.change_pct >= 0 ? '+' : '')
        .replace('{{changePct}}', formatValue(stock.change_pct, false))
        .replace('{{totalChangeClass}}', stock.total_change_pct >= 0 ? 'up' : 'down')
        .replace('{{totalChangeSign}}', stock.total_change_pct >= 0 ? '+' : '')
        .replace('{{totalChangePct}}', formatValue(stock.total_change_pct, false));

    // Review 전용: 차트 4개 (메인 / 거래량 / MACD / 지표). 지표는 팝업 대신 고정 패널.
    const layers = `
        <div class="layers-container">
            <div id="chart-main-${index}" class="layer layer-main"></div>
            <div id="chart-vol-${index}" class="layer layer-volume"></div>
            <div id="chart-macd-${index}" class="layer layer-macd"></div>
            <div id="chart-ind-${index}" class="layer layer-ind"></div>
        </div>`;

    const indHtml = templates.indicators.replaceAll('{{index}}', index)
        .replace('{{rsi}}', formatValue(stock.rsi_val, false)).replace('{{rsiClass}}', getIndicatorClass(stock.rsi_val, 70, 30))
        .replace('{{mfi}}', formatValue(stock.mfi_val, false)).replace('{{mfiClass}}', getIndicatorClass(stock.mfi_val, 80, 20))
        .replace('{{adx}}', formatValue(stock.adx_val, false)).replace('{{adxClass}}', getAdxClass(stock.adx_val))
        .replace('{{di}}', `${Math.round(stock.di_plus_val)}/${Math.round(stock.di_minus_val)}`)
        .replace('{{diClass}}', getDiClass(stock.di_plus_val, stock.di_minus_val))
        .replace('{{pb}}', formatValue(stock.pb_val, false)).replace('{{pbClass}}', getIndicatorClass(stock.pb_val, 0.8, 0.2));

    card.innerHTML = headerHtml + layers + indHtml;
    wrap.appendChild(card);

    try {
        renderMainChart(`#chart-main-${index}`, stock);
        renderMacdChart(`#chart-macd-${index}`, stock);
        renderVolChart(`#chart-vol-${index}`, stock);
        renderInlineIndicator(stock, activeIndicator, index);
        highlightActiveIndicator(index, activeIndicator);
        scheduleEntryLine(stock, index);
    } catch (e) { console.error('chart render', e); }
}

// 매수 시점 수직선: ApexCharts annotation 대신 각 차트 박스에 '꽉 차는' div를 오버레이.
// (annotation은 플롯 영역만 채워 위아래 여백이 남고, sparkline에선 안 그려짐)
function drawEntryLine(stock, index) {
    if (!stock || !stock.entry_us) return;
    const dates = stock.dates || [];
    const N = dates.length, idx = dates.indexOf(stock.entry_us);
    if (idx < 0 || N < 2) return;

    // 카테고리축은 각 거래일을 '슬롯 중앙'에 찍음(막대 중심 = 라인 점 = 그 날).
    // 거래량 막대 idx번째의 실제 중심을 읽어 정확한 x비율을 구하고 4개 차트에 동일 적용.
    let frac = (idx + 0.5) / N;  // 폴백(슬롯 중앙 공식)
    const volInner = document.querySelector(`#chart-vol-${index} .apexcharts-inner`);
    const bars = document.querySelectorAll(`#chart-vol-${index} .apexcharts-bar-series path`);
    if (volInner && bars[idx]) {
        const ir = volInner.getBoundingClientRect(), br = bars[idx].getBoundingClientRect();
        frac = ((br.left + br.right) / 2 - ir.left) / ir.width;
    }

    [['main', true], ['vol', false], ['macd', false], ['ind', false]].forEach(([key, withLabel]) => {
        const layer = document.querySelector(`#chart-${key}-${index}`);
        if (!layer) return;
        const inner = layer.querySelector('.apexcharts-inner');
        if (!inner) return;
        const lr = layer.getBoundingClientRect(), ir = inner.getBoundingClientRect();
        const x = (ir.left - lr.left) + frac * ir.width;   // 실제 플롯 좌표 기준 정확한 x
        layer.querySelectorAll('.entry-vline, .entry-vlabel').forEach(e => e.remove());
        const line = document.createElement('div');
        line.className = 'entry-vline';
        line.style.cssText = `position:absolute;top:0;bottom:0;left:${x}px;width:2px;transform:translateX(-50%);background:#7c3aed;z-index:5;pointer-events:none;`;
        layer.appendChild(line);
        if (withLabel) {   // '매수' 라벨은 맨 위(메인) 차트에만
            const lbl = document.createElement('div');
            lbl.className = 'entry-vlabel';
            lbl.textContent = '매수';
            lbl.style.cssText = `position:absolute;top:2px;left:${x}px;transform:translateX(-50%);background:#7c3aed;color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none;white-space:nowrap;`;
            layer.appendChild(lbl);
        }
    });
}

function scheduleEntryLine(stock, index) {
    let tries = 0;
    (function attempt() {
        const a = document.querySelector(`#chart-main-${index} .apexcharts-inner`);
        const b = document.querySelector(`#chart-ind-${index} .apexcharts-inner`);
        const bars = document.querySelectorAll(`#chart-vol-${index} .apexcharts-bar-series path`);
        if (a && b && bars.length) drawEntryLine(stock, index);
        else if (tries++ < 25) setTimeout(attempt, 150);
    })();
}

// 창 크기 변경 시 차트가 리사이즈되므로 수직선 위치 재계산
window.addEventListener('resize', () => { if (lastStock) setTimeout(() => drawEntryLine(lastStock, 0), 250); });

function rerenderCard() {
    if (lastStock) renderCard(lastStock);
}

function highlightActiveIndicator(index, type) {
    const order = ['rsi', 'mfi', 'adx', 'di', 'pb'];
    document.querySelectorAll(`#review-card .indicator-item`).forEach((el, i) => {
        el.classList.toggle('active', order[i] === type);
    });
}

// 지표 클릭 → 팝업 대신 4번째(MACD 아래) 패널에 표시. charts_popup.js의 동명 함수를 덮어씀.
function showIndicatorPopup(type, index, event) {
    if (event) event.stopPropagation();
    activeIndicator = type;
    if (lastStock) {
        renderInlineIndicator(lastStock, type, index);
        highlightActiveIndicator(index, type);
        scheduleEntryLine(lastStock, index);   // 지표 패널 재렌더로 지워진 수직선 다시 그림
    }
}

// MACD 아래 고정 지표 차트 (RSI/MFI/ADX/+DI·-DI/%B), 매수 수직선 포함.
function renderInlineIndicator(stock, type, index) {
    const el = document.querySelector(`#chart-ind-${index}`);
    if (!el) return;
    const dates = stock.dates || [];
    let series = [], colors = ['#111'], annotations = [], label = type.toUpperCase();

    switch (type) {
        case 'rsi': series = [{ name: 'RSI', data: stock.rsi_list }]; annotations = [{ y: 70, borderColor: '#ff3b30', strokeDashArray: 3 }, { y: 30, borderColor: '#007aff', strokeDashArray: 3 }]; break;
        case 'mfi': series = [{ name: 'MFI', data: stock.mfi_list }]; annotations = [{ y: 80, borderColor: '#ff3b30', strokeDashArray: 3 }, { y: 20, borderColor: '#007aff', strokeDashArray: 3 }]; break;
        case 'adx': series = [{ name: 'ADX', data: stock.adx_list }]; annotations = [{ y: 40, borderColor: '#ff3b30', strokeDashArray: 3 }, { y: 25, borderColor: '#ff9f43', strokeDashArray: 3 }]; break;
        case 'di': label = '+DI / -DI'; series = [{ name: '+DI', data: stock.di_plus_list || [] }, { name: '-DI', data: stock.di_minus_list || [] }]; colors = ['#ff3b30', '#007aff']; break;
        case 'pb': label = '%B'; series = [{ name: '%B', data: stock.pb_list }]; annotations = [{ y: 0, borderColor: '#007aff', strokeDashArray: 2 }, { y: 1, borderColor: '#ff3b30', strokeDashArray: 2 }]; break;
    }

    // 오토 스케일: 데이터 범위에만 맞춰 항상 꽉 채움(종목 비교가 아니므로 절대 스케일 불필요). 6% 패딩.
    const vals = [];
    series.forEach(s => (s.data || []).forEach(v => { if (v != null && !isNaN(v)) vals.push(v); }));
    let yMin = vals.length ? Math.min(...vals) : 0;
    let yMax = vals.length ? Math.max(...vals) : 100;
    const pad = (yMax - yMin) * 0.08 || Math.max(Math.abs(yMax) * 0.08, 1);
    yMin -= pad; yMax += pad;
    // 기준선(70/30 등)은 항상 표시 + 값 라벨. 범위 밖이면 가장자리에 붙여 참고선으로.
    // (y축 숫자를 숨겼으므로 이 라벨이 유일한 절대값 기준점)
    const annViz = annotations.map(a => ({
        y: Math.min(yMax, Math.max(yMin, a.y)),
        borderColor: a.borderColor,
        strokeDashArray: a.strokeDashArray,
        label: { text: String(a.y), position: 'left', textAnchor: 'start', offsetX: 2, borderWidth: 0,
                 style: { background: 'transparent', color: a.borderColor, fontSize: '9px', fontWeight: 700 } }
    }));

    const options = {
        series,
        // sparkline로 모든 차트 크롬 제거 → 플롯이 박스를 꽉 채움(라인 ~92%).
        // 기준선(yaxis annotation)·라벨은 sparkline에서도 유지됨. 지표명은 HTML 오버레이로 표시.
        chart: { height: 150, type: 'line', animations: { enabled: false }, toolbar: { show: false }, zoom: { enabled: false }, sparkline: { enabled: true } },
        stroke: { width: 2, curve: 'smooth' },
        colors,
        grid: { borderColor: '#f4f4f4', padding: { top: 0, bottom: 0, left: 0, right: 0 } },
        legend: { show: false },
        markers: { size: 0, hover: { size: 0, sizeOffset: 0 } },
        xaxis: {
            type: 'category', categories: dates,
            labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false },
            crosshairs: { show: true, stroke: { color: '#94a3b8', width: 1, dashArray: 3 } }
        },
        yaxis: { show: false, min: yMin, max: yMax, labels: { show: false } },
        annotations: { yaxis: annViz },
        tooltip: { enabled: true, x: { formatter: v => v } }
    };
    el.innerHTML = '';
    try { new ApexCharts(el, options).render(); } catch (e) { console.error('inline indicator', e); }
    // 지표 이름 라벨(HTML 오버레이) — ApexCharts title이 차지하던 상단 여백 제거용
    const nameLbl = document.createElement('div');
    nameLbl.textContent = label;
    nameLbl.style.cssText = 'position:absolute;top:2px;right:8px;font-size:11px;font-weight:800;color:#aaa;z-index:4;pointer-events:none;';
    el.appendChild(nameLbl);
}

// ----- 복기 실행 -----
function runReview() {
    const t = document.getElementById('r-ticker').value.trim().toUpperCase();
    let d = document.getElementById('r-date').value;
    const qty = document.getElementById('r-qty').value;
    const amount = document.getElementById('r-amount').value;
    const fee = document.getElementById('r-fee').value;
    if (!t) { showError('종목(Ticker)을 입력하세요.'); return; }
    if (!d) { d = new Date().toISOString().split('T')[0]; document.getElementById('r-date').value = d; }
    doReview(t, d, qty, amount, fee);
}

async function doReview(ticker, date, qty = '', amount = '', fee = '') {
    currentTicker = ticker; currentDate = date; currentQty = qty; currentAmount = amount; currentFee = fee;
    const wrap = document.getElementById('review-card');
    wrap.innerHTML = '<div class="loading" style="grid-column:auto;padding:60px;">차트 불러오는 중...</div>';
    document.getElementById('memo-box').style.display = 'none';
    document.getElementById('review-summary').style.display = 'none';
    try {
        if (!templates.header) await loadTemplates();
        let url = `/api/review/chart?ticker=${encodeURIComponent(ticker)}&date=${encodeURIComponent(date)}&uid=${getUid()}`;
        if (qty !== '' && qty != null) url += `&quantity=${encodeURIComponent(qty)}`;
        if (amount !== '' && amount != null) url += `&amount=${encodeURIComponent(amount)}`;
        if (fee !== '' && fee != null) url += `&fee=${encodeURIComponent(fee)}`;
        const res = await fetch(url);
        if (!res.ok) {
            let msg = '데이터를 가져올 수 없습니다.';
            try { const e = await res.json(); if (e.detail) msg = e.detail; } catch (_) {}
            throw new Error(msg);
        }
        lastStock = await res.json();
        renderCard(lastStock);
        renderSummary(lastStock);

        // 기존 복기가 있으면 prefill(수정 모드), 없으면 신규
        const existing = reviewsCache.find(r => r.ticker === ticker && r.date === date);
        editingReviewId = existing ? existing.id : null;
        document.getElementById('memo-text').value = existing ? (existing.memo || '') : '';
        document.getElementById('memo-title').innerText = `${ticker} · ${date} 진입 복기`;
        document.getElementById('memo-box').style.display = 'block';
    } catch (e) {
        wrap.innerHTML = '';
        showError(e.message);
    }
}

// 수익률 요약 (수량+매매금액 입력 시에만)
function renderSummary(stock) {
    const box = document.getElementById('review-summary');
    if (stock.return_pct === undefined || stock.return_pct === null) {
        box.style.display = 'none'; box.innerHTML = ''; return;
    }
    const sym = stock.currency_symbol || '$';
    const money = (v) => sym + Math.abs(Number(v)).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const signed = (v) => (v >= 0 ? '+' : '-') + money(v);
    const cls = stock.return_pct >= 0 ? 'up' : 'down';
    box.innerHTML = `<div class="rev-metrics">
        <div class="rev-metric"><div class="lbl">수익률</div><div class="val ${cls}">${stock.return_pct >= 0 ? '+' : ''}${stock.return_pct.toFixed(2)}%</div></div>
        <div class="rev-metric"><div class="lbl">평가손익</div><div class="val ${cls}">${signed(stock.profit)}</div></div>
        <div class="rev-metric"><div class="lbl">평가금액</div><div class="val">${money(stock.market_value)}</div></div>
        <div class="rev-metric"><div class="lbl">매수금액(총액)</div><div class="val">${money(stock.amount)}</div></div>
        <div class="rev-metric"><div class="lbl">수수료</div><div class="val">${money(stock.fee || 0)}</div></div>
        <div class="rev-metric"><div class="lbl">평균매수가 <span style="font-weight:400;color:#bbb;font-size:0.6rem;">(수수료 제외)</span></div><div class="val">${money(stock.buy_price)}</div></div>
        <div class="rev-metric"><div class="lbl">현재가</div><div class="val">${money(stock.current_price)}</div></div>
        <div class="rev-metric"><div class="lbl">수량</div><div class="val">${stock.quantity}주</div></div>
        <div class="rev-metric"><div class="lbl">보유일</div><div class="val">${stock.days_held}일</div></div>
    </div>`;
    box.style.display = 'block';
}

// ----- 메모 저장 -----
async function postJSON(url, body) {
    const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
        let msg = '요청 실패';
        try { const e = await res.json(); if (e.detail) msg = e.detail; } catch (_) {}
        throw new Error(msg);
    }
    return res.json();
}

async function saveMemo() {
    if (!currentTicker || !currentDate) return;
    const memo = document.getElementById('memo-text').value.trim();
    const qv = document.getElementById('r-qty').value;
    const av = document.getElementById('r-amount').value;
    const fv = document.getElementById('r-fee').value;
    const nums = {
        quantity: qv === '' ? null : parseFloat(qv),
        amount: av === '' ? null : parseFloat(av),
        fee: fv === '' ? null : parseFloat(fv),
    };
    try {
        if (editingReviewId) {
            await postJSON('/api/review/update', { uid: getUid(), id: editingReviewId, memo, ...nums });
        } else {
            const r = await postJSON('/api/review/add', { uid: getUid(), ticker: currentTicker, date: currentDate, memo, ...nums });
            editingReviewId = r.id;
        }
        showToast('복기 저장됨');
        await loadReviews();
    } catch (e) { showError('저장 실패: ' + e.message); }
}

// ----- 복기 기록 목록 -----
async function loadReviews() {
    const wrap = document.getElementById('review-list');
    try {
        const res = await fetch(`/api/review/list?uid=${getUid()}`);
        if (!res.ok) throw new Error('목록 로드 실패');
        const data = await res.json();
        reviewsCache = data.reviews || [];
        renderReviewList(reviewsCache);
    } catch (e) {
        showError(e.message);
        wrap.innerHTML = '<div class="loading" style="grid-column:auto;padding:30px;">연결 오류</div>';
    }
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderReviewList(reviews) {
    const wrap = document.getElementById('review-list');
    if (!reviews.length) {
        wrap.innerHTML = '<div class="loading" style="grid-column:auto;padding:30px;">아직 복기 기록이 없습니다. 위에서 종목·날짜로 검색해 첫 복기를 남겨보세요.</div>';
        return;
    }
    wrap.innerHTML = reviews.map(r => {
        const meta = (r.quantity != null && r.amount != null)
            ? `<span class="ri-date">· ${r.quantity}주 / ${r.amount}</span>` : '';
        return `
        <div class="review-item" onclick="openReviewById('${escapeHtml(r.id)}')">
            <div class="ri-main">
                <div><span class="ri-tk">${escapeHtml(r.ticker)}</span><span class="ri-date">${escapeHtml(r.date)}</span>${meta}</div>
                <div class="ri-memo">${r.memo ? escapeHtml(r.memo) : '<span style="color:#bbb;">(메모 없음)</span>'}</div>
            </div>
            <button class="ri-del" onclick="deleteReview('${escapeHtml(r.id)}', event)">삭제</button>
        </div>`;
    }).join('');
}

function openReviewById(id) {
    const r = reviewsCache.find(x => x.id === id);
    if (r) openReview(r.ticker, r.date, r.quantity, r.amount, r.fee);
}

function openReview(ticker, date, qty, amount, fee) {
    document.getElementById('r-ticker').value = ticker;
    document.getElementById('r-date').value = date;
    document.getElementById('r-qty').value = (qty == null ? '' : qty);
    document.getElementById('r-amount').value = (amount == null ? '' : amount);
    document.getElementById('r-fee').value = (fee == null ? '' : fee);
    doReview(ticker, date, qty == null ? '' : qty, amount == null ? '' : amount, fee == null ? '' : fee);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteReview(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('이 복기 기록을 삭제할까요?')) return;
    try {
        await postJSON('/api/review/delete', { uid: getUid(), id });
        if (editingReviewId === id) editingReviewId = null;
        await loadReviews();
        showToast('삭제됨');
    } catch (e) { showError('삭제 실패: ' + e.message); }
}

// ----- 보유 종목 불러오기 (record 안 거치고 review에서 바로) -----
async function toggleLoadPanel() {
    const p = document.getElementById('load-panel');
    if (p.style.display === 'block') { p.style.display = 'none'; return; }
    p.innerHTML = '<div class="load-empty">불러오는 중...</div>';
    p.style.display = 'block';
    try {
        const res = await fetch(`/api/positions?uid=${getUid()}`);
        if (!res.ok) throw new Error('실패');
        const positions = await res.json();
        if (!positions.length) { p.innerHTML = '<div class="load-empty">보유 종목이 없습니다.</div>'; return; }
        p.innerHTML = positions.map(pos => {
            const amount = (pos.avg_price * pos.quantity).toFixed(2);  // 수수료 포함 총원가
            const fee = (pos.fee || 0).toFixed(2);
            return `<div class="load-item" onclick="loadPosition('${escapeHtml(pos.ticker)}','${escapeHtml(pos.first_buy || '')}',${pos.quantity},${amount},${fee})">
                <span class="li-tk">${escapeHtml(pos.ticker)}</span>
                <span class="li-meta">${pos.quantity}주 · 최초매수 ${escapeHtml(pos.first_buy || '-')}</span>
            </div>`;
        }).join('');
    } catch (e) {
        p.innerHTML = '<div class="load-empty" style="color:#ff3b30;">불러오기 실패</div>';
    }
}
function loadPosition(ticker, date, qty, amount, fee) {
    const p = document.getElementById('load-panel'); if (p) p.style.display = 'none';
    openReview(ticker, date, qty, amount, fee);
}

// ----- 초기화: URL 파라미터(?ticker=&date=&qty=&amount=&fee=)로 자동 복기 (record에서 연결) -----
function initFromUrl() {
    const p = new URLSearchParams(location.search);
    const t = p.get('ticker'), d = p.get('date');
    const q = p.get('qty') || p.get('quantity'), a = p.get('amount'), f = p.get('fee');
    if (t) document.getElementById('r-ticker').value = t.toUpperCase();
    if (d) document.getElementById('r-date').value = d;
    if (q) document.getElementById('r-qty').value = q;
    if (a) document.getElementById('r-amount').value = a;
    if (f) document.getElementById('r-fee').value = f;
    if (t && d) runReview();
}

(async function init() {
    await loadReviews();
    initFromUrl();
})();
