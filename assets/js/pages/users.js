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
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#3d8bff,#22d3ee);
          display:flex;align-items:center;justify-content:center;font-size:17px;color:#04091c;font-weight:700">${u.name[0]}</div>
        <div><b style="font-size:14px">${u.name}</b><div style="font-size:11.5px;color:var(--txt-3)">@${u.account}</div></div>
        <span style="margin-left:auto">${U.tag(u.roleName, u.role === 'R2' ? 't-orange' : 't-blue')}</span></div>
      ${U.kv([['所属单位', u.org], ['联系电话', u.phone], ['账号状态', U.tag(u.status, u.status === '正常' ? 't-green' : 't-gray')],
      ['双因子认证', u.mfa], ['创建时间', u.createdAt], ['最后登录', u.lastLogin], ['登录 IP', `<span class="mono">${u.lastIp}</span>`],
      ['反制/干扰授权', ['R1', 'R2'].includes(u.role) ? '<span class="tag t-red">可授权（§6.3 双人确认）</span>' : '<span class="tag t-gray">无权限</span>']])}
      ${U.sect('近期操作（' + myAudit.length + '）', myAudit.length
        ? myAudit.map(a => `<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:4px 0;border-bottom:1px solid rgba(64,158,255,.08)">
            <span style="color:var(--txt-2)">${a.action}</span><span class="mono" style="color:var(--txt-3)">${a.time.slice(5, 16)}</span></div>`).join('')
        : '<div class="empty" style="padding:8px">暂无操作记录</div>')}`;
  }

  /* ---------- 角色与权限矩阵 ---------- */
  function roleTab() {
    const IC = { 'AUTH': '<span class="tag t-red">授权</span>', 'OP': '<span class="tag t-blue">操作</span>', 'READ': '<span class="tag t-green">查看</span>', '—': '<span class="na">—</span>' };
    return `<div style="flex:1;display:flex;flex-direction:column;min-width:0;padding:12px;overflow:auto">
      <div class="warnbox" style="flex:none">权限等级:<b>授权</b>(可下发反制/干扰等受控指令) &gt; <b>操作</b>(业务处置) &gt; <b>查看</b>(只读)。
        「反制/干扰授权」行仅超级管理员与处置授权人开放,与纪要 §6.3 人在回路要求一致;变更权限须双人复核并记入审计。</div>
      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        ${M.ROLES.map(r => `<div style="flex:1;min-width:150px;border:1px solid var(--line);border-radius:6px;padding:9px;background:var(--panel-2)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="font-size:13px">${r.name}</b><span class="tag ${r.level >= 4 ? 't-red' : 't-blue'}">L${r.level}</span></div>
          <div style="font-size:11.5px;color:var(--txt-3);margin:5px 0">${r.desc}</div>
          <div style="font-size:12px">成员 <b class="mono">${r.users}</b> 人</div></div>`).join('')}
      </div>
      <div class="scroll" style="flex:1;min-height:0">
        <table class="pmx"><thead><tr><th>功能模块</th>${M.ROLES.map(r => `<th>${r.name}</th>`).join('')}</tr></thead>
        <tbody>${M.PERM_MODULES.map((m, i) => `<tr ${m === '反制/干扰授权' ? 'style="background:rgba(255,77,94,.07)"' : ''}>
          <td>${m}</td>${M.ROLES.map(r => `<td>${IC[M.PERM[r.id][i]]}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </div></div>`;
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
      <button class="btn pri" id="usAdd">＋ 新增用户</button>`;
    if (tab === 'audit') return `${U.select('am', ['全部模块', '处置处罚管理', '设备接入调测', '系统登录'])}
      <button class="btn" id="usExp">⭳ 导出审计日志</button>`;
    return `<button class="btn" id="usSave">💾 保存权限变更（需双人复核）</button>`;
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
    if (sv) sv.onclick = () => U.toast('权限变更已提交双人复核,复核通过后生效并记入审计(Demo)', 'ok');
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
