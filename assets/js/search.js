/* =============================================================================
 * search.js —— COM-05 统一检索（《软件需求规格说明书 报价版》P0）
 *
 * 需求原文：「支持按目标、设备、计划、告警、案件、时间和区域检索」。
 * 其中「时间」与「区域」不是实体，是**筛选维度** —— 做成关键字识别而不是再加两个下拉：
 * 检索框是命令面板形态，值守敲的是「UAV20260826 东营区 今天」这种连写，
 * 识别出来的条件以 chip 形式回显，让人看得见系统理解成了什么。
 *
 * 独立模块：不改 ui.js / app.js / app.css，样式走内联，入口自己挂到顶栏。
 * index.html 只加了一行 <script src="assets/js/search.js">（必须在 app.js 之后）。
 * ========================================================================== */
(function (g) {
  'use strict';

  const M = g.MOCK, U = g.UI;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const HOTKEY = MAC ? 'Command+K' : 'Ctrl+K';
  const PER_GROUP = 6;              // 每组最多列这么多条，其余给出「另有 N 条」

  /* ---------------- 时间与区域的关键字识别 ---------------- */
  const DAY = 864e5;
  function ymdOf(d) { return M.util.ymd(d); }

  /* 从查询串里剥出「区域」与「时间」，剩下的才是关键字 */
  function parseQuery(q) {
    let rest = ' ' + q.trim() + ' ';
    let district = null, time = null, timeTx = '';

    M.DISTRICTS.forEach(d => {
      if (district) return;
      const short = d.name.replace(/[区县]$|经济区$/, '');
      [d.name, short].forEach(n => {
        if (!district && n && n.length >= 2 && rest.indexOf(n) >= 0) {
          district = d.name;
          rest = rest.replace(n, ' ');
        }
      });
    });

    const now = M.CONF.demoTime;
    const RANGES = [
      [/今天|今日/, () => { const y = ymdOf(now); return { from: y, to: y, tx: '今天' }; }],
      [/昨天|昨日/, () => { const y = ymdOf(M.util.dayAdd(now, -1)); return { from: y, to: y, tx: '昨天' }; }],
      [/近\s*7\s*天|近七天|本周/, () => ({ from: ymdOf(M.util.dayAdd(now, -6)), to: ymdOf(now), tx: '近 7 天' })],
      [/近\s*30\s*天|近三十天|本月/, () => ({ from: ymdOf(M.util.dayAdd(now, -29)), to: ymdOf(now), tx: '近 30 天' })]
    ];
    for (const [re, f] of RANGES) {
      const m = rest.match(re);
      if (m) { const r = f(); time = r; timeTx = r.tx; rest = rest.replace(m[0], ' '); break; }
    }
    if (!time) {
      // 显式日期：2026-08-26 / 2026/8/26 / 08-26
      const m = rest.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/) || rest.match(/(?:^|\s)(\d{1,2})[-/.](\d{1,2})(?=\s)/);
      if (m) {
        const y = m.length === 4 ? +m[1] : now.getFullYear();
        const mo = m.length === 4 ? +m[2] : +m[1];
        const da = m.length === 4 ? +m[3] : +m[2];
        const n = y * 10000 + mo * 100 + da;
        time = { from: n, to: n, tx: `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}` };
        timeTx = time.tx;
        rest = rest.replace(m[0], ' ');
      }
    }
    return { kw: rest.trim().replace(/\s+/g, ' '), district, time, timeTx };
  }

  /* ---------------- 六类实体 ----------------
     每类给出：数据源 / 匹配字段 / 展示行 / 所属区域 / 事件日 / 打开方式。
     timeScoped=false 的（设备）是台账类，没有"发生时间"，不参与时间筛选，
     命中时在分组标题上直说「不受时间筛选」，不装作筛过了。 */
  const ENTITIES = [
    {
      key: 'target', label: '目标', icon: 'plane', page: 'legality', timeScoped: true,
      list: () => M.allTargets,
      district: o => o.district,
      day: o => o.ymd,
      text: o => [o.id, o.type, o.subtype, o.model, o.pilot, o.partner, o.district,
        o.legal_status || o.legal, o.risk_level || o.risk,
        o.violation, (o.violation_reasons || []).join(' '), o.uav_sn].join(' '),
      row: o => ({
        title: o.id,
        tags: [tag(o.legal_status || o.legal, legalCls(o.legal_status || o.legal)),
          o.risk_level || o.risk ? tag(o.risk_level || o.risk, riskCls(o.risk_level || o.risk)) : ''],
        meta: [o.subtype || o.type, o.district, o.time,
          (o.violation_reasons && o.violation_reasons.length) ? '违规：' + o.violation_reasons.join('、') : '']
      }),
      /* 非无人机目标不进合法性判定页（§4.2），落到空间安全风险页的对应事件 */
      open: o => {
        if (o.type === '无人机') return { page: 'legality', ctx: { target: o.id }, rowId: o.id };
        const ev = (M.riskEvents || []).find(r => r.targetId === o.id);
        if (ev) return { page: 'risk', ctx: { eventId: ev.id }, rowId: ev.id };
        return { page: 'risk', warn: `目标 ${o.id} 不是无人机，也不在近 7 天的空间安全风险事件里，已跳转到该页但无法自动选中` };
      }
    },
    {
      key: 'device', label: '设备', icon: 'radar', page: 'devices', timeScoped: false,
      list: () => M.devices,
      district: o => o.region,
      text: o => [o.id, o.name, o.type, o.cat, o.channel, o.vendor, o.owner, o.region,
        o.addr, o.ip, o.status, o.health, o.alarm ? '告警' : ''].join(' '),
      row: o => ({
        title: o.id,
        tags: [tag(o.status, o.status === '在线' ? 't-green' : o.status === '离线' ? 't-gray' : 't-red'),
          o.alarm ? tag('告警', 't-orange') : ''],
        meta: [o.name, o.type + ' / ' + o.channel, o.region, '心跳 ' + o.hb]
      }),
      open: o => ({ page: 'devices', kwSel: '#dvKw', kw: o.id, rowId: o.id })
    },
    {
      key: 'flight', label: '飞行计划', icon: 'clipboard', page: 'flights', timeScoped: true,
      list: () => M.flightPlans,
      district: o => o.region,
      day: o => +String(o.start).slice(0, 10).replace(/-/g, ''),
      text: o => [o.id, o.droneId, o.model, o.partner, o.pilot, o.purpose, o.region,
        o.approver, o.status, o.matched].join(' '),
      row: o => ({
        title: o.id,
        tags: [tag(o.status), o.matched ? tag(o.matched, o.matched === '已匹配' ? 't-green' : 't-amber') : ''],
        meta: [o.partner + ' · ' + o.pilot, o.droneId, o.region, o.start]
      }),
      open: o => ({ page: 'flights', kwSel: '#flKw', kw: o.id, rowId: o.id })
    },
    {
      key: 'alarm', label: '告警', icon: 'warning', page: 'alarms', timeScoped: true,
      list: () => M.alarms,
      district: o => o.district,
      day: o => o.ymd,
      text: o => [o.id, o.targetId, o.type, o.kind, o.district, o.status, o.detail].join(' '),
      row: o => ({
        title: o.id,
        tags: [tag(o.level, o.level === '高' ? 't-red' : o.level === '中' ? 't-amber' : 't-blue'), tag(o.status)],
        meta: [o.type, '目标 ' + o.targetId, o.district, o.time]
      }),
      open: o => { sessionStorage.setItem('alarm.sel', o.id); return { page: 'alarms', rowId: o.id }; }  // 告警页用的是自己的 key
    },
    {
      key: 'case', label: '处罚案件', icon: 'scale', page: 'punish', timeScoped: true,
      list: () => M.cases,
      district: o => o.district,
      day: o => o.ymd,
      text: o => [o.id, o.targetId, o.partner, o.pilot, o.model, o.violation, o.district,
        o.docNo, o.officer, o.status, o.penalty].join(' '),
      row: o => ({
        title: o.id,
        tags: [tag(o.status), o.penalty ? tag(o.penalty, 't-purple') : ''],
        meta: [o.violation, o.partner, o.district, o.time]
      }),
      open: o => ({ page: 'punish', ctx: { caseId: o.id }, rowId: o.id })
    },
    /* 空域类目已随「空域与航线」模块删除。
       检索里留一个点了没落点的类目，比没有这个类目更糟 ——
       用户搜到结果、点开、跳去一个不存在的页面。 */
  ];

  const tag = (t, c) => (t ? U.tag(t, c) : '');
  const legalCls = l => ({ '非法': 't-red', '异常': 't-orange', '待确认': 't-amber', '合法': 't-green', '不适用': 't-gray' })[l];
  const riskCls = r => ({ '超高风险': 't-red', '高风险': 't-red', '中风险': 't-amber', '低风险': 't-blue' })[r] || 't-gray';

  /* ---------------- 检索 ---------------- */
  function search(raw) {
    const q = parseQuery(raw);
    const kw = q.kw.toLowerCase();
    const parts = kw ? kw.split(' ').filter(Boolean) : [];
    const groups = ENTITIES.map(e => {
      let hits = e.list();
      if (q.district) hits = hits.filter(o => e.district(o) === q.district);
      if (q.time && e.timeScoped && e.day) hits = hits.filter(o => { const d = e.day(o); return d >= q.time.from && d <= q.time.to; });
      if (parts.length) {
        hits = hits.filter(o => { const t = e.text(o).toLowerCase(); return parts.every(p => t.indexOf(p) >= 0); });
      } else if (!q.district && !q.time) {
        hits = [];              // 无任何条件时不列全库
      }
      // 精确命中编号的排到最前，其余保持数据层顺序
      if (parts.length) {
        const exact = parts.join('');
        hits = hits.slice().sort((a, b) => score(b, exact) - score(a, exact));
      }
      return { e, total: hits.length, items: hits.slice(0, PER_GROUP) };
    }).filter(gp => gp.total > 0);
    return { q, groups, total: groups.reduce((s, gp) => s + gp.total, 0) };
  }
  function score(o, exact) {
    const id = String(o.id).toLowerCase();
    return id === exact ? 3 : id.indexOf(exact) === 0 ? 2 : id.indexOf(exact) >= 0 ? 1 : 0;
  }

  /* ---------------- 面板 ---------------- */
  let box = null, flat = [], cur = -1, timer = null;
  let settleGen = 0;                // 每次跳转自增：上一次的 settle 轮询必须停手，
                                    // 否则它会在**新页面**上乱点行和翻页

  const S = {
    mask: 'position:fixed;inset:0;background:rgba(2,7,20,.62);backdrop-filter:blur(3px);z-index:900;'
      + 'display:flex;align-items:flex-start;justify-content:center;padding-top:9vh',
    row: 'display:flex;align-items:center;gap:10px;padding:7px 14px;cursor:pointer;border-left:2px solid transparent'
  };

  function open(preset) {
    if (box) return focusInput();
    box = document.createElement('div');
    box.setAttribute('style', S.mask);
    box.innerHTML = `
      <div style="width:min(760px,92vw);max-height:78vh;display:flex;flex-direction:column;
        background:#0a1730;border:1px solid rgba(64,158,255,.32);border-radius:10px;
        box-shadow:0 18px 60px rgba(0,0,0,.55);overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(64,158,255,.18)">
          <span class="field-icon" style="font-size:15px;color:#9ec6ff">${U.icon('search')}</span>
          <input id="gsInput" class="ip" style="flex:1;height:34px;font-size:14px;background:transparent;border:none;outline:none"
            placeholder="目标编号 / 设备 / 计划 / 告警 / 案件　可连写区域与时间，如「东营区 今天」" autocomplete="off">
          <span style="font-size:11px;color:var(--txt-3);white-space:nowrap">Esc 关闭</span>
        </div>
        <div id="gsChips" style="padding:0 14px"></div>
        <div id="gsBody" style="flex:1;overflow:auto;padding:6px 0 10px"></div>
        <div style="padding:7px 14px;border-top:1px solid rgba(64,158,255,.18);font-size:11px;color:var(--txt-3);
          display:flex;gap:14px;flex-wrap:wrap">
          <span>↑ ↓ 选择</span><span>Enter 打开并选中该行</span><span>${HOTKEY} 唤起</span>
          <span style="flex:1"></span><span>COM-05 统一检索</span>
        </div>
      </div>`;
    document.body.appendChild(box);
    box.addEventListener('mousedown', e => { if (e.target === box) close(); });
    const inp = box.querySelector('#gsInput');
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 110); });
    inp.addEventListener('keydown', onKey);
    if (preset) inp.value = preset;
    focusInput();
    run();
  }
  function focusInput() { const i = box && box.querySelector('#gsInput'); if (i) { i.focus(); i.select(); } }
  function close() { if (box) { box.remove(); box = null; flat = []; cur = -1; } }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); return close(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
      paintActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur >= 0 && flat[cur]) openItem(flat[cur]);
    }
  }
  function paintActive() {
    if (!box) return;
    box.querySelectorAll('[data-gi]').forEach(el => {
      const on = +el.dataset.gi === cur;
      el.style.background = on ? 'rgba(61,139,255,.20)' : 'transparent';
      el.style.borderLeftColor = on ? 'var(--blue)' : 'transparent';
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function run() {
    if (!box) return;
    const raw = box.querySelector('#gsInput').value;
    const chips = box.querySelector('#gsChips');
    const body = box.querySelector('#gsBody');
    const r = search(raw);
    flat = []; cur = -1;

    /* 识别出来的条件必须回显 —— 否则用户敲了「东营区」却不知道系统当成了区域筛选 */
    const cs = [];
    if (r.q.district) cs.push(`<span class="tag t-cyan">区域：${r.q.district}</span>`);
    if (r.q.timeTx) cs.push(`<span class="tag t-purple">时间：${r.q.timeTx}</span>`);
    if (r.q.kw) cs.push(`<span class="tag t-gray">关键字：${esc(r.q.kw)}</span>`);
    chips.innerHTML = cs.length
      ? `<div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 0 2px;align-items:center">
          <span style="font-size:11.5px;color:var(--txt-3)">已识别</span>${cs.join('')}
          <span style="flex:1"></span>
          <span style="font-size:11.5px;color:var(--txt-3)">共 ${r.total} 条</span></div>` : '';

    if (!raw.trim()) { body.innerHTML = hint(); return; }
    if (!r.groups.length) { body.innerHTML = empty(r.q); return; }

    let i = 0;
    body.innerHTML = r.groups.map(gp => {
      const skip = r.q.time && !gp.e.timeScoped
        ? `<span style="color:var(--txt-3);font-weight:400;margin-left:6px">台账类，不受时间筛选</span>` : '';
      const rows = gp.items.map(o => {
        const d = gp.e.row(o);
        flat.push({ e: gp.e, o: o });
        return `<div data-gi="${i++}" style="${S.row}">
          <span class="mono" style="width:158px;flex:none;color:#cfe0f8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.title}</span>
          <span style="flex:none;display:flex;gap:4px">${d.tags.filter(Boolean).join('')}</span>
          <span style="flex:1;min-width:0;font-size:11.5px;color:var(--txt-3);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${d.meta.filter(Boolean).join(' · ')}</span>
        </div>`;
      }).join('');
      const more = gp.total > gp.items.length
        ? `<div style="padding:3px 14px 6px;font-size:11px;color:var(--txt-3)">
             另有 ${gp.total - gp.items.length} 条未列出，可补充关键字缩小范围</div>` : '';
      return `<div style="padding:8px 14px 3px;font-size:11.5px;color:#9ec6ff;font-weight:600">
          <span class="inline-icon">${U.icon(gp.e.icon)} ${gp.e.label}</span> <span style="color:var(--txt-3);font-weight:400">${gp.total}</span>${skip}</div>${rows}${more}`;
    }).join('');

    body.querySelectorAll('[data-gi]').forEach(el => {
      el.onmouseenter = () => { cur = +el.dataset.gi; paintActive(); };
      el.onclick = () => openItem(flat[+el.dataset.gi]);
    });
    cur = 0; paintActive();
  }

  function hint() {
    return `<div style="padding:16px 16px 6px;font-size:12.5px;color:var(--txt-2)">检索六类对象</div>
      <div style="padding:0 16px;display:flex;gap:6px;flex-wrap:wrap">
        ${ENTITIES.map(e => `<span class="tag t-gray inline-icon">${U.icon(e.icon)} ${e.label} ${U.num(e.list().length)}</span>`).join('')}
      </div>
      <div style="padding:14px 16px 6px;font-size:12.5px;color:var(--txt-2)">试试这些</div>
      <div style="padding:0 16px;display:flex;gap:6px;flex-wrap:wrap">
        ${[sampleTarget(), sampleDevice(), '东营区 今天', '非法', '禁飞'].filter(Boolean)
        .map(x => `<span class="tag t-cyan" data-gs-eg="${esc(x)}" style="cursor:pointer">${esc(x)}</span>`).join('')}
      </div>
      <div style="padding:14px 16px 0;font-size:11.5px;color:var(--txt-3);line-height:1.8">
        区域与时间可以和关键字连写，会被识别成筛选条件并在上方回显；
        时间支持「今天 / 昨天 / 近 7 天 / 近 30 天」与具体日期（2026-08-26）。<br>
        设备属台账类、没有发生时间，不参与时间筛选。
      </div>`;
  }
  function sampleTarget() { const t = (M.todayTargets || M.allTargets)[0]; return t ? t.id : ''; }
  function sampleDevice() { const d = M.devices[0]; return d ? d.id : ''; }

  function empty(q) {
    const conds = [q.district ? `区域=${q.district}` : '', q.timeTx ? `时间=${q.timeTx}` : '',
      q.kw ? `关键字=${esc(q.kw)}` : ''].filter(Boolean).join('，');
    return `<div class="empty" style="padding:34px 20px">
      没有匹配的记录<div style="margin-top:8px;font-size:11.5px;color:var(--txt-3);line-height:1.9">
      当前条件：${conds || '（空）'}<br>
      若条件里含区域或时间，先去掉它们再试 —— 它们与关键字是<b>同时</b>生效的筛选，不是备选项。</div></div>`;
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- 打开：跳页 + 选中那一行 ----------------
     三条路径，优先级从高到低：
       1) 目标页支持 U.consume 深链（合法性判定 / 处罚 / 风险）—— 最可靠
       2) 页内有关键字筛选框（设备 #dvKw / 计划 #flKw）—— 填编号触发 input 把列表筛到一条
       3) 都没有 —— 直接找 [data-row] 点它
     三条都不成的，如实 toast 说明，不假装已经定位到。 */
  function openItem(it) {
    if (!it) return;
    const r = it.e.open(it.o);
    close();
    if (!r || !r.page) return;
    settleGen++;
    if (r.ctx) U.goto(r.page, r.ctx);                    // 写跨页上下文再跳，目标页 render 时 consume
    else if (location.hash !== '#/' + r.page) location.hash = '#/' + r.page;
    else if (g.APP && g.APP.rerender) g.APP.rerender();  // 已在本页：重绘一次让上下文生效
    settle(r);
  }

  /* 跳过去之后把那一行真正选中。三级兜底，全部失败才如实说明：
       ① 页内有关键字筛选框（设备 #dvKw / 计划 #flKw）→ 填编号，列表自己筛到一条
       ② 直接找 [data-row]（全站列表都由 U.table 生成，这个属性是通用契约）
       ③ 行不在当前分页 → 按页码逐页翻着找（有上限）
     ③ 是必要的：有的页面的深链只设了选中项、没有把列表翻到它所在那一页，
     结果右侧详情是对的、左侧列表里却找不到这一行 —— 那等于没跳到位。 */
  function settle(r) {
    if (!r.rowId) { if (r.warn) setTimeout(() => U.toast(r.warn, 'err'), 400); return; }
    let n = 0, hops = 0, tried = {};
    const gen = settleGen, MAX_TICK = 40, MAX_HOP = 12;
    (function tick() {
      // 又发起了新的跳转，或用户自己切走了页面 —— 立刻停手
      if (gen !== settleGen || location.hash !== '#/' + r.page) return;
      n++;
      const view = document.getElementById('view');
      if (!view) return n < MAX_TICK ? setTimeout(tick, 60) : void 0;

      if (r.kwSel && r.kw) {
        const inp = view.querySelector(r.kwSel) || document.querySelector(r.kwSel);
        if (!inp) { if (n < MAX_TICK) return setTimeout(tick, 60); }
        else if (inp.value !== r.kw) {
          inp.value = r.kw;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return setTimeout(tick, 80);
        }
      }

      const tr = view.querySelector(`[data-row="${cssEsc(r.rowId)}"]`);
      if (tr) {
        tr.click();
        tr.scrollIntoView({ block: 'center' });
        return;
      }

      // 还没渲染出列表就再等等
      if (!view.querySelector('[data-row]') && n < MAX_TICK) return setTimeout(tick, 60);

      /* 翻页找。不能只点数字页码 —— U.pager 页多时会折叠成「1 2 … 7 8」，
         中间几页根本没有按钮。改为点「›」下一页（它是最后一个 [data-pg]，
         其 data-pg 恒为「当前页+1」），到末页再回到第 1 页，每页只走一次。 */
      const pgs = [...view.querySelectorAll('[data-pg]')];
      if (!pgs.length) { U.toast(`已跳转到该页，但列表里没有 ${r.rowId}`, 'err'); return; }
      const maxPage = Math.max(...pgs.map(x => +x.dataset.pg).filter(v => v > 0));
      const curEl = view.querySelector('.pg.on');
      const curPage = curEl ? +curEl.textContent.trim() : 1;
      tried[curPage] = 1;
      if (hops < Math.min(MAX_HOP, maxPage) && Object.keys(tried).length < maxPage) {
        hops++;
        const nextPage = curPage >= maxPage ? 1 : curPage + 1;
        const btn = pgs.find(x => +x.dataset.pg === nextPage && !x.classList.contains('dis'))
          || pgs[pgs.length - 1];
        if (btn && btn.dataset.pg) { btn.click(); return setTimeout(tick, 30); }
      }
      U.toast(`已跳转到该页，但在列表的 ${maxPage} 页里没找到 ${r.rowId}，请用页内筛选定位`, 'err');
    })();
  }

  const cssEsc = s => String(s).replace(/["\\]/g, '\\$&');

  /* ---------------- 挂载 ---------------- */
  function mount() {
    const meta = document.querySelector('.hdr .meta');
    if (!meta || document.getElementById('btnSearch')) return;
    const wrap = document.createElement('span');
    wrap.className = 'it';
    wrap.innerHTML = `<button class="btn ghost" id="btnSearch" title="统一检索：目标 / 设备 / 计划 / 告警 / 案件（${HOTKEY}）"
      style="gap:6px">${U.icon('search')} 检索<span style="font-size:10.5px;opacity:.65;border:1px solid var(--line);
      border-radius:3px;padding:0 4px;line-height:15px">${HOTKEY}</span></button>`;
    meta.insertBefore(wrap, meta.querySelector('.bell') || meta.lastChild);
    document.getElementById('btnSearch').onclick = () => open('');

    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(''); }
    });
    // 示例 chip 点一下就填进去
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-gs-eg]');
      if (t && box) { const i = box.querySelector('#gsInput'); i.value = t.dataset.gsEg; i.focus(); run(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* 按「实体类型 + 编号」跳转并选中 —— 证据台账的反向引用直接复用这里，
     不在别的文件里再抄一份「哪个页面用哪种深链」的对照表。
     kind 取值与 MOCK.evidenceRefs 一致：case / target / alarm / riskEvent / commTask / device / airspace */
  function goEntity(kind, id) {
    const M2 = g.MOCK;
    if (kind === 'case') return openItem({ e: ENTITIES.find(e => e.key === 'case'), o: { id } });
    /* airspace 分支已删：类目不存在，ENTITIES.find 会返回 undefined 并在 openItem 里抛错。 */
    if (kind === 'alarm') return openItem({ e: ENTITIES.find(e => e.key === 'alarm'), o: { id } });
    if (kind === 'device') return openItem({ e: ENTITIES.find(e => e.key === 'device'), o: { id } });
    if (kind === 'target') {
      const t = M2.allTargets.find(x => x.id === id);
      if (t) return openItem({ e: ENTITIES.find(e => e.key === 'target'), o: t });
    }
    if (kind === 'riskEvent') {
      close();
      U.goto('risk', { eventId: id });
      settle({ page: 'risk', rowId: id });
      return;
    }
    if (kind === 'authLog') {                    // 授权记录在处罚页的「反制与干扰授权审计」页签
      const a = (M2.authLogs || []).find(x => x.id === id);
      close();
      if (a && a.caseId) { U.goto('punish', { caseId: a.caseId }); settle({ page: 'punish', rowId: a.caseId }); }
      else location.hash = '#/punish';
      return;
    }
    if (kind === 'flight') return openItem({ e: ENTITIES.find(e => e.key === 'flight'), o: { id } });
    if (kind === 'commTask') { close(); location.hash = '#/commission'; return; }
    close();
    U.toast(`暂不支持直达「${kind}」类型的 ${id}`, 'err');
  }

  g.SEARCH = { open, close, search, parseQuery, goEntity };
})(window);
