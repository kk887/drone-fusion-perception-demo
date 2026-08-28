/* ===== 6. 设备实时监测 ===== */
(function (g) {
  const M = MOCK, U = UI, D = M.deviceStats;
  let tab = '运行状态', timer = null, charts = {}, logTimer = null;
let chartPaused = false, logPaused = false;   // 图表刷新与日志滚动是两个独立开关

  const T0 = M.CONF.demoTime.getTime();
  function timeAxis(n, stepS) { return Array.from({ length: n }, (_, i) => M.util.fmtT(new Date(T0 - (n - 1 - i) * stepS * 1000)).slice(0, 5)); }
  /* 图表基线序列必须可复现：以前用 Math.random，无关交互触发 paint() 时整条曲线就重画一遍，
     看的人会以为设备指标在剧烈波动 —— 而它只是被重绘了。改用稳定键 seeded。 */
  function series(n, base, amp, min, max, key) {
    const rr = CH.seeded('mnSeries|' + (key || base + '|' + amp) + '|' + n);
    let v = base;
    return Array.from({ length: n }, () => { v += (rr(0, 1000) / 1000 - .5) * amp; v = Math.max(min, Math.min(max, v)); return +v.toFixed(1); });
  }

  /* 设备告警（由设备台账派生，保证与 KPI 一致） */
  const devAlarms = M.devices.filter(d => d.alarm).map((d, i) => {
    const t = new Date(T0 - i * M.util.ri(20, 240) * 1000);
    const kind = d.status === '离线' ? '设备离线' : (d.loss > 15 ? '接口异常' : d.temp > 70 ? '温度过高' : d.latency > 120 ? '网络抖动' : '信号弱');
    return {
      lv: kind === '设备离线' || kind === '接口异常' ? '高' : kind === '温度过高' || kind === '网络抖动' ? '中' : '低',
      kind, dev: d, name: d.name, time: M.util.fmtT(t), ts: t.getTime(),
      msg: kind === '设备离线' ? `设备离线，最后心跳 ${d.hb}` :
        kind === '接口异常' ? `网口丢包率 ${d.loss}%，阈值 20%` :
          kind === '温度过高' ? `设备温度 ${d.temp}℃，阈值 70℃` :
            kind === '网络抖动' ? `延迟波动 ${d.latency}ms，阈值 100ms` : `信号强度 ${d.rssi}dBm，阈值 -90dBm`
    };
  }).sort((a, b) => b.ts - a.ts);

  function render() {
    const faults = devAlarms.filter(a => a.lv === '高').length;
    return `${U.kpis([
      { label: '在线设备', value: U.num(D.online), color: 'cyan', icon: 'device', desc: `在线率 ${D.onlineRate}%` },
      { label: '离线设备', value: U.num(D.offline), color: 'red', icon: 'alert', desc: `离线率 ${D.offlineRate}%` },
      { label: '异常设备', value: U.num(D.abnormal), color: 'orange', icon: 'alert', desc: `异常率 ${D.abnormalRate}%` },
      { label: '告警设备', value: U.num(D.alarm), color: 'amber', icon: 'alert', desc: `告警率 ${D.alarmRate}%` },
      { label: '平均链路时延', value: D.avgLatency, unit: 'ms', color: 'green', icon: 'api', desc: `较昨日 ${U.delta(-14.3, { lowerBetter: true })}` },
      { label: '今日故障数', value: faults, color: 'purple', icon: 'tool', desc: '高等级告警计数' }
    ])}

    <div class="row" style="margin-top:12px;height:calc(100vh - 442px);min-height:300px">
      ${U.panel({
      title: '设备分类与状态', style: 'width:262px', nopad: true,
      body: `<div style="padding:8px"><div class="search-input">${U.icon('search')}<input class="ip" style="width:100%" placeholder="搜索设备名称或编号" id="mnKw"></div></div>
        <div class="tree" id="mnTree" style="padding:0 8px 8px;overflow:auto"></div>`
    })}
      ${U.panel({
      title: '设备运行监控', style: 'flex:1.5', nopad: true,
      sub: `${['运行状态', '信号与链路'].map(t =>
        `<span class="tab ${t === tab ? 'on' : ''}" data-mt="${t}" style="padding:4px 10px">${t}</span>`).join('')}`,
      // 下拉里的选项是**接入通道**不是设备，原来标成「全部设备」是错的；且它以前没有任何事件绑定
      extra: `${U.select('mnCh', ['全部通道', ...M.deviceStats.byChannel.map(c => c.channel)])}
        <button class="btn ghost" id="mnPause">${U.icon('pause')} 实时</button>`,
      body: `
        <div id="mnBody" style="flex:1;padding:10px;overflow:auto"></div>`
    })}
      ${U.panel({
      title: '实时告警', sub: `共 ${devAlarms.length} 条`, style: 'width:430px', nopad: true,
      extra: U.select('lv', ['全部级别', '高', '中', '低']),
      body: `<div id="mnAlarms" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>`
    })}
    </div>


    ${U.panel({
      title: '监测日志流', style: 'height:194px;margin-top:12px;margin-bottom:12px', nopad: true,
      /* 类型列表取数据层的 byType（按 DEV_TYPES 顺序），不要用 devices.slice(0,8) 去凑 ——
         设备是按类型顺序生成的，前 46 台全是雷达，那样写下拉里永远只有「雷达」一项。
         而且这个下拉原来没有绑任何处理器，选了也不过滤；现在接到与设备树同一个 flt.type 上。 */
      extra: `<select class="sel" id="mnType" style="height:26px">
          <option value="">全部类型</option>
          ${M.deviceStats.byType.map(t => `<option value="${t.type}">${t.type}（${t.total}）</option>`).join('')}
        </select>
        <button class="btn" id="mnHold">${U.icon('pause')} 暂停滚动</button><button class="btn" id="mnClear">${U.icon('trash')} 清空</button>`,
      body: `<div id="mnLog" style="flex:1;overflow:auto;padding:8px 12px"></div>`
    })}`;
  }

  /* 过滤状态:点树节点 → 右侧告警表与日志流联动过滤;再点一次取消 */
  /* selDev：正在下钻查看的单台设备（null = 全站聚合）。
     scopeCh：顶部下拉的通道范围。
     此前这两个都不存在 —— 页面叫「设备实时监测」，却只能看全站聚合：
     搜索能搜到「广饶县雷达01号 · 命中 1 台」，右侧 CPU/信号/链路 却纹丝不动。 */
  let selDev = null, scopeCh = null;
  let flt = { channel: null, type: null, status: null, kw: '' };
  /* 当前监控范围内的设备集合 —— 环形图、迷你曲线、信号/链路曲线全部据此取数 */
  function scopeDevs() {
    if (selDev) return [selDev];
    if (scopeCh) return M.devices.filter(d => d.channel === scopeCh);
    return M.devices;
  }
  function scopeKey() { return selDev ? 'dev:' + selDev.id : scopeCh ? 'ch:' + scopeCh : 'all'; }
  function scopeLabel() { return selDev ? selDev.name : scopeCh ? scopeCh + ' 通道' : '全部设备'; }
  const fkey = () => flt.channel || flt.type || flt.status ?
    [flt.channel, flt.type, flt.status].filter(Boolean).join(' / ') : null;
  function matchDev(d) {
    return (!flt.channel || d.channel === flt.channel) &&
      (!flt.type || d.type === flt.type) &&
      (!flt.status || d.status === flt.status) &&
      (!flt.kw || d.name.includes(flt.kw) || d.id.includes(flt.kw));
  }
  function tree() {
    const kwDevs = flt.kw ? M.devices.filter(d => d.name.includes(flt.kw) || d.id.includes(flt.kw)) : null;
    if (kwDevs) {
      // 搜索模式:平铺命中设备,点击查看详情
      return `<div style="padding:4px 8px;font-size:11.5px;color:var(--txt-3)">命中 ${kwDevs.length} 台</div>` +
        kwDevs.slice(0, 30).map(d => `<div class="tn ${selDev && selDev.id === d.id ? 'filter-on' : ''}" data-mon="${d.id}" tabindex="0" title="查看该设备的资源 / 信号 / 链路">
          <span class="dot-s" style="background:${d.status === '在线' ? '#2fd06e' : d.status === '离线' ? '#8ca0be' : '#ff4d5e'}"></span>
          ${d.name}<span class="cnt">${d.type}</span></div>`).join('') +
        (kwDevs.length > 30 ? `<div class="tn" style="color:var(--txt-3)">… 其余 ${kwDevs.length - 30} 台，请细化关键字</div>` : '');
    }
    return M.deviceStats.byChannel.map(c => {
      const types = M.deviceStats.byType.filter(t => t.channel === c.channel);
      const onCh = flt.channel === c.channel && !flt.type && !flt.status;
      return `<div class="tn ${onCh ? 'filter-on' : ''}" data-fc="${c.channel}" tabindex="0"><span>▾</span>${c.channel}<span class="cnt">${c.total}</span></div>
        <div class="ch">
          ${types.map(t => {
        // 展开条件加 selDev：从告警行点进来的设备，其所在类型要自动展开并高亮 ——
        // 不走 flt（筛选），否则右侧告警列表会被同时过滤掉，值班员正逐条看告警
        const on = (flt.type === t.type && flt.channel === c.channel)
          || (selDev && selDev.type === t.type && selDev.channel === c.channel);
        const devs = on ? M.devices.filter(d => d.type === t.type && d.channel === c.channel) : [];
        return `<div class="tn ${on ? 'filter-on' : ''}" data-ft="${t.type}|${c.channel}" tabindex="0">
            <span style="opacity:.55;margin-right:2px">${on ? '▾' : '▸'}</span>${t.type}<span class="cnt">${t.total}</span></div>` +
          /* 展开到设备实例 —— 之前树只到「通道 → 类型 → 状态」，
             点不进任何一台具体设备，所以「设备实时监测」监测不了某一台设备。 */
          (devs.length ? `<div class="ch" style="padding-left:10px">${devs.slice(0, 40).map(d =>
            `<div class="tn ${selDev && selDev.id === d.id ? 'filter-on' : ''}" data-mon="${d.id}" tabindex="0"
                 title="查看该设备的资源 / 信号 / 链路">
              <span class="dot-s" style="background:${d.status === '在线' ? '#2fd06e' : d.status === '离线' ? '#8ca0be' : '#ff4d5e'}"></span>
              ${d.name}${d.alarm ? ' <span class="tag t-amber" style="transform:scale(.82)">告警</span>' : ''}</div>`).join('')
            + (devs.length > 40 ? `<div class="tn" style="color:var(--txt-3)">… 其余 ${devs.length - 40} 台，用上方搜索定位</div>` : '')
            }</div>` : '');
      }).join('')}
          ${[['在线', '#2fd06e', c.online], ['离线', '#8ca0be', c.offline], ['异常', '#ff4d5e', c.abnormal]].map(([n, col, v]) =>
        `<div class="tn ${flt.status === n && flt.channel === c.channel ? 'filter-on' : ''}" data-fs="${n}|${c.channel}" tabindex="0">
              <span class="dot-s" style="background:${col}"></span>${n}<span class="cnt">${v}</span></div>`).join('')}
        </div>`;
    }).join('') + `<div style="border-top:1px solid var(--line-2);margin-top:8px;padding-top:8px;font-size:12px;color:var(--txt-3)">
      全部设备 (${D.total})${fkey() ? ` · 过滤中：<b style="color:#79e6f6">${fkey()}</b> <span class="lnk" data-fclear>清除</span>` : ' · 展开类型可下钻到单台设备'}</div>`;
  }

  function alarmRows() {
    return U.table([
      { t: '等级', w: '46px', align: 'center', render: a => U.tag(a.lv, a.lv === '高' ? 't-red' : a.lv === '中' ? 't-amber' : 't-blue') },
      { t: '类型', k: 'kind', w: '78px' },
      {
        t: '设备 / 告警内容', render: a => `<div>${a.name}</div>
          <div style="font-size:11px;color:var(--txt-3);white-space:normal">${a.msg}</div>`
      },
      { t: '时间', k: 'time', w: '62px', cls: 'num' }
    ], devAlarms.filter(a => matchDev(a.dev)).slice(0, 40), { rowId: a => a.dev.id })
      + (function () {          // 截断要说出去，否则「共 40 条」会被读成"就这么多"
        const n = devAlarms.filter(a => matchDev(a.dev)).length;
        return n > 40 ? `<div style="padding:5px 12px;font-size:11px;color:var(--txt-3)">
          共 ${n} 条，此处只列最近 40 条 —— 用上方设备树或关键字缩小范围查看其余 ${n - 40} 条</div>` : '';
      })();
  }

  function body() {
    const box = document.getElementById('mnBody');
    if (tab === '运行状态') {
      /* 协议里没有 cpu/内存/磁盘 —— 三份协议 grep 0 命中，此前那三个环是编的：
         设备工参上报只有 workState 与各类型 SenseDeviceExtension（雷达报探测距离
         与覆盖角、光电报云台与拍摄能力、反制类报打击状态）。所以这里按类型给
         协议真有的字段；Demo 没有实时值的项如实标占位，不编数。 */
      const ds = scopeDevs(), one = ds.length === 1 ? ds[0] : null;
      const TBC = '【待确认：设备方提供】';
      let statHtml;
      if (one) {
        const d = one;
        const isC = ['cm', 'dec', 'ifr', 'bsc'].includes(d.deviceTypeAbbr);
        const ws = d.workState === 2 ? '<span class="tag t-red">设备异常</span>'
          : d.workState === 1 ? (isC ? '<span class="tag t-orange">打击中</span>' : '<span class="tag t-green">工作中</span>')
            : (isC ? '<span class="tag t-gray">待机</span><span style="color:var(--txt-3);font-size:11px">（反制类常态，协议语义）</span>'
              : '<span class="tag t-gray">未工作</span>');
        const COMMON = [
          ['在线状态', `${U.dotState(d.status)}　<span style="color:var(--txt-3);font-size:11px">判据：30s 收不到工参即离线（协议 v8.6）</span>`],
          ['工作状态 workState', ws],
          ['最后上报', `<span class="mono">${d.hb}</span>`],
          ['工参上报周期', isC ? '常态 5~10s · <b style="color:#ffb083">打击中 1s/次</b>（协议要求实时更新打击状态）' : '5~10s（协议建议值）'],
          ['平台侧链路', d.latency != null
            ? `时延 <b class="mono">${d.latency} ms</b> · 丢包 <b class="mono">${d.loss != null ? d.loss : '—'}%</b>　<span class="tag t-gray">平台侧实测，非设备上报</span>`
            : '<span style="color:var(--txt-3)">离线，无链路数据</span>']
        ];
        const T = {
          radar: [['探测距离', d.cover || TBC], ['覆盖角度（水平 / 垂直）', TBC], ['工作频段', d.freq || TBC]],
          oe: [['云台朝向 / 焦距 / 视场角', '<span style="color:var(--txt-3)">边端心跳上报 · Demo 未接入实时值</span>'],
            ['支持能力（oeTypes）', '拍照 / 摄像'], ['视频流', '<span class="mono">mediaPullStream / mediaAiPullStream</span>']],
          tdoa: [['探测距离', d.cover || TBC], ['频点覆盖', d.freq || TBC]],
          aoa: [['探测距离', d.cover || TBC], ['频点覆盖', d.freq || TBC],
            ['测向方式', '仅方位角，不提供距离与高度（协议 v8.6）']],
          cm: [['作用范围', d.cover || TBC], ['作用频段', '由设备自行决定（协议未定义枚举）']],
          dec: [['作用范围', d.cover || TBC], ['作用频段', '由设备自行决定（协议未定义枚举）']],
          ifr: [['作用范围', d.cover || TBC], ['作用频段', '由设备自行决定（协议未定义枚举）']],
          bsc: [['作用范围', d.cover || TBC], ['驱鸟参数（声压级/间隔）', TBC]],
          dcd: [['可解析信息', 'uavSN / 机型线索（协议破解）'], ['监听频段', d.freq || TBC]],
          rid: [['接收方式', 'RemoteID 广播（地面站）']],
          '5ga': [['工作频段', d.freq || TBC], ['感知方式', '通感一体基站']],
          other: [['角色', '边端融合终端 · 汇聚子设备数据']]
        };
        const rows = COMMON.concat(T[d.deviceTypeAbbr] || []);
        statHtml = `${U.detailHero({
          icon: 'mon', title: d.name, subtitle: '设备实时监测', id: d.id,
          tags: [U.tag(d.status), U.tag(d.type, 't-cyan')],
          meta: [['接入通道', d.channel], ['协议字段', 'v8.6 工参 + SenseDeviceExtension']]
        })}
          ${U.metricStrip([
            { label: '在线状态', value: d.status, tone: d.status === '在线' ? 'good' : d.status === '异常' ? 'bad' : 'warn', icon: 'device' },
            { label: '最后心跳', value: d.hb ? d.hb.slice(11) : '—', sub: d.hbMin != null ? d.hbMin + ' 分钟前' : '', icon: 'clock' },
            { label: '时延 / 丢包', value: d.latency == null ? '—' : d.latency + 'ms', sub: d.loss == null ? '' : '丢包 ' + d.loss + '%', tone: d.loss > 5 ? 'warn' : 'info', icon: 'trend' },
            { label: '工作状态', value: d.workState || d.health || '—', tone: d.health === '良好' ? 'good' : 'info', icon: 'mon' }
          ], { compact: true })}
          <div style="font-size:12px;color:#9ec6ff;margin:2px 0 8px">
            <span class="lnk" data-mnclear>返回全部 ›</span></div>
          ${U.sect('运行状态与能力参数', U.kv(rows, { surface: true, density: 'compact' }), { icon: 'mon' })}`;
      } else {
        statHtml = `<div style="font-size:12px;color:#9ec6ff;margin-bottom:6px">各类型设备状态
            <span style="color:var(--txt-3)">（点左侧树或右侧告警行可查看单台的协议字段）</span></div>` +
          U.table([
            { t: '类型', k: 'type', w: '96px' },
            { t: '通道', k: 'channel', w: '92px' },
            { t: '总数', k: 'total', w: '52px', align: 'right', cls: 'num' },
            { t: '在线', w: '52px', align: 'right', cls: 'num', render: r => `<span style="color:#79e5a5">${r.online}</span>` },
            { t: '离线', w: '52px', align: 'right', cls: 'num', render: r => `<span style="color:#8ca0be">${r.offline}</span>` },
            { t: '异常', w: '52px', align: 'right', cls: 'num', render: r => r.abnormal ? `<span style="color:#ff8b95">${r.abnormal}</span>` : '0' }
          ], M.deviceStats.byType.filter(t2 => !scopeCh || t2.channel === scopeCh)) +
          `<div style="padding:6px 2px 0;font-size:11px;color:var(--txt-3)">
            协议不上报 CPU / 内存 / 磁盘等主机指标（三份协议均无此字段），本页不展示。</div>`;
      }
      box.innerHTML = `<div id="mnStat">${statHtml}</div>`;
    } else {
      /* 「信号与链路」页签：原运行状态底部的两张图整页化（用户指令 2026-08-27）。
         仍随左侧选中的设备/通道切换取数。 */
      const ds = scopeDevs(), one = ds.length === 1 ? ds[0] : null;
      box.innerHTML = `<div class="row" style="height:100%">
        <div class="f1"><div style="font-size:12px;color:var(--txt-2)">信号强度 (dBm)
          <span class="tag t-gray" style="font-size:10.5px">平台侧实测</span></div><div id="mnSig" style="height:calc(100% - 20px)"></div></div>
        <div class="f1"><div style="font-size:12px;color:var(--txt-2)">链路质量 (%)
          <span class="tag t-gray" style="font-size:10.5px">平台侧实测</span></div><div id="mnLink" style="height:calc(100% - 20px)"></div></div>
      </div>`;
      /* 单台设备：曲线以它自己的 rssi / latency / loss 为基线，不再画四条与它无关的类型曲线 */
      charts.sig = CH.line(document.getElementById('mnSig'), {
        x: timeAxis(24, 150),
        series: one
          ? [{ name: one.name, data: series(24, one.rssi != null ? one.rssi : -70, 5, -110, -40, scopeKey() + '|sig'), color: CH.C.cyan, symbolSize: 0, area: true }]
          : [...new Set(ds.map(d => d.type))].slice(0, 4).map((n, i) => ({
            name: n, symbolSize: 0,
            data: series(24, Math.round(M.util.sum(ds.filter(d => d.type === n && d.rssi != null), d => d.rssi)
              / Math.max(1, ds.filter(d => d.type === n && d.rssi != null).length)) || (-60 - i * 9),
              7, -110, -40, scopeKey() + '|sig' + n)
          }))
      });
      charts.link = CH.line(document.getElementById('mnLink'), {
        x: timeAxis(24, 150),
        series: [{ name: one ? '链路质量' : '主链路',
          data: series(24, one && one.loss != null ? Math.max(60, 100 - one.loss * 8) : 92, 5, 60, 100, scopeKey() + '|lk1'), color: CH.C.cyan, symbolSize: 0 },
        { name: '备链路', data: series(24, 78, 7, 50, 96, scopeKey() + '|lk2'), color: CH.C.green, symbolSize: 0 }]
      });
    }
  }

  function logLine(i) {
    const pool = devAlarms.filter(a => matchDev(a.dev));
    if (!pool.length) return '';
    const a = pool[i % pool.length];
    const t = M.util.fmtDT(new Date(T0 - i * 14000));
    return `<div class="l"><span class="tm">${t}</span><span style="width:130px">${a.name}</span>
      <span style="width:70px;color:var(--txt-3)">${a.dev.type}</span><span style="width:80px">${a.kind}</span>
      <span style="flex:1">${a.msg}</span>${U.tag(a.lv, a.lv === '高' ? 't-red' : a.lv === '中' ? 't-amber' : 't-blue')}</div>`;
  }

  function mount(view) {
    document.getElementById('mnTree').innerHTML = tree();
    document.getElementById('mnAlarms').innerHTML = alarmRows();
    body();
    const log = document.getElementById('mnLog');
    log.className = 'logflow';
    log.innerHTML = Array.from({ length: 8 }, (_, i) => logLine(i)).join('');
    let li = 8;
    logTimer = setInterval(() => {
      if (logPaused || !document.getElementById('mnLog')) return;
      log.insertAdjacentHTML('afterbegin', logLine(li++));
      while (log.children.length > 60) log.lastElementChild.remove();
    }, 2200);

    // 图表实时滚动
    timer = setInterval(() => {
      if (chartPaused) return;
      Object.keys(charts).forEach(k => {
        const c = charts[k]; if (!c || !c.getOption) return;
        const o = c.getOption(); if (!o.series || !o.series[0] || !o.series[0].data || o.series[0].type !== 'line') return;
        o.series.forEach(s => {
          if (!Array.isArray(s.data)) return;
          const last = s.data[s.data.length - 1];
          if (typeof last !== 'number') return;
          // 实时推流：这里的随机是"时间在走"本身，不是派生展示值 —— 每一 tick 本就该不同
          s.data = s.data.slice(1).concat(+(last + (Math.random() - .5) * Math.abs(last || 1) * .08).toFixed(1));
        });
        c.setOption({ series: o.series });
      });
    }, 2000);

    document.getElementById('mnPause').onclick = e => {
      chartPaused = !chartPaused; e.currentTarget.innerHTML = chartPaused ? `${U.icon('play')} 已暂停` : `${U.icon('pause')} 实时`;
      U.toast(chartPaused ? '已暂停图表实时刷新，数据冻结在当前时刻' : '已恢复图表实时刷新（2 秒/次）', chartPaused ? '' : 'ok');
    };
    document.getElementById('mnHold').onclick = e => {
      logPaused = !logPaused; e.currentTarget.innerHTML = logPaused ? `${U.icon('play')} 继续滚动` : `${U.icon('pause')} 暂停滚动`;
      U.toast(logPaused ? '日志流已暂停滚动（图表刷新不受影响）' : '日志流已继续滚动', logPaused ? '' : 'ok');
    };
    document.getElementById('mnClear').onclick = () => {
      const n = document.getElementById('mnLog').children.length;
      document.getElementById('mnLog').innerHTML = '';
      U.toast('已清空监测日志流（' + n + ' 条，仅清屏，不影响已归档日志）');
    };
    U.on(view, '[data-row]', 'click', (e, el) => {
      const d = M.devices.find(x => x.id === el.dataset.row);
      if (d) devModal(d);
    });

    /* ---- 设备树交互(点击过滤 / 再点取消 / 搜索平铺) ---- */
    const refilter = () => {
      const tr = document.getElementById('mnTree');
      const keep = tr ? tr.scrollTop : 0;
      document.getElementById('mnTree').innerHTML = tree();
      document.getElementById('mnTree').scrollTop = keep;
      document.getElementById('mnAlarms').innerHTML = alarmRows();
      const lg = document.getElementById('mnLog');
      lg.innerHTML = Array.from({ length: 8 }, (_, i) => logLine(i)).join('') || '<div class="empty">该过滤条件下暂无日志</div>';
    };
    U.on(view, '[data-fc]', 'click', (e, el) => {
      const c = el.dataset.fc;
      flt = (flt.channel === c && !flt.type && !flt.status) ? { channel: null, type: null, status: null, kw: '' } : { channel: c, type: null, status: null, kw: '' };
      refilter();
    });
    U.on(view, '[data-ft]', 'click', (e, el) => {
      const [t, c] = el.dataset.ft.split('|');
      const collapse = flt.type === t;
      flt = collapse ? { channel: null, type: null, status: null, kw: '' } : { channel: c, type: t, status: null, kw: '' };
      /* 展开类型时默认选中该类第一台 —— 右侧立刻是一台具体设备的协议字段，
         不用再点一次才有内容（用户指令 2026-08-27）；收起时回到聚合。
         safe-default: 默认选中在树里高亮可见、可随时改选或「返回全部」，不进任何判定 */
      selDev = collapse ? null : (M.devices.find(d => d.type === t && d.channel === c) || null);
      refilter();
      body();
    });
    U.on(view, '[data-fs]', 'click', (e, el) => {
      const [st2, c] = el.dataset.fs.split('|');
      flt = (flt.status === st2 && flt.channel === c) ? { channel: null, type: null, status: null, kw: '' } : { channel: c, type: null, status: st2, kw: '' };
      refilter();
    });
    U.on(view, '[data-fclear]', 'click', () => { flt = { channel: null, type: null, status: null, kw: '' }; document.getElementById('mnKw').value = ''; refilter(); });
    U.on(view, '[data-dev]', 'click', (e, el) => {
      const d = M.devices.find(x => x.id === el.dataset.dev);
      if (d) devModal(d);
    });
    /* 点设备 → 右侧监控切到这一台；再点一次取消，回到范围聚合 */
    U.on(view, '[data-mon]', 'click', (e, el) => {
      const d = M.devices.find(x => x.id === el.dataset.mon);
      if (!d) return;
      selDev = (selDev && selDev.id === d.id) ? null : d;
      document.getElementById('mnTree').innerHTML = tree();
      body();
    });
    /* 告警行 → 单设备监控。告警表的 rowId 就是设备 id（U.table rowId: a => a.dev.id）。
       只设 selDev、不动 flt：动 flt 会把告警列表也过滤掉。 */
    U.on(view, '#mnAlarms [data-row]', 'click', (e, el) => {
      const d = M.devices.find(x => x.id === el.dataset.row);
      if (!d) return;
      selDev = d;
      U.selectRow(view.querySelector('#mnAlarms'), d.id);
      document.getElementById('mnTree').innerHTML = tree();
      const node = document.querySelector('[data-mon="' + d.id + '"]');
      if (node) node.scrollIntoView({ block: 'nearest' });
      body();
    });
    U.on(view, '[data-mt]', 'click', (e, el) => {
      tab = el.dataset.mt;
      view.querySelectorAll('[data-mt]').forEach(x => x.classList.toggle('on', x === el));
      charts = {}; body();
    });
    U.on(view, '[data-mnclear]', 'click', () => {
      selDev = null; document.getElementById('mnTree').innerHTML = tree(); body();
    });
    const chSel = view.querySelector('[data-f="mnCh"]');   // U.select 生成的是 data-f
    if (chSel) chSel.onchange = e => {
      scopeCh = e.target.value === '全部通道' ? null : e.target.value;
      selDev = null;                                  // 换通道时清掉单设备选中，否则范围与显示对不上
      document.getElementById('mnTree').innerHTML = tree();
      body();
    };
    document.getElementById('mnKw').oninput = e => { flt.kw = e.target.value.trim(); refilter(); };
    const tsel = document.getElementById('mnType');
    if (tsel) {
      tsel.value = flt.type || '';
      tsel.onchange = e => { flt.type = e.target.value || null; refilter(); };
    }
  }

  function devModal(d) {
    U.modal({
      title: '设备详情 · ' + d.name, width: '620px',
      body: U.kv([['设备编号', `<span class="mono">${d.id}</span>`], ['类型/通道', d.type + ' / ' + d.channel],
      ['状态', U.tag(d.status) + (d.alarm ? ' ' + U.tag('告警中', 't-amber') : '')],
      ['最后心跳', d.hb], ['IP / 端口', d.ip + ' : ' + d.port],
      ['温度', d.temp + ' ℃'], ['时延 / 丢包', (d.latency || '—') + ' ms / ' + (d.loss == null ? '—' : d.loss + ' %')],
      ['信号强度', d.rssi + ' dBm'], ['固件版本', d.fw]]),
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn" onclick="location.hash='#/commission';UI.closeModal()">进入调测</button>
        <button class="btn warn" data-act="restart">远程重启</button>`,
      on: { restart: () => rebootModal(d) }
    });
  }

  /* ---- M2:远程重启 ----
     原实现单击即「已下发…等待设备回执」，不写审计、不改任何状态、回执永远不来。
     而本页自己所在的平台把「控制无回执」列为 C09 阻断性问题（apis.js），
     对在网感知设备下发重启却连二次确认都没有 —— 平台没遵守自己定的规矩。
     这里补齐：二次确认 + 原因必填 + 写操作审计 + 真实回执（回执到达后再写一条审计）。
     注意不改 d.status —— deviceStats 是加载时算好的常量，改了 status 会让
     台账与 KPI 当场对不上，那是我们一路在治的另一种病。重启事实记在 d.lastReboot 上。 */
  function rebootModal(d) {
    const u = (M.users && M.users[0]) || { name: '值班员', roleName: '值班员' };
    U.modal({
      title: '远程重启设备 · ' + d.name, width: '600px',
      body: `<div class="warnbox" style="border-color:rgba(255,77,94,.45)">
          注意：远程重启是<b>控制类指令</b>，作用于在网感知设备。重启期间该设备停止上报，
          融合结果在此期间可能降级。依纪要 §8.1，控制类指令须具备<b>幂等、回执与急停</b>，
          本次下发与回执全程记入操作审计。</div>
        ${U.kv([
        ['设备', `${d.name}　<span class="mono">${d.id}</span>`],
        ['类型 / 通道', d.type + ' / ' + d.channel],
        ['当前状态', U.tag(d.status) + (d.alarm ? ' ' + U.tag('告警中', 't-amber') : '')],
        ['最后心跳', d.hb],
        ['上次重启', d.lastReboot ? `${d.lastReboot.at} · ${d.lastReboot.by} · ${d.lastReboot.ack}` : '无记录'],
        ['下发接口', '<span class="mono">POST /api/v1/device/control</span>　【指令码待设备方确认】']
      ])}
        ${U.sect('操作信息', `${U.field('重启原因', `<input class="ip" data-rbwhy style="flex:1" placeholder="必填，例如：心跳异常、指标持续超阈值">`)}
          <label class="chk"><input type="checkbox" data-rbc>我已确认该设备可以重启，知悉重启期间数据中断且本次操作全程记入审计</label>`)}`,
      footer: `<button class="btn" data-close>取消</button>
        <button class="btn danger" data-act="go" disabled id="rbGo">确认下发</button>`,
      mounted: el => {
        const c = el.querySelector('[data-rbc]');
        c.onchange = () => { el.querySelector('#rbGo').disabled = !c.checked; };
      },
      on: {
        go: el => {
          const why = (el.querySelector('[data-rbwhy]').value || '').trim();
          if (!why) { U.toast('重启原因为必填 —— 设备控制操作必须能回答"为什么重启"', 'err'); return; }
          const rs = CH.seeded('rb' + d.id + M.util.ymd(M.CONF.demoTime));
          const taskId = 'RB' + M.util.ymd(M.CONF.demoTime) + M.util.p3(rs(1, 999));
          const at = M.util.fmtDT(M.CONF.demoTime);
          d.lastReboot = { at, by: u.name, why, taskId, ack: '待回执' };
          audit(`远程重启下发（${taskId}）：${why}`, d.id, u.name);
          U.closeModal();
          U.toast(`重启指令已下发：${taskId}，等待设备回执`, 'ok');
          pushLog(`[CTRL] POST /api/v1/device/control  {"deviceId":"${d.id}","cmd":"reboot","taskId":"${taskId}"}`);
          /* 回执真的会到 —— 到达后回写状态并再记一条审计。
             页面可能已经切走，所以只动数据 + 尽力刷新 UI，不假设 DOM 还在。 */
          setTimeout(() => {
            const cost = rs(8, 26);
            d.lastReboot.ack = `已回执（重启完成，耗时 ${cost}s）`;
            d.hb = M.util.fmtDT(M.CONF.demoTime);
            audit(`远程重启回执（${taskId}）：重启完成，耗时 ${cost}s`, d.id, u.name);
            pushLog(`[CTRL] ← 200 {"taskId":"${taskId}","status":"rebooted","costS":${cost}}  设备已恢复上报`);
            if (document.getElementById('mnBody')) U.toast(`${d.name} 重启回执已接收（耗时 ${cost}s）`, 'ok');
          }, 2600);
        }
      }
    });
  }

  function audit(action, target, by) {
    M.auditLogs.unshift({
      id: 'AUMN' + M.util.p3(M.auditLogs.length + 1), time: M.util.fmtDT(M.CONF.demoTime),
      user: by, role: '设备运维', module: '设备实时监测', action, target,
      result: '成功', ip: '10.20.8.22', term: '终端-03'
    });
  }
  function pushLog(line) {
    const box = document.getElementById('mnLog');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'l';
    div.innerHTML = `<span class="tm">${M.util.fmtT(M.CONF.demoTime)}</span><span>${line}</span>`;
    box.insertBefore(div, box.firstChild);
  }

  function destroy() { clearInterval(timer); clearInterval(logTimer); charts = {}; chartPaused = logPaused = false; }
  g.PAGES = g.PAGES || {};
  g.PAGES.monitor = { render, mount, destroy };
})(window);
