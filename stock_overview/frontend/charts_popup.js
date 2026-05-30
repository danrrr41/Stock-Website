function showIndicatorPopup(type, index, event) {
    if (event) event.stopPropagation();

    // 기존에 열려있는 모든 팝업 닫기
    closeAllIndicatorPopups();

    const stock = getSortedData(currentStocksData)[index];
    const popup = document.getElementById(`indicator-popup-${index}`);
    const chartContainer = document.getElementById(`popup-chart-${index}`);
    const title = popup.querySelector('.indicator-popup-title');

    if (!stock || !popup || !chartContainer) return;

    // 팝업 표시 및 위치 조정
    popup.style.display = 'block';
    
    // 현재 값 가져오기
    let currentVal = 0;
    let label = type.toUpperCase();
    switch(type) {
        case 'rsi': currentVal = stock.rsi_val; break;
        case 'mfi': currentVal = stock.mfi_val; break;
        case 'adx': currentVal = stock.adx_val; break;
        case 'di': 
            currentVal = stock.di_plus_val; 
            label = '+DI / -DI';
            break;
        case 'pb': 
            currentVal = stock.pb_val; 
            label = '%B';
            break;
    }
    title.innerText = label;

    let data = [], dates = stock.dates_60, annotations = [], yMin = 0, yMax = 100;
    let series = [];
    let colors = ['#111'];
    let markers = { size: 0 };

    const getMinMax = (list) => {
        const valid = list.filter(v => v !== null && !isNaN(v));
        return { min: Math.min(...valid), max: Math.max(...valid) };
    };

    switch(type) {
        case 'rsi':
            data = stock.rsi_list;
            series = [{ name: 'RSI', data: data }];
            const rsiRange = getMinMax(data);
            yMin = Math.min(0, rsiRange.min * 0.9);
            yMax = Math.max(100, rsiRange.max * 1.1);
            annotations = [
                { y: 70, borderColor: '#ff3b30', strokeDashArray: 3 },
                { y: 30, borderColor: '#007aff', strokeDashArray: 3 }
            ];
            break;
        case 'mfi':
            data = stock.mfi_list;
            series = [{ name: 'MFI', data: data }];
            const mfiRange = getMinMax(data);
            yMin = Math.min(0, mfiRange.min * 0.9);
            yMax = Math.max(100, mfiRange.max * 1.1);
            annotations = [
                { y: 80, borderColor: '#ff3b30', strokeDashArray: 3 },
                { y: 20, borderColor: '#007aff', strokeDashArray: 3 }
            ];
            break;
        case 'adx':
            data = stock.adx_list;
            series = [{ name: 'ADX', data: data }];
            colors = ['#111'];
            const adxRange = getMinMax(data);
            yMin = 0;
            yMax = Math.max(60, adxRange.max * 1.1);
            annotations = [
                { y: 40, borderColor: '#ff3b30', strokeDashArray: 3 },
                { y: 25, borderColor: '#ff9f43', strokeDashArray: 3 }
            ];
            break;
        case 'di':
            const diGolden = new Array(dates.length).fill(null);
            const diDead = new Array(dates.length).fill(null);
            for (let i = 1; i < dates.length; i++) {
                const pP = stock.di_plus_list[i-1], pM = stock.di_minus_list[i-1];
                const cP = stock.di_plus_list[i],   cM = stock.di_minus_list[i];
                if (pP <= pM && cP > cM) diGolden[i] = cP;
                else if (pP >= pM && cP < cM) diDead[i] = cP;
            }

            series = [
                { name: '+DI', type: 'line', data: stock.di_plus_list || [] },
                { name: '-DI', type: 'line', data: stock.di_minus_list || [] }
            ];
            colors = ['#ff3b30', '#007aff'];
            markers = { size: 0 };
            const allDiValues = [...(stock.di_plus_list || []), ...(stock.di_minus_list || [])];
            const diRange = getMinMax(allDiValues);
            yMin = 0;
            yMax = Math.max(50, diRange.max * 1.1);
            annotations = [];
            break;
        case 'pb':
            data = stock.pb_list;
            series = [{ name: '%B', data: data }];
            const pbRange = getMinMax(data);
            yMin = Math.min(0, pbRange.min - 0.1);
            yMax = Math.max(1, pbRange.max + 0.1);
            annotations = [
                { y: 0, borderColor: '#007aff', strokeDashArray: 2 },
                { y: 1, borderColor: '#ff3b30', strokeDashArray: 2 }
            ];
            break;
    }

    const options = {
        series: series,
        chart: {
            height: 120,
            type: 'line',
            animations: { enabled: false },
            toolbar: { show: false },
            zoom: { enabled: false },
            sparkline: { enabled: true }
        },
        stroke: { width: 2, curve: 'smooth' },
        colors: colors,
        grid: { show: false },
        legend: { show: false },
        markers: markers,
        xaxis: { 
            categories: dates,
            labels: { show: false },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: { 
            min: yMin, 
            max: yMax,
            labels: { show: false },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        annotations: { yaxis: annotations },
        tooltip: { enabled: false }
    };

    chartContainer.innerHTML = '';
    new ApexCharts(chartContainer, options).render();

    // ESC 키로 닫기 및 외부 클릭 시 닫기
    const closeHandler = (e) => {
        if (e.key === 'Escape' || (!popup.contains(e.target) && !e.target.closest('.indicator-item'))) {
            closeIndicatorPopup(index);
            document.removeEventListener('click', closeHandler);
            document.removeEventListener('keydown', closeHandler);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
        document.addEventListener('keydown', closeHandler);
    }, 10);
}

function closeIndicatorPopup(index) {
    const popup = document.getElementById(`indicator-popup-${index}`);
    if (popup) popup.style.display = 'none';
}

function closeAllIndicatorPopups() {
    document.querySelectorAll('.indicator-popup').forEach(popup => {
        popup.style.display = 'none';
    });
}
