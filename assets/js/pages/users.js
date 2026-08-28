/* ===== 15. 用户与权限（本轮新增,补齐纪要 D2「权限审计」缺口） =====
   用户管理 / 角色与权限矩阵 / 操作审计三个页签。
   关键口径:反制与公安信号干扰授权仅「处置授权人」及以上角色可执行(§6.3)。 */
(function (g) {
  const M = MOCK, U = UI;
  let tab = 'user', sel = null, kw = '';

  function render() {
    sel = sel || M.users[0];
    /* KPI 行与「数据字典/参数总览」页签按用户要求移除（2026-08-27）。
       参数注册机制 U.regParams/paramGroups 保留 —— legality 的未确认参数横幅
       与《参数确认表》都从它取数，删的只是本页的展示入口。 */
    return `<div class="panel" style="flex:1;min-height:0;margin-top:12px;margin-bottom:12px;height:calc(100vh - 138px)">
      <div class="ph">
        <div class="tabs" style="border:0">
          ${[['user', '用户管理'], ['role', '角色与权限'], ['audit', '操作审计']].map(([k, t]) =>
      `<span class="tab ${tab === k ? 'on' : ''}" data-ut="${k}">${t}</span>`).join('')}
        </div>
        <span class="spacer"></span>
        <span id="usTools"></span>
      </div>
      <div class="pb nopad"><div id="usBody" style="flex:1;display:flex;min-height:0"></div></div>
    </div>`;
  }

  /* ---------- 用户管理 ---------- */
  function userTab() {
    const rows = M.users.filter(u => !kw || u.name.includes(kw) || u.account.includes(kw) || u.org.includes(kw));
    return `<div style="flex:1.6;display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--line-2)">
      ${U.table([
      { t: '账号', k: 'account', w: '96px', cls: 'num' },
      { t: '姓名', k: 'name', w: '90px' },
      { t: '角色', w: '110px', render: u => U.tag(u.roleName, u.role === 'R1' ? 't-red' : u.role === 'R2' ? 't-orange' : u.role === 'R5' ? 't-gray' : 't-blue') },
      { t: '单位', k: 'org' },
      // 「状态」与「在线」同属状态维度，合成一列 —— 表头文字也计入表格最小宽度，
      // 拆成两列不只多一列内容，还多一份表头与内边距（1440 宽下这两列占 127px）
      { t: '状态', w: '104px', render: u => U.tag(u.status, u.status === '正常' ? 't-green' : 't-gray')
        + (u.online ? ' <span class="dot-s" style="background:#2fd06e"></span><span style="font-size:11px">在线</span>'
          : ' <span style="color:var(--txt-3);font-size:11px">离线</span>') },
      { t: 'MFA', w: '66px', render: u => U.tag(u.mfa, u.mfa === '已开启' ? 't-green' : 't-amber') },
      { t: '最后登录', k: 'lastLogin', w: '148px', cls: 'num' },
      {
        t: '操作', w: '150px', render: u => `<span class="lnk" data-uop="reset|${u.id}">重置密码</span>
          <span class="lnk" data-uop="toggle|${u.id}">${u.status === '正常' ? '停用' : '启用'}</span>
          <span class="lnk" data-uop="edit|${u.id}">编辑</span>` }
    ], rows, { rowId: u => u.id, activeId: sel && sel.id })}
    </div>
    <div style="width:340px;flex:none;overflow:auto;padding:12px" id="usDetail">${userDetail()}</div>`;
  }

  function userDetail() {
    const u = sel;
    if (!u) return '<div class="empty">请选择用户</div>';
    const myAudit = M.auditLogs.filter(a => a.user === u.name).slice(0, 5);
    return `${U.detailHero({
      icon: 'user', variant: 'compact', subtitle: '用户与权限', title: u.name, id: '@' + u.account,
      tags: [U.tag(u.roleName, u.role === 'R2' ? 't-orange' : 't-blue'), U.tag(u.status, u.status === '正常' ? 't-green' : 't-gray')],
      meta: [['单位', u.org]]
    })}
      ${U.metricStrip([
        { label: '账号状态', value: u.status, tone: u.status === '正常' ? 'good' : 'warn', icon: 'user' },
        { label: '双因子认证', value: u.mfa, tone: u.mfa === '已开启' ? 'good' : 'warn', icon: 'shield' },
        { label: '在线状态', value: u.online ? '在线' : '离线', tone: u.online ? 'good' : 'info', icon: 'mon' }
      ], { compact: true })}
      ${U.kv([['所属单位', u.org], ['联系电话', u.phone], ['账号状态', U.tag(u.status, u.status === '正常' ? 't-green' : 't-gray')],
      ['双因子认证', u.mfa], ['创建时间', u.createdAt], ['最后登录', u.lastLogin], ['登录 IP', `<span class="mono">${u.lastIp}</span>`],
      ['反制/干扰授权', ['R1', 'R2'].includes(u.role) ? '<span class="tag t-red">可授权（§6.3 双人确认）</span>' : '<span class="tag t-gray">无权限</span>']], { surface: true, density: 'compact' })}
      ${U.sect('近期操作（' + myAudit.length + '）', myAudit.length
        ? myAudit.map(a => `<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:4px 0;border-bottom:1px solid rgba(64,158,255,.08)">
            <span style="color:var(--txt-2)">${a.action}</span><span class="mono" style="color:var(--txt-3)">${a.time.slice(5, 16)}</span></div>`).join('')
        : '<div class="empty" style="padding:8px">暂无操作记录</div>')}`;
  }

  /* ---------- 角色与权限矩阵（可编辑） ----------
     真值只有 M.PERM 一份；编辑先落在页内草稿 permDraft，保存（双人复核）才写回。
     锁定不可改：「反制/干扰授权」整行（§6.3 断言:AUTH 当且仅当 R1/R2，falsify 有注入守着）、
     R1 超级管理员整列（角色定义即全量授权）。 */
  let permDraft = null;
  const PERM_ORDER = ['AUTH', 'OP', 'READ', '—'];
  const permLocked = (rid, m) => m === '反制/干扰授权' || rid === 'R1';
  /* 「接口管理」页面已按裁定删除，矩阵行随之隐藏；保留原始下标映射，不动数据层数组 */
  const permRows = () => M.PERM_MODULES.map((m, i) => ({ m, i })).filter(x => x.m !== '接口管理');
  const permVal = (rid, i) => (permDraft ? permDraft[rid] : M.PERM[rid])[i];
  function permChanges() {
    if (!permDraft) return [];
    const out = [];
    permRows().forEach(x => M.ROLES.forEach(r => {
      const from = M.PERM[r.id][x.i], to = permDraft[r.id][x.i];
      if (from !== to) out.push({ rid: r.id, role: r.name, i: x.i, m: x.m, from, to });
    }));
    return out;
  }

  function roleTab() {
    const IC = { 'AUTH': '<span class="tag t-red">授权</span>', 'OP': '<span class="tag t-blue">操作</span>', 'READ': '<span class="tag t-green">查看</span>', '—': '<span class="na">—</span>' };
    return `<div style="flex:1;display:flex;flex-direction:column;min-width:0;padding:12px;overflow:auto">
      <div class="warnbox" style="flex:none">权限等级:<b>授权</b>(可下发反制/干扰等受控指令) &gt; <b>操作</b>(业务处置) &gt; <b>查看</b>(只读)。
        点击单元格循环切换权限；「反制/干扰授权」行与超级管理员列锁定不可改（纪要 §6.3 人在回路）。
        变更须双人复核后生效并记入审计。</div>
      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        ${M.ROLES.map(r => `<div style="flex:1;min-width:150px;border:1px solid var(--line);border-radius:6px;padding:9px;background:var(--panel-2)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="font-size:13px">${r.name}</b><span class="tag ${r.level >= 4 ? 't-red' : 't-blue'}">L${r.level}</span></div>
          <div style="font-size:11.5px;color:var(--txt-3);margin:5px 0">${r.desc}</div>
          <div style="font-size:12px">成员 <b class="mono">${r.users}</b> 人</div></div>`).join('')}
      </div>
      <div class="scroll" style="flex:1;min-height:0">
        <table class="pmx"><thead><tr><th>功能模块</th>${M.ROLES.map(r => `<th>${r.name}</th>`).join('')}</tr></thead>
        <tbody>${permRows().map(x => `<tr ${x.m === '反制/干扰授权' ? 'style="background:rgba(255,77,94,.07)"' : ''}>
          <td>${x.m}</td>${M.ROLES.map(r => {
      const v = permVal(r.id, x.i), dirty = permDraft && M.PERM[r.id][x.i] !== v;
      if (permLocked(r.id, x.m)) return `<td data-pl="${x.m === '反制/干扰授权' ? 'row' : 'col'}"
            style="cursor:not-allowed" title="锁定项，不可修改">${IC[v]}</td>`;
      return `<td data-pc="${r.id}|${x.i}" style="cursor:pointer${dirty ? ';outline:1px dashed var(--amber);outline-offset:-4px' : ''}"
            title="点击切换：授权 → 操作 → 查看 → —">${IC[v]}${dirty ? '<sup style="color:var(--amber);font-size:10px;margin-left:2px">改</sup>' : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>
      </div></div>`;
  }

  /* 保存前的双人复核弹窗：变更清单 + 复核人（R1/R2、状态正常、非本人）。
     确认后才写回 M.PERM 并记审计 —— 状态改了却没有审计正是本仓库一路在治的东西。 */
  function permReviewModal() {
    const chg = permChanges();
    const me = M.currentUser || {};
    const reviewers = M.users.filter(u => ['R1', 'R2'].includes(u.role) && u.status === '正常' && u.id !== me.id);
    const TX = { 'AUTH': '授权', 'OP': '操作', 'READ': '查看', '—': '—' };
    U.modal({
      title: '权限变更双人复核（' + chg.length + ' 项）', width: '640px',
      body: `<div class="warnbox">变更经复核人确认后立即生效并记入操作审计；审计日志不可修改、不可删除。</div>
        ${U.table([
        { t: '功能模块', render: c => c.m },
        { t: '角色', w: '110px', render: c => c.role },
        { t: '变更', w: '150px', render: c => `<span class="mono">${TX[c.from]} → <b style="color:var(--amber)">${TX[c.to]}</b></span>` }
      ], chg)}
        <div style="display:flex;gap:10px;margin-top:12px;align-items:center">
          <span style="flex:none;color:var(--txt-2);font-size:13px">复核人</span>
          <select class="ip" id="pmReviewer" style="flex:1">
            <option value="">请选择（处置授权人及以上，不可为本人）</option>
            ${reviewers.map(u => `<option value="${u.id}">${u.name} · ${u.roleName} · ${u.org}</option>`).join('')}
          </select>
        </div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">复核通过并生效</button>`,
      on: {
        ok: () => {
          const rid = document.getElementById('pmReviewer').value;
          const rv = M.users.find(u => u.id === rid);
          if (!rv) return U.toast('请先选择复核人（§6.3 双人复核）', 'err');
          chg.forEach(c => { M.PERM[c.rid][c.i] = c.to; });
          M.pushAudit('用户与权限', `权限变更 ${chg.length} 项生效（复核人 ${rv.name}）：`
            + chg.map(c => `${c.m}/${c.role} ${TX[c.from]}→${TX[c.to]}`).join('；'), 'PERM');
          permDraft = null;
          U.closeModal();
          U.toast(`权限变更 ${chg.length} 项已生效，已记入操作审计`, 'ok');
          paint();
        }
      }
    });
  }

  /* ---------- 操作审计 ---------- */
  function auditTab() {
    return `<div style="flex:1;display:flex;flex-direction:column;min-width:0">
      ${U.table([
      { t: '时间', k: 'time', w: '150px', cls: 'num' },
      { t: '用户', k: 'user', w: '86px' },
      { t: '角色', k: 'role', w: '96px' },
      { t: '模块', k: 'module', w: '120px' },
      { t: '操作内容', k: 'action' },
      { t: '操作对象', k: 'target', w: '138px', cls: 'num' },
      { t: '结果', w: '110px', render: a => U.tag(a.result, a.result === '成功' ? 't-green' : 't-red') },
      { t: 'IP', k: 'ip', w: '110px', cls: 'num' },
      { t: '终端', k: 'term', w: '76px' }
    ], M.auditLogs, { rowId: a => a.id })}
      <div style="padding:8px 12px;border-top:1px solid var(--line-2);font-size:11.5px;color:var(--txt-3)">
        审计日志不可修改、不可删除;反制/干扰类操作留存期与案件卷宗一致(§6.3)。共 ${M.auditLogs.length} 条。</div></div>`;
  }

  function tools() {
    if (tab === 'user') return `<input class="ip" id="usKw" style="width:180px" placeholder="搜索姓名 / 账号 / 单位" value="${kw}">
      <button class="btn pri" id="usAdd">${U.icon('plus')} 新增用户</button>`;
    if (tab === 'audit') return `${U.select('am', ['全部模块', '处置处罚管理', '设备接入调测', '系统登录'])}
      <button class="btn" id="usExp">${U.icon('download')} 导出审计日志</button>`;
    const n = permChanges().length;
    return `${n ? `<button class="btn" id="usDrop">放弃更改</button>` : ''}
      <button class="btn ${n ? 'pri' : ''}" id="usSave">${U.icon('save')} 保存权限变更${n ? `（${n} 项 · 需双人复核）` : '（需双人复核）'}</button>`;
  }


  function paint() {
    document.getElementById('usBody').innerHTML = tab === 'user' ? userTab() : tab === 'role' ? roleTab() : auditTab();
    document.getElementById('usTools').innerHTML = tools();
    bindTools();
  }
  function bindTools() {
    const kwEl = document.getElementById('usKw');
    if (kwEl) kwEl.oninput = e => { kw = e.target.value.trim(); const d = document.getElementById('usBody'); const st0 = d.querySelector('.scroll') ? d.querySelector('.scroll').scrollTop : 0; d.innerHTML = userTab(); if (d.querySelector('.scroll')) d.querySelector('.scroll').scrollTop = st0; };
    const add = document.getElementById('usAdd');
    if (add) add.onclick = () => U.modal({
      title: '新增用户', width: '540px',
      body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${U.field('账号', `<input class="ip" style="flex:1" placeholder="登录账号">`)}
        ${U.field('姓名', `<input class="ip" style="flex:1" placeholder="真实姓名">`)}
        ${U.field('角色', U.select('r', M.ROLES.map(r => r.name)))}
        ${U.field('所属单位', `<input class="ip" style="flex:1" placeholder="单位全称">`)}
        ${U.field('手机号', `<input class="ip" style="flex:1" placeholder="用于 MFA 与告警通知">`)}
        ${U.field('初始密码', `<input class="ip" style="flex:1" value="首次登录强制修改" disabled>`)}
      </div>
      <label class="chk" style="margin-top:10px"><input type="checkbox">授予「处置授权人」及以上角色须经单位负责人书面批准(§6.3)</label>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">创建</button>`,
      on: { ok: () => { U.closeModal(); U.toast('用户已创建,初始密码已通过短信下发(Demo)', 'ok'); } }
    });
    const sv = document.getElementById('usSave');
    if (sv) sv.onclick = () => permChanges().length ? permReviewModal() : U.toast('暂无改动 —— 点击矩阵单元格切换权限后再保存', 'err');
    const dp = document.getElementById('usDrop');
    if (dp) dp.onclick = () => { permDraft = null; paint(); U.toast('未保存的权限改动已放弃', 'ok'); };
    const ex = document.getElementById('usExp');
    if (ex) ex.onclick = () => U.toast('已导出「操作审计日志.csv」共 ' + M.auditLogs.length + ' 条,导出行为本身已记入审计', 'ok');
  }

  function mount(view) {
    paint();
    U.on(view, '[data-ut]', 'click', (e, el) => {
      tab = el.dataset.ut;
      view.querySelectorAll('[data-ut]').forEach(x => x.classList.toggle('on', x === el));
      paint();
    });
    U.on(view, '[data-row]', 'click', (e, el) => {
      if (tab !== 'user') return;
      sel = M.users.find(u => u.id === el.dataset.row) || sel;
      U.selectRow(view, el.dataset.row);                     // 只切换选中态,列表不重建
      document.getElementById('usDetail').innerHTML = userDetail();
    });
    /* 权限矩阵单元格：点击循环切换（草稿态，保存后才写回 M.PERM） */
    U.on(view, '[data-pc]', 'click', (e, el) => {
      const [rid, i] = el.dataset.pc.split('|');
      if (!permDraft) { permDraft = {}; M.ROLES.forEach(r => { permDraft[r.id] = M.PERM[r.id].slice(); }); }
      const cur = permDraft[rid][+i];
      permDraft[rid][+i] = PERM_ORDER[(PERM_ORDER.indexOf(cur) + 1) % PERM_ORDER.length];
      const d = document.getElementById('usBody');
      const sc = d.querySelector('.scroll') ? d.querySelector('.scroll').scrollTop : 0;
      paint();
      const sc2 = document.getElementById('usBody').querySelector('.scroll');
      if (sc2) sc2.scrollTop = sc;
    });
    U.on(view, '[data-pl]', 'click', (e, el) => {
      U.toast(el.dataset.pl === 'row'
        ? '「反制/干扰授权」行锁定：仅超级管理员与处置授权人可授权（纪要 §6.3 人在回路）'
        : '超级管理员列锁定：该角色定义即全部功能授权，不可降级', 'err');
    });
    U.on(view, '[data-uop]', 'click', (e, el) => {
      e.stopPropagation();
      const [op, id] = el.dataset.uop.split('|');
      const u = M.users.find(x => x.id === id);
      sel = u;
      if (op === 'toggle') {
        u.status = u.status === '正常' ? '已停用' : '正常';
        if (u.status === '已停用') u.online = false;
        const d = document.getElementById('usBody'); d.innerHTML = userTab();
        U.toast(`账号「${u.account}」已${u.status === '正常' ? '启用' : '停用'},操作已记入审计`, u.status === '正常' ? 'ok' : 'err');
      } else if (op === 'reset') {
        U.toast(`已向 ${u.phone} 下发临时密码,首次登录强制修改(Demo)`, 'ok');
      } else {
        U.toast('编辑用户信息(Demo);变更角色须双人复核', 'ok');
      }
    });
  }

  g.PAGES = g.PAGES || {};
  g.PAGES.users = { render, mount };
})(window);
