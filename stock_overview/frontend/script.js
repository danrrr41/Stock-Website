// 전역 변수
let currentStocksData = [];
const templates = { header: '', charts: '', indicators: '' };

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

        // 2. 텍스트 가공
        let md = `[Stock Overview Pro - AI Technical Analysis Raw Data]\n`;
        md += `Ticker: ${stock.ticker} (${stock.name})\n`;
        md += `Current_Price: ${stock.current_price.toFixed(2)} (Currency: ${stock.currency_symbol})\n`;
        md += `Daily_Change_Pct: ${stock.change_pct.toFixed(2)}%\n`;
        md += `60B_Total_Change_Pct: ${stock.total_change_pct.toFixed(2)}%\n\n`;

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
            const date = stock.dates[i];
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
            const v20 = stock.vol_ma20[i] || 1;
            const vRatio = (vol / v20).toFixed(2);

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
        const response = await fetch(`/api/stocks?list_type=${listType}&t=${new Date().getTime()}`);
        if (!response.ok) throw new Error('서버 응답 오류');
        currentStocksData = await response.json();
        renderStockCards(currentStocksData);
    } catch (error) {
        showError('데이터 로드 실패: ' + error.message);
        document.getElementById('stock-grid').innerHTML = `<div class="loading">연결 오류</div>`;
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

function renderStockCards(stocks) {
    const grid = document.getElementById('stock-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const sorted = getSortedData(stocks);

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
