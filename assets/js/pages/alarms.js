/* ===== 13. 异常飞行与告警中心 ===== */
(function (g) {
  const M = MOCK, U = UI;
  let st = { page: 1, size: 10, level: '全部', status: '全部', kind: '全部', region: '全部', sel: null,
    sort: 'ts', dir: -1 };     // 默认按时间倒序，与数据层 alarms.sort(b.ts-a.ts) 一致，首屏顺序不变

  /* 告警页按本轮确认后的最短闭环展示，不复用案件的六环节状态：
     待核实 → 反制中 → 干扰中 → 待处置；核实不通过则进入误报终态。 */
  const FLOW_STATUS = ['待核实', '反制中', '干扰中', '待处置', '误报'];
  const LEGACY_FLOW_STATUS = { '新建': '待核实', '已确认': '待核实', '处置中': '反制中', '已关闭': '待处置', '误报': '误报' };
  const statusOf = a => a.flowStatus || LEGACY_FLOW_STATUS[a.status] || '待核实';

  /* 增加一条可直接演示“待核实 → 属实/误报”的数据；底层 status 仍保留平台枚举，
     告警页的新状态放在 flowStatus，避免改坏统计、案件等共享模块。 */
  (function addPendingVerificationAlarm() {
    const id = 'ALM' + M.util.fmtD(M.CONF.demoTime).replace(/-/g, '') + '999';
    if (M.alarms.some(a => a.id === id)) return;
    const seed = M.todayAlarms[0] || M.alarms[0];
    if (!seed) return;
    const pending = Object.assign({}, seed, {
      id, time: M.util.fmtDT(M.CONF.demoTime), ts: M.CONF.demoTime.getTime(),
      status: '新建', flowStatus: '待核实', verified: false,
      detail: `目标 ${seed.targetId} 触发新增告警，等待值班员人工核实`,
      notifyLog: [], verifyLog: []
    });
    M.alarms.unshift(pending);
    M.todayAlarms.unshift(pending);
  })();

  /* 表头排序：排序键是**页面状态**，绝不去 sort MOCK.alarms ——
     那是全站共享的同一份数组，就地排序会顺手改掉总览/统计/处罚各页看到的顺序。 */
  const LV_RANK = { '高': 3, '中': 2, '低': 1 };
  const SORTERS = {
    ts: a => a.ts,
    level: a => LV_RANK[a.level] || 0,
    kind: a => a.kind + '\u0000' + a.type,
    // 中文串比较走的是 UTF-16 码位，排出来既不是拼音也不是笔画，等于随机顺序。
    // 改用 DISTRICTS 的既定顺序（按目标量权重排的），是有含义且稳定的。
    district: a => M.DISTRICTS.findIndex(d => d.name === a.district),
    status: a => FLOW_STATUS.indexOf(statusOf(a))      // 按本页处置流程顺序排，不是按字面
  };
  const SORT_NOTE = { district: '（按行政区既定顺序）', status: '（按处置流程顺序）', level: '（高→低）' };
  function sortTh(key, label) {
    const on = st.sort === key;
    /* 排序箭头只画在当前排序列上：每个表头都挂一个 ⇅ 会把表格最小宽度顶宽（实测 +17px），
       窄视口下直接变成横向溢出。可排序的提示改用点线下划线 + 手型光标，不占宽度。 */
    return `<span class="lnk" data-sort="${key}" role="button" tabindex="0" title="点击按「${label}」排序${SORT_NOTE[key] || ''}"
      style="color:inherit;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:rgba(156,198,255,.5)"
      >${label}${on ? `<span style="font-size:10px;margin-left:2px">${st.dir < 0 ? '▼' : '▲'}</span>` : ''}</span>`;
  }
  let map = null;                                   // B5:告警—地图联动（切页必须 destroy）

  /* ===== COM-03 阈值参数：先抽成常量，弹窗文案、C06 判定、参数总览都读这一份 =====
     否则登记进总览的就是第三份副本 —— 总览显示 5 分钟、代码里写 10 分钟，比不登记更糟。
     全部为 Demo 缺省值，业务方未确认。 */
  const AP = {
    dedupWindowMin: 5,        // C06 合并窗口：同目标 + 同类型
    upgradeWindowMin: 10,     // C06 升级观察窗口
    upgradeCount: 3,          // 窗口内重复达到此次数 → 等级上调一级
    midEscalateMin: 5,        // 中风险未处置多久自动升级通知
    nightFrom: '22:00', nightTo: '06:00',
    retryBackoffS: [1, 2, 4], retryTimes: 3
  };

  function rows() {
    const f = M.alarms.filter(a =>
      (st.level === '全部' || a.level === st.level) &&
      (st.status === '全部' || statusOf(a) === st.status) &&
      (st.kind === '全部' || a.kind === st.kind) &&
      (st.region === '全部' || a.district === st.region));
    const g = SORTERS[st.sort];
    if (!g) return f;
    // filter 已经给出新数组，排它不影响 M.alarms
    return f.sort((x, y) => { const a = g(x), b = g(y); return (a < b ? -1 : a > b ? 1 : 0) * st.dir; });
  }

  function render() {
    const sid = sessionStorage.getItem('alarm.sel');
    const deep = sid && M.alarms.find(a => a.id === sid);
    st.sel = deep || st.sel || M.todayAlarms[0] || M.alarms[0];
    sessionStorage.removeItem('alarm.sel');
    /* 深链跳来（COM-05 统一检索 / 总览点告警）：清掉筛选并翻到该条所在页，
       否则右侧详情停在它上面、左侧列表里却找不到这一行 */
    if (deep) {
      st.level = st.status = st.kind = st.region = '全部';
      const all = rows();
      st.page = Math.max(1, Math.ceil((all.findIndex(a => a.id === deep.id) + 1) / st.size));
    }
    const T = M.todayAlarms;
    const c = s => T.filter(a => statusOf(a) === s).length;
    return `<div class="alarms-page" style="height:100%;min-height:0;display:flex;flex-direction:column">
    ${U.kpis([
      { label: '今日告警总数', value: U.num(T.length), color: 'blue', icon: 'alert', desc: `近30天 ${U.num(M.alarms.length)} 起` },
      { label: '待核实', value: U.num(c('待核实')), color: 'amber', icon: 'alert', desc: '待人工确认属实或误报' },
      { label: '反制中', value: U.num(c('反制中')), color: 'orange', icon: 'radar', desc: '待发起联动反制' },
      { label: '干扰中', value: U.num(c('干扰中')), color: 'red', icon: 'radar', desc: '反制信号干扰执行中' },
      { label: '待处置', value: U.num(c('待处置')), color: 'green', icon: 'check', desc: '请进入处置与处罚页面' },
      { label: '误报', value: U.num(c('误报')), color: 'purple', icon: 'check', desc: '人工核实后已排除' }
    ])}

    <!-- 指标卡占实际高度，主工作区用 flex 接收全部剩余空间，不再依赖视口像素常量。 -->
    <div class="row" style="margin-top:12px;flex:1;min-height:0">
      ${U.panel({
      title: '告警列表', style: 'flex:1;min-width:0', nopad: true,
      body: `<div class="toolbar">
          ${U.field('等级', U.select('level', ['全部', '高', '中', '低'], st.level))}
          ${U.field('类别', U.select('kind', ['全部', '飞行违规', '空间安全'], st.kind))}
          ${U.field('状态', U.select('status', ['全部', ...FLOW_STATUS], st.status))}
          ${U.field('区域', U.select('region', ['全部', ...M.DISTRICTS.map(d => d.name)], st.region))}
          <span style="flex:1"></span>
          <button class="btn" id="alChan">${U.icon('bell')} 通知渠道</button>
        </div>
        <div id="alList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}
      <div class="col" style="width:560px;flex:none">
        ${U.panel({
      /* 地图高度取 244px 与行高 46% 的较小值：视口偏矮时（1280×800）不至于把下面的详情面板压成一条缝 */
      title: '关联目标定位与轨迹', style: 'height:244px;max-height:50%;flex:none', nopad: true,
      bodyStyle: 'padding:6px',
      extra: `<span id="alMapSrc" style="font-size:11px;color:var(--txt-3);white-space:nowrap"></span>
        <button class="btn" id="alLoc" style="height:24px;font-size:11.5px;flex:none" title="重新定位到当前告警的关联目标">${U.icon('location')} 定位</button>`,
      body: `<div id="alMap" style="flex:1;min-height:0"></div>
          <div id="alMapInfo" style="flex:none;height:19px;line-height:19px;padding:2px 2px 0;font-size:10.5px;
            color:var(--txt-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>`
    })}
        ${U.panel({
      title: '告警详情与处置', style: 'flex:1;min-height:0', nopad: true, extra: `<span id="alSt"></span>`,
      body: `<div id="alDetail" style="flex:1;overflow:auto;padding:12px"></div>`
    })}
      </div>
    </div></div>`;
  }

  function list() {
    const all = rows(), page = all.slice((st.page - 1) * st.size, st.page * st.size);
    return U.table([
      {
        t: sortTh('ts', '告警编号 / 时间'), w: '108px', cls: 'num',
        render: a => U.cell(a.id.slice(-9), a.time.slice(11), { mono: true })
      },
      { t: sortTh('level', '等级'), w: '52px', align: 'center', render: a => U.tag(a.level, a.level === '高' ? 't-red' : a.level === '中' ? 't-amber' : 't-blue') },
      {
        t: sortTh('kind', '类别 / 类型'), w: '128px', render: a => U.cell(U.tag(a.kind, a.kind === '空间安全' ? 't-purple' : 't-orange'), a.type)
      },
      { t: sortTh('district', '关联目标 / 区域'), w: '146px', render: a => U.cell(a.targetId, a.district, { mono: true }) },
      {
        /* table.tb 的 td 是 white-space:nowrap，这一列的**内容宽度**才是表格最小宽度的真正下限
           —— 调声明的 w 没有用。放开换行 + 两行截断，最小宽度从 446px 降到内容可折行的宽度，
           这是 1440 宽下消除横滚最有效的一刀（完整内容在 title 里）。 */
        t: '告警内容', render: a => `<div title="${a.detail}" style="white-space:normal;line-height:1.5;
          max-height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${a.detail}</div>`
      },
      { t: sortTh('status', '状态'), w: '86px', render: a => U.tag(statusOf(a)) }
    ], page, { rowId: a => a.id, activeId: st.sel && st.sel.id })
      + U.pager({ total: all.length, page: st.page, size: st.size });
  }

  function disposalSteps(a) {
    const s = statusOf(a);
    const trigger = { n: '告警触发', t: a.time.slice(11), done: true, act: false };
    if (s === '待核实') return [trigger,
      { n: '人工核实', t: '', done: false, act: true },
      { n: '反制', t: '', done: false, act: false },
      { n: '信号干扰', t: '', done: false, act: false }];
    if (s === '误报') return [trigger,
      { n: '人工核实', t: '误报', done: true, act: false }];
    if (s === '反制中') return [trigger,
      { n: '人工核实', t: '属实', done: true, act: false },
      { n: '反制', t: '待授权', done: false, act: true },
      { n: '信号干扰', t: '', done: false, act: false }];
    if (s === '干扰中') return [trigger,
      { n: '人工核实', t: '属实', done: true, act: false },
      { n: '反制', t: '已授权', done: true, act: false },
      { n: '信号干扰', t: '干扰中', done: false, act: true }];
    return [trigger,
      { n: '人工核实', t: '属实', done: true, act: false },
      { n: '反制', t: '已授权', done: true, act: false },
      { n: '信号干扰', t: '干扰完成', done: true, act: false }];
  }

  function disposalActions(a) {
    const s = statusOf(a);
    if (s === '待核实') return `<button class="btn pri" data-al="verify">人工核实</button>`;
    if (s === '反制中') return `<button class="btn danger" data-al="counter">${U.icon('bolt')} 发起联动反制</button>`;
    return '';
  }

  function detail() {
    const a = st.sel;
    if (!a) return '<div class="empty">请选择告警</div>';
    document.getElementById('alSt').innerHTML = U.tag(statusOf(a));
    const t = M.allTargets.find(x => x.id === a.targetId) || {};
    return `${U.detailHero({
      icon: 'alert', subtitle: '告警事件', title: a.type, id: a.id,
      tags: [U.tag(a.level, a.level === '高' ? 't-red' : a.level === '中' ? 't-amber' : 't-blue'), U.tag(statusOf(a))],
      meta: [['区域', a.district], ['时间', a.time.slice(11)]]
    })}
      ${U.metricStrip([
        { label: '告警等级', value: a.level, tone: a.level === '高' ? 'bad' : a.level === '中' ? 'warn' : 'info', icon: 'alert' },
        { label: '处置状态', value: statusOf(a), tone: statusOf(a) === '待核实' ? 'warn' : 'info', icon: 'play' },
        { label: '目标类型', value: t.subtype || t.type || '—', icon: 'plane' },
        { label: '来源置信', value: U.confPct(a.source_confidence), tone: 'good', icon: 'radar' }
      ], { compact: true })}
      ${U.sect('处置流程', U.steps(disposalSteps(a)), { icon: 'trend' })}
      ${U.sect('告警信息', U.kv([
      ['告警类型', a.type], ['告警等级', U.tag(a.level, a.level === '高' ? 't-red' : 't-amber')],
      ['触发时间', a.time], ['所在区域', a.district],
      ['关联目标', `<span class="mono">${a.targetId}</span>`],
      ['目标类型', t.subtype || t.type || '—'],
      ['高度/速度', (t.alt || '—') + ' m / ' + (t.speed || '—') + ' m/s'],
      ['数据来源', a.source + `（置信度 ${U.confPct(a.source_confidence)}）`],
      ['告警内容', a.detail]
    ], { surface: true, density: 'compact' }), { icon: 'alert' })}
      ${(function () {
        /* C06 去重与升级：先按「同目标 + 同类型 + 5 分钟窗口」在数据集中找真实同族告警；
           当前 Demo 数据集每个目标只生成一条告警，找不到同族时退回 CH.seeded 派生的合并明细，
           并明确标注「Demo 派生」——不要让一个凭空数字冒充引擎输出。
           正式版由 C06 引擎写入 mergedAlarmIds，此处直接列真实被合并的告警编号。 */
        const peers = M.alarms.filter(x => x.id !== a.id && x.targetId === a.targetId
          && x.type === a.type && Math.abs(x.ts - a.ts) <= AP.dedupWindowMin * 60000).sort((p, q) => p.ts - q.ts);
        const rs = CH.seeded('dedup' + a.id);
        const derived = !peers.length;
        const cnt = derived ? rs(1, 4) : peers.length + 1;
        const items = derived
          ? Array.from({ length: cnt }, (_, i) => ({
            id: a.id + '-M' + M.util.p2(i + 1),
            time: M.util.fmtT(new Date(a.ts - (cnt - 1 - i) * rs(40, 170) * 1000)),
            src: i === cnt - 1 ? a.source : ['融合感知箱', 'TDOA', '5G-A'][rs(0, 2)]
          }))
          : peers.concat([a]).map(x => ({ id: x.id, time: x.time.slice(11), src: x.source }));
        const up = cnt >= AP.upgradeCount;
        const lower = { '高': '中', '中': '低', '低': '低' };
        return U.sect(`去重与升级（C06）${derived ? '<span class="tag t-amber" style="margin-left:4px" title="当前 Demo 数据集每个目标仅生成一条告警，合并明细按告警编号确定性派生；正式版取 C06 引擎的 mergedAlarmIds">Demo 派生</span>' : ''}`,
          U.kv([
            ['合并策略', `同目标 + 同类型 + ${AP.dedupWindowMin} 分钟窗口内合并`],
            ['合并条数', `<b>${cnt}</b> 条（含本条，保留为 <span class="mono">${a.id}</span>）`],
            ['被合并明细', `<div style="line-height:1.75">${items.map(x =>
              `<div><span class="mono" style="color:var(--txt-3)">${x.time}</span>
                 <span class="mono">${x.id}</span>
                 <span style="color:var(--txt-3)">· ${x.src}</span>
                 ${x.id === a.id ? '<span class="tag t-cyan">保留</span>' : '<span class="tag t-gray">已合并</span>'}</div>`).join('')}</div>`],
            ['升级规则', `同目标 ${AP.upgradeWindowMin} 分钟内重复 ≥${AP.upgradeCount} 次 → 等级上调一级`],
            ['是否升级', up
              ? `${U.tag('已升级', 't-red')} <span style="color:var(--txt-3)">${lower[a.level]} → ${a.level}</span>`
              : `${U.tag('未升级', 't-gray')} <span style="color:var(--txt-3)">重复 ${cnt} 次 &lt; ${AP.upgradeCount} 次阈值</span>`]
          ]));
      })()}
      ${(function () {
        /* B02 统一目标 ID 合并/分裂：告警一旦引用某 target_id，即使目标后续被合并也要能回溯 */
        const lng = (M.idLineage || []).filter(l =>
          (l.memberIds || []).includes(a.targetId) || l.originId === a.targetId || l.survivorId === a.targetId);
        if (!lng.length) return '';
        return U.sect('关联目标 ID 变更历史（B02）', lng.map(l => U.kv([
          ['变更类型', l.op === 'merge' ? U.tag('合并', 't-cyan') : U.tag('分裂', 't-purple')],
          ['发生时间', l.at],
          [l.op === 'merge' ? '合并后保留' : '拆分自', l.op === 'merge'
            ? `<span class="mono">${l.survivorId}</span>` : `<span class="mono">${l.originId}</span>`],
          ['涉及目标', `<span class="mono">${(l.memberIds || []).join(' , ')}</span>`],
          ['判据', l.basis], ['执行者', l.operator]
        ])).join('') + `<div style="font-size:11px;color:var(--txt-3);line-height:1.7">
          本条告警引用的 target_id 参与过上述变更；合并前的判定快照已随变更记录留存，证据链可回溯。</div>`,
          { collapsible: true, open: false, icon: 'trend' });
      })()}
      ${U.sect('通知记录（F0605）', (a.notifyLog && a.notifyLog.length)
        ? a.notifyLog.map(n => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;
            padding:4px 0;border-bottom:1px solid rgba(64,158,255,.08)">
            <span class="mono" style="color:var(--txt-3)">${n.time}</span>
            <span style="flex:1">${n.channel} → ${n.target}</span>
            <span style="color:${n.ok ? '#79e5a5' : '#ffd07a'}">${n.result}</span></div>`).join('')
        : '<div style="color:var(--txt-3);font-size:12px">暂无通知记录</div>',
        { collapsible: true, open: false, icon: 'bell' })}
      ${U.detailActions(`
        <button class="btn" data-al="video">${U.icon('video')} 实时视频</button>
        <button class="btn" data-al="replay">${U.icon('trend')} 轨迹回放</button>
        ${disposalActions(a)}`)}`;
  }

  function paint() {
    document.getElementById('alList').innerHTML = list();
    document.getElementById('alDetail').innerHTML = detail();
  }

  /* ================= B5:选中告警 → 地图定位关联目标并展示轨迹 =================
     轨迹来源分两种，界面必须如实标注：
       实时目标 —— 直接取 liveTargets 的 track（含弥合 A03 / 预测 A04 分段）；
       历史目标 —— Demo 数据集不保存历史轨迹点，按 CH.seeded(目标编号) 确定性还原，
                   同一条告警任意次查看轨迹完全一致（禁止在 render 里裸用 Math.random）。 */
  function trackFor(t, a) {
    const lv = M.liveTargets.find(x => x.id === t.id);
    if (lv && lv.track && lv.track.length > 1)
      return { pts: lv.track, src: '实时跟踪轨迹（/api/v1/target/track 实时流）', live: true };
    /* 归档轨迹的点型来自归档记录本身，不是画出来的装饰：
       bridge —— 该段雷达短时丢点，由 A03 弥合补齐，位置不是实测值；
       pred   —— 告警仍未关闭说明目标还在跟踪，末段是 A04 恒速外推的预测位置；
                 告警已关闭/误报的目标飞行已结束，不存在预测段。
       §6.8 硬约束：弥合段与预测段不得等同于实测位置，MapView 按 kind 分线型渲染。 */
    const rs = CH.seeded('altrk' + t.id);
    const n = 22, hd = (t.heading || 0) * Math.PI / 180;
    const lon0 = t.lon - Math.sin(hd) * 0.055, lat0 = t.lat - Math.cos(hd) * 0.046;
    const dl = (t.lon - lon0) / (n - 1), da = (t.lat - lat0) / (n - 1);
    const hasBridge = rs(0, 9) < 6;                       // 约六成归档轨迹存在丢点弥合段
    const b0 = Math.floor(n * 0.4), b1 = b0 + 2;
    const open = !a || ['待核实', '反制中', '干扰中'].includes(statusOf(a));
    const p0 = open ? n - 3 : n;                          // 未关闭的告警才有预测段
    const pts = [];
    for (let i = 0; i < n; i++) {
      const kind = i >= p0 ? 'pred' : (hasBridge && i >= b0 && i <= b1 ? 'bridge' : 'meas');
      pts.push({
        lon: +(lon0 + dl * i + rs(-55, 55) / 1e4).toFixed(6),
        lat: +(lat0 + da * i + rs(-45, 45) / 1e4).toFixed(6),
        alt: t.alt, t: t.ts - (n - 1 - i) * 12000, kind
      });
    }
    return { pts, src: '历史归档轨迹（Demo 按归档点位还原，正式版取 /api/v1/target/track）', live: false };
  }
  const kindStat = pts => pts.reduce((m, p) => { const k = p.kind || 'meas'; m[k] = (m[k] || 0) + 1; return m; }, {});

  function centerOn(lon, lat) {
    if (!map || !map.w) return;
    const q = map.px(lon, lat);
    map.ox += map.w / 2 - q[0];
    map.oy += map.h / 2 - q[1];
  }

  function focusMap() {
    if (!map) return;
    const a = st.sel, info = document.getElementById('alMapInfo'), srcEl = document.getElementById('alMapSrc');
    if (!a) return;
    const t = M.allTargets.find(x => x.id === a.targetId);
    if (!t) {   // 历史告警的关联目标可能已不在目标库(合并/清理),不能让地图静默空白
      map.sel = null;
      map.setData({ airspaces: M.airspaces, devices: [], targets: [], alarms: [] });
      if (srcEl) srcEl.textContent = '';
      if (info) info.innerHTML = `<span class="inline-icon" style="color:#ffd07a" title="历史告警的关联目标可能已被 B02 合并">${U.icon('warning')} 关联目标 ${a.targetId} 不在目标库中，无法定位</span>`;
      return;
    }
    const tk = trackFor(t, a);
    map.sel = t.id;
    map.setData({
      airspaces: M.airspaces, devices: [],
      targets: [Object.assign({}, t, { track: tk.pts, tracked: true })],
      alarms: [a]
    });
    const last = tk.pts[tk.pts.length - 1];
    centerOn(last.lon, last.lat);
    // 轨迹来源必须如实标注，不能让"历史轨迹是还原出来的"这件事隐身；
    // 同时给出 meas/bridge/pred 分段构成 —— 弥合段与预测段不是实测位置（§6.8）
    const ks = kindStat(tk.pts);
    if (srcEl) srcEl.innerHTML =
      `${tk.live ? `<span class="tag t-green" title="${tk.src}">实时轨迹</span>`
        : `<span class="tag t-amber" title="${tk.src}">归档轨迹</span>`}
       <span title="实测 / 弥合(A03) / 预测(A04) 三种点型按 §6.8 分线型绘制：实测=动画虚线，弥合=橙色宽隙虚线，预测=青色点线">
         <span style="color:#8fbaff">实${ks.meas || 0}</span><span
           style="color:#ff8b3d">/弥${ks.bridge || 0}</span><span
           style="color:#22d3ee">/预${ks.pred || 0}</span></span>`;
    if (info) {
      const lc = t.legal === '非法' ? '#ff8b95' : t.legal === '异常' ? '#ffb083' : t.legal === '待确认' ? '#ffd07a' : t.legal === '不适用' ? '#8ca0be' : '#79e5a5';
      /* 这一行必须在 1440 宽的面板里放得下：原来把完整的轨迹来源说明也塞进来，
         1440 下被 ellipsis 截掉 109px —— 截掉的正好是"这条轨迹是还原出来的"那半句，
         最该被看见的部分反而最先消失。来源改用短标签，完整说明留在面板头的 tag title 与本行 title 里。
         点数也去掉：面板头的「实N/弥N/预N」已经给了，且信息量更大。 */
      info.innerHTML =
        `<span class="mono" style="color:var(--txt-2)">${t.id}</span> · ${t.subtype || t.type} ·
         合法性 <span style="color:${lc}">${t.legal}</span> · 高度 ${t.alt} m ·
         ${tk.live ? '实时轨迹' : '历史归档轨迹'}`;
      info.title = `${t.id}｜${t.subtype || t.type}｜合法性 ${t.legal}｜高度 ${t.alt} m\n轨迹来源：${tk.src}\n`
        + `点型：实测 ${ks.meas || 0}（动画虚线）/ 弥合 A03 ${ks.bridge || 0}（橙色宽隙虚线）/ 预测 A04 ${ks.pred || 0}（青色点线）`;
    }
  }

  function mount(view) {
    view.style.overflow = 'hidden';
    paint();
    // B5:地图。maxDev:0 + device:false —— 本页只关心目标与告警点位，不铺设备
    map = new MapView(document.getElementById('alMap'), {
      zoom: 2.2, maxDev: 0, maxAlarm: 1, legend: false, layers: { device: false }
    });
    // 同步定位一次：页面若在后台标签页挂载，rAF 根本不会触发，不能只靠 rAF
    // 再补一帧：兜底容器布局尚未完成（map.w=0）导致居中失效。centerOn 是增量对齐，重复调用不会叠加偏移
    focusMap();
    requestAnimationFrame(focusMap);

    U.on(view, '[data-row]', 'click', (e, el) => {
      st.sel = M.alarms.find(a => a.id === el.dataset.row);
      U.selectRow(document.getElementById('alList'), el.dataset.row);
      document.getElementById('alDetail').innerHTML = detail();
      focusMap();                                   // 只刷详情 + 地图，不重建列表 DOM
    });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { st.page = +el.dataset.pg; paint(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { st.size = parseInt(el.value); st.page = 1; paint(); });
    U.on(view, '[data-f]', 'change', (e, el) => { st[el.dataset.f] = el.value; st.page = 1; paint(); });
    /* 表头排序。列表 DOM 必然重建（这与第六轮"行点击不重建列表"不冲突：那条针对的是选中态），
       但重建后要回到列表顶部 —— 换了排序还停在原滚动位置没有意义；
       选中行的高亮由 list() 的 activeId 带过去，若它已不在当前页则自然不显示。 */
    const doSort = key => {
      if (st.sort === key) st.dir = -st.dir;
      else { st.sort = key; st.dir = key === 'ts' ? -1 : 1; }   // 时间默认最新在前，其余默认升序
      st.page = 1;
      paint();
      const sc = document.querySelector('#alList .scroll');
      if (sc) sc.scrollTop = 0;
    };
    U.on(view, '[data-sort]', 'click', (e, el) => doSort(el.dataset.sort));
    U.on(view, '[data-sort]', 'keydown', (e, el) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSort(el.dataset.sort); }
    });
    U.on(view, '[data-al]', 'click', (e, el) => {
      const k = el.dataset.al;
      if (k === 'counter') {
        const a = st.sel;
        const t = a && M.allTargets.find(x => x.id === a.targetId);
        if (!a || statusOf(a) !== '反制中') return U.toast('当前告警不在反制节点', 'err');
        if (!t) return U.toast('未找到该告警的关联目标', 'err');
        if (!g.TARGET_ACTIONS) return U.toast('反制授权组件尚未加载', 'err');
        g.TARGET_ACTIONS.openCounterAuth(t, () => startInterference(a));
      }
      else if (k === 'video' || k === 'replay') {
        const a = st.sel;
        const t = a && M.allTargets.find(x => x.id === a.targetId);
        if (!t) return U.toast('未找到该告警的关联目标', 'err');
        if (!g.TARGET_MEDIA) return U.toast('媒体查看组件尚未加载', 'err');
        const tk = trackFor(t, a);
        const target = Object.assign({}, t, { track: tk.pts });
        if (k === 'video') g.TARGET_MEDIA.openVideo(target);
        else g.TARGET_MEDIA.openReplay(target, a);
      }
      else if (k === 'notify') sendModal();
      else if (k === 'verify') verifyModal();
    });
    document.getElementById('alChan').onclick = chanModal;
    document.getElementById('alLoc').onclick = () => { if (map) { map.zoom = 2.2; map.ox = map.oy = 0; } focusMap(); };
  }
  function startInterference(a) {
    const from = statusOf(a);
    a.flowStatus = '干扰中';
    a.status = '处置中';                  // 兼容共享数据层的旧枚举
    a.interferenceStartedAt = M.util.fmtDT(M.CONF.demoTime);
    M.pushAudit('异常告警中心', `联动反制授权通过（${from} → 干扰中）`, a.targetId);
    remount();
    U.toast('已发起反制信号干扰，请进入处置与处罚页面来处置。', 'ok');
    setTimeout(() => {
      a.flowStatus = '待处置';
      a.interferenceFinishedAt = M.util.fmtDT(new Date(M.CONF.demoTime.getTime() + 3000));
      M.pushAudit('异常告警中心', '信号干扰完成（干扰中 → 待处置）', a.targetId);
      if (location.hash === '#/alarms') remount();
    }, 3000);
  }

  /* 人工核实：属实进入反制节点，误报则在人工核实节点终止流程。 */
  function verifyModal() {
    const a = st.sel;
    if (!a) return;
    if (statusOf(a) !== '待核实') return U.toast('当前告警无需重复核实', 'err');
    const t = M.allTargets.find(x => x.id === a.targetId) || {};
    U.modal({
      title: '人工核实 · ' + a.id, width: '600px',
      body: `<div class="warnbox">核实是状态机的必经环节（待核实 → 反制中 / 误报）。
          结论为「误报」时告警进入终态，样本计入误报率统计与 C06 规则优化；
          结论为「属实」时进入反制节点，可发起联动反制。</div>
        ${U.kv([
        ['告警类型', a.type], ['告警等级', U.tag(a.level, a.level === '高' ? 't-red' : a.level === '中' ? 't-amber' : 't-blue')],
        ['关联目标', `<span class="mono">${a.targetId}</span>　${t.subtype || t.type || '—'}`],
        ['合法性判定', t.legal_status || t.legal || '—'],
        ['触发时间 / 区域', a.time + '　' + a.district],
        ['告警内容', a.detail]
      ])}
        ${U.sect('核实结论', `
          <label class="chk"><input type="radio" name="vfr" data-vf="true" checked>
            <span><b>属实</b> —— 告警成立，状态推进至「反制中」</span></label>
          <label class="chk"><input type="radio" name="vfr" data-vf="false">
            <span><b>误报</b> —— 告警不成立，状态置为「误报」（终态），并计入误报率统计</span></label>
          ${U.field('核实说明', `<input class="ip" data-vfnote style="flex:1" placeholder="必填：核实依据（如现场确认、轨迹复核、飞手联系结果）">`)}`)}`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">提交核实结论</button>`,
      on: {
        ok: el => {
          const note = (el.querySelector('[data-vfnote]').value || '').trim();
          if (!note) { U.toast('核实说明为必填 —— 状态变更必须能回答"依据是什么"', 'err'); return; }
          const real = el.querySelector('[data-vf="true"]').checked;
          const u = M.currentUser || { name: '值班员', roleName: '值班员' };
          const from = statusOf(a);
          a.flowStatus = real ? '反制中' : '误报';
          a.status = real ? '处置中' : '误报';       // 兼容共享数据层的旧枚举
          a.verified = true;
          a.verifyLog = a.verifyLog || [];
          a.verifyLog.push({ at: M.util.fmtDT(M.CONF.demoTime), by: u.name, result: real ? '属实' : '误报', note, from, to: a.flowStatus });
          M.auditLogs.unshift({
            id: 'AUAL' + a.id.slice(-6) + M.util.p2(a.verifyLog.length),
            time: M.util.fmtDT(M.CONF.demoTime), user: u.name, role: u.roleName,
            module: '异常告警中心', action: `人工核实：${real ? '属实' : '误报'}（${from} → ${a.flowStatus}）：${note}`,
            target: a.targetId, result: '成功', ip: '10.20.6.31', term: '终端-01'
          });
          U.closeModal();
          remount();     // 状态变了，KPI 与列表都要联动
          U.toast(`核实完成：${from} → ${a.flowStatus}${real ? '' : '（流程在人工核实节点终止）'}`, real ? 'ok' : '');
        }
      }
    });
  }

  /* ---- F0605:通知渠道配置(外发通道为预留接口,Demo 不真实外发) ---- */
  function chanModal() {
    U.modal({
      title: '告警通知渠道配置（F0605）', width: '820px',
      body: `<div class="warnbox">外发通道为<b>预留接口</b>，Demo 环境不真实外发。正式环境需配置各渠道凭据
          （钉钉 webhook 与加签密钥、企业微信应用凭据、短信网关账号等），由接口负责人确认后联调。</div>
        <table class="tb"><thead><tr>
          <th style="width:44px;text-align:center">启用</th><th style="width:132px">渠道</th>
          <th style="width:60px">类型</th><th style="width:130px">通知对象</th>
          <th style="width:200px">接口</th><th style="width:118px;text-align:center">就绪状态</th>
          <th>触发说明</th></tr></thead><tbody>
          ${M.notifyChannels.map(c => `<tr>
            <td style="text-align:center"><label class="chk" style="margin:0;justify-content:center">
              <input type="checkbox" data-ncon="${c.id}" ${c.on ? 'checked' : ''}></label></td>
            <td>${c.name}</td>
            <td>${U.tag(c.type, c.type === '内部' ? 't-blue' : 't-purple')}</td>
            <td style="color:var(--txt-2)">${c.target}</td>
            <td><span class="mono" style="font-size:11px">${c.api}</span></td>
            <td style="text-align:center">${c.ready ? U.tag('已联调', 't-green') : U.tag('预留接口', 't-amber')}</td>
            <td style="color:var(--txt-3);font-size:11.5px">${c.desc}</td></tr>`).join('')}
        </tbody></table>
        ${U.sect('触发规则（Demo 缺省值，待业务方确认 · 见「用户与权限 › 参数总览」）', U.kv([
        ['高风险告警', '立即通知（不受夜间限制）'],
        ['中风险告警', `${AP.midEscalateMin} 分钟未处置自动升级通知`],
        ['重复告警合并', `同目标 ${AP.upgradeWindowMin} 分钟内重复告警合并为一条通知（与 C06 去重升级一致）`],
        ['夜间策略', `${AP.nightFrom}–${AP.nightTo} 仅高风险外发，其余次日汇总`],
        ['失败重试', `外发失败按 ${AP.retryBackoffS.map(x => x + 's').join('/')} 退避重试 ${AP.retryTimes} 次，仍失败转站内告警并记录`]
      ]))}`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="save">保存配置</button>`,
      on: {
        save: el => {
          M.notifyChannels.forEach(c => {
            const box = el.querySelector(`[data-ncon="${c.id}"]`);
            if (box) c.on = box.checked;
          });
          U.closeModal();
          U.toast(`通知渠道已保存：启用 ${M.notifyChannels.filter(c => c.on).length} / ${M.notifyChannels.length} 个`, 'ok');
        }
      }
    });
  }

  /* ---- F0605:按渠道发送通知(ready:false 明确标注未真实外发) ---- */
  function sendModal() {
    const a = st.sel;
    const on = M.notifyChannels.filter(c => c.on);
    U.modal({
      title: '发送告警通知 · ' + a.id, width: '620px',
      body: `${U.kv([['告警', `${a.type}（${U.tag(a.level, a.level === '高' ? 't-red' : 't-amber')}）`],
      ['关联目标', `<span class="mono">${a.targetId}</span>`], ['区域', a.district], ['时间', a.time]])}
        <div style="margin:12px 0 6px;font-size:12.5px;color:var(--txt-2)">选择通知渠道（仅列出已启用）</div>
        ${on.length ? on.map(c => `<label class="chk"><input type="checkbox" data-nc="${c.id}" checked>
            ${c.name} <span style="color:var(--txt-3)">→ ${c.target}</span>
            ${c.ready ? U.tag('已联调', 't-green') : U.tag('预留接口', 't-amber')}</label>`).join('')
          : '<div class="empty">无已启用渠道，请先在「通知渠道」中启用</div>'}
        <div id="ncResult" style="margin-top:10px"></div>`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn pri" data-act="send" ${on.length ? '' : 'disabled'}>发送通知</button>`,
      on: {
        send: el => {
          const picked = [...el.querySelectorAll('[data-nc]')].filter(x => x.checked)
            .map(x => M.notifyChannels.find(c => c.id === x.dataset.nc));
          if (!picked.length) return U.toast('请至少选择一个渠道', 'err');
          a.notifyLog = a.notifyLog || [];
          const now = M.util.fmtDT(M.CONF.demoTime);
          const lines = picked.map(c => {
            const ok = c.ready;
            const result = ok ? `已送达（回执 ${'RC' + CH.seeded(c.id + a.id)(100000, 999999)}）` : '接口预留，Demo 未真实外发';
            a.notifyLog.push({ time: now, channel: c.name, target: c.target, ok, result });
            return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:4px 0;
              border-bottom:1px solid rgba(64,158,255,.08)">
              <span>${c.name} → ${c.target}</span>
              <span style="color:${ok ? '#79e5a5' : '#ffd07a'}">${result}</span></div>`;
          }).join('');
          el.querySelector('#ncResult').innerHTML =
            `<div style="font-size:12.5px;color:#9ec6ff;margin-bottom:4px">发送结果</div>${lines}`;
          document.getElementById('alDetail').innerHTML = detail();     // 通知记录即时可见
          const okN = picked.filter(c => c.ready).length;
          U.toast(`通知已发送：${okN} 个渠道送达，${picked.length - okN} 个为预留接口未外发`, okN ? 'ok' : 'err');
        }
      }
    });
  }

  /* 整页重绘走 APP.rerender：它会 destroy() 本页（销毁地图 rAF 循环）、CH.disposeAll()，
     并换掉 #view 节点 —— 事件委托的监听器随旧节点销毁，不会重复绑定。 */
  function remount() { g.APP.rerender(); }
  function destroy() {
    if (map) map.destroy();
    map = null;
    const view = document.getElementById('view');
    if (view) view.style.overflow = '';
  }

  /* ===== COM-03 参数登记（模块加载时执行，不放 mount —— 放 mount 里的话没访问过本页就不出现在总览上）=====
     items 是函数不是数组：每次读取时求值，页面上改了渠道开关，总览立刻跟着变。 */
  U.regParams({
    key: 'F0605', name: '告警通知渠道与触发规则', page: '异常告警中心', hash: '#/alarms',
    ver: 'demo-v1', confirmed: false, owner: '业务方',
    basis: '需求文档 F0605 告警通知；渠道就绪状态见本页「通知渠道」',
    affects: ['告警外发', '通知升级', '夜间静默'],
    items: () => [
      { n: '已启用渠道 / 总数', v: `${M.notifyChannels.filter(c => c.on).length} / ${M.notifyChannels.length}` },
      { n: '其中已联调（可真实外发）', v: M.notifyChannels.filter(c => c.on && c.ready).length },
      { n: '高风险告警', v: '立即通知' },
      { n: '中风险未处置升级', v: AP.midEscalateMin + ' 分钟' },
      { n: '夜间静默窗口', v: AP.nightFrom + '–' + AP.nightTo },
      { n: '外发失败重试', v: AP.retryBackoffS.map(x => x + 's').join('/') + ' × ' + AP.retryTimes + ' 次' }
    ]
  });
  U.regParams({
    key: 'C06', name: '告警去重与升级阈值', page: '异常告警中心', hash: '#/alarms',
    ver: 'C06-demo-v1', confirmed: false, owner: '业务方',
    basis: '业务规则 C06 重复告警合并与等级升级；判定过程见告警详情「去重与升级」',
    affects: ['告警条数', '告警等级', '通知次数'],
    items: () => [
      { n: '合并窗口（同目标+同类型）', v: AP.dedupWindowMin + ' 分钟' },
      { n: '升级观察窗口', v: AP.upgradeWindowMin + ' 分钟' },
      { n: '升级触发次数', v: '≥ ' + AP.upgradeCount + ' 次' }
    ]
  });

  g.PAGES = g.PAGES || {}; g.PAGES.alarms = { render, mount, destroy };
})(window);
