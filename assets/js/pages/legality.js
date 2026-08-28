/* ===== 12. 飞行合法性判定中心 ===== */
(function (g) {
  const M = MOCK, U = UI;
  let st = { page: 1, size: 10, legal: '全部', region: '全部', sel: null };

  /* 当前操作者 —— 与 app.js 个人信息、users.js 审计口径一致 */
  const OPER = { name: '系统管理员', account: 'admin', role: '超级管理员' };
  /* 平台当前时刻取数据层唯一来源。本页原先自己算了一遍同样的公式 ——
     公式一样不等于没问题：它是第二个时间源，基准一变就会分叉。 */
  const nowStr = () => M.nowStr();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* =========================================================================
   * C03 风险评分模型 —— 设计 §10.4「多因子加权」：
   *   违规项严重度 / 目标类别 / 区域敏感度 / 轨迹稳定性 / 来源可信度
   * 权重与阈值全部外置为配置项：正式参数到位时只改这里，不改代码（§10.1 选规则引擎而非硬编码的理由）。
   * 现值均为 Demo 缺省：C03-demo-v1　【待确认：由业务方调参，纪要 §10 / §10.4】
   * ====================================================================== */
  const C03 = {
    ver: 'C03-demo-v1',
    w: { violation: 0.34, category: 0.10, region: 0.16, track: 0.16, source: 0.24 },
    wName: { violation: '违规项严重度', category: '目标类别', region: '区域敏感度', track: '轨迹稳定性', source: '来源可信度' },
    /* 违规项严重度：键必须与 MOCK.VIOLATIONS 枚举一致（V1.1 已把超高/超时各拆为空域侧与计划侧） */
    severity: {
      '侵入禁飞区': 1.00, '超出空域限高': 0.90, '超出空域管制时段': 0.80,
      '未经批准飞行': 0.65, '身份不匹配': 0.60, '偏离报备航线': 0.55,
      '超出计划批准高度': 0.50, '超视距飞行': 0.45, '超出计划批准时段': 0.40, '夜间飞行': 0.35
    },
    zone: { '禁飞空域': 1.00, '重点防控区域': 0.75, '临时管制区': 0.60, '限高区域': 0.55, '适飞空域': 0.20 },
    track: { '稳定': 0.00, '暂定': 0.40, '终止': 0.55, '短时丢失': 0.70 },
    category: { '无人机': 0.60, '未知': 0.85, '识别中': 0.85 },
    idMissing: 0.35,        // §10.4「身份线索缺失」→ 计入来源可信度因子，而不是另外数 warn 个数
    // 【Demo 假设，非文档给定，待业务方确认】C01 无法核验时其违规主张未被证实，严重度按半权计入
    unproven: 0.50,
    confMin: 0.75,          // 表10-4 要件③「较高置信度」门限
    grade: [[67, '高'], [34, '中'], [0, '低']]
  };
  const c03Grade = v => (C03.grade.find(g => v >= g[0]) || C03.grade[C03.grade.length - 1])[1];

  /* 注册到参数总览（COM-03）。传的是对象引用，页面上改了总览立刻能看到。 */
  U.regParams({
    key: 'C03', name: 'C03 风险评分模型', page: '合法性判定', hash: '#/legality',
    ver: C03.ver, confirmed: false, owner: '业务方 / 算法方',
    basis: '设计 §10.4 多因子加权', affects: ['风险等级', '处置优先级', '统计分析风险分布'],
    items: () => [
      ...Object.keys(C03.w).map(k => ({ n: '权重 · ' + C03.wName[k], v: C03.w[k] })),
      { n: '置信度门限 confMin（表10-4 要件③）', v: C03.confMin },
      { n: '身份线索缺失加权 idMissing', v: C03.idMissing },
      { n: '违规未证实折算 unproven', v: C03.unproven },
      { n: '风险分档阈值', v: C03.grade.map(g => g[0]).join(' / ') }
    ]
  });
  U.regParams({
    key: 'C02P', name: 'C02 判定项阈值', page: '合法性判定', hash: '#/legality',
    ver: 'C02-demo-v1', confirmed: false, owner: '业务方',
    basis: '设计 §10.3 表10-3', affects: ['夜间飞行判定', '超视距判定', '违规事由清单'],
    items: () => [
      { n: '夜间管制起始时刻', v: C02P.nightFrom + ':00' },
      { n: '夜间管制结束时刻', v: '0' + C02P.nightTo + ':00' },
      { n: '目视视距阈值 vlosM', v: C02P.vlosM + ' m' }
    ]
  });

  /* 表10-4（V1.1 修订）：「非法」的分界由「有没有授权覆盖」+「偏离的性质」共同决定。
     判非法 —— 两条定性依据满足其一即可：
       ① 本次飞行无合法授权（典型黑飞），本身即构成非法，不需要附带越界；
       ② 虽有授权，但进入了任何计划都无权批准的空间/时段（禁飞区、生效中的临时管制区）。
     判异常 —— 有授权，且偏离发生在可容差维度（航线走廊 / 限高 / 时间窗）且未进入禁止空间：
       这些是计划批准的「参数」，超出它们属「偏离批准范围」，不是「无授权」。
     C02 严重违规是<加重情形与常见伴随事实>，决定风险等级与可用处置手段，**不是必要条件**，
     不决定结论落在哪一态。 */
  /* 判定结果取值：mock.js 暂未导出 LEGAL_STATUS 枚举，先在本页收敛成一处
     （原来筛选下拉、改判弹窗、分布环图各持一份副本 —— 与 airspace.js 空域类型下拉是同一类潜伏失配：
     数据层新增取值时页面不会跟随、也不报错）。数据层补上导出后这里自动切过去。 */
  const LEGAL_STATUS = M.LEGAL_STATUS || ['合法', '异常', '非法', '待确认'];
  const DISPLAY_STATUSES = ['合法', '非法', '待确认'];
  const LEGAL_COLOR = { '合法': '#2fd06e', '异常': '#ff8b3d', '非法': '#ff4d5e', '待确认': '#ffb020' };

  // 「任何飞行计划都无权批准进入」是安全规则，只能有一份定义 —— 取自数据层的空域类型声明
  const FORBIDDEN_SPACE = M.AIRSPACE_TYPES.filter(a => a.forbidsAllPlans).map(a => a.type);
  /* 表10-4 分界，按 MOCK.VIOLATIONS 枚举划分（超高/超时已由数据层拆成空域侧与计划侧，
     页面不再自己推断落哪一侧 —— 结构化字段比页面反推可靠）：
       空域侧（任何计划都无权批准）→ 非法的定性依据②
       计划侧（偏离自身计划批准的参数）→ 指向异常 */
  const FORBIDDEN_VIOLATIONS = ['侵入禁飞区', '超出空域限高', '超出空域管制时段'];
  const PLAN_PARAM_VIOLATIONS = ['超出计划批准高度', '超出计划批准时段', '偏离报备航线'];
  const SEVERE_C02 = ['侵入禁飞区', '超出空域限高', '超出空域管制时段', '偏离报备航线']; // 加重情形，与 mock.js C02_SEVERE 对齐

  /* 枚举漂移自检 —— 本页的严重度表与分界常量都以违规原因字符串为键，
     数据层改枚举时（本轮 超高飞行→超出空域限高/超出计划批准高度）会静默失配：
     严重度取 0、分界判不出来，页面照常渲染、扫描与自检都抓不到。
     故在这里主动比对 MOCK.VIOLATIONS，漂移时 console.warn 并在规则配置弹窗里显式提示。 */
  function enumDrift() {
    const known = M.VIOLATIONS || [];
    const mine = [...new Set([].concat(Object.keys(C03.severity), FORBIDDEN_VIOLATIONS, PLAN_PARAM_VIOLATIONS, SEVERE_C02))];
    /* A5 收敛后 violation_reasons 已是数据层唯一真值，内部副本 violations 已删除，
       截断路径从结构上不复存在。此处改为守住「不得倒退」：一旦有人重新引入内部副本，立刻报出来。 */
    const dup = M.allTargets.filter(t => t.violations !== undefined);
    // 判定结果枚举：数据层一旦导出 LEGAL_STATUS，就以它为准比对本页副本
    const legalStale = M.LEGAL_STATUS
      ? LEGAL_STATUS.filter(v => M.LEGAL_STATUS.indexOf(v) < 0)
        .concat(M.LEGAL_STATUS.filter(v => LEGAL_STATUS.indexOf(v) < 0)) : [];
    return {
      stale: mine.filter(v => known.indexOf(v) < 0).concat(legalStale),   // 本页有、数据层已删
      missing: known.filter(v => C03.severity[v] == null),  // 数据层有、本页严重度表未覆盖
      truncated: dup.length,
      truncatedSample: dup[0] || null
    };
  }

  /* 违规项统一按数组读（一个目标可同时命中多条）。
     A5 后 violation_reasons 是唯一真值，不再保留「优先级链」——
     兼容链会让字段消失变成静默降级，而不是报错。 */
  const vlist = t => t.violation_reasons || [];
  const hasV = (t, v) => vlist(t).indexOf(v) >= 0;
  /* 数据层声明的「无判据可依」判定项。不可判定 ≠ 合规，页面必须如实呈现。 */
  const undet = t => t.undeterminable || [];
  const anyV = (t, arr) => vlist(t).some(v => arr.indexOf(v) >= 0);

  /* C02 判定项阈值（表10-3）。夜间飞行与超视距飞行为 V1.1 新补的判定项，
     阈值均【待确认：业务方】—— 超视距依赖 pilot_position（A6 遥控器位置），无遥控源即不可判定。 */
  const C02P = { nightFrom: 20, nightTo: 6, vlosM: 500 };

  /* 门禁作用范围。
     identity = 只降级「唯一支撑为 C01 身份不匹配且无 uav_sn」的目标（当前默认，命中 5 个）
     full     = 按表10-4 四要件全量校验（命中 48/51，非法降到 3）
     现默认 identity：数据层的「非法」目标是随机生成的，并未按表10-4 构造，
     直接开 full 会让全站非法 KPI 从 51 塌到 3，并撞破 mock.js 的「案件数 ≤ 非法目标数」断言。
     正确解法是数据层生成时即保证非法目标四要件齐备（见 selfCheck 建议），之后把这里改成 'full' 即可。 */
  const GATE_MODE = 'identity';
  /* 注：证据门禁已由 leader 下沉到 mock.js（目标构造后即执行，写 legalOriginal / reviewLog / legalSource）。
     本页的门禁因此通常命中 0 个，保留是为了兜住「数据层漏判」的情况，并作为口径回归的探针。 */

  const R = id => RULES.find(r => r.id === id) || { id: id, n: '(规则缺失)', d: '' };

  const RULES = [
    /* 「完全命中」当前**不可能出现**，所以规则卡上要写清楚，别让人以为它只是没碰上。
       原因不是"数据还没到"，是**目标对象上没有起飞点字段** ——
       平台看到的是航迹中的一个点，没有"这架是从哪儿起飞的"这个量，
       于是「起降点」维度全库恒为 null，而完全命中要求五维**全部**为真。
       （航线走廊维度已经活了：实测 96 真 / 7 假，它由 offRoute 回填。）
       补上起飞点字段之前，C01 的上限就是「部分命中」。 */
    { id: 'C01', n: '飞行计划匹配', d: '五维度比对（时间窗口/起降点/航线走廊/无人机身份/飞手单位），结果分完全命中·部分命中·未命中。'
        + '当前上限为「部分命中」：目标对象无起飞点字段，「起降点」维度恒不可判定' },
    { id: 'C02-1', n: '禁飞空域校验', d: '是否进入禁飞空域' },
    { id: 'C02-2', n: '限高校验', d: '是否超过空域限高' },
    { id: 'C02-3', n: '航线偏离校验', d: '是否偏离报备航线走廊' },
    { id: 'C02-4', n: '时间窗校验', d: '是否超出报备时段' },
    { id: 'C02-5', n: '夜间飞行校验', d: '是否处于夜间管制时段（阈值待业务方确认）' },
    { id: 'C02-6', n: '超视距校验', d: '目标与遥控源距离是否超出目视视距（依赖 pilot_position）' },
    { id: 'C03', n: '风险评分', d: '五因子加权评分，结论收敛至合法/非法/待确认' }
  ];

  /* =========================================================================
   * B9：身份数据源能力表
   * 依据《设备数据及感知数据接入协议 v8.6》：
   *   uavSN（无人机实名编号）只有 协议破解 dcd(11) 与 RemoteID rid(102) 能上报；
   *   TDOA/AOA 只能给机型（uavModel）与遥控器位置；
   *   雷达/光电给不出任何身份信息（光电只有外形分类，不是身份）。
   * 推论：无 dcd/rid 数据 → C01「身份不匹配」无数据支撑，只能退化为时间窗 + 空间范围匹配。
   * ====================================================================== */
  const ID_SOURCES = [
    { abbr: 'dcd', type: '协议破解', dt: 11, gives: 'uavSN 实名编号 / 机型 / 飞手位置', kind: 'sn' },
    { abbr: 'rid', type: 'RemoteID', dt: 102, gives: 'uavSN 实名编号 / 机型 / 起飞点', kind: 'sn' },
    { abbr: 'tdoa', type: 'TDOA', dt: 10, gives: '机型（uavModel）/ 遥控器位置', kind: 'model' },
    { abbr: 'aoa', type: 'AOA', dt: 9, gives: '机型（uavModel）/ 遥控器方位', kind: 'model' },
    { abbr: 'radar', type: '雷达', dt: 1, gives: '—（仅位置与航迹，无身份信息）', kind: 'none' },
    { abbr: 'oe', type: '光电', dt: 3, gives: '—（仅外形分类 A06，不构成身份）', kind: 'none' }
  ];
  const dep = (abbr, region) => {
    const d = M.devices.filter(x => x.deviceTypeAbbr === abbr && (!region || x.region === region));
    return { total: d.length, online: d.filter(x => x.status === '在线').length };
  };
  /* Target Schema V1 字段（A5 已落地）；uav_sn 缺失即身份判定降级 */
  const snOf = t => t.uav_sn || t.uavSN || null;
  const ppOf = t => t.pilot_position || t.pilotPosition || null;

  function idEvidence(t) {
    const sn = snOf(t);
    const pp = ppOf(t);
    const dev = pp && pp.device || null;                // 定位到遥控源的设备类别：协议破解 / TDOA / AOA
    const rows = ID_SOURCES.map(s => {
      const d = dep(s.abbr, t.district);
      let got, ok;
      if (s.kind === 'sn') {
        ok = !!sn && dev === s.type;
        got = ok ? ('已取得 uavSN ' + esc(sn))
          : (d.online
            ? (s.abbr === 'rid'
              ? '未取得（本区已部署，但当前数据源未提供 rid 上报，Q13 待确认）'
              : '未取得（该架次未被该类设备覆盖或未上报）')
            : '本区无在线设备，取不到');
      } else if (s.kind === 'model') {
        ok = dev === s.type;
        got = ok ? ('机型 ' + (t.uav_model || t.model) + ' + 遥控器' + (s.abbr === 'aoa' ? '方位' : '位置') + '（非实名）')
          : '本次未提供';
      } else { ok = false; got = '不提供身份信息'; }
      return { s, d, got, ok };
    });
    return {
      sn, rows, dev,
      full: !!sn,                                       // 完整判定：具备实名核验依据
      modelSrc: dev === 'TDOA' || dev === 'AOA' ? dev + ' 无线电特征比对' : '光电分类 A06 推断',
      hasPilot: !!pp,
      basis: sn ? 'uavSN 实名核验 + 时间窗 + 空间范围' : '时间窗 + 空间范围（降级）'
    };
  }

  /* 引擎原判定：人工改判不得覆盖原始判定结果（设计 8.6） */
  const engOf = t => {
    const s = t.legalOriginal || t.legal;
    return s === '异常' ? '待确认' : s;
  };
  /* 证据不足门禁：唯一支撑是 C01 身份不匹配，却没有 uavSN 数据源 → 不得定性为非法 */
  const needGate = t => t.type === '无人机' && t.legal === '非法'
    && hasV(t, '身份不匹配') && !snOf(t);
  const gatedList = () => M.allTargets.filter(needGate);
  /* 判定被改变过：人工改判 与 引擎证据门禁降级 是两回事，署名与说明都不能混 */
  const changed = r => r.from !== r.to;
  const manualRevised = t => !!(t.reviewLog && t.reviewLog.some(r => changed(r) && r.account !== 'rule-engine'));
  const engineDegraded = t => !!(t.reviewLog && t.reviewLog.some(r => changed(r) && r.account === 'rule-engine'));
  const revised = t => manualRevised(t) || engineDegraded(t);

  function judge(t) {
    /* 「是哪一块空域」必须取自**产生该事实的那次几何命中**（facts.zoneHits），
       不能按 district 再查一遍 —— 那是另一个查法，会查出另一块空域。
       实测后果：112 个「侵入禁飞区」目标里，按 district 查只有 47 个落在真有禁飞
       空域的区，另外 59 个查出来是限高区/临时管制区、6 个所在区根本没有登记空域，
       于是界面会写出「进入禁飞空域：**限高区**-广饶工业园区」这种句子 ——
       结论是真的（几何确实命中了某块禁飞空域），**被点名的对象是假的**。
       数据层其实一直记着正确答案（zoneHits[].id/name/type），是这一页没去读它。 */
    const hitOf = reason => {
      const h = ((t.facts && t.facts.zoneHits) || []).find(x => x.reason === reason);
      return h ? (M.airspaces.find(a => a.id === h.id) || null) : null;
    };
    const nfzZone = hitOf('进入');          // 触发「侵入禁飞区」的那一块
    const limZone = hitOf('超限高');        // 触发「超出空域限高」的那一块
    const tgZone = hitOf('管制时段');       // 触发「超出空域管制时段」的那一块
    /* 其余仍需要"本区大致属于什么空域"的地方（地图底图、区域说明）保留原查法，
       但**判罚句子一律用上面三个**。 */
    const zone = limZone || nfzZone || tgZone || M.airspaces.find(a => a.region === t.district);
    /* 空域类判罚必须能回答「这条限制是谁定的、怎么改」。
       161 条「超出空域限高」全部出自限高区规则，而甲方一定会问这句话；
       此前界面上没有任何地方答得出来。
       空域一律为上级下发且本地只读（纪要 §4.1 平台只"接收"），
       所以答案是固定的：调整走上级渠道，本平台改不了。 */
    const zoneBasis = z => z ? `<div style="margin-top:4px;font-size:11.5px;color:var(--txt-3)">`
      + `依据：<b style="color:var(--txt-2)">${esc(z.source)}</b>空域规则 <span class="mono">${esc(z.id)}</span>`
      /* 限高只在真有限高值时才印：禁飞空域的 limit 是 0，
         印成「限高 0 m」会让人以为那是一条高度限制，而它其实是"整块禁飞"。 */
      + `${z.limit > 0 ? ` · 限高 ${z.limit} m（${String(z.limitDatum || 'agl').toUpperCase()}）` : ''}`
      + ` · 发布单位 ${esc(z.unit || '—')} · 更新 ${esc(z.updated || '—')}`
      + `<br>本平台<b style="color:#ffd07a">不可修改</b>，调整须走上级渠道`
      + `</div>` : '';
    const ev = idEvidence(t);
    const eng = engOf(t);

    /* ---- C01：计划匹配（表10-2 五维度 / 三档）----
       直接读数据层的事实 planMatch + planMatchDims，不再从结论反推。
       原写法用 t.legal 和违规标签倒推 C01 的通过与否 —— 那是「结论先有、过程后配」，
       评审问「这一条为什么挂了」答不上来。 */
    let c01, c01msg, c01badge;
    const idClaim = hasV(t, '身份不匹配');
    const pm = (t.facts && t.facts.planMatch) || t.plan_match || null;
    const dims = (t.facts && t.facts.planMatchDims) || t.plan_match_dims || null;
    const dimLine = () => {
      if (!dims) return '';
      const mark = v => v === true ? '<span style="color:#2fd06e">✓</span>'
        : v === false ? '<span style="color:#ff8b95">✕</span>'
          : '<span style="color:#ffd07a" title="无判据可依">?</span>';
      return '<div style="margin-top:3px;font-size:11.5px">'
        + (M.C01_DIMS || Object.keys(dims)).map(d => `${mark(dims[d])} ${d}`).join('　') + '</div>';
    };
    if (pm === '未命中') {
      c01 = 'fail';
      c01msg = '五维度均未匹配到可关联计划 —— 时空范围内无有效报备'
        + (ev.full ? `，且 uavSN <span class="mono">${esc(ev.sn)}</span> 未在报备名单内` : '') + dimLine();
    } else if (pm === '部分命中') {
      c01 = 'warn';
      const bad = dims ? (M.C01_DIMS || Object.keys(dims)).filter(d => dims[d] === false) : [];
      const unk = dims ? (M.C01_DIMS || Object.keys(dims)).filter(d => dims[d] === null) : [];
      c01msg = `<b>部分命中</b>（表10-2）：已关联到计划（${t.partner}），但`
        + (bad.length ? `<span style="color:#ff8b95">${bad.join('、')} 偏离</span>` : '')
        + (bad.length && unk.length ? '；' : '')
        + (unk.length ? `<span style="color:#ffd07a">${unk.join('、')} 不可判定</span>` : '')
        + `<br><span style="color:var(--txt-3)">部分命中<b>不直接定性</b>，偏离维度交由 C02 / C03 分别判定</span>`
        + dimLine();
    } else if (pm === '完全命中') {
      /* 这个分支当前走不到（见上方 RULES 里 C01 的说明）：「起降点」维度全库恒为 null。
         **故意保留不删** —— 目标对象一旦补上起飞点字段，它就会重新可达，
         删掉的话恢复时得凭记忆重写一遍判定文案。
         恢复条件很具体：allTargets[].takeoff（或等价的起飞点）存在且可与
         flightPlans[].takeoff 比对，届时 planMatchDims['起降点'] 不再恒 null。 */
      c01 = 'pass';
      c01msg = `五维度均在容差内（${t.partner}）· 依据：${ev.basis}` + dimLine();
    } else {
      c01 = 'pass';
      c01msg = `匹配到报备计划（${t.partner}）· 依据：${ev.basis}`;
    }
    c01badge = ev.full
      ? '<span class="tag t-green" title="具备 uavSN 实名核验依据">完整判定</span>'
      : '<span class="tag t-amber" title="缺 uavSN 数据源，仅时间窗 + 空间范围匹配">降级判定</span>';

    const c02a = hasV(t, '侵入禁飞区') ? 'fail' : 'pass';
    // A8:限高判定必须按空域声明的基准取高度 —— agl 用距地高、amsl 用海拔高，二者不可混用
    const datum = zone ? (zone.limitDatum || 'agl') : 'agl';
    const hUsed = datum === 'agl' ? t.heightAgl : t.alt;
    const hMissing = hUsed == null;                    // 协议中 height 为选填，设备可能不给
    const overH = anyV(t, ['超出空域限高', '超出计划批准高度']);
    const c02b = overH ? 'fail'
      : hMissing ? 'warn'                              // 降级：缺距地高不可用海拔高冒充，判为待确认
        : (zone && hUsed > zone.limit && zone.limit > 0 ? 'warn' : 'pass');
    /* C02-3 航线偏离：需要「报备航线走廊几何」才能算轨迹到走廊的距离。
       管服平台的 routes 未接入前，系统里没有任何可比对的几何数据
       （flightPlans[].route 是「N 个航路点」这样的描述字符串，不是坐标），
       此时既不能判 pass（等于把没测到当作合规），也不能判 fail 并给出距离
       （等于往判定依据里填一个没测出来的数）→ 只能是不可判定。
       routes 接入后本项自动切换为真实计算（任务 2）。 */
    const offRouteUndet = undet(t).indexOf('偏离报备航线') >= 0;   // 数据层声明：无走廊几何 → 不可判定
    const offRouteLabel = hasV(t, '偏离报备航线');
    const c02c = offRouteUndet ? 'warn' : (offRouteLabel ? 'fail' : 'pass');
    const overT = anyV(t, ['超出空域管制时段', '超出计划批准时段']);
    const c02d = overT ? 'fail' : 'pass';

    /* C02-5 夜间飞行（V1.1 表10-3 新补判定项，阈值待业务方确认） */
    const hh = parseInt(t.time.slice(11, 13), 10);
    const isNight = hh >= C02P.nightFrom || hh < C02P.nightTo;
    const c02e = hasV(t, '夜间飞行') ? 'fail' : 'pass';
    const c02eMsg = hasV(t, '夜间飞行')
      ? `发现时间 ${t.time.slice(11, 19)}，判为夜间飞行`
      + (isNight ? `（夜间管制时段 ${C02P.nightFrom}:00–0${C02P.nightTo}:00，阈值待业务方确认）`
        : `<br><span style="color:#ff9aa4">⚠ 但该时间不在夜间管制时段内 —— 数据层结论与观测时间不一致，需核对</span>`)
      : `发现时间 ${t.time.slice(11, 19)}，`
      + (isNight ? `<span style="color:#ffd07a">处于夜间管制时段（${C02P.nightFrom}:00–0${C02P.nightTo}:00），但本次未标注夜间违规 —— 夜间是否一律受限【待确认：业务方】</span>`
        : `不在夜间管制时段（${C02P.nightFrom}:00–0${C02P.nightTo}:00，阈值待业务方确认）`);

    /* C02-6 超视距（依赖 A6 遥控器位置；无遥控源即不可判定，不能默认为合规） */
    const pp = ppOf(t);
    const vlosM = pp ? Math.round(M.util.distKm({ lon: t.lon, lat: t.lat }, { lon: pp.lon, lat: pp.lat }) * 1000) : null;
    const c02f = hasV(t, '超视距飞行') ? 'fail' : (pp ? 'pass' : 'warn');
    const c02fMsg = hasV(t, '超视距飞行')
      ? (pp ? `目标与遥控源相距 ${vlosM} m，超出目视视距 ${C02P.vlosM} m（阈值待业务方确认）`
        : `<span style="color:#ffd07a">判为超视距，但无遥控器定位（需 TDOA / AOA / dcd）—— 该结论缺少可核验的距离依据</span>`)
      : (pp ? `目标与遥控源相距 ${vlosM} m，${vlosM > C02P.vlosM
        ? `<span style="color:#ffd07a">超出目视视距 ${C02P.vlosM} m 但未标注违规（阈值待业务方确认）</span>`
        : `未超出目视视距 ${C02P.vlosM} m（阈值待业务方确认）`}`
        : `<span style="color:#ffd07a">无遥控器定位（需 TDOA / AOA / dcd 提供 pilot_position）→ 本项不可判定，不以「未发现」当作合规</span>`);

    const otherFail = [c02a, c02b, c02c, c02d, c02e, c02f].some(x => x === 'fail');
    const rules = [c01, c02a, c02b, c02c, c02d, c02e, c02f];
    const warns = rules.filter(x => x === 'warn').length;

    /* ---- C03 五因子加权风险评分（§10.4）----
       身份线索缺失通过「来源可信度」因子压低评分，而不是另外数 warn 个数：
       评分模型漏掉这个因子，才是「评分满分却判非法」的根因。 */
    const zoneType = zone ? zone.type : null;
    const sevRaw = vlist(t).reduce((m, v) => Math.max(m, C03.severity[v] || 0), 0);
    // C01 无法核验时，其违规主张未被证实，严重度只按一半计入
    /* 未被证实的违规主张：缺 uav_sn 的身份不匹配、无几何数据的航线偏离。
       两者都只是「标注」而非「测得」，按 C03.unproven 半权计入，且不进加重情形。 */
    const unverifiable = vlist(t).filter(v =>
      (v === '身份不匹配' && !ev.full) || undet(t).indexOf(v) >= 0);
    const proven = unverifiable.length === 0;
    const F = {
      violation: Math.min(1, Math.max(proven ? sevRaw : sevRaw * C03.unproven, warns ? 0.30 : 0)),
      category: C03.category[t.type] != null ? C03.category[t.type] : 0.50,
      region: C03.zone[zoneType] != null ? C03.zone[zoneType] : 0.40,
      track: C03.track[t.track_status] != null ? C03.track[t.track_status] : 0.40,
      /* 原来这里还有一项 `+ (classification_confidence == null ? C03.noClsConf : 0)`，已撤。
         两条理由：
         ① 该字段现已全量为 null（Target Schema V1 未定义 + T02 闭集读法确证雷达不提供），
            **一项对所有目标一律加同一个常数的因子，不再区分任何东西**；
         ② 更重要的是它原本扣的分没有依据：缺分类置信度反映的是**我们接口没定义这个字段**，
            不是这个目标本身可疑。拿平台的 Schema 缺口去给目标加风险，是把我们的问题算到它头上。
         按项目既有做法，这类情形应显式声明为不可判定（见下方来源质量行如实标注原因），
         而不是折算成一个看不出来的扣分。C03 权重体系本身仍为【待确认：业务方】。 */
      source: Math.min(1, (1 - (t.source_confidence != null ? t.source_confidence : 0.80))
        + (ev.full ? 0 : C03.idMissing))
    };
    const riskVal = Object.keys(C03.w).reduce((a, k) => a + C03.w[k] * F[k], 0);
    const score = Math.max(0, Math.min(100, Math.round(riskVal * 100)));   // 风险分：高 = 风险高
    const grade = c03Grade(score);

    /* ---- 表10-4：「非法」结论四要件 ---- */
    /* ---- 定性依据（两条路径满足其一）----
       两条路径的核验要求不同，这一点决定了 B9 的降级只落在该落的地方：
         ·「未经批准飞行」= 该时空内不存在任何报备计划 → 与「这架是谁」无关，无需 uav_sn 即可成立；
         ·「身份不匹配」= 存在候选计划、但判定该架不是计划中的那架 → 必须实名核验，否则
            分不清「确实不是」和「核验不了所以没匹配上」；
         · 禁飞区/临时管制区进入 = 感知直接观测的空间事实，同样无需身份。 */
    const zoneForbidden = zone && FORBIDDEN_SPACE.indexOf(zone.type) >= 0 && zone.status === '生效中';
    const noAuth = pm ? pm === '未命中' : hasV(t, '未经批准飞行');   // C01 未命中 = 无任何可关联计划
    const idMismatch = idClaim;                             // 有候选计划但身份对不上
    const forbiddenHits = vlist(t).filter(v => FORBIDDEN_VIOLATIONS.indexOf(v) >= 0);
    const planHits = vlist(t).filter(v => PLAN_PARAM_VIOLATIONS.indexOf(v) >= 0);
    const basisA = (noAuth || (idMismatch && ev.full));
    const basisB = forbiddenHits.length > 0 || (zoneForbidden && c02a === 'fail');

    const reqs = [
      {
        g: '定性依据', n: '本次飞行无合法授权（典型黑飞）', ok: basisA,
        why: noAuth
          ? '该时空范围内不存在任何报备计划 —— 无论这架是谁，都没有可依据的授权，故不依赖 uav_sn'
          : idMismatch
            ? (ev.full ? '已实名核验：uavSN 不在报备名单内，本次飞行无合法授权'
              : '存在候选计划但缺 uav_sn，分不清「确实不是计划中那架」与「核验不了所以没匹配上」——依据不可靠')
            : '本次飞行已命中报备计划'
      },
      {
        g: '定性依据', n: '进入任何计划都无权批准的空间 / 高度层 / 时段', ok: basisB,
        why: basisB
          ? `命中<b>${forbiddenHits.join('、') || '禁飞区进入'}</b>` +
          `${zone && zoneForbidden ? `（${zone.type}「${zone.name}」）` : ''} —— ` +
          '该空间 / 高度层 / 时段内任何飞行计划都无权批准；该事实由感知与空域规则直接比对得出，不依赖身份数据源'
          : planHits.length
            ? `${planHits.join('、')} 属<b>计划侧</b>偏离（超出的是自身计划批准的参数，非空域规则）→ 指向异常，不构成非法依据`
            : '未进入禁止空间 / 高度层 / 时段'
      },
      {
        g: '质量门槛', n: `较高置信度（source_confidence ≥ ${C03.confMin}）`,
        ok: (t.source_confidence != null ? t.source_confidence : 0) >= C03.confMin,
        why: `source_confidence = ${t.source_confidence != null ? t.source_confidence : '—'}`
      },
      {
        g: '质量门槛', n: '轨迹稳定（非弥合 / 丢失段）', ok: t.track_status === '稳定',
        why: `track_status = ${t.track_status || '—'}`
      }
    ];
    const basisOk = basisA || basisB;
    const qualityMiss = reqs.filter(r => r.g === '质量门槛' && !r.ok);
    const reqMiss = (basisOk ? [] : [{ g: '定性依据', n: '定性依据不成立（无合法授权 / 绝对禁止空间 二者皆否）' }])
      .concat(qualityMiss);
    // 加重情形：只影响风险等级与处置手段，不参与结论落点判定
    const sevHits = vlist(t).filter(v => SEVERE_C02.indexOf(v) >= 0 && unverifiable.indexOf(v) < 0);
    const aggravating = {
      hit: sevHits.length > 0,
      why: sevHits.length
        ? `${sevHits.join('、')} 属 C02 严重违规 → 提升风险等级与可用处置手段`
        : (unverifiable.length
          ? `无<b>已证实</b>的 C02 严重违规（${unverifiable.join('、')} 缺计算支撑，不计入加重）`
          : '无 C02 严重违规（不影响结论落点）')
    };

    /* 证据不足降级：§10.4「身份线索缺失 → 结论一律向待确认收敛，不得判为非法」
       identity 模式只取其中最确定的子集（非法唯一支撑就是缺依据的 C01）；full 模式按四要件全量校验。 */
    const gated = eng === '非法' && (GATE_MODE === 'full'
      ? reqMiss.length > 0
      : (idClaim && !ev.full && !basisB));
    const engVerdict = gated ? '待确认' : eng;

    return {
      ev, eng, gated, engVerdict, score, grade, F, riskVal, reqs, reqMiss, aggravating, basisOk,
      items: [
        { r: R('C01'), s: c01, msg: c01msg, badge: c01badge },
        { r: R('C02-1'), s: c02a, msg: c02a === 'pass' ? '未进入禁飞空域'
            : `进入禁飞空域：${nfzZone
                ? (String(nfzZone.name).indexOf(nfzZone.type) >= 0 ? '' : nfzZone.type) + '「' + esc(nfzZone.name) + '」'
                : '禁飞区'}` + zoneBasis(nfzZone) },
        {
          r: R('C02-2'), s: c02b, msg: (function () {
            const dn = datum === 'agl' ? '距地高' : '海拔高';
            if (hMissing) return `<span style="color:#ffd07a">设备未上报距地高（协议 height 为选填）→ 降级为待确认，不以海拔高替代</span>`;
            if (c02b === 'fail') return hasV(t, '超出空域限高')
              ? `${dn} ${hUsed}m，超出<b>空域规则</b>限高 ${limZone ? limZone.limit : (zone ? zone.limit : 120)}m（基准 ${datum.toUpperCase()}）—— 该空域内任何计划都无权批准此高度层`
                + zoneBasis(limZone)
              : `${dn} ${hUsed}m，超出<b>自身计划</b>批准高度（未超空域规则限高）—— 属偏离批准参数`;
            if (c02b === 'warn') return `接近限高：${dn} ${hUsed}m / 限 ${zone.limit}m（基准 ${datum.toUpperCase()}）`;
            return `${dn} ${hUsed}m，未超限（基准 ${datum.toUpperCase()}）`;
          })()
        },
        {
          r: R('C02-3'), s: c02c, msg: offRouteUndet
            ? `<span style="color:#ffd07a">无报备航线几何数据（管服平台 routes 未接入），无法比对轨迹与批准走廊 —— 本项不可判定</span>`
            + '<br><span style="color:var(--txt-3)">不以「未测到」当作合规，也不据此给出偏离距离</span>'
            : (function () {
              const f = t.facts || {};
              const r = t.routeId && M.routeById ? M.routeById(t.routeId) : null;
              const dev = f.routeMaxDevM, half = f.routeHalfWidthM;
              const geom = dev != null && half != null
                ? `最大横向偏差 <b>${dev} m</b>，走廊半宽阈值 ${half} m`
                + (r ? `（${r.name}：宽 ${r.widthM} m / 容差 ${r.widthTolM} m）` : '')
                : '';
              // 距离是按轨迹点到走廊中心线逐点实算的，不是文案里写死的数
              return offRouteLabel
                ? `轨迹越出批准走廊：${geom}，且连续 ${(M.TRACK_MODEL || {}).holdSamples || 2} 个采样点超限`
                : `轨迹全程位于批准走廊内：${geom || '—'}`;
            })()
        },
        {
          r: R('C02-4'), s: c02d, msg: c02d === 'pass' ? '在报备时段内'
            : hasV(t, '超出空域管制时段')
              ? `飞行时刻落在<b>空域规则</b>管制时段内${zone && zone.type === '临时管制区' ? `（${zone.name}　${zone.from} ~ ${zone.to}）` : ''} —— 该时段内任何计划都无权批准`
              : '超出<b>自身计划</b>批准时段（未触及空域管制时段）—— 属偏离批准参数'
        },
        { r: R('C02-5'), s: c02e, msg: c02eMsg },
        { r: R('C02-6'), s: c02f, msg: c02fMsg },
        {
          r: R('C03'), s: engVerdict === '非法' ? 'fail' : (engVerdict === '合法' ? 'pass' : 'warn'),
          msg: `风险评分 <b>${score}</b> / 100（${grade}，高=风险高）· 五因子加权 <span class="mono" style="font-size:11px">${C03.ver}</span>`
            + (gated
              ? `<br><span style="color:#ff9aa4">规则引擎原始输出「${eng}」；表10-4 结论依据缺 ${reqMiss.length} 项，`
              + `按 §10.4「结论一律向待确认收敛」取「待确认」，不得定性为「非法」</span>`
              : `<br>规则引擎判定「${eng}」`)
        }
      ]
    };
  }

  /* =========================================================================
   * B6：人工改判（设计 8.6）
   * 硬要求：记录操作者/时间/原判定/新判定/理由；不得覆盖原始判定；理由必填。
   * ====================================================================== */
  /* 规则引擎自身的证据门禁，与人工操作分开署名 */
  const ENGINE = { name: '规则引擎 · C01 证据充分性门禁', account: 'rule-engine', role: '系统自动' };
  const GATE_REASON = '证据不足自动降级（B9）：判定时刻无 uav_sn 数据源（仅协议破解 dcd / RemoteID rid 可提供），'
    + '身份匹配只能依据时间窗 + 空间范围，不足以支撑「身份不匹配」定性，按 §8.6 验收要点结论取「待确认」';

  /* 改判记录进操作审计（设计 8.6 第 5 条）—— 与 users.js「操作审计」同一数据源 */
  function audit(actor, action, target) {
    const n = M.auditLogs.reduce((m, a) => Math.max(m, parseInt(String(a.id).replace(/\D/g, '')) || 0), 0) + 1;
    M.auditLogs.push({
      id: 'AU' + M.util.p3(n), time: nowStr(), user: actor.name, role: actor.role,
      module: '合法性判定', action: action, target: target, result: '成功',
      ip: actor.account === 'rule-engine' ? '127.0.0.1' : '10.20.1.15',
      term: actor.account === 'rule-engine' ? '判定引擎' : '终端-01'
    });
  }

  function applyReview(t, to, reason, act, actor) {
    actor = actor || OPER;
    if (t.legalOriginal == null) t.legalOriginal = t.legal;   // 首次操作即固化引擎原判定，之后只读
    const from = t.legal;
    t.reviewLog = t.reviewLog || [];
    t.reviewLog.push({
      at: nowStr(), operator: actor.name, account: actor.account, role: actor.role,
      from: from, to: to, reason: reason, act: act
    });
    if (to && to !== t.legal) {
      t.legal = to;
      t.legal_status = to;          // A5：Schema 字段与内部字段必须同步，否则台账与页面口径分叉
      t.legalSource = actor === ENGINE ? '规则引擎降级' : '人工改判';
    }
    audit(actor, act + (from === to ? '（判定未变更：' + from + '）' : '：' + from + ' → ' + to), t.id);
    return from;
  }

  /* ---- 改判后联动关联告警 / 案件（设计 8.6 验收要点）---- */
  const linkedAlarm = t => M.alarms.find(a => a.targetId === t.id) || null;
  const linkedCase = t => M.cases.find(c => c.targetId === t.id) || null;
  const alarmTargetStatus = to => (to === '合法' ? '误报' : '已确认');
  function syncLinked(t, to, actor, doAlarm, doCase) {
    const out = [];
    const a = linkedAlarm(t);
    if (a && doAlarm) {
      const ns = alarmTargetStatus(to);
      if (a.status !== ns) {
        out.push(`告警 ${a.id} ${a.status} → ${ns}`);
        audit(actor, `联动更新告警状态：${a.status} → ${ns}`, a.id);
        a.status = ns;
      }
    }
    const c = linkedCase(t);
    if (c && doCase && to === '合法' && c.status !== '已结案' && c.status !== '待核实') {
      out.push(`案件 ${c.id} ${c.status} → 待核实`);
      audit(actor, `联动更新案件状态：${c.status} → 待核实`, c.id);
      c.status = '待核实';
    }
    return out;
  }

  /* ---- 案件定性依据复核请求（设计 §11 案件复核流程的入口）----
     判定页不越权改案件状态（尤其已结案的），改为产出一条复核请求，
     由「处置处罚管理」按 §11 流程处理。正式版该队列应由 mock.js / 接口层持有。 */
  function raiseReviewRequest(t, c, from, to, reason, actor) {
    M.reviewRequests = M.reviewRequests || [];
    if (M.reviewRequests.some(r => r.caseId === c.id && r.targetId === t.id && r.status === '待处理')) return null;
    const req = {
      id: 'RR' + M.util.p3(M.reviewRequests.length + 1),
      at: nowStr(), targetId: t.id, caseId: c.id, caseStatus: c.status,
      from: from, to: to, reason: reason,
      raisedBy: actor.name, status: '待处理',
      note: '案件定性依据不足，请按 §11 案件复核流程核实后决定是否撤案 / 补证 / 维持'
    };
    M.reviewRequests.push(req);
    audit(actor, `发起案件定性依据复核请求 ${req.id}（判定 ${from} → ${to}）`, c.id);
    return req;
  }

  /* ---- B9：证据门禁在进入页面时即生效 ——
     规则引擎不得在没有身份数据源的情况下输出「非法」（§8.6 验收要点），
     这是引擎自身的结论修正，署名系统自动，不是人工改判。 ---- */
  let gateDone = false;
  function applyEvidenceGate() {
    if (gateDone) return;
    gateDone = true;
    M.allTargets.filter(needGate).forEach(t => {
      const from = applyReview(t, '待确认', GATE_REASON, '证据不足自动降级', ENGINE);
      const c = linkedCase(t);
      if (c) raiseReviewRequest(t, c, from, '待确认', GATE_REASON, ENGINE);
    });
  }
  /* 当前页面不再使用“异常”作为独立结论：原异常统一进入待确认，由人工确认或改判。
     首次归并时保留引擎原判定，后续人工操作仍可追溯到“异常”。 */
  function collapseAbnormal() {
    M.allTargets.filter(t => t.type === '无人机' && t.legal === '异常').forEach(t => {
      if (t.legalOriginal == null) t.legalOriginal = '异常';
      t.legal = '待确认';
      t.legal_status = '待确认';
      t.legalSource = '规则状态归并';
    });
  }

  /* 引擎门禁留痕的识别：按操作者 account 判定，不依赖 act 文案 ——
     门禁已下沉到 mock.js（数据层用 act='证据降级'，本页原用 '证据不足自动降级'），
     按文案匹配会因两边措辞不同而静默失效。 */
  const gateEntry = t => (t.reviewLog || []).find(r => r.account === 'rule-engine' && r.from !== r.to) || null;
  const autoDegraded = () => M.allTargets.filter(t => t.type === '无人机' && gateEntry(t));

  const LEGALS = DISPLAY_STATUSES;
  const QUICK = [
    '经调阅光电取证视频与飞手笔录，该架次持有有效报备，系计划变更未同步',
    '现场核查确认为应急救援飞行，依规免于报备',
    '身份依据缺失（无 uavSN 数据源），证据不足不予定性',
    '复核发现雷达点迹为地物杂波误关联，非真实无人机目标'
  ];

  function reviewModal(mode) {
    const t = st.sel; if (!t) return;
    const cur = t.legal, eng = engOf(t), fixed = mode === 'false' ? '合法' : null;
    U.modal({
      title: (mode === 'false' ? '判定误报 · ' : '') + '人工改判（设计 8.6）· ' + t.id, width: '660px',
      body: `<div class="warnbox">人工改判将记录<b>操作者、时间、原判定、新判定与理由</b>，并<b>完整保留原始判定结果可查</b>（不覆盖）。
        <b>理由为必填项</b>，不填不允许提交。本次操作写入目标改判记录与操作审计；
        正式环境调用 <span class="mono">POST /api/v1/legality/review</span>。</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${U.field('目标编号', `<input class="ip" style="flex:1" value="${t.id}" readonly>`)}
          ${U.field('规则引擎原判定', `<input class="ip" style="flex:1" value="${eng}" readonly>`)}
          ${U.field('当前判定', `<input class="ip" style="flex:1" value="${cur}" readonly>`)}
          ${U.field('改判为 <span style="color:#ff8b95">*</span>', fixed
        ? `<input class="ip" style="flex:1" value="合法（误报）" readonly>`
        : `<select class="sel" data-rvto style="flex:1">
                 <option value="">请选择新判定（必填）</option>
                 ${LEGALS.filter(x => x !== cur).map(x => `<option value="${x}">${x}</option>`).join('')}
               </select>`)}
        </div>
        <div style="margin-top:12px">
          <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:6px">
            改判理由 <span style="color:#ff8b95">*</span>（必填，进入证据链与操作审计，不少于 5 个字）</div>
          <textarea class="ip" data-rvre style="width:100%;height:80px;padding:8px;font-size:12.5px"
            placeholder="请写明复核依据：调阅了什么证据、核实了什么事实、结论为何与规则引擎不同"></textarea>
          <div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
            <span style="font-size:11.5px;color:var(--txt-3)">常用理由：</span>
            ${QUICK.map((q, i) => `<button class="btn ghost" data-act="q${i}"
              style="height:24px;font-size:11.5px;padding:0 8px">${q.slice(0, 14)}…</button>`).join('')}
          </div>
        </div>
        ${(function () {
        const a = linkedAlarm(t), c = linkedCase(t);
        return `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
          <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:4px">联动更新（设计 8.6：改判后告警与案件状态同步）</div>
          ${a ? `<label class="chk"><input type="checkbox" data-rvsa checked>
              同步关联告警 <span class="mono">${a.id}</span>（当前 ${a.status}）—— 改判为「合法」时置为<b>误报</b>，其余置为<b>已确认</b></label>`
            : '<div style="font-size:11.5px;color:var(--txt-3)">无关联告警</div>'}
          ${c ? `<label class="chk"><input type="checkbox" data-rvsc ${c.status === '已结案' ? 'disabled' : 'checked'}>
              同步关联案件 <span class="mono">${c.id}</span>（当前 ${c.status}）—— 改判为「合法」时退回<b>待核实</b>
              ${c.status === '已结案' ? '<span style="color:#ffd07a">（已结案，需走案件复核流程，此处不自动改）</span>' : ''}</label>`
            : '<div style="font-size:11.5px;color:var(--txt-3)">无关联案件</div>'}
        </div>`;
      })()}
        <div id="rvErr" style="color:#ff8b95;font-size:12px;margin-top:8px"></div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">提交改判</button>`,
      on: Object.assign({
        ok: el => {
          const to = fixed || (el.querySelector('[data-rvto]') || {}).value || '';
          const reason = ((el.querySelector('[data-rvre]') || {}).value || '').trim();
          const err = el.querySelector('#rvErr');
          if (!to) { err.textContent = '⚠ 请选择新判定结果'; return; }
          if (!reason) { err.textContent = '⚠ 改判理由为必填项，不填不允许提交（设计 8.6）'; return; }
          if (reason.length < 5) { err.textContent = '⚠ 改判理由不少于 5 个字，需写明复核依据'; return; }
          if (to === t.legal) { err.textContent = '⚠ 新判定与当前判定相同，如仅确认原判定请使用「人工确认」'; return; }
          const sa = el.querySelector('[data-rvsa]'), sc = el.querySelector('[data-rvsc]');
          applyReview(t, to, reason, mode === 'false' ? '判定误报改判' : '人工改判');
          const synced = syncLinked(t, to, OPER, !!(sa && sa.checked), !!(sc && sc.checked && !sc.disabled));
          U.closeModal(); refresh();
          U.toast(`已改判：${t.id} ${cur} → ${to}；原判定「${eng}」已保留可查，记入改判记录与操作审计`
            + (synced.length ? `<br>联动更新：${synced.join('；')}` : ''), 'ok');
        }
      }, QUICK.reduce((o, q, i) => {
        o['q' + i] = el => { el.querySelector('[data-rvre]').value = q; };
        return o;
      }, {}))
    });
  }

  function confirmModal() {
    const t = st.sel; if (!t) return;
    U.modal({
      title: '人工确认判定结果 · ' + t.id, width: '560px',
      body: `<div class="warnbox">人工确认<b>不改变判定结果</b>，仅记录确认人与确认时间，作为「已人工复核」的凭据。
        如需改变判定结果，请使用「人工改判」。</div>
        ${U.kv([['目标编号', `<span class="mono">${t.id}</span>`], ['规则引擎原判定', engOf(t)],
        ['当前判定', U.legal(t.legal)], ['确认人', `${OPER.name}（${OPER.account} · ${OPER.role}）`],
        ['确认时间', `<span class="mono">${nowStr()}</span>`]])}
        <div style="margin-top:12px">
          <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:6px">确认说明（选填）</div>
          <textarea class="ip" data-cfre style="width:100%;height:60px;padding:8px;font-size:12.5px"
            placeholder="如：已核对报备计划与轨迹，规则引擎判定无误"></textarea>
        </div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">确认并记入审计</button>`,
      on: {
        ok: el => {
          const r = ((el.querySelector('[data-cfre]') || {}).value || '').trim();
          applyReview(t, t.legal, r || '（未填写说明）确认规则引擎判定无误', '人工确认');
          U.closeModal(); refresh();
          U.toast('已人工确认判定结果，记入改判记录与操作审计', 'ok');
        }
      }
    });
  }

  function decisionConfirmModal() {
    const t = st.sel;
    if (!t || t.legal !== '待确认') return;
    U.modal({
      title: '人工确认 · ' + t.id, width: '560px',
      body: `${U.kv([
        ['目标编号', '<span class="mono">' + t.id + '</span>'],
        ['当前状态', U.legal(t.legal)],
        ['确认人', OPER.name + '（' + OPER.role + '）']
      ])}
      ${U.field('确认结果', `<select class="sel" data-cfresult style="flex:1">
        <option value="合法">合法</option>
        <option value="非法">非法</option>
      </select>`)}
      <div style="margin-top:12px">
        <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:6px">确认说明（选填）</div>
        <textarea class="ip" data-cfre style="width:100%;height:64px;padding:8px"
          placeholder="填写核实依据或误报原因"></textarea>
      </div>`,
      footer: '<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">提交</button>',
      on: {
        ok: el => {
          const result = el.querySelector('[data-cfresult]').value;
          const reason = (el.querySelector('[data-cfre]').value || '').trim();
          applyReview(t, result, reason || '人工研判确认结果为' + result, '人工确认');
          syncLinked(t, result, OPER, true, true);
          U.closeModal(); refresh();
          U.toast('人工确认完成，判定状态已更新为「' + result + '」', 'ok');
        }
      }
    });
  }

  function manualReviseModal() {
    const t = st.sel;
    if (!t || !['合法', '非法'].includes(t.legal)) return;
    const cur = t.legal;
    const target = cur === '合法' ? '非法' : '合法';
    U.modal({
      title: '人工改判 · ' + t.id, width: '600px',
      body: `<div class="warnbox">人工改判会保留原判定，并记录操作者、时间、新判定和改判理由。</div>
        ${U.kv([
          ['目标编号', '<span class="mono">' + t.id + '</span>'],
          ['当前判定', U.legal(cur)]
        ])}
        ${U.field('改判为', '<input class="ip" style="flex:1" value="' + target + '" readonly>')}
        <div style="margin-top:12px">
          <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:6px">改判理由 <span style="color:#ff8b95">*</span></div>
          <textarea class="ip" data-rvre style="width:100%;height:76px;padding:8px"
            placeholder="请填写人工核实依据，不少于5个字"></textarea>
        </div>
        <div id="rvSimpleErr" style="color:#ff8b95;font-size:12px;margin-top:8px"></div>`,
      footer: '<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">提交改判</button>',
      on: {
        ok: el => {
          const reason = (el.querySelector('[data-rvre]').value || '').trim();
          const err = el.querySelector('#rvSimpleErr');
          if (reason.length < 5) { err.textContent = '改判理由不少于5个字'; return; }
          applyReview(t, target, reason, '人工改判');
          syncLinked(t, target, OPER, true, true);
          U.closeModal(); refresh();
          U.toast('已人工改判：' + cur + ' → ' + target, 'ok');
        }
      }
    });
  }

  /* ---- B9：证据充分性复核（近30天全量，非仅今日） ---- */
  function evidModal() {
    const rows = gatedList();
    const dcd = dep('dcd'), rid = dep('rid');
    const uav = M.allTargets.filter(t => t.type === '无人机');
    const withSn = uav.filter(snOf).length;
    const done = autoDegraded();
    const reqs = M.reviewRequests || [];
    // 表10-4 四要件全量校验（只统计，不改数据）
    const allIllegal = M.allTargets.filter(x => x.type === '无人机' && x.legal === '非法');
    const audited = allIllegal.map(x => ({ t: x, miss: judge(x).reqMiss }));
    const short = audited.filter(x => x.miss.length);
    // 缺项名称从实际结果里归集 —— 写死名称/下标会在口径调整后静默失配
    const missStat = [...new Set(audited.reduce((a, x) => a.concat(x.miss.map(m => m.n)), []))]
      .map(n => ({ n: n, c: audited.filter(x => x.miss.some(m => m.n === n)).length }))
      .sort((a, b) => b.c - a.c);
    U.modal({
      title: '身份证据充分性复核（B9 · 设计 8.6 / 9.2）', width: '900px',
      body: `<div class="warnbox">
        <b>协议事实</b>：<span class="mono">uavSN</span>（无人机实名编号）只有<b>协议破解设备 dcd(11)</b> 与
        <b>RemoteID 设备 rid(102)</b> 能上报；TDOA/AOA 只能给机型与遥控器位置；雷达/光电给不出任何身份信息。<br>
        <b>推论</b>：无 uavSN 数据 → C01「身份不匹配」<b>没有数据支撑</b>，只能退化为「时间窗 + 空间范围」匹配；
        证据不足<b>不得定性为非法</b>，应判「待确认」。<br>
        <b>当前覆盖</b>：设备台账 dcd ${dcd.total} 台（在线 ${dcd.online}）、rid ${rid.total} 台（在线 ${rid.online}）；
        近30天 ${U.num(uav.length)} 个无人机目标中，仅 <b>${U.num(withSn)}</b> 个取得 <span class="mono">uav_sn</span>
        （${U.pct(withSn, uav.length)}），<b>其余 ${U.num(uav.length - withSn)} 个身份判定为降级</b>。
        其中 rid 设备虽已部署，但当前数据源<b>未提供其上报</b>（V1.1 附录B Q13，待设备方确认）。</div>
        <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:8px">
          近30天中因<b>表10-4 结论依据不齐</b>（定性依据不成立 / 置信度不足 / 轨迹不稳）
          已由<b>规则引擎证据门禁降级为「待确认」</b>并留痕的目标：<b>${done.length}</b> 个；
          本页门禁另行补降级：<b>${rows.length}</b> 个（门禁已下沉至数据层，此处通常为 0）。<br>
          <span style="color:var(--txt-3)">原判定「非法」全部保留可查，降级记录同时写入目标改判记录与操作审计（模块：合法性判定）。</span></div>
        ${done.length ? U.table([
        { t: '目标编号', k: 'id', w: '134px', cls: 'num' },
        { t: '发现日期', w: '92px', cls: 'num', render: r => r.date },
        { t: '区域', k: 'district', w: '92px' },
        { t: '发现源', k: 'source', w: '96px' },
        { t: '原判定', w: '72px', render: r => U.legal(r.legalOriginal) },
        { t: '现判定', w: '72px', render: r => U.legal(r.legal) },
        { t: '降级时间', w: '138px', cls: 'num', render: r => (gateEntry(r) || {}).at || '—' },
        { t: '降级依据', render: r => `<span style="font-size:11.5px">${esc((gateEntry(r) || {}).reason || '—')}</span>` },
        {
          t: '关联案件', w: '150px', render: r => {
            const c = M.cases.find(x => x.targetId === r.id);
            return c ? `<span class="mono" style="font-size:11.5px">${c.id}</span>
              <span class="tag t-amber" title="判定已降级，案件定性依据需在处置处罚管理同步复核">需复核</span>`
              : '<span style="color:var(--txt-3)">未立案</span>';
          }
        },
        { t: '', w: '96px', render: r => `<button class="btn" data-act="pick" data-id="${r.id}" style="height:24px;font-size:11.5px;padding:0 8px">查看依据</button>` }
      ], done, { rowId: r => r.id }) : ''}
        ${rows.length ? U.table([
        { t: '目标编号', k: 'id', w: '134px', cls: 'num' },
        { t: '发现日期', w: '92px', cls: 'num', render: r => r.date },
        { t: '区域', k: 'district', w: '92px' },
        { t: '发现源', k: 'source', w: '96px' },
        { t: '当前判定', w: '78px', render: r => U.legal(r.legal) },
        { t: '身份依据', w: '128px', render: () => '<span class="tag t-amber">降级</span> 仅时空匹配' },
        {
          t: '案件', w: '110px', render: r => {
            const c = M.cases.find(x => x.targetId === r.id);
            return c ? `<span class="mono" style="font-size:11.5px">${c.id}</span>` : '<span style="color:var(--txt-3)">未立案</span>';
          }
        },
        {
          t: '处理', w: '112px', render: r =>
            `<button class="btn warn" data-act="pick" data-id="${r.id}" style="height:24px;font-size:11.5px;padding:0 8px">查看并处理</button>`
        }
      ], rows, { rowId: r => r.id }) : (done.length ? '' : `<div class="warnbox" style="border-color:rgba(47,208,110,.4);background:rgba(47,208,110,.08)">
          ✓ <b>当前无因身份证据不足而降级的判定（0 条）。</b><br>
          本台账用于<b>监测 C01 身份维度的数据源可用性</b>：若协议破解(dcd) / RemoteID(rid) 设备未部署或数据中断，
          相关判定会自动降级并在此列出。<br>
          <span style="color:var(--txt-3)">保持 0 条即表示身份数据源可用、没有"证据不足却判非法"的目标 ——
          这是一个正在正常工作的监测点，不是一个空入口。</span>
        </div>`)}
        <div style="font-size:11.5px;color:var(--txt-3);margin-top:10px">
          说明：降级动作统一在右侧「判定详情」中执行 —— 那里给出完整判定过程、数据源可用性与案件影响提示；
          已立案目标降级后不直接改案件状态，改为发起<b>案件定性依据复核请求</b>，由处置处罚管理按 §11 流程处理。</div>

        <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
          <div class="warnbox" style="margin-bottom:9px">
            <b>按表10-4 结论依据全量复算（当前门禁未启用该范围）</b><br>
            表10-4（V1.1 修订）：判「非法」需<b>定性依据成立</b>（无合法授权 <b>或</b> 进入绝对禁止空间，二选一）
            <b>且</b> 证据质量门槛齐备（较高置信度 + 轨迹稳定）。C02 严重违规是加重情形，不是必要条件。
            对<b>当前仍判「非法」</b>的 <b>${allIllegal.length}</b> 个目标按本页口径逐一复算：
            <b>${short.length}</b> 个依据不齐、<b>${allIllegal.length - short.length}</b> 个成立。<br>
            数据层门禁已下沉（本页 <span class="mono">GATE_MODE = 'identity'</span> 仅作兜底与口径回归探针）。
            ${short.length ? `<span style="color:#ff9aa4">仍有 <b>${short.length}</b> 个未被数据层门禁拦下，实际缺项：
              ${missStat.filter(m => m.c).map(m => m.n + ' ×' + m.c).join('；')}。
              说明本页与数据层的判据在这几项上取值不同，需对齐。</span>`
        : '<span style="color:#7fe6a6">两边口径一致，无残留。</span>'}
          </div>
          <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:6px">缺项分布（当前 ${allIllegal.length} 个「非法」目标）</div>
          ${missStat.length ? U.bars(missStat.map(m => ({ name: m.n, value: m.c, max: allIllegal.length, tx: m.c + ' 个' })))
        : '<div class="empty">无缺项</div>'}
        </div>

        <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
          <div style="font-size:12.5px;color:var(--txt-2);margin-bottom:6px">
            案件定性依据复核请求 <b>${reqs.length}</b> 条
            <span style="color:var(--txt-3);font-size:11.5px">—— 判定页不直接改案件状态（§11 由处置处罚管理处理）</span></div>
          ${reqs.length ? U.table([
        { t: '请求编号', k: 'id', w: '84px', cls: 'num' },
        { t: '发起时间', k: 'at', w: '138px', cls: 'num' },
        { t: '目标编号', k: 'targetId', w: '134px', cls: 'num' },
        { t: '关联案件', w: '150px', render: r => `<span class="mono" style="font-size:11.5px">${r.caseId}</span>（${r.caseStatus}）` },
        { t: '判定变更', w: '110px', render: r => `${U.legal(r.from)} → ${U.legal(r.to)}` },
        { t: '发起方', k: 'raisedBy', w: '190px' },
        { t: '状态', w: '80px', render: r => U.tag(r.status, 't-amber') }
      ], reqs, { rowId: r => r.id }) : '<div class="empty">暂无复核请求</div>'}
          <div style="font-size:11.5px;color:var(--txt-3);margin-top:8px">
            队列暂挂在 <span class="mono">MOCK.reviewRequests</span>，待处置处罚管理接入后消费；正式版应由接口层持有。</div>
        </div>`,
      footer: `<button class="btn" data-close>关闭</button>`,
      on: {
        pick: (el, a) => {
          const t = M.allTargets.find(x => x.id === a.dataset.id);
          if (!t) return;
          st.sel = t;
          U.closeModal(); refresh();
          U.toast(`已选中 ${t.id}（${t.date}，不在今日列表内），可在右侧「判定详情」查看依据并处理`, 'ok');
        }
      }
    });
  }

  /* ---------------- 渲染 ---------------- */
  function targets() {
    return M.todayTargets.filter(t => t.type === '无人机')
      .filter(t => (st.legal === '全部' || t.legal === st.legal) && (st.region === '全部' || t.district === st.region))
      .sort((a, b) => b.ts - a.ts);
  }

  function kpiHtml() {
    const T = M.todayTargets.filter(t => t.type === '无人机');
    const c = s => T.filter(t => t.legal === s).length;
    return U.kpis([
      { label: '今日判定目标', value: U.num(T.length), color: 'blue', icon: 'check', desc: '仅无人机参与合法性判定' },
      { label: '合法', value: U.num(c('合法')), color: 'green', icon: 'check', desc: `占比 ${U.pct(c('合法'), T.length)}` },
      { label: '非法', value: U.num(c('非法')), color: 'red', icon: 'alert', desc: '黑飞/禁飞区/身份不符' },
      {
        label: '待确认', value: U.num(c('待确认')), color: 'amber', icon: 'alert',
        desc: `需人工确认 · 占比 ${U.pct(c('待确认'), T.length)}`
      }
    ]);
  }

  function render() {
    collapseAbnormal();
    applyEvidenceGate();
    const T = M.todayTargets.filter(t => t.type === '无人机');
    // 跨页深链:从告警中心/处罚页点"关联目标"跳来时,直接选中该目标
    const ctx = U.consume('legality');
    if (ctx && ctx.target) {
      const hit = M.todayTargets.find(t => t.id === ctx.target) || M.allTargets.find(t => t.id === ctx.target);
      if (hit) {
        st.sel = hit; st.legal = '全部'; st.region = '全部';
        // 深链只设选中项是不够的：22 条分 3 页时，目标可能在第 3 页，
        // 跳过去右侧详情对了、左侧列表里却找不到那一行 —— 等于没跳。
        const idx = targets().findIndex(x => x.id === hit.id);
        if (idx >= 0) st.page = Math.max(1, Math.ceil((idx + 1) / st.size));
      }
    }
    // safe-default: 列表默认选中项，用户可见可改；选不中时退到首条只是初始焦点，不构成任何事实断言
    st.sel = st.sel || T.find(t => t.legal === '非法') || T[0];
    /* 本页的判定结论由参数算出，而那些参数一组都没被业务方签过字。
       评审时对方不问，界面上任何地方都不会主动说 —— 所以在产出结论的这一页明写。
       这不是警告横幅，是出处标注：读的人有权知道这个「非法」是按谁定的阈值算出来的。 */
    return `<div style="height:100%;display:flex;flex-direction:column;min-height:0">
    <div id="lgKpi">${kpiHtml()}</div>

    <div class="row" style="margin-top:12px;flex:1;min-height:0;padding-bottom:6px">
      ${U.panel({
      title: '判定结果列表', style: 'flex:1.4', nopad: true,
      body: `<div class="toolbar">
          ${U.field('判定结果', U.select('legal', ['全部', ...DISPLAY_STATUSES], st.legal))}
          ${U.field('区域', U.select('region', ['全部', ...M.DISTRICTS.map(d => d.name)], st.region))}
          <span style="flex:1"></span>
          <button class="btn" id="lgRule">⚙ 规则显示</button>
          <button class="btn" id="lgRecalc">⟳ 重新判定</button>
        </div>
        <div id="lgList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}
      ${U.panel({
      title: '判定详情', style: 'width:480px', nopad: true, extra: `<span id="lgSt"></span>`,
      body: `<div id="lgDetail" style="flex:1;overflow:auto;padding:12px"></div>`
    })}
    </div>
    </div>`;
    /* 底部统计行（判定结果分布 / 违规原因排行 / 判定趋势）已按用户指令整行删除，
       连同 drawPie 与 lgVio / lgTrend 的聚合与初始化。
       主区域高度已随 B 的布局改造改为 flex:1 自适应，不再依赖 calc 视口常量，
       增减固定块后也无需再实测重标。 */
  }

  function list() {
    const rows = targets(), page = rows.slice((st.page - 1) * st.size, st.page * st.size);
    return U.table([
      { t: '目标编号', k: 'id', w: '112px', cls: 'num' },
      { t: '发现时间', w: '64px', cls: 'num', render: t => t.time.slice(11) },
      /* 这一格最容易变宽：机型名 + 来源标记 + 归属单位，三样都来自数据层，
         而 td 是 white-space:nowrap —— 声明 w 压不住内容，内容多长这一列就多宽。
         所以宽度由**内层固定宽容器**兜住，两行各自 ellipsis，完整值走 title 与右侧详情。
         只给 td 写 w 是压不住的：那次 8px 横向滚动条就是这么来的。 */
      {
        t: '机型 / 归属', w: '110px', render: t => `<div style="width:104px">
          <div style="overflow:hidden;text-overflow:ellipsis" title="${String(t.model || '').replace(/"/g, '&quot;')}">${U.modelTag(t.model, t.modelSource, true)}</div>
          <div style="font-size:11px;color:var(--txt-3);overflow:hidden;text-overflow:ellipsis" title="${t.partner}">${t.partner}</div></div>`
      },
      { t: '区域 / 高度', w: '92px', render: t => `${t.district}<div class="mono" style="font-size:11px;color:var(--txt-3)">${t.alt}m</div>` },
      {
        /* 两个标签纵向堆叠：并排会把这一格撑到 125px（td 是 nowrap，声明宽度压不住内容） */
        t: '判定 / 风险', w: '84px', render: t => U.legal(t.legal)
          + `<div style="margin-top:2px">${U.risk(t.risk)}</div>`
          + (needGate(t) ? ` <span title="身份依据缺失，证据不足" style="color:#ff8b95">⚠</span>` : '')
          + (manualRevised(t) ? `<div style="font-size:10.5px;color:#c8adff;margin-top:2px" title="原判定 ${engOf(t)}，已人工改判">人工改判</div>`
            : engineDegraded(t) ? `<div style="font-size:10.5px;color:#ffd07a;margin-top:2px" title="原判定 ${engOf(t)}，因身份依据缺失由引擎证据门禁降级">证据降级</div>` : '')
      },
      {
        t: '违规原因', w: '96px', render: t => {
          const vs = vlist(t);
          if (!vs.length) return '—';
          // 纵向堆叠并折叠第 3 条起：多违规目标横排会把列撑宽，导致列表横向溢出
          const show = vs.slice(0, 2).map(v =>
            `<div style="margin:1px 0">${U.tag(v, FORBIDDEN_VIOLATIONS.indexOf(v) >= 0 ? 't-red' : 't-orange')}</div>`).join('');
          return show + (vs.length > 2
            ? `<div style="font-size:10.5px;color:var(--txt-3)" title="${vs.join('、')}">+${vs.length - 2} 项</div>` : '');
        }
      },
      /* 来源与置信度合并成一列：二者本就是同一件事的两面（谁测的 / 测得多准）。
         1440 宽下列宽合计 870 > 容器 726，按既有做法合并相关列，而不是让列表横滚。 */
      {
        t: '数据来源', w: '90px', render: t => `<div>${t.source}</div>`
          + `<div class="mono" style="font-size:11px;color:var(--txt-3)">置信度 ${U.confPct(t.source_confidence)}</div>`
      }
    ], page, { rowId: t => t.id, activeId: st.sel && st.sel.id }) + U.pager({ total: rows.length, page: st.page, size: st.size });
  }

  function evidSect(t, j) {
    const ev = j.ev;
    return U.sect(`身份数据源可用性 <span class="tag ${ev.full ? 't-green' : 't-amber'}">${ev.full ? '完整判定' : '降级判定'}</span>`,
      `${ev.full ? `<div class="warnbox" style="border-color:rgba(47,208,110,.45);background:rgba(47,208,110,.10);
          color:#a7edc4;margin-bottom:9px">✓ <b>身份判定：完整</b> —— 已取得实名编号
          <span class="mono">${esc(ev.sn)}</span>（来源：${ev.dev} 设备），可执行 uavSN 实名核验。</div>`
        : `<div class="warnbox" style="margin-bottom:9px;font-size:13px;line-height:1.75">
          ⚠ <b>身份判定：降级</b> —— 本次判定<b>未取得 uav_sn（无人机实名编号）</b>。
          按协议，uav_sn 只有<b>协议破解 dcd(11)</b> 与 <b>RemoteID rid(102)</b> 能提供；
          雷达/光电给不出任何身份信息，TDOA/AOA 只能给型号线索。<br>
          → 身份匹配<b>降级为「时间窗 + 空间范围」</b>，<b>不足以支撑「身份不匹配」定性</b>；
          型号（来源：${ev.modelSrc}）<b>只是线索，不是身份依据</b>。
          <span style="color:var(--txt-3)">（V1.1 §5.4 note / 附录B Q13，待设备方确认现场部署与上报）</span></div>`}
      <div style="font-size:11.5px;color:var(--txt-3);margin-bottom:7px">
        判定时刻各数据源可用情况（区域：${t.district}，括号内为本区在线/总数）—— 身份依据：<b style="color:${ev.full ? '#7fe6a6' : '#ffd07a'}">${ev.basis}</b></div>
      <table class="tb" style="table-layout:fixed"><thead><tr>
        <th style="width:104px">数据源</th><th style="width:150px">能提供的身份信息</th><th>本次判定</th></tr></thead><tbody>
        ${ev.rows.map(r => `<tr>
          <td style="white-space:normal">${r.s.type}
            <div class="mono" style="color:var(--txt-3);font-size:10.5px">${r.s.abbr}(${r.s.dt}) · ${r.d.online}/${r.d.total}</div></td>
          <td style="white-space:normal;font-size:11.5px;color:var(--txt-2)">${r.s.gives}</td>
          <td style="white-space:normal;font-size:11.5px;color:${r.ok ? '#7fe6a6' : 'var(--txt-3)'}">${r.ok ? '✓ ' : ''}${r.got}</td>
        </tr>`).join('')}
      </tbody></table>
      <div style="margin-top:7px;font-size:11.5px;color:var(--txt-3);line-height:1.75">
        判定时刻来源质量：来源可信度 <b class="mono" style="color:var(--txt-2)">${t.source_confidence != null ? t.source_confidence : '—'}</b>
        · 分类置信度 <b class="mono" style="color:var(--txt-2)">${t.classification_confidence != null ? t.classification_confidence : '不提供'}</b>
        <span title="${t.clsConfWhy || ''}" style="color:var(--txt-3)">${
          t.classification_confidence == null
            ? '（' + String(t.clsConfWhy || '原因未记录').replace(/^设备不提供（(.+)）$/, '$1') + '）'
            : ''}</span>
        · 定位精度 <b class="mono" style="color:var(--txt-2)">${t.position_accuracy != null ? '±' + t.position_accuracy + ' m' : '无效'}</b>
        <span title="协议明确光电与 AOA 的位置无效">${t.position_accuracy == null ? '（光电 / AOA 位置无效）' : ''}</span>
        ${t.matched_plan_id ? ` · 命中计划 <b class="mono" style="color:var(--txt-2)">${t.matched_plan_id}</b>` : ' · 未命中报备计划'}
      </div>
      `);
  }

  /* ---- 空间证据：C02 是空间判断，最终依据是几何关系，只能用图表达 ----
     此前判定详情里 C02 各项只有文字结论（"进入禁飞空域 XXX"），人只能选择相信，
     没法自己看一眼。判定过程可追溯做了很多轮，但**空间类判定的依据是几何**。 */
  function spaceHits(t) {
    const zone = M.airspaces.find(a => a.region === t.district);
    const hits = [];
    if (hasV(t, '侵入禁飞区')) hits.push({ v: '侵入禁飞区', zone, how: '轨迹穿越该空域边界' });
    if (hasV(t, '超出空域限高')) hits.push({ v: '超出空域限高', zone, how: `轨迹高度超出该空域限高 ${zone ? zone.limitTx : ''}` });
    if (hasV(t, '超出空域管制时段')) hits.push({ v: '超出空域管制时段', zone, how: '飞行时刻落在该空域管制时段内' });
    if (hasV(t, '偏离报备航线')) {
      const r = t.routeId && M.routeById ? M.routeById(t.routeId) : null;
      hits.push({ v: '偏离报备航线', route: r, how: `轨迹越出批准走廊（最大横向偏差 ${t.facts.routeMaxDevM} m / 半宽阈值 ${t.facts.routeHalfWidthM} m）` });
    }
    return hits;
  }
  function spaceSect(t, j) {
    const hits = spaceHits(t);
    const pts = t.track_points || [];
    const bridged = pts.filter(p => p.kind === 'bridge').length;
    return U.sect('空间证据（C02 命中在图上的位置）'
      + (hits.length ? ` <span class="tag t-red">${hits.length} 项命中</span>` : ' <span class="tag t-green">无空间类命中</span>'),
      `<div id="lgMap" style="height:210px;border:1px solid var(--line);border-radius:6px;overflow:hidden"></div>
      <div style="font-size:11.5px;color:var(--txt-3);margin-top:6px;line-height:1.7">
        ${pts.length ? `轨迹 ${pts.length} 点`
        + (bridged ? `，其中 <b style="color:#ff8b3d">${bridged} 点为弥合段(A03)</b> —— 该段无实测值，位置由算法推算，<b>不得等同实测参与判定</b>（§6.8）`
          : '，全部为实测点') : '<span style="color:#ffd07a">该目标无轨迹数据，图上只能显示空域范围</span>'}
      </div>
      ${hits.length ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
        ${hits.map(h => `<div style="font-size:12.5px;border-left:2px solid #ff4d5e;padding-left:8px">
          <div><b>${h.v}</b>${h.zone ? ` · ${h.zone.type}「${h.zone.name}」` : h.route ? ` · 航线「${h.route.name}」` : ''}</div>
          <div style="color:var(--txt-3)">${h.how}</div></div>`).join('')}
      </div>` : `<div style="font-size:12px;color:var(--txt-3);margin-top:7px">
        本次判定无空间类命中；图上仅供核对轨迹与所在空域的位置关系。</div>`}`);
  }
  /* 地图实例随详情面板重绘而重建：详情是 innerHTML 整体替换，旧 canvas 已脱离文档 */
  let detMap = null;
  function drawDetailMap() {
    const box = document.getElementById('lgMap');
    if (!box) return;
    if (detMap) { try { detMap.destroy(); } catch (e) { } detMap = null; }
    const t = st.sel; if (!t) return;
    detMap = new MapView(box, { zoom: 3.2, maxDev: 0, maxAlarm: 0, legend: false, layers: { device: false, alarm: false } });
    detMap.setData({ airspaces: M.airspaces, devices: [], alarms: [], targets: [t] });
    detMap.sel = t;
    const pts = t.track_points || [];
    const c = pts.length ? pts[Math.floor(pts.length / 2)] : t;
    /* MapView 没有 centerOn，各页面各自用 px() 做增量对齐（alarms.js 也是这么做的）。
       补一帧是因为：页面若在后台标签页挂载，rAF 不触发；而容器布局未完成时 map.w=0，
       此时对齐会失效。centerOn 是增量的，重复调用不会叠加偏移。 */
    const center = () => {
      if (!detMap || !detMap.w) return;
      const q = detMap.px(c.lon, c.lat);
      detMap.ox += detMap.w / 2 - q[0];
      detMap.oy += detMap.h / 2 - q[1];
    };
    center();
    requestAnimationFrame(center);
  }

  /* 表10-4「非法」结论依据校验 —— 只对引擎原始结论为「非法」的目标展示 */
  function reqSect(t, j) {
    if (j.eng !== '非法') return '';
    const row = r => `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12.5px;
        border-left:2px solid ${r.ok ? '#2fd06e' : '#ffb020'};padding-left:8px">
      <span style="width:14px">${r.ok ? '<span style="color:#2fd06e">✓</span>' : '<span style="color:#ffb020">✕</span>'}</span>
      <div style="flex:1"><div>${r.n}</div><div style="color:var(--txt-3)">${r.why}</div></div></div>`;
    const basis = j.reqs.filter(r => r.g === '定性依据'), qual = j.reqs.filter(r => r.g === '质量门槛');
    return U.sect(`「非法」结论依据校验 <span class="tag ${j.reqMiss.length ? 't-amber' : 't-green'}">${j.reqMiss.length ? '缺 ' + j.reqMiss.length + ' 项' : '成立'}</span>`,
      `<div style="font-size:11.5px;color:var(--txt-3);margin-bottom:7px">
        表10-4：分界由<b>有没有授权覆盖</b> + <b>偏离的性质</b>共同决定。
        定性依据<b>二选一即可</b>；证据质量门槛须同时满足；C02 严重违规是加重情形，<b>不是必要条件</b>。</div>
      <div style="font-size:11.5px;color:#9ec6ff;margin:8px 0 5px">定性依据（满足其一即可）</div>
      <div style="display:flex;flex-direction:column;gap:6px">${basis.map(row).join('')}</div>
      <div style="font-size:11.5px;color:#9ec6ff;margin:9px 0 5px">证据质量门槛（须同时满足）</div>
      <div style="display:flex;flex-direction:column;gap:6px">${qual.map(row).join('')}</div>
      <div style="font-size:11.5px;color:#9ec6ff;margin:9px 0 5px">加重情形（不决定结论落点）</div>
      <div style="display:flex;gap:8px;align-items:flex-start;font-size:12.5px;
          border-left:2px solid ${j.aggravating.hit ? '#ff8b3d' : 'var(--line)'};padding-left:8px">
        <span style="width:14px">${j.aggravating.hit ? '<span style="color:#ff8b3d">▲</span>' : '<span style="color:var(--txt-3)">—</span>'}</span>
        <div style="flex:1"><div>C02 严重违规</div>
          <div style="color:var(--txt-3)">${j.aggravating.why}</div></div></div>`);
  }

  /* C03 五因子加权明细 */
  function factorSect(t, j) {
    const rows = Object.keys(C03.w).map(k => ({
      k, n: C03.wName[k], w: C03.w[k], v: j.F[k], add: C03.w[k] * j.F[k] * 100
    })).sort((a, b) => b.add - a.add);
    return U.sect(`C03 风险评分明细 <span class="tag t-blue">${j.score} / 100 · ${j.grade}</span>`,
      `<div style="font-size:11.5px;color:var(--txt-3);margin-bottom:7px">
        设计 §10.4 多因子加权：违规项严重度 / 目标类别 / 区域敏感度 / 轨迹稳定性 / 来源可信度。
        权重与阈值为 <span class="mono">${C03.ver}</span>　<b>【待确认：由业务方调参，纪要 §10】</b></div>
      <table class="tb" style="table-layout:fixed"><thead><tr>
        <th>因子</th><th style="width:62px;text-align:right">权重</th>
        <th style="width:62px;text-align:right">取值</th><th style="width:70px;text-align:right">计入风险</th></tr></thead><tbody>
        ${rows.map(r => `<tr>
          <td style="white-space:normal">${r.n}${r.k === 'source' && !j.ev.full
        ? '<div style="font-size:10.5px;color:#ffd07a">含身份线索缺失加罚 +' + C03.idMissing + '</div>' : ''}</td>
          <td style="text-align:right" class="mono">${r.w.toFixed(2)}</td>
          <td style="text-align:right" class="mono">${r.v.toFixed(2)}</td>
          <td style="text-align:right;color:var(--txt)" class="mono">${r.add.toFixed(1)}</td>
        </tr>`).join('')}
        <tr><td colspan="3" style="text-align:right;color:var(--txt-2)">加权风险合计</td>
          <td style="text-align:right" class="mono"><b>${j.score}</b></td></tr>
      </tbody></table>`);
  }

  function reviewSect(t) {
    const log = t.reviewLog || [];
    if (!log.length) return '';
    return U.sect(`判定变更记录 <span class="tag t-purple">${log.length} 条</span>`,
      `<div style="font-size:11.5px;color:var(--txt-3);margin-bottom:8px">
        规则引擎原始判定：<b>${U.legal(engOf(t))}</b> —— <b>原判定不被覆盖，全程可查</b>（设计 8.6 审计要求）</div>
      ${log.map((r, i) => `<div style="border-left:2px solid ${r.from === r.to ? '#3d8bff' : '#a97bff'};
          padding-left:9px;margin-bottom:9px;font-size:12.5px;line-height:1.75">
        <div><b>${i + 1}. ${r.act}</b> <span class="mono" style="color:var(--txt-3);font-size:11.5px">${r.at}</span></div>
        <div>${U.legal(r.from)} <span style="color:var(--txt-3)">→</span> ${U.legal(r.to)}
          ${r.from === r.to ? '<span style="color:var(--txt-3);font-size:11.5px">（判定结果未变更）</span>' : ''}</div>
        <div style="color:var(--txt-3)">操作者：${esc(r.operator)}（${esc(r.account)} · ${esc(r.role)}）</div>
        <div style="color:var(--txt-2)">理由：${esc(r.reason)}</div>
      </div>`).join('')}`);
  }

  function legacyDetail() {
    const t = st.sel;
    if (!t) return '<div class="empty">请选择目标</div>';
    const stEl = document.getElementById('lgSt');
    if (stEl) stEl.innerHTML = U.legal(t.legal) + ' ' + U.risk(t.risk)
      + (manualRevised(t) ? ' <span class="tag t-purple">人工改判</span>'
        : engineDegraded(t) ? ' <span class="tag t-amber">证据降级</span>' : '');
    const j = judge(t);
    const manual = manualRevised(t), autoDeg = !manual && engineDegraded(t);
    const ic = s => s === 'pass' ? '<span style="color:#2fd06e">✓</span>' : s === 'warn' ? '<span style="color:#ffb020">!</span>' : '<span style="color:#ff4d5e">✕</span>';
    /* 结论必须在最前面。原来第一屏是 11 个字段的「目标信息」，
       「为什么判成非法」要滚过四屏才看得到 —— 业务人员读这一页是来看结论的，
       字段是给复核用的，顺序反了。下面的技术区块一个都没删，只是排到结论后面。 */
    const ctxE = EVT.of(t.id);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <b class="mono" style="font-size:14px">${t.id}</b></div>
      ${U.verdictHtml(t)}
      <div style="font-size:13.5px;color:var(--txt-2);margin:14px 0 9px">判定依据</div>
      ${U.basisHtml(t)}
      ${ctxE && ctxE.alarm ? `<div style="margin:12px 0;font-size:13px;color:var(--txt-2)">
        已触发告警 <span class="mono">${ctxE.alarm.id}</span> ${U.tag(ctxE.alarm.status)}
        ${ctxE.kase ? `· 案件 <span class="mono">${ctxE.kase.id}</span> ${U.tag(ctxE.kase.status)}` : '· 尚未立案'}</div>` : ''}
      <div style="margin:16px 0 4px;font-size:12.5px;color:var(--txt-3)">以下为完整判定过程与原始字段，供复核使用</div>
      ${U.sect('目标信息', U.kv([
      ['发现时间', t.time],
      ['机型 (uav_model)', `${U.modelTag(t.uav_model, t.modelSource)} <span class="tag t-gray" title="型号只是线索，实名编号 uav_sn 才是身份依据">线索·非身份</span>`],
      ['归属单位', t.partner], ['飞手', t.pilot],
      ['实名编号 (uav_sn)', j.ev.sn ? `<span class="mono">${esc(j.ev.sn)}</span>`
        : '<span style="color:#ffd07a">未取得（仅 dcd/rid 设备可提供）</span>'],
      ['位置', `<span class="mono">${t.lon.toFixed(4)}°E, ${t.lat.toFixed(4)}°N</span>`],
      ['海拔高 (altitude)', `${t.alt} m`],
      ['距地高 (height_agl)', t.heightAgl != null ? `${t.heightAgl} m`
        : '<span style="color:#ffd07a">设备未上报（协议选填）</span>'],
      ['速度', `${t.speed} m/s`], ['数据来源', t.source + `（置信度 ${U.confPct(t.source_confidence)}）`]
    ]))}
      ${evidSect(t, j)}
      ${U.sect('规则判定过程' + (manual ? ' <span class="tag t-purple">当前判定已由人工改判</span>'
      : autoDeg ? ' <span class="tag t-amber">当前判定为证据门禁降级结果</span>' : ''), `
        ${manual ? `<div class="warnbox" style="margin-bottom:9px">以下为<b>规则引擎原始输出</b>（判定为「${engOf(t)}」）。
          当前判定「${t.legal}」<b>来自人工改判，非规则引擎输出</b>，改判依据见下方「改判记录」。</div>`
        : autoDeg ? `<div class="warnbox" style="margin-bottom:9px">以下为<b>规则引擎逐条输出</b>。原始结论为「${engOf(t)}」，
          但 C01 身份依据缺失，已由<b>引擎证据充分性门禁自动降级为「${t.legal}」</b>（非人工改判）；留痕见下方「判定变更记录」。</div>` : ''}
        <div style="display:flex;flex-direction:column;gap:7px">
        ${j.items.map(i => `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12.5px;
            border-left:2px solid ${i.s === 'pass' ? '#2fd06e' : i.s === 'warn' ? '#ffb020' : '#ff4d5e'};padding-left:8px">
          <span style="width:14px">${ic(i.s)}</span>
          <div style="flex:1"><div><b>${i.r.id}</b> ${i.r.n} ${i.badge || ''}</div>
            <div style="color:var(--txt-3)">${i.msg}</div></div></div>`).join('')}
      </div>`)}
      ${spaceSect(t, j)}
      ${reqSect(t, j)}
      ${factorSect(t, j)}
      ${U.sect('判定结论', `<div style="display:flex;align-items:center;gap:14px;padding:10px;border:1px solid var(--line);border-radius:6px">
        <div id="lgScore" style="width:76px;height:76px"></div>
        <div style="flex:1;font-size:12.5px;line-height:1.9">
          <div>当前判定：${U.legal(t.legal)}
            <span class="tag ${manual ? 't-purple' : autoDeg ? 't-amber' : 't-blue'}" style="margin-left:4px">${manual ? '人工改判' : autoDeg ? '引擎证据门禁降级' : '规则引擎输出'}</span></div>
          <div>规则引擎原判定：${U.legal(j.eng)}${j.gated
      ? (t.legal === '非法' ? ` <span style="color:#ff9aa4">→ 证据不足，建议「待确认」</span>`
        : ` <span style="color:#ffd07a">→ 已按证据不足降级</span>`) : ''}</div>
          <div>C03 风险评分：<b class="mono">${j.score}</b>/100（${j.grade}）　身份依据：<span class="tag ${j.ev.full ? 't-green' : 't-amber'}">${j.ev.full ? '完整' : '降级'}</span></div>
          <div>风险等级：${U.risk(t.risk)} <span style="color:var(--txt-3);font-size:11.5px">（数据层 risk_level，正式版应由 C03 评分按阈值映射，待业务方确认）</span></div>
          ${undet(t).length ? `<div style="color:#ffd07a">本次判定有 ${undet(t).length} 项不可判定：${undet(t).join('、')}
            <span style="color:var(--txt-3)">（无判据可依，未计入违规，也不作合规）</span></div>` : ''}
          <div style="color:var(--txt-3)">依据：C01 计划匹配 + C02 空域规则 + C03 五因子风险评分</div>
          <div style="color:var(--txt-3)">判定引擎版本：rule-engine v0.3 · 评分模型 ${C03.ver}（Demo，参数待业务方确认）</div>
        </div></div>
        ${j.gated && t.legal === '非法' ? (function () {
        const c = M.cases.find(x => x.targetId === t.id);
        return `<div class="warnbox" style="margin-top:10px;border-color:rgba(255,77,94,.5);background:rgba(255,77,94,.10)">
          ⚠ <b>证据不足</b>：本次「非法」判定的唯一支撑是 C01 身份不匹配，但判定时刻<b>无 uavSN 数据源</b>
          （需协议破解 dcd / RemoteID rid 设备上报）。身份匹配只能依据时间窗 + 空间范围，
          <b>不足以定性为非法</b>；按 §10.4「结论一律向待确认收敛」应判「待确认」。
          ${j.reqMiss.length ? `<div style="margin-top:6px">表10-4 结论依据缺 ${j.reqMiss.length} 项：${j.reqMiss.map(r => r.n).join('、')}</div>` : ''}
          ${c ? `<div style="margin-top:6px;color:#ff9aa4">该目标已立案 <span class="mono">${c.id}</span>（${c.status}）——
            降级后须在<b>处置处罚管理</b>同步复核该案件，否则会出现「案件在办、判定已降级」的矛盾。</div>` : ''}
          <div style="margin-top:8px"><button class="btn danger" data-lg="degrade">按证据不足降级为「待确认」</button></div>
        </div>`;
      })() : ''}`)}
      ${reviewSect(t)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn" style="justify-content:center" data-lg="confirm">人工确认</button>
        <button class="btn warn" style="justify-content:center" data-lg="revise">人工改判</button>
        <button class="btn warn" style="justify-content:center" data-lg="reject">判定误报</button>
        <button class="btn danger" style="justify-content:center" data-lg="case">转处置立案</button>
      </div>`;
  }

  function detail() {
    const t = st.sel;
    if (!t) return '<div class="empty">请选择目标</div>';
    const stEl = document.getElementById('lgSt');
    if (stEl) stEl.innerHTML = U.legal(t.legal) + ' ' + U.risk(t.risk)
      + (manualRevised(t) ? ' <span class="tag t-purple">人工改判</span>' : '');
    const j = judge(t);
    const manual = manualRevised(t);
    const autoDeg = !manual && engineDegraded(t);
    const ic = s => s === 'pass'
      ? '<span style="color:#2fd06e">✓</span>'
      : s === 'warn' ? '<span style="color:#ffb020">!</span>' : '<span style="color:#ff4d5e">✕</span>';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <b class="mono" style="font-size:14px">${t.id}</b>
      </div>
      ${U.verdictHtml(t)}
      <div style="font-size:13.5px;color:var(--txt-2);margin:14px 0 9px">判定依据</div>
      ${U.basisHtml(t)}
      ${U.sect('目标信息', U.kv([
        ['发现时间', t.time],
        ['机型', U.modelTag(t.uav_model, t.modelSource)],
        ['归属单位', t.partner],
        ['飞手', t.pilot],
        ['位置', `<span class="mono">${t.lon.toFixed(4)}°E, ${t.lat.toFixed(4)}°N</span>`],
        ['海拔高度', t.alt + ' m'],
        ['速度', t.speed + ' m/s'],
        ['数据来源', t.source + '（置信度 ' + U.confPct(t.source_confidence) + '）']
      ]))}
      ${U.sect('规则判定过程' + (manual ? ' <span class="tag t-purple">当前结果已人工改判</span>'
        : autoDeg ? ' <span class="tag t-amber">当前结果已自动收敛</span>' : ''), `
        <div style="display:flex;flex-direction:column;gap:7px">
          ${j.items.map(i => `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12.5px;
            border-left:2px solid ${i.s === 'pass' ? '#2fd06e' : i.s === 'warn' ? '#ffb020' : '#ff4d5e'};padding-left:8px">
            <span style="width:14px">${ic(i.s)}</span>
            <div style="flex:1"><div><b>${i.r.id}</b> ${i.r.n} ${i.badge || ''}</div>
              <div style="color:var(--txt-3)">${i.msg}</div></div>
          </div>`).join('')}
        </div>`)}
      ${spaceSect(t, j)}
      ${reqSect(t, j)}
      ${reviewSect(t)}
      <div style="margin-top:12px">
        ${t.legal === '待确认'
          ? '<button class="btn pri" style="width:100%;height:38px;justify-content:center" data-lg="confirm">人工确认</button>'
          : ['合法', '非法'].includes(t.legal)
            ? '<button class="btn warn" style="width:100%;height:38px;justify-content:center" data-lg="revise">人工改判</button>'
            : ''}
      </div>`;
  }

  function drawRing() {
    const el = document.getElementById('lgScore');
    if (!el || !st.sel) return;
    const j = judge(st.sel);
    // 风险评分：高 = 风险高，配色与合规分相反
    CH.ring(el, { value: j.score, color: j.score >= 67 ? '#ff4d5e' : j.score >= 34 ? '#ffb020' : '#2fd06e', fs: 16, fmt: v => v });
  }

  function paint() {
    const k = document.getElementById('lgKpi'); if (k) k.innerHTML = kpiHtml();
    const n = document.getElementById('lgEvidN'); if (n) n.textContent = autoDegraded().length + gatedList().length;
    document.getElementById('lgList').innerHTML = list();
    document.getElementById('lgDetail').innerHTML = detail();
    drawRing();
    drawDetailMap();
  }
  /* 判定被真实改变后的全量刷新：KPI / 列表 / 详情 / 评分环 */
  function refresh() { paint(); }

  function mount(view) {
    const drift = enumDrift();
    if (drift.stale.length || drift.missing.length) {
      console.warn('[legality] 违规原因枚举与 MOCK.VIOLATIONS 不一致 —— 本页已失效的键:',
        drift.stale, '；未覆盖的新枚举值:', drift.missing);
    }
    if (drift.truncated) {
      console.warn('[legality] Schema 契约字段 violation_reasons 被截断：' + drift.truncated
        + ' 个目标的 violation_reasons 条数少于 violations，样例 '
        + (drift.truncatedSample ? drift.truncatedSample.id : ''));
    }
    paint();

    U.on(view, '[data-row]', 'click', (e, el) => {
      st.sel = M.todayTargets.find(t => t.id === el.dataset.row) || st.sel;
      U.selectRow(document.getElementById('lgList'), el.dataset.row);
      document.getElementById('lgDetail').innerHTML = detail();
      drawRing();
      drawDetailMap();
    });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { st.page = +el.dataset.pg; paint(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { st.size = parseInt(el.value); st.page = 1; paint(); });
    U.on(view, '[data-f]', 'change', (e, el) => { st[el.dataset.f] = el.value; st.page = 1; paint(); });
    U.on(view, '[data-lg]', 'click', (e, el) => {
      const k = el.dataset.lg;
      if (!st.sel) return;
      if (k === 'confirm') decisionConfirmModal();
      else if (k === 'revise') manualReviseModal();
      else if (k === 'degrade') {
        const t = st.sel;
        if (t.legal !== '非法') { U.toast('该目标当前判定已非「非法」，无需重复降级', 'ok'); return; }
        const c = M.cases.find(x => x.targetId === t.id);
        const rsn = '证据不足降级：判定时刻无 uavSN 数据源（需协议破解 dcd / RemoteID rid 设备），身份匹配仅能依据时间窗 + 空间范围，不足以定性为非法'
          + (c ? '。该目标已立案 ' + c.id + '，须在处置处罚管理同步复核案件' : '');
        const from = applyReview(t, '待确认', rsn, '证据不足降级');
        const req = c ? raiseReviewRequest(t, c, from, '待确认', rsn, OPER) : null;
        refresh();
        U.toast('已按证据不足降级为「待确认」，原判定「非法」保留可查'
          + (req ? `；已对案件 ${c.id} 发起复核请求 <b>${req.id}</b>` : ''), 'ok');
      }
    });
    document.getElementById('lgRecalc').onclick = () => {
      const all = targets();
      const kept = all.filter(revised).length;
      refresh();
      U.toast(`已按当前规则重新判定今日 ${all.length} 个目标`
        + (kept ? `；其中 ${kept} 个已人工改判的结果<b>不被引擎覆盖</b>（设计 8.6）` : ''), 'ok');
    };
    document.getElementById('lgRule').onclick = () => U.modal({
      title: '规则显示', width: '760px',
      body: `${(function () {
        const d = enumDrift();
        return (d.stale.length || d.missing.length)
          ? `<div class="warnbox" style="border-color:rgba(255,77,94,.5);background:rgba(255,77,94,.10)">
              ⚠ <b>枚举漂移</b>：本页的违规原因常量与 <span class="mono">MOCK.VIOLATIONS</span> 不一致，判定结果可能失真。
              ${d.stale.length ? `<br>本页已失效的键：<span class="mono">${d.stale.join('、')}</span>` : ''}
              ${d.missing.length ? `<br>数据层新增、本页严重度表未覆盖：<span class="mono">${d.missing.join('、')}</span>（严重度按 0 计）` : ''}
            </div>` : '';
      })()}
      ${(function () {
        const d = enumDrift();
        return d.truncated
          ? `<div class="warnbox">⚠ <b>数据层重新出现内部违规副本</b>：<b>${d.truncated}</b> 个目标带有
              <span class="mono">violations</span> 字段${d.truncatedSample ? `（样例 <span class="mono">${d.truncatedSample.id}</span>）` : ''}。
              Schema 契约字段是 <span class="mono">violation_reasons</span>，一旦两者并存就会重现「页面读内部字段显示正确、
              正式 Adapter 读契约字段拿到截断值」的问题。请收敛回单一字段。</div>` : '';
      })()}
        <div class="warnbox">规则为 Demo 缺省参数，<b>正式阈值由业务方确认</b>（纪要 §10 C01–C03）。修改后立即生效并记录版本。<br>
        C01 的身份核验依赖 <span class="mono">uav_sn</span> 数据源（协议破解 dcd / RemoteID rid）；
        <b>数据源缺失时自动降级为时间窗 + 空间范围匹配，且不得输出「身份不匹配」定性</b>（B9）。</div>
        ${U.table([
        { t: '规则编号', k: 'id', w: '86px' }, { t: '规则名称', k: 'n', w: '170px' }, { t: '说明', k: 'd' },
        { t: '关键参数', w: '250px', render: r => `<span class="mono" style="font-size:11.5px">${{
          'C01': '时间窗±10min / 空间500m / uavSN 实名核验（需 dcd·rid）',
          'C02-1': '禁飞空域缓冲 0m',
          'C02-2': '限高容差 +10m',
          'C02-3': '走廊宽度与容差【待确认：业务方】· 需管服平台 routes 几何数据，未接入前本项不可判定',
          'C02-4': '超时容差 5min',
          'C02-5': '夜间管制时段 ' + C02P.nightFrom + ':00–0' + C02P.nightTo + ':00【待确认：业务方】',
          'C02-6': '目视视距 ' + C02P.vlosM + 'm，依赖 pilot_position【待确认：业务方】',
          'C03': C03.ver + ' 五因子加权：违规' + C03.w.violation + ' / 类别' + C03.w.category
            + ' / 区域' + C03.w.region + ' / 轨迹' + C03.w.track + ' / 来源' + C03.w.source
            + '；未证实违规按 ' + C03.unproven + ' 半权【Demo 假设】'
            + '；证据质量门槛 source_confidence ≥ ' + C03.confMin + '【待确认：业务方】'
            + '；非法需表10-4 四要件齐备，否则收敛至待确认'
        }[r.id]}</span>` },
        { t: '状态', w: '76px', render: () => U.tag('启用', 't-green') }
      ], RULES)}`,
      /* 原来这里有个「保存」按钮：`onclick="UI.toast('规则已保存（Demo）','ok')"` —— 纯提示，连内存都不改。
         它比普通假按钮严重一档：这个弹窗配的是**判定引擎**的规则（C01/C02/C03），
         点「保存」会让人以为判定规则改了，而判定输出会进案件、进处罚文书。
         阈值改动应在参数所属的业务页就地进行并留痕，不是在一个只读的规则说明弹窗里放个假保存。 */
      footer: `<span style="flex:1;font-size:11.5px;color:var(--txt-3)">本弹窗为规则与阈值的<b>只读说明</b>；阈值调整在各参数所属页面就地进行并留痕</span>
        <button class="btn" data-close>关闭</button>`
    });
  }
  /* 离开页面时销毁地图：MapView 持有 rAF 循环与 ResizeObserver，
     不销毁会在后续页面继续跑（app.js 的 route() 会调 destroy）。 */
  function destroy() { if (detMap) { try { detMap.destroy(); } catch (e) { } detMap = null; } }
  g.PAGES = g.PAGES || {}; g.PAGES.legality = { render, mount, destroy };
})(window);
