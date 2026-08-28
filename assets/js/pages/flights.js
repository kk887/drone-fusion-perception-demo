/* ===== 11. 飞行活动管理（飞行计划 / 身份 / 合作方） ===== */
(function (g) {
  const M = MOCK, U = UI;
  let st = { page: 1, size: 10, status: '全部', partner: '全部', region: '全部', kw: '', sel: null };

  /* ---- F0305:计划与实际飞行对照 —— 判定阈值(Demo 缺省值,待业务方确认 C01/C02) ---- */
  const DEV_TH = {
    lateral: { ok: 300, warn: 500, unit: 'm', name: '横向偏航' },
    timeMin: { ok: 10, warn: 20, unit: 'min', name: '时间偏差' },
    altDelta: { ok: 0, warn: 20, unit: 'm', name: '高度偏差' }
  };
  const DEV_C = { '正常': 't-green', '提示': 't-amber', '超限': 't-red', '不可判定': 't-gray' };
  /* 值为 null/undefined = **没有判据**，不是 0。
     原来直接 Math.abs(val)：Math.abs(null) === 0 → 一律返回「正常」，
     等于在没有依据的情况下断言"与报备一致" —— 比显示一个可疑数字更坏，
     因为它把"不知道"伪装成了一个合规结论。 */
  function devJudge(key, val) {
    if (val == null) return '不可判定';
    const th = DEV_TH[key], v = Math.abs(val);
    return v <= th.ok ? '正常' : v <= th.warn ? '提示' : '超限';
  }
  /* 单个计划的整体对照结论。
     不可判定项**不参与** worst 计算：它既不能拉低结论（伪装成合规），
     也不能顶替最严项（伪装成违规）。有多少项不可判定单独报出来。 */
  function devVerdict(p) {
    if (!p.deviation) return null;
    const items = Object.keys(DEV_TH).map(k => ({ k, val: p.deviation[k], lv: devJudge(k, p.deviation[k]) }));
    const judged = items.filter(i => i.lv !== '不可判定');
    const undet = items.filter(i => i.lv === '不可判定');
    const worst = judged.some(i => i.lv === '超限') ? '超限'
      : judged.some(i => i.lv === '提示') ? '提示'
        : judged.length ? '正常' : '不可判定';      // 全部不可判定时，整体结论也是不可判定
    return { items, judged, undet, worst };
  }
  const devColor = lv => lv === '超限' ? '#ff8b95' : lv === '提示' ? '#ffd07a'
    : lv === '不可判定' ? '#8ca0be' : '#79e5a5';
  const UNDET_WHY = { lateral: '无航线几何数据（航路点/走廊宽度未接入），横向偏航无判据可依' };

  function filtered() {
    return M.flightPlans.filter(p =>
      (st.status === '全部' || p.status === st.status) &&
      (st.partner === '全部' || p.partner === st.partner) &&
      (st.region === '全部' || p.region === st.region) &&
      (!st.kw || p.id.includes(st.kw) || p.pilot.includes(st.kw) || p.droneId.includes(st.kw)));
  }

  /* ===== 两个页签（用户拍板：空间安全风险并入本页）=====
     「按航线看」= 原飞行活动内容 + 本航线风险区块
     「全部风险事件」= 原空间安全风险整页，由 g.RISK_IMPL 委托渲染，
       工作流（待核验→待通知→已通知/已排除→归档）与写入口原样复用，不复制第二份。 */
  let tab = 'route';                      // route | events
  const setTabRoute = t => { tab = t; tabHash = (location.hash || '').split('?')[0]; };
  let tabHash = '';                       // 上次决定 tab 时所处的路由
  /* 为什么要记路由：`risk` 别名靠 setTab('events') 预置页签，但页签是模块级状态，
     一旦被别名改过就**永久**停在 events —— 之后从导航栏进「飞行活动管理」也会落到风险页签。
     判据：路由变了 = 用户重新进入这一页，按路由取默认值；路由没变 = 页签点击或重绘，保持不动。 */
  function syncTabByRoute() {
    const h = (location.hash || '').split('?')[0];
    if (h === tabHash) return;                       // 同一路由内的重绘/点击，不干预
    tabHash = h;
    tab = h.indexOf('#/risk') === 0 ? 'events' : 'route';
  }
  const TABS = [['route', '按航线看'], ['events', '全部风险事件']];
  function tabBar() {
    return `<div class="tabs" style="margin-bottom:10px">${TABS.map(([k, t]) =>
      `<span class="tab ${tab === k ? 'on' : ''}" data-fltab="${k}" tabindex="0">${t}${
        k === 'events' ? ` <span style="color:var(--txt-3);font-size:11px">${M.riskEvents.length}</span>` : ''}</span>`).join('')}</div>`;
  }

  function render() {
    syncTabByRoute();
    if (tab === 'events') return tabBar() + g.RISK_IMPL.render();
    // 跨页深链：从统一检索/告警跳来时选中并翻到该行所在页
    const ctx = U.consume('flights');
    if (ctx && ctx.plan) {
      const hit = M.flightPlans.find(p => p.id === ctx.plan);
      if (hit) {
        st.sel = hit; st.status = '全部'; st.partner = '全部'; st.region = '全部'; st.kw = '';
        const idx = filtered().findIndex(x => x.id === hit.id);
        if (idx >= 0) st.page = Math.max(1, Math.ceil((idx + 1) / st.size));
      }
    }
    st.sel = st.sel || M.flightPlans[0];
    const F = M.flightPlans;
    const cnt = s => F.filter(p => p.status === s).length;
    const unmatched = F.filter(p => p.matched === '未匹配感知目标').length;
    return `${tabBar()}${U.kpis([
      { label: '今日报备计划', value: U.num(F.length), color: 'blue', icon: 'plan', desc: `来自上级管控平台 ${F.filter(p => p.source === '上级管控平台').length} 条` },
      { label: '执行中', value: U.num(cnt('执行中')), color: 'cyan', icon: 'radar', desc: '正在空中作业' },
      { label: '待执行', value: U.num(cnt('待执行')), color: 'purple', icon: 'check', desc: '未到窗口期' },
      { label: '已完成', value: U.num(cnt('已完成')), color: 'green', icon: 'check', desc: `完成率 ${U.pct(cnt('已完成'), F.length)}` },
      { label: '计划未匹配到目标', value: U.num(unmatched), color: 'amber', icon: 'alert', desc: '有计划无感知，需核查' },
      { label: '偏离报备计划', value: U.num(F.filter(p => { const v = devVerdict(p); return v && v.worst === '超限'; }).length), color: 'red', icon: 'alert', desc: `偏航>${DEV_TH.lateral.warn}m / 时差>${DEV_TH.timeMin.warn}min / 超高>${DEV_TH.altDelta.warn}m` }
    ])}

    ${/* 底部那一行统计图（计划时间分布 / 合作方 TOP5 / 作业用途 / 计划实际对照）已按用户要求删除。
         主行高度随之从 100vh-454px 放宽到 100vh-277px。277 是**实测标定**的：
         删完后按 236 算，1440×900 下内容高 847 > 可视 806，反而竖向溢出 41px；
         view 内除主行外的固定开销实测 183px，可视高 = 100vh-94，故主行应为 100vh-277。
         不写死像素：屏幕越高空白越多且没有上限，这一条上一轮已经因"页面太空"被提过一次。 */''}
    ${/* min-height 的含义已重定：从「版面不塌的最小高度」改为「内容还读得下去的最小高度」。
         原来是 340px —— 矮窗口下 calc 算出的值仍大于它（1000×700 时 calc=368>340），
         于是内容被压扁（地图 146px、详情 49px）却没超出视口，
         **浏览器认为没什么可滚的**，用户看到的就是"挤成一条缝还拉不动"。
         560 = 本页在 900 高视口下的自然高度 568 − 8：标准档逐像素不变，
         只有视口低于约 892px 时才接管，让页面真正出现竖向滚动。
         全站同病，各页按同一算法各自取值（自然高 − 8）。 */''}
    <div class="row" style="margin-top:12px;height:calc(100vh - 332px);min-height:560px">
      ${U.panel({
      title: '飞行计划与活动', style: 'flex:1.1', nopad: true,
      body: `<div class="toolbar">
          ${U.field('状态', U.select('status', ['全部', '待执行', '执行中', '已完成', '已终止'], st.status))}
          ${U.field('合作方', U.select('partner', ['全部', ...M.PARTNERS.map(p => p.name)], st.partner))}
          ${U.field('区域', U.select('region', ['全部', ...M.DISTRICTS.map(d => d.name)], st.region))}
          <input class="ip" id="flKw" style="width:190px" placeholder="计划编号 / 飞手 / 无人机ID">

          ${/* 「⟳ 同步上级平台」按钮已按用户要求删除 ——
               上级下发的东西平台不该有手工入口（同上：手工报备、新增通报）。
               同步是接口的事，不是人点出来的。
               注意计划列表「来源」列里的「上级管控平台」标识**保留**：那是数据来源事实，
               与这个按钮无关，删按钮不该顺手把事实一起删掉。 */''}
          <span style="flex:1"></span><button class="btn" id="flExp">${U.icon('download')} 导出</button>
        </div>
        <div id="flList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}
      ${/* 右列 430 → 620px：地图要成为主行里的主体，而不是相对自己长大一点。
           上一轮我按"画布面积 +32%"验收，那是个**相对自己**的指标 ——
           画布确实 +32%，但它在主行里仍只占 14%，表格占 64%，用户看到的主次没变。
           **"变大了多少"和"谁更大"是两个问题，用户问的是后者。**
           右列用 flex 而不是固定 620px：固定宽度下**视口越宽表格越占便宜** ——
           实测 1440 时地图/表格 = 51%，到 1600 反而掉到 41%，因为表格跟着视口长、地图不长。
           主次比例必须在各档宽度下都成立，否则它只是在某一个分辨率上碰巧对。 */''}
      <div class="col" style="flex:1;min-width:560px;display:grid;grid-template-rows:minmax(290px,1.35fr) minmax(240px,1fr);gap:var(--gap)">
        ${U.panel({
      /* 用户要的是"看这个计划的航线里有没有鸟群啊什么的" —— 不是把空间安全模块搬过来，
         而是在本页用地图回答"这条航线周边安不安全"。 */
      /* 版面主次（用户：「右边的航线周边态势应该放大，页面的主次清晰」）：
         本页的动作链是「在列表里挑一条计划 → 看它的航线周边有什么 → 看细节佐证」，
         所以列表是**选择器**、地图是**主体**、详情是**佐证**。
         原来地图写死 250px，是三块里最小的一块 —— 主次是反的。
         改成 flex:1.3（详情 flex:1），高度由列高按比例分配，不再写死。
         只动纵向比例、不动 430px 宽度：**横向零风险，不可能引入横向溢出**。 */
      /* flex 用 1.7 不是 1.3：结论行提进 body 之后会吃掉约 23px 画布高度
         （原来它是 header 里的 extra，不占 body）。1.3 时面板 313px、画布只有 205px，
         **比改版前的 250px 面板还小** —— 面板变大和画布变大不是一回事，量的必须是画布。 */
      /* flex 1.7 → 2.6：右列加宽到 620 后画布只有 606×240 = 145k，占主行 20%、
         仅为表格的 42% —— 高度没跟上宽度。2.6 让画布约 606×304 = 184k（表格的 53%）。
         **没有一路推到"地图比表格大"**：那要求画布高 340+，会把计划详情压到 73px 可视高，
         而详情是选中之后要读的东西。主次要立住，但不能把第三块挤没。 */
      title: '航线周边态势', style: 'min-height:0', nopad: true,
      bodyStyle: 'padding:6px',
      /* 主体必须自报身份：原来标题固定、看不出在看哪条航线；那两个数（穿越空域/近7天异物）
         原本是 11px 灰字挤在标题右边 —— 在 250px 小图里当注脚合理，放大成主体后不合理。
         现在航线名进副标题、结论提到面板内顶部一行。 */
      sub: `<span id="flMapRoute"></span>`,
      body: `<div id="flMapSum" style="flex:none;padding:2px 4px 5px;font-size:12px;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis"></div>
        <div id="flMap" style="flex:1;min-height:0"></div>
        <div id="flMapNote" style="flex:none;height:19px;line-height:19px;font-size:10.5px;color:var(--txt-3);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>`
    })}
        ${U.panel({
      title: '计划详情', style: 'min-height:0', nopad: true, extra: `<span id="flSt"></span>`,
      body: `<div id="flDetail" style="flex:1;overflow:auto;padding:12px"></div>`
    })}
      </div>
    </div>

    </div>`;
  }

  function list() {
    const rows = filtered(), page = rows.slice((st.page - 1) * st.size, st.page * st.size);
    return U.table([
      /* ===== 表格降级为选择器（用户两次提「主次清晰」）=====
         右边就是「计划详情」，凡是选中后在详情里重复出现的列，在表里就是冗余。
         已砍：无人机/机型(160)、单位/飞手(122)、用途/区域(116)、来源(76)，共让出 474px。
         留下的四列是**扫描时用来挑一条**的：编号定位、时段判断要不要看、状态/匹配看有没有问题、
         偏航/时差看偏没偏。**一个选择器不需要 9 列。**
         这不是为腾地方而砍 —— 表格降级、地图与详情承载内容，是主次调整的应有之义。 */
      { t: '计划编号', w: '116px', cls: 'num', render: p => p.id.slice(-10) },
      { t: '计划时段', w: '146px', render: p => `<div class="mono" style="font-size:11.5px">${p.start.slice(11, 16)} ~ ${p.end.slice(11, 16)}</div><div style="font-size:11px;color:var(--txt-3)">${p.durMin} 分钟</div>` },
      { t: '最大高度', w: '82px', cls: 'num', render: p => p.maxAlt + ' m' },
      {
        t: '状态 / 匹配', w: '86px',
        render: p => `<div>${U.tag(p.status)}</div><div style="margin-top:2px">${p.matched === '已匹配'
          ? U.tag('已匹配', 't-green') : (p.matched === '—' ? '<span style="color:var(--txt-3)">—</span>' : U.tag('未匹配', 't-amber'))}</div>`
      },
      {
        t: '偏航/时差', w: '116px', align: 'right', cls: 'num', render: p => {
          const v = devVerdict(p);
          if (!v) return '<span style="color:var(--txt-3)">—</span>';
          const d = p.deviation;
          if (!d) return '<span style="color:var(--txt-3)" title="已匹配但无对照数据（数据层不一致）">—</span>';
          const lat = d.lateral == null
            ? `<span style="color:var(--txt-3)" title="${UNDET_WHY.lateral}">—</span>`
            : d.lateral + 'm';
          const tm = d.timeMin == null ? '—' : (d.timeMin > 0 ? '+' : '') + d.timeMin + 'min';
          return `<span style="color:${devColor(v.worst)}">${lat} / ${tm}</span>`;
        }
      },
      {
        t: '来源', w: '76px',
        render: p => `<div title="${p.source}" style="white-space:normal;line-height:1.4;font-size:11.5px">${p.source}</div>`
      }
    ], page, { rowId: p => p.id, activeId: st.sel && st.sel.id }) + U.pager({ total: rows.length, page: st.page, size: st.size });
  }

  function detail() {
    const p = st.sel;
    if (!p) return '<div class="empty">请选择计划</div>';
    document.getElementById('flSt').innerHTML = U.tag(p.status);
    const linked = M.todayTargets.filter(t => t.district === p.region && t.legal === '合法').slice(0, 2);
    return `${U.detailHero({
      icon: 'plan', subtitle: '飞行计划', title: p.purpose || p.route, id: p.id,
      tags: [U.tag(p.status), U.tag(p.matched, p.matched === '已匹配' ? 't-green' : 't-amber')],
      meta: [['区域', p.region], ['时段', p.start.slice(11) + '–' + p.end.slice(11)]]
    })}
      ${U.metricStrip([
        { label: '执行状态', value: p.status, tone: p.status === '已完成' ? 'good' : 'info', icon: 'play' },
        { label: '计划时长', value: p.durMin, unit: 'min', icon: 'clock' },
        { label: '最大高度', value: p.maxAlt, unit: 'm', icon: 'trend' },
        { label: '目标匹配', value: p.matched, tone: p.matched === '已匹配' ? 'good' : 'warn', icon: 'link' }
      ], { compact: true })}
      ${U.sect('计划信息', U.kv([
      ['无人机ID', `<span class="mono">${p.droneId}</span>`], ['机型', p.model],
      ['所属单位', p.partner], ['飞手', p.pilot + '（执照 ' + p.pilotLic + '）'],
      ['作业用途', p.purpose], ['申报区域', p.region],
      ['起飞点', `<span class="mono">${p.takeoff.lon}°E, ${p.takeoff.lat}°N</span>`],
      ['计划时段', p.start + ' ~ ' + p.end], ['最大高度', p.maxAlt + ' m'],
      ['航线', p.route], ['计划来源', p.source]
    ], { surface: true, density: 'compact' }), { icon: 'plan' })}
      ${U.sect('审批信息', U.kv([['审批单位', p.approver], ['审批时间', p.approvedAt], ['审批结论', U.tag('已批准', 't-green')]], { surface: true, density: 'compact' }), { icon: 'check' })}
      ${(function () {
        if (p.matched === '—') return U.sect('计划与实际对照（F0305 · C01）', '<div class="empty" style="padding:10px">计划尚未开始执行</div>');
        if (p.matched !== '已匹配') return U.sect('计划与实际对照（F0305 · C01）',
          `<div class="warnbox">该计划时段内<b>未匹配到感知目标</b>，可能为：未按计划起飞、目标在探测盲区、或设备异常。建议人工核实。</div>
           ${U.kv([['匹配依据', '时间窗 ±10min + 空间 500m + 身份一致'], ['处理建议', '联系飞手核实 / 检查区域设备状态']])}`);
        const v = devVerdict(p), d = p.deviation;
        /* 「已匹配」却没有 deviation：实测 22 条已匹配里有 13 条如此，且全是"已完成"
           （数据层那条 `status==='待执行' ? null : {...}` 解释不了）。
           这里**不兜底成 0 或"一致"** —— 那会把"没有对照数据"说成"对照通过"，
           而这一格正是给监管看"有没有偏离报备"的。如实说没有，并指出矛盾在哪。 */
        if (!d) return U.sect('计划与实际对照（F0305 · C01）',
          `<div class="warnbox" style="border-color:rgba(255,176,32,.45);background:rgba(255,176,32,.08);line-height:1.85">
            注意：该计划标记为<b>已匹配</b>，但<b>没有对照数据</b>（<span class="mono">deviation</span> 为空）。<br>
            <span style="color:var(--txt-3)">"已匹配"意味着找到了对应的感知目标，那就应当能算出偏航/时差/超高三项。
            两者同时成立是数据层的不一致，已提请核查 —— 此处不显示"与报备一致"，因为那是一个我们并没有做出的判断。</span></div>`);
        const row = (k, txt) => {
          const it = v.items.find(x => x.k === k);
          if (it.lv === '不可判定') return [DEV_TH[k].name,
            `<span style="color:var(--txt-3)">—</span>　${U.tag('不可判定', 't-gray')}
             <div style="font-size:11px;color:var(--txt-3);line-height:1.7;margin-top:2px">${UNDET_WHY[k] || '无判据可依'}</div>`];
          return [DEV_TH[k].name, `<b class="mono" style="color:${devColor(it.lv)}">${txt}</b>　${U.tag(it.lv, DEV_C[it.lv])}`];
        };
        return U.sect('计划与实际对照（F0305 · C01）',
          U.kv([
            ['匹配目标', linked.length ? linked.map(t => `<span class="mono">${t.id}</span>`).join('<br>') : '—'],
            ['匹配依据', '时间窗 ±10min + 空间 500m + 身份一致'],
            row('lateral', d.lateral + ' m'),
            row('timeMin', (d.timeMin > 0 ? '晚 ' : d.timeMin < 0 ? '早 ' : '') + Math.abs(d.timeMin) + ' min'),
            row('altDelta', (d.altDelta > 0 ? '高于报备 ' : d.altDelta < 0 ? '低于报备 ' : '') + Math.abs(d.altDelta) + ' m（报备 ' + p.maxAlt + ' m）'),
            ['对照结论', (v.worst === '超限'
              ? '<span class="tag t-red">偏离报备计划</span> <span style="color:var(--txt-3);font-size:11.5px">建议转合法性判定</span>'
              : v.worst === '提示' ? '<span class="tag t-amber">轻微偏离</span> <span style="color:var(--txt-3);font-size:11.5px">持续观察</span>'
                : v.worst === '不可判定' ? '<span class="tag t-gray">不可判定</span> <span style="color:var(--txt-3);font-size:11.5px">全部对照项均无判据</span>'
                  : '<span class="tag t-green">与报备一致</span>')
              /* 结论只对「判得了的那几项」负责，不可判定项必须说出去 ——
                 否则「与报备一致」会被读成"三项都比过了" */
              + (v.undet.length ? `<div style="font-size:11px;color:#ffd07a;margin-top:3px;line-height:1.7">
                  注意：本次对照有 ${v.undet.length} 项不可判定（${v.undet.map(i => DEV_TH[i.k].name).join('、')}），
                  未计入上述结论 —— 不可判定不等于合规</div>` : '')]
          ]) + `<div style="font-size:11px;color:var(--txt-3);margin-top:6px">
            判定阈值：偏航 ≤${DEV_TH.lateral.ok}m 正常 / ≤${DEV_TH.lateral.warn}m 提示；
            时差 ≤${DEV_TH.timeMin.ok}min 正常 / ≤${DEV_TH.timeMin.warn}min 提示；
            超高 ≤${DEV_TH.altDelta.warn}m 提示。均为 Demo 缺省值，待业务方确认（C01/C02）。</div>`);
      })()}
      ${routeRiskSect(p)}
      ${/* 「查看关联轨迹」已删（用户裁定；此前也被自动化测出是死胡同）。
           「合法性判定 →」只在「待执行」时出现 —— 判定是起飞前的事。
           其余状态**不显示**而不是置灰：没有那一步就不该有那个钮，
           与"已完成计划隐藏风险预检"同一条。 */''}
      ${p.status === '待执行' ? U.detailActions(`<button class="btn pri" style="flex:1;justify-content:center" data-fl="legal">合法性判定 →</button>`) : ''}`;
  }

  /* ===== 本航线风险（用户原话：看飞行活动的航线上有没有危险然后实施操作）=====
     每行直接给处置入口，不跳到另一个页签再找一遍 —— 但**状态机与写入口完全复用
     riskEvents 那一套**（M.riskNext / M.advanceRisk 不在这里重实现），
     否则同一个事件会有两条推进路径，迟早分叉。
     分档：走廊内（≤ 半宽+容差）挂风险、邻近 RISK_NEAR_KM 内提示。参数已注册进总览，
     owner 业务方、待确认 —— 2km/5km/7 天都是 Demo 缺省值。 */
  function routeRiskSect(p) {
    /* 状态门控：飞完/终止的计划不显示航线风险预检 —— **那是起飞前看的东西**。
       用户原话「已完成的航线就不需要显示本航线风险了」。
       留一行灰字而不是整块消失：否则看的人会以为数据丢了，
       这跟告警页按状态置灰按钮而不是隐藏是同一条 —— **说清楚"为什么没有"，不要制造空缺**。 */
    if (['已完成', '已终止', '已取消'].includes(p.status))
      return U.sect('本航线风险', `<div style="color:var(--txt-3);font-size:12px;line-height:1.7">
        计划已${p.status}，不再显示航线风险预检 —— 该预检用于起飞前研判走廊沿线是否有异物，
        对已结束的计划没有意义。<br>历史风险事件仍可在「全部风险事件」页签按时间查阅。</div>`);
    const r = routeOf(p);
    if (!r) return U.sect('本航线风险', `<div style="color:var(--txt-3);font-size:12px">
      该计划未关联航线走廊，无法计算沿线风险。</div>`);
    const halfKm = (r.widthM / 2 + (r.widthTolM || 0)) / 1000;
    const list = hazardsNear(r);
    const inCor = list.filter(e => e._d <= halfKm);
    const near = list.filter(e => e._d > halfKm);
    if (!list.length) return U.sect(`本航线风险（近 ${NEAR_DAYS} 天）`,
      `<div class="inline-icon" style="color:#79e5a5;font-size:12.5px">${U.icon('check')} 走廊内与 ${RISK_NEAR_KM} km 邻近范围内无风险事件</div>`);
    const row = (e, lv) => {
      /* 本页只暴露「通知上级」一个动作（用户裁定）。
         核验、排除、归档属于风险处置模块 —— 在一条飞行计划的上下文里，
         看到航线附近有鸟群，唯一合适的动作是把它捅上去，不是在这儿结案。
         **这是"少暴露"，不是"另做一套"**：状态机仍是数据层的 RISK_FLOW，
         写入口仍是 g.RISK_IMPL.advance，这里只过滤显示哪些后继动作。
         若当前状态根本走不到「已通知」（如已归档），**不显示点不动的按钮**，
         状态标签本身已经说明处于哪一步。 */
      const nx = ((M.riskNext ? M.riskNext(e.status) : []) || []).filter(t => t.to === '已通知');
      return `<div style="padding:6px 0;border-bottom:1px solid rgba(64,158,255,.08)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
          <span style="font-size:12.5px">${U.tag(lv, lv === '走廊内' ? 't-red' : 't-amber')}
            ${e.type}${e.subtype ? '（' + e.subtype + '）' : ''} ×${e.count}
            <span class="mono lnk" data-flrisk-go="${e.id}">${e.id.slice(-6)}</span></span>
          <span class="mono" style="color:var(--txt-3);font-size:11px">距中心线 ${e._d} km · ${e.alt}m</span></div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap">
          ${U.tag(e.status)}
          ${nx.length
          ? nx.map(t => `<button class="btn" style="padding:2px 8px;font-size:11px"
              data-flrisk-to="${e.id}|${t.to}" title="${e.status} → ${t.to}">${t.act}</button>`).join('')
          : '<span style="color:var(--txt-3);font-size:11px">本页仅提供「通知上级」，其余处置在「全部风险事件」页签</span>'}
        </div></div>`;
    };
    return U.sect(`本航线风险（近 ${NEAR_DAYS} 天 · 走廊内 ${inCor.length} / 邻近 ${near.length}）`,
      inCor.map(e => row(e, '走廊内')).join('') + near.map(e => row(e, '邻近')).join('')
      + `<div style="font-size:11px;color:var(--txt-3);margin-top:6px;line-height:1.7">
        走廊内 = 距中心线 ≤ 半宽 ${(r.widthM / 2 / 1000).toFixed(2)}km + 容差 ${((r.widthTolM || 0) / 1000).toFixed(2)}km；
        邻近 = 其外至 ${RISK_NEAR_KM} km。均为 Demo 缺省值，<b>待业务方确认</b>。
        处置动作与「全部风险事件」页签共用同一套状态机，此处推进即彼处推进。</div>`);
  }

  /* ===== 航线周边态势 =====
     叠三层：该计划的航线走廊 / 沿途空域 / 近 N 天走廊沿线的异物活动点位。
     几何判断一律用经纬度，**不用 region 字段** —— 走廊会跨行政区（数据层注释已标）。 */
  let map = null;
  /* 本航线风险的三个阈值。用户已按推荐值先行，**仍标待确认**（业务方定）。
     RISK_NEAR_KM 同时是地图异物图层与「本航线风险」区块的缓冲半径 ——
     两处共用一个常量，避免地图上看得见的点和列表里列出的点不是同一批。 */
  const NEAR_DAYS = 7;
  const RISK_NEAR_KM = 5;      // 走廊外多远仍算"邻近"
  const RISK_IN_BUF_KM = 2;    // 走廊内挂风险的判定缓冲（半宽+容差之外再放宽这么多）
  const routeOf = p => (M.routesOf ? (M.routesOf(p.id) || [])[0] : null)
    || (M.routes || []).find(r => (r.planIds || []).includes(p.id)) || null;

  /* 点到线段的最短距离（km）。经纬按东营纬度换算，够用且不引第三套坐标口径。 */
  function distToRouteKm(pt, r) {
    let best = Infinity;
    for (let i = 1; i < r.waypoints.length; i++) {
      const a = r.waypoints[i - 1], b = r.waypoints[i];
      const ax = a.lon * 88.5, ay = a.lat * 111, bx = b.lon * 88.5, by = b.lat * 111;
      const px = pt.lon * 88.5, py = pt.lat * 111;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - (ax + dx * t), py - (ay + dy * t)));
    }
    return best;
  }
  /* 走廊沿线的异物：近 NEAR_DAYS 天、且到中心线距离在「半宽 + 容差 + 缓冲」内 */
  function hazardsNear(r) {
    if (!r) return [];
    const halfKm = (r.widthM / 2 + (r.widthTolM || 0)) / 1000;
    const buf = RISK_NEAR_KM;                        // 走廊两侧的活动同样值得看，取邻近半径
    const from = M.util.ymd(M.util.dayAdd(M.CONF.demoTime, -(NEAR_DAYS - 1)));
    return (M.riskEvents || []).filter(e => e.ymd >= from && distToRouteKm(e, r) <= halfKm + buf)
      .map(e => Object.assign({ _d: +distToRouteKm(e, r).toFixed(2) }, e))
      .sort((a, b) => a._d - b._d);
  }
  /* 走廊穿过哪些空域：用航路点落点判断，不用 region */
  function zonesAlong(r) {
    if (!r) return [];
    const inPoly = (lon, lat, poly) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    return M.airspaces.filter(a => a.status === '生效中' && r.waypoints.some(w => inPoly(w.lon, w.lat, a.poly)));
  }

  function paintMap() {
    if (!map) return;
    const p = st.sel;
    const sum = document.getElementById('flMapSum'), note = document.getElementById('flMapNote');
    const rn = document.getElementById('flMapRoute');
    const r = p && routeOf(p);
    if (!r) {
      map.setData({ airspaces: M.airspaces.filter(a => a.status === '生效中'), devices: [], targets: [], alarms: [] });
      map._fl = null;
      if (rn) rn.textContent = p ? '未关联航线' : '';
      if (sum) sum.textContent = '';
      if (note) note.innerHTML = p
        ? `<span style="color:#ffd07a">该计划未关联报备航线 —— 无走廊几何，周边异物无法按航线统计</span>`
        : '';
      return;
    }
    const hz = hazardsNear(r), zs = zonesAlong(r);
    const forbid = zs.filter(a => (M.airspaceType ? M.airspaceType(a.type).forbidsAllPlans : a.type === '禁飞空域'));
    map._fl = { route: r, hz };
    map.setData({ airspaces: zs.length ? zs : M.airspaces.filter(a => a.status === '生效中'), devices: [], targets: [], alarms: [] });
    const w = r.waypoints[Math.floor(r.waypoints.length / 2)];
    const q = map.px(w.lon, w.lat);
    map.ox += map.w / 2 - q[0]; map.oy += map.h / 2 - q[1];
    /* 主体自报身份：副标题给出当前在看哪条航线 */
    if (rn) rn.textContent = `${r.id} ${r.name}`;
    if (sum) sum.innerHTML = `穿越空域 <b style="color:${forbid.length ? '#ff8b95' : '#cfe0f8'}">${zs.length}</b>`
      + (forbid.length ? `<span style="color:#ff8b95">（含禁止类 ${forbid.length}）</span>` : '')
      + ` · 近${NEAR_DAYS}天异物 <b style="color:${hz.length ? '#ffd07a' : '#79e5a5'}">${hz.length}</b> 起`;
    if (note) note.innerHTML = hz.length
      ? `最近一起 ${hz[0].type}${hz[0].subtype ? '（' + hz[0].subtype + '）' : ''} ×${hz[0].count}，距走廊中心线 ${hz[0]._d} km，${hz[0].time.slice(5, 16)}`
      : `<span style="color:#79e5a5">近 ${NEAR_DAYS} 天走廊沿线（半宽+容差+2km 缓冲内）无异物活动记录</span>`;
  }

  function paint() {
    document.getElementById('flList').innerHTML = list();
    document.getElementById('flDetail').innerHTML = detail();
    paintMap();
  }

  function mount(view) {
    /* 页签切换：整页重绘。两个页签的 DOM 完全不同（一个是计划列表+地图，
       一个是风险事件列表+地图），局部替换省不下什么，反而要维护两套清理逻辑。 */
    /* 在 #/risk 别名路由上切「按航线看」必须回正到 #/flights：
       PAGES.risk.render 每次都会 setTab('events')，留在别名路由上重绘会把这次点击原样打回，
       表现就是"点了没反应"。回正后标题/面包屑也随真实路由落到「飞行计划」。 */
    const switchTab = k => {
      tab = k;
      const h = (location.hash || '').split('?')[0];
      if (k === 'route' && h !== '#/flights') { location.hash = '#/flights'; return; }
      tabHash = h; g.APP.rerender();
    };
    U.on(view, '[data-fltab]', 'click', (e, el) => switchTab(el.dataset.fltab));
    U.on(view, '[data-fltab]', 'keydown', (e, el) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(el.dataset.fltab); }
    });
    if (tab === 'events') return g.RISK_IMPL.mount(view);

    /* 本航线风险的行内处置。**推进一律走数据层 M.advanceRisk / riskNext**，
       与「全部风险事件」页签是同一个写入口 —— 此处推进即彼处推进，不存在两份状态。 */
    U.on(view, '[data-flrisk-to]', 'click', (e, el) => {
      const [id, to] = el.dataset.flriskTo.split('|');
      const ev = (M.riskEvents || []).find(x => x.id === id);
      if (!ev) return;
      /* 直接调 riskEvents 导出的那个写入口，**不在这里另写一份**。
         合法性校验、处置记录、审计都在它里面，此处只负责传入重绘方式。 */
      const rec = { act: '（航线视角）' + to, result: '经飞行活动管理·本航线风险发起', evidence: '事件全量记录' };
      g.RISK_IMPL.advance(ev, to, rec, () => g.APP.rerender());
    });
    U.on(view, '[data-flrisk-go]', 'click', (e, el) => {
      // 跳到「全部风险事件」页签并选中该事件，复用既有的 goto/consume 通路
      U.goto('risk', { eventId: el.dataset.flriskGo });
    });
    map = new MapView(document.getElementById('flMap'), {
      zoom: 3.2, maxDev: 0, legend: false, layers: { device: false, track: false, alarm: false }
    });
    /* 走廊与异物自绘：MapView 的空域图层按 type 上色，航线不是空域；
       异物按 §4.2 不做合法性判定，塞进 targets 会被按 legal 上成绿色（=合法）。 */
    const draw0 = map.draw.bind(map);
    map.draw = function () {
      draw0();
      const fl = this._fl;
      if (!fl) return;
      const c = this.ctx, r = fl.route;
      const half = (r.widthM / 2 + (r.widthTolM || 0)) / 1000;
      // 走廊带宽
      const L = [], R = [];
      for (let i = 0; i < r.waypoints.length; i++) {
        const a = r.waypoints[Math.max(0, i - 1)], b = r.waypoints[Math.min(r.waypoints.length - 1, i + 1)];
        let dx = (b.lon - a.lon) * 88.5, dy = (b.lat - a.lat) * 111;
        const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        L.push([r.waypoints[i].lon + nx * half / 88.5, r.waypoints[i].lat + ny * half / 111]);
        R.push([r.waypoints[i].lon - nx * half / 88.5, r.waypoints[i].lat - ny * half / 111]);
      }
      const poly = L.concat(R.reverse()).map(q => this.px(q[0], q[1]));
      c.beginPath(); poly.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.closePath();
      c.fillStyle = '#22d3ee22'; c.fill();
      c.setLineDash([5, 4]); c.strokeStyle = '#22d3eeaa'; c.lineWidth = 1; c.stroke(); c.setLineDash([]);
      c.beginPath();
      r.waypoints.forEach((w, i) => { const q = this.px(w.lon, w.lat); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
      c.strokeStyle = '#22d3ee'; c.lineWidth = 2; c.stroke();
      r.waypoints.forEach(w => { const q = this.px(w.lon, w.lat);
        c.beginPath(); c.arc(q[0], q[1], 3, 0, 7); c.fillStyle = '#22d3ee'; c.fill(); });
      // 异物点位：按风险等级上色，不按合法性
      const LVC = { '高': '#ff4d5e', '中': '#ffb020', '低': '#3d8bff' };
      (fl.hz || []).forEach(e => {
        const q = this.px(e.lon, e.lat);
        const col = LVC[e.level] || '#8ca0be';
        const ph = (this.t % 70) / 70;
        c.beginPath(); c.arc(q[0], q[1], 4 + ph * 8, 0, 7);
        c.strokeStyle = col + Math.round((1 - ph) * 170).toString(16).padStart(2, '0'); c.lineWidth = 1.2; c.stroke();
        c.strokeStyle = col; c.lineWidth = 1.6;
        if (e.type === '鸟') {
          c.beginPath(); c.arc(q[0] - 3.2, q[1], 3.2, -Math.PI * .95, -Math.PI * .05); c.stroke();
          c.beginPath(); c.arc(q[0] + 3.2, q[1], 3.2, -Math.PI * .95, -Math.PI * .05); c.stroke();
        } else {
          c.beginPath(); c.moveTo(q[0], q[1] - 4.2); c.lineTo(q[0] + 4.2, q[1]);
          c.lineTo(q[0], q[1] + 4.2); c.lineTo(q[0] - 4.2, q[1]); c.closePath(); c.stroke();
        }
        (this._pickPts = this._pickPts || []).push({
          x: q[0], y: q[1], kind: 'hazard', data: e,
          tip: `<b style="color:${col}">${e.type}${e.subtype ? '（' + e.subtype + '）' : ''} ×${e.count}</b>
            <dl class="kv" style="margin-top:6px"><dt>事件</dt><dd>${e.id}</dd>
            <dt>距走廊中心线</dt><dd>${e._d} km</dd><dt>高度</dt><dd>${e.alt} m</dd>
            <dt>风险</dt><dd style="color:${col}">${e.level}</dd><dt>时间</dt><dd>${e.time.slice(5, 16)}</dd></dl>`
        });
      });
    };
    map.opt.onPick = pk => { if (pk && pk.kind === 'hazard' && g.SEARCH) g.SEARCH.goEntity('riskEvent', pk.data.id); };
    paint();
    requestAnimationFrame(paintMap);
    /* 这里原本初始化底部四张图（flHour / flPartner / flPurpose / flMatch）。
       面板删除后一并清掉，包括只为它们服务的派生统计（按小时计划数、合作方 TOP5、
       用途分布、F0305 对照分档）。devVerdict 保留 —— 它还有 4 处消费方（KPI、列表、详情）。
       删面板不删初始化，会留下对已移除元素的 getElementById 与一堆死函数。 */
    U.on(view, '[data-row]', 'click', (e, el) => {
      st.sel = M.flightPlans.find(p => p.id === el.dataset.row);
      U.selectRow(document.getElementById('flList'), el.dataset.row);
      document.getElementById('flDetail').innerHTML = detail();
      /* 必须同时重画航线态势 —— 少这一行，地图与副标题会一直停在首个计划上：
         点第二条、第三条计划，右边「穿越空域 N · 近7天异物 M 起」逐字不变。
         **这类漏刷不会报错、也不会留空白，只是内容不更新**，看起来像"数据都一样"。
         paintMap 内部按 st.sel 重取航线，重复调用无副作用（centerRoute 是增量对齐）。 */
      paintMap();
    });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { st.page = +el.dataset.pg; paint(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { st.size = parseInt(el.value); st.page = 1; paint(); });
    U.on(view, '[data-f]', 'change', (e, el) => { st[el.dataset.f] = el.value; st.page = 1; paint(); });
    /* 「查看关联轨迹」的分支已随按钮删除 —— 它只弹一句 toast、不导向任何页面，
       是个死胡同（自动化早报过，用户现在亲自判了）。**删按钮必须连处理器一起删**，
       否则留下一个永远不会被触发的分支，下一个人还得判断它是不是漏了入口。 */
    U.on(view, '[data-fl]', 'click', (e, el) => {
      if (el.dataset.fl === 'legal') location.hash = '#/legality';
    });
    document.getElementById('flKw').oninput = e => { st.kw = e.target.value.trim(); st.page = 1; paint(); };


    document.getElementById('flExp').onclick = () => U.toast('已导出「飞行计划.xlsx」共 ' + filtered().length + ' 条', 'ok');
  }
  function destroy() {
    if (g.RISK_IMPL && g.RISK_IMPL.destroy) g.RISK_IMPL.destroy();
    if (map) map.destroy(); map = null;
  }
  /* COM-03：本航线风险的三个阈值。owner 是业务方 —— 用户已按推荐值先行，但没有确认过。
     传对象引用而不是快照值，参数总览与本页读同一份。 */
  U.regParams({
    key: 'C01-ROUTE-RISK', name: '本航线风险判定阈值', page: '飞行活动管理 · 按航线看', hash: '#/flights',
    owner: '业务方', status: '待确认',
    note: '用户已按推荐值先行使用，业务方尚未确认；走廊内/邻近两档决定详情面板里哪些事件挂到该航线上',
    items: () => [
      { n: '走廊内判定', v: '距中心线 ≤ 半宽 + 容差（逐条航线取自 ROUTE_PARAMS）' },
      { n: '邻近提示半径', v: RISK_NEAR_KM + ' km（走廊外）' },
      { n: '时间窗', v: '近 ' + NEAR_DAYS + ' 天' }
    ]
  });

  /* ROUTE（航线走廊宽度与容差）参数组从已删除的「空域与航线」页迁来。
     迁而不是删：它的**消费方还在** —— 本页的「偏离报备航线」判定与「本航线风险」
     走廊内判据都读 ROUTE_PARAMS。页面没了不等于参数没了，
     参数总览上留一条指向不存在页面的记录，和删掉它一样是错的。 */
  U.regParams({
    key: 'ROUTE', name: '航线走廊宽度与容差', page: '飞行活动管理', hash: '#/flights',
    ver: 'demo-v1', confirmed: false, owner: '业务方',
    basis: '设计 §8.5 航线管理（走廊宽度与宽度容差）；取值为 Demo 缺省值，文档未给定',
    affects: ['走廊绘制范围', '「偏离报备航线」判定阈值', '航线与空域冲突检测'],
    items: () => {
      const P = M.ROUTE_PARAMS || {}, R = (M.routes || []);
      return [
        { n: '默认走廊宽度', v: (P.defaultWidthM || '—') + ' m' },
        { n: '默认宽度容差', v: '± ' + (P.defaultTolM || '—') + ' m' },
        { n: '偏离持续时长门限', v: (P.offRouteHoldSec || '—') + ' s（防单点 GPS 跳变误判）' },
        { n: '判偏离阈值', v: '走廊宽度 ÷ 2 + 容差（逐条航线可覆盖默认值）' },
        { n: '现有航线宽度分布', v: R.length ? [...new Set(R.map(r => r.widthM))].sort((a, b) => a - b).join(' / ') + ' m' : '—' },
        { n: '判据接入状态', v: '实际航迹未全量接入，「偏离报备航线」当前为不可判定' }
      ];
    }
  });

  g.PAGES = g.PAGES || {};
  g.PAGES.flights = { render, mount, destroy, setTab: t => { tab = t; } };
  /* 「空域与航线」模块已按用户指令删除。这里给 #/airspace 一个落点，
     转到飞行活动管理 —— 航线信息现在的归属地。
     为什么要留别名而不是让它落到默认页：未知路由会被 app.js 兜底到综合态势，
     **看起来正常，但标题会显示英文 `airspace`，而且用户不知道自己被送到了哪**。
     旧书签、旧链接、别处遗留的跳转都会走到这里，给个明确落点比让它悄悄改道好。 */
  g.PAGES.airspace = {
    render() { setTabRoute('route'); return render(); },
    mount(v) { return mount(v); },
    destroy() { return destroy(); }
  };

})(window);
