function renderMainChart(selector, stock) {
    const opts = (typeof getChartOpts === 'function') ? getChartOpts() : { bb: true, ma5: false, ma20: true, ma60: true, ma120: false };
    const startPrice = stock.ohlc[0].c;
    const baseRange = 0.30;

    // y축 범위는 실제 표시되는 오버레이만 반영
    const rangeVals = [...stock.ohlc.map(d => d.c)];
    if (opts.bb) rangeVals.push(...(stock.bb_upper || []), ...(stock.bb_lower || []));
    if (opts.ma5) rangeVals.push(...(stock.ma5 || []));
    if (opts.ma20) rangeVals.push(...(stock.ma20 || []));
    if (opts.ma60) rangeVals.push(...(stock.ma60 || []));
    if (opts.ma120) rangeVals.push(...(stock.ma120 || []));
    const allValues = rangeVals.filter(v => v !== null && v !== undefined && !isNaN(v));

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

    // ===== 옵션에 따라 동적으로 시리즈 구성 (color/width/dash 정렬 유지) =====
    const series = [], colors = [], widths = [], dashes = [], fillOp = [];
    const add = (s, c, w, dash, op) => { series.push(s); colors.push(c); widths.push(w); dashes.push(dash); fillOp.push(op); };
    const D = (arr) => stock.dates.map((d, i) => ({ x: d, y: (arr || [])[i] }));

    if (opts.bb) add({ name: 'BB Fill', type: 'rangeArea', data: stock.dates.map((d, i) => ({ x: d, y: [stock.bb_lower[i], stock.bb_upper[i]] })) }, '#e1f5fe', 0, 0, 0.6);
    add({ name: 'Price', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.ohlc[i].c })) }, '#111', 3, 0, 1);
    if (opts.ma5) add({ name: '5MA', type: 'line', data: D(stock.ma5) }, '#9b59b6', 1.5, 0, 1);
    if (opts.ma20) add({ name: '20MA', type: 'line', data: D(stock.ma20) }, '#27ae60', 2, 0, 1);
    if (opts.ma60) add({ name: '60MA', type: 'line', data: D(stock.ma60) }, '#f1c40f', 2, 0, 1);
    if (opts.ma120) add({ name: '120MA', type: 'line', data: D(stock.ma120) }, '#e67e22', 2, 0, 1);
    if (opts.bb) {
        add({ name: 'BB Lower', type: 'line', data: D(stock.bb_lower) }, '#007aff', 2, 6, 1);
        add({ name: 'BB Upper', type: 'line', data: D(stock.bb_upper) }, '#ff3b30', 2, 6, 1);
    }
    add({ name: 'Golden', type: 'scatter', data: stock.dates.map((d, i) => ({ x: d, y: goldenData[i] })) }, '#ff3b30', 0, 0, 1);
    add({ name: 'Dead', type: 'scatter', data: stock.dates.map((d, i) => ({ x: d, y: deadData[i] })) }, '#007aff', 0, 0, 1);

    const options = {
        series: series,
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
            width: widths,
            curve: 'straight',
            dashArray: dashes
        },
        colors: colors,
        fill: {
            type: 'solid',
            opacity: fillOp
        },
        markers: {
            size: 0,
            hover: { size: 0, sizeOffset: 0 }
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
            enabled: true, shared: true, intersect: false,
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
