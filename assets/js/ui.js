/* =============================================================================
 * ui.js —— 通用组件层（无框架，字符串模板 + 事件委托）
 * ========================================================================== */
(function (g) {
  'use strict';

  /* ---- 图标 ---- */
  const P = {
    home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
    radar: 'M12 12 19 7M12 21a9 9 0 1 0-9-9M12 12a4.5 4.5 0 1 0 4.5 4.5M21 12h-2M12 3v2',
    chart: 'M4 20V9M10 20V4M16 20v-7M22 20H2',
    plan: 'M4 5h16v16H4zM4 9h16M9 3v4M15 3v4M8 14h3M8 17h6',
    check: 'M4 6h16v13H4zM9 12.5l2.2 2.2L16 10',
    alert: 'M12 4 2.5 20h19zM12 10v4M12 17.5v.5',
    bird: 'M3 8c3-2 5 1 8-1 2-1.4 4-3 7-3-1 4-2 5-4 6 1 3-1 8-6 8-4 0-6-3-6-6 0-2 1-4 1-4z',
    zone: 'M12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
    device: 'M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01',
    tool: 'M14.5 3.5a4 4 0 0 0 5 5L21 7l-4-4zM3 21l9.5-9.5M9 15l-3.5 3.5',
    mon: 'M3 5h18v11H3zM8 20h8M12 16v4M6.5 12l2.5-3 2.5 2.5L15 7l2.5 5',
    api: 'M9 4H5v5M15 4h4v5M9 20H5v-5M15 20h4v-5M9 12h6M12 9v6',
    gavel: 'M14 3 21 10l-3 3-7-7zM11 6 5 12l4 4 6-6M3 21h10',
    archive: 'M3 5h18v4H3zM5 9v11h14V9M9 13h6'
  };
  const icon = n => `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="${P[n] || P.home}"/></svg>`;

  /* ---- 数值格式 ---- */
  const num = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const pct = (a, b, d) => b ? (a / b * 100).toFixed(d == null ? 1 : d) + '%' : '0%';
  const money = n => '¥' + Number(n).toLocaleString('en-US');
  function delta(v, opts) {
    opts = opts || {};
    const good = opts.lowerBetter ? v < 0 : v > 0;   // 业务上"高更好"还是"低更好"
    const cls = v === 0 ? 'flat' : (opts.neutral ? 'flat' : (good ? (opts.goodIsRed ? 'up' : 'dn') : (opts.goodIsRed ? 'dn' : 'up')));
    const arr = v === 0 ? '—' : (v > 0 ? '↑' : '↓');
    return `<span class="${cls}">${arr} ${Math.abs(v)}%</span>`;
  }

  /* ---- 标签 ---- */
  const RISK_C = { '超高风险': 't-red', '高风险': 't-red', '中风险': 't-amber', '低风险': 't-blue', '未识别': 't-gray' };
  const LEGAL_C = { '非法': 't-red', '异常': 't-orange', '待确认': 't-amber', '合法': 't-green', '不适用': 't-gray' };
  const STAT_C = {
    '在线': 't-green', '离线': 't-gray', '异常': 't-red', '告警': 't-orange',
    /* A7 告警状态枚举 */ '新建': 't-amber', '已确认': 't-cyan', '已关闭': 't-green', '误报': 't-blue',
    /* A7 案件状态枚举 */ '待核实': 't-amber', '已立案': 't-cyan', '待归档': 't-blue',
    '正常': 't-green', '已处置': 't-green', '处置中': 't-orange',   /* 已处置/处置中 属目标跟踪与风险事件枚举，非 alarm_status */
    '已结案': 't-green', '处理中': 't-orange', '待处理': 't-amber', '跟踪中': 't-cyan',
    '成功': 't-green', '失败': 't-red', '已归档': 't-green', '生效中': 't-green',
    '执行中': 't-cyan', '已完成': 't-green', '待执行': 't-blue', '已终止': 't-gray',
    '待核验': 't-amber', '良好': 't-green', '一般': 't-amber', '未知': 't-gray',
    '高': 't-red', '中': 't-amber', '低': 't-blue'
  };
  const tag = (t, c) => `<span class="tag ${c || STAT_C[t] || RISK_C[t] || LEGAL_C[t] || 't-gray'}">${t}</span>`;
  const risk = r => `<span class="tag ${RISK_C[r] || 't-gray'}">${r}</span>`;
  const legal = l => `<span class="tag ${LEGAL_C[l] || 't-gray'}">${l}</span>`;
  const dotState = s => `<span class="dot-s" style="background:${s === '在线' || s === '正常' ? '#2fd06e' : s === '离线' ? '#8ca0be' : '#ff4d5e'}"></span>${s}`;

  /* ---- 面板 ---- */
  function panel(o) {
    const extra = o.extra || '';
    const sub = o.sub ? `<span class="sub">${o.sub}</span>` : '';
    const head = o.title === false ? '' :
      `<div class="ph"><h3>${o.title}</h3>${sub}<span class="spacer"></span>${extra}</div>`;
    return `<section class="panel" style="${o.style || ''}">${head}
      <div class="pb ${o.nopad ? 'nopad' : ''}" ${o.bodyStyle ? `style="${o.bodyStyle}"` : ''}>${o.body || ''}</div></section>`;
  }

  /* ---- KPI ---- */
  const KC = { blue: '#3d8bff', cyan: '#22d3ee', green: '#2fd06e', amber: '#ffb020', orange: '#ff8b3d', red: '#ff4d5e', purple: '#a97bff', pink: '#ff5fa2' };
  function kpis(list) {
    return `<div class="kpis">` + list.map(k => {
      const c = KC[k.color] || KC.blue;
      return `<div class="kpi">
        <div class="ic" style="background:${c}22;border:1px solid ${c}55;color:${c}">${icon(k.icon || 'chart')}</div>
        <div class="tx"><div class="lb" title="${String(k.label).replace(/"/g, '&quot;')}">${k.label}</div>
          <div class="vl" style="color:${c}">${k.value}${k.unit ? `<span style="font-size:13px;color:var(--txt-2);margin-left:3px">${k.unit}</span>` : ''}</div>
          <div class="dt" title="${String(k.desc || '').replace(/<[^>]+>/g, '').replace(/"/g, '&quot;')}">${k.desc || ''}</div></div></div>`;
    }).join('') + `</div>`;
  }

  /* ---- 表格 ---- */
  /* cols: [{k,t,w,align,render(row,i)}]  opts:{page,size,total,rowId,onRow,activeId,maxH} */
  function table(cols, rows, opts) {
    opts = opts || {};
    // opts.checkbox: (row)=>id|null —— 返回 id 则该行可勾选(用于批量处置/批量归档)
    const ckHead = opts.checkbox ? `<th class="ck"><input type="checkbox" data-ckall aria-label="全选"></th>` : '';
    const head = ckHead + cols.map(c => `<th style="${c.w ? 'width:' + c.w + ';' : ''}${c.align ? 'text-align:' + c.align : ''}">${c.t}</th>`).join('');
    const body = rows.length ? rows.map((r, i) => {
      const id = opts.rowId ? opts.rowId(r) : '';
      const ckId = opts.checkbox ? opts.checkbox(r) : null;
      const ckCell = opts.checkbox ? `<td class="ck">${ckId ? `<input type="checkbox" data-ck="${ckId}" aria-label="选择本行">` : ''}</td>` : '';
      return `<tr data-row="${id}" tabindex="0" class="${opts.activeId && id === opts.activeId ? 'on' : ''}">` + ckCell + cols.map(c => {
        const v = c.render ? c.render(r, i) : (r[c.k] == null ? '—' : r[c.k]);
        return `<td class="${c.cls || ''}" style="${c.align ? 'text-align:' + c.align : ''}">${v}</td>`;
      }).join('') + '</tr>';
    }).join('') : `<tr><td colspan="${cols.length + (opts.checkbox ? 1 : 0)}"><div class="empty">暂无数据</div></td></tr>`;
    return `<div class="scroll" style="${opts.maxH ? 'max-height:' + opts.maxH + ';' : ''}flex:1">
      <table class="tb"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  /* 行选中态切换:只改 class,不重建列表 —— 修复"点击行后列表滚回顶部" */
  function selectRow(root, id, attr) {
    root.querySelectorAll('[' + (attr || 'data-row') + ']').forEach(tr =>
      tr.classList.toggle('on', tr.getAttribute(attr || 'data-row') === id));
  }

  /* 读取容器内勾选的 id 列表;并让"全选"联动 */
  function checked(root) { return [...root.querySelectorAll('[data-ck]:checked')].map(x => x.dataset.ck); }
  function bindCheckAll(root) {
    on(root, '[data-ckall]', 'change', (e, el) => {
      root.querySelectorAll('[data-ck]').forEach(c => c.checked = el.checked);
    });
    on(root, '[data-ck]', 'click', e => e.stopPropagation());   // 勾选不触发行点击
  }
  /* 跨页上下文:goto('legality', {target:id}) → 目标页 render 时用 consume 取出并选中 */
  function goto(page, ctx) {
    if (ctx) sessionStorage.setItem('goto.' + page, JSON.stringify(ctx));
    location.hash = '#/' + page;
  }
  function consume(page) {
    const k = 'goto.' + page, v = sessionStorage.getItem(k);
    if (!v) return null;
    sessionStorage.removeItem(k);
    try { return JSON.parse(v); } catch (e) { return null; }
  }

  function pager(o) {   // {total,page,size,id}
    const pages = Math.max(1, Math.ceil(o.total / o.size));
    const cur = o.page, out = [];
    // 只有真实页码才高亮为当前页：前后箭头即便与当前页同号也不能标成 on
    const btn = (n, lb, dis) => `<span class="pg ${lb == null && n === cur ? 'on' : ''}${dis ? ' dis' : ''}" data-pg="${dis ? '' : n}">${lb == null ? n : lb}</span>`;
    out.push(btn(Math.max(1, cur - 1), '‹', cur === 1));
    const set = new Set([1, 2, pages, pages - 1, cur, cur - 1, cur + 1]);
    let last = 0;
    [...set].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b).forEach(n => {
      if (n - last > 1) out.push(`<span style="color:var(--txt-3)">…</span>`);
      out.push(btn(n)); last = n;
    });
    out.push(btn(Math.min(pages, cur + 1), '›', cur === pages));
    return `<div class="pager" data-pager="${o.id || ''}">
      <span>共 ${num(o.total)} 条</span>
      <select class="sel" data-size style="height:26px">${[10, 20, 50].map(s => `<option ${s === o.size ? 'selected' : ''}>${s}条/页</option>`).join('')}</select>
      ${out.join('')}
      <span>共 ${pages} 页</span></div>`;
  }

  /* ---- kv / 分区 ---- */
  const kv = list => `<dl class="kv">` + list.map(([k, v]) => `<dt>${k}</dt><dd>${v == null ? '—' : v}</dd>`).join('') + `</dl>`;
  const sect = (t, b) => `<div class="sect"><h4>${t}</h4>${b}</div>`;

  /* ---- 步骤 / 时间轴 ---- */
  /* [{n,t,done,act,applicable}]
     applicable===false 表示**本案流程不包含该环节**（如未涉及反制的案件）。
     它必须和"尚未执行"在视觉上分开：两者 done 都是 false，
     若共用待处理样式，界面就等于宣称"这一步还欠着"——而它永远不会做。
     未传 applicable 时按 true 处理（旧调用方行为不变）。 */
  function steps(list) {
    return `<div class="steps">` + list.map((s, i) => {
      const na = s.applicable === false;
      return `<div class="st ${s.done ? 'done' : ''} ${s.act ? 'act' : ''} ${na ? 'na' : ''}">
        <div class="c">${na ? '—' : s.done ? '✓' : String(i + 1).padStart(2, '0')}</div>
        <div class="n">${s.n}</div><div class="t">${s.t || ''}</div></div>`;
    }).join('') + `</div>`;
  }
  function timeline(list) {  // [{time,label,desc,color}]
    return `<div class="tl">` + list.map(n =>
      `<div class="n"><div class="tm" style="color:${n.color}">${n.time}</div>
        <div class="pt" style="border-color:${n.color};box-shadow:0 0 0 3px ${n.color}33"></div>
        <div class="lb">${n.label}</div><div class="ds">${n.desc || ''}</div></div>`).join('') + `</div>`;
  }

  /* ---- 弹窗 / 提示 ---- */
  let modalEl = null;
  function modal(o) {
    closeModal();
    modalEl = document.createElement('div');
    modalEl.className = 'mask';
    modalEl.innerHTML = `<div class="modal" style="${o.width ? 'width:' + o.width : ''}">
      <div class="mh">${o.title}<span class="x" data-close>✕</span></div>
      <div class="mb">${o.body}</div>
      ${o.footer === false ? '' : `<div class="mf">${o.footer || '<button class="btn" data-close>关闭</button>'}</div>`}</div>`;
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', e => {
      if (e.target === modalEl || e.target.closest('[data-close]')) closeModal();
      const a = e.target.closest('[data-act]');
      if (a && o.on && o.on[a.dataset.act]) o.on[a.dataset.act](modalEl, a);
    });
    if (o.mounted) o.mounted(modalEl);
    return modalEl;
  }
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition = '.3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 2600);
  }

  /* ---- 工具条 ---- */
  function field(label, inner) { return `<div class="field"><label>${label}</label>${inner}</div>`; }
  function select(name, opts, val) {
    return `<select class="sel" data-f="${name}">` +
      opts.map(o => { const v = typeof o === 'string' ? o : o.v; const t = typeof o === 'string' ? o : o.t; return `<option value="${v}" ${v === val ? 'selected' : ''}>${t}</option>`; }).join('') + `</select>`;
  }
  const input = (name, ph, val) => `<input class="ip" data-f="${name}" placeholder="${ph || ''}" value="${val || ''}">`;

  /* ---- 进度条列表 ---- */
  function bars(list) {  // [{name,value,max,color,tx}]
    return `<div class="lst">` + list.map(b => `<div class="li">
      <div class="t"><span>${b.name}</span><span class="mono" style="color:var(--txt)">${b.tx != null ? b.tx : num(b.value)}</span></div>
      <div class="bar"><i style="width:${Math.min(100, b.value / (b.max || 100) * 100).toFixed(1)}%;${b.color ? 'background:' + b.color : ''}"></i></div>
    </div>`).join('') + `</div>`;
  }

  /* ---- 事件委托小工具 ---- */
  /* 事件委托。
     注意：不能用 root.contains(t) 做过滤 —— 同一次点击若先被"选中行"的处理器重绘了列表，
     被点的节点已从 DOM 移除，contains() 会变成 false，导致行内"编辑/删除/测试"等操作被静默吞掉。
     这里改为：只要事件是从 root 上冒泡上来的就认，已脱离文档的节点同样放行。 */
  function on(root, sel, ev, fn) {
    root.addEventListener(ev, e => {
      const t = e.target.closest(sel);
      if (t && (root.contains(t) || !t.isConnected)) fn(e, t);
    });
  }

  /* A4:类别来源标签 —— 区分「设备按 objectType 上报」与「光电算法 A06 推断」 */
  /* source_confidence 是 0~1 小数（Target Schema V1），展示统一走这里，
     避免各页各写一份「>1 当百分数、<=1 当小数」的兼容判断。
     注意与上面的 pct(a, b) 区分：那个是「a 占 b 的比例」，这个是「把置信度小数格式化」。 */
  function confPct(v) { return v == null ? '—' : Math.round(v <= 1 ? v * 100 : v) + '%'; }

  /* ---- COM-03 参数注册表 ----
     阈值参数保留在各业务页就地配置（调阈值要立刻看命中效果），
     这里只做**总览与版本审计**：页面把自己的参数块注册进来，总览页读的是同一个对象引用，
     不是副本 —— 一旦复制，总览显示的就会是"注册那一刻的值"而不是当前值。 */
  const _params = [];
  function regParams(g) {
    const i = _params.findIndex(x => x.key === g.key);
    if (i >= 0) _params[i] = g; else _params.push(g);   // 页面重挂载时覆盖而不是叠加
    return g;
  }
  function paramGroups() { return _params.slice(); }

  /* 机型必须连同「凭什么知道」一起显示：射频只到系列级、雷达根本给不出。
     单看一个型号名字是分不出「解出来的」还是「报备写的」的。 */
  const MODEL_SRC_CLR = { '协议破解解析': '#79e5a5', 'RemoteID 广播': '#79e5a5', '飞行计划报备': '#8fbaff', '射频特征匹配': '#c9a2ff' };
  const MODEL_SRC_ABBR = { '协议破解解析': '解析', 'RemoteID 广播': '广播', '飞行计划报备': '报备', '射频特征匹配': '射频' };
  const MODEL_SRC_WHY = {
    '协议破解解析': '协议破解设备解出的具体型号', 'RemoteID 广播': 'RemoteID 广播中的具体型号',
    '飞行计划报备': '型号取自报备信息，非探测识别所得', '射频特征匹配': '射频特征只能匹配到系列级，是线索不是识别结果'
  };
  /* short=true 用于表格：列宽有限，只给一个两字来源标记 + tooltip；
     详情面板用完整标签。表头装饰宁可零宽度也不要顶宽表格。 */
  function modelTag(model, src, short) {
    if (!model || model === '未识别')
      return `<span style="color:var(--txt-3)" title="该目标仅由雷达/5G-A 通感发现，设备不具备机型识别能力">未识别</span>`
        + (short ? '' : ` <span class="tag t-gray">无型号来源</span>`);
    const c = MODEL_SRC_CLR[src] || 'var(--txt-3)';
    const txt = short ? (MODEL_SRC_ABBR[src] || src) : src;
    return `<span>${model}</span>` + (src ? ` <span class="tag" style="color:${c};border-color:${c}55;background:${c}18"
      title="${MODEL_SRC_WHY[src] || ''}">${txt}</span>` : '');
  }

  function srcTag(kind, conf) {
    if (kind === 'device') return `<span class="tag t-cyan" title="设备按协议 objectType 字段上报">设备上报</span>`;
    if (kind === 'ai') return `<span class="tag t-purple" title="协议中无此类型，由光电分类算法 A06 推断（B档：功能性实现）">算法推断${conf ? ' ' + conf + '%' : ''}</span>`;
    return `<span class="tag t-gray">未识别</span>`;
  }


  /* ---- 合法性结论与判定依据（多页共用一份渲染）----
     各页各写一份的话，一处改了措辞、另一处没改，同一个目标在两页读起来像两个结论。
     只读 target 上的客观事实，不做任何判定 —— 判定归 mock.js 的 deriveLegality。 */
  function legalBasis(t) {
    const f = t.facts || {};
    const zone = (f.zoneHits || [])[0];
    const dims = f.planMatchDims || {};
    return [
      {
        k: '身份', na: dims['无人机身份'] == null, bad: dims['无人机身份'] === false,
        ok: '实名信息与报备一致', no: '未获取有效实名信息',
        un: '未取得可比对的实名 SN（需协议破解 / RemoteID 设备），本项无判据'
      },
      {
        k: '计划', na: false, bad: f.planMatch === '未命中',
        ok: '已匹配审批飞行计划（' + (f.planMatch || '—') + '）', no: '未匹配到审批飞行计划'
      },
      {
        k: '空域', na: false, bad: !!(f.inNoFlyZone || f.overZoneHeight || f.overZoneTime),
        ok: '未进入禁止空间、未超限高',
        no: f.inNoFlyZone ? '进入禁飞区' + (zone ? '：' + zone.name : '')
          : f.overZoneHeight ? '超出空域限高' + (zone && zone.limit ? '（限 ' + zone.limit + ' m，实测 ' + zone.h + ' m）' : '')
            : '超出空域管制时段'
      },
      {
        k: '时间', na: false, bad: !!(f.night || f.overPlanTime),
        ok: '在允许飞行时段内', no: f.night ? '夜间时段飞行' : '超出计划批准时段'
      }
    ];
  }
  function basisHtml(t) {
    return `<div class="basis">` + legalBasis(t).map(x => `
      <div class="b ${x.na ? 'na' : x.bad ? 'bad' : ''}">
        <div class="bi">${x.na ? '—' : x.bad ? '✕' : '✓'}</div>
        <div class="bt"><b>${x.k}</b><span>${x.na ? (x.un || '本项无判据') : x.bad ? x.no : x.ok}</span></div>
      </div>`).join('') + `</div>`;
  }
  /* extra: 结论右侧的操作区（各页自定） */
  function verdictHtml(t, extra) {
    if (t.type !== '无人机') {
      return `<div class="verdict warn"><div class="vi">◈</div><div class="vt"><h2>不适用</h2>
        <p>${t.type}属空中异物，不具备飞行计划与实名身份，不进入 C01/C02/C03 合法性判定，
        按《设计方案 §4.2》走空间安全风险线：评估风险 → 通知责任方 → 驱离 → 记录结果。</p></div>
        ${extra ? `<div class="va">${extra}</div>` : ''}</div>`;
    }
    const bad = t.legal === '非法', good = t.legal === '合法';
    const head = bad ? '判定为非法飞行' : good ? '判定为合法飞行' : '判定为' + t.legal;
    const sub = bad
      ? `${(t.violation_reasons || []).join('、')}。`
      : good ? '四项判定依据全部通过。' : '存在未证实或无判据的判定项，需人工进一步核实。';
    return `<div class="verdict ${bad ? '' : good ? 'ok' : 'warn'}">
      <div class="vi">${bad ? '⚠' : good ? '✓' : '◈'}</div>
      <div class="vt"><h2>${head}</h2><p>${sub}</p></div>
      ${extra ? `<div class="va">${extra}</div>` : ''}</div>`;
  }

  g.UI = {
    icon, num, pct, money, delta, tag, risk, legal, dotState, panel, kpis, table, pager,
    checked, bindCheckAll, goto, consume, selectRow, srcTag, confPct, modelTag, regParams, paramGroups,
    kv, sect, steps, timeline, modal, closeModal, toast, field, select, input, bars, on, KC,
    legalBasis, basisHtml, verdictHtml
  };
})(window);
