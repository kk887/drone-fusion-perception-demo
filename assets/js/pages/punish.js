/* ===== 9. 处置处罚管理（含反制与公安授权信号干扰） ===== */
(function (g) {
  const M = MOCK, U = UI;
  let st = { page: 1, size: 10, status: '全部状态', region: '全部区域', vio: '全部类型', partner: '全部合作方', days: 30, sel: null, tab: 'case', rvFilter: '全部案件' };
  let map = null;
  let pageView = null, previousViewOverflow = '';

  /* 处罚页现在只承担“通知处罚部门”这一个动作。
     不再把原办案流程状态映射成列表状态，避免同一列同时出现两套语义。 */
  const NOTICE_KEY = 'punish.notice.v1';
  let noticed = {};
  try { noticed = JSON.parse(sessionStorage.getItem(NOTICE_KEY) || '{}') || {}; } catch (e) { noticed = {}; }
  const noticeStatus = c => noticed[c.id] || (c.status === '已结案' ? '已通知' : '待通知');
  function saveNotice() {
    try { sessionStorage.setItem(NOTICE_KEY, JSON.stringify(noticed)); } catch (e) { }
  }

  /* =========================================================================
   * 定性依据复核（设计 §11 案件复核流程）
   *
   * 规则引擎的证据充分性门禁会把「证据不足却被判非法」的目标降级为待确认。
   * 但若该目标**已经立案**，判定页不能单方面改案件状态（已结案的尤其属越权），
   * 所以数据层改为产出复核请求 `MOCK.reviewRequests`，由本页按 §11 流程办理。
   *
   * 已立案案件是历史事实：`case.filingSnapshot` 保存立案时的判定快照，
   * 不因后续重新判定而消失。复核界面必须同时看到「立案时判定」与「当前判定」，
   * 让人看出差异到底在哪一项。
   * ====================================================================== */
  const RV_RESULTS = [
    { k: '维持原定性', desc: '复核后认为立案定性成立，案件按原流程继续', c: 't-green' },
    { k: '撤销案件', desc: '定性依据不成立，案件退回待核实重新走流程', c: 't-red' },
    { k: '补充证据后重判', desc: '证据要件不齐，退回已立案环节补证后重新判定', c: 't-amber' }
  ];
  const RV_KEY = 'punish.review.v1';
  let rvOutcome = {};        // 请求编号 → { result, by, at, opinion, approvalNo }
  let rvCaseOps = {};        // 案件编号 → { status, stage, docReady, note }  复核造成的案件变更

  function rvSave() {
    try { sessionStorage.setItem(RV_KEY, JSON.stringify({ rvOutcome, rvCaseOps })); } catch (e) { }
  }
  (function rvRestore() {
    try {
      const v = JSON.parse(sessionStorage.getItem(RV_KEY) || 'null');
      if (!v) return;
      rvOutcome = v.rvOutcome || {}; rvCaseOps = v.rvCaseOps || {};
      // MOCK 每次刷新重建,复核造成的案件状态变更要还原
      Object.keys(rvCaseOps).forEach(id => {
        const c = M.cases.find(x => x.id === id); if (!c) return;
        const o = rvCaseOps[id];
        // 数据层重建后案件编号可能被复用到别的目标上,校验目标一致再还原,
        // 否则会把上一份数据的复核结果套到无关案件上
        if (o.targetId && o.targetId !== c.targetId) { delete rvCaseOps[id]; return; }
        /* 这里是从本地缓存**还原**上次会话的复核结果，不是一次新的回退动作。
           所以不能调 setCaseStage —— 它会写 restageLog 与审计，
           于是每刷新一次页面就多一条"案件回退"审计记录，而现实中什么都没发生。
           只重建 steps 与状态（rebuildCaseSteps 内部会派生 status）。 */
        c.stage = o.stage; c.docReady = o.docReady;
        M.rebuildCaseSteps(c);
      });
      M.reviewRequests.forEach(r => { if (rvOutcome[r.id]) r.status = '已办结'; });
    } catch (e) { }
  })();

  /* 本页职责边界：DISPOSAL_FLOW 六环节**横跨三个模块**，处罚页只负责其中两环。
     用户原话「因为是反制完到处置嘛，所以处置就不需要这么多流程了」——
     问题不是"画得太多"，是**"管得太宽"**：案件走到本页时 1/2/4/5 已经在别的模块发生过，
     本页却还能点按钮把它推过「反制处置」「信号干扰」，产生自己没做过的事实。 */
  const MY_MODULE = '处置处罚管理';
  const mine = st => st.owner === MY_MODULE;

  /* 复核回退（撤销案件 / 补充证据后重判）走数据层的 M.setCaseStage —— 
     本页原先有一份 restage()，它是"第二个知道 steps 怎么构造的地方"，当时标为已知欠账；
     数据层补上入口后已删除。现在 steps 只有 M.rebuildCaseSteps 一处构造。
     setCaseStage(c, stage, reason, byModule)：理由必填（进审计）、不得用于前进、
     目标环节与当前相同会被拒；留痕写 c.restageLog[] 并自动写 M.auditLogs。 */

  /* 立案时判定 vs 当前判定 —— 差异只认定性/违规事由/风险等级三项，
     置信度会随融合权重调整而变(F0210)，展示但不计为定性差异。 */
  function judgeDiff(c) {
    const t = M.allTargets.find(x => x.id === c.targetId || x.target_id === c.targetId);
    const snap = c.filingSnapshot || {};
    if (!t) return { lost: true, snap, items: [] };
    const cur = {
      legal: t.legal_status || t.legal,
      vio: ((t.violation_reasons || []).join('、')) || t.violation || '',
      risk: t.risk_level || t.risk,
      /* A5 并存期陷阱:conf 是 0~100 的百分数,source_confidence 是 0~1 的比值,
         filingSnapshot.confidence 取的是 conf。直接比会显示成「96% vs 0.96%」,
         这里统一归一到百分数再比。 */
      conf: t.source_confidence          // 0~1（Target Schema V1），展示统一走 U.confPct
    };
    const sv = (snap.violation_reasons || []).join('、');
    const items = [];
    if (snap.legal_status !== cur.legal) items.push(['定性', snap.legal_status, cur.legal]);
    if (sv !== cur.vio) items.push(['违规事由', sv || '—', cur.vio || '—']);
    if (snap.risk_level !== cur.risk) items.push(['风险等级', snap.risk_level, cur.risk]);
    return { lost: false, snap, cur, items, legalChanged: snap.legal_status !== cur.legal };
  }
  const rvPending = () => M.reviewRequests.filter(r => r.status !== '已办结');
  const rvMismatch = () => M.cases.filter(c => judgeDiff(c).items.length);

  /* 复核动作写平台操作审计（用户与权限页的操作审计能看到） */
  function rvAudit(action, target, by, result) {
    M.auditLogs.unshift({
      id: 'AU' + M.util.p3(M.auditLogs.length + 1), time: M.util.fmtDT(M.CONF.demoTime),
      user: by, role: '处置授权人', module: '处置处罚管理', action, target,
      result: result || '成功', ip: '10.20.5.15', term: '终端-01'
    });
  }

  /* 机型与主体的「值 + 来源」现在成对存在 filingSnapshot 里（数据层已按此调整），
     直接读快照即可 —— 不再反查目标：案件是历史事实，从活数据取来源会出现
     「旧值配新标记」。 */
  const snapOf = c => c.filingSnapshot || {};

  /* ---- COM-03 参数总览登记（模块加载时执行，不放 mount：没访问过本页也要出现在总览上）----
     罚则档位标 confirmed:false 是有意的：法规给的是**罚款区间**，不是逐项定额，
     当前每类违规对应哪一档是我们按严重度自排的。标 true 等于声称有文件依据 —— 没有。 */
  U.regParams({
    key: 'PUNISH_FINE', name: '罚则金额档位', page: '处置处罚管理', hash: '#/punish',
    ver: 'demo-v1', confirmed: false, owner: '法制 / 业务方',
    basis: '《无人驾驶航空器飞行管理暂行条例》设定的是罚款区间，非逐项定额；档位为按严重度自排',
    affects: ['案件罚款金额', '罚款金额 KPI', '《行政处罚决定书》'],
    items: () => {
      /* 优先读数据层的罚则表 M.FINE；未导出时退回从实际案件反推。
         退回时**标注取数来源**——兜底不能悄悄换来源，否则总览上是一份档位表，
         看的人无从知道它是完整的还是只覆盖了已发生的类型。 */
      const F = M.FINE;
      const used = {};
      M.cases.forEach(c => { if (c.penalty === '罚款' && used[c.violation] == null) used[c.violation] = c.fine; });
      const src = F ? F : used;
      const rows = (M.VIOLATIONS || []).map(v => ({
        n: v,
        v: src[v] != null ? U.money(src[v])
          : (F ? '—（罚则表未定义该类型）' : '—（当前无该类案件，反推不到档位）')
      }));
      rows.push({
        n: '取数来源',
        v: F ? 'MOCK.FINE（数据层罚则表，覆盖全部类型）'
          : `<span style="color:#ffd07a">从实际案件反推（MOCK.FINE 未导出）—— 仅覆盖已发生的 ${Object.keys(used).length}/${(M.VIOLATIONS || []).length} 类</span>`
      });
      return rows;
    }
  });
  U.regParams({
    key: 'PUNISH_GATE', name: '立案闸门：责任主体认定路径', page: '处置处罚管理', hash: '#/punish',
    ver: 'demo-v1', confirmed: false, owner: '法制 / 业务方',
    basis: '违法事实成立 ≠ 可立案；处罚决定书对着当事人开，主体认不出即不得具名',
    affects: ['案件是否成立', '待办案源', '文书当事人'],
    items: () => [
      { n: '认定路径①', v: '计划报备匹配' }, { n: '认定路径②', v: '实名 SN（uavSN）' },
      { n: '认定路径③', v: '遥控源定位（待现场查证）' }, { n: '认定路径④', v: '协议破解 / RemoteID' },
      { n: '机型是否作为闸门', v: '否 —— 只影响文书描述与罚则分级，不影响违法事实成立' },
      { n: '当前待办案源', v: (M.pendingSubjects || []).length + ' 条' }
    ]
  });
  U.regParams({
    key: 'PUNISH_REVIEW', name: '§11 案件复核流程参数', page: '处置处罚管理', hash: '#/punish',
    ver: 'demo-v1', confirmed: false, owner: '法制 / 业务方',
    basis: '设计 §11 案件复核流程',
    affects: ['已结案案件能否改状态', '复核结论可选项', '立案判定一致性核查'],
    items: () => [
      { n: '复核结论可选项', v: RV_RESULTS.map(x => x.k).join(' / ') },
      { n: '已结案改状态前置', v: '§11 复核审批文号 + 报批确认勾选（缺一不予提交）' },
      { n: '「维持原定性」是否需审批文号', v: '否 —— 不改动案件状态' },
      { n: '差异认定项', v: '定性 / 违规事由 / 风险等级（置信度随融合权重变，不计为定性差异）' }
    ]
  });


  /* 表头排序：排序是页面状态，只排 filtered() 的副本，不动 MOCK.cases 的数组顺序 */
  const SORT = { key: null, dir: 'asc' };
  const SORT_KEYS = {
    id: c => c.id,
    targetId: c => c.targetId,
    // 「未识别」是"没有值"而不是一个型号名，用 \uFFFF 让它在升序时恒排末尾（降序则排首）
    model: c => (c.model === '未识别' ? '\uFFFF' : c.model) + c.partner,
    violation: c => c.violation || '',
    ts: c => c.ts,
    status: c => ['待通知', '已通知'].indexOf(noticeStatus(c)),
    penalty: c => ['警告', '驱离', '罚款'].indexOf(c.penalty),
    fine: c => c.penalty === '罚款' ? c.fine : -1
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
    const from = M.CONF.demoTime.getTime() - st.days * 864e5;
    return M.cases.filter(c =>
      c.ts >= from &&
      (st.status === '全部状态' || noticeStatus(c) === st.status) &&
      (st.region === '全部区域' || c.district === st.region) &&
      (st.vio === '全部类型' || c.violation === st.vio) &&
      (st.partner === '全部合作方' || c.partner === st.partner));
  }

  function render() {
    // 跨页深链:从告警中心/合法性判定"转处置立案"跳来时直接打开对应案件
    const ctx = U.consume('punish');
    if (ctx && ctx.caseId) {
      const hit = M.cases.find(c => c.id === ctx.caseId);
      if (hit) {
        st.sel = hit;
        Object.assign(st, { status: '全部状态', region: '全部区域', vio: '全部类型', partner: '全部合作方', days: 30 });
        st.tab = 'case';                    // 深链目标是案件,不能落在别的页签上
        // 直接翻到该案件所在页:靠"翻不到就下一页"兜底要重绘 5 次图表、接近 1 秒
        const idx = sorted(filtered()).findIndex(c => c.id === hit.id);
        if (idx >= 0) st.page = Math.max(1, Math.ceil((idx + 1) / st.size));
      }
    }
    st.sel = st.sel || M.cases[0];
    const all = M.cases;
    const pendingNotice = all.filter(c => noticeStatus(c) === '待通知').length;
    const notified = all.filter(c => noticeStatus(c) === '已通知').length;
    return `<div style="height:100%;display:flex;flex-direction:column;min-height:0">
    ${U.kpis([
      {
        label: '处罚案件总数', value: U.num(all.length), color: 'blue', icon: 'gavel',
        desc: `待通知 ${pendingNotice} 件 · 已通知 ${notified} 件`
      },
      {
        label: '待通知案件', value: U.num(pendingNotice), color: 'amber', icon: 'alert',
        desc: `等待通知处罚部门 · 占比 ${U.pct(pendingNotice, all.length)}`
      },
      {
        label: '已通知案件', value: U.num(notified), color: 'green', icon: 'check',
        desc: `通知完成率 ${U.pct(notified, all.length)}`
      }
    ])}

    <div id="pnBody" style="margin-top:12px;flex:1;min-height:0"></div>
    </div>`;
  }

  /* ---- 处罚案件管理：列表 + 详情 ---- */
  function tabCase() {
    return `<div class="row" style="height:100%;min-height:0;padding-bottom:6px">
      ${U.panel({
      title: '处罚案件管理', style: 'flex:1.5', nopad: true,
      body: `<div class="toolbar">
          ${U.field('时间', U.select('days', [{ v: 7, t: '近7天' }, { v: 30, t: '近30天' }], st.days))}
          ${U.field('区域', U.select('region', ['全部区域', ...M.DISTRICTS.map(d => d.name)], st.region))}
          ${U.field('违法类型', U.select('vio', ['全部类型', ...M.VIOLATIONS], st.vio))}
          ${U.field('合作方', U.select('partner', ['全部合作方', ...M.PARTNERS.map(p => p.name)], st.partner))}
          ${U.field('通知状态', U.select('status', ['全部状态', '待通知', '已通知'], st.status))}
          <button class="btn" id="pnR">重置筛选</button>
          <span style="flex:1"></span><button class="btn" id="pnExp">${U.icon('download')} 导出</button>
        </div>
        <div id="pnList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}
      ${U.panel({
      title: '案件详情', style: 'width:560px', nopad: true,
      extra: `<span id="pnSt"></span>`,
      body: `<div id="pnDetail" style="flex:1;overflow:auto;padding:12px"></div>`
    })}
    </div>`;
  }

  /* ---- 页签二:授权审计(全宽表格,15 列有足够展开空间) ---- */
  function tabAuth() {
    const A = M.authLogs;
    const jam = A.filter(a => a.type.includes('公安'));
    const estop = A.filter(a => a.estop !== '未触发');
    const eff = A.filter(a => a.result !== '无效');
    return `<div class="row" style="height:200px;margin-bottom:12px">
      ${U.panel({
      title: '授权概览', style: 'width:430px',
      body: U.kv([
        ['授权总次数', `<b class="mono" style="font-size:15px">${A.length}</b> 次`],
        ['公安信号干扰', `<b class="mono" style="color:#ff8b95">${jam.length}</b> 次（需公安审批文号）`],
        ['反制处置', `<b class="mono" style="color:#ffb083">${A.length - jam.length}</b> 次`],
        ['处置有效率', `<b class="mono" style="color:#79e5a5">${U.pct(eff.length, A.length)}</b>（迫降/返航/退出）`],
        ['触发急停', `<b class="mono" style="color:#ffd07a">${estop.length}</b> 次`],
        ['审计完整性', `<span class="tag t-green">100% 完整</span>`]
      ])
    })}
      ${U.panel({ title: '处置结果分布', style: 'flex:1', body: `<div id="pnAuthRes" style="height:100%"></div>` })}
      ${U.panel({ title: '授权类型与联动单位', style: 'flex:1.2', body: `<div id="pnAuthUnit" style="height:100%"></div>` })}
    </div>
    ${U.panel({
      title: '反制与公安信号干扰授权记录', sub: '全过程审计（§11.1）· 不可修改、不可删除',
      style: 'height:calc(100vh - 482px);min-height:410px;margin-bottom:12px', nopad: true,
      extra: `<button class="btn" id="pnAuthExp">${U.icon('download')} 导出审计</button>
        <button class="btn danger" id="pnJam">发起公安授权信号干扰</button>`,
      body: `<div id="pnAuth" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>`
    })}`;
  }

  /* ---- 页签三:定性依据复核(设计 §11 案件复核流程) ---- */
  function tabReview() {
    const pend = rvPending(), all = M.reviewRequests;
    const closedCase = pend.filter(r => r.caseStatus === '已结案').length;
    const mm = rvMismatch();
    const gate = M.evidenceGateLog || [];
    const gateFiled = gate.filter(x => M.cases.some(c => c.targetId === x.targetId)).length;
    return `<div class="row" style="height:200px;margin-bottom:12px">
      ${U.panel({
      title: '复核概览', style: 'width:420px',
      body: U.kv([
        ['待复核请求', `<b class="mono" style="font-size:15px;color:${pend.length ? '#ff8b95' : '#79e5a5'}">${pend.length}</b> 条`
          + (all.length ? `<span style="color:var(--txt-3)">（累计 ${all.length} 条）</span>` : '')],
        ['其中已结案案件', `<b class="mono" style="color:${closedCase ? '#ff8b95' : 'var(--txt-2)'}">${closedCase}</b> 件`
          + (closedCase ? '　<span class="tag t-red">须走 §11 复核流程</span>' : '')],
        ['已办结复核', `<b class="mono">${Object.keys(rvOutcome).length}</b> 条`],
        ['立案判定一致性', mm.length
          ? `<span class="tag t-red">${mm.length} / ${M.cases.length} 件不一致</span>`
          : `<span class="tag t-green">${M.cases.length} 件全部一致</span>`],
        ['证据门禁降级', `<b class="mono">${gate.length}</b> 个目标（其中已立案 <b class="mono">${gateFiled}</b> 个）`]
      ])
    })}
      ${U.panel({
      title: '定性依据复核队列',
      sub: `设计 §11 · 受理 → 比对立案与当前判定 → 出具结论 → 真实改案件状态并写审计`,
      style: 'flex:1', nopad: true,
      body: `<div id="pnRvList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}
    </div>
    ${U.panel({
      title: '立案判定一致性核查', sub: `覆盖全部 ${M.cases.length} 件案件 · 已立案案件是历史事实，快照不因后续重新判定而消失`,
      style: 'height:calc(100vh - 482px);min-height:410px;margin-bottom:12px', nopad: true,
      extra: U.select('rvf', ['全部案件', '仅看不一致', '仅已结案'], st.rvFilter),
      body: `<div id="pnRvChk" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}`;
  }

  function rvList() {
    const rows = M.reviewRequests;
    if (!rows.length) {
      const gate = M.evidenceGateLog || [];
      const noCase = gate.filter(x => !M.cases.some(c => c.targetId === x.targetId));
      return `<div style="padding:22px 20px;color:var(--txt-2);font-size:12.5px;line-height:1.95">
        <div style="font-size:14px;color:var(--txt);margin-bottom:8px">当前无待复核请求</div>
        复核请求由证据充分性门禁产生，且<b>仅当被降级的目标已立案</b>时才需要复核 ——
        未立案的目标由判定页直接改判即可，不涉及案件状态，也就不需要走 §11。<br>
        当前证据门禁共降级 <b class="mono">${gate.length}</b> 个目标，其中 <b class="mono">${noCase.length}</b> 个未关联案件：
        <div style="margin-top:8px">${gate.length ? gate.map(x => `<div style="padding:6px 9px;border:1px solid var(--line-2);border-radius:5px;margin-bottom:6px">
            <span class="mono">${x.targetId}</span>　${U.legal(x.from)} <span style="color:var(--txt-3)">→</span> ${U.legal('待确认')}
            ${M.cases.some(c => c.targetId === x.targetId) ? U.tag('已立案', 't-red') : U.tag('未立案 · 无需复核', 't-gray')}
            <div style="color:var(--txt-3);font-size:11.5px;margin-top:3px;white-space:normal">${x.reasons.join('；')}</div>
          </div>`).join('') : '<span style="color:var(--txt-3)">门禁未降级任何目标</span>'}</div>
        <div style="color:var(--txt-3);margin-top:6px">一旦出现「已立案后被降级」的目标，请求会自动进入本队列，本页无需改动。</div>
      </div>`;
    }
    return U.table([
      { t: '请求编号', w: '76px', cls: 'num', render: r => r.id },
      { t: '提出时间', w: '92px', cls: 'num', render: r => `<div>${r.at.slice(0, 10)}</div><div>${r.at.slice(11)}</div>` },
      {
        t: '目标 / 案件', w: '140px', render: r => `<div class="mono" style="font-size:11.5px">${r.targetId}</div>
          <div class="mono" style="font-size:11.5px;color:var(--txt-3)">${r.caseId}</div>${U.tag(r.caseStatus)}`
      },
      { t: '拟改判', w: '128px', render: r => `${U.legal(r.from)} <span style="color:var(--txt-3)">→</span> ${U.legal(r.to)}` },
      { t: '降级理由', render: r => `<div style="white-space:normal;font-size:11.5px">${r.reason}</div>
          <div style="white-space:normal;font-size:11px;color:var(--txt-3);margin-top:2px">${r.raisedBy}</div>` },
      {
        t: '状态 / 结论', w: '132px', render: r => {
          const o = rvOutcome[r.id];
          return U.tag(r.status, r.status === '已办结' ? 't-green' : 't-amber') +
            (o ? `<div style="white-space:normal;font-size:11px;color:var(--txt-3);margin-top:3px">
              ${(RV_RESULTS.find(x => x.k === o.result) || {}).k || o.result}<br>${o.by} · ${o.at.slice(5, 16)}</div>` : '');
        }
      },
      { t: '操作', w: '58px', align: 'center', render: r => `<span class="lnk" data-rv="${r.id}">${rvOutcome[r.id] ? '查看' : '受理'}</span>` }
    ], rows, { rowId: r => r.id });
  }

  function rvCheck() {
    let rows = M.cases;
    if (st.rvFilter === '仅看不一致') rows = rvMismatch();
    else if (st.rvFilter === '仅已结案') rows = rows.filter(c => c.status === '已结案');
    const mm = rvMismatch();
    const head = `<div style="padding:7px 12px;font-size:12px;border-bottom:1px solid var(--line-2);
        background:${mm.length ? 'rgba(255,77,94,.08)' : 'rgba(47,208,110,.07)'};white-space:normal">
      ${mm.length
        ? `<b style="color:#ff96a0">${mm.length} 件</b>案件的立案快照与当前判定不一致，需按 §11 复核`
        : `<b style="color:#79e5a5">全部 ${M.cases.length} 件</b>案件的立案快照与当前判定一致，暂无需复核`}
      <span style="color:var(--txt-3)">　· 差异只认「定性 / 违规事由 / 风险等级」三项；置信度随融合权重调整而变（F0210），不计为定性差异</span>
    </div>`;
    return head + U.table([
      { t: '案件编号', w: '118px', cls: 'num', render: c => c.id },
      { t: '状态', w: '74px', render: c => U.tag(c.status) },
      {
        t: '立案时判定', w: '150px', render: c => {
          const d = judgeDiff(c), s2 = d.snap;
          return `<div>${U.legal(s2.legal_status)} ${(s2.violation_reasons || []).join('、')}</div>
            <div style="font-size:11px;color:var(--txt-3);white-space:normal">${s2.risk_level} · 置信 ${U.confPct(s2.confidence)} · ${(s2.at || '').slice(5, 16)}</div>`;
        }
      },
      {
        t: '当前判定', w: '150px', render: c => {
          const d = judgeDiff(c);
          if (d.lost) return `<span class="tag t-purple">目标已合并/分裂</span>`;
          return `<div>${U.legal(d.cur.legal)} ${d.cur.vio}</div>
            <div style="font-size:11px;color:var(--txt-3);white-space:normal">${d.cur.risk} · 置信 ${U.confPct(d.cur.conf)}</div>`;
        }
      },
      {
        t: '差异', render: c => {
          const d = judgeDiff(c);
          if (d.lost) return `<span style="font-size:11.5px;color:var(--txt-3);white-space:normal">目标 ID 发生过变更，见案件详情的 ID 变更回溯</span>`;
          return d.items.length
            ? `<div style="white-space:normal">${d.items.map(x => `${U.tag(x[0], 't-red')} <span style="font-size:11.5px">${x[1]} → <b>${x[2]}</b></span>`).join('<br>')}</div>`
            : '<span class="tag t-green">一致</span>';
        }
      }
    ], rows, { rowId: c => c.id, activeId: st.sel && st.sel.id });
  }

  /* ---- 页签四:待办案源(违法但尚不具备立案条件的目标) ----
     闸门在**责任主体是否有认定路径**,不在机型:机型未识别只是文书里少一个描述项,
     主体认不出来,处罚决定书对着的当事人就是错的。
     这一屏不提供"立案"入口 —— 条件不满足时没有入口,本身就是闸门的体现。 */
  let _tgt = null;
  function tgtOf(id) {
    if (!_tgt) { _tgt = new Map(); M.allTargets.forEach(t => { _tgt.set(t.id, t); if (t.target_id) _tgt.set(t.target_id, t); }); }
    return _tgt.get(id);
  }
  /* 去向口径由数据层单一声明 M.illegalDisposition 提供 —— 页面不再自行推导，
     避免"同一口径两处各算一遍"。这里只做展示与平衡校验（校验读的是它给的数，不重新派生）。 */
  function pendStat() {
    const D = M.illegalDisposition;
    const PS = M.pendingSubjects || [];
    const by = {};
    PS.forEach(p => { by[p.blockedBy] = (by[p.blockedBy] || 0) + 1; });
    if (D) return {
      illegal: D.illegalNow, filed: D.caseTotal, filedIllegal: D.filed,
      revised: D.downgraded, revisedCases: D.downgradedCases || [], pend: D.pending, by
    };
    // 数据层尚未提供时的兜底（编辑中可能短暂缺失），标记出来而不是静默换算法
    return { illegal: NaN, filed: M.cases.length, filedIllegal: NaN, revised: NaN, revisedCases: [], pend: PS.length, by, fallback: true };
  }

  function tabPend() {
    const S2 = pendStat();
    /* 用户容易把这一屏读成"已经发起处罚处置的对象"。
       案件与案源是两种东西：案件有编号 CF…、有处罚流程与文书；案源只是"违法事实成立但还立不了案"。
       所以先用一条横幅把边界说死，再给数据。 */
    return `<div class="warnbox" style="margin-bottom:12px;border-color:rgba(255,176,32,.5);line-height:1.85">
        <b>本页签的 ${(M.pendingSubjects || []).length} 条不是案件，也没有发起任何处罚处置。</b>
        它们是<b>案源</b> —— 违法事实成立、但尚不具备立案条件的目标（编号 <span class="mono">PS…</span>，
        与案件编号 <span class="mono">CF…</span> 不同一序列）。<br>
        本屏<b>不提供立案入口</b>，也不产生文书、罚款与处置流程；这些只存在于「处罚案件管理」页签的
        <b>${M.cases.length}</b> 件案件里。补齐认定路径后，由数据层重新派生为案件，届时才会出现在那一侧。
      </div>
      <div class="row" style="height:200px;margin-bottom:12px">
      ${U.panel({
      title: '违法目标去向', sub: '口径实时派生',
      style: 'width:430px',
      body: U.kv([
        ['当前判定非法', `<b class="mono" style="font-size:15px">${S2.illegal}</b> 个目标`],
        ['├ 已立案', `<b class="mono" style="color:#79e5a5">${S2.filedIllegal}</b> 件`],
        ['├ 待办案源', `<b class="mono" style="color:#ffd07a">${S2.pend}</b> 条（${Object.entries(S2.by).map(x => x[0] + ' ' + x[1]).join(' · ')}）`],
        ['└ 合计核对', S2.filedIllegal + S2.pend === S2.illegal
          ? `<span class="tag t-green inline-icon">${S2.filedIllegal} + ${S2.pend} = ${S2.illegal} ${U.icon('check')}</span>`
          : `<span class="tag t-red">${S2.filedIllegal} + ${S2.pend} ≠ ${S2.illegal}</span>`],
        ['另计', S2.revised
          ? `<b class="mono">${S2.revised}</b> 件已立案案件的目标经事实修订降级为「待确认」，已进入 §11 复核
             <div style="font-size:11px;color:var(--txt-3);white-space:normal">
               ${(S2.revisedCases || []).map(x => `${x.id}（${x.status}）立案为 ${x.filedAs} → 现 ${x.nowIs}`).join('；')}
               <br>立案是历史事实，不因今天重新判定而消失，故不计入当前非法目标</div>`
          : '—']
      ])
    })}
      ${U.panel({
      title: '为什么这些目标不立案', sub: '闸门在责任主体，不在机型', style: 'flex:1',
      body: `<div class="warnbox" style="margin-bottom:8px;line-height:1.75">
          能把一个目标绑定到具体人或单位的只有四条路：<b>计划报备匹配 / 实名 SN / 遥控源定位 / 协议破解·RemoteID</b>。
          一条都没有时<b>不得具名</b> —— 处罚决定书是对着当事人开的，主体认错了，整份文书就是错的。
          机型未识别不作为闸门：它只影响文书里的描述项与罚则分级，不影响违法事实成立。</div>
        <div style="font-size:12.5px;color:var(--txt-2);line-height:1.95">
          本屏<b>不提供立案入口</b> —— 条件不满足时没有入口，这本身就是闸门。
          补齐任一条认定路径（调证 / 现场查获 / 布控）后，由数据层重新派生为案件。<br>
          <span style="color:var(--txt-3)">「证据待补强」是另一类：主体可认定，但证据要件不足以支撑定性，需补证后再判。</span>
        </div>`
    })}
    </div>
    ${U.panel({
      title: '待办案源（未立案，非案件）', sub: `${(M.pendingSubjects || []).length} 条 · 违法事实成立但尚不具备立案条件`,
      style: 'height:calc(100vh - 482px);min-height:410px;margin-bottom:12px', nopad: true,
      extra: `<button class="btn" id="pnPendExp">${U.icon('download')} 导出待办清单</button>`,
      body: `<div id="pnPendList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}`;
  }

  function pendList() {
    const PS = M.pendingSubjects || [];
    if (!PS.length) return `<div class="empty">当前没有待办案源：全部违法目标均已具备立案条件</div>`;
    return U.table([
      {
        t: '案源编号', w: '96px', cls: 'num',
        render: p => `<span title="案源编号（PS 序列），不是案件编号（CF 序列）">${p.id}</span>`
      },
      { t: '时间', w: '92px', cls: 'num', render: p => `<div>${p.date}</div><div>${(p.time || '').slice(11)}</div>` },
      {
        t: '目标 / 区域', w: '138px', render: p => `<div class="mono" style="font-size:11.5px">${p.targetId}</div>
          <div style="font-size:11px;color:var(--txt-3)">${p.district}</div>`
      },
      { t: '违法类型', w: '100px', render: p => U.tag(p.violation, 't-orange') },
      { t: '机型', w: '146px', render: p => U.modelTag(p.model, p.modelSource, true) },
      {
        t: '来源 / 置信', w: '100px', render: p => `<div>${p.source}</div>
          <div style="font-size:11px;color:var(--txt-3)">${U.confPct(p.source_confidence)} · ${p.track_status}</div>`
      },
      { t: '阻断原因', w: '104px', render: p => U.tag(p.blockedBy, p.blockedBy === '责任主体待认定' ? 't-red' : 't-amber') },
      {
        t: '缺什么', w: '230px', render: p => `<div style="white-space:normal;font-size:11.5px">
          ${(p.missing || []).map(x => '· ' + x).join('<br>')}</div>`
      },
      { t: '下一步', render: p => `<div style="white-space:normal;font-size:11.5px;color:#ffd07a">${p.nextStep}</div>` },
      { t: '', w: '46px', align: 'center', render: p => `<span class="lnk" data-ps="${p.id}">详情</span>` }
    ], PS, { rowId: p => p.id });
  }

  function pendModal(p) {
    if (!p) return;
    const t = tgtOf(p.targetId);
    U.modal({
      title: '待办案源 · ' + p.id, width: '720px',
      body: `<div class="warnbox">本条<b>不是案件</b>：违法事实成立，但${p.blockedBy === '责任主体待认定'
        ? '责任主体没有任何认定路径，依法不得具名当事人' : '证据要件不足以支撑定性'}，
        因此未进入处罚流程，也没有处罚文书与罚款。</div>
        ${U.kv([
        ['目标编号', `<span class="mono">${p.targetId}</span>`],
        ['发生时间 / 区域', p.time + ' · ' + p.district],
        ['违法事实', (p.violation_reasons || [p.violation]).map(x => U.tag(x, 't-orange')).join(' ')],
        ['机型', U.modelTag(p.model, p.modelSource)],
        ['感知来源', `${p.source} · 置信度 ${U.confPct(p.source_confidence)} · 轨迹${p.track_status}`],
        ['主体认定路径', p.subjectSource
          ? `<span class="tag t-cyan">${p.subjectSource}</span>`
          : `<span class="tag t-red">无</span> <span style="color:var(--txt-3)">四条路径均未命中</span>`],
        ['阻断原因', U.tag(p.blockedBy, p.blockedBy === '责任主体待认定' ? 't-red' : 't-amber')]
      ])}
        ${U.sect('认定缺口', `<div style="font-size:12.5px;line-height:2">
          ${(p.missing || []).map(x => `<div class="inline-icon">${U.icon('cross')} ${x}</div>`).join('')}</div>`)}
        ${U.sect('下一步', `<div style="font-size:12.5px;color:#ffd07a">${p.nextStep}</div>
          <div style="font-size:11.5px;color:var(--txt-3);margin-top:6px;white-space:normal">
            补齐任一条认定路径后由数据层重新派生为案件；本页不提供直接立案入口 —— 条件不满足时没有入口，这本身就是闸门。</div>`)}
        ${t ? U.sect('目标当前判定', U.kv([['定性', U.legal(t.legal_status || t.legal)],
        ['风险等级', U.tag(t.risk_level || t.risk)],
        ['来源可信度', U.confPct(t.source_confidence)]])) : ''}`,
      footer: `<button class="btn" data-close>关闭</button>`
    });
  }

  function list() {
    const rows = sorted(filtered());
    const page = rows.slice((st.page - 1) * st.size, st.page * st.size);
    return U.table([
      { t: sortTh('案件编号', 'id'), k: 'id', w: '134px', cls: 'num' },
      {
        t: sortTh('目标编号', 'targetId'), w: '106px', cls: 'num',
        render: c => `<span title="${c.targetId}" style="font-size:11.5px">${c.targetId}</span>`
      },
      {
        t: sortTh('机型 / 主体', 'model'), w: '128px',
        render: c => `<div style="white-space:normal;line-height:1.4">${U.modelTag(snapOf(c).model || c.model, snapOf(c).model_source, true)}</div>
          <div title="${(snapOf(c).subject || c.partner) + ' · ' + c.pilot}" style="font-size:11px;color:var(--txt-3);
            white-space:normal;line-height:1.4;max-height:31px;overflow:hidden;display:-webkit-box;
            -webkit-line-clamp:2;-webkit-box-orient:vertical">${snapOf(c).subject || c.partner} · ${c.pilot}</div>`
      },
      {
        t: sortTh('违法类型', 'violation'), w: '84px',
        /* .tag 是 inline-block + nowrap，套在 normal 的 div 里也不会断行；
           这里让标签自身允许折行，才真正压得住这一列。 */
        render: c => `<div style="white-space:normal;line-height:1.5"><span class="tag t-orange"
          style="white-space:normal;display:inline">${c.violation}</span></div>`
      },
      { t: sortTh('发生时间 / 区域', 'ts'), w: '128px', render: c => `<div class="mono" style="font-size:11.5px">${c.time.slice(5, 16)}</div><div style="font-size:11px;color:var(--txt-3)">${c.district}</div>` },
      { t: sortTh('通知状态', 'status'), w: '86px', render: c =>
        U.tag(noticeStatus(c), noticeStatus(c) === '待通知' ? 't-amber' : 't-green') },
    ], page, { rowId: c => c.id, activeId: st.sel && st.sel.id })
      + U.pager({ total: rows.length, page: st.page, size: st.size });
  }

  function detail() {
    const c = st.sel;
    if (!c) return '<div class="empty">请选择案件</div>';
    document.getElementById('pnSt').innerHTML = U.tag(c.status);
    const t = M.allTargets.find(x => x.id === c.targetId) || {};
    const auth = M.authLogs.find(a => a.caseId === c.id);
    /* 「当前该做什么」要在最前面。原来详情从「案件流程」六格开始，
       读完六格才知道卡在哪一环，而值班员打开这一页就是来找那一个动作的。 */
    const ctxE = EVT.of(c.targetId);
    const td = ctxE && EVT.todo(ctxE);
    return `${U.detailHero({
      icon: 'gavel', subtitle: '处置处罚案件', title: t.subtype || t.type || '低空安全案件', id: c.id,
      tags: [U.tag(c.status), t.legal ? U.legal(t.legal) : ''],
      meta: [['目标', c.targetId], ['区域', c.district || t.district || '—']]
    })}
      ${td ? `<div class="todo" style="margin-bottom:14px;padding:11px 14px">
        <div style="font-size:20px">▸</div>
        <div class="tl2"><b>当前待办：${td.label}</b><span>责任模块 ${td.owner}</span></div></div>`
      : `<div class="verdict ok" style="margin-bottom:14px;padding:11px 16px">
        <div class="vi" style="width:34px;height:34px;font-size:18px">${U.icon('check')}</div>
        <div class="vt"><h2 style="font-size:17px">已办结归档</h2></div></div>`}
      ${U.sect('案件流程', (function () {
      /* 六环节横跨三个模块：本页负责「立案」「结案归档」，其余四环是**别处发生的既有事实**。
         原来一律画成同一条六格步骤条，看上去像本页的进度条 —— 于是"处置就不需要这么多流程了"。
         现在按 owner 分开呈现：本页那两环标出职责，他模块那四环明写"由 XX 完成于 XX"。
         注意仍然**全部列出**，不是只留两环 —— 案件的完整经过要看得见，
         要区分的是"谁做的"，不是"该不该显示"。 */
      const rows = (c.steps || []).map((stp, i) => {
        const own = mine(stp);
        const done = stp.done;
        const col = done ? (own ? '#79e5a5' : '#8fbaff') : (stp.act ? '#ffd07a' : 'var(--txt-3)');
        return `<div style="display:flex;gap:9px;align-items:baseline;padding:5px 0;
            border-bottom:1px solid rgba(64,158,255,.08)">
            <span style="color:${col};font-size:12px;width:14px;text-align:center">${done ? U.icon('check') : stp.act ? U.icon('play') : '○'}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;color:${done ? 'var(--txt)' : 'var(--txt-3)'}">
                ${i + 1}. ${stp.n}
                ${own ? '<span class="tag t-green" style="margin-left:6px">本模块</span>'
            : `<span class="tag t-gray" style="margin-left:6px">${stp.owner}</span>`}</div>
              <div style="font-size:11px;color:var(--txt-3);line-height:1.55">
                ${done
            ? (own ? `本模块完成于 ${stp.t}` : `由${stp.owner}完成于 ${stp.t}`)
            : (stp.act ? '进行中' : '待处理')}</div>
            </div></div>`;
      }).join('');
      return rows + `<div style="margin-top:7px;font-size:11px;color:var(--txt-3);line-height:1.75">
          本页只负责<b>立案</b>与<b>结案归档</b>两环；其余环节由异常告警中心与融合感知中心执行，
          在此仅作既有事实展示，<b>不由本页产生</b>。跨模块推进会被数据层
          <span class="mono">advanceCase</span> 直接拒绝。</div>`;
    })())}
      ${c.idLineage ? U.sect('目标 ID 变更回溯（B02 · 设计 6.5）', `
        <div class="warnbox" style="margin-bottom:8px;padding:7px 9px;font-size:11.5px;line-height:1.6">
          本案引用的目标 <span class="mono">${c.targetId}</span> 在立案后发生过
          <b>${c.idLineage.op === 'merge' ? '目标合并' : '目标分裂'}</b>（${c.idLineage.at}）。
          依设计 6.5，ID 变更不得导致证据链断裂 —— 下方为<b>合并前的判定快照</b>，可还原当时的处罚依据。</div>
        ${U.kv([
        ['当前归属目标', Array.isArray(c.idLineage.currentId)
          ? c.idLineage.currentId.map(x => `<span class="mono">${x}</span>`).join('、')
          : `<span class="mono lnk" data-goto="target">${c.idLineage.currentId}</span>`],
        ['变更类型', U.tag(c.idLineage.op === 'merge' ? '合并' : '分裂', 't-purple') + ' ' + c.idLineage.note],
        ['判定依据', c.idLineage.basis],
        ['立案时判定', `${U.legal(c.idLineage.snapshot.legal_status)} ${c.idLineage.snapshot.violation || ''}
          <span style="color:var(--txt-3)">（来源 ${c.idLineage.snapshot.source} · 置信度 ${U.confPct(c.idLineage.snapshot.source_confidence)} · ${c.idLineage.snapshot.at}）</span>`],
        ['快照高度', c.idLineage.snapshot.alt + ' m']
      ])}`) : ''}
      ${U.sect('立案判定核查（§11）', cmpBlock(c) + (function () {
      const rr = M.reviewRequests.find(x => x.caseId === c.id);
      if (!rr) return '';
      return rvOutcome[rr.id] ? outcomeBox(rvOutcome[rr.id])
        : `<div style="margin-top:8px"><span class="tag t-amber">存在待复核请求 ${rr.id}</span>
           <span class="lnk" data-rv="${rr.id}" style="margin-left:8px">前往复核 ›</span></div>`;
    })())}
      ${U.sect('违法事实', U.kv([
      ['目标编号', `<span class="mono lnk" data-goto="target">${c.targetId}</span>`],
      ['违法类型', U.tag(c.violation, 't-orange')],
      ['发生时间', c.time], ['发生区域', c.district],
      ['飞行高度', (t.alt || '—') + ' m'], ['飞行速度', (t.speed || '—') + ' m/s'],
      ['机型', U.modelTag(snapOf(c).model || c.model, snapOf(c).model_source)],
      ['责任主体', `${snapOf(c).subject || c.partner}${snapOf(c).subject_source
        ? `　<span class="tag t-cyan" title="责任主体的认定路径 —— 没有路径就不得具名，只能列入待办案源">${snapOf(c).subject_source}</span>`
        : '　<span class="tag t-amber">认定路径未记录</span>'}`],
      ['认定依据', snapOf(c).basis || '空域规则 C02 + 计划匹配 C01']
    ]))}
      ${(function () {
        /* 原来按 c.evidence 这个数字画最多 4 个方块，标签写死成
           ['光电截图','雷达轨迹','视频片段','现场照片'] —— 件数与内容各来自一处：
           案件写「证据链 6 项」，画出来永远 4 个，且四个名字与真实类型无关。
           现在 c.evidence 已由 evidenceOf 派生，方块也逐份取自台账，两者同源。 */
        const fs2 = M.evidenceOf ? M.evidenceOf('case', c.id) : [];
        const bad = fs2.filter(f => f.verifyState !== '完好');
        const ICON = { '光电录像': 'video', '光电抓拍图': 'camera', '雷达轨迹快照': 'trend', '现场照片': 'image',
          '处罚文书': 'file', '指令报文与回执': 'receipt', '通报单回执': 'mail', '调测报告': 'tool' };
        if (!fs2.length) return U.sect('证据链（0 项）',
          '<div class="warnbox" style="border-color:rgba(255,77,94,.45)">本案在证据台账中无关联材料，事实认定缺少可溯源证据。</div>');
        return U.sect(`证据链（${fs2.length} 项${bad.length ? ` · <span style="color:#ff8b95">${bad.length} 份校验异常</span>` : ''}）`, `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">
          ${fs2.slice(0, 8).map(f => `<div style="height:54px;border:1px solid ${f.verifyState === '完好' ? 'var(--line)' : 'rgba(255,77,94,.5)'};
            border-radius:4px;background:linear-gradient(135deg,rgba(61,139,255,.22),rgba(4,12,32,.9));
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer"
            data-ev="${f.id}" title="${f.name}　${f.sizeMB.toFixed(1)}MB　${f.verifyState}">
            <span style="font-size:14px">${U.icon(ICON[f.kind] || 'folder')}</span>
            <span style="font-size:10px;color:var(--txt-2)">${f.kind}</span>
            ${f.verifyState === '完好' ? '' : `<span style="font-size:9px;color:#ff8b95">${f.verifyState}</span>`}
          </div>`).join('')}
        </div>
        ${fs2.length > 8 ? `<div style="font-size:11px;color:var(--txt-3);margin-bottom:6px">另有 ${fs2.length - 8} 份，点任一份可进证据台账查看全部</div>` : ''}
        <div id="pnTrack" style="height:130px;border:1px solid var(--line-2);border-radius:6px"></div>`);
      })()}
      ${(function () {
        const eff = (M.counterEffects || {})[c.targetId];
        return eff ? U.sect('反制效果评估（F0811 · A11）', U.kv([
          ['评估结论', U.tag(eff.verdict, eff.verdict === '迫降' ? 't-green' : eff.verdict === '返航' ? 't-blue' : 't-amber')],
          ['高度变化', `${eff.altBefore}m → ${eff.altAfter}m`],
          ['速度变化', `${eff.spdBefore}m/s → ${eff.spdAfter}m/s`],
          ['有效时长', eff.durationS + ' s'], ['评估时间', eff.evaluatedAt]])) : '';
      })()}
      ${U.sect('关联设备与处置', U.kv([
        ['遥控器 SN', `<span class="mono">${c.rcSn}</span>`],
        ['发现设备', (M.devices.find(d => d.region === c.district) || {}).name || '—'],
        ['处置方式', auth ? auth.type : '未启动反制'],
        ['授权编号', auth ? `<span class="mono">${auth.id}</span>` : '—'],
        ['执行结果', auth ? auth.result : '—'],
        ['回执/审计', auth ? `${auth.ack} · 审计${auth.audit}` : '—']
      ]))}
      ${U.sect('处罚文书', U.kv([
        ['文书名称', '《行政处罚决定书》'],
        ['文书编号', `<span class="mono">${c.docNo}</span>`],
        ['生成状态', c.docReady ? U.tag('已生成', 't-green') : U.tag('待生成', 't-amber')],
        ['处罚方式', c.penalty + (c.penalty === '罚款' ? '（' + U.money(c.fine) + '）' : '')],
        ...(c.penalty === '罚款' ? [['金额依据', `<span class="tag t-amber">档位表未经业务方确认</span>
          <span style="color:var(--txt-3);font-size:11.5px">法规给的是罚款区间，非逐项定额</span>
          <span class="lnk" data-goparam>参数总览 ›</span>`]] : []),
        ['承办人', c.officer]
      ]) + (function () {
        /* §8.1 第 ② 条：动作执行期间隐藏该条记录的其他操作入口，只留进行中标识与终止手段。
           干扰正在执行时给第二个操作入口，等于允许在执行中重复下发或并行推进流程 ——
           那条路径在流程设计里本不存在。 */
        const live = (M.authLogs || []).find(x => x.caseId === c.id && x.result === '执行中');
        if (live) return `
          <div style="margin-top:10px;border:1px solid rgba(255,77,94,.45);background:rgba(255,77,94,.10);
            border-radius:6px;padding:10px 12px">
            <div style="display:flex;align-items:center;gap:8px;font-size:13px">
              <span style="width:8px;height:8px;border-radius:50%;background:#ff4d5e;
                box-shadow:0 0 0 4px rgba(255,77,94,.25)"></span>
              <b style="color:#ff8b95">信号干扰中</b>
              <span class="mono" style="color:var(--txt-3);font-size:11.5px">${live.id}</span>
              <span style="flex:1"></span>
              <span style="font-size:11.5px;color:var(--txt-3)">${live.device} · ${live.durationS}s</span>
            </div>
            <div style="font-size:11.5px;color:var(--txt-3);line-height:1.8;margin-top:5px">
              审批文号 ${live.approvalNo || live.approver}　·　联动单位 ${live.unit}　·　回执 ${live.ack}<br>
              执行期间本案其他操作入口已隐藏（§8.1）—— 只保留终止与急停。
            </div>
            <div style="display:flex;gap:8px;margin-top:9px">
              <button class="btn warn" style="flex:1;justify-content:center" data-jam="stop|${live.id}">停止干扰</button>
              <button class="btn danger" style="flex:1;justify-content:center" data-jam="estop|${live.id}">${U.icon('estop')} 急停</button>
            </div>
          </div>`;
        return `<div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn" style="flex:1;justify-content:center" data-doc="prev" ${c.docReady ? '' : 'disabled'}>预览</button>
          <button class="btn" style="flex:1;justify-content:center" data-doc="down" ${c.docReady ? '' : 'disabled'}>下载</button>
          <button class="btn pri" style="flex:1;justify-content:center" data-doc="next">${c.status === '已结案' ? '归档查看' : '推进流程'}</button>
        </div>`;
      })())}`;
  }

  function authTable() {
    return U.table([
      { t: '授权编号', k: 'id', w: '140px', cls: 'num' },
      { t: '类型', w: '132px', render: a => U.tag(a.type, a.type.includes('公安') ? 't-red' : 't-orange') },
      { t: '目标', k: 'targetId', w: '128px', cls: 'num' },
      { t: '联动单位', w: '150px', render: a => a.unit.replace('东营市', '') },
      { t: '审批 / 操作人', w: '116px', render: a => `${a.approver} <span style="color:var(--txt-3)">/ ${a.operator}</span>` },
      { t: '设备', k: 'device', w: '112px' },
      /* 空频段的两种原因由 M.bandNote 区分：不适用 vs 待确认，不能混为一谈 */
      { t: '频段 / 作用范围', w: '196px', render: a => { const nt = M.bandNote(a); return `<div style="font-size:11.5px">${
        a.band ? a.band + (a.gnssJam ? ` <b style="color:var(--red)">含卫星导航</b>` : '')
               : `<span style="color:${nt.pending ? 'var(--orange)' : 'var(--txt-3)'}">${nt.txt}</span>`
      }</div><div style="font-size:11px;color:var(--txt-3)">${a.range}</div>`; } },
      { t: '时长', w: '58px', align: 'right', cls: 'num', render: a => a.durationS + 's' },
      { t: '开始时间', k: 'start', w: '142px', cls: 'num' },
      { t: '执行结果', w: '88px', render: a => U.tag(a.result, a.result === '无效' ? 't-red' : 't-green') },
      {
        t: '回执 / 急停 / 审计', w: '168px', render: a => `${U.tag(a.ack, 't-green')}
          ${U.tag(a.estop === '未触发' ? '无急停' : '急停', a.estop === '未触发' ? 't-gray' : 't-red')}
          ${U.tag(a.audit, 't-green')}`
      }
    ], M.authLogs, { rowId: a => a.id });
  }

  function noticeDetail() {
    const c = st.sel;
    if (!c) return '<div class="empty">请选择案件</div>';
    const nStatus = noticeStatus(c);
    const t = M.allTargets.find(x => x.id === c.targetId) || {};
    const auth = M.authLogs.find(a => a.caseId === c.id);
    const caseNo = M.cases.findIndex(x => x.id === c.id) + 1;
    const authNo = auth ? auth.id
      : `AUTH${String(c.date || '').slice(0, 7).replace(/-/g, '')}${M.util.p3(caseNo)}`;
    const device = (M.devices.find(d => d.region === c.district) || {}).name || '东营区雷达03号';
    const fs2 = M.evidenceOf ? M.evidenceOf('case', c.id) : [];
    const ICON = { '光电录像': 'video', '光电抓拍图': 'camera', '雷达轨迹快照': 'trend', '现场照片': 'image',
      '处罚文书': 'file', '指令报文与回执': 'receipt', '通报单回执': 'mail', '调测报告': 'tool' };
    const evidence = !fs2.length
      ? '<div class="warnbox" style="border-color:rgba(255,77,94,.45)">本案在证据台账中无关联材料，事实认定缺少可溯源证据。</div>'
      : `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">
          ${fs2.slice(0, 8).map(f => `<div style="height:54px;border:1px solid var(--line);
            border-radius:4px;background:linear-gradient(135deg,rgba(61,139,255,.22),rgba(4,12,32,.9));
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer"
            data-ev="${f.id}" title="${f.name}　${f.sizeMB.toFixed(1)}MB">
            <span style="font-size:14px">${U.icon(ICON[f.kind] || 'folder')}</span>
            <span style="font-size:10px;color:var(--txt-2)">${f.kind}</span>
          </div>`).join('')}
        </div>
        ${fs2.length > 8 ? `<div style="font-size:11px;color:var(--txt-3);margin-bottom:6px">另有 ${fs2.length - 8} 份，点任一份可进证据台账查看全部</div>` : ''}
        <div id="pnTrack" style="height:130px;border:1px solid var(--line-2);border-radius:6px"></div>`;

    document.getElementById('pnSt').innerHTML =
      U.tag(nStatus, nStatus === '待通知' ? 't-amber' : 't-green');
    return `${U.detailHero({
      icon: 'gavel', subtitle: '处置处罚案件', title: snapOf(c).model || c.model || t.subtype || '低空安全案件', id: c.id,
      tags: [U.tag(nStatus, nStatus === '待通知' ? 't-amber' : 't-green'), t.legal ? U.legal(t.legal) : ''],
      meta: [['目标', c.targetId], ['区域', c.district]]
    })}
      ${U.metricStrip([
        { label: '通知状态', value: nStatus, tone: nStatus === '待通知' ? 'warn' : 'good', icon: 'bell' },
        { label: '违法类型', value: c.violation, tone: 'bad', icon: 'alert' },
        { label: '证据数量', value: fs2.length, unit: '项', tone: fs2.length ? 'good' : 'bad', icon: 'folder' },
        { label: '处置结果', value: auth ? auth.result : '待执行', tone: auth && auth.result !== '无效' ? 'good' : 'warn', icon: 'shield' }
      ], { compact: true })}
      ${U.sect('违法事实', U.kv([
        ['目标编号', `<span class="mono lnk" data-goto="target">${c.targetId}</span>`],
        ['违法类型', U.tag(c.violation, 't-orange')],
        ['发生时间', c.time], ['发生区域', c.district],
        ['飞行高度', (t.alt || '—') + ' m'], ['飞行速度', (t.speed || '—') + ' m/s'],
        ['机型', U.modelTag(snapOf(c).model || c.model, snapOf(c).model_source)],
        ['责任主体', snapOf(c).subject || c.partner],
        ['认定依据', snapOf(c).basis || '空域规则 C02 + 计划匹配 C01']
      ], { surface: true, density: 'compact' }), { icon: 'alert' })}
      ${U.sect(`证据链（${fs2.length} 项）`, evidence, { icon: 'folder' })}
      ${U.sect('关联设备与处置', U.kv([
        ['遥控器 SN', `<span class="mono">${c.rcSn}</span>`],
        ['发现设备', device],
        ['处置方式', '已发起反制'],
        ['授权编号', `<span class="mono">${authNo}</span>`],
        ['执行结果', '返航']
      ], { surface: true, density: 'compact' }), { icon: 'device' })}
      ${nStatus === '待通知' ? U.detailActions(`<button class="btn pri" data-notify="${c.id}">通知处罚部门</button>`) : ''}`;
  }

  function paintDetail() {
    document.getElementById('pnDetail').innerHTML = noticeDetail();
    drawTrack();
  }
  function drawTrack() {
    const box = document.getElementById('pnTrack');
    if (box) {
      if (map) map.destroy();
      const t = M.allTargets.find(x => x.id === st.sel.targetId);
      map = new MapView(box, { zoom: 2.6, layers: { device: false, alarm: false }, legend: false });
      map.setData({
        airspaces: M.airspaces, devices: [], alarms: [],
        targets: t ? [Object.assign({}, t, {
          tracked: true,
          track: Array.from({ length: 18 }, (_, i) => ({ lon: t.lon - .06 + i * .007, lat: t.lat - .05 + i * .006, alt: t.alt }))
        })] : []
      });
      const t2 = t || { lon: 118.6, lat: 37.45 };
      setTimeout(() => { if (!map) return;   // 页面已切走时 destroy() 会把 map 置空，延时回调必须自查
        const q = map.px(t2.lon, t2.lat); map.ox += map.w / 2 - q[0]; map.oy += map.h / 2 - q[1]; }, 30);
    }
  }
  function paint() {
    document.getElementById('pnList').innerHTML = list();
    paintDetail();
  }
  function paintReview() {
    const a = document.getElementById('pnRvList'), b = document.getElementById('pnRvChk');
    if (a) a.innerHTML = rvList();
    if (b) b.innerHTML = rvCheck();
    // 页签徽标跟着待复核数变
    const badge = document.querySelector('[data-pt="review"] .tag');
    if (badge) { badge.textContent = rvPending().length; badge.className = 'tag ' + (rvPending().length ? 't-red' : 't-gray'); }
  }

  /* ---- 按当前页签渲染内容并初始化图表(图表必须在可见容器中初始化,否则尺寸为 0) ---- */
  function paintTab() {
    const body = document.getElementById('pnBody');
    CH.disposeAll();
    if (map) { map.destroy(); map = null; }
    if (st.tab === 'case') {
      body.innerHTML = tabCase();
      paint();
      requestAnimationFrame(() => { if (st.tab === 'case') paintCaseCharts(); });
    } else if (st.tab === 'review') {
      body.innerHTML = tabReview();
      paintReview();
    } else if (st.tab === 'pend') {
      body.innerHTML = tabPend();
      document.getElementById('pnPendList').innerHTML = pendList();
      const ex = document.getElementById('pnPendExp');
      if (ex) ex.onclick = () => U.toast('已导出「待办案源清单.xlsx」共 ' + (M.pendingSubjects || []).length + ' 条（含认定缺口与下一步）', 'ok');
    } else {
      body.innerHTML = tabAuth();
      document.getElementById('pnAuth').innerHTML = authTable();
      requestAnimationFrame(() => { if (st.tab === 'auth') paintAuthCharts(); });
    }
    const jam = document.getElementById('pnJam');
    if (jam) jam.onclick = jamModal;
  }

  function paintCaseCharts() {
    if (document.getElementById('pnType')) {
      CH.hbar(document.getElementById('pnType'), {
        y: M.stats.byViolation.map(v => v.name), data: M.stats.byViolation.map(v => v.value)
      });
      const d = M.stats.days;
      CH.line(document.getElementById('pnTrend'), {
        x: d.map(x => x.md), yName: '案件数', y2: '金额(元)',
        series: [{ name: '案件数量', data: d.map(x => x.punish), color: CH.C.blue, area: true },
        { name: '罚款金额', data: d.map(x => x.punish * 4200), color: CH.C.red, yAxisIndex: 1 }]
      });
    }
  }

  function paintAuthCharts() {
    {
      const A = M.authLogs;
      const RC = { '迫降': '#2fd06e', '返航': '#3d8bff', '退出管制区': '#ffb020', '无效': '#ff4d5e' };
      const rc = M.util.groupCount(A, a => a.result);
      CH.donut(document.getElementById('pnAuthRes'), {
        data: [...rc.entries()].map(([n, v]) => ({ name: n, value: v, c: RC[n] })), center: ['32%', '50%']
      });
      const uc = M.util.groupCount(A, a => a.unit);
      const top = [...uc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      CH.hbar(document.getElementById('pnAuthUnit'), {
        y: top.map(t => t[0].replace('东营市', '')), data: top.map(t => t[1]),
        colors: top.map(t => t[0].includes('公安') ? '#ff4d5e' : '#a97bff')
      });
      const exp = document.getElementById('pnAuthExp');
      if (exp) exp.onclick = () => U.toast('已导出「反制与干扰授权审计.csv」共 ' + A.length + ' 条；导出行为本身已记入审计', 'ok');
    }
  }

  function mount(view) {
    pageView = view;
    previousViewOverflow = view.style.overflow;
    view.style.overflow = 'hidden';
    paintTab();

    U.on(view, '[data-row]', 'click', (e, el) => {
      const c = M.cases.find(x => x.id === el.dataset.row);
      if (st.tab === 'pend') {
        return pendModal((M.pendingSubjects || []).find(p => p.id === el.dataset.row));
      }
      if (st.tab === 'review') {
        if (c) { st.sel = c; U.selectRow(document.getElementById('pnRvChk'), c.id); snapModal(c); }
        return;
      }
      if (c) {
        st.sel = c;
        U.selectRow(document.getElementById('pnList'), c.id);
        paintDetail();                        // 列表不重建,滚动位置保持
      }
      else { const a = M.authLogs.find(x => x.id === el.dataset.row); if (a) authModal(a); }
    });
    U.on(view, '[data-notify]', 'click', (e, el) => {
      const c = M.cases.find(x => x.id === el.dataset.notify);
      if (!c || noticeStatus(c) === '已通知') return;
      noticed[c.id] = '已通知';
      saveNotice();
      g.APP.rerender();
      U.toast('通知成功', 'ok');
    });
    U.on(view, '[data-cop]', 'click', (e, el) => {
      e.stopPropagation();
      const [op, id] = el.dataset.cop.split('|');
      st.sel = M.cases.find(c => c.id === id); paint();
      if (op === 'do') processModal();
    });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { st.page = +el.dataset.pg; paint(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { st.size = parseInt(el.value); st.page = 1; paint(); });
    U.on(view, '[data-f]', 'change', (e, el) => {
      const k = el.dataset.f; st[k] = k === 'days' ? +el.value : el.value; st.page = 1; paint();
    });
    /* 终止 / 急停：把执行中的授权记录推到终态并留痕，之后操作入口自动恢复 */
    U.on(view, '[data-jam]', 'click', (e, el) => {
      const [op, id] = el.dataset.jam.split('|');
      const rec = M.authLogs.find(x => x.id === id);
      if (!rec || rec.result !== '执行中') return;
      const u = (M.users && M.users[0]) || { name: '值班员' };
      const t0 = M.CONF.demoTime;
      rec.end = M.util.fmtDT(t0);
      rec.result = op === 'estop' ? '急停终止' : '人工停止';
      rec.ack = '已回执';
      if (op === 'estop') rec.estop = '触发过急停';
      rvAudit(`公安授权信号干扰${op === 'estop' ? '急停' : '停止'}（${rec.id}）`, rec.targetId, u.name);
      g.APP.rerender();
      U.toast(op === 'estop' ? `已触发急停：${rec.id}，设备立即停止发射，已记入审计`
        : `已停止干扰：${rec.id}，回执已接收，已记入审计`, op === 'estop' ? 'err' : 'ok');
    });
    U.on(view, '[data-doc]', 'click', (e, el) => {
      if (el.dataset.doc === 'prev') docModal();
      else if (el.dataset.doc === 'down') U.toast('已下载《行政处罚决定书》' + st.sel.docNo
        + '（Demo 样例，不具法律效力；金额依据的档位表未经业务方确认）', 'err');
      else processModal();
    });
    /* L1:原来 toast 里写死「光电截图/雷达轨迹/视频片段」三类 —— 藏在文案里的枚举副本。
       改为跳到证据存储管理页看本案真实证据。 */
    U.on(view, '[data-ev]', 'click', () => {
      if (!st.sel) return;
      const fs2 = M.evidenceOf ? M.evidenceOf('case', st.sel.id) : [];
      if (!fs2.length) return U.toast(`案件 ${st.sel.id} 在证据台账中暂无关联材料`, 'err');
      if (g.SEARCH && g.SEARCH.goEntity) { U.goto('evidence', { id: fs2[0].id }); }
      else U.toast(`本案关联证据 ${fs2.length} 份，可在「证据存储管理」中查看`, 'ok');
    });
    U.on(view, '[data-goto]', 'click', () => U.goto('legality', { target: st.sel.targetId }));
    U.on(view, '[data-goparam]', 'click', () => { location.hash = '#/users'; U.toast('参数总览 → 罚则金额档位（待业务方确认）'); });
    U.on(view, '[data-sort]', 'click', (e, el) => {
      const k = el.dataset.sort;
      if (SORT.key === k) SORT.dir = SORT.dir === 'asc' ? 'desc' : 'asc';
      else { SORT.key = k; SORT.dir = 'asc'; }
      st.page = 1;
      document.getElementById('pnList').innerHTML = list();
    });
    U.on(view, '#pnR', 'click', () => {
      Object.assign(st, { status: '全部状态', region: '全部区域', vio: '全部类型', partner: '全部合作方', days: 30, page: 1 });
      paintTab(); U.toast('筛选条件已重置');
    });
    U.on(view, '#pnExp', 'click', () => U.toast('已导出「处罚案件明细.xlsx」共 ' + filtered().length + ' 条', 'ok'));
    /* 定性依据复核 */
    U.on(view, '[data-ps]', 'click', (e, el) => {
      e.stopPropagation();
      pendModal((M.pendingSubjects || []).find(p => p.id === el.dataset.ps));
    });
    U.on(view, '[data-rv]', 'click', (e, el) => {
      e.stopPropagation();
      reviewModal(M.reviewRequests.find(r => r.id === el.dataset.rv));
    });
    U.on(view, '[data-f="rvf"]', 'change', (e, el) => { st.rvFilter = el.value; paintReview(); });
    U.on(view, '[data-jd]', 'click', (e, el) => { snapModal(M.cases.find(c => c.id === el.dataset.jd)); });
  }

  /* 立案时判定 vs 当前判定 —— 案件详情与复核弹窗共用 */
  function cmpBlock(c) {
    const d = judgeDiff(c), s2 = d.snap;
    if (d.lost) return `<div class="warnbox">本案引用的目标 <span class="mono">${c.targetId}</span> 已发生合并/分裂，
      当前判定需按 ID 变更回溯还原（见案件详情「目标 ID 变更回溯」）。立案快照仍完整保留：
      ${U.legal(s2.legal_status)} ${(s2.violation_reasons || []).join('、')} · ${s2.risk_level} · ${s2.at}</div>`;
    const row = (lb, a, b, diff) => `<tr>
      <td style="width:88px;color:var(--txt-3)">${lb}</td>
      <td style="width:44%">${a}</td>
      <td style="width:44%">${diff ? `<b style="color:#ffd07a">${b}</b>` : b}</td></tr>`;
    const isDiff = k => d.items.some(x => x[0] === k);
    return `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:12px;color:var(--txt-3)">
        <span style="width:88px"></span><span style="width:44%">立案时判定（${(s2.at || '').slice(5, 16)}）</span>
        <span style="width:44%">当前判定</span></div>
      <table class="tb" style="font-size:12.5px"><tbody>
        ${row('定性', U.legal(s2.legal_status), U.legal(d.cur.legal), isDiff('定性'))}
        ${row('违规事由', (s2.violation_reasons || []).join('、') || '—', d.cur.vio || '—', isDiff('违规事由'))}
        ${row('风险等级', U.tag(s2.risk_level), U.tag(d.cur.risk), isDiff('风险等级'))}
        ${row('置信度', U.confPct(s2.confidence), U.confPct(d.cur.conf), false)}
        ${row('来源', s2.source_type || '—', '—', false)}
      </tbody></table>
      <div style="margin-top:8px;font-size:12px;color:var(--txt-2);white-space:normal">
        <b>立案依据：</b>${s2.basis || '—'}</div>
      <div style="margin-top:6px">${d.items.length
        ? `<span class="tag t-red">${d.items.length} 项差异</span>
           <span style="font-size:11.5px;color:var(--txt-3)">${d.items.map(x => x[0]).join('、')}发生变化，须按 §11 复核后才能改动案件状态</span>`
        : `<span class="tag t-green">立案快照与当前判定一致</span>
           <span style="font-size:11.5px;color:var(--txt-3)">已立案案件是历史事实，即使后续重新判定，快照也不会被覆盖</span>`}</div>`;
  }

  function snapModal(c) {
    if (!c) return;
    const rr = M.reviewRequests.find(r => r.caseId === c.id);
    U.modal({
      title: '立案判定核查 · ' + c.id, width: '680px',
      body: `${U.kv([['案件状态', U.tag(c.status)], ['目标编号', `<span class="mono">${c.targetId}</span>`],
      ['违法类型', U.tag(c.violation, 't-orange')], ['发生时间', c.time]])}
        <div style="margin-top:12px">${cmpBlock(c)}</div>
        ${rvOutcome[rr && rr.id] ? outcomeBox(rvOutcome[rr.id]) : ''}`,
      footer: `<button class="btn" data-close>关闭</button>
        ${rr && !rvOutcome[rr.id] ? `<button class="btn pri" data-act="rv">受理复核</button>` : ''}`,
      on: { rv: () => reviewModal(rr) }
    });
  }

  function outcomeBox(o) {
    const meta = RV_RESULTS.find(x => x.k === o.result) || {};
    return `<div style="margin-top:12px;padding:9px 11px;border:1px solid var(--line-2);border-radius:6px;
        background:rgba(61,139,255,.06)">
      <div style="margin-bottom:5px">复核结论：${U.tag(o.result, meta.c || 't-gray')}
        <span style="color:var(--txt-3);font-size:11.5px">${o.by} · ${o.at}
        ${o.approvalNo ? ' · §11 复核审批文号 ' + o.approvalNo : ''}</span></div>
      <div style="font-size:12px;color:var(--txt-2);white-space:normal">${o.opinion}</div>
    </div>`;
  }

  /* ---- 复核受理与结论(真实改案件状态 + 写审计) ---- */
  function reviewModal(r) {
    if (!r) return;
    const c = M.cases.find(x => x.id === r.caseId);
    const done = rvOutcome[r.id];
    const closed = c && c.status === '已结案';
    if (done) {
      return U.modal({
        title: '复核记录 · ' + r.id, width: '680px',
        body: `${U.kv([['关联案件', `<span class="mono">${r.caseId}</span> ${U.tag(c ? c.status : r.caseStatus)}`],
        ['目标编号', `<span class="mono">${r.targetId}</span>`],
        ['拟改判', `${U.legal(r.from)} → ${U.legal(r.to)}`],
        ['降级理由', `<div style="white-space:normal">${r.reason}</div>`]])}
          ${outcomeBox(done)}
          <div style="margin-top:12px">${c ? cmpBlock(c) : ''}</div>`,
        footer: `<button class="btn" data-close>关闭</button>`
      });
    }
    const reviewers = M.users.filter(u => u.roleName === '处置授权人' || u.roleName === '超级管理员');
    U.modal({
      title: '定性依据复核 · ' + r.id, width: '720px',
      body: `${closed ? `<div class="warnbox" style="border-color:rgba(255,77,94,.45);background:rgba(255,77,94,.10)">
          <b>本案已结案。</b>已结案案件不允许直接改动状态 —— 依设计 §11，须先取得<b>复核审批文号</b>方可作出
          「撤销案件」或「补充证据后重判」的结论；仅出具「维持原定性」意见时不改动案件状态，可直接提交。</div>`
        : `<div class="warnbox">本案在办（${c ? c.status : r.caseStatus}），复核结论将<b>真实改动案件状态与流程环节</b>，并记入平台操作审计。</div>`}
        ${U.kv([['关联案件', `<span class="mono">${r.caseId}</span> ${U.tag(c ? c.status : r.caseStatus)}`],
        ['目标编号', `<span class="mono">${r.targetId}</span>`],
        ['拟改判', `${U.legal(r.from)} <span style="color:var(--txt-3)">→</span> ${U.legal(r.to)}`],
        ['提出方', r.raisedBy], ['提出时间', r.at],
        ['降级理由', `<div style="white-space:normal">${r.reason}</div>`],
        ['数据层备注', `<div style="white-space:normal;color:var(--txt-3)">${r.note}</div>`]])}
        ${U.sect('立案时判定 vs 当前判定', c ? cmpBlock(c) : '<span style="color:var(--txt-3)">未找到关联案件</span>')}
        ${U.sect('复核结论', `<div style="display:flex;flex-direction:column;gap:6px">
          ${RV_RESULTS.map((x, i) => `<label class="chk" style="margin:0"><input type="radio" name="rvr" value="${x.k}" ${i === 0 ? 'checked' : ''}>
            <span>${U.tag(x.k, x.c)} <span style="color:var(--txt-3)">${x.desc}</span></span></label>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          ${U.field('复核人', `<select class="sel" data-f="rvby" style="flex:1">
            ${reviewers.map(u => `<option>${u.name}</option>`).join('')}</select>`)}
          ${U.field('§11 复核审批文号', `<input class="ip" data-f="apn" style="flex:1"
            placeholder="${closed ? '已结案改状态必填，如 FH-2026-0826-01' : '选填'}">`)}
        </div>
        ${U.field('复核意见', `<input class="ip" data-f="rvop" style="flex:1;margin-top:10px" placeholder="必填，写明依据与结论理由">`)}
        ${closed ? `<label class="chk" style="margin-top:10px"><input type="checkbox" data-f="rvack">
          我确认本次复核已按设计 §11 案件复核流程报批，审批文号如上，操作将记入平台操作审计。</label>` : ''}`)}`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">提交复核结论</button>`,
      on: {
        ok: el => {
          const result = (el.querySelector('input[name="rvr"]:checked') || {}).value;
          const opinion = el.querySelector('[data-f="rvop"]').value.trim();
          const by = el.querySelector('[data-f="rvby"]').value;
          const apn = el.querySelector('[data-f="apn"]').value.trim();
          if (!opinion) return U.toast('请填写复核意见', 'err');
          const changesCase = result !== '维持原定性';
          if (closed && changesCase) {
            if (!apn) return U.toast('本案已结案，作出改变案件状态的结论必须填写 §11 复核审批文号', 'err');
            const ack = el.querySelector('[data-f="rvack"]');
            if (!ack || !ack.checked) return U.toast('请确认已按 §11 案件复核流程报批', 'err');
          }
          applyReview(r, { result, by, opinion, approvalNo: apn, at: M.util.fmtDT(M.CONF.demoTime) });
          U.closeModal();
          paintTab();
          U.toast(`复核已办结：${r.caseId} · ${result}` + (changesCase && c ? `，案件状态已变更为「${c.status}」` : '，案件状态不变')
            + '，已记入平台操作审计', changesCase ? 'err' : 'ok');
        }
      }
    });
  }

  function applyReview(r, o) {
    const c = M.cases.find(x => x.id === r.caseId);
    if (c) {
      /* 不再手写目标状态：撤销 → stage 1、重判 → stage 2，状态由数据层 caseStatusOf 派生。
         原来这里把 stage=2 写成「已立案」，正是那处高估 —— 立案是第 3 环，stage=2 时它还没发生。
         复核结论本身就是回退理由，直接传给审计，不另编一句。 */
      const why = `定性依据复核：${o.result}` + (o.approvalNo ? `（文号 ${o.approvalNo}）` : '');
      if (o.result === '撤销案件') M.setCaseStage(c, 1, why, MY_MODULE);
      else if (o.result === '补充证据后重判' && c.stage > 2) M.setCaseStage(c, 2, why, MY_MODULE);
      if (o.result !== '维持原定性') {
        rvCaseOps[c.id] = { targetId: c.targetId, status: c.status, stage: c.stage, docReady: c.docReady, note: o.result + '（' + r.id + '）' };
      }
    }
    r.status = '已办结';
    rvOutcome[r.id] = o;
    rvAudit('定性依据复核 · ' + o.result + (o.approvalNo ? '（文号 ' + o.approvalNo + '）' : ''),
      r.caseId + ' / ' + r.targetId, o.by);
    rvSave();
  }

  function processModal() {
    const c = st.sel;
    const nextStep = M.DISPOSAL_FLOW[c.stage];            // 下一环（stage 是已完成环节数）
    const cur = c.steps[c.stage - 1];
    /* 先问数据层这一步本页能不能推 —— 闸门在 M.advanceCase 里，不在按钮上。
       只靠界面不给按钮不够：入口会因改版、组件复用、新增入口而绕开
       （这跟空域只读把 canWrite 放进处理函数、而不是只置灰按钮，是同一条）。
       这里提前问一次，是为了把"不能推"的理由**在点开之前**就说清楚，
       而不是让人填完办理意见再被拒。 */
    /* 纯查询，不写任何数据，因此不需要深拷副本。
       这里曾经是「在副本上调 advanceCase」—— 起因是我一度给它传了个自以为存在的
       dryRun 参数，而 JS 对多给的参数不报错，于是每打开一次弹窗案件就真被推进一格。
       现在数据层提供了 canAdvanceCase，它**不具备产生副作用的能力**：
       保护与副作用之间距离为零，不再依赖调用方记得复制什么。 */
    const probe = M.canAdvanceCase(c, MY_MODULE);
    const blocked = probe.ok === false;

    U.modal({
      title: '推进案件流程 · ' + c.id, width: '580px',
      body: `${U.kv([
        ['当前环节', cur ? `${cur.n}　<span style="color:var(--txt-3);font-size:11.5px">（${cur.owner}）</span>` : '已完成'],
        ['下一环节', nextStep ? `${nextStep.n}　<span style="color:var(--txt-3);font-size:11.5px">（${nextStep.owner}）</span>` : '已到末环'],
        ['违法类型', c.violation],
        ['拟处罚', c.penalty + (c.penalty === '罚款' ? '（' + U.money(c.fine) + '）' : '')]
      ])}
        ${blocked ? `<div class="warnbox" style="margin-top:12px;border-color:rgba(255,176,32,.45);
            background:rgba(255,176,32,.08);line-height:1.85">
            注意：<b>本环节不由处置处罚管理执行，无法在本页推进。</b><br>
            ${probe.reason}<br>
            <span style="color:var(--txt-3)">六环节横跨三个模块，本页只负责<b>立案</b>与<b>结案归档</b>；
            其余环节在此处只作为既有事实展示，不由本页产生。</span></div>`
        : `<div style="margin-top:12px">${U.field('办理意见', `<input class="ip" style="flex:1;min-width:0" placeholder="请输入办理意见">`)}</div>
           <label class="chk"><input type="checkbox" checked>同步至上级管控平台（/api/v1/dispatch/sync）</label>
           <label class="chk"><input type="checkbox" checked>生成/更新处罚文书</label>`}`,
      footer: blocked
        ? `<button class="btn" data-close>知道了</button>`
        : `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">确认推进</button>`,
      on: {
        ok: () => {
          U.closeModal();
          /* 真正的推进也走同一个入口。dryRun 那次只是为了提前给理由，
             这里必须再走一次真调用 —— 用 dryRun 的结果代替真调用，等于把闸门搬回页面。 */
          const r = M.advanceCase(c, MY_MODULE);
          if (!r || r.ok === false) {
            paint();
            return U.toast(r && r.reason ? r.reason : '本页无法推进该环节', 'err');
          }
          if (r.status === '已结案' || c.stage >= 3) c.docReady = true;
          paint();
          U.toast(`案件已推进至「${r.step}」，状态 ${r.status}，操作记入审计日志`, 'ok');
        }
      }
    });
  }

  function docModal() {
    const c = st.sel;
    U.modal({
      title: '《行政处罚决定书》预览', width: '680px',
      body: `<div class="warnbox" style="border-color:rgba(255,77,94,.45);background:rgba(255,77,94,.10);margin-bottom:12px">
        <b>本文书为 Demo 生成样例，不具法律效力。</b>三处出处需在正式实施前落实：
        <div style="margin-top:5px;line-height:1.9;font-size:12px">
          ① <b>金额档位</b>：法规给的是罚款区间而非逐项定额，本文书金额所依据的档位表<b>尚未经业务方确认</b>
             （见「用户与权限 → 参数总览 → 罚则金额档位」）<br>
          ② <b>处罚主体与出具授权</b>：会议纪要未授权平台直接出具处罚文书，主体亦未确定<br>
          ③ <b>证据材料</b>：正文所列证据<b>逐份取自证据台账</b>（证据存储管理页可溯源），
             不是固定文案；校验异常的材料会在正文中单独标出<br>
          ④ <b>责任主体认定</b>：本案主体的认定路径为
             ${snapOf(c).subject_source ? '<span class="mono">' + snapOf(c).subject_source + '</span>' : '<b style="color:#ff96a0">未记录</b>'}
        </div></div>
      <div style="position:relative;overflow:hidden;background:#f6f8fc;color:#1a2b45;padding:26px 30px;border-radius:6px;font-size:13px;line-height:2">
        <div style="position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:space-around">
          ${Array.from({ length: 5 }, () => `<div style="transform:rotate(-24deg);text-align:center;white-space:nowrap;
            color:rgba(190,40,55,.12);font-size:21px;font-weight:700;letter-spacing:3px">Demo 样例 · 不具法律效力 · Demo 样例 · 不具法律效力</div>`).join('')}
        </div>
        <div style="text-align:center;font-size:19px;font-weight:700;margin-bottom:6px">行政处罚决定书</div>
        <div style="text-align:center;color:#5b6b85;margin-bottom:18px">${c.docNo}</div>
        <p>当事人：${c.pilot}（${c.partner}）</p>
        <p>经查，当事人于 ${c.time} 在${c.district}使用 ${c.model === '未识别' ? '型号未识别的' : c.model} 无人驾驶航空器实施「${c.violation}」行为，
        由无人机融合感知与低空安全管理平台通过多源融合感知发现并固定证据（目标编号 ${c.targetId}）。</p>
        ${(function () {
          /* 原文写死「有飞行轨迹记录、光电识别截图、视频资料及设备日志等证据证实」。
             实测 46 起案件中 22 起没有雷达轨迹快照、18 起没有光电抓拍图，
             而「设备日志」根本不在 EVIDENCE_KINDS 八类里 ——
             一份法律文书具名了它没有的证据。文书外面三处出处标注做得再好，
             正文这句本身没有出处。改为逐类枚举本案在证据台账中真实存在的材料。 */
          const fs2 = M.evidenceOf ? M.evidenceOf('case', c.id) : [];
          if (!fs2.length) return `<p>本案<b>在证据台账中未检索到关联证据材料</b>，
            事实认定所依据的材料需在正式出具前补充固定。</p>`;
          const byKind = {};
          fs2.forEach(f => { (byKind[f.kind] = byKind[f.kind] || []).push(f); });
          const parts = Object.keys(byKind).map(k => `${k} ${byKind[k].length} 份`);
          const bad = fs2.filter(f => f.verifyState !== '完好');
          return `<p>上述事实有下列证据证实：${parts.join('、')}，共 ${fs2.length} 份，
            均存于证据台账并可溯源（编号 ${fs2.slice(0, 3).map(f => f.id).join('、')}${fs2.length > 3 ? ' 等' : ''}）。</p>`
            + (bad.length ? `<p style="color:#b3402d"><b>其中 ${bad.length} 份完整性校验异常</b>
              （${bad.map(f => f.id + ' ' + f.verifyState).join('；')}），
              依《证据保管办法》，该部分在结论作出前不得作为定案依据。</p>` : '');
        })()}
        <p>依据相关法规，决定给予：<b>${c.penalty}${c.penalty === '罚款' ? '人民币 ' + U.num(c.fine) + ' 元' : ''}</b>。</p>
        <div style="text-align:right;margin-top:24px">东营市公安局<br>${c.date}</div>
      </div>`,
      footer: `<button class="btn" data-close>关闭</button><button class="btn pri" data-close onclick="UI.toast('文书已下载（Demo 样例，不具法律效力；金额档位表未经业务方确认）','err')">${U.icon('download')} 下载 PDF</button>`
    });
  }

  function authModal(a) {
    U.modal({
      title: '授权与执行审计 · ' + a.id, width: '640px',
      body: U.kv([['授权类型', a.type], ['关联案件', a.caseId], ['目标编号', a.targetId],
      ['联动单位', a.unit], ['审批人', a.approver], ['操作人', a.operator],
      ['处置设备', a.device],
      ['干扰通道', a.channels
        ? a.channels.map(n => `<span class="mono">ch${n}</span> ${M.JAM_CH[n].key} <span style="color:var(--txt-3)">${M.JAM_CH[n].range} · ${M.JAM_CH[n].powerW}W</span>`).join('<br>')
        : (() => { const nt = M.bandNote(a); return nt.pending ? `<span style="color:var(--orange)">${nt.txt}</span>` : nt.txt; })()],
      /* 卫星导航干扰必须单列一行：它不能混在"频段"里被一笔带过 */
      ['卫星导航链路干扰', a.gnssJam == null ? (M.bandNote(a).pending ? '待确认（通道组合未定义）' : '不适用')
        : a.gnssJam ? `<b style="color:var(--red)">是</b> —— 干扰 GPS / GLONASS / 北斗，法律后果区别于遥控图传干扰`
        : '否'],
      ['通道依据', a.bandSource || '—'],
      ['作用范围', a.range],
      ['开始时间', a.start], ['结束时间', a.end], ['持续时长', a.durationS + ' 秒'],
      ['执行结果', a.result], ['回执状态', a.ack], ['急停记录', a.estop], ['审计完整性', a.audit]])
        + `<div class="warnbox" style="margin-top:12px">审计记录不可修改、不可删除，保留期与案件卷宗一致。</div>`
    });
  }

  /* ---- 公安授权信号干扰：下发必须落库 ----
     原实现点「提交并执行」只 closeModal + toast，authLogs 与 auditLogs 都不写，
     而 toast 还写着「可在授权记录中查看启停与急停状态」—— 指着一个不存在的记录。
     §6.3 里要求最严的动作反而是全页唯一没留痕的，这不是有意为之，是漏的。
     另：审批编号/作用范围/执行时长几个输入框原来没有 data-* 定位，值从未被读取。 */
  function jamModal() {
    const u = (M.users && M.users[0]) || { name: '值班员', roleName: '值班员' };
    const cases = M.cases.filter(c => c.status !== '已结案');
    U.modal({
      title: '发起公安授权信号干扰', width: '680px',
      body: `<div class="warnbox">注意：信号干扰为公安受控手段。必须填写<b>审批/授权编号、联动单位、作用范围、执行时长</b>，
        执行期间支持启停与急停，全过程审计（纪要 §6.3 / §11.1）。平台不代替公安做审批。</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${U.field('关联案件', `<select class="sel" data-jcase style="flex:1">
            ${cases.map(c => `<option value="${c.id}" ${st.sel && st.sel.id === c.id ? 'selected' : ''}>${c.id} · ${c.violation}</option>`).join('')}
          </select>`)}
          ${U.field('目标编号', `<input class="ip" data-jtarget style="flex:1" value="${st.sel ? st.sel.targetId : ''}" readonly>`)}
          ${U.field('审批编号 <span style="color:#ff8b95">*</span>', `<input class="ip" data-japp style="flex:1" placeholder="公安审批文号（必填）">`)}
          ${U.field('联动单位', `<select class="sel" data-junit style="flex:1">
            ${['东营市公安局特警支队', '东营市公安局东营分局', '东营市公安局广饶分局'].map(x => `<option>${x}</option>`).join('')}</select>`)}
          ${U.field('干扰设备', `<select class="sel" data-jdev style="flex:1">
            ${['公安干扰车-01', '公安干扰车-02', '便携干扰终端-03'].map(x => `<option>${x}</option>`).join('')}</select>`)}
          ${U.field('干扰通道', `<div style="flex:1">
            ${Object.values(M.JAM_CH).map(c => `<label class="chk" style="margin:0 0 4px">
              <input type="checkbox" data-jch="${c.ch}"${c.gnss ? '' : ' checked'}>
              <span class="mono">ch${c.ch}</span> ${c.key}
              <span style="color:var(--txt-3);font-size:11px">${c.range} · ${c.powerW}W</span>
              ${c.gnss ? `<b style="color:var(--red);font-size:11px">卫星导航链路</b>` : ''}
            </label>`).join('')}
            <div id="jamGnssWarn" class="warnbox" style="display:none;margin-top:6px;font-size:11.5px">
              <b>ch2 将干扰 GPS / GLONASS / 北斗卫星导航链路。</b>
              其法律后果与干扰遥控、图传链路不同，且影响范围不限于目标无人机。
              开启前须确认公安授权文书已明确载明卫星导航链路干扰。</div>
          </div>`)}
          ${U.field('作用范围', `<input class="ip" data-jrange style="flex:1" value="1500 m 扇区 60°">`)}
          ${U.field('执行时长(秒)', `<input class="ip" data-jsec style="flex:1" value="120">`)}
        </div>
        <label class="chk" style="margin-top:10px"><input type="checkbox" data-j="1">已取得公安机关书面/系统授权，授权编号真实有效</label>
        <label class="chk"><input type="checkbox" data-j="2">已评估作用范围内通信、导航与其他合法飞行影响</label>
        <label class="chk"><input type="checkbox" data-j="3">知悉本次操作全程录音录像并纳入审计，可随时急停</label>
        <div style="margin-top:8px;font-size:11.5px;color:var(--txt-3);line-height:1.8">
          提交后立即在<b>「反制与干扰授权审计」</b>生成一条授权记录（本页签），并写入平台操作审计。
          通道与频段/功率取自设备一手资料（${M.JAM_SOURCE}）。</div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn danger" data-act="go" disabled id="jamGo">提交并执行</button>`,
      mounted: el => {
        const upd = () => el.querySelector('#jamGo').disabled = [...el.querySelectorAll('[data-j]')].filter(x => x.checked).length < 3;
        el.querySelectorAll('[data-j]').forEach(c => c.onchange = upd);
        /* 勾选卫星导航通道时把后果显性化，不靠操作员自己知道 ch2 是什么 */
        const gn = el.querySelector('[data-jch="2"]'), warn = el.querySelector('#jamGnssWarn');
        if (gn && warn) gn.onchange = () => warn.style.display = gn.checked ? '' : 'none';
      },
      on: {
        go: el => {
          const app = (el.querySelector('[data-japp]').value || '').trim();
          if (!app) {                       // 审批编号写着必填就要真必填
            U.toast('公安审批文号为必填 —— 没有文号，这条授权记录无法回答"谁批准的"', 'err');
            el.querySelector('[data-japp]').focus();
            return;
          }
          const sec = parseInt(el.querySelector('[data-jsec]').value, 10);
          if (!sec || sec <= 0) { U.toast('执行时长须为正整数（秒）', 'err'); return; }
          const chs = [...el.querySelectorAll('[data-jch]')].filter(x => x.checked)
            .map(x => +x.dataset.jch).sort();
          if (!chs.length) { U.toast('至少选择一路干扰通道 —— 一路不开等于没有实施干扰', 'err'); return; }
          const caseId = el.querySelector('[data-jcase]').value;
          const c = M.cases.find(x => x.id === caseId);
          const t0 = M.CONF.demoTime;
          const rec = {
            id: 'AUTH' + M.util.ymd(t0) + M.util.p3(M.authLogs.length + 1),
            caseId, targetId: (c && c.targetId) || (st.sel ? st.sel.targetId : '—'),
            type: '公安授权信号干扰',
            unit: el.querySelector('[data-junit]').value,
            approver: app,                                  // 审批文号即审批来源，不替公安编人名
            operator: u.name,
            device: el.querySelector('[data-jdev]').value,
            channels: chs,
            /* 频段由勾选的通道生成，并带上出处 —— 不是一个自由填写的字符串。
               四通道继电器逐路可控：见《网络控制器通信协议v2.0.txt》。 */
            band: chs.map(n => M.JAM_CH[n].key).join(' / '),
            bandSource: M.JAM_SOURCE,
            gnssJam: chs.includes(2),
            range: el.querySelector('[data-jrange]').value.trim(),
            durationS: sec,
            start: M.util.fmtDT(t0),
            end: M.util.fmtDT(new Date(t0.getTime() + sec * 1000)),
            result: '执行中',                                // 刚下发，结果未知；不预先写"迫降/返航"
            ack: '待回执', audit: '完整', estop: '未触发',
            approvalNo: app
          };
          M.authLogs.unshift(rec);
          rvAudit(`公安授权信号干扰下发（审批文号 ${app}）`, rec.targetId, u.name);
          U.closeModal();
          st.tab = 'auth';
          g.APP.rerender();
          U.toast(`干扰任务已下发并留痕：授权编号 ${rec.id}，可在本页「反制与干扰授权审计」中查看`, 'ok');
        }
      }
    });
  }

  function destroy() {
    if (map) map.destroy();
    map = null;
    if (pageView) pageView.style.overflow = previousViewOverflow;
    pageView = null;
  }
  g.PAGES = g.PAGES || {};
  g.PAGES.punish = { render, mount, destroy };
})(window);
