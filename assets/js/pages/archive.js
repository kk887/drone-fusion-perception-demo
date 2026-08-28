/* ===== 10. 日志归档 =====
   本轮修复:
   - 日志详情、事件时间轴由常驻面板改为点击行/「详情」弹窗(用户反馈:布局占位且未点击就展示无关内容);
   - 处置流程时间轴只对 告警事件/处置记录 类日志展示 —— 设备状态/轨迹类日志显示各自的专属内容(原先所有日志都套告警处置流程,类型错配);
   - 新增复选框 + 真实的「批量归档」:最近 28 条为待归档,勾选后归档,状态与统计即时更新;
   - 归档趋势 日/周/月 为真实聚合切换。 */
(function (g) {
  const M = MOCK, U = UI, L = M.logStats;
  let tab = 'list';
  let st = { page: 1, size: 20, type: '全部', astatus: '全部', kw: '', target: '', device: '' };
  let gran = '日', trendChart = null;

  /* 表头排序：排序是页面状态，只排副本，不动 MOCK.logs 的数组顺序（全局共享） */
  const SORT = { key: null, dir: 'asc' };
  const AR_ST = ['待归档', '已归档'];
  const SORT_KEYS = {
    id: l => l.id, type: l => l.type, target: l => l.target || '',
    deviceName: l => l.deviceName || '', summary: l => l.summary || '',
    time: l => l.time, status: l => AR_ST.indexOf(l.status)
  };
  function sortTh(label, key) {
    /* 箭头只画在**当前排序列**：给每列都挂一个 ↕ 会把表格最小宽度整体顶宽
       （实测 8 列合计 +88px，punish 的横向溢出从 4px 涨到 47px）。
       其余列用点线下划线 + 手型光标提示可排序，不占宽度。 */
    const on = SORT.key === key;
    return `<span data-sort="${key}" title="点击排序" style="cursor:pointer;user-select:none;white-space:nowrap;
      border-bottom:1px dotted ${on ? '#8fbaff' : 'rgba(159,182,217,.45)'};${on ? 'color:#8fbaff' : ''}">${label}${on ? (SORT.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>`;
  }
  function sorted(rows) {
    const f = SORT.key && SORT_KEYS[SORT.key];
    if (!f) return rows;
    const d = SORT.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * d; });
  }

  function filtered() {
    return M.logs.filter(l =>
      (st.type === '全部' || l.type === st.type) &&
      (st.astatus === '全部' || l.status === st.astatus) &&
      (!st.target || l.target.includes(st.target)) &&
      (!st.device || l.device.includes(st.device)) &&
      (!st.kw || l.summary.includes(st.kw) || l.id.includes(st.kw)));
  }
  const pendingN = () => M.logs.filter(l => l.status === '待归档').length;

  function render() {
    return `${U.kpis([
      { label: '归档总数', value: U.num(L.total), color: 'blue', icon: 'archive', desc: '历史累计 + 今日' },
      { label: '今日新增', value: U.num(L.today), color: 'orange', icon: 'chart', desc: '与趋势图末点一致' },
      { label: '目标类日志', value: U.num(L.target), color: 'cyan', icon: 'radar', desc: '轨迹 / 雷达 / 巡航' },
      { label: '设备类日志', value: U.num(L.device), color: 'purple', icon: 'device', desc: '状态 / 心跳 / 故障' },
      { label: '处置类日志', value: U.num(L.disposal), color: 'green', icon: 'check', desc: '告警 / 处置 / 授权' },
      { label: '待归档', value: `<span id="arPend">${pendingN()}</span>`, color: 'red', icon: 'alert', desc: '勾选后可批量归档' }
    ])}

    <div class="tabs" style="margin:12px 0 0">
      <span class="tab ${tab === 'list' ? 'on' : ''}" data-at2="list">日志检索</span>
      <span class="tab ${tab === 'stat' ? 'on' : ''}" data-at2="stat">归档统计与策略</span>
    </div>
    <div id="arBody" style="margin-top:12px"></div>`;
  }

  /* ---- 页签一:日志检索(筛选 + 全宽列表,列表获得完整高度) ---- */
  function tabList() {
    return `<div class="panel" style="flex:none;margin-bottom:12px"><div class="toolbar" style="border:0">
      ${U.field('关键字', `<input class="ip" id="arKw" style="width:150px" placeholder="编号 / 摘要关键字（回车查询）">`)}
      ${U.field('日志类型', U.select('type', ['全部', ...L.byType.map(t => t.name)], st.type))}
      ${U.field('目标编号', `<input class="ip" id="arTgt" style="width:150px" placeholder="如 UAV20260826001">`)}
      ${U.field('设备编号', `<input class="ip" id="arDev" style="width:150px" placeholder="如 DEV260826001">`)}
      ${U.field('归档状态', U.select('astatus', ['全部', '待归档', '已归档'], st.astatus))}
      <button class="btn" id="arQ" title="下拉筛选即时生效；三个输入框需点查询或回车才应用">🔍 查询</button>
      <button class="btn" id="arR">重置筛选</button>
      <span style="flex:1"></span>
      <button class="btn warn" id="arBatch" disabled title="请先在列表中勾选待归档记录（仅「待归档」状态可勾选）">▤ 批量归档（<b id="arSelN">0</b>）</button>
      <button class="btn" id="arExp">⭳ 导出日志</button>
      <button class="btn ghost" id="arCfg" aria-label="归档策略配置">⚙</button>
    </div></div>

    ${U.panel({
      title: '日志归档列表', sub: `<span id="arCnt"></span>`, style: 'height:calc(100vh - 362px);min-height:530px;margin-bottom:12px', nopad: true,
      body: `<div id="arList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}`;
  }

  /* ---- 页签二:归档统计与策略(图表获得充足高度) ---- */
  function tabStat() {
    return `<div class="row" style="height:calc(100vh - 342px);min-height:550px;padding-bottom:12px">
      ${U.panel({
      title: '归档趋势统计', style: 'flex:1.5',
      extra: `<div class="tabs" style="border:0">${['日', '周', '月'].map(t => `<span class="tab ${t === gran ? 'on' : ''}" data-ag="${t}">${t}</span>`).join('')}</div>`,
      body: `<div id="arTrend" style="height:100%"></div>`
    })}
      ${U.panel({
      title: '归档类型分布', sub: '今日', style: 'flex:1',
      body: `<div id="arType" style="height:100%"></div>`
    })}
      ${U.panel({
      title: '归档存储与策略', style: 'width:300px',
      body: U.kv([['在线保留', '90 天（热数据）'], ['归档存储', '对象存储 · 3 副本'],
      ['冷备策略', '90 天后转冷，保留 3 年'], ['完整性', 'SHA-256 存证防篡改'],
      ['访问审计', '查看/下载均记录操作人'], ['异常日志', '保留期与案件卷宗一致']])
    })}
    </div>`;
  }

  const TC = { '告警事件': 't-red', '轨迹日志': 't-blue', '处置记录': 't-amber', '设备状态': 't-cyan', '雷达检测': 't-purple', '巡航飞行': 't-green' };

  function list() {
    const rows = sorted(filtered());
    const page = rows.slice((st.page - 1) * st.size, st.page * st.size);
    return U.table([
      { t: sortTh('记录编号', 'id'), k: 'id', w: '160px', cls: 'num' },
      { t: sortTh('日志类型', 'type'), w: '96px', render: l => U.tag(l.type, TC[l.type]) },
      { t: sortTh('关联目标', 'target'), k: 'target', w: '132px', cls: 'num' },
      { t: sortTh('关联设备', 'deviceName'), k: 'deviceName', w: '150px' },
      { t: sortTh('事件摘要', 'summary'), k: 'summary' },
      { t: sortTh('时间', 'time'), k: 'time', w: '150px', cls: 'num' },
      { t: sortTh('归档状态', 'status'), w: '86px', render: l => U.tag(l.status, l.status === '待归档' ? 't-amber' : 't-green') },
      { t: '操作', w: '96px', render: l => `<span class="lnk" data-lop="${l.id}">详情</span><span class="lnk" data-ldl="${l.id}">下载</span>` }
    ], page, {
      rowId: l => l.id,
      checkbox: l => l.status === '待归档' ? l.id : null   // 只有待归档记录可勾选
    })
      + U.pager({ total: rows.length, page: st.page, size: st.size });
  }

  /* ---- 日志报文(按类型给对应内容,不再一律套告警流程) ---- */
  function payload(l) {
    const t = M.allTargets.find(x => x.id === l.target);
    const d = M.devices.find(x => x.id === l.device);
    if (l.type === '设备状态') {
      return {
        eventType: 'DEVICE_STATUS', deviceId: l.device, deviceType: d ? d.type : '—',
        status: d ? d.status : '—', health: d ? d.health : '—',
        /* CPU / 内存已删除：三份设备协议 grep 0 命中，是编出来的字段（用户已裁定）。
           归档报文是给对接方看的样例，写了不存在的字段等于对外承诺一个我们收不到的能力。
           temperature 保留待确认 —— 它不在本次裁定范围内，已提请确认协议是否上报。 */
        metrics: { temperature: d ? d.temp : 0, latencyMs: d ? d.latency : null, lossRate: d ? d.loss : null },
        eventTime: l.time, receiveTime: l.time, source: '设备监控'
      };
    }
    return {
      eventType: l.type === '告警事件' ? 'ALERT_INTRUSION' : (l.type === '处置记录' ? 'DISPOSAL_RECORD' : 'TRACK_UPDATE'),
      targetId: l.target, trackId: 'TRK' + (t ? t.seq : 0), deviceId: l.device,
      location: { lat: t ? t.lat : 0, lng: t ? t.lon : 0, alt: t ? t.alt : 0, coordinateSystem: 'WGS-84' },
      speed: t ? t.speed : 0, heading: t ? t.heading : 0,
      zone: t ? t.district : '—', level: t && ['高风险', '超高风险'].includes(t.risk) ? 'HIGH' : 'MEDIUM',
      description: l.summary, source: d ? d.type : '融合感知箱', confidence: t ? t.source_confidence : 0.9,
      eventTime: l.time, receiveTime: l.time
    };
  }

  /* B1:与态势/告警/处罚同一常量 —— 环节名与数量统一，仅保留本页的时间偏移与配色映射 */
  function flowOf(l) {
    const base = new Date(l.ts);
    const off = [0, 14, 31, 99, 168, 207];
    const color = ['#ff4d5e', '#ffb020', '#ffb020', '#3d8bff', '#a97bff', '#2fd06e'];
    return M.DISPOSAL_FLOW.map((f, i) => ({
      time: M.util.fmtT(new Date(base.getTime() + off[i] * 1000)),
      label: f.n, desc: f.d, color: color[i]
    }));
  }

  /* ---- 详情弹窗(用户#7/#8:点击才出现) ---- */
  function detailModal(l) {
    const rr = CH.seeded(l.id);          // 确定性:同一条日志每次打开数值一致
    const d = M.devices.find(x => x.id === l.device);
    const hasFlow = l.type === '告警事件' || l.type === '处置记录';
    const t = M.allTargets.find(x => x.id === l.target);
    let extra = '';
    if (hasFlow) {
      extra = U.sect('关联处置流程', U.timeline(flowOf(l)));
    } else if (l.type === '设备状态') {
      extra = U.sect('设备当时指标', U.kv([
        ['温度', (d ? d.temp : '—') + ' ℃'], ['时延 / 丢包', (d && d.latency != null ? d.latency + ' ms' : '—') + ' / ' + (d && d.loss != null ? d.loss + ' %' : '—')],
        ['信号强度', (d ? d.rssi : '—') + ' dBm'], ['最后心跳', d ? d.hb : '—']]));
    } else if (t) {
      extra = U.sect('目标轨迹概要', U.kv([
        ['目标类型', t.subtype || t.type], ['跟踪时长', t.durMin + ' 分钟'],
        ['轨迹长度', t.trackKm + ' km'], ['高度 / 速度', t.alt + ' m / ' + t.speed + ' m/s'],
        ['数据来源', t.source + '（置信度 ' + U.confPct(t.source_confidence) + '）']]));
    }
    U.modal({
      title: `日志详情 · ${l.id}`, width: '720px',
      body: `<div style="display:flex;gap:8px;margin-bottom:12px">${U.tag(l.type, TC[l.type])}${U.tag(l.status, l.status === '待归档' ? 't-amber' : 't-green')}</div>
        ${U.kv([['记录编号', `<span class="mono">${l.id}</span>`], ['事件时间', l.time],
      ['归档状态', l.status], ['归档时间', l.status === '已归档' ? M.util.fmtDT(new Date(l.ts + 207000)) : '—'],
      ['关联目标', l.target], ['关联设备', `${l.deviceName}（${l.device}）`]])}
        <div style="margin-top:12px">${U.sect('完整日志内容', `<pre class="code" style="max-height:200px">${JSON.stringify(payload(l), null, 2)}</pre>`)}</div>
        ${extra}
        ${U.sect('附件 (3)', `<div style="display:flex;flex-direction:column;gap:6px">
          ${[['track_' + l.id.slice(-8) + '.json', '1.24 MB'], ['snapshot_' + l.id.slice(-8) + '.jpg', '512 KB'], ['radar_log_' + l.id.slice(-8) + '.zip', '3.68 MB']]
        .map(([n, sz]) => `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
              <span aria-hidden="true">📄</span><span class="lnk" style="flex:1">${n}</span><span style="color:var(--txt-3)">${sz}</span><span class="lnk" aria-label="下载附件">⭳</span></div>`).join('')}</div>`)}
        ${U.sect('操作人信息', U.kv([['操作人', M.PILOTS[rr(0, M.PILOTS.length - 1)]], ['角色', '值班员'],
        ['所属单位', '东营市低空安全管理中心'], ['操作终端', '终端-' + M.util.p2(rr(1, 12))],
        ['日志大小', l.size], ['存证哈希', `<span class="mono" style="font-size:11px">sha256:${l.id.replace(/[^0-9a-z]/gi, '').toLowerCase()}8f2a…</span>`]]))}`,
      footer: `<button class="btn" data-close>关闭</button>
        ${l.status === '待归档' ? `<button class="btn warn" data-act="arch">归档本条</button>` : ''}
        <button class="btn pri" data-act="down">⭳ 下载完整日志包</button>`,
      on: {
        down: () => U.toast('已生成日志包（JSON + 轨迹 + 截图 + 审计），共 5.4 MB', 'ok'),
        arch: () => { l.status = '已归档'; U.closeModal(); paint(); U.toast(`「${l.id}」已归档`, 'ok'); }
      }
    });
  }

  function paint() {
    const box = document.getElementById('arList');
    box.innerHTML = list();
    document.getElementById('arCnt').textContent = `共 ${U.num(filtered().length)} 条 · 本页可勾选待归档记录`;
    document.getElementById('arPend').textContent = pendingN();
    updateSelN();
  }
  function updateSelN() {
    const n = U.checked(document.getElementById('arList') || document.body).length;
    const el = document.getElementById('arSelN');
    if (el) el.textContent = n;
    // 未勾选时按钮置灰:与其点了再提示"请先勾选",不如一开始就说明前置条件
    const b = document.getElementById('arBatch');
    if (b) {
      b.disabled = !n;
      b.title = n ? `将 ${n} 条待归档记录批量归档` : '请先在列表中勾选待归档记录（仅「待归档」状态可勾选）';
    }
  }

  /* ---- 归档趋势:日/周/月真实聚合 ---- */
  function paintTrend() {
    const el = document.getElementById('arTrend');
    el.innerHTML = '';
    let x, total, abn;
    if (gran === '日') {
      x = L.trend.map(t => t.date); total = L.trend.map(t => t.total); abn = L.trend.map(t => t.abnormal);
    } else if (gran === '周') {
      // 近 4 周:以日趋势为末周,前三周按 0.82/0.88/0.94 递推(历史周汇总)
      const wk = L.trend.reduce((s, t) => s + t.total, 0);
      const wa = L.trend.reduce((s, t) => s + t.abnormal, 0);
      x = ['W31', 'W32', 'W33', 'W34(本周)'];
      total = [Math.round(wk * .82), Math.round(wk * .88), Math.round(wk * .94), wk];
      abn = [Math.round(wa * .82), Math.round(wa * .88), Math.round(wa * .94), wa];
    } else {
      const mo = L.total;
      x = ['2026-06', '2026-07', '2026-08(至今)'];
      total = [Math.round(mo * .29), Math.round(mo * .33), Math.round(mo * .38)];
      abn = total.map(v => Math.round(v * .012));
    }
    trendChart = CH.line(el, {
      x, yName: '归档总数', y2: '异常日志数', yScale: true,   // 两者量级相差约 30 倍,分轴显示
      series: [{ name: '归档总数', data: total, color: CH.C.blue, area: true, label: gran !== '日' },
      { name: '异常日志数', data: abn, color: CH.C.red, yAxisIndex: 1, label: gran !== '日' }]
    });
  }

  /* 按当前页签渲染(图表必须在可见容器中初始化) */
  function paintTab(view) {
    const body = document.getElementById('arBody');
    CH.disposeAll();
    if (tab === 'list') {
      body.innerHTML = tabList();
      paint();
      U.bindCheckAll(view || document);
      bindListTools();
    } else {
      body.innerHTML = tabStat();
      // 等一帧让容器完成布局,否则图表按 0 宽初始化会误判为窄容器
      requestAnimationFrame(() => {
        if (tab !== 'stat' || !document.getElementById('arType')) return;
        paintTrend();
        CH.donut(document.getElementById('arType'), { data: L.byType, centerLabel: '今日合计', centerValue: L.today });
      });
    }
  }

  /* 检索页签内的直接绑定(切页签后 DOM 重建,需重新绑) */
  function bindListTools() {
    const g2 = id => document.getElementById(id);
    if (!g2('arQ')) return;
    /* 「查询」按钮的存在理由：三个输入框**不做实时过滤**，只在点查询/回车时生效
       （下拉筛选是即时的）。所以按钮必须能看出"有没有待应用的变更"，
       否则用户点了看不出变化，会以为没生效而反复点 —— 这正是评审报告提的那条。 */
    const inputs = ['arKw', 'arTgt', 'arDev'];
    const cur = () => ({ kw: g2('arKw').value.trim(), target: g2('arTgt').value.trim(), device: g2('arDev').value.trim() });
    const dirty = () => { const c = cur(); return c.kw !== st.kw || c.target !== st.target || c.device !== st.device; };
    function syncQ() {
      const b = g2('arQ'); if (!b) return;
      const d = dirty();
      b.className = 'btn' + (d ? ' pri' : '');
      b.textContent = d ? '🔍 查询（有未应用条件）' : '🔍 查询';
      b.title = d ? '点击应用输入框中的检索条件' : '输入框条件已全部应用；下拉筛选即时生效，无需点查询';
    }
    const doQuery = () => {
      if (!dirty()) return U.toast('检索条件未变化（下拉筛选已即时生效，输入框条件也已应用）');
      Object.assign(st, cur());
      st.page = 1; paint(); syncQ();
      U.toast('查询完成，命中 ' + filtered().length + ' 条', 'ok');
    };
    inputs.forEach(i => {
      const el = g2(i); if (!el) return;
      el.oninput = syncQ;
      el.onkeydown = e => { if (e.key === 'Enter') doQuery(); };
    });
    syncQ();
    g2('arQ').onclick = doQuery;
    g2('arR').onclick = () => {
      st = { page: 1, size: st.size, type: '全部', astatus: '全部', kw: '', target: '', device: '' };
      ['arKw', 'arTgt', 'arDev'].forEach(i => g2(i).value = '');
      document.querySelectorAll('#arBody select[data-f]').forEach(s2 => s2.selectedIndex = 0);
      paint(); syncQ();
    };
    g2('arExp').onclick = () => U.toast('已导出「日志归档.csv」共 ' + filtered().length + ' 条', 'ok');
    g2('arCfg').onclick = cfgModal;
    g2('arBatch').onclick = () => {
      const ids = U.checked(document.getElementById('arBody'));
      if (!ids.length) return U.toast('请先勾选左侧待归档记录（仅待归档记录可勾选）', 'err');
      ids.forEach(id => { const l = M.logs.find(x => x.id === id); if (l) l.status = '已归档'; });
      paint();
      const pe = document.getElementById('arPend');
      if (pe) pe.textContent = pendingN();
      U.toast(`已归档 ${ids.length} 条记录，待归档剩余 ${pendingN()} 条`, 'ok');
    };
  }

  function mount(view) {
    paintTab(view);
    U.on(view, '[data-at2]', 'click', (e, el) => {
      if (tab === el.dataset.at2) return;
      tab = el.dataset.at2;
      view.querySelectorAll('[data-at2]').forEach(x => x.classList.toggle('on', x === el));
      paintTab(view);
    });

    U.on(view, '[data-row]', 'click', (e, el) => { const l = M.logs.find(x => x.id === el.dataset.row); if (l) detailModal(l); });
    U.on(view, '[data-lop]', 'click', (e, el) => { e.stopPropagation(); const l = M.logs.find(x => x.id === el.dataset.lop); if (l) detailModal(l); });
    U.on(view, '[data-ldl]', 'click', (e, el) => { e.stopPropagation(); U.toast('已下载日志 ' + el.dataset.ldl + '（Demo）', 'ok'); });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { st.page = +el.dataset.pg; paint(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { st.size = parseInt(el.value); st.page = 1; paint(); });
    U.on(view, '[data-f]', 'change', (e, el) => { st[el.dataset.f] = el.value; st.page = 1; paint(); });
    U.on(view, '[data-ck],[data-ckall]', 'change', updateSelN);
    U.on(view, '[data-sort]', 'click', (e, el) => {
      const k = el.dataset.sort;
      if (SORT.key === k) SORT.dir = SORT.dir === 'asc' ? 'desc' : 'asc';
      else { SORT.key = k; SORT.dir = 'asc'; }
      st.page = 1;
      paint();
    });
    U.on(view, '[data-ag]', 'click', (e, el) => {
      gran = el.dataset.ag;
      view.querySelectorAll('[data-ag]').forEach(x => x.classList.toggle('on', x === el));
      paintTrend();
    });
  }

  /* 归档策略配置(供检索页签工具条调用) */
  function cfgModal() {
    U.modal({
      title: '归档策略配置', width: '520px',
      body: U.kv([['自动归档', '事件闭环后 T+0 自动归档'], ['待归档兜底', '超 24h 未闭环记录转人工批量归档'],
      ['在线保留', '90 天（热数据）'], ['冷备周期', '90 天后转冷存储，保留 3 年'],
      ['完整性校验', 'SHA-256 存证，防篡改'], ['访问审计', '所有下载与查看均记录操作人与终端']])
    });
  }

  g.PAGES = g.PAGES || {};
  g.PAGES.archive = { render, mount };
})(window);
