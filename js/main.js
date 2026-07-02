/**
 * PRO Portfolio - 全景看板前端核心逻辑
 */

const state = {
    funds: {},
    totalCost: 0,
    totalAssets: 0,
    charts: [],
    currentSort: { key: 'cost', order: 'desc' }
};

// 工具函数
const formatMoney = (num) => Number(num).toFixed(2);
const formatRate = (num) => (num > 0 ? '+' : '') + Number(num).toFixed(2) + '%';
const getColorClass = (val) => val > 0 ? 'up' : (val < 0 ? 'down' : 'neutral');
const getBgColorClass = (val) => val > 0 ? 'bg-up' : (val < 0 ? 'bg-down' : 'bg-neutral');

// ======================== 初始化 ========================
function initApp() {
    if (typeof MY_HOLDINGS === 'undefined' || MY_HOLDINGS.length === 0) {
        document.getElementById('view-home').innerHTML = '<div style="padding:40px;color:var(--text-muted)">无数据。</div>';
        return;
    }

    MY_HOLDINGS.forEach(item => {
        let latestNav = item.cost_price;
        if (item.netWorthTrend && item.netWorthTrend.length > 0) {
            latestNav = item.netWorthTrend[item.netWorthTrend.length - 1].y || latestNav;
        }
        state.funds[item.code] = {
            ...item,
            gsz: latestNav, 
            gszzl: 0,
            gztime: '--',
            calculatedTotalPnl: 0,
            calculatedTotalRate: 0,
            calculatedTodayPnl: 0
        };
        state.totalCost += (item.cost_price * item.shares);
    });

    // 并发请求所有盘中估值，等待全部分析完毕后进行渲染
    fetchRealTimeEstimates();

    // 窗口自适应
    window.addEventListener('resize', () => {
        state.charts.forEach(c => c && c.resize && c.resize());
    });
}

function setSort(key) {
    if(state.currentSort.key === key) {
        state.currentSort.order = state.currentSort.order === 'desc' ? 'asc' : 'desc';
    } else {
        state.currentSort.key = key;
        state.currentSort.order = 'desc';
    }
    
    // 更新UI
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.querySelector('.sort-icon').innerText = '';
        if(btn.dataset.sort === key) {
            btn.classList.add('active');
            btn.querySelector('.sort-icon').innerText = state.currentSort.order === 'desc' ? '↓' : '↑';
        }
    });
    
    renderFundGrid();

    // 修复：重建卡片后，必须重新填充动态数据
    Object.keys(state.funds).forEach(code => {
        if(state.funds[code].gztime !== '--') {
            updateDOMForFund(code);
        }
    });
}

function renderFundGrid() {
    const grid = document.getElementById('fundGrid');
    grid.innerHTML = ''; 
    
    let fundArray = Object.values(state.funds);
    const key = state.currentSort.key;
    const order = state.currentSort.order;
    
    fundArray.sort((a, b) => {
        let valA, valB;
        if(key === 'cost') {
            valA = a.cost_price * a.shares;
            valB = b.cost_price * b.shares;
        } else if (key === 'totalRate') {
            valA = a.calculatedTotalRate || 0;
            valB = b.calculatedTotalRate || 0;
        } else if (key === 'todayRate') {
            valA = a.gszzl || 0;
            valB = b.gszzl || 0;
        }
        
        return order === 'desc' ? valB - valA : valA - valB;
    });

    fundArray.forEach(fund => {
        createFundCard(fund.code, grid);
    });
}

// ======================== 视图切换逻辑 ========================
function switchTab(tab) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    
    const targetView = document.getElementById(`view-${tab}`);
    if (targetView) targetView.style.display = 'block';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if(tab === 'home') document.querySelectorAll('.nav-item')[0].classList.add('active');
    if(tab === 'funds') document.querySelectorAll('.nav-item')[1].classList.add('active');

    setTimeout(() => { state.charts.forEach(c => c && c.resize && c.resize()); }, 100);
}

function showDetail(code) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.getElementById('view-detail').style.display = 'block';
    document.getElementById('main-nav').style.display = 'none';

    const fund = state.funds[code];
    
    document.getElementById('detail-name').innerText = fund.name || '--';
    document.getElementById('detail-code').innerText = code;
    
    let mgrName = '--';
    if(fund.manager && fund.manager.length > 0) mgrName = fund.manager.map(m => m.picdesc || m.name || '').join(' ');
    document.getElementById('detail-manager').innerText = mgrName || '未知经理';
    
    document.getElementById('detail-1m').innerText = fund.syl_1y || '--';
    document.getElementById('detail-1y').innerText = fund.syl_1n || '--';
    
    let scaleStr = '--';
    if(fund.scale && fund.scale.series && fund.scale.series.length > 0 && fund.scale.series[0].y.length > 0) {
        scaleStr = fund.scale.series[0].y.slice(-1)[0] + '亿';
    }
    document.getElementById('detail-scale').innerText = scaleStr;
    
    setTimeout(() => {
        renderDetailTrendChart(fund);
        renderDetailAssetChart(fund);
    }, 100);
}

function hideDetail() {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.getElementById('view-funds').style.display = 'block';
    document.getElementById('main-nav').style.display = 'flex';
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item')[1].classList.add('active'); // 选中"基金列表"
    window.scrollTo({top: 0});
}

// ======================== 卡片生成 ========================
function createFundCard(code, container) {
    const fund = state.funds[code];
    const costTotal = fund.cost_price * fund.shares;
    
    let todayPnl = fund.calculatedTodayPnl || 0;
    let totalPnl = fund.calculatedTotalPnl || 0;
    let totalRate = fund.calculatedTotalRate || 0;
    
    let bgColorClass = '';
    if (todayPnl > 0) bgColorClass = 'card-up';
    else if (todayPnl < 0) bgColorClass = 'card-down';
    
    const card = document.createElement('div');
    card.className = `fund-card ${bgColorClass}`;
    card.id = `card-${code}`;
    card.onclick = () => showDetail(code);
    
    card.innerHTML = `
        <div class="fund-card-top" style="flex-direction: column;">
            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                <div class="fc-name">${fund.name || '未知基金'} <span class="fc-tag" style="margin-left:8px;">${code}</span></div>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px; margin-bottom:12px;">
                <div>
                    <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">今日预估盈亏</div>
                    <div class="val ${getColorClass(todayPnl)}" style="font-size:18px; font-weight:700;" id="pnl-val-${code}">${(todayPnl > 0 ? '+' : '') + formatMoney(todayPnl)}</div>
                    <div class="rate ${getColorClass(fund.gszzl)}" style="font-size:13px;" id="pnl-rate-${code}">${formatRate(fund.gszzl)}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">累计总盈亏</div>
                    <div class="val ${getColorClass(totalPnl)}" style="font-size:18px; font-weight:700;" id="total-pnl-${code}">${(totalPnl > 0 ? '+' : '') + formatMoney(totalPnl)}</div>
                    <div class="rate ${getColorClass(totalRate)}" style="font-size:13px;" id="total-rate-${code}">${formatRate(totalRate)}</div>
                </div>
            </div>
        </div>
        <div class="fc-data">
            <div>投入本金: <strong>${formatMoney(costTotal)}</strong></div>
            <div>持仓均价: <strong>${formatMoney(fund.cost_price)}</strong></div>
            <div>最新估值: <strong id="gsz-${code}">${formatMoney(fund.gsz)}</strong></div>
            <div>近1月走势: <strong style="color:var(--text-main)">${fund.syl_1y && fund.syl_1y !== '--' ? fund.syl_1y+'%' : '--'}</strong></div>
        </div>
        
        <div style="display:flex; flex-direction:column; gap:12px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 16px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:14px; color:var(--text-muted); font-weight:500;">净值走势 (K线)</div>
                <div class="movers-sort-tabs card-trend-tabs" id="tabs-${code}">
                    <span class="mover-tab" onclick="event.stopPropagation(); setCardTrendRange('${code}', '1w', this)">1周</span>
                    <span class="mover-tab" onclick="event.stopPropagation(); setCardTrendRange('${code}', '1m', this)">1月</span>
                    <span class="mover-tab active" onclick="event.stopPropagation(); setCardTrendRange('${code}', '3m', this)">3月</span>
                    <span class="mover-tab" onclick="event.stopPropagation(); setCardTrendRange('${code}', 'all', this)">全部</span>
                </div>
            </div>
            <div class="fc-chart" id="chart-${code}"></div>
        </div>
    `;
    container.appendChild(card);
    setTimeout(() => renderSparklineChart(code), 50);
}

// ======================== 数据更新机制 ========================
let jsonpResolvers = {};

window.jsonpgz = function(data) {
    if (!data || !data.fundcode) return;
    const code = data.fundcode;
    if (state.funds[code]) {
        state.funds[code].gsz = Number(data.gsz);
        state.funds[code].gszzl = Number(data.gszzl);
        state.funds[code].calculatedTodayPnl = (state.funds[code].gszzl / 100) * (state.funds[code].cost_price * state.funds[code].shares);
        document.getElementById('lastUpdateTime').innerText = '最后更新: ' + data.gztime;
    }
    if (jsonpResolvers[code]) {
        jsonpResolvers[code]();
        delete jsonpResolvers[code];
    }
};

function fetchRealTimeEstimates() {
    let promises = Object.keys(state.funds).map(code => {
        return new Promise(resolve => {
            let resolved = false;
            const wrapResolve = () => { if (!resolved) { resolved = true; resolve(); } };
            jsonpResolvers[code] = wrapResolve;
            const script = document.createElement('script');
            script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${new Date().getTime()}`;
            script.onerror = () => { script.remove(); wrapResolve(); };
            script.onload = () => { script.remove(); wrapResolve(); };
            document.body.appendChild(script);
            setTimeout(wrapResolve, 8000); // 8 seconds timeout to allow slow API responses
        });
    });

    Promise.all(promises).then(() => {
        recalculateDashboard();
    });
}

function updateDOMForFund(code) {
    // 兼容遗留调用
}

function recalculateDashboard() {
    let sumAssets = 0;
    let sumTodayPnl = 0;
    let sumTotalPnl = 0;

    Object.values(state.funds).forEach(f => {
        const currentTotalAssets = f.gsz * f.shares;
        const costTotal = f.cost_price * f.shares;
        const totalPnl = currentTotalAssets - costTotal;
        const totalRate = costTotal > 0 ? (totalPnl / costTotal) * 100 : 0;
        
        const yesterdayNav = f.gsz / (1 + (f.gszzl || 0) / 100);
        const todayPnl = (f.gsz - yesterdayNav) * f.shares;

        f.calculatedTodayPnl = todayPnl;
        f.calculatedAssets = currentTotalAssets;
        f.calculatedTotalPnl = totalPnl;
        f.calculatedTotalRate = totalRate;

        sumAssets += f.calculatedAssets || costTotal;
        sumTodayPnl += f.calculatedTodayPnl || 0;
        sumTotalPnl += f.calculatedTotalPnl || 0;
    });

    state.totalAssets = sumAssets;

    const totalRate = state.totalCost > 0 ? (sumTotalPnl / state.totalCost) * 100 : 0;
    document.getElementById('totalCost').innerText = formatMoney(state.totalCost);
    document.getElementById('totalAssets').innerText = formatMoney(sumAssets);
    
    const todayPnlEl = document.getElementById('todayPnl');
    todayPnlEl.innerText = (sumTodayPnl > 0 ? '+' : '') + formatMoney(sumTodayPnl);
    todayPnlEl.className = `value ${getColorClass(sumTodayPnl)}`;

    const totalPnlEl = document.getElementById('totalPnl');
    totalPnlEl.innerText = (sumTotalPnl > 0 ? '+' : '') + formatMoney(sumTotalPnl);
    totalPnlEl.className = `value ${getColorClass(sumTotalPnl)}`;

    const totalRateEl = document.getElementById('totalPnlRate');
    totalRateEl.innerText = formatRate(totalRate);
    totalRateEl.className = `pnl-badge ${getBgColorClass(totalRate)}`;
    
    // 重新排序并渲染列表
    renderFundGrid();
    renderMoversList();
    renderOverallTrendChart();
    renderOverallPieChart();
}

let currentMoversSort = 'rate_desc';
window.setMoversSort = function(val, el) {
    currentMoversSort = val;
    document.querySelectorAll('.mover-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderMoversList();
};

function renderMoversList() {
    const listDom = document.getElementById('moversList');
    listDom.innerHTML = '';
    const sortVal = currentMoversSort;
    
    let sorted = Object.values(state.funds).filter(f => f.calculatedTodayPnl !== undefined);
    if(sorted.length === 0) return;
    
    sorted.sort((a,b) => {
        if(sortVal === 'rate_desc') return b.gszzl - a.gszzl;
        if(sortVal === 'rate_asc') return a.gszzl - b.gszzl;
        if(sortVal === 'val_desc') return b.calculatedTodayPnl - a.calculatedTodayPnl;
        if(sortVal === 'val_asc') return a.calculatedTodayPnl - b.calculatedTodayPnl;
    });
    
    let movers = sorted.slice(0, 5); // 手机端优化，仅展示前5个
    
    movers.forEach(f => {
        const item = document.createElement('div');
        item.className = 'mover-item';
        let displayVal = sortVal.startsWith('val_') ? (f.calculatedTodayPnl > 0 ? '+' : '') + formatMoney(f.calculatedTodayPnl) : formatRate(f.gszzl);
        item.innerHTML = `
            <div>
                <div class="mover-name">${f.name}</div>
                <div class="mover-code">${f.code}</div>
            </div>
            <div class="mover-val ${getColorClass(f.gszzl)}">${displayVal}</div>
        `;
        listDom.appendChild(item);
    });
}

// ======================== 复杂 ECharts 渲染 ========================

let currentTrendRange = '3m';
window.setTrendRange = function(range, el) {
    currentTrendRange = range;
    const parent = el.parentNode;
    parent.querySelectorAll('.mover-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderOverallTrendChart();
};

// 1. 全盘组合累计收益走势图 (瀑布流 K线图)
function renderOverallTrendChart() {
    const chartDom = document.getElementById('overallTrendChart');
    if (!chartDom) return;
    let myChart = echarts.getInstanceByDom(chartDom);
    if (!myChart) {
        myChart = echarts.init(chartDom);
        state.charts.push(myChart);
    }

    let dateMap = {}; 
    let totalPortfolioCost = 0;
    
    Object.values(state.funds).forEach(f => {
        const weight = f.cost_price * f.shares; 
        if(weight <= 0) return;
        totalPortfolioCost += weight;
        
        if(f.grandTotal && f.grandTotal.length > 0) {
            let fundLine = f.grandTotal[0]; 
            if(fundLine && fundLine.data) {
                fundLine.data.forEach(pt => {
                    let t = pt[0];
                    let ret = pt[1];
                    if(!dateMap[t]) dateMap[t] = { w: 0, r: 0 };
                    dateMap[t].w += weight;
                    dateMap[t].r += ret * weight;
                });
            }
        }
    });

    let xData = [];
    let yDataCum = [];
    
    Object.keys(dateMap).sort((a,b) => parseInt(a) - parseInt(b)).forEach(t => {
        if(dateMap[t].w > totalPortfolioCost * 0.3) {
            xData.push(parseInt(t));
            let curr = dateMap[t].r / dateMap[t].w;
            yDataCum.push(curr.toFixed(2));
        }
    });

    // 增加今日的实时市场走势预测（而非个人资产盈亏），保证折线连贯不抖动
    if (xData.length > 0) {
        let sumW = 0;
        let sumTodayGszzl = 0;
        Object.values(state.funds).forEach(f => {
            let weight = f.cost_price * f.shares;
            if(weight > 0) {
                sumW += weight;
                sumTodayGszzl += (f.gszzl || 0) * weight;
            }
        });
        
        let avgTodayGszzl = sumW > 0 ? (sumTodayGszzl / sumW) : 0;
        let lastCum = Number(yDataCum[yDataCum.length - 1]);
        
        xData.push(new Date().getTime());
        let newCum = ((1 + lastCum/100) * (1 + avgTodayGszzl/100) - 1) * 100;
        yDataCum.push(newCum.toFixed(2));
    }

    if(xData.length === 0) {
        chartDom.innerHTML = '<div style="color:var(--text-muted);padding:40px;">暂无足够的历史收益数据</div>';
        return;
    }

    // 根据选定的时间跨度过滤数据
    let filteredX = [];
    let filteredY = [];
    
    if (currentTrendRange === 'all') {
        filteredX = xData;
        filteredY = yDataCum;
    } else {
        const now = new Date().getTime();
        let ms = 0;
        if (currentTrendRange === '1w') ms = 7 * 24 * 3600 * 1000;
        if (currentTrendRange === '1m') ms = 30 * 24 * 3600 * 1000;
        if (currentTrendRange === '3m') ms = 90 * 24 * 3600 * 1000;
        const cutoff = now - ms;
        
        for (let i = 0; i < xData.length; i++) {
            if (xData[i] >= cutoff) {
                filteredX.push(xData[i]);
                filteredY.push(yDataCum[i]);
            }
        }
        if (filteredX.length === 0) {
            filteredX = xData.slice(-10);
            filteredY = yDataCum.slice(-10);
        }
    }

    // 精确计算上下限，防止抖动
    let yValues = filteredY.map(v => Number(v));
    let minVal = Math.min(...yValues);
    let maxVal = Math.max(...yValues);
    let padding = (maxVal - minVal) * 0.1;
    if (padding === 0) padding = 1;
    let yMin = Math.floor((minVal - padding) * 100) / 100;
    let yMax = Math.ceil((maxVal + padding) * 100) / 100;

    let kLineData = [];
    for (let i = 0; i < filteredY.length; i++) {
        let close = Number(filteredY[i]);
        let open = i === 0 ? close : Number(filteredY[i - 1]);
        let low = Math.min(open, close);
        let high = Math.max(open, close);
        kLineData.push([open, close, low, high]);
    }

    myChart.setOption({
        tooltip: { 
            trigger: 'axis', backgroundColor: 'rgba(18,24,38,0.9)', 
            textStyle: { color: '#fff' }, borderWidth: 0,
            formatter: (params) => {
                let p = params[0];
                let open = p.data[1];
                let close = p.data[2];
                let diff = (close - open).toFixed(2);
                let color = close >= open ? '#F92F60' : '#00C087';
                return `${new Date(Number(p.axisValue)).toLocaleDateString()}<br/>` +
                       `累计收益: <strong>${close}%</strong><br/>` +
                       `单日变动: <strong style="color:${color}">${diff > 0 ? '+' : ''}${diff}%</strong>`;
            }
        },
        grid: { left: '10%', right: '5%', top: '15%', bottom: '15%' },
        xAxis: { type: 'category', data: filteredX, axisLabel: { color: '#8B949E', formatter: (val) => new Date(Number(val)).toLocaleDateString() }, splitLine: { show: false } },
        yAxis: { type: 'value', min: yMin, max: yMax, axisLabel: { formatter: '{value}%', color: '#8B949E' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
        series: [{
            name: '累计收益',
            type: 'candlestick',
            data: kLineData,
            itemStyle: {
                color: '#F92F60',
                color0: '#00C087',
                borderColor: '#F92F60',
                borderColor0: '#00C087'
            },
            markLine: {
                symbol: ['none', 'none'],
                label: { position: 'insideStartTop', formatter: '{b}: {c}', color: 'inherit', distance: 3, fontSize: 11 },
                lineStyle: { type: 'dashed', width: 1, opacity: 0.8 },
                data: [
                    { type: 'max', valueDim: 'highest', name: '最高', lineStyle: { color: '#F92F60' } },
                    { type: 'min', valueDim: 'lowest', name: '最低', lineStyle: { color: '#00C087' } },
                    { yAxis: kLineData[kLineData.length - 1][1], name: '今日', lineStyle: { color: '#6366F1' } }
                ]
            }
        }]
    }, true);
}

// 2. 首页本金分布饼图
function renderOverallPieChart() {
    const chartDom = document.getElementById('overallPieChart');
    if (!chartDom) return;
    let myChart = echarts.getInstanceByDom(chartDom) || echarts.init(chartDom);
    state.charts.push(myChart);
    const data = Object.values(state.funds)
        .map(f => ({ name: f.name, value: f.cost_price * f.shares }))
        .filter(d => d.value > 0)
        .sort((a, b) => b.value - a.value);
    
    myChart.setOption({
        color: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'],
        tooltip: { trigger: 'item', formatter: '{b}: {c}元 ({d}%)', backgroundColor: 'rgba(18,24,38,0.9)', textStyle: {color: '#fff'}, borderWidth: 0 },
        series: [{
            type: 'pie', radius: ['50%', '80%'],
            itemStyle: { borderWidth: 0 },
            label: { show: true, color: '#8B949E', formatter: '{b}\n{d}%' },
            data: data
        }]
    });
}

const cardTrendRanges = {};
window.setCardTrendRange = function(code, range, el) {
    cardTrendRanges[code] = range;
    const parent = el.parentNode;
    parent.querySelectorAll('.mover-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderSparklineChart(code);
};

// 3. 卡片迷你瀑布图 (Sparkline Candlestick)
function renderSparklineChart(code) {
    const fund = state.funds[code];
    if (!fund.netWorthTrend || fund.netWorthTrend.length === 0) return;
    
    let range = cardTrendRanges[code] || '3m';
    let days = 30;
    if(range === '1w') days = 7;
    if(range === '1m') days = 30;
    if(range === '3m') days = 90;
    if(range === 'all') days = 9999;
    
    let recentData = fund.netWorthTrend.slice(-days).map(d => Number(d.y));
    let recentX = fund.netWorthTrend.slice(-days).map(d => d.x);
    
    if (fund.gsz > 0 && fund.gsz !== recentData[recentData.length - 1]) {
        recentData.push(fund.gsz);
        recentX.push('今日');
    }

    let kLineData = [];
    for (let i = 0; i < recentData.length; i++) {
        let close = recentData[i];
        let open = i === 0 ? close : recentData[i - 1];
        let low = Math.min(open, close);
        let high = Math.max(open, close);
        kLineData.push([open, close, low, high]);
    }

    let minVal = Math.min(...recentData);
    let maxVal = Math.max(...recentData);
    let padding = (maxVal - minVal) * 0.1;
    if(padding === 0) padding = 0.01;
    let yMin = Math.floor((minVal - padding) * 1000) / 1000;
    let yMax = Math.ceil((maxVal + padding) * 1000) / 1000;

    const chartDom = document.getElementById(`chart-${code}`);
    if (!chartDom) return;
    let myChart = echarts.getInstanceByDom(chartDom) || echarts.init(chartDom);
    if (!state.charts.includes(myChart)) state.charts.push(myChart);
    
    myChart.setOption({
        grid: { left: 45, right: '5%', top: 20, bottom: 20 },
        xAxis: { type: 'category', data: recentX, show: true, axisLabel: {show: false}, splitLine: {show: false} },
        yAxis: { type: 'value', min: yMin, max: yMax, axisLabel: { fontSize: 10, color: '#8B949E' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(18,24,38,0.9)', textStyle: { color: '#fff' }, borderWidth: 0 },
        series: [{ 
            type: 'candlestick', 
            data: kLineData,
            itemStyle: { color: '#F92F60', color0: '#00C087', borderColor: '#F92F60', borderColor0: '#00C087' },
            markLine: {
                symbol: ['none', 'none'],
                label: { position: 'insideStartTop', formatter: '{b}: {c}', color: 'inherit', distance: 3, fontSize: 10 },
                lineStyle: { type: 'dashed', width: 1, opacity: 0.8 },
                data: [
                    { type: 'max', valueDim: 'highest', name: '最高', lineStyle: { color: '#F92F60' } },
                    { type: 'min', valueDim: 'lowest', name: '最低', lineStyle: { color: '#00C087' } },
                    { yAxis: kLineData[kLineData.length - 1][1], name: '今日', lineStyle: { color: '#6366F1' } }
                ]
            }
        }]
    }, true);
}

let currentDetailRange = '3m';
window.setDetailTrendRange = function(range, el) {
    currentDetailRange = range;
    const parent = el.parentNode;
    parent.querySelectorAll('.mover-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const activeCode = document.getElementById('detail-code').innerText;
    if(state.funds[activeCode]) {
        renderDetailTrendChart(state.funds[activeCode]);
    }
};

// 4. 详情页趋势对比图
let detailTrendChart = null;
function renderDetailTrendChart(fund) {
    const chartDom = document.getElementById('detail-trend-chart');
    if (detailTrendChart) { detailTrendChart.dispose(); state.charts = state.charts.filter(c => c !== detailTrendChart); }
    detailTrendChart = echarts.init(chartDom);
    state.charts.push(detailTrendChart);

    const seriesData = []; const legendData = [];
    let allX = [];
    let minVal = Infinity; let maxVal = -Infinity;

    if (fund.grandTotal && fund.grandTotal.length > 0) {
        // 先找出最长的时间轴
        allX = fund.grandTotal[0].data.map(d => d[0]);

        const now = new Date().getTime();
        let ms = 0;
        if (currentDetailRange === '1w') ms = 7 * 24 * 3600 * 1000;
        if (currentDetailRange === '1m') ms = 30 * 24 * 3600 * 1000;
        if (currentDetailRange === '3m') ms = 90 * 24 * 3600 * 1000;
        const cutoff = now - ms;

        fund.grandTotal.forEach((line, index) => {
            legendData.push(line.name);
            
            let filteredData = [];
            if (currentDetailRange === 'all') {
                filteredData = line.data.map(d => [d[0], d[1]]);
            } else {
                filteredData = line.data.filter(d => d[0] >= cutoff).map(d => [d[0], d[1]]);
                if(filteredData.length === 0) filteredData = line.data.slice(-10).map(d => [d[0], d[1]]);
            }

            filteredData.forEach(d => {
                if (d[1] < minVal) minVal = d[1];
                if (d[1] > maxVal) maxVal = d[1];
            });

            seriesData.push({
                name: line.name, type: 'line', showSymbol: false,
                data: filteredData,
                lineStyle: { 
                    width: index === 0 ? 4 : 2, 
                    type: index === 0 ? 'solid' : 'dashed' 
                },
                itemStyle: {
                    opacity: index === 0 ? 1 : 0.5
                },
                zlevel: index === 0 ? 10 : 1
            });
        });
    }
    
    let padding = (maxVal - minVal) * 0.1;
    if(padding === 0) padding = 1;
    let yMin = Math.floor((minVal - padding) * 100) / 100;
    let yMax = Math.ceil((maxVal + padding) * 100) / 100;

    detailTrendChart.setOption({
        color: ['#F92F60', '#3B82F6', '#8B949E', '#F59E0B'],
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(18,24,38,0.9)', textStyle: { color: '#fff' }, borderWidth: 0 },
        legend: { data: legendData, textStyle: { color: '#8B949E' }, bottom: 0 },
        grid: { left: '10%', right: '5%', top: '10%', bottom: '15%' },
        xAxis: { type: 'time', splitLine: { show: false }, axisLabel: { color: '#8B949E' } },
        yAxis: { type: 'value', min: yMin, max: yMax, axisLabel: { formatter: '{value}%', color: '#8B949E' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
        series: seriesData
    }, true);
}

// 5. 详情页资产比例饼图
let detailAssetChart = null;
function renderDetailAssetChart(fund) {
    const chartDom = document.getElementById('detail-asset-chart');
    if (detailAssetChart) { detailAssetChart.dispose(); state.charts = state.charts.filter(c => c !== detailAssetChart); }
    detailAssetChart = echarts.init(chartDom);
    state.charts.push(detailAssetChart);

    let pieData = [];
    if (fund.assetAllocation && fund.assetAllocation.series) {
        fund.assetAllocation.series.forEach(s => {
            if (s.data && s.data.length > 0 && s.data[0] > 0) pieData.push({ name: s.name, value: s.data[0] });
        });
    }

    detailAssetChart.setOption({
        tooltip: { trigger: 'item', formatter: '{b}: {c}%' },
        series: [{ type: 'pie', radius: ['40%', '70%'], label: { color: '#8B949E', formatter: '{b} {d}%' }, data: pieData }]
    });
}

document.addEventListener('DOMContentLoaded', initApp);
