/* =============================================================================
 * 综合态势 —— 首页只回答四个问题
 *   1 现在天上有多少目标？  2 有没有高风险？  3 有没有人在处置？  4 设备靠不靠得住？
 * 其余统计一律进「分析报告」。首页多放一张图，甲方就要多花十秒找重点。
 * ========================================================================== */
(function (g) {
  const M = MOCK, U = UI;
  let map = null;

  const LV = { '高': 1, '中': 2, '低': 3 };

  function render() {
    const S = M.todayStats, D = M.deviceStats;
    const yd = M.stats.days[M.stats.days.length - 2];
    const d = (a, b) => b ? +((a - b) / b * 100).toFixed(1) : 0;
    const airborne = M.liveTargets.length;
    const C = EVT.counts();          // 实时计数，随演示中的核实/立案/结案而变
    const highRisk = M.todayAlarms.filter(a => a.level === '高' && a.status !== '已关闭' && a.status !== '误报').length;

    const kpi = U.kpis([
      {
        label: '当前空中目标', value: U.num(airborne), unit: '个', color: 'blue', icon: 'radar',
        desc: `今日累计感知 ${S.total} 个 · 较昨日 ${U.delta(d(S.total, yd.total), { goodIsRed: true })}`
      },
      {
        label: '高风险事件', value: U.num(highRisk), unit: '起', color: 'red', icon: 'alert',
        desc: highRisk ? `其中 ${C.pending} 起待核实，需立即处理` : '暂无未闭环的高风险事件'
      },
      {
        label: '正在处置', value: U.num(C.disposing), unit: '起', color: 'orange', icon: 'gavel',
        desc: `今日已办结 ${C.closed} 起 · 立案 ${C.cases} 件`
      },
      {
        label: '设备在线率', value: D.onlineRate, unit: '%', color: 'green', icon: 'device',
        desc: `在线 ${D.online} / 共 ${U.num(D.total)} 台 · 离线 ${D.offline}`
      }
    ]);

    /* 高度用 flex 分，不用 100vh 减常数：
       外壳（顶栏 / 面包屑 / 内边距）任何一处改高度，那个常数就悄悄失准 ——
       表现是底部那行被裁掉一截，看起来像"这块本来就这么高"。
       .view 是 .main 的 flex:1 子项、有确定高度，所以这里 height:100% 是有解的。 */
    return `<div style="display:flex;flex-direction:column;gap:14px;height:100%;padding-bottom:12px">
    <div style="flex:none">${kpi}</div>
    <div class="row" style="flex:1;min-height:240px">
      ${U.panel({
      title: '东营区域实时态势', sub: '四路融合', style: 'flex:1',
      nopad: true, bodyStyle: 'padding:8px',
      extra: `<span style="font-size:12.5px;color:var(--txt-3)">点击地图上的目标查看实时态势</span>
              <button class="btn ghost" onclick="location.hash='#/situation'">融合感知 →</button>`,
      body: `<div id="ovMap" style="width:100%;height:100%"></div>`
    })}
      ${U.panel({
      title: '重点事件', sub: `需要关注的 ${EVT.focus(4).length} 起`, style: 'width:396px;flex:none',
      extra: `<span class="lnk" onclick="location.hash='#/alarms'">全部告警 ›</span>`,
      bodyStyle: 'padding:12px;overflow:auto',
      body: `<div class="focus">${focusCards()}</div>`
    })}
    </div>
    <div class="row" style="flex:none;height:186px">
      ${U.panel({
      title: '今日业务闭环', sub: '发现 → 研判 → 告警 → 处置 → 归档', style: 'flex:1.55',
      extra: `<span class="lnk" onclick="location.hash='#/stats'">运行统计 ›</span>`,
      body: `<div class="loop">${loopHtml()}</div>
        <div style="margin-top:12px;font-size:12.5px;color:var(--txt-3);line-height:1.7">
          闭环率 <b style="color:#79e5a5;font-size:14px">${U.pct(C.closed, C.alarmed)}</b>
          （已办结 / 今日告警）· 平均响应 <b style="color:#8fbaff;font-size:14px">${avgRespond()}</b>
          <span style="color:var(--txt-3)">（告警触发至人工核实完成）</span></div>`
    })}
      ${U.panel({
      title: '近 7 天告警趋势', style: 'flex:1',
      body: `<div id="ovTrend" class="chart" style="height:100%"></div>`
    })}
    </div></div>`;
  }

  /* 平均响应时间从案件环节时间戳算出来，不写常数：
     首页写一个"6.4 分钟"，甲方追问口径时答不上来 —— 而这个数正是他们最会追问的一个。
     口径：已完成「人工核实」的案件，steps[0] 告警触发 → steps[1] 人工核实 的时间差。 */
  function avgRespond() {
    const ts = t => t && t !== '待处理' ? new Date(t.replace(/-/g, '/')).getTime() : null;
    const gaps = M.cases.map(c => {
      const a = ts((c.steps[0] || {}).t), b = ts((c.steps[1] || {}).t);
      return a && b && b > a ? (b - a) / 60000 : null;
    }).filter(x => x != null);
    if (!gaps.length) return '暂无样本';
    const m = gaps.reduce((s2, x) => s2 + x, 0) / gaps.length;
    return (m < 60 ? m.toFixed(1) + ' 分钟' : (m / 60).toFixed(1) + ' 小时') + ` <span style="font-size:11.5px;color:var(--txt-3)">（${gaps.length} 件）</span>`;
  }

  function loopHtml() {
    return EVT.loop().map((x, i) => {
      const c = ['#8fbaff', '#79e6f6', '#ffd07a', '#ffb083', '#79e5a5'][i];
      return `<div class="lp"><span class="n">${x.n}</span>
        <span class="v" style="color:${c}">${U.num(x.v)}</span>
        <span class="s">${x.s}</span></div>`;
    }).join('');
  }

  function focusCards() {
    return EVT.focus(4).map(a => {
      const t = M.allTargets.find(x => x.id === a.targetId) || {};
      return `<div class="f lv${LV[a.level] || 3}" data-ev="${a.targetId}">
        <div class="r1"><span class="id">${a.targetId}</span>
          ${U.tag(a.level + '风险', a.level === '高' ? 't-red' : a.level === '中' ? 't-amber' : 't-blue')}
          ${U.tag(a.type, a.kind === '空间安全' ? 't-purple' : 't-orange')}
          <span style="margin-left:auto">${U.tag(EVT.phase(EVT.of(a.targetId) || { stage: 1, alarm: a }))}</span></div>
        <div class="r2">${a.district} · ${a.detail}</div>
        <div class="r3"><span class="mono">${a.time.slice(11)}</span>
          <span>${t.legal && t.legal !== '不适用' ? '判定 ' + t.legal : '空间安全风险'}</span>
          <span class="go">进入告警中心 ›</span></div>
      </div>`;
    }).join('') || `<div class="empty">今日暂无需要关注的事件</div>`;
  }

  function mount(view) {
    const S = M.todayStats;
    map = new MapView(document.getElementById('ovMap'), {
      maxDev: 32, maxAlarm: 4, zoom: 1.06,
      showAirspaceLabels: false, showTargetLabels: false,
      onPick: p => {
        if (p.kind === 'target') location.hash = '#/situation';
        else if (p.kind === 'alarm') location.hash = '#/alarms';
        else if (p.kind === 'device') location.hash = '#/devices';
        else if (p.kind === 'airspace') location.hash = '#/airspace';
      }
    });
    map.setData({
      airspaces: M.airspaces, devices: M.devices.filter((d, i) => i % 12 === 0),
      targets: M.liveTargets.slice(0, 6), alarms: EVT.focus(4)
    });

    CH.line(document.getElementById('ovTrend'), {
      x: S.alarmTrend.map(t => t.date),
      series: [
        { name: '告警总数', data: S.alarmTrend.map(t => t.total), color: CH.C.blue, area: true, label: true },
        { name: '高风险', data: S.alarmTrend.map(t => t.high), color: CH.C.red, label: true }
      ]
    });

    U.on(view, '[data-ev]', 'click', () => { location.hash = '#/alarms'; });
  }

  function destroy() { if (map) { map.destroy(); map = null; } }
  g.PAGES = g.PAGES || {};
  g.PAGES.overview = { render, mount, destroy };
})(window);
