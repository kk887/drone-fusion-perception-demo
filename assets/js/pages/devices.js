/* ===== 5. 设备管理 ===== */
(function (g) {
  const M = MOCK, U = UI;
  let st = { page: 1, size: 10, type: '全部', region: '全部', vendor: '全部', status: '全部', kw: '', sel: null, tab: 'pos' };
  let map = null;

  const TYPES = [...new Set(M.devices.map(d => d.type))];
  const VENDORS = [...new Set(M.devices.map(d => d.vendor))];

  /* =========================================================================
   * B7 数据源切换（系统设计方案 V1.1 §5.6 数据接入 / §9.4 替换机制）
   *
   * 对客户的承诺是「正式接口到位后只替换 Adapter，页面与业务逻辑不动」。
   * 为让这句话可当场验证、而不是停留在架构图上，本页把取数收敛到 DS.list()
   * 一个入口，三种模式各是一个 Adapter 实现：
   *
   *   mock   → MockAdapter    直接返回 mock.js 的设备台账（当前实时态）
   *   replay → ReplayAdapter  以同一份台账为基准，派生所选历史时刻的状态快照
   *   live   → RestAdapter    向正式环境端点取数；Demo 无真实端点，探测失败即
   *                           如实呈现「未连通 / 无数据」，不用 Mock 冒充正式接口
   *
   * 下面的 filtered() / stats() / list() / detail() 只认 DS.list() 的输出，
   * 切模式时这几个函数一行不改 —— 这就是「换 Adapter 不动页面」的现场证据。
   * ====================================================================== */
  const TBD = '【待确认：正式环境接入地址】';
  const MODES = {
    mock: {
      name: 'Mock 模拟数据', mark: '模拟', foot: 'Mock 模拟数据源（非真实感知结果）', color: '#ffb020', tag: 't-amber',
      adapter: 'assets/js/mock.js · MockAdapter', writable: true
    },
    replay: {
      name: '历史回放', mark: '回放', foot: '历史回放数据源', color: '#a97bff', tag: 't-purple',
      adapter: 'assets/js/mock.js · ReplayAdapter（历史录制回放）', writable: false
    },
    live: {
      name: '正式接口', mark: '实时', foot: '正式接口数据源', color: '#2fd06e', tag: 't-green',
      adapter: 'RestAdapter（正式环境端点）', writable: false
    }
  };

  /* 回放库：以 D3 评审基准时刻为终点，向前 7 天，每日 1 帧 */
  const SNAPS = Array.from({ length: 7 }, (_, k) => M.util.dayAdd(M.CONF.demoTime, k - 7));
  const snapTime = () => SNAPS[DS.snapIdx];
  const snapKey = () => M.util.fmtDT(snapTime());
  const spanTx = () => M.util.fmtDT(SNAPS[0]) + ' ~ ' + M.util.fmtDT(M.CONF.demoTime);

  const DS = {
    mode: 'mock',
    snapIdx: SNAPS.length - 1,          // 默认最近一帧（1 天前）
    endpoint: '',
    probe: null,
    by: '系统默认',
    since: M.util.fmtDT(M.CONF.demoTime),
    reason: '平台启动加载默认 Adapter',
    log: [{
      seq: 1, kind: '切换', at: M.util.fmtDT(M.CONF.demoTime), from: '—', to: 'Mock 模拟数据',
      by: '系统默认', reason: '平台启动加载默认 Adapter', result: '成功',
      detail: 'adapter=assets/js/mock.js · 设备台账 ' + M.devices.length + ' 台'
    }]
  };

  /* ---- 状态持久化:切换后刷新页面仍保持当前数据源（sessionStorage,关标签页即复位）---- */
  const SKEY = 'ds.mode.v1';
  function save() {
    try {
      sessionStorage.setItem(SKEY, JSON.stringify({
        mode: DS.mode, snapIdx: DS.snapIdx, endpoint: DS.endpoint,
        by: DS.by, since: DS.since, reason: DS.reason, log: DS.log, probe: DS.probe
      }));
    } catch (e) { /* 隐私模式下 sessionStorage 不可用时静默降级为内存态 */ }
  }
  (function restore() {
    try {
      const v = JSON.parse(sessionStorage.getItem(SKEY) || 'null');
      if (v && MODES[v.mode]) Object.assign(DS, v);
    } catch (e) { }
  })();

  /* ---- ReplayAdapter：按历史时刻派生快照（确定性，同一时刻两次进入结果一致）----
     只改随时间变化的运行态字段（状态/心跳/时延/丢包/资源），台账属性沿用同一份数据源。 */
  let replayCache = {};
  function replayList() {
    const key = snapKey();
    if (replayCache[key]) return replayCache[key];
    const t = snapTime().getTime();
    const out = M.devices.map(d => {
      const r = CH.seeded(d.id + '@' + key);
      let status = d.status;
      // 约 1/8 的设备在该历史时刻处于与当前不同的状态（取值仍限于同一枚举）
      if (r(0, 99) < 12) { const alt = ['在线', '离线', '异常'].filter(s => s !== d.status); status = alt[r(0, alt.length - 1)]; }
      const hbMin = status === '离线' ? r(12, 320) : r(0, 2);
      const alarm = status === '异常' ? true : (status === '在线' ? r(0, 99) < 6 : r(0, 1) === 1);
      return Object.assign({}, d, {
        status, alarm, hbMin,
        hb: M.util.fmtDT(new Date(t - hbMin * 60000 - r(0, 59) * 1000)),
        health: status === '在线' ? (alarm ? '一般' : '良好') : (status === '异常' ? '异常' : '未知'),
        latency: status === '离线' ? null : r(12, 180),
        loss: status === '离线' ? null : +(r(0, alarm ? 2600 : 140) / 100).toFixed(2),
        rssi: -r(52, 98),
        /* cpu / mem / disk 已删除：三份设备协议 grep 0 命中，是本页现造的字段（用户已裁定）。
           它们不是从数据层读的，所以数据层删字段动不到这里 —— **编造发生在消费侧时，
           清理也必须从消费侧做**，否则数据层清干净了，页面还在自产自销。
           temp 暂留：温度是否有协议出处尚未核实，**没核过的不删**。 */
        temp: r(38, 79)
        /* 注意:这里不额外挂「快照时刻」字段 —— 三种模式必须返回同一 Schema,
           录制时间属于数据源元信息(DS.snapIdx),不混进业务记录 */
      });
    });
    replayCache[key] = out;
    return out;
  }

  /* ---- RestAdapter：正式环境连通性探测 ----
     Demo 环境没有正式端点，三条接入通道必然探测失败。这里如实返回失败，
     页面随之显示空台账 —— 用 Mock 数据冒充「正式接口已通」才是评审时的硬伤。 */
  const CH_CODE = { '融合感知箱': 'BOX', 'TDOA': 'TDOA', '5G-A': '5GA' };   // 与 Target Schema 的 sourceType 取值一致
  function probe() {
    const ep = DS.endpoint || TBD;
    return {
      at: M.util.fmtDT(M.CONF.demoTime), endpoint: ep,
      items: M.deviceStats.byChannel.map(c => ({
        channel: c.channel, total: c.total,
        path: '/api/v1/device/list?channel=' + (CH_CODE[c.channel] || c.channel),
        ok: false, ms: 3000, err: 'ETIMEDOUT · 连接超时（Demo 环境未接入正式端点）'
      }))
    };
  }
  const probeOk = () => DS.probe ? DS.probe.items.filter(x => x.ok).length : 0;

  /* 三种模式必须返回同一 Schema（B7 可测判据：切换前后字段结构不变）。
     这里不是写死一句「一致」，而是实测比对两个 Adapter 输出的字段集合。 */
  function schemaCheck() {
    const a = M.devices[0] ? Object.keys(M.devices[0]).sort() : [];
    const b = replayList()[0] ? Object.keys(replayList()[0]).sort() : [];
    const diff = a.filter(x => b.indexOf(x) < 0).concat(b.filter(x => a.indexOf(x) < 0));
    return { n: a.length, same: !diff.length, diff };
  }

  /* ---- 页面唯一取数入口 ---- */
  function dsList() {
    if (DS.mode === 'replay') return replayList();
    if (DS.mode === 'live') return probeOk() ? M.devices : [];   // 未连通 → 无数据，不兜底 Mock
    return M.devices;
  }
  /* KPI 由 Adapter 输出实时派生，不引用任何预置统计数字（口径与 mock.selfCheck 一致） */
  function stats(list) {
    const total = list.length;
    const n = s => list.filter(d => d.status === s).length;
    const rate = v => total ? +(v / total * 100).toFixed(1) : 0;
    const online = n('在线'), offline = n('离线'), abnormal = n('异常');
    return {
      total, online, offline, abnormal, alarm: list.filter(d => d.alarm).length,
      onlineRate: rate(online), offlineRate: rate(offline), abnormalRate: rate(abnormal),
      vendors: new Set(list.map(d => d.vendor)).size, models: new Set(list.map(d => d.model)).size
    };
  }
  const writable = () => MODES[DS.mode].writable;
  function guardWrite(action) {
    if (writable()) return true;
    U.toast(`当前数据源为「${MODES[DS.mode].name}」，${DS.mode === 'replay'
      ? '历史回放是只读视图，不允许写台账' : '正式接口未连通，禁止下发配置'}，无法执行「${action}」。请先切回 Mock 数据源。`, 'err');
    return false;
  }

  /* 数据源标识同步到全站页脚（app.js 仅在启动时写过一次，这里按当前模式覆盖） */
  function paintFooter() {
    const f = document.getElementById('fver');
    if (f) f.textContent = M.CONF.version + ' · ' + MODES[DS.mode].foot +
      (DS.mode === 'replay' ? ' @ ' + snapKey() : DS.mode === 'live' ? '（' + (probeOk() ? '已连通' : '未连通') + '）' : '');
  }

  /* 供其它页面只读消费（如接口管理页顶部的数据源提示） */
  g.DATASOURCE = {
    get mode() { return DS.mode; },
    get name() { return MODES[DS.mode].name; },
    get color() { return MODES[DS.mode].color; },
    get tagCls() { return MODES[DS.mode].tag; },
    get writable() { return writable(); },
    get by() { return DS.by; },
    get since() { return DS.since; },
    get snapshot() { return DS.mode === 'replay' ? snapKey() : null; },
    get connected() { return DS.mode === 'live' ? probeOk() + '/' + DS.probe.items.length : null; },
    get log() { return DS.log.slice(); }
  };

  /* ---- COM-03 参数总览登记（模块加载时执行）---- */
  U.regParams({
    key: 'DEV_ACCESS', name: '设备接入参数', page: '设备管理', hash: '#/devices',
    ver: 'demo-v1', confirmed: false, owner: '设备方 / 平台运维',
    basis: '协议 v8.6 未规定具体数值，当前为 Demo 缺省值',
    affects: ['设备详情「接口信息」页签', '心跳判活', '连通性探测'],
    items: () => [
      { n: '心跳间隔', v: '30 s' }, { n: '上报周期', v: '1000 ms' },
      { n: '连通性探测超时', v: '3000 ms' },
      { n: '时钟同步源', v: 'NTP · ntp.dongying.gov.cn' },
      { n: '坐标系 / 高程基准', v: M.CONF.coordSys + ' · ' + M.CONF.altDatum }
    ]
  });
  U.regParams({
    key: 'DEV_REPLAY', name: '回放库参数（B7 数据源切换）', page: '设备管理', hash: '#/devices',
    ver: 'demo-v1', confirmed: false, owner: '平台运维',
    basis: '设计 §5.6 Mock 与回放服务；帧密度与保留窗口未在文档中给定',
    affects: ['历史回放可选时刻', '回放快照的设备状态'],
    items: () => [
      { n: '回放库时间范围', v: SNAPS.length + ' 天（' + M.util.fmtD(SNAPS[0]) + ' 起）' },
      { n: '帧密度', v: '每日 1 帧，共 ' + SNAPS.length + ' 帧' },
      { n: '快照状态翻转比例', v: '12%（相对当前台账，确定性派生）' },
      { n: '正式接口端点', v: DS.endpoint || TBD }
    ]
  });

  /* ---------------- 模式条 ----------------
     V1.1 §5.6 note 是红线：严禁在评审/验收场景把模拟数据当作真实感知结果呈现。
     所以来源标识做成顶部整条状态栏（不是角落灰字）：Mock 用警示色并写明「非真实感知结果」，
     回放标「回放」并显示原始录制时间，正式接口标「实时」并显示连通状态。 */
  function modeBar() {
    const m = MODES[DS.mode], sc = schemaCheck();
    let info = '', extra = '', warn = '';
    if (DS.mode === 'mock') {
      warn = `<b style="color:#ffd07a">模拟数据源 · 非真实感知结果</b>
        <span style="color:var(--txt-3)">（V1.1 §5.6：严禁在评审或验收场景中把模拟数据当作真实感知结果呈现）</span>`;
      info = `Adapter <b class="mono">${m.adapter}</b> · 数据基准 <span class="mono">${M.util.fmtDT(M.CONF.demoTime)}</span>
        · 全站 ${M.ifStats.mocked}/${M.ifStats.total} 个接口为 Mock 占位`;
    } else if (DS.mode === 'replay') {
      warn = `<b style="color:#c8a8ff">回放数据 · 非当前时刻状态</b>`;
      info = `Adapter <b class="mono">${m.adapter}</b> · 回放库 <span class="mono">${spanTx()}</span>（每日 1 帧，共 ${SNAPS.length} 帧）`;
      extra = `<span style="color:var(--txt-2)">原始录制时间</span>
        <span class="btn" data-snap="-1" title="上一帧" style="padding:0 9px">‹</span>
        <b class="mono" style="color:${m.color};font-size:13px">${snapKey()}</b>
        <span class="btn" data-snap="1" title="下一帧" style="padding:0 9px">›</span>
        <span class="tag t-gray">第 ${DS.snapIdx + 1}/${SNAPS.length} 帧 · 距今 ${SNAPS.length - DS.snapIdx} 天</span>
        <span class="tag t-purple">只读</span>
        <span style="color:var(--txt-3)">录制源：设备心跳与状态上报（同一 Schema，仅取数时刻不同）</span>`;
    } else {
      const p = DS.probe, ok = probeOk();
      warn = ok ? `<b style="color:#79e5a5">实时数据 · 来自正式环境接口</b>`
        : `<b style="color:#ff96a0">正式接口未连通 · 页面如实显示无数据（未用 Mock 兜底）</b>`;
      info = `Adapter <b class="mono">${m.adapter}</b> · 端点 <span class="mono">${p.endpoint}</span>`;
      extra = `<span style="color:var(--txt-2)">接口连通状态</span>
        <span class="tag ${ok ? 't-green' : 't-red'}">${ok ? '已连通' : '未连通'} ${ok}/${p.items.length} 通道</span>
        <span style="color:var(--txt-3)">探测于 ${p.at}</span>
        <span class="lnk" id="dsProbeDetail">探测详情 ›</span>
        <span class="btn" id="dsReprobe" style="padding:0 9px">↻ 重新探测</span>
        <span class="btn warn" id="dsBack" style="padding:0 9px">↩ 切回 Mock</span>`;
    }
    return `<section class="panel mb12" style="flex:none;border-color:${m.color}99;
        box-shadow:inset 4px 0 0 ${m.color};background:linear-gradient(90deg,${m.color}1f,var(--panel) 46%)">
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;flex-wrap:wrap;font-size:12.5px">
        <span class="tag ${m.tag}" style="font-size:13px;padding:2px 10px;font-weight:600">● 数据来源：${m.mark}｜${m.name}</span>
        ${warn}
        <span style="flex:1;min-width:12px"></span>
        <span class="tag ${sc.same ? 't-green' : 't-red'}" title="三种模式必须返回同一 Schema：实测比对 MockAdapter 与 ReplayAdapter 的字段集合">
          Schema 一致 ${sc.n} 字段 ${sc.same ? '✓' : '✗ ' + sc.diff.join(',')}</span>
        <button class="btn pri" id="dsSwitch">⇄ 切换数据源</button>
        <button class="btn" id="dsLog">▤ 切换留痕 (${DS.log.length})</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;flex-wrap:wrap;font-size:12px;
        border-top:1px solid var(--line-2);color:var(--txt-3)">
        ${info}<span style="flex:1;min-width:8px"></span>
        <span>最近切换：${DS.by} · ${DS.since} · ${DS.reason}</span>
      </div>
      ${extra ? `<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;flex-wrap:wrap;
        font-size:12.5px;border-top:1px solid var(--line-2);background:${m.color}14">${extra}</div>` : ''}
    </section>`;
  }

  /* ---------------- 页面 ---------------- */
  /* =========================================================================
   * 表头排序
   * 排序是**页面状态**：只对 filtered() 的副本排序，绝不改动 MOCK.devices 的数组顺序
   * —— 那是全局共享数据，就地排序会让其它页面的"最近 N 条"之类口径跟着变。
   * ====================================================================== */
  const SORT = { key: null, dir: 'asc' };
  const ST_ORDER = ['在线', '离线', '异常'];
  const HL_ORDER = ['良好', '一般', '异常', '未知'];
  const SORT_KEYS = {
    id: d => d.id,
    name: d => d.name,
    type: d => d.type + d.channel,
    owner: d => d.owner,
    vendor: d => d.vendor,
    status: d => ST_ORDER.indexOf(d.status),
    health: d => HL_ORDER.indexOf(d.health),
    hb: d => d.hb                       // 'YYYY-MM-DD HH:mm:ss' 字典序即时间序
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
    return rows.slice().sort((a, b) => {        // slice():排副本
      const x = f(a), y = f(b);
      return (x < y ? -1 : x > y ? 1 : 0) * d;
    });
  }

  function filtered() {
    return dsList().filter(d =>
      (st.type === '全部' || d.type === st.type) &&
      (st.region === '全部' || d.region === st.region) &&
      (st.vendor === '全部' || d.vendor === st.vendor) &&
      (st.status === '全部' || d.status === st.status) &&
      (!st.kw || d.id.includes(st.kw) || d.name.includes(st.kw)));
  }

  function render() {
    const all = dsList();
    const D = stats(all);
    const dash = v => D.total ? v : '—';
    st.sel = (st.sel && all.find(d => d.id === st.sel.id)) || all[0] || null;
    const noData = !D.total;
    return `${modeBar()}
    ${U.kpis([
      { label: '设备总数', value: dash(U.num(D.total)), color: 'blue', icon: 'device', desc: noData ? '正式接口未连通' : '在线 + 离线 + 异常' },
      { label: '在线数', value: dash(U.num(D.online)), color: 'green', icon: 'check', desc: noData ? '—' : `在线率 ${D.onlineRate}%` },
      { label: '离线数', value: dash(U.num(D.offline)), color: 'gray', icon: 'alert', desc: noData ? '—' : `离线率 ${D.offlineRate}%` },
      { label: '异常数', value: dash(U.num(D.abnormal)), color: 'red', icon: 'alert', desc: noData ? '—' : `异常率 ${D.abnormalRate}%` },
      { label: '告警中设备', value: dash(U.num(D.alarm)), color: 'amber', icon: 'alert', desc: '含在上述状态内，非独立分类' },
      { label: '接入厂家数', value: dash(U.num(D.vendors)), color: 'purple', icon: 'api', desc: noData ? '—' : `设备型号 ${D.models} 种` }
    ])}

    <div class="row" style="margin-top:12px;height:calc(100vh - 284px);min-height:608px;padding-bottom:12px">
      ${U.panel({
      title: '设备管理', style: 'flex:1', nopad: true,
      sub: DS.mode === 'mock' ? '模拟数据源 · 非真实感知结果'
        : DS.mode === 'replay' ? '回放 · 原始录制时间 ' + snapKey() + ' · 只读'
          : '实时 · 正式接口' + (probeOk() ? '已连通' : '未连通'),
      body: `<div class="toolbar">
          ${U.field('设备类型', U.select('type', ['全部', ...TYPES], st.type))}
          ${U.field('所属区域', U.select('region', ['全部', ...M.DISTRICTS.map(d => d.name)], st.region))}
          ${U.field('供应商', U.select('vendor', ['全部', ...VENDORS], st.vendor))}
          ${U.field('在线状态', U.select('status', ['全部', '在线', '离线', '异常'], st.status))}
          <input class="ip" id="dvKw" style="width:170px" placeholder="请输入设备编号/名称" value="${st.kw}">
          <button class="btn pri" id="dvAdd" ${writable() ? '' : 'disabled'}>＋ 新增设备</button>
          <button class="btn" id="dvImp" ${writable() ? '' : 'disabled'}>⭱ 批量导入</button>
          <button class="btn" id="dvExp">⭳ 导出</button>
        </div>
        <div id="dvList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}
      ${U.panel({
      title: '设备详情预览', style: 'width:560px',
      extra: `<span class="lnk" id="dvGoMon">实时监测 ›</span>`,
      nopad: true, bodyStyle: 'padding:0;display:flex;flex-direction:column',
      body: `<div id="dvDetail" style="flex:1;overflow:auto"></div>`
    })}
    </div>`;
  }

  function list() {
    const rows = sorted(filtered());
    const page = rows.slice((st.page - 1) * st.size, st.page * st.size);
    const ro = !writable();
    return U.table([
      { t: sortTh('设备编号', 'id'), w: '112px', cls: 'num', render: d => d.id.slice(-9) },
      {
        t: sortTh('设备名称', 'name'), w: '124px',
        render: d => `<div title="${d.name}" style="white-space:normal;line-height:1.4">${d.disabled
          ? `<span style="color:var(--txt-3)">${d.name}</span> <span class="tag t-gray">已停用</span>` : d.name}</div>`
      },
      { t: sortTh('类型 / 通道', 'type'), w: '142px', render: d => `${U.tag(d.type, 't-cyan')} <span style="color:var(--txt-3)">${d.channel}</span>` },
      {
        t: sortTh('产权单位 / 位置', 'owner'), w: '164px',
        render: d => `<div style="white-space:normal;line-height:1.4">${d.owner}</div>
          <div title="${d.addr}" style="font-size:11px;color:var(--txt-3);white-space:normal;line-height:1.4;
            max-height:31px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${d.addr}</div>`
      },
      {
        /* 型号是「【待确认：设备方提供】」这种长占位串，nowrap 下它就是本表最小宽度的来源之一 */
        t: sortTh('型号 / 供应商', 'vendor'), w: '128px',
        render: d => `<div title="${d.model}" style="white-space:normal;line-height:1.4;font-size:11.5px;
            max-height:33px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${d.model}</div>
          <div style="font-size:11px;color:var(--txt-3)">${d.vendor}</div>`
      },
      {
        t: sortTh('状态 / 健康', 'status'), w: '92px',
        render: d => `<div style="color:${d.status === '在线' ? '#79e5a5' : d.status === '离线' ? '#a8bcd8' : '#ff8b95'}">${U.dotState(d.status)}</div>
          <div style="margin-top:2px">${U.tag(d.health)}</div>`
      },
      { t: sortTh('最后心跳', 'hb'), w: '78px', cls: 'num', render: d => d.hb.slice(11) },
      {
        t: '操作', w: '132px', render: d => `<span class="lnk" data-op="view|${d.id}">查看</span>` +
          (ro ? `<span class="lnk" style="color:var(--txt-3);cursor:not-allowed" title="非 Mock 数据源不可写">编辑</span>
             <span class="lnk" style="color:var(--txt-3);cursor:not-allowed" title="非 Mock 数据源不可写">停用</span>`
            : `<span class="lnk" data-op="edit|${d.id}">编辑</span><span class="lnk" data-op="stop|${d.id}">${d.disabled ? '启用' : '停用'}</span>`)
      }
    ], page, { rowId: d => d.id, activeId: st.sel && st.sel.id })
      + U.pager({ total: rows.length, page: st.page, size: st.size });
  }

  function detail() {
    const d = st.sel;
    if (!d) return `<div class="empty">${DS.mode === 'live'
      ? '正式接口未连通，无设备数据<br><span style="font-size:11.5px">页面逻辑未变，仅 Adapter 取数失败</span>' : '请选择设备'}</div>`;
    const tabs = [['pos', '位置概览'], ['base', '基础参数'], ['api', '接口信息'], ['zone', '所属区域']];
    let body = '';
    if (st.tab === 'pos') {
      body = `<div id="dvMap" style="height:200px;margin-bottom:12px;border:1px solid var(--line-2);border-radius:6px"></div>
        ${U.kv([['经度', `<span class="mono">${d.lon.toFixed(6)}° E</span>`], ['纬度', `<span class="mono">${d.lat.toFixed(6)}° N</span>`],
      ['安装高度', d.alt + ' m'], ['坐标系', M.CONF.coordSys], ['安装位置', d.addr], ['所属区域', d.region]])}`;
    } else if (st.tab === 'base') {
      body = U.kv([['设备型号', d.model], ['设备品类', d.cat], ['供应商', d.vendor], ['产权单位', d.owner],
      ['接入通道', d.channel], ['安装时间', d.installed], ['工作频段', d.freq], ['覆盖半径', d.cover],
      ['固件版本', d.fw], ['设备状态', d.status + (d.alarm ? ' · 告警中' : '')], ['健康状态', d.health],
      ['最后心跳', d.hb + `（${d.hbMin} 分钟前）`]]);
    } else if (st.tab === 'api') {
      body = U.kv([['通信方式', d.proto], ['IP 地址', `<span class="mono">${d.ip}</span>`], ['端口', `<span class="mono">${d.port}</span>`],
      ['接入地址', `<span class="mono">${d.proto === 'TCP' ? 'tcp://' + d.ip + ':' + d.port
        : (d.port === 8443 ? 'https://' : 'http://') + d.ip + ':' + d.port + '/api/v1/data'}</span>`],
      ['鉴权方式', d.channel === '5G-A' ? 'AK/SK' : 'Token'], ['心跳间隔', '30 s'], ['上报周期', '1000 ms'],
      ['数据格式', 'JSON'], ['时钟同步', 'NTP · ntp.dongying.gov.cn'],
      ['当前时延', d.latency == null ? '—' : d.latency + ' ms'], ['丢包率', d.loss == null ? '—' : d.loss + ' %'],
      ['信号强度', d.rssi + ' dBm']])
        + `<div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn" style="flex:1;justify-content:center" data-dv="test">连通性测试</button>
          <button class="btn" style="flex:1;justify-content:center" onclick="location.hash='#/commission'">进入调测 →</button></div>`;
    } else {
      const near = M.airspaces.filter(a => Math.abs(a.center.lon - d.lon) < .25 && Math.abs(a.center.lat - d.lat) < .25);
      body = U.kv([['所属区域', d.region], ['覆盖空域', near.length ? near.map(a => a.name).join('<br>') : '未覆盖管制空域'],
      ['关联案件(近30天)', M.cases.filter(c => c.district === d.region).length + ' 件'],
      ['区域目标(近30天)', M.allTargets.filter(t => t.district === d.region).length + ' 个']]);
    }
    return `<div style="padding:12px 12px 0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <b style="font-size:14px">${d.name}</b>${U.tag(d.status)}</div>
        <div class="mono" style="color:var(--txt-3);font-size:12px;margin-bottom:${DS.mode === 'mock' ? '10px' : '6px'}">设备编号：${d.id}</div>
        ${DS.mode === 'replay' ? `<div class="tag t-purple" style="margin-bottom:10px">回放 · 原始录制时间 ${snapKey()} · 只读</div>`
        : DS.mode === 'live' ? `<div class="tag t-green" style="margin-bottom:10px">实时 · 正式接口</div>` : ''}
      </div>
      <div class="tabs" style="padding:0 12px">${tabs.map(([k, t]) => `<span class="tab ${st.tab === k ? 'on' : ''}" data-tab="${k}">${t}</span>`).join('')}</div>
      <div style="padding:12px">${body}</div>`;
  }

  function paintDetail() {
    document.getElementById('dvDetail').innerHTML = detail();
    if (map) { map.destroy(); map = null; }
    const el = document.getElementById('dvMap');
    if (st.tab === 'pos' && el && st.sel) {
      map = new MapView(el, { zoom: 2.4, maxDev: 30, layers: { track: false, alarm: false }, legend: false });
      map.setData({ airspaces: M.airspaces, devices: [st.sel], targets: [], alarms: [] });
      const p = [st.sel.lon, st.sel.lat];
      // 将所选设备居中
      setTimeout(() => { if (!map) return;   // 页面已切走时 destroy() 会把 map 置空，延时回调必须自查
        const q = map.px(p[0], p[1]); map.ox += map.w / 2 - q[0]; map.oy += map.h / 2 - q[1]; }, 30);
    }
  }
  function paint() { document.getElementById('dvList').innerHTML = list(); paintDetail(); }

  function mount(view) {
    paint();
    paintFooter();
    U.on(view, '[data-row]', 'click', (e, el) => {
      st.sel = dsList().find(d => d.id === el.dataset.row);
      U.selectRow(view, el.dataset.row);      // 只切换选中态,列表不重建、滚动位置保持
      paintDetail();
    });
    U.on(view, '[data-tab]', 'click', (e, el) => { st.tab = el.dataset.tab; paintDetail(); });
    U.on(view, '[data-sort]', 'click', (e, el) => {
      const k = el.dataset.sort;
      if (SORT.key === k) SORT.dir = SORT.dir === 'asc' ? 'desc' : 'asc';
      else { SORT.key = k; SORT.dir = 'asc'; }
      st.page = 1;                       // 整表重排,停留在第 N 页没有意义
      document.getElementById('dvList').innerHTML = list();   // 重建即回到列表顶部
    });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { st.page = +el.dataset.pg; paint(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { st.size = parseInt(el.value); st.page = 1; paint(); });
    U.on(view, '[data-f]', 'change', (e, el) => { st[el.dataset.f] = el.value; st.page = 1; paint(); });
    U.on(view, '[data-op]', 'click', (e, el) => {
      e.stopPropagation();
      const [op, id] = el.dataset.op.split('|');
      st.sel = dsList().find(d => d.id === id);
      if (op === 'view') { paint(); return; }
      if (!guardWrite(op === 'edit' ? '编辑设备' : '停用/启用设备')) return;
      if (op === 'edit') U.toast('编辑设备 ' + id + '（Demo）；正式环境 PUT /api/v1/device/' + id);
      else {
        st.sel.disabled = !st.sel.disabled;
        replayCache = {};        // 台账变了,历史快照需按新台账重算
        paint();
        U.toast(st.sel.disabled
          ? `已停用「${st.sel.name}」，该设备数据不再参与融合计算（台账保留）`
          : `已重新启用「${st.sel.name}」`, st.sel.disabled ? 'err' : 'ok');
      }
    });
    U.on(view, '[data-dv]', 'click', () => U.toast(
      DS.mode === 'live' ? '正式接口未连通，无法发起连通性测试'
        : DS.mode === 'replay' ? '历史回放为只读视图，连通性测试针对当前时刻，请先切回 Mock 数据源'
          : '连通性测试：TCP 握手成功，心跳正常，往返时延 ' + (st.sel.latency || 0) + ' ms',
      DS.mode === 'mock' ? 'ok' : 'err'));
    document.getElementById('dvKw').oninput = e => { st.kw = e.target.value.trim(); st.page = 1; document.getElementById('dvList').innerHTML = list(); };
    document.getElementById('dvAdd').onclick = () => { if (guardWrite('新增设备')) addModal(); };
    document.getElementById('dvImp').onclick = () => { if (guardWrite('批量导入')) U.toast('支持 Excel 批量导入设备台账（模板含编号/型号/坐标/协议字段）'); };
    document.getElementById('dvExp').onclick = () => U.toast(`已导出「设备台账.xlsx」共 ${filtered().length} 条（数据源：${MODES[DS.mode].name}${DS.mode === 'replay' ? ' @ ' + snapKey() : ''}）`, 'ok');
    document.getElementById('dvGoMon').onclick = () => location.hash = '#/monitor';

    /* ---- B7 数据源切换 ---- */
    document.getElementById('dsSwitch').onclick = switchModal;
    document.getElementById('dsLog').onclick = logModal;
    U.on(view, '[data-snap]', 'click', (e, el) => seek(+el.dataset.snap));
    const pd = document.getElementById('dsProbeDetail'); if (pd) pd.onclick = probeModal;
    const rp = document.getElementById('dsReprobe'); if (rp) rp.onclick = () => {
      DS.probe = probe();
      record('探测', MODES.live.name, MODES.live.name, DS.by, '重新探测正式接口连通性',
        probeOk() ? '成功' : '失败', `${probeOk()}/${DS.probe.items.length} 通道连通 · 端点 ${DS.probe.endpoint}`);
      g.APP.rerender();
      U.toast(`连通性探测完成：${probeOk()}/${DS.probe.items.length} 通道连通`, probeOk() ? 'ok' : 'err');
    };
    const bk = document.getElementById('dsBack'); if (bk) bk.onclick = () =>
      applySwitch('mock', { by: DS.by, reason: '正式接口未连通，回退至 Mock 数据源' });
  }

  /* ---- 留痕：追加一条记录（只增不改） ---- */
  function record(kind, from, to, by, reason, result, detail) {
    DS.log.unshift({ seq: DS.log.length + 1, kind, at: M.util.fmtDT(M.CONF.demoTime), from, to, by, reason, result, detail });
    save();
  }
  const modeTx = (m, idx) => MODES[m].name + (m === 'replay' ? '（' + M.util.fmtDT(SNAPS[idx == null ? DS.snapIdx : idx]) + '）' : '');

  function seek(step) {
    const i = Math.min(SNAPS.length - 1, Math.max(0, DS.snapIdx + step));
    if (i === DS.snapIdx) return U.toast(step < 0 ? '已是回放库最早一帧' : '已是回放库最新一帧');
    const from = modeTx('replay');
    DS.snapIdx = i;
    record('回放定位', from, modeTx('replay'), DS.by, '回放时间轴定位', '成功', '快照 ' + snapKey() + ' · 第 ' + (i + 1) + '/' + SNAPS.length + ' 帧');
    st.page = 1;
    g.APP.rerender();
    U.toast('已回放至 ' + snapKey() + '，设备状态与 KPI 取自该时刻快照', 'ok');
  }

  function applySwitch(to, o) {
    const from = modeTx(DS.mode);
    if (to === 'replay' && o.snap != null) DS.snapIdx = o.snap;
    if (to === 'live') { DS.endpoint = (o.ep || '').trim() || TBD; }
    DS.mode = to;
    if (to === 'live') DS.probe = probe();
    DS.by = o.by; DS.since = M.util.fmtDT(M.CONF.demoTime); DS.reason = o.reason;
    const detail = to === 'live'
      ? `端点 ${DS.endpoint} · 连通 ${probeOk()}/${DS.probe.items.length} 通道`
      : to === 'replay' ? `快照 ${snapKey()} · 回放库 ${spanTx()}`
        : `adapter=assets/js/mock.js · 设备台账 ${M.devices.length} 台`;
    record('切换', from, modeTx(to), o.by, o.reason,
      to === 'live' && !probeOk() ? '未连通' : '成功', detail);
    st.page = 1; st.sel = null;
    U.closeModal();
    g.APP.rerender();
    U.toast(to === 'live' && !probeOk()
      ? `已切换到「正式接口」：${probeOk()}/${DS.probe.items.length} 通道连通，页面如实显示无数据（未用 Mock 兜底）`
      : `数据源已切换为「${modeTx(to)}」，全站页面数据随之切换`, to === 'live' && !probeOk() ? 'err' : 'ok');
  }

  function switchModal() {
    let target = DS.mode, snap = DS.snapIdx;
    function extra() {
      if (target === 'replay') {
        return `<div class="warnbox" style="border-color:rgba(169,123,255,.45);background:rgba(169,123,255,.10)">
            历史回放为<b>只读视图</b>：页面展示所选时刻的设备状态快照，期间禁止新增/编辑/停用等写操作。</div>
          ${U.field('原始录制时间', `<select class="sel" data-f="snap" style="flex:1">${SNAPS.map((d, i) =>
          `<option value="${i}" ${i === snap ? 'selected' : ''}>${M.util.fmtDT(d)}（${SNAPS.length - i} 天前）</option>`).join('')}</select>`)}
          <div style="font-size:12px;color:var(--txt-3);margin-top:6px">回放库时间范围
            <span class="mono">${spanTx()}</span> · 每日 1 帧，共 ${SNAPS.length} 帧 ·
            回放记录与 Mock/正式接口<b>字段结构完全一致</b>，仅取数时刻不同</div>`;
      }
      if (target === 'live') {
        return `<div class="warnbox">切换后由 <b>RestAdapter</b> 向正式环境取数。<b>Demo 环境不具备正式端点</b>，
            切换后页面会如实显示「未连通 / 无数据」，不会用 Mock 数据冒充正式接口 ——
            页面代码一行未改，变的只是 Adapter，这正是设计 §9.4 承诺的验证方式。</div>
          ${U.field('接入地址', `<input class="ip" data-f="ep" style="flex:1" placeholder="${TBD}" value="${DS.endpoint}">`)}
          <div style="font-size:12px;color:var(--txt-3);margin-top:6px">
            探测方式：对 ${M.deviceStats.byChannel.length} 条接入通道各发一次设备清单查询，超时 3000 ms</div>`;
      }
      return `<div class="warnbox">切回 Mock：数据由 <b class="mono">assets/js/mock.js</b> 提供，基准时刻固定为
          <span class="mono">${M.util.fmtDT(M.CONF.demoTime)}</span>（D3 评审基准），可执行编辑/停用等写操作。</div>`;
    }
    U.modal({
      title: '切换数据源（设计 §5.6 / §9.4）', width: '620px',
      body: `<div style="display:flex;gap:8px;margin-bottom:12px" id="dsPick">
          ${Object.keys(MODES).map(k => `<div class="btn" data-pick="${k}" style="flex:1;justify-content:center;height:auto;
            padding:9px 6px;flex-direction:column;gap:3px;${k === target ? `background:${MODES[k].color}22;border-color:${MODES[k].color};color:#fff` : ''}">
            <b>${MODES[k].name}</b><span style="font-size:11px;color:var(--txt-3)">${MODES[k].writable ? '可读写' : '只读'}</span></div>`).join('')}
        </div>
        <div id="dsExtra">${extra()}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          ${U.field('切换人', `<input class="ip" data-f="by" style="flex:1" value="管理员">`)}
          ${U.field('切换原因', U.select('rs', ['评审演示', '正式接口联调', '历史问题复盘', '设备离线排查', '其他']))}
        </div>
        ${U.field('备注', `<input class="ip" data-f="note" style="flex:1;margin-top:10px" placeholder="选填，与原因一并记入留痕">`)}
        <label class="chk" style="margin-top:12px"><input type="checkbox" data-f="ack">
          我确认：切换数据源会改变全站页面所显示的数据，本次切换将<b>记入留痕且不可修改</b>。</label>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">确认切换</button>`,
      on: {
        ok: el => {
          const by = el.querySelector('[data-f="by"]').value.trim();
          const note = el.querySelector('[data-f="note"]').value.trim();
          const rs = el.querySelector('[data-f="rs"]').value;
          if (!el.querySelector('[data-f="ack"]').checked) return U.toast('请先勾选确认项', 'err');
          if (!by) return U.toast('请填写切换人（留痕必填）', 'err');
          const sn = el.querySelector('[data-f="snap"]');
          const ep = el.querySelector('[data-f="ep"]');
          applySwitch(target, { by, reason: rs + (note ? ' · ' + note : ''), snap: sn ? +sn.value : null, ep: ep ? ep.value : '' });
        }
      },
      mounted: el => {
        el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
          target = b.dataset.pick;
          el.querySelectorAll('[data-pick]').forEach(x => {
            const on = x.dataset.pick === target, c = MODES[x.dataset.pick].color;
            x.style.cssText = x.style.cssText.replace(/background[^;]*;?|border-color[^;]*;?|color:#fff;?/g, '');
            if (on) { x.style.background = c + '22'; x.style.borderColor = c; x.style.color = '#fff'; }
          });
          el.querySelector('#dsExtra').innerHTML = extra();
          bindSnap(el);
        });
        bindSnap(el);
      }
    });
    function bindSnap(el) {
      const s = el.querySelector('[data-f="snap"]');
      if (s) s.onchange = () => { snap = +s.value; };
    }
  }

  function logModal() {
    U.modal({
      title: '数据源切换留痕', width: '960px',
      body: `<div class="warnbox">留痕<b>只增不改</b>：每次数据源切换、回放定位、连通性探测各记一条，
          含操作人、时间、原模式→新模式、原因与结果。正式环境应同步写入平台审计服务（接口地址【待确认】）。</div>
        ${U.table([
        { t: '#', w: '34px', align: 'center', render: r => r.seq },
        { t: '时间', w: '92px', cls: 'num', render: r => `<div>${r.at.slice(0, 10)}</div><div>${r.at.slice(11)}</div>` },
        { t: '类型', w: '74px', align: 'center', render: r => U.tag(r.kind, r.kind === '切换' ? 't-blue' : r.kind === '回放定位' ? 't-purple' : 't-cyan') },
        {
          /* td 默认 nowrap,长文本会把表撑出横滚 —— 这里放开单元格内换行并给定宽 */
          t: '数据源变化', w: '206px', render: r => `<div style="white-space:normal;color:var(--txt-3);font-size:11.5px">原 ${r.from}</div>
            <div style="white-space:normal">→ <b>${r.to}</b></div>`
        },
        { t: '操作人', w: '74px', render: r => r.by },
        { t: '结果', w: '84px', align: 'center', render: r => U.tag(r.result, r.result === '成功' ? 't-green' : 't-amber') },
        {
          t: '原因 / 详情', w: '300px', render: r => `<div style="white-space:normal">${r.reason}</div>
            <div style="white-space:normal;font-size:11.5px;color:var(--txt-3)">${r.detail}</div>`
        }
      ], DS.log, { maxH: '360px' })}`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn pri" data-act="exp">⭳ 导出留痕</button>`,
      on: { exp: () => U.toast('已导出「数据源切换留痕.xlsx」共 ' + DS.log.length + ' 条', 'ok') }
    });
  }

  function probeModal() {
    const p = DS.probe;
    U.modal({
      title: '正式接口连通性探测', width: '880px',
      body: `${U.kv([['探测端点', `<span class="mono">${p.endpoint}</span>`], ['探测时间', p.at],
      ['探测结果', U.tag(probeOk() ? '已连通' : '未连通', probeOk() ? 't-green' : 't-red') + ` ${probeOk()}/${p.items.length} 通道`]])}
        <div style="margin-top:12px">${U.table([
        { t: '接入通道', w: '104px', render: r => r.channel },
        { t: '台账设备数', w: '86px', align: 'right', render: r => U.num(r.total) },
        { t: '探测地址（相对端点）', w: '230px', render: r => `<span class="mono" style="font-size:11px">${r.path}</span>` },
        { t: '耗时', w: '70px', cls: 'num', align: 'right', render: r => r.ms + 'ms' },
        {
          t: '结果', render: r => U.tag(r.ok ? '连通' : '失败', r.ok ? 't-green' : 't-red') +
            `<span style="font-size:11.5px;color:#ff8b95;margin-left:8px">${r.err || ''}</span>`
        }
      ], p.items)}</div>
        <div class="warnbox" style="margin-top:12px">Demo 环境未接入正式端点，探测必然失败。页面此时显示<b>空台账</b>而非 Mock 数据 ——
          页面渲染、筛选、KPI 派生逻辑一行未改，说明取数已完全收敛在 Adapter 层。</div>`,
      footer: `<button class="btn" data-close>关闭</button>`
    });
  }

  function addModal() {
    U.modal({
      title: '新增设备', width: '640px',
      body: `<div class="warnbox">设备接入需同时登记 <b>协议、鉴权、上报频率、错误码、坐标基准</b>（会议纪要 §8.1），否则无法进入调测流程。</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${U.field('设备名称', `<input class="ip" style="flex:1" placeholder="如：东营区雷达09号">`)}
        ${U.field('设备类型', U.select('t', TYPES))}
        ${U.field('接入通道', U.select('c', ['融合感知箱', 'TDOA', '5G-A']))}
        ${U.field('供应商', U.select('v', VENDORS))}
        ${U.field('IP 地址', `<input class="ip" style="flex:1" placeholder="192.168.10.45">`)}
        ${U.field('端口', `<input class="ip" style="width:90px" placeholder="8080">`)}
        ${U.field('通信协议', U.select('p', ['HTTP', 'TCP', 'WS']))}
        ${U.field('鉴权方式', U.select('a', ['Token', 'AK/SK', '无']))}
        ${U.field('经度', `<input class="ip" style="flex:1" placeholder="118.582000">`)}
        ${U.field('纬度', `<input class="ip" style="flex:1" placeholder="37.449000">`)}
      </div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">保存并进入调测</button>`,
      on: { ok: () => { U.closeModal(); U.toast('已保存，正在跳转设备调测…', 'ok'); setTimeout(() => location.hash = '#/commission', 600); } }
    });
  }

  function destroy() { if (map) map.destroy(); map = null; }

  /* 刷新后即便落在别的页面,页脚的数据来源标识也要与当前模式一致
     （app.js 的 boot 也在 DOMContentLoaded 里写页脚，这里用 setTimeout 排在它之后） */
  document.addEventListener('DOMContentLoaded', () => setTimeout(paintFooter, 0));

  g.PAGES = g.PAGES || {};
  g.PAGES.devices = { render, mount, destroy };
})(window);
