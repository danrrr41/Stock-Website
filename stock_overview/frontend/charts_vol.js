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
            sparkline: { enabled: true }
        },
        tooltip: { enabled: false }, // 툴팁 위치 수정 (차트 밖으로)
        stroke: {
            width: [0, 1.5, 1.5], 
            curve: 'smooth'
        },
        // 회색(막대), 오렌지(5MA), 초록(20MA)
        colors: ['#b2bec3', '#ff9f43', '#27ae60'],
        yaxis: { 
            min: 0,
            max: max * 1.05 
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
