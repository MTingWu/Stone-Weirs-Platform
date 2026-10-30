// 等待 HTML 文件完全載入後再執行
document.addEventListener('DOMContentLoaded', () => {

    // --- 設定 ---
    const MAP_CONFIG = {
        center: [23.746680, 119.609263],
        apiPath: '/api/weirs' // 後端 API (資料來自 PostgreSQL/PostGIS)
    };

    const desktopZoom = 15;
    const mobileZoom = 14;
    const breakpointWidth = 768;
    const initialZoom = window.innerWidth < breakpointWidth ? mobileZoom : desktopZoom;

    // 四種類型的標記顏色：色相差異大，在黑白影像上仍明顯，
    // 但降低飽和度，與側邊欄的米白、深灰協調
    const TYPE_COLORS = {
        "曲線形": "#5fc4b8", // 海玻璃青
        "單滬房": "#f2c14e", // 潮線沙金
        "雙滬房": "#e8744f", // 礁石珊瑚橘
        "三滬房": "#a98bd9"  // 淡紫
    };

    const TYPE_ORDER = ["曲線形", "單滬房", "雙滬房", "三滬房"];

    // 圖例用的石滬形狀示意 (曲線形為單一弧牆，其餘為 1～3 個滬房)
    const INK = "#2e3438";
    const TYPE_SHAPES = {
        "曲線形": `<path d="M4 23 Q20 -5 36 23" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
                   <circle cx="20" cy="9" r="3.5" fill="COLOR" stroke="${INK}" stroke-width="1"/>`,
        "單滬房": `<circle cx="20" cy="14" r="9" fill="none" stroke="${INK}" stroke-width="1.8"/>
                   <circle cx="20" cy="14" r="3.5" fill="COLOR" stroke="${INK}" stroke-width="1"/>`,
        "雙滬房": `<circle cx="14" cy="14" r="8" fill="none" stroke="${INK}" stroke-width="1.8"/>
                   <circle cx="26" cy="14" r="8" fill="none" stroke="${INK}" stroke-width="1.8"/>
                   <circle cx="20" cy="14" r="3.5" fill="COLOR" stroke="${INK}" stroke-width="1"/>`,
        "三滬房": `<circle cx="13" cy="19" r="6" fill="none" stroke="${INK}" stroke-width="1.8"/>
                   <circle cx="27" cy="19" r="6" fill="none" stroke="${INK}" stroke-width="1.8"/>
                   <circle cx="20" cy="9" r="6" fill="none" stroke="${INK}" stroke-width="1.8"/>
                   <circle cx="20" cy="16" r="3.5" fill="COLOR" stroke="${INK}" stroke-width="1"/>`
    };

    // 圖表顏色
    const CHART_COLORS = {
        low: "#5f8a8b",  // 海水青
        high: "#b8582e", // 礁石鏽橘
        text: "#2e3438",
        grid: "#d8d1bf"
    };

    let allData = [];
    let myChart = null;

    // --- DOM 元素 ---
    const loader = document.getElementById('loader');
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const filterContainer = document.getElementById("filter-controls");
    const chartCanvas = document.getElementById("chart");

    // --- 地圖初始化 ---
    const map = L.map('map', { zoomControl: false }).setView(MAP_CONFIG.center, initialZoom);
    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const tile_low = L.tileLayer('assets/tiles/2/{z}/{x}/{y}.png');
    const tile_high = L.tileLayer('assets/tiles/1/{z}/{x}/{y}.png');
    tile_low.addTo(map);

    L.control.layers(null, {
        "小潮低潮(MLWN)影像": tile_low,
        "小潮高潮(MHWN)影像": tile_high
    }).addTo(map);

    map.attributionControl.addAttribution('石滬位置資料：參考自曾宥輯 (國立澎湖科技大學) 碩士論文');

    const markerGroup = L.layerGroup().addTo(map);

    // --- 主要功能函數 ---

    function showLoader(show) {
        loader.style.display = show ? 'flex' : 'none';
    }

    // 從後端 API 載入石滬資料
    async function loadData() {
        showLoader(true);
        try {
            const res = await fetch(MAP_CONFIG.apiPath);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (!json.success || json.data.length === 0) {
                alert('找不到石滬資料。');
                return;
            }

            // 把 API 欄位轉成下面各函式使用的格式
            allData = json.data.map(w => ({
                ID: w.id,
                Type: w.type,
                Latitude: w.lat,
                Longtitude: w.lng,
                MLWN_check: w.mlwn_ok ? "1" : "0",
                MHWN: w.mhwn_ok ? "完全淹沒" : (w.mhwn_status || "")
            }));
            console.log(`成功載入 ${allData.length} 筆資料`);

            initFilterControls(allData);
            updateMap(allData);
            updateChart(allData);
        } catch (err) {
            console.error('石滬資料載入失敗:', err);
            alert('無法從伺服器載入石滬資料，請稍後再試。');
        } finally {
            showLoader(false);
        }
    }

    // 更新地圖上的標記
    function updateMap(data) {
        markerGroup.clearLayers();
        data.forEach(row => {
            const lat = parseFloat(row.Latitude);
            const lng = parseFloat(row.Longtitude);
            if (isNaN(lat) || isNaN(lng)) return;

            const color = TYPE_COLORS[row.Type] || "gray";

            // 半徑單位為公尺；白色外框讓標記在深色影像上更清楚
            const marker = L.circle([lat, lng], {
                radius: 20,
                color: "#ffffff",
                weight: 1.5,
                fillColor: color,
                fillOpacity: 0.9
            });

            const mlwnGood = row.MLWN_check && row.MLWN_check.includes("1");
            const mhwnFull = row.MHWN && row.MHWN.includes("完全");

            const popupHTML = `
                <h4>石滬編號 ${row.ID}</h4>
                <p class="popup-type"><span class="popup-dot" style="background:${color}"></span>${row.Type}</p>
                <dl class="popup-list">
                    <dt>小潮低潮位 (MLWN)</dt>
                    <dd>${mlwnGood ? "狀況良好" : "未達良好"}</dd>
                    <dt>小潮高潮位 (MHWN)</dt>
                    <dd>${mhwnFull ? "完全淹沒" : "未完全淹沒"}</dd>
                </dl>`;
            marker.bindPopup(popupHTML);
            markerGroup.addLayer(marker);
        });
    }

    // 初始化篩選器 (圖例以石滬形狀示意)
    function initFilterControls(data) {
        filterContainer.innerHTML = '';
        const typesInData = new Set(data.map(d => d.Type));
        const sortedTypes = TYPE_ORDER.filter(type => typesInData.has(type));

        sortedTypes.forEach(type => {
            const id = "filter_" + type.replace(/\s+/g, '_');
            const color = TYPE_COLORS[type] || 'gray';
            const svg = `<svg viewBox="0 0 40 28" aria-hidden="true">${TYPE_SHAPES[type].replace(/COLOR/g, color)}</svg>`;
            const html = `
                <div class="type-checkbox">
                    <input type="checkbox" id="${id}" value="${type}" checked>
                    <label for="${id}">${svg}<span>${type}</span></label>
                </div>`;
            filterContainer.insertAdjacentHTML('beforeend', html);
        });
        filterContainer.insertAdjacentHTML('beforeend', '<p class="legend-note">圖例為形狀示意，圓點顏色對應地圖標記。</p>');

        filterContainer.addEventListener('change', handleFilterChange);
    }

    function handleFilterChange() {
        const checkedTypes = Array.from(filterContainer.querySelectorAll('input:checked')).map(input => input.value);
        const filteredData = allData.filter(d => checkedTypes.includes(d.Type));
        updateMap(filteredData);
        updateChart(filteredData);
    }

    // 更新統計圖表
    function updateChart(data) {
        const summary = {};
        data.forEach(row => {
            const type = row.Type;
            if (!summary[type]) summary[type] = { MLWNok: 0, MHWNok: 0, total: 0 };
            summary[type].total++;
            if (row.MLWN_check && row.MLWN_check.includes("1")) summary[type].MLWNok++;
            if (row.MHWN && row.MHWN.includes("完全")) summary[type].MHWNok++;
        });

        const labels = TYPE_ORDER.filter(type => summary.hasOwnProperty(type));
        const mlwnData = labels.map(t => (summary[t].MLWNok / summary[t].total * 100) || 0);
        const mhwnData = labels.map(t => (summary[t].MHWNok / summary[t].total * 100) || 0);

        if (myChart) myChart.destroy();

        Chart.defaults.font.family = "'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
        Chart.defaults.color = CHART_COLORS.text;

        myChart = new Chart(chartCanvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '低潮位狀況良好',
                    data: mlwnData,
                    backgroundColor: CHART_COLORS.low,
                    borderWidth: 0
                }, {
                    label: '高潮位狀況良好',
                    data: mhwnData,
                    backgroundColor: CHART_COLORS.high,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: { grid: { display: false } },
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: CHART_COLORS.grid },
                        ticks: { callback: value => value + '%' }
                    }
                },
                plugins: {
                    title: { display: true, text: '各類型石滬狀況統計', color: CHART_COLORS.text },
                    legend: { labels: { color: CHART_COLORS.text, boxWidth: 12, boxHeight: 12 } },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const label = context.dataset.label || '';
                                const type = context.label;
                                const total = summary[type].total;
                                const count = context.datasetIndex === 0 ? summary[type].MLWNok : summary[type].MHWNok;
                                const percentage = context.parsed.y.toFixed(1);
                                return `${label}: ${percentage}% (${count} / ${total})`;
                            }
                        }
                    }
                }
            }
        });
    }

    // --- 事件監聽 ---

    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    map.on('click', () => {
        if (sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }
    });

    // 點擊圖表以外的地方時，關閉圖表資訊框
    document.addEventListener('click', function (event) {
        const isClickInsideChart = chartCanvas.contains(event.target);
        if (!isClickInsideChart && myChart && myChart.tooltip && myChart.tooltip.getActiveElements().length > 0) {
            myChart.tooltip.setActiveElements([], { x: 0, y: 0 });
            myChart.update();
        }
    });

    // --- 程式進入點 ---
    loadData();
});
