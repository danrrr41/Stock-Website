function renderMacdChart(selector, stock) {
    const allLines = [...stock.macd, ...stock.macd_signal].filter(v => v !== null && !isNaN(v));
    const allHist = stock.macd_hist.filter(v => v !== null && !isNaN(v));
    
    // 1. 선 지표와 히스토그램의 최대 절댓값 각각 계산
    const maxLineAbs = Math.max(...allLines.map(Math.abs)) || 1;
    const maxHistAbs = Math.max(...allHist.map(Math.abs)) || 1;
    
    // 2. 자동 가중치 계산 (패턴 분석 최적화)
    const autoWeight = maxLineAbs / maxHistAbs;
    
    // 3. 전체 차트의 다이나믹 스케일 (3% 여백)
    const dynamicMax = maxLineAbs * 1.03;

    const options = {
        series: [
            { 
                name: 'Hist', 
                type: 'bar', 
                data: stock.dates.map((d, i) => ({
                    x: d, 
                    y: stock.macd_hist[i] * autoWeight, 
                    fillColor: stock.macd_hist[i] >= 0 ? '#ff3b30' : '#007aff'
                }))
            },
            { name: 'MACD', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.macd[i] })) },
            { name: 'Signal', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.macd_signal[i] })) }
        ],
        chart: { 
            height: 100, 
            type: 'line', 
            toolbar: { show: false },
            animations: { enabled: false },
            sparkline: { enabled: true }
        },
        tooltip: { enabled: false },
        colors: ['#b2bec3', '#2980b9', '#e67e22'], 
        stroke: { width: [0, 2.5, 2] },
        yaxis: { 
            min: -dynamicMax, 
            max: dynamicMax 
        },
        grid: { show: false },
        legend: { show: false }
    };

    const container = document.querySelector(selector);
    if (container) {
        container.innerHTML = '';
        new ApexCharts(container, options).render();
    }
}
