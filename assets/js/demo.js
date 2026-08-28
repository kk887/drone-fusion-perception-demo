/* =============================================================================
 * demo.js —— 业务演示模式
 *
 * 一条预设案例贯穿全系统：未知无人机进入禁飞区 → 多源融合识别 → 判为非法 →
 * 触发告警 → 人工核实与授权 → 反制 → 证据包归档 → 首页闭环数字变化。
 *
 * 两条设计约束：
 *   1) **真推进**，不是幻灯片。每一步点的都是页面上真实的主操作，
 *      走完之后首页「今日业务闭环」的数字确实会变 —— 演示里最有说服力的正是这个。
 *   2) 因此必须能**还原**。反复对不同客户演示不能靠刷新浏览器：刷新会连
 *      mock 的随机种子一起重来，第二次演示看到的目标编号和第一次不一样。
 *      这里改了什么就记什么，退出时按记录逐条还原。
 * ========================================================================== */
(function (g) {
  'use strict';
  const M = MOCK;

  /* 演示脚本。need 是「进入下一步所要求的事件进度」：
     达不到就把「下一步」按住，并明说该点页面上的哪个按钮 —— 这样引导卡片
     不会替用户把活干了，甲方看到的是自己点出来的结果。 */
  const STEPS = [
    {
      hash: '#/overview', title: '① 首页：10 秒看清有没有风险',
      text: '四个指标只回答四个问题：天上有多少、有没有高风险、有没有人在处置、设备靠不靠得住。' +
        '右侧「重点事件」只列最该看的几条，第一条就是本次演示的主线。'
    },
    {
      hash: '#/situation', title: '② 感知识别：几路发现的、可信度多少',
      text: '融合感知中心正在追踪同一个目标。雷达、光电、TDOA、5G-A 各路来源的置信度' +
        '加权得到融合置信度；逐路字段、关联关系与点迹诊断收在「技术详情」抽屉，默认不占屏。'
    },
    {
      hash: '#/legality', title: '③ 合法性：先给结论，再给依据',
      text: '一句话结论在最上面，下面四条依据：身份、计划、空域、时间。' +
        '规则编号和原始字段收在「查看判定依据」里 —— 业务人员不需要先读规则号才看得懂结论。'
    },
    {
      hash: '#/alarms', title: '④ 告警与核实：为什么告警、该做什么',
      text: '风险等级按航线口径算出来，不是拍出来的。人工核实与反制授权都在本页完成：' +
        '核实属实后进入反制环节，反制属强制人工授权（§6.3 人在回路），授权记录与操作留痕同步落档。'
    },
    {
      hash: '#/punish', title: '⑤ 处置处罚：案件推进与留痕',
      text: '六环节横跨三个模块，本页负责立案与结案归档，其余环节按责任模块如实标注' +
        '「由谁完成于何时」。每一步推进都走数据层闸门并写入审计留痕。'
    },
    {
      hash: '#/evidence', title: '⑥ 证据归档：完整证据链',
      text: '轨迹快照、光电影像、指令报文与操作记录构成证据链，' +
        '台账每行标明来自哪个事件、哪个模块，完整性校验保证证据未被改动。'
    },
    {
      hash: '#/overview', title: '⑦ 回到首页：闭环一目了然',
      text: '「今日业务闭环」汇总发现 → 研判 → 告警 → 处置 → 归档的全链数字，' +
        '演示中在各页发生的真实操作会如实反映在这里。'
    }
  ];

  let on = false, i = 0, chip = null, snap = null;

  /* ---------- 现场快照 / 还原 ---------- */
  function snapshot() {
    const ctx = EVT.of(EVT.MAIN);
    const src = M.allTargets.find(t => t.id === EVT.MAIN);
    return {
      alarmId: ctx.alarm ? ctx.alarm.id : null,
      alarmStatus: ctx.alarm ? ctx.alarm.status : null,
      caseId: ctx.kase ? ctx.kase.id : null,
      caseStage: ctx.kase ? ctx.kase.stage : null,
      blockedBy: src ? src.caseBlockedBy : undefined,
      authLen: M.authLogs.length,
      auditLen: M.auditLogs.length,
      evidLen: M.evidenceFiles.length
    };
  }
  function restore() {
    if (!snap) return;
    const a = snap.alarmId && M.alarms.find(x => x.id === snap.alarmId);
    if (a) { a.status = snap.alarmStatus; delete a.verifiedAt; }

    const ctx = EVT.of(EVT.MAIN);
    if (ctx.kase) {
      if (!snap.caseId) {
        // 演示期间新建的案件：整条移除，否则第二次演示会说「该目标已有案件」
        const k = M.cases.indexOf(ctx.kase);
        if (k >= 0) M.cases.splice(k, 1);
      } else if (ctx.kase.stage !== snap.caseStage) {
        M.setCaseStage(ctx.kase, snap.caseStage, '演示重置', '处置处罚管理');
      }
    }
    const src = M.allTargets.find(t => t.id === EVT.MAIN);
    if (src) { if (snap.blockedBy === undefined) delete src.caseBlockedBy; else src.caseBlockedBy = snap.blockedBy; }

    // 演示期间追加的授权记录与审计留痕一并回收：留着会让下一场演示的「操作留痕」
    // 里出现上一场客户的操作时间，看起来像系统在乱记。
    if (M.authLogs.length > snap.authLen) M.authLogs.length = snap.authLen;
    if (M.auditLogs.length > snap.auditLen) M.auditLogs.length = snap.auditLen;
    if (M.evidenceFiles.length > snap.evidLen) M.evidenceFiles.length = snap.evidLen;
    snap = null;
  }

  /* 布置场景：把主线告警拨回「新建」，这样演示能从人工核实开始走满六个环节。
     不这样做的话，随机生成的告警可能已经是「已确认」，演示一上来就跳过了核实。 */
  function setup() {
    const ctx = EVT.of(EVT.MAIN);
    if (ctx.alarm) ctx.alarm.status = '新建';
    if (ctx.kase && ctx.kase.stage > 1) M.setCaseStage(ctx.kase, 1, '演示重置', '处置处罚管理');
  }

  /* ---------- 引导卡片 ---------- */
  function paint() {
    if (!chip) return;
    const s = STEPS[i];
    const ctx = EVT.of(EVT.MAIN);
    const blocked = s.need != null && ctx.stage < s.need;
    const last = i === STEPS.length - 1;
    chip.innerHTML = `
      <div class="prg"><i style="width:${((i + 1) / STEPS.length * 100).toFixed(0)}%"></i></div>
      <div class="dh"><b>业务演示</b><span>禁飞区闯入 · ${EVT.MAIN}</span>
        <span class="x" data-d="exit" title="退出演示并还原数据">✕</span></div>
      <div class="dbd"><h4>${s.title}</h4><p>${s.text}</p>
        ${blocked ? `<p style="color:#ffd07a;margin-top:8px">▸ ${s.hint}</p>` : ''}</div>
      <div class="dft">
        <span class="stp">第 ${i + 1} / ${STEPS.length} 步</span>
        <span class="spacer"></span>
        ${i > 0 ? `<button class="btn ghost" data-d="prev">上一步</button>` : ''}
        ${last ? `<button class="btn" data-d="reset">重置演示</button>
                  <button class="btn pri" data-d="exit">结束演示</button>`
        : `<button class="btn pri" data-d="next" ${blocked ? 'disabled' : ''}>下一步 →</button>`}
      </div>`;
  }

  function go(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const s = STEPS[i];
    if (location.hash === s.hash) {
      if (g.APP) g.APP.rerender();
    } else location.hash = s.hash;
    paint();
  }

  function start() {
    if (on) return stop(true);
    snap = snapshot();
    setup();
    on = true; i = 0;
    document.getElementById('btnDemo').classList.add('on');
    document.getElementById('btnDemo').textContent = '■ 退出演示';
    chip = document.createElement('div');
    chip.className = 'demo-chip';
    chip.addEventListener('click', e => {
      const b = e.target.closest('[data-d]'); if (!b || b.disabled) return;
      const k = b.dataset.d;
      if (k === 'next') go(i + 1);
      else if (k === 'prev') go(i - 1);
      else if (k === 'reset') { restore(); snap = snapshot(); setup(); UI.toast('演示数据已重置', 'ok'); go(0); }
      else stop();
    });
    document.body.appendChild(chip);
    go(0);
    UI.toast('业务演示已开始：按引导卡片逐步推进', 'ok');
  }

  function stop(silent) {
    if (!on) return;
    on = false;
    restore();
    if (chip) { chip.remove(); chip = null; }
    const b = document.getElementById('btnDemo');
    if (b) { b.classList.remove('on'); b.textContent = '▶ 业务演示'; }
    if (!silent) UI.toast('已退出演示，数据已还原', 'ok');
    if (g.APP) g.APP.rerender();
  }

  /* 路由变化后同步：用户中途自己点了菜单，卡片仍留在原地，
     但要如实显示「当前不在本步页面」，而不是假装还在演示流程里。 */
  function onRoute() { if (on) paint(); }

  function bind() {
    const b = document.getElementById('btnDemo');
    if (b) b.onclick = () => (on ? stop() : start());
    // 事件推进后刷新卡片的可点状态（EVT.advance / 证据包生成都会派发）
    window.addEventListener('evt:advance', () => { if (on) paint(); });
  }

  g.DEMO = { bind, onRoute, start, stop, STEPS };
})(window);
