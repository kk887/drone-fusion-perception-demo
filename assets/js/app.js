/* =============================================================================
 * app.js —— 应用外壳：导航（一级业务中心 + 二级页面）、面包屑、路由、时钟
 *
 * 导航的组织原则：甲方看到的是**业务系统**，不是技术后台。
 * 一级只有 5 个业务中心，运维类页面收进右上角管理员菜单 —— 它们仍然可路由、可演示，
 * 只是不长期占据主导航；把 16 个并列菜单摆在首屏，会让人先感到"复杂"再感到"好用"。
 * ========================================================================== */
(function (g) {
  'use strict';
  const M = MOCK, U = UI;

  /* ---------- 导航模型 ----------
     kids 存在即为可展开的一级模块；没有 kids 的一级模块（综合态势）直接就是页面。 */
  const NAV = [
    { k: 'overview', t: '综合态势', icon: 'home' },
    {
      t: '感知监测', icon: 'radar', kids: [
        { k: 'situation', t: '融合感知' },
        { k: 'monitor', t: '设备实时监测' }
      ]
    },
    {
      t: '飞行监管', icon: 'plan', kids: [
        { k: 'flights', t: '飞行计划' },
        { k: 'legality', t: '合法性研判' }
      ]
    },
    {
      t: '事件处置', icon: 'alert', kids: [
        { k: 'alarms', t: '告警事件' },
        { k: 'punish', t: '处置与处罚' }
      ]
    },
    {
      t: '分析报告', icon: 'chart', kids: [
        { k: 'stats', t: '运行统计' },
        { k: 'evidence', t: '证据管理' }
      ]
    },
    /* 用户指令（2026-08-27）：运维管理从右上角弹窗移入侧栏成组；
       用户与权限、日志归档单独拆成「系统管理」组 —— 运维是设备/接口的事，
       账号与审计是管理的事，混在一个入口里找不着。 */
    {
      t: '运维管理', icon: 'tool', kids: [
        { k: 'devices', t: '设备管理' },
        { k: 'commission', t: '设备接入调测' },
        { k: 'apis', t: '接口管理' }
      ]
    },
    {
      t: '系统管理', icon: 'shield', kids: [
        { k: 'users', t: '用户与权限' },
        { k: 'archive', t: '日志归档' }
      ]
    }
  ];


  /* 菜单外路由曾放过「目标事件工作台」，该功能已按裁定整体删除，保留空数组以便后续复用。 */
  const EXTRA = [];

  /* 路由表：key → {t 页面名, p 所属一级模块, ph 该模块首页} */
  const ROUTES = (function () {
    const r = {};
    NAV.forEach(n => {
      if (n.k) { r[n.k] = { t: n.t, p: null, ph: null }; return; }
      n.kids.forEach(c => { r[c.k] = { t: c.t, p: n.t, ph: n.kids[0].k }; });
    });
    EXTRA.forEach(e => { r[e.k] = { t: e.t, p: e.parent, ph: 'alarms' }; });
    /* 别名路由（risk/airspace 模块并入飞行计划后保留的旧地址）：
       不在 NAV 里，但标题/面包屑必须按落点显示 —— 否则浏览器标签页写着
       「risk · 无人机融合感知平台」，把内部 key 亮给了用户。 */
    r.risk = { t: '飞行计划 · 全部风险事件', p: '飞行监管', ph: 'flights' };
    r.airspace = { t: '飞行计划', p: '飞行监管', ph: 'flights' };
    return r;
  })();
  g.ROUTES = ROUTES;
  const PAGE_THEME = {
    overview: 'overview',
    situation: 'sensing', monitor: 'sensing',
    flights: 'flight', legality: 'flight', risk: 'flight', airspace: 'flight',
    alarms: 'incident', punish: 'incident',
    stats: 'analytics', evidence: 'analytics',
    devices: 'operations', commission: 'operations', apis: 'operations',
    users: 'system', archive: 'system'
  };
  const pageTitle = k => (ROUTES[k] || { t: k }).t;

  /* ---------- 导航渲染 ---------- */
  let openGrp = null;                 // 当前展开的一级模块标题
  function groupOf(k) {
    const r = ROUTES[k];
    return r && r.p ? r.p : null;
  }

  function renderNav() {
    const nav = document.getElementById('nav');
    const cur = curKey();
    if (openGrp === null) openGrp = groupOf(cur);

    nav.innerHTML = NAV.map(n => {
      if (n.k) {           // 无二级的一级模块
        return `<a class="l1 ${cur === n.k ? 'on' : ''}" href="#/${n.k}" data-k="${n.k}">
          <i>${U.icon(n.icon)}</i><span>${n.t}</span></a>`;
      }
      const open = openGrp === n.t;
      const hasCur = n.kids.some(c => c.k === cur);
      return `<div class="g1 ${open ? 'open' : ''} ${hasCur ? 'has' : ''}">
        <div class="l1 gh" data-grp="${n.t}"><i>${U.icon(n.icon)}</i><span>${n.t}</span><b class="ca">›</b></div>
        <div class="l2">${n.kids.map(c =>
        `<a class="${cur === c.k ? 'on' : ''}" href="#/${c.k}" data-k="${c.k}"><em></em><span>${c.t}</span></a>`).join('')}</div>
      </div>`;
    }).join('')
      + `<div class="navfoot">
           <div class="fold" id="fold">« 收起菜单</div>
         </div>`;

    nav.querySelectorAll('[data-grp]').forEach(h => h.onclick = () => {
      const t = h.dataset.grp;
      openGrp = (openGrp === t) ? '' : t;
      renderNav();
    });
    document.getElementById('fold').onclick = () => {
      nav.classList.toggle('mini');
      document.getElementById('fold').textContent = nav.classList.contains('mini') ? '»' : '« 收起菜单';
      window.dispatchEvent(new Event('resize'));
    };
  }


  /* ---------- 面包屑 ---------- */
  /* 页面可以往面包屑尾部挂一段业务上下文（例如当前处理的目标编号），
     用 APP.setCrumb(...) 写入；换页时自动清空。 */
  let crumbCtx = null;
  function renderCrumb() {
    const k = curKey(), r = ROUTES[k] || { t: k };
    const box = document.getElementById('crumb');
    const parts = [`<a href="#/overview">首页</a>`];
    if (r.p) parts.push(`<a href="#/${r.ph}">${r.p}</a>`);
    if (!(k === 'overview')) parts.push(`<span class="c on">${r.t}</span>`);
    else parts[0] = `<span class="c on">综合态势</span>`;
    if (crumbCtx) parts.push(`<span class="c ctx">${crumbCtx}</span>`);

    box.innerHTML = `<div class="cbs">${parts.join('<b>›</b>')}</div>
      <span class="spacer"></span>
      <span class="cinfo">数据统计时间 <b id="ftm">${M.nowStr()}</b></span>
      <span class="cinfo">WGS-84 · 椭球高</span>
      <span class="cinfo" id="fver">${M.CONF.version}</span>`;
  }

  /* ---------- 路由 ---------- */
  const curKey = () => (location.hash.replace('#/', '') || 'overview').split('?')[0];
  let current = null;
  function route() {
    const k = curKey();
    document.body.dataset.page = k;
    document.body.dataset.theme = PAGE_THEME[k] || 'overview';
    const known = !!ROUTES[k];
    const page = g.PAGES[k] || (known ? {
      render: () => `<div class="panel" style="margin-top:12px"><div class="pb" style="padding:28px">
        <div class="inline-icon" style="font-size:15px;color:#ffb083;margin-bottom:10px">${U.icon('warning')} 页面模块未加载：<span class="mono">${k}</span></div>
        <div style="font-size:13px;color:var(--txt-2);line-height:1.8">
          导航中存在该页面，但 <span class="mono">window.PAGES.${k}</span> 未定义。<br>
          常见原因：<span class="mono">index.html</span> 缺少对应的 script 标签，或该模块在加载时抛出了异常
          （此时控制台会有报错，且该报错通常出现在<b>它自己的文件</b>里）。<br>
          <b style="color:#ffb083">这里没有回落到总览</b> —— 静默回落会让人以为这个页面就长成总览的样子。
        </div></div></div>`
    } : g.PAGES.overview);

    crumbCtx = null;
    openGrp = groupOf(k) || openGrp;
    // 清理上一页资源
    CH.disposeAll();
    if (current && current.destroy) { try { current.destroy(); } catch (e) { } }
    U.closeModal();
    // 用全新的容器节点替换旧容器：页面通过事件委托绑在容器上的监听器随之销毁。
    const old = document.getElementById('view');
    const view = old.cloneNode(false);
    old.parentNode.replaceChild(view, old);
    view.scrollTop = 0;
    view.innerHTML = page.render();
    current = page;
    if (page.mount) page.mount(view);
    renderNav(); renderCrumb();
    document.title = pageTitle(k) + ' · 无人机融合感知平台';
  }

  g.APP = {
    rerender: function () { route(); },
    setCrumb: function (txt) { crumbCtx = txt; renderCrumb(); },
    pageTitle: pageTitle,
    routes: ROUTES
  };

  /* ---------- 时钟 / 顶栏 ---------- */
  function clock() {
    /* 平台当前时刻只有一个来源：M.now()。 */
    const tick = () => {
      const s = M.nowStr();
      document.getElementById('clk').innerHTML = `${U.icon('clock')} ${s}`;
      const f = document.getElementById('ftm'); if (f) f.textContent = s;
    };
    tick();
    setInterval(tick, 1000);
    document.getElementById('wea').innerHTML =
      `${M.CONF.city} ${U.icon('cloud')} ${M.CONF.weather.tempLo}℃ ~ ${M.CONF.weather.tempHi}℃ ${M.CONF.weather.text}`;
    document.getElementById('bellN').textContent = M.todayStats.pendingAlarm + M.todayStats.disposing;
    document.getElementById('bell').onclick = () => { location.hash = '#/alarms'; };

    const menu = document.createElement('div');
    menu.className = 'usermenu';
    menu.innerHTML = `
      <div class="mi" data-um="me">${U.icon('user')} 个人信息</div>
      <div class="mi" data-um="ops">${U.icon('settings')} 运维管理</div>
      <div class="mi" data-um="users">${U.icon('shield')} 用户与权限</div>
      <div class="mi" data-um="carousel">${U.icon('play')} 大屏轮播</div>
      <div class="sep"></div>
      <div class="mi" data-um="logout">${U.icon('logout')} 退出登录</div>`;
    document.body.appendChild(menu);
    const userBtn = document.querySelector('.hdr .user');
    userBtn.onclick = e => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      userBtn.setAttribute('aria-expanded', String(open));
    };
    document.addEventListener('click', () => {
      menu.classList.remove('open');
      userBtn.setAttribute('aria-expanded', 'false');
    });
    menu.addEventListener('click', e => {
      const mi = e.target.closest('[data-um]'); if (!mi) return;
      menu.classList.remove('open');
      userBtn.setAttribute('aria-expanded', 'false');
      const k = mi.dataset.um;
      if (k === 'users') location.hash = '#/users';
      else if (k === 'carousel') carouselDlg();
      else if (k === 'me') UI.modal({
        title: '个人信息', width: '440px',
        body: UI.kv([['账号', 'admin'], ['姓名', '系统管理员'], ['角色', '超级管理员'],
        ['所属单位', '东营市低空安全管理中心'], ['双因子认证', '已开启'],
        ['最后登录', MOCK.util.fmtDT(MOCK.CONF.demoTime)], ['登录 IP', '10.20.1.15']])
      });
      else UI.toast('已退出登录(Demo 环境不跳转登录页)', 'ok');
    });
  }

  /* ---------- 大屏模式 ---------- */
  function bindBigScreen() {
    const btn = document.getElementById('btnBig');
    const label = on => `${U.icon('fullscreen')} ${on ? '退出大屏' : '大屏'}`;
    btn.innerHTML = label(false);
    btn.onclick = () => {
      const on = document.body.classList.toggle('bigscreen');
      btn.innerHTML = label(on);
      if (on && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => { });
      } else if (!on && document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => { });
      }
      window.dispatchEvent(new Event('resize'));
      UI.toast(on ? '已进入大屏模式（字号放大，适配指挥大厅）' : '已退出大屏模式', 'ok');
    };
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && document.body.classList.contains('bigscreen')) {
        document.body.classList.remove('bigscreen');
        btn.innerHTML = label(false);
        window.dispatchEvent(new Event('resize'));
      }
    });
  }

  /* ---------- 大屏轮播（移入管理员菜单，不再占顶栏） ---------- */
  let carTimer = null, carTick = null;
  const CAROUSEL_DEFAULT = ['overview', 'situation', 'alarms', 'flights', 'punish'];
  function stopCarousel() {
    clearInterval(carTimer); clearInterval(carTick); carTimer = carTick = null;
    document.querySelectorAll('.carousel-bar,.carousel-chip').forEach(e => e.remove());
  }
  function startCarousel(pages, sec) {
    stopCarousel();
    const bar = document.createElement('div'); bar.className = 'carousel-bar';
    const chip = document.createElement('div'); chip.className = 'carousel-chip';
    document.body.appendChild(bar); document.body.appendChild(chip);
    let i = Math.max(0, pages.indexOf(curKey()));
    let left = sec;
    const paint = () => {
      chip.innerHTML = `<span>轮播中 <b>${i + 1}/${pages.length}</b> · ${pageTitle(pages[i])}</span>
        <span style="color:var(--txt-3)">${left}s 后切换</span><button class="icon-btn x" type="button" title="停止轮播" aria-label="停止轮播">${U.icon('close')}</button>`;
      chip.querySelector('.x').onclick = () => { stopCarousel(); UI.toast('已停止轮播'); };
      bar.style.width = ((sec - left) / sec * 100).toFixed(1) + '%';
    };
    location.hash = '#/' + pages[i]; paint();
    carTick = setInterval(() => { left--; if (left < 0) left = sec; paint(); }, 1000);
    carTimer = setInterval(() => {
      i = (i + 1) % pages.length; left = sec;
      location.hash = '#/' + pages[i]; paint();
    }, sec * 1000);
  }
  function carouselDlg() {
    if (carTimer) { stopCarousel(); UI.toast('已停止轮播'); return; }
    const all = Object.keys(ROUTES);
    UI.modal({
      title: '大屏轮播设置', width: '520px',
      body: `<div class="warnbox">用于指挥大厅无人值守展示：按设定间隔自动切换页面，随时可停止。</div>
        ${UI.field('切换间隔', UI.select('sec', [{ v: 10, t: '10 秒' }, { v: 15, t: '15 秒' }, { v: 30, t: '30 秒' }, { v: 60, t: '60 秒' }], 15))}
        <div style="margin:12px 0 6px;font-size:13px;color:var(--txt-2)">参与轮播的页面</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;max-height:230px;overflow:auto">
          ${all.map(k => `<label class="chk" style="margin:2px 0"><input type="checkbox" data-cp="${k}"
            ${CAROUSEL_DEFAULT.includes(k) ? 'checked' : ''}>${pageTitle(k)}</label>`).join('')}
        </div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="go">开始轮播</button>`,
      on: {
        go: el => {
          const pages = [...el.querySelectorAll('[data-cp]')].filter(c => c.checked).map(c => c.dataset.cp);
          if (!pages.length) return UI.toast('请至少选择一个页面', 'err');
          const sec = +el.querySelector('[data-f="sec"]').value;
          UI.closeModal();
          startCarousel(pages, sec);
          UI.toast(`轮播已开始：${pages.length} 个页面 · ${sec} 秒/页`, 'ok');
        }
      }
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    clock();
    bindBigScreen();
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/overview';
    route();
  }
  document.addEventListener('DOMContentLoaded', boot);
})(window);
