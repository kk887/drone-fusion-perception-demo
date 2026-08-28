/* ===== 14. 空间安全风险监测（鸟群/气球/风筝/孔明灯） ===== */
(function (g) {
  const M = MOCK, U = UI;
  let st = { page: 1, size: 10, level: '全部', type: '全部', sel: null, tab: 'event',
    sort: 'ts', dir: -1 };     // 默认时间倒序，与数据层 riskEvents.sort(b.ts-a.ts) 一致

  /* 表头排序（154 条事件，光靠等级筛选不够用：值守真正要问的是
     "离保护对象最近的是哪几起"和"哪几起还没核验"）。
     排序键是页面状态，绝不 sort MOCK.riskEvents —— 那是全站共享数组。 */
  const LV_RANK = { '高': 3, '中': 2, '低': 1 };
  /* 按待办优先级排，不是按字面。取自数据层的 RISK_STATUS —— 旧版是写死的三个状态，
     状态机扩到七个之后，其余四个会全部并列在末位（indexOf 返回 -1 → 99），
     排序看起来正常，实际是"四个状态不分先后"。硬编码的枚举副本不会报错，只会悄悄失准。 */
  const ST_RANK = (typeof MOCK !== 'undefined' && MOCK.RISK_STATUS)
    ? ['待核验', '待通知', '已通知', '处置中', '已处置', '已排除', '已归档']
      .filter(x => MOCK.RISK_STATUS.indexOf(x) >= 0)
      .concat(MOCK.RISK_STATUS.filter(x => ['待核验', '待通知', '已通知', '处置中', '已处置', '已排除', '已归档'].indexOf(x) < 0))
    : ['待核验', '处置中', '已处置'];
  const SORTERS = {
    ts: r => r.ts,
    // 中文串比较是 UTF-16 码位序，没有含义；类型与行政区都改用数据层的既定顺序
    type: r => String(M.T_TYPES.findIndex(t => t[0] === r.type)).padStart(3, '0') + '\u0000' + (r.subtype || ''),
    district: r => M.DISTRICTS.findIndex(d => d.name === r.district),
    dist: r => r.nearestRouteKm,
    level: r => LV_RANK[r.level] || 0,
    status: r => { const i = ST_RANK.indexOf(r.status); return i < 0 ? 99 : i; }
  };
  const SORT_NOTE = { district: '（按行政区既定顺序）', status: '（待核验→处置中→已处置）', level: '（高→低）', dist: '（距最近航线）' };
  function sortTh(key, label) {
    const on = st.sort === key;
    /* 排序箭头只画在当前排序列上：每个表头都挂一个 ⇅ 会把表格最小宽度顶宽（实测 +17px），
       窄视口下直接变成横向溢出。可排序的提示改用点线下划线 + 手型光标，不占宽度。 */
    return `<span class="lnk" data-sort="${key}" role="button" tabindex="0" title="点击按「${label}」排序${SORT_NOTE[key] || ''}"
      style="color:inherit;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:rgba(156,198,255,.5)"
      >${label}${on ? `<span style="font-size:10px;margin-left:2px">${st.dir < 0 ? '▼' : '▲'}</span>` : ''}</span>`;
  }
  let map = null;
  let mapPts = [];      // 地图上绘制的风险事件，与列表当前页保持一致

  /* ===== COM-03 阈值参数：抽成常量，详情文案与参数总览读同一份，避免第三份副本。
     全部为 Demo 缺省值，业务方未确认（C05 鸟击风险阈值属纪要 §16.2 待确认事项）。 */
  const RP = {
    climbBandM: 150,        // < 150m 起降爬升段（重点）
    approachBandM: 300,     // < 300m 进近段，其上巡航段
    scareSecDefault: 30, scareSecMin: 5, scareSecMax: 180,   // 驱鸟作业时长
  };

  /* ---- F0703:受保护对象配置(机场跑道/净空区/重点设施/航线走廊,内外圈半径可配) ---- */
  /* ZMARK（保护对象类型图标）与 onZones() 已删除 —— M.protectZones 集合本身已不存在，
     留着它们不是"暂时没人用"，是一个**被调用即抛错**的定义：
     `M.protectZones.filter` 在 undefined 上取 filter，会当场炸掉整页。
     删掉一个概念时，指向它的访问器要一起删，否则下一个人看到函数还在会以为集合还在。 */

  /* 风险等级 / 最近保护对象 / 处置建议全部由数据层算，本页只触发重算。
     ── 这里原本有一整套页面侧实现（nearestZone / levelBy / recalcRisk）──
     它算得对，但不该由页面算：README §三·七 F0703 定的就是"按保护对象、保存后重算"，
     数据层收进去之后，页面再算一遍就是第二份口径，而且**后跑的那份赢** ——
     谁最后触发谁说了算，这正是我们一路在治的东西本身。
     两处差别也一并作废：
       · 页面版按"最近的那个保护对象"定级，数据层按"所有启用对象取最严"；
       · 页面版对非机场类保护对象也写"通知 XX 管理单位"，
         而 protectZones 没有管理单位字段，写了就是编的（与日报逐单位签收同因）。 */
  const recalcRisk = () => M.recalcRiskLevels();

  /* ===================== B4 数据层 =====================
     通报记录与处置记录都挂在 MOCK 上（与 M.counterEffects 同一做法），仍由 riskEvents 派生，
     不引入第二份统计口径；派生值一律走 CH.seeded(事件编号)，同一事件任意次查看完全一致。
     —— 这两个数组是本页运行时创建的，若要固化进数据集需在 mock.js 增字段（已向主控会话登记）。 */
  const OPER = () => (M.users && M.users[0]) || { name: '值班员', roleName: '值班员' };

  /* ===== 通报记录：本页不再自己造 =====
     这里原本有一整套页面侧生成（initNotices / noticeTargets / noticeText / FEEDBACK /
     scheduleFeedback），字段是 to/ts/time/channel/content/feedback/by/kind。
     数据层接管后字段变成 at/channelName/operator/ackStatus/ackAt/ackBy/ackNote/api/evidenceId，
     而旧代码开头是 `if (M.riskNotices) return;` —— 于是生成被跳过、渲染却照旧读旧字段名，
     页面上直接印出 "通过 undefined"。**两份口径并存时，先到的那份决定行为，后到的那份决定字段。**
     所以不是补几个字段名的事，是这套生成必须整体删掉：留着它，下次数据层再改字段又会复现。
     回执也不再由页面定时器伪造 —— ackStatus 是数据层的状态机（已回执/回执超时/发送失败/待回执），
     超时与失败带 ackNote 说明后续动作，页面照实显示即可。 */
  const NOTICES = () => M.riskNotices || [];

  /* 处置记录：写事件证据链 + 写全站操作审计（§6.3 全过程审计） */
  function pushDisposal(r, o) {
    r.disposals = r.disposals || [];
    const u = OPER(), now = M.util.fmtDT(M.CONF.demoTime);
    const rec = Object.assign({
      id: 'DP' + r.id.slice(2) + M.util.p2(r.disposals.length + 1),
      time: now, by: u.name, role: u.roleName
    }, o);
    r.disposals.unshift(rec);
    M.auditLogs.unshift({
      id: 'AU' + r.id.slice(-6) + M.util.p2(r.disposals.length),
      time: now, user: u.name, role: u.roleName, module: '空间安全风险',
      action: rec.act + (rec.cmd ? '（指令码 ' + rec.cmd + '）' : '') + (o.outcome ? '：' + o.outcome : ''),
      target: r.targetId, result: o.auditResult || '成功', ip: '10.20.6.31', term: '终端-01'
    });
    return rec;
  }

  /* 新增通报：字段必须与数据层同形，否则同一张表里两种记录各印各的。
     渠道决定通报对象 —— 数据层已因「走机场塔台专线却发给低空安全管理中心」这类
     自相矛盾的记录改成由渠道派生并加了断言守住，页面这条写入路径也必须服从同一规则，
     否则断言守的是存量数据，新写进去的照样能违反。 */
  function pushNotice(r, o) {
    M.riskNotices = M.riskNotices || [];
    const u = OPER(), at = M.util.fmtDT(M.CONF.demoTime);
    const ch = M.NOTICE_CHANNELS.find(c => c.key === o.channel || c.name === o.channel || c === o.channel);
    const n = Object.assign({
      id: 'NT' + r.id.slice(2) + 'M' + M.util.p2(M.riskNotices.filter(x => x.eventId === r.id).length + 1),
      eventId: r.id, targetId: r.targetId, at,
      channel: (ch && (ch.key || ch)) || o.channel,
      channelName: (ch && (ch.name || ch)) || o.channel,
      to: noticeTo((ch && (ch.key || ch)) || o.channel, r),
      operator: u.name,
      /* 新发出的通报一律 ackStatus:'待回执' —— 一发出去就自带回执是假的。
         此后由对方回执驱动，页面不再用定时器伪造。 */
      ackStatus: '待回执', ackAt: null, ackBy: null, ackNote: null,
      api: 'POST /api/v1/dispatch/sync', evidenceId: null
    }, { content: o.content });
    M.riskNotices.unshift(n);
    return n;
  }

  /* 通报对象由渠道决定，直接调数据层的 M.noticeTargetFor —— 数据层的断言也与它比对，
     所以页面写进去的收件人不可能与断言分叉。
     这里曾经是页面自己按最近的机场跑道类保护对象拼字符串，还得把名字尾部的「跑道」切掉；
     那圈弯路的根源是本页把 riskEvents[].airport 覆写成了保护对象名（已修，见 recalcRisk）。
     **绕远的实现往往是在给上游的一处污染打补丁 —— 补丁越别扭，越该回头看是不是自己弄脏的。** */
  function noticeTo(chKey, r) { return M.noticeTargetFor(chKey, r); }

  function noticesOf(r) { return NOTICES().filter(n => n.eventId === r.id); }

  /* 风险事件流转的**唯一写入口**。原先嵌在 mount() 里，只有本页用得到；
     并入飞行活动管理后「按航线看」页签也要推进同一批事件，
     所以提到模块级并通过 g.PAGES.riskEvents.advance 导出 ——
     两个页签共用一个写入口，不存在两条推进路径。
     repaint 由调用方决定：本页用 repaintAll()，航线页签用 g.APP.rerender()。 */
  function advanceRisk(r, to, rec, repaint) {
    const legal = (M.riskNext ? M.riskNext(r.status) : []).some(t => t.to === to);
    if (!legal) { U.toast(`「${r.status}」不能直接转「${to}」`, 'err'); return false; }
    pushDisposal(r, rec);
    r.status = to;
    if (repaint) repaint();
    U.toast(`${rec.act} —— 事件状态 → ${to}`, 'ok');
    return true;
  }

  function rows() {
    const f = M.riskEvents.filter(r =>
      (st.level === '全部' || r.level === st.level) && (st.type === '全部' || r.type === st.type));
    const g = SORTERS[st.sort];
    if (!g) return f;
    return f.sort((x, y) => { const a = g(x), b = g(y); return (a < b ? -1 : a > b ? 1 : 0) * st.dir; });
  }

  let inited = false;
  function render() {
    // 首次进入按当前保护区配置对齐一次(此后随配置变更重算)
    if (!inited) { recalcRisk(); inited = true; }   // 通报由数据层提供，不再页面侧生成
    /* 跨页深链（COM-05 统一检索 / 其他页跳来）：按事件编号或目标编号选中，
       并清掉筛选与页签，否则选中的那条可能被当前筛选挡在列表外 */
    const ctx = U.consume('risk');
    if (ctx) {
      const hit = (ctx.eventId && M.riskEvents.find(r => r.id === ctx.eventId))
        || (ctx.targetId && M.riskEvents.find(r => r.targetId === ctx.targetId));
      if (hit) {
        st.sel = hit; st.tab = 'event'; st.level = '全部'; st.type = '全部';
        const all = rows();
        st.page = Math.max(1, Math.ceil((all.findIndex(r => r.id === hit.id) + 1) / st.size));
      }
    }
    st.sel = st.sel || M.riskEvents[0];
    const R = M.riskEvents;
    const c = l => R.filter(r => r.level === l).length;
    const RR = M.RISK_RULE || {};
    return `${U.kpis([
      { label: '近7天异物事件', value: U.num(R.length), color: 'blue', icon: 'bird', desc: '鸟类/气球/风筝/其他' },
      { label: '高风险事件', value: U.num(c('高')), color: 'red', icon: 'alert', desc: `走廊内 + 高度重叠 + 窗口内有计划` },
      { label: '中风险事件', value: U.num(c('中')), color: 'amber', icon: 'alert', desc: `邻近航线，或走廊内但不满足全部因子` },
      { label: '鸟类事件', value: U.num(R.filter(r => r.type === '鸟').length), color: 'green', icon: 'bird', desc: `最大规模 ${Math.max(...R.filter(r => r.type === '鸟').map(r => r.count), 0)} 只` },
      { label: '待核验', value: U.num(R.filter(r => r.status === '待核验').length), color: 'orange', icon: 'check', desc: '需人工确认' },
      { label: '涉及航线', value: U.num(new Set(R.map(r => r.nearestRouteId).filter(Boolean)).size), color: 'purple', icon: 'zone', desc: `共 ${(M.routes || []).length} 条航线走廊` }
    ])}

    ${/* 底部那一行统计图（异物类型分布 / 距机场距离分布 / 高度分布 / 风险事件趋势）
         已按用户要求删除。主行高度随之从 100vh-454px 放宽到 100vh-277px（实测标定，见 flights.js 同处注释）。
         不写死像素：屏幕越高空白越多且没有上限。 */''}
    <div class="row" style="margin-top:12px;height:calc(100vh - 314px);min-height:578px">
      ${U.panel({
      /* 标题 + 设置按钮在 1440 宽下把 .ph 撑出 18px（h3 是 nowrap，panel 不裁剪，直接外溢）。
         面板本身只有 281px，标题必须短。 */
      title: '风险事件与航线分布', style: 'flex:0.82', nopad: true, bodyStyle: 'padding:6px',
      /* 图例放地图下方单行，不放面板头 —— 面板只有 336px 宽，头里塞长文本会换行，
         每换一行都从地图高度上扣（实测扣掉了 290px，地图只剩 162px） */

      body: `<div id="rkMap" style="flex:1;min-height:0"></div>
        <div style="flex:none;height:18px;line-height:18px;font-size:10.5px;color:var(--txt-3);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
          title="标记颜色表示风险等级，不表示合法性 —— 异物按 §4.2 不做合法性判定">
          <span style="color:#8fbaff">蓝虚线</span>=有事件挂靠的航线走廊 · 标记
          <span style="color:#ff4d5e">高</span>/<span style="color:#ffb020">中</span>/<span style="color:#3d8bff">低</span>=风险等级
        </div>`
    })}
      ${U.panel({
      title: '风险事件与通报', style: 'flex:1.7', nopad: true,
      body: `<div id="rkList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}
      ${U.panel({
      title: '风险详情', style: 'width:340px', nopad: true, extra: `<span id="rkSt"></span>`,
      body: `<div id="rkDetail" style="flex:1;overflow:auto;padding:12px"></div>`
    })}
    </div>

    </div>`;
  }

  /* 页签 + 工具条随列表一起重绘（两个页签的工具栏不同），行点击仍走 U.selectRow 不重建 DOM */
  function bar() {
    const nN = (M.riskNotices || []).length;
    return `<div class="toolbar">
      <div class="tabs" style="border-bottom:none;gap:0">
        <span class="tab ${st.tab === 'event' ? 'on' : ''}" data-rt="event" tabindex="0">风险事件</span>
        <span class="tab ${st.tab === 'notice' ? 'on' : ''}" data-rt="notice" tabindex="0">通报记录
          <span class="tag t-purple" style="margin-left:4px">${nN}</span></span>
      </div>
      ${st.tab === 'event' ? `
        ${U.field('风险等级', U.select('level', ['全部', '高', '中', '低'], st.level))}
        ${U.field('目标类型', U.select('type', ['全部', '鸟', '未知', '识别中', '船', '车'], st.type))}
        <span style="flex:1"></span>
        ${/* 「通报保护对象」按钮已按用户要求删除 —— 连同"保护对象"这一层概念一起去掉。
             通报记录本身保留（由「通知上级」写入的那套），只是不再有"向保护对象群发日报"这个动作。 */''}`
      : `<span style="flex:1"></span>
        ${/* 「新增通报」按钮与那行"设计 9.2 …"说明已按用户要求删除。
             删说明的理由单独说一句：**设计编号是给我们自己看的，不该出现在客户界面上**。
             通报记录页签与「通知上级」的写入链路保留 —— 删的只是手工新增入口：
             通报记录应当是"通知上级"这个动作的产物，不是一个可以凭空补录的台账。 */''}`}
    </div>`;
  }

  /* 通报记录（设计 9.2）—— 四个规定字段全部落地，点行回到对应事件 */
  function noticeList() {
    const all = (M.riskNotices || []);
    const page = all.slice((st.page - 1) * st.size, st.page * st.size);
    return U.table([
      {
        t: '已通报对象 / 时间', w: '186px', render: n => `<div>${n.to}</div>
          <div class="mono" style="font-size:11px;color:var(--txt-3)">${n.at}</div>`
      },
      {
        /* 渠道要显示：同一个通报对象可以走不同渠道，回执方式也随渠道不同
           （NC2 是接口回执，NC1/NC3 是人工回执），只显示对象看不出"为什么这条还没回执"。 */
        t: '关联事件 / 渠道', w: '124px', cls: 'num', render: n => `<div>${n.eventId.slice(-8)}</div>
          <div style="font-size:11px;color:var(--txt-3)">${n.channel} ${n.channelName}</div>`
      },
      {
        /* td 全局 white-space:nowrap，长文必须自己开 normal 并限行，否则整表横向溢出。
           完整内容在右侧详情面板的「通报记录」里逐条展开，这里两行够用。 */
        t: '通报内容', render: n => `<div title="${n.content}" style="white-space:normal;font-size:11.5px;
          line-height:1.55;max-height:35px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;
          -webkit-box-orient:vertical">${n.content}</div>`
      },
      {
        /* 回执是状态机不是一个词：只写"已回执/待反馈"回答不了"失败了怎么办"。
           超时与发送失败都带 ackNote 说明后续动作（转电话催办 / 改电话通报），照实显示。 */
        t: '回执', w: '150px', render: n => {
          const c = { '已回执': 't-green', '待回执': 't-amber', '回执超时': 't-orange', '发送失败': 't-red' }[n.ackStatus];
          return U.tag(n.ackStatus, c)
            + (n.ackAt ? `<div class="mono" style="font-size:10.5px;color:var(--txt-3);margin-top:2px">${n.ackAt.slice(11)} ${n.ackBy || ''}</div>` : '')
            + (n.ackNote ? `<div style="white-space:normal;font-size:11px;line-height:1.45;color:#ffd07a;margin-top:2px">${n.ackNote}</div>` : '');
        }
      }
    ], page, { rowId: n => n.id, activeId: st.selNt })
      + U.pager({ total: all.length, page: st.page, size: st.size });
  }

  function list() {
    if (st.tab === 'notice') return bar() + noticeList();
    const all = rows(), page = all.slice((st.page - 1) * st.size, st.page * st.size);
    return bar() + U.table([
      { t: '编号', w: '68px', cls: 'num', render: r => `<span title="${r.id}">${r.id.slice(-6)}</span>` },
      {
        t: sortTh('type', '目标 / 细类'), w: '116px',
        render: r => `<div>${U.tag(r.type, r.type === '鸟' ? 't-green' : 't-cyan')}
          <span class="mono" style="color:var(--txt-3)">×${r.count}</span></div>
          <div style="font-size:10.5px;color:var(--txt-3);margin-top:2px;white-space:normal;line-height:1.4">${r.subtype
          ? r.subtype + ' ' + U.srcTag(r.subtypeSource)
          : '细类未识别'}</div>`
      },
      {
        t: sortTh('district', '区域 / 高度'), w: '84px',
        render: r => `<div style="white-space:normal;line-height:1.4">${r.district}</div>
          <div class="mono" style="font-size:11px;color:var(--txt-3);white-space:normal;line-height:1.4">${r.alt}m · ${r.trend}</div>`
      },
      {
        /* 航线名最长「黄河口生态区巡检航线-01」11 字，两行放不下会把整表撑宽（实测溢出 20px）。
           用省略号截断而不是放开换行：**截断有省略号提示、hover 有 title 看全名**，
           而放开换行会让行高不齐、且仍可能撑宽。第二行的高度重叠标记缩成两字，同理。 */
        /* 列宽 116→132 是加宽的方向，错了：表已经撑出去，加宽只会更撑。
           省略号截断之后名称不再需要完整宽度，收到 96px。 */
        t: sortTh('dist', '最近航线'), w: '96px',
        /* 光有 text-overflow:ellipsis 不够 —— 列声明 96px，实测却占 168px。
           `w` 只设 th 的 width，而 td 里那个 nowrap 的 div **没有宽度上限**，
           表格布局就按内容把这一列撑开了。必须给一个 max-width，省略号才有东西可依据。
           **"设了省略号"不等于"会截断"：截断需要一个确定的宽度边界。** */
        render: r => `<div title="${r.nearestRouteName || '—'}"
            style="max-width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.4">${r.nearestRouteName || '—'}</div>
          ${/* 第二行也要限宽：它是 mono + nowrap，「31.61 km · 不可判定」实测 117px，
               比第一行限的 86px 还宽，于是这一列被它撑到 137px。
               **限了一个子元素不等于限住了这一列** —— 列宽取所有子元素的最大值，
               漏掉任何一个，前面的限制就白设。 */''}
          <div class="mono" style="max-width:86px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
            font-size:11px;color:var(--txt-3)" title="${r.nearestRouteKm} km">${r.nearestRouteKm} km${
    r.altOverlap === true ? ' · 重叠' : r.altOverlap === false ? ' · 不重叠' : ' · 不可判定'}</div>`
      },
      { t: sortTh('level', '风险'), w: '54px', align: 'center', render: r => U.tag(r.level, r.level === '高' ? 't-red' : r.level === '中' ? 't-amber' : 't-blue') },
      { t: sortTh('ts', '时间'), w: '68px', cls: 'num', render: r => r.time.slice(11) },
      { t: sortTh('status', '状态'), w: '70px', render: r => U.tag(r.status) }
    ], page, { rowId: r => r.id, activeId: st.sel && st.sel.id }) + U.pager({ total: all.length, page: st.page, size: st.size });
  }

  function detail() {
    const r = st.sel;
    if (!r) return '<div class="empty">请选择事件</div>';
    document.getElementById('rkSt').innerHTML = U.tag(r.level, r.level === '高' ? 't-red' : 't-amber');
    return `${U.detailHero({
      icon: 'bird', variant: 'micro', subtitle: '空间安全风险', title: r.subtype || r.type + '风险事件', id: r.id,
      tags: [U.tag(r.level, r.level === '高' ? 't-red' : r.level === '中' ? 't-amber' : 't-blue'), U.tag(r.status)],
      meta: [['区域', r.district], ['规模', r.count + (r.type === '鸟' ? '只' : '个')]]
    })}
      ${U.metricStrip([
        { label: '风险等级', value: r.level, tone: r.level === '高' ? 'bad' : r.level === '中' ? 'warn' : 'info', icon: 'alert' },
        { label: '目标规模', value: r.count, unit: r.type === '鸟' ? '只' : '个', icon: 'bird' },
        { label: '飞行高度', value: r.alt, unit: 'm', icon: 'trend' },
        { label: '距最近航线', value: r.nearestRouteKm, unit: 'km', icon: 'plan' }
      ], { compact: true })}
      ${U.sect('事件信息', U.kv([
      ['目标编号', `<span class="mono">${r.targetId}</span>`],
      ['目标类型', `${r.type} ${U.srcTag('device')}`],
      ['细分类别', r.subtype ? `${r.subtype} ${U.srcTag(r.subtypeSource, r.subtypeConf)}`
        : '<span style="color:var(--txt-3);font-size:11.5px">未识别 —— 协议 objectType 无此细分，需光电算法 A06 推断</span>'],
      ['规模', r.count + (r.type === '鸟' ? ' 只' : ' 个')],
      ['发现时间', r.time], ['区域', r.district],
      ['高度 / 速度', r.alt + ' m / ' + r.speed + ' m/s'],
      ['运动趋势', r.trend]
    ], { surface: true, density: 'compact' }), { icon: 'bird' })}
      ${(function () {
        /* 航线口径影响评估。三因子：距最近航线走廊、高度是否重叠、时间窗内有无计划。
           **高度不可判定单列，不并进"不重叠"** —— 全站 27 条属这一档，
           把它算成"不重叠"等于把"不知道"说成"没问题"（undeterminable[] 里有原因）。
           注意：inWindow 当前恒为 true（163/163）：46 条计划的时段全部落在 7 天窗口内，
           **这个因子在当前数据下不具判别力**，界面照实标注，不假装它参与了判定。 */
        const ov = r.altOverlap;
        const undet = (r.undeterminable || []).filter(x => /alt|高度/i.test(x.k || x));
        return U.sect('航线影响评估（RISK-route-v1）', U.kv([
          ['最近航线', r.nearestRouteName
            ? `<span class="mono lnk" data-rkroute="${r.nearestRouteId}">${r.nearestRouteId}</span> ${r.nearestRouteName}`
            : '<span style="color:var(--txt-3)">未匹配到航线</span>'],
          ['距走廊中心线', `<b style="color:${r.level === '高' ? '#ff8b95' : r.level === '中' ? '#ffd07a' : '#8fbaff'}">${r.nearestRouteKm} km</b>`],
          ['高度重叠', ov === true ? U.tag('重叠', 't-red')
            : ov === false ? U.tag('不重叠', 't-green')
              : U.tag('不可判定', 't-gray') + `<span style="color:var(--txt-3);font-size:11px;margin-left:6px">${
                undet.length ? (undet[0].why || undet[0]) : '缺高度或航线高度区间'}</span>`],
          /* 判别力是**算出来的**，不是写死的。上一版我把"当前全部事件均为是"直接写进文案，
             而数据一变（163/163 → 138/25）这句话就成了假的，且不会有任何东西提醒它过期。
             凡是描述"当前数据长什么样"的话，都必须由当前数据生成。 */
          ['时间窗内有计划', (function () {
            const y = M.riskEvents.filter(e => e.inWindow).length, t = M.riskEvents.length;
            const 无判别力 = y === t || y === 0;
            return (r.inWindow ? '是' : '否')
              + `<span style="color:var(--txt-3);font-size:11px;margin-left:6px">${
                无判别力 ? `当前 ${y}/${t} 事件取值相同，该因子暂不参与区分` : `当前 ${y}/${t} 事件在窗口内`}</span>`;
          })()],
          ['所处高度带', r.alt < RP.climbBandM ? '起降爬升段（重点）' : r.alt < RP.approachBandM ? '进近段' : '巡航段'],
          ['风险等级', U.tag(r.level, r.level === '高' ? 't-red' : r.level === '中' ? 't-amber' : 't-blue')],
          ['评估依据', '距最近航线走廊 + 高度重叠 + 时间窗内有无计划（机场由既有禁飞空域覆盖，不再单列保护对象）']
        ])) + `<div style="font-size:11px;color:var(--txt-3);margin:-8px 0 12px">
          判据参数见参数总览 RISK-route-v1；其中高度余量为 Demo 缺省值，<b>待业务方确认</b>。</div>`;
      })()}
      ${(function () {
        /* 用户裁定：详情面板只留「事件信息」「航线影响评估」和「通知上级」一个按钮。
           删掉的是：处置建议与操作整段（通知机场塔台 / 派发驱离作业 / 驱鸟炮处置及其说明）、
           建议文案、通报记录区块、处置与证据记录区块。
           **面板标题也从「风险详情与建议」改成「风险详情」—— 建议没了，名字不该再承诺它。**
           按钮仍按状态门控：只有「待通知」才给入口，其余状态不显示按钮也不留空位 ——
           状态标签本身已经说明处于哪一步，再摆一个灰按钮是重复且更容易点错。
           注意：**列表行内的核验/转处置/归档按钮不在本次范围**，那是用户此前明确要的工作流。 */
        const can = (M.riskNext ? M.riskNext(r.status) : []).some(t => t.to === '已通知');
        if (!can) return '';
        return U.detailActions(`<button class="btn pri" style="width:100%;justify-content:center" data-rkto="已通知">通知上级</button>`);
      })()}`;
  }

  /* 地图画哪些事件 = 列表当前页那些 + 当前选中项，两边看到的是同一批 */
  function syncMapPts() {
    const all = rows();
    mapPts = all.slice((st.page - 1) * st.size, st.page * st.size);
    if (st.sel && !mapPts.some(r => r.id === st.sel.id)) mapPts = mapPts.concat([st.sel]);
  }
  /* 换用真实瓦片后地图按瓦片层级取景：面板只有 324px 宽，
     _fitTiles 的层级下限是 z=9（≈0.89° 经度跨度），装不下东营 1.3° 的完整范围，
     东西两头的事件会落在画布外。所以选中事件时把地图移过去，保证"选中即看得见"。 */
  function centerOn(r) {
    if (!map || !map.w || !r) return;
    const q = map.px(r.lon, r.lat);
    map.ox += map.w / 2 - q[0];
    map.oy += map.h / 2 - q[1];
  }

  function paint() {
    syncMapPts();
    document.getElementById('rkList').innerHTML = list();
    document.getElementById('rkDetail').innerHTML = detail();
  }

  function mount(view) {
    paint();
    const box = document.getElementById('rkMap');
    map = new MapView(box, { zoom: 1.05, maxDev: 0, layers: { device: false, alarm: false }, legend: false });
    /* 不给 MapView 传 targets ——
       MapView 的目标图层按 `legal` 上色（非法红 / 异常橙 / 待确认黄 / 其余绿），
       而异物按 §4.2 根本不做合法性判定，legal 恒为「不适用」。原实现把风险等级映射成
       假的 legal 传进来（高→非法、中→异常、低→待确认），那不是上色错，是**伪造数据字段**：
       任何下游读 legal 的逻辑都会被污染，且自检查的是 allTargets、看不到这个临时对象。
       另外 MapView 的目标图标是旋翼无人机，画在鸟/气球身上本身也不对。
       所以这里自绘：按**风险等级**上色（本页的正确语义），异物用自己的图形。 */
    /* 小地图只铺"禁止飞行"的空域做背景参照，铺满 8 条会盖住保护圈和异物标记。
       判据用 limit===0（限高值为 0 即禁止飞行）这个数据属性，不写空域类型字面量 ——
       页面里抄一份类型枚举，数据层一改名这里就静默变成"一条都不画"，还不报错。 */
    map.setData({
      airspaces: M.airspaces.filter(a => a.status === '生效中' && a.limit === 0),
      devices: [], targets: [], alarms: []
    });
    map.opt.onPick = pk => {          // 点地图上的异物 → 选中对应事件（只刷详情，不重建列表）
      if (!pk || pk.kind !== 'risk') return;
      st.sel = pk.data;
      if (st.tab === 'event') U.selectRow(document.getElementById('rkList'), pk.data.id);
      document.getElementById('rkDetail').innerHTML = detail();
    };
    // 初始定位到当前选中事件（同步一次 + 补一帧：后台标签页里 rAF 不触发，不能只靠 rAF）
    centerOn(st.sel);
    requestAnimationFrame(() => centerOn(st.sel));
    /* 航线走廊图层（替代原「受保护对象内外圈」）。
       用户裁定取消"保护对象"概念，机场由既有禁飞空域覆盖，这里画的是航线走廊中心线。
       只画有风险事件挂靠的航线 —— 全部 9 条一起画会把画面填满，
       而看图的人要回答的是"哪条航线上有东西"，不是"一共有几条航线"。 */
    const draw0 = map.draw.bind(map);
    map.draw = function () {
      draw0();
      const c = this.ctx;
      const ids = new Set(M.riskEvents.map(r => r.nearestRouteId).filter(Boolean));
      (M.routes || []).filter(r => ids.has(r.id)).forEach(rt => {
        const wp = rt.waypoints || [];
        if (wp.length < 2) return;
        c.beginPath();
        wp.forEach((w, i) => { const p = this.px(w.lon, w.lat); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
        c.setLineDash([6, 4]); c.strokeStyle = 'rgba(61,139,255,.75)'; c.lineWidth = 1.6; c.stroke(); c.setLineDash([]);
        const mid = this.px(wp[wp.length >> 1].lon, wp[wp.length >> 1].lat);
        c.font = '10.5px "PingFang SC"'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = 'rgba(4,10,26,.75)';
        const tw = c.measureText(rt.name).width + 8;
        c.fillRect(mid[0] - tw / 2, mid[1] - 8, tw, 15);
        c.fillStyle = '#8fbaff'; c.fillText(rt.name, mid[0], mid[1]);
      });
    };

    /* 这里原本初始化底部四张图（rkType / rkDist / rkAlt / rkTrend），
       连同只为它们服务的派生统计一并删除：异物类型计数、按内外圈的距离分档、
       ALT_BANDS 高度分档、近 7 天趋势。
       （原注释提到的 onZones 已随保护对象概念删除。） */
    U.on(view, '[data-row]', 'click', (e, el) => {
      const id = el.dataset.row;
      if (st.tab === 'notice') {                       // 点通报记录 → 回到它对应的事件
        const n = (M.riskNotices || []).find(x => x.id === id);
        if (!n) return;
        st.selNt = id;
        st.sel = M.riskEvents.find(r => r.id === n.eventId) || st.sel;
      } else {
        st.sel = M.riskEvents.find(r => r.id === id) || st.sel;
      }
      U.selectRow(document.getElementById('rkList'), id);
      document.getElementById('rkDetail').innerHTML = detail();
      syncMapPts(); centerOn(st.sel);       // 只动地图与详情，不重建列表
    });
    U.on(view, '[data-rt]', 'click', (e, el) => {       // 页签切换
      if (st.tab === el.dataset.rt) return;
      st.tab = el.dataset.rt; st.page = 1;
      paint();
    });
    /* 表头排序：列表 DOM 会重建（与"行点击不重建列表"不冲突，那条针对选中态），
       重建后回到列表顶部；选中行高亮由 list() 的 activeId 带过去。 */
    const doSort = key => {
      if (st.sort === key) st.dir = -st.dir;
      else { st.sort = key; st.dir = (key === 'ts' || key === 'level') ? -1 : 1; }  // 时间/风险默认降序
      st.page = 1;
      paint();
      const sc = document.querySelector('#rkList .scroll');
      if (sc) sc.scrollTop = 0;
    };
    U.on(view, '[data-sort]', 'click', (e, el) => doSort(el.dataset.sort));
    U.on(view, '[data-sort]', 'keydown', (e, el) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSort(el.dataset.sort); }
    });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { st.page = +el.dataset.pg; paint(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { st.size = parseInt(el.value); st.page = 1; paint(); });
    U.on(view, '[data-f]', 'change', (e, el) => { st[el.dataset.f] = el.value; st.page = 1; paint(); });
    /* 处置动作真实改 riskEvents 并整页重绘（KPI/图表/列表联动），不只弹 toast。
       流转统一走 data-rkto：目标状态由按钮携带，而按钮是 RISK_FLOW 生成的，
       所以这里不需要（也不应该）再判断"能不能从 A 到 B" —— 判断只该有一处。
       仍然二次校验一次合法性，是因为 data-rkto 来自 DOM，DOM 可被改。 */
    U.on(view, '[data-rkto]', 'click', (e, el) => {
      const to = el.dataset.rkto, r = st.sel;
      if (!r) return;
      const legal = (M.riskNext ? M.riskNext(r.status) : []).some(t => t.to === to);
      if (!legal) return U.toast(`「${r.status}」不能直接转「${to}」`, 'err');

      /* MEANS：某些流转有具体做法，做法先执行、状态随之改；没有做法的就是纯流转。
         「通知上级」必须走通报弹窗 —— 状态改成"已通知"却没有一条通报记录，
         正是数据层新加的那条断言要抓的（已通知却无通报记录）。 */
      if (to === '已通知') return noticeModal(r, () => advanceRisk(r, to, {
        act: '通知上级', result: '通报已发出，等待回执', evidence: '通报单 + 回执记录'
      }, repaintAll));
      if (to === '处置中') {
        const rs = CH.seeded('drv' + r.id), unit = r.district + '属地保障单位';
        return advanceRisk(r, to, {
          act: '派发人工驱离作业', device: '—', unit,
          result: `已受理，作业队 ${rs(2, 5)} 人预计 ${rs(15, 40)} 分钟内到位`,
          evidence: '派工单 + 作业前后现场照片（回传后入链）'
        }, repaintAll);
      }
      const REC = {
        '待通知': { act: '人工核验通过', result: '确认为真实风险，转通报上级', evidence: '核验单 + 现场影像' },
        '已排除': { act: '排除（误检/非管控目标）', result: '核验后判定无需处置', evidence: '核验单' },
        '已处置': { act: '处置完成', result: '风险解除', evidence: '处置过程记录 + 现场影像' },
        '已归档': { act: '归档', result: '事件闭环归档', evidence: '事件全量记录 + 通报与处置记录' }
      }[to];
      advanceRisk(r, to, REC || { act: '状态流转至' + to, result: '—', evidence: '—' }, repaintAll);
    });


    U.on(view, '[data-rk]', 'click', (e, el) => {
      if (el.disabled) return;
      const k = el.dataset.rk, r = st.sel;
      if (!r) return;
      if (k === 'scare') return scareModal(r);
    });

    /* rkNotify 的两个入口（群发日报、手工新增通报）均已按用户要求删除。
       noticeModal 本身保留 —— 「通知上级」流转仍要弹它来写通报记录并等回执。 */
  }
  /* ============ B4:通报记录（设计 9.2）—— 真实写入记录并即时可见 ============ */
  /* 通报内容按事件实时生成（数据层存量记录用的也是这个句式） */
  function noticeText(r) {
    return `${r.district} 发现${r.type}${r.subtype ? '（' + r.subtype + '）' : ''}${r.count ? '（约 ' + r.count + ' 只/个）' : ''}，`
      + `距${r.nearestRouteName || '最近航线'} ${r.nearestRouteKm} km，风险等级${r.level}；建议：${r.advice}`;
  }

  /* 通报弹窗：选**渠道**，对象由渠道决定，不再让用户勾选对象。
     旧版让用户任意多选对象、另选"通报方式"，这正是数据层修掉的那类矛盾的来源 ——
     用户可以选出「机场塔台专线 + 东营市低空安全管理中心」这种组合。
     onSent 回调用于把状态推进到「已通知」：状态改了却没有通报记录会被数据层断言抓住，
     所以推进必须发生在通报真的写进去之后。 */
  function noticeModal(r, onSent) {
    const CH_LIST = M.NOTICE_CHANNELS || [];
    const preview = k => noticeTo(k, r);
    U.modal({
      title: '通报上级 / 保护对象管理单位 · ' + r.id, width: '620px',
      body: `<div class="warnbox">通报为对外协同动作，Demo 环境<b>不真实外发</b>；正式环境由
          <span class="mono">/api/v1/dispatch/sync</span> 推送并回收回执。通报内容与回执全量留痕。</div>
        ${U.kv([
        ['风险事件', `<span class="mono">${r.id}</span>`],
        ['关联目标', `<span class="mono">${r.targetId}</span>`],
        ['目标 / 细类', `${r.type} ${U.srcTag('device')} ${r.subtype ? '· ' + r.subtype + ' ' + U.srcTag(r.subtypeSource, r.subtypeConf) : ''}`],
        ['最近航线', `${r.nearestRouteName || '—'} · ${r.nearestRouteKm} km`],
        ['风险等级', U.tag(r.level, r.level === '高' ? 't-red' : r.level === '中' ? 't-amber' : 't-blue')]
      ])}
        <div style="margin:12px 0 6px;font-size:12.5px;color:var(--txt-2)">通报渠道（对象由渠道决定）</div>
        ${CH_LIST.map((c, i) => `<label class="chk"><input type="radio" name="ntch" data-nc="${c.key}" ${i === 0 ? 'checked' : ''}>
          <b>${c.key}</b> ${c.name}
          <span style="color:var(--txt-3)">→ ${preview(c.key)} · ${c.ackType}</span></label>`).join('')}
        <div style="margin:12px 0 6px;font-size:12.5px;color:var(--txt-2)">通报内容</div>
        <textarea class="ip" id="ntTxt" style="width:100%;height:74px;padding:8px;line-height:1.7;resize:vertical">${noticeText(r)}</textarea>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="send">发送通报并记录</button>`,
      on: {
        send: el => {
          const pick = [...el.querySelectorAll('[data-nc]')].find(x => x.checked);
          if (!pick) return U.toast('请选择通报渠道', 'err');
          const txt = el.querySelector('#ntTxt').value.trim();
          if (!txt) return U.toast('通报内容不能为空', 'err');
          const n = pushNotice(r, { channel: pick.dataset.nc, content: txt });
          U.closeModal();
          if (onSent) onSent();               // 由调用方决定要不要推进状态
          else { repaintAll(); }
          U.toast(`已通过 ${n.channel} ${n.channelName} 通报 ${n.to}，等待回执`, 'ok');
        }
      }
    });
  }

  /* 「近 7 天风险日报」弹窗已随「通报保护对象」按钮一并删除 ——
     它的通报对象是"全部启用的受保护对象管理单位"，而保护对象这一层概念已被取消，
     留着它就是一个没有收件人的群发动作。 */

  /* ============ B4:驱鸟处置（驱鸟炮 deviceType 12/bsc，控制指令码 70001）============
     作用对象是鸟，不受纪要 §6.3「反制无人机人在回路」约束，所以允许有入口；
     但同属反制类设备：二次确认 → 执行监视 → 全程审计 → 处置记录进证据链，一步不能少。
     声压级/发射间隔/弹药量等硬件参数一律占位，不猜（纪要 §7）。 */
  function scareModal(r) {
    const TBC = '【待确认：设备方提供】';
    const devs = M.devices.filter(d => d.type === '驱鸟炮')
      .map(d => ({ d, km: +M.util.distKm(d, r).toFixed(1) })).sort((a, b) => a.km - b.km);
    const usable = devs.filter(x => x.d.status === '在线');
    if (!usable.length) return U.toast('当前无在线驱鸟炮设备，无法下发', 'err');
    U.modal({
      title: '驱鸟处置授权确认（bsc · 指令码 70001）', width: '720px',
      body: `<div class="warnbox">驱鸟炮作用对象为<b>鸟类</b>，不属于会议纪要 §6.3「反制无人机必须人在回路」的约束范围，
          因此本入口不需要公安授权流程；但驱鸟炮同属<b>反制类设备</b>，下发须完成
          <b>目标确认 → 设备与作用范围校验 → 二次确认</b>，执行全程审计，处置记录进入事件证据链。</div>
        ${U.sect('① 目标确认', U.kv([
        ['风险事件', `<b class="mono">${r.id}</b>`],
        ['关联目标', `<span class="mono">${r.targetId}</span>`],
        ['目标类型', `${r.type} ${U.srcTag('device')}`],
        ['细分类别', r.subtype ? `${r.subtype} ${U.srcTag(r.subtypeSource, r.subtypeConf)}` : '未识别（协议 objectType 无此细分）'],
        ['规模 / 高度', `${r.count} 只 / ${r.alt} m`],
        ['位置', `${r.lon.toFixed(4)}°E, ${r.lat.toFixed(4)}°N · ${r.district}`],
        ['最近航线', `${r.nearestRouteName || '—'} · ${r.nearestRouteKm} km · 风险${r.level}`]
      ]))}
        ${U.sect('② 处置设备与指令参数', `
          <div style="margin-bottom:8px">${U.field('驱鸟炮设备', `<select class="sel" id="bscDev">
            ${devs.map(x => `<option value="${x.d.id}" ${x.d.status !== '在线' ? 'disabled' : ''}>
              ${x.d.name}（${x.d.status} · 距事件 ${x.km} km）</option>`).join('')}</select>`)}
            ${U.field('作用时长', `<input class="ip" id="bscSec" style="width:76px" value="${RP.scareSecDefault}"> 秒
              <span style="font-size:11px;color:var(--txt-3)">（${RP.scareSecMin}~${RP.scareSecMax}s）</span>`)}</div>
          ${U.kv([
        ['设备类型', '<span class="mono">deviceType = 12 / bsc</span>（协议附录设备类型枚举）'],
        ['控制指令码', '<span class="mono">70001</span>'],
        ['下发接口', '<span class="mono">POST /api/v1/device/control</span>'],
        ['声压级 / 发射间隔', TBC],
        ['作用半径', TBC],
        ['时长参数字段与取值范围', `${TBC}（Demo 按秒下发，字段名待对齐）`],
        ['工作状态 workState', `<span class="tag t-amber">数据集未建模</span>
          <span style="font-size:11.5px;color:var(--txt-3)">反制类设备 workState=0（未开启）属正常待命，不计设备异常；
          当前 MOCK.devices 无此字段，设备状态按在线/离线/异常展示</span>`]
      ])}`)}
        ${U.sect('③ 二次确认', `
          <label class="chk"><input type="checkbox" data-c="1">我已确认作用对象为鸟类，且该事件确需驱鸟作业</label>
          <label class="chk"><input type="checkbox" data-c="2">我已确认作用范围内无人员与合法飞行活动，并知悉本次操作将全程审计并记入事件证据链</label>`)}`,
      footer: `<button class="btn" data-close>取消</button>
        <button class="btn danger" data-act="go" disabled id="bscGo">确认授权并下发</button>`,
      mounted: el => {
        const upd = () => { el.querySelector('#bscGo').disabled = [...el.querySelectorAll('[data-c]')].filter(x => x.checked).length < 2; };
        el.querySelectorAll('[data-c]').forEach(c => c.onchange = upd);
      },
      on: {
        go: el => {
          const dev = M.devices.find(d => d.id === el.querySelector('#bscDev').value);
          const sec = Math.max(RP.scareSecMin, Math.min(RP.scareSecMax,
            parseInt(el.querySelector('#bscSec').value, 10) || RP.scareSecDefault));
          U.closeModal();
          execScare(r, dev, sec);
        }
      }
    });
  }

  function execScare(r, dev, sec) {
    const rs = CH.seeded('bsc' + r.id);
    const ack = 'ACK-' + rs(100000, 999999);
    const orderNo = 'BSC' + M.util.ymd(M.CONF.demoTime) + M.util.p3(rs(1, 199));   // util.ymd 返回数值 20260826
    const altAfter = Math.max(5, r.alt + rs(-12, 46));      // 受惊后散开/爬升，不是掉高
    const kmAfter = +(r.nearestRouteKm + rs(3, 22) / 10).toFixed(1);
    const roll = rs(0, 9);
    const outcome = roll < 7 ? '驱离成功' : roll < 9 ? '部分驱离' : '驱离后返回';
    let t = 0, timer = null, done = false, committed = false;
    const mEl = U.modal({
      title: '驱鸟处置执行监视 · ' + orderNo, width: '660px',
      body: `<div id="bscLog" style="font:12px/1.9 Menlo,monospace;color:var(--txt-2);height:196px;overflow:auto;
          background:rgba(3,9,26,.7);border:1px solid var(--line-2);border-radius:6px;padding:10px"></div>
        <div style="display:flex;gap:12px;margin-top:12px" id="bscSt">
          ${[['指令状态', '已下发'], ['执行状态', '执行中'], ['回执', '等待'], ['耗时', '0s']].map(([k, v]) =>
        `<div style="flex:1;border:1px solid var(--line);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:11px;color:var(--txt-3)">${k}</div><div style="font-size:14px;margin-top:3px">${v}</div></div>`).join('')}
        </div>`,
      footer: `<button class="btn warn" data-act="stop">停止作业</button><button class="btn" data-close>关闭</button>`,
      on: { stop: () => { push('[STOP] 操作人下发停止指令，设备停止发射'); finish('已停止', '人工停止'); } }
    });
    /* 执行监视窗口开着时不能整页重绘 —— APP.rerender() 会 closeModal，把执行日志一起关掉。
       改为：先落库，等操作人关掉窗口再重绘，这样"状态变了"是当着人的面发生的。 */
    mEl.addEventListener('click', e => {
      if ((e.target === mEl || e.target.closest('[data-close]')) && committed) setTimeout(repaintAll, 0);
    });
    const box = () => document.getElementById('bscLog');
    function push(s2) {
      const b = box(); if (!b) return;
      b.innerHTML += `<div><span style="color:var(--txt-3)">${M.util.fmtT(new Date(M.CONF.demoTime.getTime() + t * 1000))}</span> ${s2}</div>`;
      b.scrollTop = b.scrollHeight;
    }
    const script = [
      `[AUTH] 二次确认通过，处置单号 ${orderNo}，操作人 ${OPER().name}`,
      `[API ] POST /api/v1/device/control  {"deviceId":"${dev.id}","deviceType":12,"cmd":70001,"duration":${sec}}`,
      `[DEV ] ← 200 {"code":0,"msg":"accepted"}  回执 ${ack}`,
      `[EXEC] ${dev.name} 执行中… 作用时长 ${sec}s，参数集【待确认：设备方提供】`,
      `[TRK ] 目标 ${r.targetId} 高度 ${r.alt} m → ${altAfter} m，距${r.nearestRouteName || '最近航线'} ${r.nearestRouteKm} km → ${kmAfter} km`,
      `[DEV ] ← 设备回报执行结束，累计作用 ${sec}s`,
      `[EVID] 处置前后航迹快照与指令报文已固化（${orderNo}-EVID）`
    ];
    let i = 0;
    timer = setInterval(() => {
      if (!box()) { clearInterval(timer); return; }
      t += 2;
      if (i < script.length) push(script[i++]);
      const b = document.getElementById('bscSt');
      if (b) b.children[3].lastElementChild.textContent = t + 's';
      if (i === script.length) { clearInterval(timer); finish('已完成', outcome); }
    }, 650);

    function finish(execTx, result) {
      clearInterval(timer);
      if (done) return;
      done = true;
      const b = document.getElementById('bscSt');
      if (b) {
        b.children[1].lastElementChild.textContent = execTx;
        b.children[2].lastElementChild.innerHTML = `<span style="color:#79e5a5">${ack}</span>`;
      }
      push(`[ARCH] 处置结果「${result}」与证据链已归档，事件状态更新`);
      // ——— 真实落库：改事件状态 + 写证据链 + 写全站操作审计 ———
      pushDisposal(r, {
        act: '驱鸟炮处置下发', device: `${dev.name}（${dev.id}）`, cmd: 70001, ack,
        result: `${result} · 高度 ${r.alt}→${altAfter} m，距${r.nearestRouteName || '最近航线'} ${r.nearestRouteKm}→${kmAfter} km`,
        outcome: result,
        evidence: `指令报文 + 设备回执 ${ack} + 处置前后航迹快照（${orderNo}-EVID）`,
        orderNo, durationS: sec
      });
      /* 不直接写状态：驱鸟是"处置手段"，状态该往哪走由 RISK_FLOW 说了算。
         旧版从任意状态一步写成 已处置/处置中 —— 从「待核验」直接跳「已处置」是越界，
         而越界状态一旦落库，数据层那条"状态越界"断言抓的是存量，抓不到页面新写进去的。 */
      (function () {
        const want = result === '驱离成功' ? '已处置' : '处置中';
        const nx = (M.riskNext ? M.riskNext(r.status) : []).map(t => t.to);
        if (nx.indexOf(want) >= 0) r.status = want;
        else if (nx.indexOf('处置中') >= 0) r.status = '处置中';
        // 两者都不合法就保持原状态：处置记录已经写进去了，状态由后续人工流转推进
      })();
      // 不改 r.alt / r.nearestRouteKm：这两个值由 lon/lat 与航线几何派生（数据层重算），
      // 就地改会和坐标对不上；处置前后的变化写在处置记录的 result 里。
      committed = true;
      U.toast(`驱鸟处置完成：${result}，记录已入事件证据链与操作审计（关闭窗口后列表与 KPI 同步）`,
        result === '驱离成功' ? 'ok' : '');
    }
  }

  /* F0703「保护区配置」弹窗已整块删除（用户裁定：不再有"保护对象"这一层概念）。
     连同它那四条校验一并删掉 —— 校验的是保护区内外圈半径，而保护区本身不存在了，
     **留着校验代码不是"以防万一"，是留下一段永远不会被调用、却看起来仍在守着什么的东西**。 */

  function repaintAll() { g.APP.rerender(); }

  function destroy() { if (map) map.destroy(); map = null; }

  /* ===== COM-03 参数登记（模块加载时执行）=====
     C05「受保护对象告警半径」已随保护对象概念一并删除 —— 判据换成航线口径后，
     内外圈半径不再参与任何判定，留着它只会让参数确认表上多一行客户永远用不上的东西。
     取而代之注册航线口径的判据参数，值取自数据层 M.RISK_RULE 对象引用（不是快照）。 */
  U.regParams({
    key: 'RISK-route-v1', name: '风险等级判据（航线口径）', page: '飞行活动管理 · 全部风险事件', hash: '#/risk',
    ver: 'RISK-route-v1', confirmed: false, owner: '业务方',
    basis: '用户裁定：不再有"保护对象"这一层，改按"距航线走廊多近 + 高度是否重叠 + 时间窗内有无计划"判定；机场由既有禁飞空域覆盖',
    affects: ['风险等级判定', '高/中风险 KPI', '处置建议', '本航线风险区块'],
    items: () => {
      const R = M.RISK_RULE || {};
      const inW = M.riskEvents.filter(e => e.inWindow).length, tot = M.riskEvents.length;
      return [
        { n: '走廊内判定', v: '距中心线 ≤ 半宽 + 容差（逐条航线取自 ROUTE_PARAMS）' },
        { n: '邻近提示半径', v: (R.nearKm != null ? R.nearKm : '—') + ' km' },
        { n: '高度重叠余量', v: (R.altMarginM != null ? R.altMarginM : '—') + ' m　【待确认：业务方】' },
        { n: '时间窗', v: (R.windowDays != null ? R.windowDays : '—') + ' 天' },
        /* 把"这个因子现在不起作用"写进参数表本身：
           形式上存在、实质不可能被违反的判据，如果不显式登记，读表的人会以为三因子都在生效。 */
        { n: '时间窗因子当前判别力',
          v: (inW === tot || inW === 0)
            ? `注意：${inW}/${tot} 取值相同，该因子暂不区分任何事件`
            : `${inW}/${tot} 在窗口内，该因子有判别力` }
      ];
    }
  });
  U.regParams({
    key: 'C05-BAND', name: '空间安全风险高度带与处置参数', page: '飞行活动管理 · 全部风险事件', hash: '#/risk',
    ver: 'demo-v1', confirmed: false, owner: '业务方 / 设备方',
    basis: '高度带为 Demo 缺省划分；驱鸟作业时长范围待设备方给出设备能力',
    affects: ['风险详情高度带判定', '驱鸟处置下发参数'],
    items: () => [
      { n: '起降爬升段（重点）', v: '< ' + RP.climbBandM + ' m' },
      { n: '进近段', v: RP.climbBandM + '~' + RP.approachBandM + ' m' },
      { n: '巡航段', v: '≥ ' + RP.approachBandM + ' m' },
      { n: '驱鸟作用时长（缺省 / 范围）', v: `${RP.scareSecDefault}s / ${RP.scareSecMin}~${RP.scareSecMax}s` },
      { n: '驱鸟声压级·发射间隔·作用半径', v: '【待确认：设备方提供】' }
    ]
  });

  /* ===== 并入飞行活动管理（用户拍板）=====
     空间安全风险整页成为「飞行活动管理」下的第二个页签「全部风险事件」。
     这里注册两个名字：
       riskEvents —— 真实实现，由 flights 在该页签下委托调用
       risk       —— **兼容别名**：保留旧路由，转到 flights 并预置页签
     为什么留别名而不是改所有调用点：指向 #/risk 的入口散在 situation（转风险监测）、
     search.js（检索结果直达）、app.js（轮播默认序列）等处，逐个改容易漏一个，
     而漏掉的那个会变成一条死链——**别名是一处收口，改调用点是 N 处不能漏**。
     U.consume('risk') 的上下文键也因此不用动，search 的 goto('risk',{eventId}) 照常生效。 */
  g.PAGES = g.PAGES || {};
  /* 放在 g.RISK_IMPL 而不是 g.PAGES.riskEvents —— 它是实现对象，不是一个页面。
     挂进 PAGES 会凭空多出一条 #/riskEvents 路由：能渲染、但没有页签条，
     等于一个只有知道它存在的人才进得去的半成品页面。**命名空间即契约**。 */
  g.RISK_IMPL = { render, mount, destroy, advance: advanceRisk };
  g.PAGES.risk = {
    render() { g.PAGES.flights.setTab('events'); return g.PAGES.flights.render(); },
    mount(v) { return g.PAGES.flights.mount(v); },
    destroy() { return g.PAGES.flights.destroy(); }
  };
})(window);
