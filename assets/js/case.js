/* =============================================================================
 * case.js —— 目标事件视图（EVT）
 *
 * 平台里同一件事被拆在四个地方：感知目标、告警、案件、证据。
 * 甲方看到的却应该是**一件事**：某个目标被发现、被研判、被告警、被处置、被归档。
 * 这一层不新造数据，只把这四者按 target_id 聚成一个视图，并给出「现在该做什么」。
 *
 * 关键约束：
 *   1) 流程节点只有一份 —— MOCK.DISPOSAL_FLOW。工作台不另立一套七环节，
 *      否则工作台说"第 4 步"、处罚页说"第 3 环"，同一件事两个进度。
 *   2) 进度是**算出来的**，不是存出来的：案件建立前看告警状态，建立后看案件环节。
 *   3) 所有推进动作都走 MOCK 的 advanceCase / pushAudit，工作台不直接改 stage。
 * ========================================================================== */
(function (g) {
  'use strict';
  const M = MOCK;
  const FLOW = M.DISPOSAL_FLOW;

  /* 演示主线目标：mock.js 已把 liveTargets[0] 固定为一起「禁飞区闯入」，
     这里只是把它记下来，不再另选一个 —— 另选就等于第二条演示主线。 */
  const MAIN = (M.liveTargets[0] || {}).id || null;

  /* ---------- 聚合 ---------- */
  function of(id) {
    if (!id) return null;
    const live = M.liveTargets.find(t => t.id === id) || null;
    const target = live || M.allTargets.find(t => t.id === id) || null;
    if (!target) return null;
    // 一个目标可能派生多条告警，取最新一条作为事件主告警
    const alarm = M.alarms.filter(a => a.targetId === id).sort((a, b) => b.ts - a.ts)[0] || null;
    const kase = M.cases.find(c => c.targetId === id) || null;
    const auth = M.authLogs.filter(a => a.targetId === id);
    const ev = evidence(id, kase, alarm);
    const ctx = { id, target, live, alarm, kase, auth, evidence: ev };
    ctx.stage = stageOf(ctx);
    ctx.blocked = (M.allTargets.find(t => t.id === id) || {}).caseBlockedBy || null;
    return ctx;
  }

  function evidence(id, kase, alarm) {
    const seen = new Set(), out = [];
    const add = list => (list || []).forEach(f => { if (!seen.has(f.id)) { seen.add(f.id); out.push(f); } });
    add(M.evidenceOf('target', id));
    if (kase) add(M.evidenceOf('case', kase.id));
    if (alarm) add(M.evidenceOf('alarm', alarm.id));
    return out.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
  }

  /* stage = 已完成的环节数（与 MOCK.caseStatusOf 同口径）
     没有案件时用告警状态定位：不是所有事件都会立案 —— 误报、核实后无需处罚的，
     在告警侧就闭环了。此前这里把「已关闭」也算成 stage 2（待核实），
     于是首页闭环条上「办结归档」恒为 0，看起来像今天一件都没办完。 */
  function stageOf(ctx) {
    if (ctx.kase) return ctx.kase.stage;
    if (!ctx.alarm) return 0;
    const s = ctx.alarm.status;
    if (s === '已关闭' || s === '误报') return FLOW.length;   // 在告警侧闭环，未进入处罚流程
    if (s === '处置中') return 3;
    if (s === '已确认') return 2;                              // 核实已完成、尚未立案
    return 1;                                                  // 新建
  }

  /* ---- 对外统一状态词 ----
     数据层有两套精确枚举：告警 新建/已确认/处置中/已关闭/误报，案件 待核实/已立案/处置中/待归档/已结案。
     它们各自都对，但摆在同一个业务界面上，一件事会同时挂着「已确认」和「待核实」两个词，
     甲方会以为是两件事。所以业务面（首页、工作台横幅、事件卡）只讲三档，
     由**同一个进度**推出来；精确枚举保留在详情与审计里，不是删掉，是分层。 */
  const PHASE = ['待核实', '待核实', '待核实', '处置中', '处置中', '处置中', '已结案'];
  function phase(ctx) {
    if (ctx.alarm && ctx.alarm.status === '误报') return '误报';   // 误报是结果，不是进度
    return PHASE[Math.min(ctx.stage, 6)];
  }

  /* 六环节的展示态：done / act / todo */
  function steps(ctx) {
    if (ctx.kase) return ctx.kase.steps;
    const s = ctx.stage;
    return FLOW.map((f, k) => ({
      n: f.n, d: f.d, owner: f.owner,
      t: k === 0 && ctx.alarm ? ctx.alarm.time
        : (k === 1 && ctx.alarm && ctx.alarm.verifiedAt) ? ctx.alarm.verifiedAt
          : (k < s ? '已完成' : '待处理'),
      done: k < s, act: k === s
    }));
  }

  /* ---- 条件环节 ----
     六环节里「反制处置」「信号干扰」是**条件环节**：不是每个案子都会发生。
     mock.js 的 rebuildCaseSteps 用 counterApplicable / jamApplicable 把它们标成「不适用」，
     判据在这里读同一组字段 —— 工作台若自己另判一次，就会出现
     「流程条写着不适用、待办却催你去做」这种自相矛盾的画面（这一版真的出现过）。 */
  function applicable(ctx, k) {
    if (!ctx.kase) return true;
    return k === 3 ? !!ctx.kase.counterApplicable : k === 4 ? !!ctx.kase.jamApplicable : true;
  }

  /* ---------- 当前待办：每个阶段只给一个主操作 ---------- */
  const TODO = [
    { k: 0, label: '触发告警', hint: '目标已判定为违规，尚未生成告警记录', btn: '触发告警' },
    { k: 1, label: '人工核实', hint: '值班员确认目标身份与违规事实，排除误报', btn: '开始核实' },
    { k: 2, label: '建立案件', hint: '违规事实与责任主体已具备，登记为处罚案件', btn: '提交立案' },
    /* 按钮字面必须与实际发生的事一致：FLOW[3] 是「反制处置」一个环节，授权与执行同属其中
       （§6.3 人在回路：先授权后执行，但记为同一环）。写成「申请反制授权」而实际把整环推完，
       用户会以为还差一步执行没做。 */
    { k: 3, label: '反制处置', hint: '§6.3 人在回路：指挥员授权后实施反制，全过程留痕并回传结果', btn: '授权并实施反制' },
    { k: 4, label: '信号干扰', hint: '需公安审批文号，仅在反制无效时启用；本案不涉及时自动跳过', btn: '申请公安授权干扰' },
    { k: 5, label: '证据归档', hint: '汇总轨迹、影像与操作记录，生成案件证据包', btn: '生成证据包并结案' }
  ];
  function todo(ctx) {
    let k = ctx.stage;
    while (k < FLOW.length && !applicable(ctx, k)) k++;   // 不适用的环节不产生待办
    if (k >= FLOW.length) return null;
    return Object.assign({}, TODO[k], { owner: FLOW[k].owner, step: FLOW[k].n });
  }

  /* ---------- 推进 ----------
     返回 {ok, msg}。所有分支都会写审计 —— 演示里"点了按钮但查不到是谁点的"是硬伤。 */
  function advance(ctx, note) {
    const r = _advance(ctx, note);
    /* 推进成功要广播：演示引导卡片据此解锁「下一步」。
       让引导去轮询 stage 也能work，但那样引导就有了第二份"什么算推进了"的判据。 */
    if (r.ok) window.dispatchEvent(new CustomEvent('evt:advance', { detail: { id: ctx.id } }));
    return r;
  }
  function _advance(ctx, note) {
    const s = ctx.stage;
    if (s >= FLOW.length) return { ok: false, msg: '该事件已完成全部环节' };

    if (s === 1) {                       // 人工核实
      if (!ctx.alarm) return { ok: false, msg: '该目标尚无告警记录' };
      ctx.alarm.status = '已确认';
      // 记下核实时刻：立案时要把它填进环节时间轴。
      // 不记的话，rebuildCaseSteps 会把已完成环节一律填成"立案那一刻"，
      // 于是时间轴上告警触发、人工核实、立案三格是同一个秒 —— 而它们本来跨了三个多小时。
      ctx.alarm.verifiedAt = M.nowStr();
      addEvidence(ctx, 1);
      M.pushAudit('目标事件工作台', '人工核实完成：' + (note || '目标与违规事实属实'), ctx.id);
      return { ok: true, msg: '核实完成，可提交立案' };
    }
    if (s === 2) {                       // 立案
      if (ctx.kase) return { ok: false, msg: '该目标已有案件 ' + ctx.kase.id };
      const c = fileCase(ctx);
      if (!c.ok) return c;
      addEvidence(ctx, 2);
      M.pushAudit('目标事件工作台', '立案：' + c.case.id + '（' + c.case.violation + '）', ctx.id);
      return { ok: true, msg: '已立案：' + c.case.id };
    }
    if (ctx.kase) {                      // 3/4/5 环节由案件推进，闸门在 MOCK
      const owner = FLOW[ctx.kase.stage].owner;
      const r = M.advanceCase(ctx.kase, owner);
      if (!r.ok) return { ok: false, msg: r.reason };
      if (ctx.kase.stage === 4) authorize(ctx);           // 反制完成时补一条授权记录
      addEvidence(ctx, ctx.kase.stage - 1);
      M.pushAudit('目标事件工作台', '推进环节：' + r.step + (note ? '（' + note + '）' : ''), ctx.kase.id);
      // 紧跟其后的不适用环节直接跨过：停在「不适用」上等人点，只会得到一个点不动的按钮
      const skipped = [];
      while (ctx.kase.stage < FLOW.length && !applicable(ctx, ctx.kase.stage)) {
        const nm = FLOW[ctx.kase.stage].n;
        const rr = M.advanceCase(ctx.kase, FLOW[ctx.kase.stage].owner);
        if (!rr.ok) break;
        skipped.push(nm);
        M.pushAudit('目标事件工作台', '环节不适用，自动跳过：' + nm, ctx.kase.id);
      }
      return { ok: true, msg: r.step + ' 已完成' + (skipped.length ? '（' + skipped.join('、') + ' 本案不适用，已跳过）' : '') };
    }
    return { ok: false, msg: '当前环节需先建立案件' };
  }

  /* ---------- 立案 ----------
     案件对象结构与 mock.js buildCases 一致；立案快照必须记录**当时**的判定，
     后续复核推翻判定时才看得出"当初凭什么立的案"。 */
  function fileCase(ctx) {
    const t = ctx.target;
    if (t.type !== '无人机') return { ok: false, msg: '非无人机目标不进入处罚流程（§4.2 走空间安全风险线）' };
    if (t.legal !== '非法') return { ok: false, msg: '目标未判定为非法，不能立案' };
    const src = M.allTargets.find(x => x.id === t.id) || t;
    const seq = M.cases.length + 1;
    const no = 'CF2026' + t.date.slice(5).replace('-', '') + String(seq % 999).padStart(3, '0');
    const c = {
      id: no, targetId: t.id, idLineage: null, ymd: t.ymd, date: t.date, time: t.time, ts: t.ts,
      model: t.model, partner: src.partner, pilot: src.pilot,
      violation: t.violation, district: t.district, stage: 3, status: '已立案',
      fine: (M.FINE || {})[t.violation] || 2000, penalty: '罚款',
      rcSn: 'RC2026' + String(seq).padStart(6, '0'),
      docNo: no + '-01', docReady: true,
      evidence: ctx.evidence.length, officer: (M.currentUser || {}).name || '系统管理员',
      /* 条件环节是**案情事实**，立案时就要定下来，不能由 stage 反推：
         本案为禁飞区闯入，需实施反制；不涉及公安信号干扰（那要另走公安授权）。 */
      counterApplicable: true, jamApplicable: false,
      filingSnapshot: {
        at: M.nowStr(), legal_status: t.legal,
        violation_reasons: (t.violation_reasons || []).slice(),
        track_status: t.facts && t.facts.trackStatus, risk_level: t.risk,
        source_type: t.source, confidence: t.facts && t.facts.sourceConfidence,
        model: t.model, model_source: t.modelSource,
        subject: src.partner, subject_source: src.subjectSource,
        basis: 'C02 认定 ' + (t.violation_reasons || []).join('、') + '；C03 证据充分'
      },
      createdInDemo: true
    };
    M.rebuildCaseSteps(c, t.ts);
    // 告警触发与人工核实是**已经发生过的**事实，时间取自它们自己的记录，不是立案时刻
    if (ctx.alarm) {
      c.steps[0].t = ctx.alarm.time;
      if (ctx.alarm.verifiedAt) c.steps[1].t = ctx.alarm.verifiedAt;
    }
    M.cases.push(c);
    ctx.kase = c;
    // 立案后目标不再挂在「待认定/待补证」清单上
    if (src.caseBlockedBy) delete src.caseBlockedBy;
    return { ok: true, case: c };
  }

  /* ---------- 流程产出的证据 ----------
     核实调了光电、立案存了轨迹、反制留了报文、结案出了文书 —— 这些不是"为了好看补的"，
     是这几个环节本来就会产生的材料。演示走完却拿不出材料，证据归档那一页就是空的。

     留存策略不在这里重写一份：按 kind 从台账里找一条同类记录当模板抄留存字段，
     policy 的唯一来源仍是 mock.js 的 EVID_RETAIN。 */
  const EVID_BY_STEP = {
    1: { kind: '光电抓拍图', why: '值班员核实时调取的光电抓拍' },
    2: { kind: '雷达轨迹快照', why: '立案时固化的雷达航迹' },
    3: { kind: '指令报文与回执', why: '反制指令下发与设备回执' },
    5: { kind: '处罚文书', why: '结案时制作的处罚文书' }
  };
  function addEvidence(ctx, step) {
    const spec = EVID_BY_STEP[step];
    if (!spec) return;
    const tpl = M.evidenceFiles.find(f => f.kind === spec.kind);
    if (!tpl) return;
    const at = M.now();
    const stamp = M.util.fmtDT(at);
    const seq = M.evidenceFiles.length + 1;
    const until = new Date(at.getTime());
    if (tpl.retainDays) until.setDate(until.getDate() + tpl.retainDays);
    else until.setFullYear(until.getFullYear() + tpl.retainYears);
    const refs = [{ kind: 'target', id: ctx.id }];
    if (ctx.kase) refs.push({ kind: 'case', id: ctx.kase.id });
    if (ctx.alarm) refs.push({ kind: 'alarm', id: ctx.alarm.id });
    M.evidenceFiles.push({
      id: 'EV' + String(M.CONF.demoTime.getFullYear()) + M.util.p3(seq) + 'D',
      name: spec.kind + '_' + (ctx.kase ? ctx.kase.id : ctx.id) + '.' + tpl.ext,
      kind: spec.kind, ext: tpl.ext,
      sizeMB: tpl.sizeMB, srcKind: tpl.srcKind, srcId: tpl.srcId, srcName: tpl.srcName,
      srcModule: '目标事件工作台', originAction: spec.why,
      capturedAt: stamp, ingestAt: stamp, refs,
      hashAlgo: 'SHA-256', hash: tpl.hash, verifyAt: stamp, verifyState: '完好', verifyNote: '',
      retainYears: tpl.retainYears, retainDays: tpl.retainDays,
      retainLabel: tpl.retainLabel, retainWhy: tpl.retainWhy,
      retainUntil: M.util.fmtD(until), legalHold: true, status: '在库',
      storage: '主存储 + 异地备份', accessCount: 0, lastAccessAt: stamp,
      retainLeftDays: Math.round((until - at) / 864e5), demo: true
    });
  }

  /* 反制完成时补授权记录：没有授权记录的反制在审计上是不成立的 */
  function authorize(ctx) {
    if (!ctx.kase) return;
    if (M.authLogs.some(a => a.caseId === ctx.kase.id && a.demo)) return;
    const t0 = M.now();
    M.authLogs.push({
      id: 'AUTH' + (2026 + M.authLogs.length), caseId: ctx.kase.id, targetId: ctx.id,
      type: '反制处置', unit: '东营市低空安全管理中心',
      approver: '张建国', operator: (M.currentUser || {}).name || '系统管理员',
      device: '反制-012', band: '2.4GHz / 5.8GHz', range: '1500 m 扇区 60°',
      durationS: 90, start: M.util.fmtDT(t0), end: M.util.fmtDT(new Date(t0.getTime() + 90000)),
      result: '返航', ack: '已回执', audit: '完整', estop: '未触发', demo: true
    });
  }

  /* ---------- 首页重点事件 ----------
     只给最该看的几条：演示主线固定在第一位，其余按风险与状态排。
     "重点"不等于"最新" —— 按时间排会把一条已关闭的低风险排到高风险前面。 */
  function focus(n) {
    const rank = a => (a.level === '高' ? 0 : a.level === '中' ? 1 : 2) * 10
      + (a.status === '新建' ? 0 : a.status === '已确认' ? 1 : a.status === '处置中' ? 2 : 5);
    const seen = new Set(), out = [];
    const push = a => { if (a && !seen.has(a.targetId)) { seen.add(a.targetId); out.push(a); } };
    push(M.todayAlarms.find(a => a.targetId === MAIN));
    M.todayAlarms.slice().sort((a, b) => rank(a) - rank(b) || b.ts - a.ts).forEach(push);
    return out.slice(0, n || 4);
  }

  /* ---------- 今日闭环计数 ----------
     不读 M.todayStats：那是模块求值时算好的**快照**，演示里核实完、立案完、结案完，
     首页数字纹丝不动 —— 而"数字真的会变"正是这套演示最有说服力的一点。
     计数按目标去重后走同一个 phase()，与事件卡上显示的状态词同源；
     分别数告警条数和案件件数会得出两个都对但对不上的数。 */
  function counts() {
    const air = M.todayTargets.filter(t => t.type !== '遥控器');
    const ids = [...new Set(M.todayAlarms.map(a => a.targetId))];
    const ph = ids.map(id => { const c = of(id); return c ? phase(c) : '待核实'; });
    const n = p => ph.filter(x => x === p).length;
    return {
      found: air.length,
      uav: air.filter(t => t.type === '无人机').length,
      judged: air.filter(t => t.legal !== '待确认').length,
      illegal: air.filter(t => t.legal === '非法').length,
      abnormal: air.filter(t => t.legal === '异常').length,
      alarmed: ids.length,
      high: M.todayAlarms.filter(a => a.level === '高').length,
      pending: n('待核实'), disposing: n('处置中'), closed: n('已结案'), misreport: n('误报'),
      cases: M.cases.filter(c => c.ymd === M.util.ymd(M.CONF.demoTime)).length
    };
  }

  /* 今日业务闭环：发现 → 研判 → 告警 → 处置 → 结案 */
  function loop() {
    const c = counts();
    return [
      { n: '发现目标', v: c.found, s: '空中目标（含无人机 ' + c.uav + '）' },
      { n: '完成研判', v: c.judged, s: '非法 ' + c.illegal + ' · 异常 ' + c.abnormal },
      { n: '触发告警', v: c.alarmed, s: '高风险 ' + c.high + ' 起' },
      { n: '正在处置', v: c.disposing, s: '待核实 ' + c.pending + ' 起' },
      { n: '办结归档', v: c.closed, s: '今日立案 ' + c.cases + ' 件' }
    ];
  }

  g.EVT = { MAIN, FLOW, of, steps, todo, advance, focus, loop, fileCase, phase, counts, TODO };
})(window);
