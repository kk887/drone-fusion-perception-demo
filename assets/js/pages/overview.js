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
      extra: `<span style="font-size:12.5px;color:var(--txt-3)">点击告警点位下钻到融合感知</span>
              <button class="btn ghost" onclick="location.hash='#/situation'">融合感知 →</button>`,
      body: `<div id="ovMap" style="width:100%;height:100%"></div>`
    })}
      ${U.panel({
      title: '重点事件', sub: `需要关注的 ${EVT.focus(4).length} 起`, style: 'width:396px;flex:none',
      extra: `<span class="lnk" onclick="location.hash='#/alarms'">全部告警 ›</span>`,
      bodyStyle: 'padding:12px;overflow:auto',
      body: `<div class="focus">${focusCards()}</div>`
    })}
    </div></div>`;
    /* 底部行（今日业务闭环 / 近7天告警趋势）已按用户裁定整行删除，
       上方「实时态势 + 重点事件」行是 flex:1，自动占满腾出的高度。 */
  }

  /* loopHtml 与 avgRespond 已随「今日业务闭环」面板删除 */

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
    /* 差异化分工（用户裁定 2026-08-27）：本页是指挥总览，不做单目标细节 ——
       track 图层整体关掉（不画目标图标与轨迹），只留设备覆盖、空域、告警点位；
       单目标追踪/处置归融合感知，点告警点位带目标上下文下钻过去。 */
    map = new MapView(document.getElementById('ovMap'), {
      maxDev: 32, maxAlarm: 4, zoom: 1.06, layers: { track: false },
      showAirspaceLabels: false,
      onPick: p => {
        if (p.kind === 'alarm') { U.goto('situation', { target: p.data.targetId }); location.hash = '#/situation'; }
        else if (p.kind === 'device') location.hash = '#/devices';
        else if (p.kind === 'airspace') location.hash = '#/airspace';
      }
    });
    map.setData({
      airspaces: M.airspaces, devices: M.devices.filter((d, i) => i % 12 === 0),
      targets: M.liveTargets.slice(0, 6), alarms: EVT.focus(4)
    });

    U.on(view, '[data-ev]', 'click', () => { location.hash = '#/alarms'; });
  }

  function destroy() { if (map) { map.destroy(); map = null; } }
  g.PAGES = g.PAGES || {};
  g.PAGES.overview = { render, mount, destroy };
})(window);
