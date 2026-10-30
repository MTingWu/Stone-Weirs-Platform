// 等待 HTML 文件完全載入後再執行
document.addEventListener('DOMContentLoaded', () => {

    // --- 變數初始化 ---
    const MAP_CONFIG = {
        center: [23.746680, 119.609263],
        // zoom: 15,
        apiPath: '/api/weirs' // 後端 API (資料來自 PostgreSQL/PostGIS)
    };

    const desktopZoom = 15; // 電腦版的縮放等級
    const mobileZoom = 14;  // 手機版的縮放等級 (數字越小，看得越遠)
    const breakpointWidth = 768; // 區分手機/電腦的寬度分界點

    const initialZoom = window.innerWidth < breakpointWidth ? mobileZoom : desktopZoom;

    const TYPE_COLORS = {
        "曲線形": "#00ff22ff",
        "單滬房": "#fffb20ff",
        "雙滬房": "#ff28f4ff",
        "三滬房": "#02a2ffff"
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
    // const map = L.map('map').setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
    // const map = L.map('map', { zoomControl: false }).setView(MAP_CONFIG.center, initialZoom);
    // map.zoomControl.setPosition('topright');
    // L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    //     attribution: '© OpenStreetMap contributors'
    // }).addTo(map);

    const map = L.map('map', {
    zoomControl: false // 1. 先告訴地圖不要建立「預設」的縮放按鈕
    }).setView(MAP_CONFIG.center, initialZoom);

    // 2. 然後，我們「手動」建立一個新的縮放按鈕，並直接指定它的位置
    L.control.zoom({
        position: 'topright'
    }).addTo(map);

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
    
    // 資料來源標示 (顯示在地圖右下角)
    map.attributionControl.addAttribution('石滬位置資料：參考自曾宥輯 (國立澎湖科技大學) 碩士論文');

    const markerGroup = L.layerGroup().addTo(map);

    // --- 主要功能函數 ---

    // 顯示/隱藏讀取提示
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

            // 把 API 的欄位轉成下面各函式使用的格式 (維持原本畫地圖、圖表的程式不變)
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
            
            if (!isNaN(lat) && !isNaN(lng)) {
                // const marker = L.circleMarker([lat, lng], {
                //     radius: 4,
                //     color: TYPE_COLORS[row.Type] || "gray",
                //     fillColor: TYPE_COLORS[row.Type] || "gray",
                //     fillOpacity: 0.8,
                //     weight: 2
                // });

                // ... in updateMap function
                // 🌟 1. 將 L.circleMarker 更換為 L.circle
                const marker = L.circle([lat, lng], {
                    radius: 20, // 🌟 2. 單位已變為「公尺」，需要一個較大的值
                    color: TYPE_COLORS[row.Type] || "gray",
                    fillColor: TYPE_COLORS[row.Type] || "gray",
                    fillOpacity: 0.8,
                    weight: 2
                });
// ...

                const popupHTML = `
                    <h4>石滬編號：${row.ID}</h4>
                    <p><strong>類型：</strong>${row.Type}</p>
                    <p><strong>小潮低潮位 (MLWN)：</strong>${row.MLWN_check && row.MLWN_check.includes("1") ? "✅" : "❌"} </p>
                    <p><strong>小潮高潮位 (MHWN)：</strong>${row.MHWN && row.MHWN.includes("完全") ? "✅" : "❌"} </p>
                    `;
                marker.bindPopup(popupHTML);
                markerGroup.addLayer(marker);
            }
        });
    }

    // 初始化篩選器
    function initFilterControls(data) {
        filterContainer.innerHTML = '';
        const desiredOrder = ["曲線形", "單滬房", "雙滬房", "三滬房"];
        const allTypesInFile = new Set(data.map(d => d.Type));
        const sortedTypes = desiredOrder.filter(type => allTypesInFile.has(type));
        
        sortedTypes.forEach(type => {
            const id = "filter_" + type.replace(/\s+/g, '_');
            const html = `
                <div class="type-checkbox">
                    <input type="checkbox" id="${id}" value="${type}" checked>
                    <label for="${id}">
                        <span style="color: ${TYPE_COLORS[type] || 'gray'};">●</span> ${type}
                    </label>
                </div>`;
            filterContainer.insertAdjacentHTML('beforeend', html);
        });
        
        filterContainer.addEventListener('change', handleFilterChange);
    }

    // 處理篩選變更
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
            // 確保欄位名稱與您的 CSV 檔一致 (這裡假設是 'Type', 'MLWN_check', 'MHWN')
            const type = row.Type;
            if (!summary[type]) summary[type] = { MLWNok: 0, MHWNok: 0, total: 0 };
            summary[type].total++;
            if (row.MLWN_check && row.MLWN_check.includes("1")) summary[type].MLWNok++;
            if (row.MHWN && row.MHWN.includes("完全")) summary[type].MHWNok++;
        });

        // 🌟 --- 以下是主要修改的部分 --- 🌟

        // 1. 定義您想要的圖表X軸順序
        const desiredOrder = ["曲線形", "單滬房", "雙滬房", "三滬房"];

        // 2. 依照 desiredOrder 排序 labels，並只保留當前篩選資料中存在的類型
        const labels = desiredOrder.filter(type => summary.hasOwnProperty(type));

        // 🌟 --- 修改結束 --- 🌟
        
        const mlwnData = labels.map(t => (summary[t].MLWNok / summary[t].total * 100) || 0);
        const mhwnData = labels.map(t => (summary[t].MHWNok / summary[t].total * 100) || 0);

        if (myChart) myChart.destroy();
        
        myChart = new Chart(chartCanvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '低潮位狀況良好', // 標籤可以拿掉 %
                    data: mlwnData,
                    backgroundColor: '#87ceeb',
                    borderColor: '#4a90e2',
                    borderWidth: 2
                }, {
                    label: '高潮位狀況良好', // 標籤可以拿掉 %
                    data: mhwnData,
                    backgroundColor: '#ff7f7f',
                    borderColor: '#ff6b6b',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                scales: { 
                    y: { 
                        beginAtZero: true, 
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%'; // 在 Y 軸刻度加上 %
                            }
                        }
                    } 
                },
                plugins: {
                    title: { display: true, text: '各類型石滬狀況統計' },
                    legend: { labels: { color: 'gray' } },
                    
                    // 🌟 --- 以下是新增的程式碼 --- 🌟
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                // 獲取資料集的標籤，例如 '低潮位狀況良好'
                                let label = context.dataset.label || '';

                                // 獲取當前長條圖對應的石滬類型，例如 '曲線形'
                                const type = context.label;
                                const total = summary[type].total;
                                let count = 0;

                                // 判斷是低潮位還是高潮位的資料
                                if (context.datasetIndex === 0) { // 第一個資料集 (低潮位)
                                    count = summary[type].MLWNok;
                                } else { // 第二個資料集 (高潮位)
                                    count = summary[type].MHWNok;
                                }

                                // 獲取百分比值並格式化到小數點後一位
                                const percentage = context.parsed.y.toFixed(1);

                                // 組合最終要顯示的文字
                                return `${label}: ${percentage}% (${count} / ${total})`;
                            }
                        }
                    }
                    // 🌟 --- 新增程式碼結束 --- 🌟
                }
            }
        });
    }
    
    // --- 事件監聽 ---
    
    // 手機版側邊欄開關
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // 點擊地圖時，如果側邊欄是開的，就關閉它
    map.on('click', () => {
        if (sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }
    });
    // 監聽整個頁面的點擊事件，用來關閉圖表資訊框
    document.addEventListener('click', function(event) {
        // 檢查點擊的目標是否是圖表畫布 (chartCanvas) 或其子元素
        const isClickInsideChart = chartCanvas.contains(event.target);

        // 如果點擊位置不在圖表內，且資訊框是開啟的，就將其關閉
        if (!isClickInsideChart && myChart && myChart.tooltip && myChart.tooltip.getActiveElements().length > 0) {
            myChart.tooltip.setActiveElements([], { x: 0, y: 0 });
            myChart.update();
        }
    });
    
    // --- 程式進入點 ---
    loadData();
});