function renderMainChart(selector, stock) {
    const startPrice = stock.ohlc[0].c;
    const baseRange = 0.30;

    const allValues = [
        ...stock.ohlc.map(d => d.c),
        ...stock.bb_upper,
        ...stock.bb_lower,
        ...stock.ma20, ...stock.ma60
    ].filter(v => v !== null && !isNaN(v));
    
    const actualMax = Math.max(...allValues);
    const actualMin = Math.max(0.1, Math.min(...allValues));

    let yMax = startPrice * (1 + baseRange);
    let yMin = startPrice * (1 - baseRange);

    const devUpper = (actualMax - startPrice) / startPrice;
    const devLower = (startPrice - actualMin) / startPrice;
    
    let isBreakthrough = (devUpper > baseRange || devLower > baseRange);

    if (isBreakthrough) {
        const maxDev = Math.max(devUpper, devLower);
        const scaleFactor = maxDev * 1.03; 
        yMax = startPrice * (1 + scaleFactor);
        yMin = Math.max(0.1, startPrice * (1 - scaleFactor));
    }

    const goldenData = new Array(stock.dates.length).fill(null);
    const deadData = new Array(stock.dates.length).fill(null);

    for (let i = 1; i < stock.dates.length; i++) {
        const p20 = stock.ma20[i-1], p60 = stock.ma60[i-1];
        const c20 = stock.ma20[i],   c60 = stock.ma60[i];
        if (p20 == null || p60 == null || c20 == null || c60 == null) continue;

        if (p20 <= p60 && c20 > c60) {
            goldenData[i] = c20;
        } else if (p20 >= p60 && c20 < c60) {
            deadData[i] = c20;
        }
    }

    const options = {
        series: [
            {
                name: 'BB Fill',
                type: 'rangeArea',
                data: stock.dates.map((d, i) => ({ x: d, y: [stock.bb_lower[i], stock.bb_upper[i]] }))
            },
            {
                name: 'Price',
                type: 'line',
                data: stock.dates.map((d, i) => ({ x: d, y: stock.ohlc[i].c }))
            },
            { name: '20MA', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.ma20[i] })) },
            { name: '60MA', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.ma60[i] })) },
            { name: 'BB Lower', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.bb_lower[i] })) },
            { name: 'BB Upper', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.bb_upper[i] })) },
            { name: 'Golden', type: 'scatter', data: stock.dates.map((d, i) => ({ x: d, y: goldenData[i] })) },
            { name: 'Dead', type: 'scatter', data: stock.dates.map((d, i) => ({ x: d, y: deadData[i] })) }
        ],
        chart: { 
            height: 220, 
            type: 'line', 
            toolbar: { show: false }, 
            zoom: { enabled: false },
            animations: { enabled: false }
        },
        xaxis: {
            type: 'category',
            labels: { show: false },
            axisBorder: { show: false },
            axisTicks: { show: false },
            crosshairs: { show: true, stroke: { color: '#94a3b8', width: 1, dashArray: 3 } },
            tooltip: { enabled: true, formatter: function(v) { try { return (typeof toKstDateStr === 'function' && v) ? toKstDateStr(v) : v; } catch (e) { return v; } } }
        },
        yaxis: { 
            min: yMin, 
            max: yMax, 
            labels: { show: false }, 
            axisBorder: { show: false }, 
            axisTicks: { show: false } 
        },
        grid: { show: false },
        legend: { show: false },
        stroke: { 
            width: [0, 3, 2, 2, 2, 2, 0, 0], 
            curve: 'straight',
            dashArray: [0, 0, 0, 0, 6, 6, 0, 0]
        },
        colors: ['#e1f5fe', '#111', '#27ae60', '#f1c40f', '#007aff', '#ff3b30', '#ff3b30', '#007aff'],
        fill: {
            type: 'solid',
            opacity: [0.6, 1, 1, 1, 1, 1, 1, 1] 
        },
        markers: {
            size: 0
        },
        annotations: {
            yaxis: isBreakthrough ? [
                {
                    y: startPrice * 1.3,
                    borderColor: '#d1d1d1',
                    strokeDashArray: 5,
                    borderWidth: 1.5,
                    label: { show: false }
                },
                {
                    y: startPrice * 0.7,
                    borderColor: '#d1d1d1',
                    strokeDashArray: 5,
                    borderWidth: 1.5,
                    label: { show: false }
                }
            ] : []
        },
        tooltip: {
            enabled: true, shared: false, intersect: false, followCursor: true,
            custom: function({ dataPointIndex }) {
                try {
                    const d = stock.dates[dataPointIndex];
                    const kst = (typeof toKstDateStr === 'function' && d) ? toKstDateStr(d) : d;
                    const o = stock.ohlc[dataPointIndex];
                    const c = o ? o.c : '';
                    return '<div style="padding:5px 9px;font-size:11px;font-weight:700;">' + kst +
                           '<br><span style="color:#666;font-weight:600;">종가 ' + c + '</span></div>';
                } catch (e) { return ''; }
            }
        }
    };

    const container = document.querySelector(selector);
    if (container) {
        container.innerHTML = '';
        new ApexCharts(container, options).render();
    }
}
