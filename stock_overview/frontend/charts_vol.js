function renderVolChart(selector, stock) {
    const max = Math.max(...stock.volume);

    const options = {
        series: [
            { 
                name: 'Volume', 
                type: 'bar', 
                data: stock.volume.map((v, i) => ({
                    x: stock.dates[i],
                    y: v,
                    fillColor: stock.ohlc[i].c >= stock.ohlc[i].o ? '#ff3b30' : '#007aff'
                }))
            },
            { name: 'Vol 5MA', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.vol_ma5[i] })) },
            { name: 'Vol 20MA', type: 'line', data: stock.dates.map((d, i) => ({ x: d, y: stock.vol_ma20[i] })) }
        ],
        chart: {
            height: 70,
            type: 'line',
            toolbar: { show: false },
            animations: { enabled: false },
            parentHeightOffset: 0
        },
        tooltip: {
            enabled: true, shared: true, intersect: false,
            custom: function({ dataPointIndex }) {
                try {
                    const d = stock.dates[dataPointIndex];
                    const kst = (typeof toKstDateStr === 'function' && d) ? toKstDateStr(d) : d;
                    const v = stock.volume[dataPointIndex];
                    return '<div style="padding:4px 8px;font-size:11px;font-weight:700;">' + kst +
                        '<br><span style="color:#666;font-weight:600;">거래량 ' + (v != null ? Number(v).toLocaleString('en-US') : '-') + '</span></div>';
                } catch (e) { return ''; }
            }
        },
        stroke: {
            width: [0, 1.5, 1.5],
            curve: 'smooth'
        },
        // 회색(막대), 오렌지(5MA), 초록(20MA)
        colors: ['#b2bec3', '#ff9f43', '#27ae60'],
        xaxis: {
            type: 'category', labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false },
            crosshairs: { show: true, stroke: { color: '#94a3b8', width: 1, dashArray: 3 } },
            tooltip: { enabled: true, formatter: function(v) { try { return (typeof toKstDateStr === 'function' && v) ? toKstDateStr(v) : v; } catch (e) { return v; } } }
        },
        yaxis: {
            min: 0,
            max: max * 1.05,
            labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false }
        },
        grid: { show: false, padding: { top: 0, bottom: 0, left: 0, right: 0 } },
        legend: { show: false }
    };

    const container = document.querySelector(selector);
    if (container) {
        container.innerHTML = '';
        new ApexCharts(container, options).render();
    }
}
