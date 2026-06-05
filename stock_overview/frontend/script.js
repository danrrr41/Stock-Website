// 전역 변수
let currentStocksData = [];
const templates = { header: '', charts: '', indicators: '' };

function getUid() { return sessionStorage.getItem('user_id') || ''; }

// ===== 차트 표시 옵션 (이평선 / 볼린저밴드 토글) =====
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

// 미국 거래일(yfinance) → 한국시간(KST) 표시일(+1일)
function toKstDateStr(usDateStr) {
    const d = new Date(usDateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
}

function showError(message) {
    const popup = document.getElementById('error-popup');
    const msgBox = document.getElementById('error-message');
    if (msgBox) msgBox.innerText = message;
    if (popup) popup.style.display = 'flex';
    setTimeout(() => { if (popup) popup.style.display = 'none'; }, 5000);
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
    if (plus > 30) return 'up';   // +DI가 30 넘으면 빨강
    if (minus > 30) return 'down'; // -DI가 30 넘으면 파랑
    return '';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = message;
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2500);
    }
}

function copyAiRawData(ticker) {
    const stock = currentStocksData.find(s => s.ticker === ticker);
    if (!stock) {
        showError("데이터를 찾을 수 없습니다.");
        return;
    }

    try {
        // 1. Cross Signals 판별 (최근 5일)
        const maLen = stock.ma20.length;
        let maCross = "None";
        for (let i = maLen - 1; i >= Math.max(1, maLen - 5); i--) {
            const p20 = stock.ma20[i-1], p60 = stock.ma60[i-1];
            const c20 = stock.ma20[i],   c60 = stock.ma60[i];
            if (p20 <= p60 && c20 > c60) { maCross = "Golden_Cross"; break; }
            if (p20 >= p60 && c20 < c60) { maCross = "Dead_Cross"; break; }
        }

        const diLen = stock.di_plus_list.length;
        let dmiCross = "None";
        for (let i = diLen - 1; i >= Math.max(1, diLen - 5); i--) {
            const pP = stock.di_plus_list[i-1], pM = stock.di_minus_list[i-1];
            const cP = stock.di_plus_list[i],   cM = stock.di_minus_list[i];
            if (pP <= pM && cP > cM) { dmiCross = "Golden_Cross"; break; }
            if (pP >= pM && cP < cM) { dmiCross = "Dead_Cross"; break; }
        }

        // 기준 시각(KST) 및 미국장 개장 여부 → 오늘 봉이 장중 잠정치인지 판별
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const asOf = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const lastDateKst = stock.dates.length ? toKstDateStr(stock.dates[stock.dates.length - 1]) : '';
        let marketOpen = false, etStr = '', sessionPct = null, elapsedStr = '';
        try {
            const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            etStr = `${et.getFullYear()}-${pad(et.getMonth() + 1)}-${pad(et.getDate())} ${pad(et.getHours())}:${pad(et.getMinutes())}`;
            const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
            marketOpen = (d >= 1 && d <= 5) && m >= 570 && m < 960; // 평일 09:30~16:00 ET
            if (marketOpen) {
                const elapsed = m - 570;                  // 09:30 ET 이후 경과(분), 정규장 390분
                sessionPct = Math.round(elapsed / 390 * 100);
                elapsedStr = `${Math.floor(elapsed / 60)}h${pad(elapsed % 60)}m/6h30m`;
            }
        } catch (e) {}
        const isPartial = marketOpen && (lastDateKst === todayStr);

        // 2. 텍스트 가공
        let md = `[Stock Overview Pro - AI Technical Analysis Raw Data]\n`;
        md += `Ticker: ${stock.ticker} (${stock.name})\n`;
        md += `Data_As_Of: ${asOf} KST\n`;
        md += `US_Eastern_Time: ${etStr} ET\n`;
        md += `US_Market: ${marketOpen ? `OPEN (장 시작 후 ${elapsedStr}, ${sessionPct}% 경과)` : 'CLOSED'}\n`;
        md += `Current_Price: ${stock.current_price.toFixed(2)} (Currency: ${stock.currency_symbol})\n`;
        md += `Daily_Change_Pct: ${stock.change_pct.toFixed(2)}%\n`;
        md += `60B_Total_Change_Pct: ${stock.total_change_pct.toFixed(2)}%\n`;
        if (isPartial) {
            const inv = sessionPct > 0 ? (100 / sessionPct).toFixed(2) : '?';
            md += `Note: 마지막 행(${lastDateKst}, LIVE)은 오늘 미국장 진행 중(${sessionPct}% 경과) 데이터입니다. 거래량/종가는 장중 누적·잠정치라 거래량이 낮게 보입니다. 하루 전체 환산 거래량 ≈ 현재거래량 × ${inv} (선형 가정, 참고용).\n`;
        }
        md += `\n`;

        md += `■ [Snapshot Indicators]\n`;
        md += `- RSI: ${stock.rsi_val.toFixed(2)}\n`;
        md += `- MFI: ${stock.mfi_val.toFixed(2)}\n`;
        md += `- %B: ${stock.pb_val.toFixed(2)}\n`;
        md += `- ADX: ${stock.adx_val.toFixed(2)}\n`;
        md += `- Plus_DI: ${stock.di_plus_val.toFixed(2)}\n`;
        md += `- Minus_DI: ${stock.di_minus_val.toFixed(2)}\n\n`;

        md += `■ [Recent 5-Day Cross Signals]\n`;
        md += `- DMI_Cross: ${dmiCross}\n`;
        md += `- MA_Cross: ${maCross}\n\n`;

        md += `■ [20-Day Time Series Data]\n`;
        md += `| Date | Close | 20MA | 60MA | BB_Upper | BB_Lower | RSI | MFI | ADX | +DI | -DI | %B | Scaled_Hist | Vol_Ratio |\n`;

        // MACD autoWeight 계산 (전체 데이터 기준)
        const allLines = [...stock.macd, ...stock.macd_signal].filter(v => v !== null && !isNaN(v));
        const allHist = stock.macd_hist.filter(v => v !== null && !isNaN(v));
        const maxLineAbs = Math.max(...allLines.map(Math.abs)) || 1;
        const maxHistAbs = Math.max(...allHist.map(Math.abs)) || 1;
        const autoWeight = maxLineAbs / maxHistAbs;

        const count = 20;
        const startIdx = Math.max(0, stock.dates.length - count);
        for (let i = startIdx; i < stock.dates.length; i++) {
            let date = toKstDateStr(stock.dates[i]);  // KST 표시
            if (isPartial && i === stock.dates.length - 1) date += ' (LIVE/장중)';
            const close = stock.ohlc[i].c;
            const ma20 = stock.ma20[i];
            const ma60 = stock.ma60[i];
            const bbu = stock.bb_upper[i];
            const bbl = stock.bb_lower[i];
            const rsi = stock.rsi_list[i];
            const mfi = stock.mfi_list[i];
            const adx = stock.adx_list[i];
            const dip = stock.di_plus_list[i];
            const dim = stock.di_minus_list[i];
            const pb = stock.pb_list[i];
            const sHist = stock.macd_hist[i] * autoWeight;
            const vol = stock.volume[i];
            const v20 = stock.vol_ma20[i];
            const vRatio = (v20 > 0 && isFinite(vol)) ? (vol / v20).toFixed(2) : 'N/A';

            md += `| ${date} | ${close} | ${ma20} | ${ma60} | ${bbu} | ${bbl} | ${rsi} | ${mfi} | ${adx} | ${dip} | ${dim} | ${pb} | ${sHist.toFixed(2)} | ${vRatio} |\n`;
        }

        // 3. 클립보드 복사
        navigator.clipboard.writeText(md).then(() => {
            showToast("데이터가 클립보드에 복사되었습니다!");
        }).catch(err => {
            showError("클립보드 복사 실패: " + err);
        });

    } catch (e) {
        console.error(e);
        showError("데이터 가공 중 오류 발생");
    }
}

async function loadTemplates() {
    try {
        const fetchT = async (n) => {
            const res = await fetch(`/static/${n}.html?v=${new Date().getTime()}`);
            if (!res.ok) throw new Error(`${n}.html 로드 실패`);
            return res.text();
        };
        const [h, c, i] = await Promise.all([fetchT('header'), fetchT('charts'), fetchT('indicators')]);
        templates.header = h; templates.charts = c; templates.indicators = i;
    } catch (e) { showError(e.message); }
}

async function fetchStockData(listType = 'bookmark') {
    try {
        const grid = document.getElementById('stock-grid');
        grid.innerHTML = `<div class="loading">${listType === 'nasdaq100' ? '나스닥 100 분석 중...' : '로딩 중...'}</div>`;
        const response = await fetch(`/api/stocks?list_type=${listType}&uid=${getUid()}&t=${new Date().getTime()}`);
        if (!response.ok) throw new Error('서버 응답 오류');
        currentStocksData = await response.json();
        renderStockCards(currentStocksData);
    } catch (error) {
        showError('데이터 로드 실패: ' + error.message);
        document.getElementById('stock-grid').innerHTML = `<div class="loading">연결 오류</div>`;
    }
}

// 티커 클릭: 해당 종목만 최신(오늘 현재)으로 재계산 → 화면 갱신 → 복사
async function refreshAndCopy(ticker) {
    showToast(`🔄 ${ticker} 최신 데이터 불러오는 중...`);
    try {
        const res = await fetch(`/api/stocks/refresh?ticker=${encodeURIComponent(ticker)}&uid=${getUid()}`);
        if (!res.ok) throw new Error('새로고침 실패');
        const fresh = await res.json();
        const idx = currentStocksData.findIndex(s => s.ticker === ticker);
        if (idx >= 0) currentStocksData[idx] = fresh;
        renderStockCards(currentStocksData);   // 화면 지표/가격/차트 갱신
        copyAiRawData(ticker);                  // 갱신된 값 복사
    } catch (e) {
        showError('새로고침 실패: ' + e.message);
    }
}

// [정렬 로직 업그레이드] 
function getSortedData(data) {
    const sortType = document.getElementById('sort-selector').value;
    const direction = typeof currentSortDirection !== 'undefined' ? currentSortDirection : 'desc';

    if (sortType === 'default') return [...data];

    return [...data].sort((a, b) => {
        let scoreA, scoreB, signalA, signalB;

        // 보조 계산: 신호 개수 (RSI, MFI, PB + MA 크로스 + DI 크로스)
        const getSignalCount = (s) => {
            let count = 0;
            if (s.rsi_val >= 70) count += 1; else if (s.rsi_val <= 30) count -= 1;
            if (s.mfi_val >= 80) count += 1; else if (s.mfi_val <= 20) count -= 1;
            if (s.pb_val >= 0.8) count += 1; else if (s.pb_val <= 0.2) count -= 1;

            // MA Cross (최근 5일 이내)
            const maLen = s.ma20.length;
            for (let i = maLen - 1; i >= Math.max(1, maLen - 5); i--) {
                const p20 = s.ma20[i-1], p60 = s.ma60[i-1];
                const c20 = s.ma20[i],   c60 = s.ma60[i];
                if (p20 <= p60 && c20 > c60) { count += 1; break; }
                if (p20 >= p60 && c20 < c60) { count -= 1; break; }
            }

            // DI Cross (최근 5일 이내)
            const diLen = s.di_plus_list.length;
            for (let i = diLen - 1; i >= Math.max(1, diLen - 5); i--) {
                const pP = s.di_plus_list[i-1], pM = s.di_minus_list[i-1];
                const cP = s.di_plus_list[i],   cM = s.di_minus_list[i];
                if (pP <= pM && cP > cM) { count += 1; break; }
                if (pP >= pM && cP < cM) { count -= 1; break; }
            }
            return count;
        };
        
        // 보조 계산: 수치 합산
        const getScore = (s) => s.rsi_val + s.mfi_val + (s.pb_val * 100) + ((s.di_plus_val - s.di_minus_val) * 2);

        let primaryA, primaryB, secondaryA, secondaryB;

        switch (sortType) {
            case 'change': primaryA = a.change_pct; primaryB = b.change_pct; break;
            case 'total_change': primaryA = a.total_change_pct; primaryB = b.total_change_pct; break;
            case 'rsi': primaryA = a.rsi_val; primaryB = b.rsi_val; break;
            case 'mfi': primaryA = a.mfi_val; primaryB = b.mfi_val; break;
            case 'adx': primaryA = a.adx_val; primaryB = b.adx_val; break;
            case 'pb': primaryA = a.pb_val; primaryB = b.pb_val; break;
            case 'dmi': primaryA = a.di_plus_val - a.di_minus_val; primaryB = b.di_plus_val - b.di_minus_val; break;
            case 'tech_score': 
                primaryA = getScore(a); primaryB = getScore(b); 
                secondaryA = getSignalCount(a); secondaryB = getSignalCount(b);
                break;
            case 'tech_signal': 
                primaryA = getSignalCount(a); primaryB = getSignalCount(b); 
                secondaryA = getScore(a); secondaryB = getScore(b);
                break;
            default: return 0;
        }

        // 1순위 비교
        let diff = (direction === 'desc') ? (primaryB - primaryA) : (primaryA - primaryB);
        
        // 2순위 비교 (동률 시)
        if (diff === 0 && secondaryA !== undefined) {
            diff = (direction === 'desc') ? (secondaryB - secondaryA) : (secondaryA - secondaryB);
        }
        
        // 3순위 비교 (티커명)
        if (diff === 0) {
            diff = a.ticker.localeCompare(b.ticker);
        }

        return diff;
    });
}

// ===== 기술적 필터 (매수 후보 찾기) =====
function _recentCrossUp(arr1, arr2, days) {
    // 최근 days일 내 '가장 최근' 교차가 골든(arr1이 arr2 상향돌파)이면 true.
    // 골든 후 다시 데드로 반전된 경우는 false (현재 상태가 약세이므로).
    if (!arr1 || !arr2) return false;
    const n = Math.min(arr1.length, arr2.length);
    for (let i = n - 1; i >= Math.max(1, n - (days || 5)); i--) {
        const p1 = arr1[i - 1], p2 = arr2[i - 1], c1 = arr1[i], c2 = arr2[i];
        if (p1 == null || p2 == null || c1 == null || c2 == null) continue;
        if (p1 <= p2 && c1 > c2) return true;   // 최근 교차가 골든 → 채택
        if (p1 >= p2 && c1 < c2) return false;  // 최근 교차가 데드 → 반전됨, 제외
    }
    return false;  // 윈도우 내 교차 없음
}
function maGoldenCross(s) { return _recentCrossUp(s.ma20, s.ma60); }
function diGoldenCross(s) { return _recentCrossUp(s.di_plus_list, s.di_minus_list); }
function macdGoldenCross(s) { return _recentCrossUp(s.macd, s.macd_signal); }

function readFilters() {
    const g = id => document.getElementById(id);
    const num = (cbId, valId) => (g(cbId) && g(cbId).checked) ? parseFloat(g(valId).value) : null;
    return {
        maGc: !!(g('f-ma-gc') && g('f-ma-gc').checked),
        diGc: !!(g('f-di-gc') && g('f-di-gc').checked),
        macdGc: !!(g('f-macd-gc') && g('f-macd-gc').checked),
        rsi: num('f-rsi', 'f-rsi-val'),
        mfi: num('f-mfi', 'f-mfi-val'),
        pb: num('f-pb', 'f-pb-val'),
        adx: num('f-adx', 'f-adx-val'),
    };
}
function applyFilters(data) {
    const f = readFilters();
    return data.filter(s => {
        if (f.maGc && !maGoldenCross(s)) return false;
        if (f.diGc && !diGoldenCross(s)) return false;
        if (f.macdGc && !macdGoldenCross(s)) return false;
        if (f.rsi != null && !isNaN(f.rsi) && !(s.rsi_val < f.rsi)) return false;
        if (f.mfi != null && !isNaN(f.mfi) && !(s.mfi_val < f.mfi)) return false;
        if (f.pb != null && !isNaN(f.pb) && !(s.pb_val < f.pb)) return false;
        if (f.adx != null && !isNaN(f.adx) && !(s.adx_val > f.adx)) return false;
        return true;
    });
}

function renderStockCards(stocks) {
    const grid = document.getElementById('stock-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const filtered = applyFilters(stocks);
    const fc = document.getElementById('filter-count');
    if (fc) fc.innerText = filtered.length;
    if (!filtered.length) {
        grid.innerHTML = `<div class="loading">조건에 맞는 종목이 없습니다.</div>`;
        return;
    }
    const sorted = getSortedData(filtered);
    window.lastRenderedStocks = sorted;  // 팝업이 카드와 동일한(필터+정렬) 목록을 참조하도록

    sorted.forEach((stock, index) => {
        const card = document.createElement('div');
        card.className = 'stock-card';
        const isWon = stock.currency_symbol === '₩' || stock.currency_symbol === '\u20a9';
        
        let headerHtml = templates.header
            .replaceAll('{{ticker}}', stock.ticker).replace('{{name}}', stock.name)
            .replace('{{currency}}', stock.currency_symbol || '$').replace('{{price}}', formatValue(stock.current_price, isWon))
            .replace('{{changeClass}}', stock.change_pct >= 0 ? 'up' : 'down')
            .replace('{{changeSign}}', stock.change_pct >= 0 ? '+' : '')
            .replace('{{changePct}}', formatValue(stock.change_pct, false)) 
            .replace('{{totalChangeClass}}', stock.total_change_pct >= 0 ? 'up' : 'down')
            .replace('{{totalChangeSign}}', stock.total_change_pct >= 0 ? '+' : '')
            .replace('{{totalChangePct}}', formatValue(stock.total_change_pct, false));

        card.innerHTML = headerHtml + templates.charts.replaceAll('{{index}}', index) + 
            templates.indicators.replaceAll('{{index}}', index)
            .replace('{{rsi}}', formatValue(stock.rsi_val, false)).replace('{{rsiClass}}', getIndicatorClass(stock.rsi_val, 70, 30))
            .replace('{{mfi}}', formatValue(stock.mfi_val, false)).replace('{{mfiClass}}', getIndicatorClass(stock.mfi_val, 80, 20))
            .replace('{{adx}}', formatValue(stock.adx_val, false)).replace('{{adxClass}}', getAdxClass(stock.adx_val))
            .replace('{{di}}', `${Math.round(stock.di_plus_val)}/${Math.round(stock.di_minus_val)}`)
            .replace('{{diClass}}', getDiClass(stock.di_plus_val, stock.di_minus_val))
            .replace('{{pb}}', formatValue(stock.pb_val, false)).replace('{{pbClass}}', getIndicatorClass(stock.pb_val, 0.8, 0.2));

        grid.appendChild(card);
        
        // 지표 팝업용 컨테이너 추가
        const popup = document.createElement('div');
        popup.id = `indicator-popup-${index}`;
        popup.className = 'indicator-popup';
        popup.innerHTML = `
            <div class="indicator-popup-header">
                <span class="indicator-popup-title"></span>
                <span class="indicator-popup-close" onclick="closeIndicatorPopup(${index})">&times;</span>
            </div>
            <div id="popup-chart-${index}" class="indicator-popup-chart"></div>
        `;
        card.appendChild(popup);

        // [최적화] Intersection Observer를 이용한 레이지 로딩 (화면에 보일 때 차트 그림)
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    try {
                        renderMainChart(`#chart-main-${index}`, stock);
                        renderMacdChart(`#chart-macd-${index}`, stock);
                        renderVolChart(`#chart-vol-${index}`, stock);
                    } catch (e) { console.error(`Chart render error for ${stock.ticker}:`, e); }
                    observer.unobserve(entry.target); // 한 번 그리면 감시 종료
                }
            });
        }, {
            rootMargin: '100px', // 화면에 보이기 100px 전부터 미리 로드 시작
            threshold: 0.01
        });

        observer.observe(card);
    });
}

async function init() { await loadTemplates(); await fetchStockData(); }
init();
