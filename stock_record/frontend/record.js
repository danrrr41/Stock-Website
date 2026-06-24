// ===== 보유 종목 (거래내역에서 자동 산출) =====
let positionsCache = [];
let fuCache = {};        // key -> followup 데이터 (지표 미니차트 팝업용)
let popupCharts = {};    // key -> 현재 열린 팝업 ApexCharts 인스턴스
let reviewsList = [];    // 복기(Review) 기록 — 포지션 카드에 메모 표시용

function getUid() { return sessionStorage.getItem('user_id') || ''; }
function safeKey(ticker) { return String(ticker).replace(/[^A-Za-z0-9]/g, '_'); }
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// 해당 종목의 복기 메모 — 매수일(date)과 같은 복기 우선, 없으면 가장 최근 복기.
function reviewMemoFor(ticker, date) {
    const forT = reviewsList.filter(r => r.ticker === ticker && r.memo);
    if (!forT.length) return '';
    const exact = forT.find(r => r.date === date);
    return (exact || forT[0]).memo;
}

// 복기(Review)로 이동 — 티커/최초매수일/수량/매매금액(평단×수량, 수수료 포함)/수수료 전달
function goReview(ticker, date, qty, avg, fee) {
    const amount = (avg * qty).toFixed(2);
    const f = (fee || 0).toFixed(2);
    location.href = `/review?ticker=${encodeURIComponent(ticker)}&date=${date || ''}&qty=${qty}&amount=${amount}&fee=${f}`;
}

// ===== 차트 표시 옵션 (이평선 / 볼린저밴드 토글) — Stock Overview와 동일 키 공유 =====
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
function rerenderAllCharts() {
    Object.keys(fuCache).forEach(key => {
        if (document.querySelector(`#chart-${key}`)) renderChart(`#chart-${key}`, fuCache[key]);
    });
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

// 지표 색상 (Stock Overview와 동일 규칙)
function getIndicatorClass(val, upper, lower) {
    if (val === null || val === undefined || isNaN(val)) return '';
    if (val >= upper) return 'up';
    if (val <= lower) return 'down';
    return '';
}
function getAdxClass(val) {
    if (isNaN(val)) return '';
    if (val >= 40) return 'adx-red';
    if (val >= 25) return 'adx-orange';
    return '';
}
function getDiClass(plus, minus) {
    if (plus > 30) return 'up';
    if (minus > 30) return 'down';
    return '';
}
function fmtMoney(v, sym) {
    if (v === null || v === undefined || isNaN(v)) return 'N/A';
    const sign = v >= 0 ? '+' : '-';
    return `${sign}${sym}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

// ----- 보유 목록 로드 & 렌더 -----
async function loadPositions() {
    const grid = document.getElementById('record-grid');
    try {
        const [posRes, revRes] = await Promise.all([
            fetch(`/api/positions?uid=${getUid()}`),
            fetch(`/api/review/list?uid=${getUid()}`)
        ]);
        if (!posRes.ok) throw new Error('목록 로드 실패');
        positionsCache = await posRes.json();
        try { reviewsList = (await revRes.json()).reviews || []; } catch (_) { reviewsList = []; }
        renderBlocks(positionsCache);
    } catch (e) {
        showError(e.message);
        grid.innerHTML = `<div class="loading">연결 오류</div>`;
    }
}

function renderBlocks(positions) {
    const grid = document.getElementById('record-grid');
    grid.innerHTML = '';
    if (!positions.length) {
        grid.innerHTML = `<div class="loading">보유 종목이 없습니다. 우측 상단 ＋ 버튼으로 매매를 기록하세요.</div>`;
        return;
    }
    positions.forEach(pos => {
        const key = safeKey(pos.ticker);
        const rmemo = reviewMemoFor(pos.ticker, pos.first_buy);
        const card = document.createElement('div');
        card.className = 'stock-card';
        card.innerHTML = `
            <div class="rec-top">
                <div class="ticker-group">
                    <span class="ticker">${pos.ticker}</span>
                    <span class="company-name" id="name-${key}">${pos.name || pos.ticker}</span>
                    <span class="rec-buyinfo">보유 ${pos.quantity}주 · 최초매수 ${pos.first_buy || '-'}</span>
                </div>
                <button class="rec-review-btn" title="이 종목 매수 시점 복기" onclick="goReview('${pos.ticker}','${pos.first_buy || ''}',${pos.quantity},${pos.avg_price},${pos.fee || 0})">🔍 복기</button>
            </div>
            <div class="rec-review-memo" title="복기 메모">${rmemo ? '📝 ' + escapeHtml(rmemo) : '<span class="rmemo-empty">복기 메모 없음 · 🔍 복기에서 작성</span>'}</div>
            <div class="rec-summary" id="summary-${key}">
                <div class="rec-metric"><div class="lbl">로딩 중...</div><div class="val">·</div></div>
            </div>
            <div class="layer layer-main"><div id="chart-${key}" style="height:220px;"></div></div>
            <div id="ind-${key}"></div>
            <div id="indicator-popup-${key}" class="indicator-popup">
                <div class="indicator-popup-header">
                    <span class="indicator-popup-title"></span>
                    <span class="indicator-popup-close" onclick="closeFollowupPopup('${key}')">&times;</span>
                </div>
                <div id="popup-chart-${key}" class="indicator-popup-chart"></div>
            </div>
        `;
        grid.appendChild(card);

        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    loadFollowup(pos);
                    obs.unobserve(entry.target);
                }
            });
        }, { rootMargin: '100px', threshold: 0.01 });
        observer.observe(card);
    });
}

async function loadFollowup(pos) {
    const key = safeKey(pos.ticker);
    try {
        const res = await fetch(`/api/positions/followup?uid=${getUid()}&ticker=${encodeURIComponent(pos.ticker)}`);
        const fu = await res.json();
        const summary = document.getElementById(`summary-${key}`);
        if (!res.ok || fu.error) {
            if (summary) summary.innerHTML = `<div class="rec-metric"><div class="lbl">오류</div><div class="val down">${fu.error || '실패'}</div></div>`;
            return;
        }
        fuCache[key] = fu;
        const nameEl = document.getElementById(`name-${key}`);
        if (nameEl) nameEl.innerText = fu.name || pos.ticker;

        const sym = fu.currency_symbol || '$';
        const retCls = fu.return_pct >= 0 ? 'up' : 'down';
        const marketValue = fu.current_price * fu.quantity;
        const buyAmount = fu.buy_price * fu.quantity;
        summary.innerHTML = `
            <div class="rec-metric"><div class="lbl">수익률</div><div class="val ${retCls}">${fu.return_pct >= 0 ? '+' : ''}${fu.return_pct.toFixed(2)}% <span style="font-size:0.8rem; font-weight:700;">(${fmtMoney(fu.profit, sym)})</span></div></div>
            <div class="rec-metric"><div class="lbl">평가금액</div><div class="val">${sym}${marketValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} <span style="font-size:0.78rem; color:#888; font-weight:700;">(매수 ${sym}${buyAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })})</span></div></div>
            <div class="rec-metric"><div class="lbl">현재가</div><div class="val">${sym}${fu.current_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div></div>
            <div class="rec-metric"><div class="lbl">보유일</div><div class="val">${fu.days_held}일</div></div>
        `;

        document.getElementById(`ind-${key}`).innerHTML = indicatorsHtml(fu, key);
        renderChart(`#chart-${key}`, fu);
    } catch (e) {
        console.error(e);
        const summary = document.getElementById(`summary-${key}`);
        if (summary) summary.innerHTML = `<div class="rec-metric"><div class="lbl">오류</div><div class="val down">통신 실패</div></div>`;
    }
}

function indCell(label, val, cls, type, key) {
    const disp = typeof val === 'number' ? val.toFixed(2) : val;
    return `<div class="indicator-item" onclick="showFollowupPopup('${type}','${key}', event)"><span class="indicator-label">${label}</span><span class="indicator-value ${cls}">${disp}</span></div>`;
}
function indicatorsHtml(fu, key) {
    return `<div class="indicators">
        ${indCell('RSI', fu.rsi_val, getIndicatorClass(fu.rsi_val, 70, 30), 'rsi', key)}
        ${indCell('MFI', fu.mfi_val, getIndicatorClass(fu.mfi_val, 80, 20), 'mfi', key)}
        ${indCell('ADX', fu.adx_val, getAdxClass(fu.adx_val), 'adx', key)}
        ${indCell('DMI', Math.round(fu.di_plus_val) + '/' + Math.round(fu.di_minus_val), getDiClass(fu.di_plus_val, fu.di_minus_val), 'di', key)}
        ${indCell('%B', fu.pb_val, getIndicatorClass(fu.pb_val, 0.8, 0.2), 'pb', key)}
    </div>`;
}

// ----- 지표 미니차트 팝업 -----
function destroyPopupChart(key) {
    if (popupCharts[key]) { try { popupCharts[key].destroy(); } catch (e) {} popupCharts[key] = null; }
}
function closeFollowupPopup(key) {
    const p = document.getElementById(`indicator-popup-${key}`);
    if (p) p.style.display = 'none';
    destroyPopupChart(key);
}
function closeAllFollowupPopups() {
    document.querySelectorAll('.indicator-popup').forEach(p => p.style.display = 'none');
    Object.keys(popupCharts).forEach(destroyPopupChart);
}
function showFollowupPopup(type, key, event) {
    if (event) event.stopPropagation();
    closeAllFollowupPopups();
    const fu = fuCache[key];
    const popup = document.getElementById(`indicator-popup-${key}`);
    const chartContainer = document.getElementById(`popup-chart-${key}`);
    if (!fu || !popup || !chartContainer) return;
    const title = popup.querySelector('.indicator-popup-title');
    popup.style.display = 'block';

    const dates = fu.dates || [];
    const getMinMax = (list) => { const v = (list || []).filter(x => x != null && !isNaN(x)); return { min: Math.min(...v), max: Math.max(...v) }; };
    let series = [], colors = ['#111'], annotations = [], yMin = 0, yMax = 100, label = type.toUpperCase();

    switch (type) {
        case 'rsi': { const d = fu.rsi_list; series = [{ name: 'RSI', data: d }]; const r = getMinMax(d); yMin = Math.min(0, r.min * 0.9); yMax = Math.max(100, r.max * 1.1); annotations = [{ y: 70, borderColor: '#ff3b30', strokeDashArray: 3 }, { y: 30, borderColor: '#007aff', strokeDashArray: 3 }]; break; }
        case 'mfi': { const d = fu.mfi_list; series = [{ name: 'MFI', data: d }]; const r = getMinMax(d); yMin = Math.min(0, r.min * 0.9); yMax = Math.max(100, r.max * 1.1); annotations = [{ y: 80, borderColor: '#ff3b30', strokeDashArray: 3 }, { y: 20, borderColor: '#007aff', strokeDashArray: 3 }]; break; }
        case 'adx': { const d = fu.adx_list; series = [{ name: 'ADX', data: d }]; const r = getMinMax(d); yMin = 0; yMax = Math.max(60, r.max * 1.1); annotations = [{ y: 40, borderColor: '#ff3b30', strokeDashArray: 3 }, { y: 25, borderColor: '#ff9f43', strokeDashArray: 3 }]; break; }
        case 'di': { label = '+DI / -DI'; series = [{ name: '+DI', data: fu.di_plus_list || [] }, { name: '-DI', data: fu.di_minus_list || [] }]; colors = ['#ff3b30', '#007aff']; const r = getMinMax([...(fu.di_plus_list || []), ...(fu.di_minus_list || [])]); yMin = 0; yMax = Math.max(50, r.max * 1.1); break; }
        case 'pb': { label = '%B'; const d = fu.pb_list; series = [{ name: '%B', data: d }]; const r = getMinMax(d); yMin = Math.min(0, r.min - 0.1); yMax = Math.max(1, r.max + 0.1); annotations = [{ y: 0, borderColor: '#007aff', strokeDashArray: 2 }, { y: 1, borderColor: '#ff3b30', strokeDashArray: 2 }]; break; }
    }
    title.innerText = label;

    const options = {
        series,
        chart: { height: 120, type: 'line', animations: { enabled: false }, toolbar: { show: false }, zoom: { enabled: false }, sparkline: { enabled: true } },
        stroke: { width: 2, curve: 'smooth' },
        colors,
        grid: { show: false }, legend: { show: false }, markers: { size: 0, hover: { size: 0, sizeOffset: 0 } },
        xaxis: { categories: dates, labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { min: yMin, max: yMax, labels: { show: false } },
        annotations: { yaxis: annotations },
        tooltip: { enabled: false }
    };
    destroyPopupChart(key);
    chartContainer.innerHTML = '';
    try { const c = new ApexCharts(chartContainer, options); popupCharts[key] = c; c.render(); } catch (e) { console.error('popup chart', e); }

    const closeHandler = (e) => {
        if (e.key === 'Escape' || (!popup.contains(e.target) && !e.target.closest('.indicator-item'))) {
            closeFollowupPopup(key);
            document.removeEventListener('click', closeHandler);
            document.removeEventListener('keydown', closeHandler);
        }
    };
    setTimeout(() => { document.addEventListener('click', closeHandler); document.addEventListener('keydown', closeHandler); }, 10);
}

function renderChart(sel, fu) {
    // 영업일(category) 축 → 주말/휴일 빈칸 없음. 선(가격 + MA + BB).
    const opts = (typeof getChartOpts === 'function') ? getChartOpts() : { bb: true, ma5: false, ma20: true, ma60: true, ma120: false };
    const dates = fu.dates || [];
    const close = (fu.ohlc || []).map(d => d.c);
    const hasBB = opts.bb && (fu.bb_upper && fu.bb_upper.length === dates.length && fu.bb_lower && fu.bb_lower.length === dates.length);
    const D = (arr) => dates.map((d, i) => ({ x: d, y: (arr || [])[i] }));

    const series = [];
    const colors = [];
    const widths = [];
    const dashes = [];
    if (hasBB) {
        series.push({ name: 'BB', type: 'rangeArea', data: dates.map((d, i) => ({ x: d, y: [fu.bb_lower[i], fu.bb_upper[i]] })) });
        colors.push('#e1f5fe'); widths.push(0); dashes.push(0);
    }
    series.push({ name: '가격', type: 'line', data: dates.map((d, i) => ({ x: d, y: close[i] })) });
    colors.push('#111'); widths.push(2.5); dashes.push(0);
    if (opts.ma5 && fu.ma5 && fu.ma5.length) {
        series.push({ name: '5MA', type: 'line', data: D(fu.ma5) });
        colors.push('#9b59b6'); widths.push(1.5); dashes.push(0);
    }
    if (opts.ma20) {
        series.push({ name: '20MA', type: 'line', data: D(fu.ma20) });
        colors.push('#27ae60'); widths.push(1.5); dashes.push(0);
    }
    if (opts.ma60) {
        series.push({ name: '60MA', type: 'line', data: D(fu.ma60) });
        colors.push('#f1c40f'); widths.push(1.5); dashes.push(0);
    }
    if (opts.ma120 && fu.ma120 && fu.ma120.length) {
        series.push({ name: '120MA', type: 'line', data: D(fu.ma120) });
        colors.push('#e67e22'); widths.push(1.5); dashes.push(0);
    }
    if (hasBB) {
        series.push({ name: 'BB상', type: 'line', data: dates.map((d, i) => ({ x: d, y: fu.bb_upper[i] })) });
        colors.push('#ff3b30'); widths.push(2); dashes.push(6);
        series.push({ name: 'BB하', type: 'line', data: dates.map((d, i) => ({ x: d, y: fu.bb_lower[i] })) });
        colors.push('#007aff'); widths.push(2); dashes.push(6);
    }

    const options = {
        series,
        chart: { height: 220, type: 'line', toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false } },
        xaxis: {
            type: 'category', categories: dates,
            labels: { show: false },
            axisTicks: { show: false }, axisBorder: { show: false },
            crosshairs: { show: true, stroke: { color: '#94a3b8', width: 1, dashArray: 3 } },
            tooltip: { enabled: false }
        },
        yaxis: { labels: { style: { fontSize: '10px', colors: '#999' }, formatter: v => (v != null ? v.toFixed(0) : '') } },
        stroke: { width: widths, dashArray: dashes, curve: 'straight' },
        colors: colors,
        fill: { type: 'solid', opacity: colors.map((c, i) => (hasBB && i === 0) ? 0.5 : 1) },
        markers: { size: 0, hover: { size: 0, sizeOffset: 0 } },
        legend: { show: false },
        grid: { borderColor: '#f4f4f4' },
        tooltip: {
            enabled: true, shared: true, intersect: false,
            custom: function({ dataPointIndex }) {
                try {
                    const d = fu.dates[dataPointIndex];
                    const o = fu.ohlc[dataPointIndex];
                    return '<div style="padding:4px 8px;font-size:11px;font-weight:700;">' + d +
                        '<br><span style="color:#666;font-weight:600;">종가 ' + (o ? o.c : '-') + '</span></div>';
                } catch (e) { return ''; }
            }
        },
        annotations: { yaxis: [{ y: fu.buy_price, borderColor: '#7c3aed', strokeDashArray: 6, borderWidth: 2 }] }
    };
    const el = document.querySelector(sel);
    if (!el) return;
    el.innerHTML = '';
    try { new ApexCharts(el, options).render(); } catch (e) { console.error('chart', e); }
}

// ----- 매매 기록 추가 모달 (매수/매도) -----
function openAddModal() {
    document.getElementById('f-type').value = 'buy';
    document.getElementById('f-ticker').value = '';
    document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('f-price').value = '';
    document.getElementById('f-qty').value = '';
    document.getElementById('f-fee').value = '';
    document.getElementById('f-memo').value = '';
    document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

async function submitTx() {
    const type = document.getElementById('f-type').value;
    const ticker = document.getElementById('f-ticker').value.trim().toUpperCase();
    const date = document.getElementById('f-date').value;
    const price = parseFloat(document.getElementById('f-price').value);
    const quantity = parseFloat(document.getElementById('f-qty').value);
    const fee = parseFloat(document.getElementById('f-fee').value) || 0;
    const memo = document.getElementById('f-memo').value.trim();

    if (!ticker || !date || isNaN(price) || isNaN(quantity)) {
        showError('종목/날짜/단가/수량을 모두 입력하세요.');
        return;
    }
    try {
        const res = await fetch('/api/ledger/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: getUid(), ticker, type, date, price, quantity, fee, memo })
        });
        if (!res.ok) {
            let msg = '저장 실패';
            try { const e = await res.json(); if (e.detail) msg = e.detail; } catch (_) {}
            throw new Error(msg);
        }
        closeModal();
        showToast(type === 'buy' ? '매수 기록 추가됨' : '매도 기록 추가됨');
        loadPositions();
    } catch (e) { showError(e.message); }
}

loadPositions();
