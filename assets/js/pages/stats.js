/* ===== 3. 统计分析 ===== */
(function (g) {
  const M = MOCK, U = UI, S = M.stats;

  function render() {
    const d0 = M.util.fmtD(M.util.dayAdd(M.CONF.demoTime, -29)), d1 = M.util.fmtD(M.CONF.demoTime);
    const prev = { total: Math.round(S.total / 1.11), illegal: Math.round(S.illegal / 1.17), punish: Math.round(S.punish / 1.18) };
    const dd = (a, b) => +((a - b) / b * 100).toFixed(1);

    return `
    <div class="panel mb12" style="flex:none"><div class="toolbar" style="border:0">
      ${U.field('时间维度', U.select('dim', ['近30天', '近7天', '本月', '本年'], '近30天'))}
      ${U.field('', `<input class="ip" style="width:210px" value="${d0} 至 ${d1}" readonly>`)}
      ${U.field('目标类型', U.select('tt', ['全部类型', ...M.T_TYPES.map(x => x[0])]))}
      ${U.field('区域', U.select('rg', ['全部区域', ...M.DISTRICTS.map(d => d.name)]))}
      <span style="flex:1"></span>
      <button class="btn" id="stExp">⭳ 导出数据</button>
      <button class="btn pri" id="stRep">⭳ 报表下载</button>
    </div></div>

    ${U.kpis([
      { label: '飞行/目标总次数', value: U.num(S.total), color: 'blue', icon: 'radar', desc: `较前30天 ${U.delta(dd(S.total, prev.total), { goodIsRed: true })}` },
      { label: '非法飞行次数', value: U.num(S.illegal), color: 'red', icon: 'alert', desc: `较前30天 ${U.delta(dd(S.illegal, prev.illegal), { goodIsRed: true })}` },
      { label: '处罚案件数', value: U.num(S.punish), color: 'orange', icon: 'gavel', desc: `较前30天 ${U.delta(dd(S.punish, prev.punish), { goodIsRed: true })}` },
      { label: '平均处置时长', value: Math.floor(S.avgDisposeSec / 60) + ':' + M.util.p2(S.avgDisposeSec % 60), color: 'green', icon: 'check', desc: `较前30天 ${U.delta(-8.3, { lowerBetter: true })}` },
      { label: '接入设备总数', value: U.num(M.deviceStats.total), color: 'cyan', icon: 'device', desc: `在线 ${M.deviceStats.online} · ${M.deviceStats.onlineRate}%` },
      { label: '高风险目标数', value: U.num(S.highRisk), color: 'purple', icon: 'zone', desc: `占比 ${U.pct(S.highRisk, S.total)}` }
    ])}

    <div class="row" style="height:270px;margin-top:12px">
      ${U.panel({
      title: '近30天目标趋势', style: 'flex:1.5',
      extra: U.select('tt2', ['全部类型', '无人机', '非无人机']),
      body: `<div id="sTrend" style="height:100%"></div>`
    })}
      ${U.panel({ title: '各风险等级分布', sub: '数量 | 占比', style: 'flex:.75', body: `<div id="sRisk" style="height:100%"></div>` })}
      ${U.panel({ title: '各类型目标占比', style: 'flex:1.25', body: `<div id="sType" style="height:100%"></div>` })}
    </div>

    <div class="row" style="height:262px;margin-top:12px">
      ${U.panel({
      title: '飞行高度分布 · 海拔高（AMSL）', sub: `altitude · 协议必填 · 参与统计 ${U.num(S.altTotal)} 个`,
      style: 'flex:1', body: `<div id="sAlt" style="height:100%"></div>`
    })}
      ${U.panel({
      title: '飞行高度分布 · 距地高（AGL）', sub: 'height_agl · 协议选填',
      style: 'flex:1', body: `<div id="sAgl" style="height:100%"></div>`
    })}
      ${U.panel({
      title: '两种高度为什么分开统计', style: 'width:300px', body: `
        <div style="font-size:12px;line-height:1.75;color:var(--txt-2)">
          <b style="color:var(--txt)">基准不同，不能合并。</b><br>
          <span class="mono">altitude</span> 是海拔高（AMSL，GPS/北斗给出，协议必填）；
          <span class="mono">height_agl</span> 是距地高（AGL，相对基站安装地面，<b>协议为选填</b>）。<br>
          空域限高两种基准都有（见空域与航线页 <span class="mono">limitDatum</span>），
          <b style="color:#ffb083">比错基准就是判错</b>，所以两图不合并、也不互相换算。
          <div style="margin-top:9px;padding-top:9px;border-top:1px solid var(--line)">
            <b style="color:#ff8b95">设备未上报 ${U.num((S.aglBands.find(b => b.absent) || {}).value)} 个</b>
            单列成一档，不用 <span class="mono">altitude</span> 顶替、也不从分母里拿掉 ——
            拿掉会让"120m 以下占比"这类指标凭空变好看。
          </div>
          <div style="margin-top:9px;color:var(--txt-3)">
            分档阈值 <span class="tag t-gray">待确认：业务方</span>
            现取 ${M.ALT_BANDS.edges.join(' / ')} m，呼应微轻型真高上限。
          </div>
        </div>`
    })}
    </div>
    <div class="row" style="height:288px;margin-top:12px;padding-bottom:12px">
      ${U.panel({
      title: '区域分布', sub: '东营市各区县', style: 'flex:1.5', nopad: true,
      extra: `<div class="tabs" style="border:0"><span class="tab" data-rt="heat">热力图</span><span class="tab on" data-rt="list">排行表</span></div>`,
      body: `<div id="sRegion" style="height:100%"></div>`
    })}
      ${U.panel({ title: '飞行时长统计', sub: '分钟', style: 'flex:.9', body: `<div id="sDur" style="height:100%"></div>` })}
      ${U.panel({ title: '轨迹长度统计', sub: '公里', style: 'flex:.9', body: `<div id="sTrack" style="height:100%"></div>` })}
      ${U.panel({ title: '处置/处罚统计', style: 'flex:1', body: `<div id="sPen" style="height:100%"></div>` })}
      ${U.panel({
      title: '违规主体排行', sub: '近30天', style: 'width:288px', nopad: true,
      body: (function () {
        // 由案件数据真实聚合:哪个主体违规最多 —— 支撑"重复违规主体"监管口径
        const gc = M.util.groupCount(M.cases, c => c.partner);
        const top = [...gc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([name, n]) => ({ name, n, fine: M.util.sum(M.cases.filter(c => c.partner === name && c.penalty === '罚款'), c => c.fine) }));
        return U.table([
          { t: '#', w: '34px', align: 'center', render: (r, i) => i < 3 ? `<span class="tag ${['t-red', 't-orange', 't-amber'][i]}">${i + 1}</span>` : i + 1 },
          // 声明 w 压不住内容：table-layout:auto 下 td 会按内容撑开。
          // 给内层容器一个显式宽度，td 才收得住（Session 2 在列宽压缩那轮的同一处教训）
          { t: '主体', w: '118px', render: r => `<div style="width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.name}">${
            r.name.includes('未知') ? `<span style="color:#ff8b95">${r.name}</span>` : r.name}</div>` },
          { t: '案件', w: '42px', align: 'right', cls: 'num', render: r => r.n },
          { t: '罚款', w: '48px', align: 'right', cls: 'num', render: r => r.fine ? (r.fine / 1000) + 'k' : '—' }
        ], top) + `<div style="padding:7px 10px;border-top:1px solid var(--line);font-size:11.5px;color:var(--txt-3)">
          「未知(无报备)」为黑飞主体,重点溯源对象</div>`;
      })()
    })}
    </div>`;
  }

  function regionTable() {
    return U.table([
      /* 1440 宽下本面板只有 298px，七列需要 378px。合并「目标 / 非法」与「案件 / 高危」
         两组同维度的数，并去掉可由「目标 / 总数」直接算出的占比列（表尾已给 100%）——
         表头文字本身也计入表格最小宽度，减列比调 w 有效。 */
      { t: '#', w: '34px', align: 'center', render: (r, i) => i < 3 ? `<span class="tag ${['t-amber', 't-gray', 't-orange'][i]}">${i + 1}</span>` : i + 1 },
      { t: '区域', k: 'name', w: '74px' },
      { t: '目标/非法', w: '80px', align: 'right', cls: 'num',
        render: r => `${r.total}<span style="color:var(--txt-3)">/</span><span style="color:#ff8b95">${r.illegal}</span>` },
      { t: '案件/高危', w: '80px', align: 'right', cls: 'num',
        render: r => `${r.punish}<span style="color:var(--txt-3)">/</span><span style="color:#ffb083">${r.highRisk}</span>` }
    ], M.stats.regions) +
      `<div style="padding:7px 10px;border-top:1px solid var(--line);display:flex;gap:0;font-size:12.5px">
        <span style="width:34px"></span><span style="flex:1;color:var(--txt-3)">合计</span>
        <b class="mono" style="width:80px;text-align:right">${U.num(M.util.sum(M.stats.regions, r => r.total))}
          <span style="color:var(--txt-3)">/</span> ${U.num(M.util.sum(M.stats.regions, r => r.illegal))}</b>
        <b class="mono" style="width:80px;text-align:right">${U.num(M.util.sum(M.stats.regions, r => r.punish))}
          <span style="color:var(--txt-3)">/</span> ${U.num(M.util.sum(M.stats.regions, r => r.highRisk))}</b></div>`;
  }

  function mount(view) {
    CH.line(document.getElementById('sTrend'), {
      x: S.days.map(d => d.md), yName: '次数',
      series: [
        { name: '目标总次数', data: S.days.map(d => d.total), color: CH.C.blue, area: true },
        { name: '非法飞行', data: S.days.map(d => d.illegal), color: CH.C.red },
        { name: '处罚案件', data: S.days.map(d => d.punish), color: CH.C.amber }
      ]
    });
    const rc = { '超高风险': '#c0392b', '高风险': '#ff4d5e', '中风险': '#ffb020', '低风险': '#2fd06e', '未识别': '#8ca0be' };
    CH.bar(document.getElementById('sRisk'), {
      x: S.byRisk.map(r => r.name), legend: false, yName: '数量',
      series: [{ name: '数量', data: S.byRisk.map(r => r.value), colorBy: p => rc[S.byRisk[p.dataIndex].name] }]
    });
    CH.donut(document.getElementById('sType'), { data: S.byType, center: ['30%', '50%'] });
    document.getElementById('sRegion').innerHTML = regionTable();
    CH.bar(document.getElementById('sDur'), {
      x: S.byDuration.map(d => d.name), legend: false, yName: '次数',
      series: [{ name: '次数', data: S.byDuration.map(d => d.value), color: CH.C.blue, fmt: p => p.value + '\n' + (p.value / S.total * 100).toFixed(1) + '%' }]
    });
    CH.bar(document.getElementById('sTrack'), {
      x: S.byTrack.map(d => d.name), legend: false, yName: '次数',
      series: [{ name: '次数', data: S.byTrack.map(d => d.value), color: CH.C.cyan, fmt: p => p.value + '\n' + (p.value / S.total * 100).toFixed(1) + '%' }]
    });
    /* 高度分布：两个基准各一张图，缺失档用灰色区别于有值档 */
    CH.bar(document.getElementById('sAlt'), {
      x: S.altBands.map(d => d.name), legend: false, yName: '目标数',
      series: [{ name: '目标数', data: S.altBands.map(d => d.value), color: CH.C.blue,
        fmt: p => p.value + '\n' + (p.value / S.altTotal * 100).toFixed(1) + '%' }]
    });
    CH.bar(document.getElementById('sAgl'), {
      x: S.aglBands.map(d => d.name), legend: false, yName: '目标数',
      series: [{ name: '目标数', color: CH.C.cyan,
        data: S.aglBands.map(d => d.absent
          ? { value: d.value, itemStyle: { color: '#5b6b85' } } : d.value),
        fmt: p => p.value + '\n' + (p.value / S.altTotal * 100).toFixed(1) + '%' }]
    });
    CH.donut(document.getElementById('sPen'), {
      data: S.byPenalty.map((p, i) => ({ name: p.name, value: p.value, c: ['#2fd06e', '#ff4d5e', '#ffb020'][i] })),
      center: ['32%', '50%']
    });

    U.on(view, '[data-rt]', 'click', (e, el) => {
      view.querySelectorAll('[data-rt]').forEach(x => x.classList.toggle('on', x === el));
      const box = document.getElementById('sRegion');
      if (el.dataset.rt === 'list') { box.innerHTML = regionTable(); }
      else {
        box.innerHTML = '';
        const max = Math.max(...S.regions.map(r => r.total));
        CH.hbar(box, {
          y: S.regions.map(r => r.name), data: S.regions.map(r => r.total),
          colors: S.regions.map(r => r.illegal / r.total > .05 ? '#ff4d5e' : '#3d8bff')
        });
      }
    });
    document.getElementById('stExp').onclick = () => U.toast('已导出「近30天统计明细.xlsx」（Demo：接口 /api/v1/stats/export）', 'ok');
    document.getElementById('stRep').onclick = () => U.toast('已生成「东营市低空运行月报」PDF（Demo）', 'ok');
  }

  g.PAGES = g.PAGES || {};
  g.PAGES.stats = { render, mount };
})(window);
