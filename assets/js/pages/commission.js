/* ===== 7. 设备接入与调测 ===== */
(function (g) {
  const M = MOCK, U = UI;
  const STEPS = [
    ['设备接入', '选择设备并建立连接'], ['参数配置', '配置设备通信与参数'], ['通信测试', '链路连通性与稳定性'],
    ['接口测试', '接口协议与数据校验'], ['校准联调', '坐标校准与时间同步'], ['结果确认', '调测完成并生成报告']
  ];
  let step = 0, dev = M.devices[0], running = false, timer = null, sec = 0, page = 1, size = 10, tab = 'lian';
  let lastRun = null;              // 本次实际跑完的调测结果（报告取它，不取写死的字符串）
  /* 原 500ms × 每 2 tick 一行 ≈ 每步 20s、跑完 2 分钟；260ms 仍需约 62s，演示时依然没人等得完。
     降到 80ms ≈ 每步 3s、全程约 19s。另给「跳过动画」直接出结果。
     （节流环境下测不准，这个数是按常量算的：SCRIPT 11 行 × 2 tick × 80ms ≈ 1.8s + 面板刷新开销） */
  const TICK_MS = 80;
  const elapsed = () => Math.floor(sec * TICK_MS / 1000);
  /* 调测通过阈值：Demo 缺省值，待设备方确认。
     取常见感知设备链路口径（延迟 ≤50ms / 丢包 ≤1% / 抖动 ≤20ms）。
     之前这里是"以记录自身的 result 反推单项结论"—— 那是结论先有、指标后配：
     报告看起来是由指标推出结论，实际是由结论去挑指标，比掷骰子更难发现，
     因为中间那些数字是真的，只有"由它们得出结论"这一步是假的。 */
  const COMM_TH = (g.MOCK && g.MOCK.COMM_TH) || { latencyMs: 50, lossPct: 1, jitterMs: 20 };
  const TH_TBC = '判据阈值待设备方确认';

  /* 链路指标：面板与报告读同一处，否则会出现「面板 34ms / 报告 23ms」这种两处各算各的。
     按「设备 + 调测步骤」确定性派生，同一步内稳定。 */
  function linkMetrics(atStep) {
    const r = CH.seeded('link:' + dev.id + '@' + atStep);
    return { loss: +(r(0, 30) / 100).toFixed(2), latency: r(15, 42), jitter: r(2, 9), bw: +(r(1000, 1600) / 10).toFixed(1) };
  }

  function render() {
    /* 调测默认对象：优先在线雷达，其次任意雷达（状态如实显示），都没有才为空。
       原来是 `|| M.devices[0]` —— 没有在线雷达时会**拿别的类型的设备冒充雷达**，
       而整页的链路指标、调测报告、配置项都会挂在它身上，界面上看不出换了对象。
       降级顺序里"离线雷达"是可以的：它仍然是雷达，状态栏会如实写离线；
       "另一种设备"不可以 —— 那是换了实体。 */
    dev = M.devices.find(d => d.type === '雷达' && d.status === '在线')
      || M.devices.find(d => d.type === '雷达')
      || null;
    /* dev 为空只可能发生在"设备清单里一台雷达都没有"时。此时整页无调测对象可言，
       在入口一次性拦住，而不是在下游二十来处 dev.xxx 各加一次保护 ——
       那样每处都得想一遍"没有设备时这里该显示什么"，漏一处就是一次崩溃。 */
    if (!dev) return `${U.panel({
      title: '设备接入调测', style: 'flex:none',
      body: `<div class="warnbox" style="line-height:1.9">
        <b>注意：设备清单中没有雷达设备，本页无调测对象。</b><br>
        此处<b>不会退而选用其他类型的设备顶替</b> —— 那会让链路指标、调测报告、配置项
        全部挂在一台并非被调测对象的设备上，而界面上看不出换了对象。<br>
        <span style="color:var(--txt-3)">请先在「设备管理」中登记雷达设备。</span></div>`
    })}`;
    return `
    ${U.panel({
      title: false, style: 'flex:none;margin-bottom:12px',
      body: `<div class="steps" id="cmSteps">${STEPS.map(([n, d], i) =>
        `<div class="st ${i < step ? 'done' : ''} ${i === step ? 'act' : ''}" data-step="${i}">
          <div class="c">${i < step ? U.icon('check') : i + 1}</div><div class="n">${n}</div><div class="t">${d}</div></div>`).join('')}</div>`
    })}

    <div class="row mb12" style="height:560px;flex:none">
      <div class="col" style="width:268px">
        ${U.panel({
      title: '设备选择', style: 'flex:none;height:260px', nopad: true,
      body: `<div style="padding:8px;display:flex;flex-direction:column;gap:6px">
            ${U.field('区域', U.select('r', ['全部区域', ...M.DISTRICTS.map(d => d.name)]))}
            ${U.field('类型', U.select('t', ['全部类型', ...new Set(M.devices.map(d => d.type))]))}
            <input class="ip" placeholder="请输入设备名称/ID/IP" id="cmKw">
          </div>
          <div class="tree" id="cmTree" style="padding:0 8px 8px;overflow:auto;flex:1;min-height:0"></div>`
    })}
        ${U.panel({ title: '设备信息', style: 'flex:1;min-height:0', body: `<div id="cmInfo"></div>` })}
      </div>

      ${U.panel({
      title: '参数配置', style: 'flex:1.5', nopad: true,
      body: `<div id="cmCfg" style="padding:12px;overflow:auto;flex:1"></div>
          <!-- 5 个按钮在 517px 的面板里放不下（我加「跳过动画」后 545px），
               .panel>.pb 本身是 overflow:auto，于是这一行把整个面板体撑出 28px。
               允许换行即可 —— 按钮换行比横滚可用。 -->
          <div class="detail-actions" style="margin:0;border-width:1px 0 0;border-radius:0;flex-wrap:wrap;justify-content:flex-start">
            <button class="btn pri" id="cmStart">${U.icon('play')} 开始测试</button>
            <button class="btn" id="cmSkip" title="跳过逐步动画，直接跑完全部 6 步并出结果">${U.icon('skip')} 跳过动画</button>
            <button class="btn" id="cmSave">${U.icon('save')} 保存参数</button>
            <button class="btn" id="cmReconn">${U.icon('refresh')} 重新连接</button>
            <button class="btn" id="cmReport" disabled title="需先完成 6 步调测流程（当前未开始）">${U.icon('file')} 生成调测报告</button>
          </div>`
    })}

      <div class="col" style="width:420px">
        ${U.panel({
      title: '实时调测结果', style: 'flex:1;min-height:0', nopad: true,
      extra: `<span id="cmState" class="tag t-gray">未开始</span>
          <button class="btn danger" id="cmStop" disabled>停止测试</button>`,
      body: `<div id="cmLive" style="padding:10px;overflow:auto;flex:1"></div>`
    })}
      </div>
    </div>

    ${U.panel({
      title: false, style: 'height:300px;flex:none;margin-bottom:12px', nopad: true,
      body: `<div class="tabs" style="padding:8px 12px 0">
          <span class="tab ${tab === 'lian' ? 'on' : ''}" data-ct="lian">联调记录</span>
          <span class="tab ${tab === 'fault' ? 'on' : ''}" data-ct="fault">故障记录</span></div>
        <div id="cmList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}`;
  }

  function tree() {
    const byRegion = {};
    M.devices.forEach(d => { (byRegion[d.region] = byRegion[d.region] || []).push(d); });
    return Object.keys(byRegion).map(r => `
      <div class="tn"><span>▾</span>${r}<span class="cnt">${byRegion[r].length}</span></div>
      <div class="ch">${byRegion[r].slice(0, 6).map(d =>
      `<div class="tn ${dev && d.id === dev.id ? 'on' : ''}" data-dev="${d.id}">
          <span class="dot-s" style="background:${d.status === '在线' ? '#2fd06e' : d.status === '离线' ? '#8ca0be' : '#ff4d5e'}"></span>${d.name}</div>`).join('')}
        ${byRegion[r].length > 6 ? `<div class="tn" style="color:var(--txt-3)">… 其余 ${byRegion[r].length - 6} 台</div>` : ''}</div>`).join('');
  }

  function info() {
    if (!dev) return `<div style="color:#ffd07a;font-size:12.5px;line-height:1.8">
      注意：设备清单中没有雷达设备，无法确定调测对象。<br>
      <span style="color:var(--txt-3)">此处不会退而选用其他类型的设备顶替 —— 那会让本页的链路指标与调测报告
      挂在一台并非被调测对象的设备上，而界面看不出换了对象。请在左侧设备树中手动选择。</span></div>`;
    return U.detailHero({
      icon: 'tool', variant: 'micro', subtitle: '接入调测设备', title: dev.name, id: dev.id,
      tags: [U.tag(dev.status), U.tag(dev.type, 't-cyan')], meta: [['区域', dev.region]]
    }) + U.metricStrip([
      { label: '连接状态', value: running ? '测试中' : dev.status, tone: dev.status === '在线' ? 'good' : 'warn', icon: 'link' },
      { label: '设备类型', value: dev.type, icon: 'device' },
      { label: '固件版本', value: dev.fw, icon: 'file' }
    ], { compact: true }) + U.kv([['设备名称', dev.name], ['设备类型', dev.type], ['设备型号', dev.model],
    ['IP 地址', `<span class="mono">${dev.ip}</span>`], ['所属区域', dev.region],
    ['供应商', dev.vendor], ['设备编号', `<span class="mono">${dev.id}</span>`],
    ['固件版本', dev.fw], ['接入时间', dev.installed + ' 14:32:18'],
    ['设备状态', U.dotState(dev.status)]], { surface: true, density: 'compact' });
  }

  function cfg() {
    const isTcp = dev.proto === 'TCP';
    return `
    ${/* .field 是 flex：label 为 nowrap、input 的浏览器默认 min-width 约 170px，
          两者相加超过 auto-fit 分出的列宽时，input 无法收缩，整个网格就把面板体撑出去。
          1600 宽下 auto-fit 排成 3 列（每列 207px）反而比 1440 的 2 列更窄 ——
          所以这处只在宽视口下溢出，窄视口测不出来。解法是让 input 可收缩（min-width:0）。 */''}
    ${U.sect('网络参数', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:10px">
      ${U.field('IP地址', `<input class="ip" style="flex:1;min-width:0" value="${dev.ip}">`)}
      ${U.field('子网掩码', `<input class="ip" style="flex:1;min-width:0" value="255.255.255.0">`)}
      ${U.field('网关', `<input class="ip" style="flex:1;min-width:0" value="${dev.ip.split('.').slice(0, 3).join('.')}.1">`)}
      ${U.field('DNS', `<input class="ip" style="flex:1;min-width:0" value="10.10.0.53">`)}
      ${U.field('端口', `<input class="ip" style="flex:1;min-width:0" value="${dev.port}" id="cmPort">`)}
      ${U.field('心跳间隔(s)', `<input class="ip" style="flex:1;min-width:0" value="30">`)}
    </div>`)}
    ${U.sect('接口与协议 <span style="font-weight:400;color:var(--txt-3);font-size:11px">（协议类型与接入地址联动，避免 TCP 端口配 HTTP 路径）</span>',
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:10px">
      ${U.field('协议类型', U.select('proto', ['TCP', 'HTTP', 'WS'], dev.proto))}
      ${U.field('接入地址', `<input class="ip" style="flex:1;min-width:0" id="cmAddr" value="${isTcp ? 'tcp://' + dev.ip + ':' + dev.port
        : (dev.port === 8443 ? 'https://' : 'http://') + dev.ip + ':' + dev.port + '/api/v1/data'}">`)}
      ${U.field('数据格式', U.select('fmt', isTcp ? ['二进制(厂家私有)', 'JSON'] : ['JSON', 'XML']))}
      ${U.field('字符编码', U.select('enc', ['UTF-8', 'GBK']))}
      ${U.field('鉴权方式', U.select('auth', ['Token', 'AK/SK', '无']))}
      ${U.field('接口版本', U.select('ver', ['v1.0', 'v1.1', 'v2.0']))}
    </div>`)}
    ${U.sect('采样与传输', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:10px">
      ${U.field('采样频率(Hz)', `<input class="ip" style="flex:1;min-width:0" value="10">`)}
      ${U.field('上报周期(ms)', `<input class="ip" style="flex:1;min-width:0" value="1000">`)}
      ${U.field('数据压缩', U.select('zip', ['启用', '停用']))}
      ${U.field('重传机制', U.select('retry', ['启用', '停用']))}
      ${U.field('超时(ms)', `<input class="ip" style="flex:1;min-width:0" value="3000">`)}
      ${U.field('重试次数', `<input class="ip" style="flex:1;min-width:0" value="3">`)}
    </div>`)}
    ${U.sect('坐标校准', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;align-items:end">
      ${U.field('坐标系', U.select('cs', ['WGS-84', 'CGCS2000', 'GCJ-02']))}
      ${U.field('经度偏移(°)', `<input class="ip" style="flex:1;min-width:0" value="0.000000">`)}
      ${U.field('纬度偏移(°)', `<input class="ip" style="flex:1;min-width:0" value="0.000000">`)}
      ${U.field('高度偏移(m)', `<input class="ip" style="flex:1;min-width:0" value="0.00">`)}
    </div><button class="btn" style="margin-top:8px" id="cmCal">打开校准工具</button>`)}
    ${U.sect('时钟同步', `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
      ${U.field('同步方式', U.select('sync', ['NTP', 'PTP', 'GPS 授时']))}
      ${U.field('NTP服务器', `<input class="ip" style="flex:1;min-width:0" value="ntp.dongying.gov.cn">`)}
      ${U.field('时区', U.select('tz', ['(UTC+08:00) 北京']))}
      ${U.field('同步间隔(s)', `<input class="ip" style="flex:1;min-width:0" value="60">`)}
    </div>`)}`;
  }

  function live() {
    const st = running ? '测试中' : (step >= 5 ? '已完成' : '未开始');
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        ${U.kv([['连接状态', running ? '<span style="color:#79e5a5">● 已连接</span>' : '<span style="color:var(--txt-3)">○ 未连接</span>'],
      ['连接时长', running ? '00:' + M.util.p2(Math.floor(elapsed() / 60)) + ':' + M.util.p2(elapsed() % 60) : '—'],
      ['最后心跳', running ? M.util.fmtDT(new Date(M.CONF.demoTime.getTime() + elapsed() * 1000)) : '—']])}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
        ${(function () {
      /* 链路指标按「设备 + 当前调测步骤」确定性派生：同一步内稳定，推进到下一步才变。
         原来四项都是每次 render 现抽（两项 Math.random、两项 M.util.ri），
         无关交互触发 paint() 时数值照样跳 —— 看的人会以为链路在波动，其实只是重绘了。
         注意 M.util.ri 虽不触发扫描规则，但同样是渲染期随机，且会扰动全局 RNG 序列，一并改掉。 */
      const m = linkMetrics(step);
      return [['丢包率', running ? m.loss.toFixed(2) + '%' : '—', '#2fd06e'],
      ['延迟(ms)', running ? m.latency : '—', '#3d8bff'],
      ['抖动(ms)', running ? m.jitter : '—', '#a97bff'],
      ['带宽(KB/s)', running ? m.bw : '—', '#22d3ee']];
    })()
        .map(([n, v, c]) => `<div style="border:1px solid var(--line);border-radius:6px;padding:7px;text-align:center">
          <div style="font-size:11px;color:var(--txt-3)">${n}</div>
          <div style="font-size:16px;color:${c};font-family:Menlo" >${v}</div></div>`).join('')}
      </div>
      <div style="font-size:12px;color:#9ec6ff;margin-bottom:5px;display:flex;justify-content:space-between">
        <span>测试日志</span><span class="lnk" id="cmClr">清空日志</span></div>
      <div id="cmLog" class="logflow" style="height:132px;overflow:auto;background:rgba(3,9,26,.6);
        border:1px solid var(--line-2);border-radius:6px;padding:8px"></div>
      <div style="font-size:12px;color:#9ec6ff;margin:9px 0 5px;display:flex;justify-content:space-between">
        <span>接口响应结果</span><span class="lnk" id="cmRaw">查看原始数据</span></div>
      ${U.kv([['最近接口', `<span class="mono" style="font-size:11.5px">${dev.proto === 'TCP' ? 'tcp://' + dev.ip + ':' + dev.port : '/api/v1/data'}</span>`],
      ['响应状态', running ? '<span style="color:#79e5a5">200 OK</span>' : '—'],
      ['响应时间', running ? M.util.ri(18, 40) + ' ms' : '—'],
      ['数据条数', running ? 20 : '—'], ['响应大小', running ? '3.45 KB' : '—']])}
      <pre class="code" style="height:104px;margin-top:8px">${running ? JSON.stringify({
        code: 0, message: 'success', timestamp: '2026-08-26T10:24:36+08:00',
        data: [{ id: dev.id, lat: dev.lat, lon: dev.lon, alt: dev.alt, target: 'TRK201', conf: 0.94 }]
      }, null, 2) : '// 等待测试开始…'}</pre>`;
  }

  function listBody() {
    if (tab === 'lian') {
      const rows = M.commTasks.slice((page - 1) * size, page * size);
      return U.table([
        { t: '序号', k: 'no', w: '56px', align: 'center' },
        { t: '设备名称', k: 'name', w: '150px' },
        { t: '设备类型', k: 'type', w: '90px' },
        { t: '调测内容', k: 'content', w: '230px' },
        { t: '开始时间', k: 'start', w: '150px', cls: 'num' },
        { t: '结束时间', k: 'end', w: '150px', cls: 'num' },
        { t: '耗时', k: 'cost', w: '80px', cls: 'num' },
        { t: '调测结果', w: '90px', render: r => U.tag(r.result) },
        { t: '操作人', k: 'operator', w: '80px' },
        { t: '操作', w: '110px', render: r => `<span class="lnk" data-rep="${r.no}">查看报告</span><span class="lnk" data-rdl="${r.no}">下载</span>` }
      ], rows) + U.pager({ total: M.commTasks.length, page, size });
    }
    const faults = M.commTasks.filter(t => t.result === '失败');
    return U.table([
      { t: '序号', k: 'no', w: '56px', align: 'center' },
      { t: '设备名称', k: 'name', w: '150px' },
      { t: '故障时间', k: 'start', w: '150px', cls: 'num' },
      { t: '故障类型', w: '110px', render: r => ['接口超时', '协议不匹配', '鉴权失败', '时钟偏差超限', '坐标校准失败'][CH.seeded('ft' + r.no)(0, 4)] },
      { t: '故障描述', render: r => `${r.name} 在「${r.content}」阶段失败，需厂家协助定位` },
      { t: '处理状态', w: '90px', render: r => U.tag(CH.seeded('st' + r.no)(0, 9) > 2 ? '已处理' : '处理中') },
      { t: '责任方', w: '110px', render: r => ['算法/硬件团队', '平台团队', '双方'][CH.seeded('ow' + r.no)(0, 2)] }
    ], faults);
  }

  /* 报告按钮的可用性跟随调测进度：与其点了再提示"请先完成调测流程"，
     不如一开始就置灰并在 title 里说明前置条件（评审报告提的同类问题）。 */
  /* ---- COM-03 参数总览登记（模块加载时执行）---- */
  U.regParams({
    key: 'COMM_TEST', name: '设备调测判据', page: '设备接入调测', hash: '#/commission',
    ver: 'demo-v1', confirmed: false, owner: '设备方 / 平台运维',
    basis: '纪要 §8.1 要求登记协议/鉴权/上报频率/错误码，但未给定通过阈值',
    affects: ['调测结论', '调测报告', '故障类型判定'],
    items: () => [
      { n: '调测流程', v: M.commTasks ? '6 步（通信 → 接口 → 校准 → 结果确认）' : '6 步' },
      { n: '接口超时', v: '3000 ms' },
      { n: '报告生成前置', v: '须完成全部 6 步（未完成时按钮置灰）' },
      { n: '故障类型清单', v: '接口超时 / 协议不匹配 / 鉴权失败 / 时钟偏差超限 / 坐标校准失败' },
      { n: '链路通过阈值 · 延迟', v: '≤ ' + COMM_TH.latencyMs + ' ms' },
      { n: '链路通过阈值 · 丢包', v: '≤ ' + COMM_TH.lossPct + ' %' },
      { n: '链路通过阈值 · 抖动', v: '≤ ' + COMM_TH.jitterMs + ' ms' },
      { n: '阈值来源', v: (g.MOCK && g.MOCK.COMM_TH) ? '数据层 M.COMM_TH（推导与展示共用同一份）' : '页面兜底常量（数据层未导出）' },
      { n: '判定方式', v: '单项超限即该项不合格，全部合格才判「成功」' },
      {
        n: '与记录判定的一致性',
        v: (function () {
          const bad = (M.commTasks || []).filter(x => reportOf(x).mismatch).length;
          return bad ? bad + ' / ' + M.commTasks.length + ' 条记录的 result 与阈值推导不一致（数据层 result 独立生成）' : '全部一致';
        })()
      }
    ]
  });

  function syncReportBtn() {
    const b = document.getElementById('cmReport');
    if (!b) return;
    const ok = step >= 5;
    b.disabled = !ok;
    b.title = ok ? '调测流程已完成，可生成报告'
      : `需先完成 6 步调测流程（当前进度 ${step}/6${running ? ' · 测试进行中' : ''}）`;
  }

  function paint() {
    syncReportBtn();
    document.getElementById('cmTree').innerHTML = tree();
    document.getElementById('cmInfo').innerHTML = info();
    document.getElementById('cmCfg').innerHTML = cfg();
    document.getElementById('cmLive').innerHTML = live();
    document.getElementById('cmList').innerHTML = listBody();
    document.querySelectorAll('#cmSteps .st').forEach((el, i) => {
      el.classList.toggle('done', i < step); el.classList.toggle('act', i === step);
      el.querySelector('.c').innerHTML = i < step ? U.icon('check') : i + 1;
    });
    const cal = document.getElementById('cmCal');
    if (cal) cal.onclick = () => U.toast('坐标校准工具：请在地图上选取 3 个已知控制点（Demo）');
    const clr = document.getElementById('cmClr');
    if (clr) clr.onclick = () => document.getElementById('cmLog').innerHTML = '';
    const raw = document.getElementById('cmRaw');
    if (raw) raw.onclick = () => U.modal({
      title: '接口原始报文', width: '680px',
      body: `<pre class="code" style="max-height:420px">${JSON.stringify({
        header: { device: dev.id, proto: dev.proto, ts: '2026-08-26T10:24:36.128+08:00', seq: 10245 },
        body: { targets: [{ trackId: 'TRK201', plots: 26, lat: dev.lat, lon: dev.lon, alt: 98.3, speed: 32.6, heading: 270, quality: 0.94 }] },
        checksum: 'CRC16-0x8F2A'
      }, null, 2)}</pre>`
    });
  }

  const SCRIPT = [
    ['开始连接设备 {ip}:{port} …', 0],
    ['连接成功，TCP 三次握手完成', 1],
    ['开始通信测试…', 1],
    ['通信测试通过，延迟 {lat}ms，丢包率 {loss}%', 2],
    ['开始接口测试 {addr} …', 2],
    ['接口测试通过，状态码 200，字段校验 32/32 通过', 3],
    ['开始坐标校准（WGS-84）…', 4],
    ['坐标校准完成，经纬度偏移已更新（Δlon 0.000012°, Δlat 0.000008°）', 4],
    ['开始时钟同步（NTP ntp.dongying.gov.cn）…', 4],
    ['时钟同步成功，偏差 {ntp}ms', 5],
    ['调测完成，已生成报告 RPT-{id}', 5]
  ];

  function start() {
    if (running) return;
    running = true; sec = 0; step = 0;
    document.getElementById('cmStop').disabled = false;
    document.getElementById('cmState').className = 'tag t-cyan';
    document.getElementById('cmState').textContent = '测试中';
    paint();
    let i = 0;
    timer = setInterval(() => {
      const log = document.getElementById('cmLog');
      if (!log) { stop(); return; }
      sec += 1;
      if (i < SCRIPT.length && sec % 2 === 0) {
        const [txt, s] = SCRIPT[i++];
        const lm = linkMetrics(s);
        const line = txt.replace('{ip}', dev.ip).replace('{port}', dev.port)
          .replace('{addr}', dev.proto === 'TCP' ? 'tcp://' + dev.ip + ':' + dev.port : '/api/v1/data')
          .replace('{id}', dev.id)
          .replace('{lat}', lm.latency).replace('{loss}', lm.loss.toFixed(2))
          .replace('{ntp}', CH.seeded('ntp:' + dev.id)(1, 9));
        log.insertAdjacentHTML('beforeend',
          `<div class="l"><span class="tm">${M.util.fmtDT(new Date(M.CONF.demoTime.getTime() + elapsed() * 1000))}</span><span>${line}</span></div>`);
        log.scrollTop = log.scrollHeight;
        if (s !== step) { step = s; paint(); document.getElementById('cmLog').innerHTML = log.innerHTML; }
        if (i === SCRIPT.length) {
          /* 把本次实跑结果固化下来，报告读它 —— 不再是一份与本次测试无关的固定文案 */
          const m5 = linkMetrics(5);
          const t0 = M.CONF.demoTime;
          const items5 = [
            { k: '时延', v: m5.latency, unit: 'ms', th: COMM_TH.latencyMs, ok: m5.latency <= COMM_TH.latencyMs },
            { k: '丢包率', v: m5.loss, unit: '%', th: COMM_TH.lossPct, ok: m5.loss <= COMM_TH.lossPct },
            { k: '抖动', v: m5.jitter, unit: 'ms', th: COMM_TH.jitterMs, ok: m5.jitter <= COMM_TH.jitterMs }
          ];
          lastRun = {
            live: true, no: 'LIVE', dev,
            content: '通信测试 + 接口测试 + 校准联调 + 时钟同步',
            items: items5, result: items5.every(x => x.ok) ? '成功' : '失败',
            start: M.util.fmtDT(t0), end: M.util.fmtDT(new Date(t0.getTime() + elapsed() * 1000)),
            cost: '00:' + M.util.p2(Math.floor(elapsed() / 60)) + ':' + M.util.p2(elapsed() % 60),
            operator: ((M.users && M.users[0]) || { name: '管理员' }).name
          };
          U.toast(`${U.icon('check')} 设备调测完成，可生成调测报告`, 'ok');
          running = false;
          document.getElementById('cmState').className = 'tag t-green';
          document.getElementById('cmState').textContent = '已完成';
          clearInterval(timer);
        }
      }
      const l = document.getElementById('cmLive');
      if (l && sec % 2 === 1) {
        const html = l.innerHTML;
        const logHtml = document.getElementById('cmLog').innerHTML;
        l.innerHTML = live();
        document.getElementById('cmLog').innerHTML = logHtml;
        document.getElementById('cmLog').scrollTop = 9999;
        bindLive();
      }
    }, TICK_MS);
  }
  /* 把剩余脚本一次性打完并置为完成态 —— 不是跳过判定，只是跳过等待 */
  function fastForward() {
    clearInterval(timer);
    step = 5; running = false; sec = 26;
    paint();                       // #cmLog 在 #cmLive 里，paint 会重建它 —— 必须先 paint 再写日志
    const log = document.getElementById('cmLog');
    SCRIPT.forEach(([txt, st2], idx) => {
      if (!log) return;
      const lm = linkMetrics(st2);
      const line = txt.replace('{ip}', dev.ip).replace('{port}', dev.port)
        .replace('{addr}', dev.proto === 'TCP' ? 'tcp://' + dev.ip + ':' + dev.port : '/api/v1/data')
        .replace('{id}', dev.id)
        .replace('{lat}', lm.latency).replace('{loss}', lm.loss.toFixed(2))
        .replace('{ntp}', CH.seeded('ntp:' + dev.id)(1, 9));
      if (log.textContent.indexOf(line) < 0)
        log.insertAdjacentHTML('beforeend',
          `<div class="l"><span class="tm">${M.util.fmtDT(new Date(M.CONF.demoTime.getTime() + (idx + 1) * 2))}</span><span>${line}</span></div>`);
    });
    if (log) log.scrollTop = log.scrollHeight;
    const m5 = linkMetrics(5), t0 = M.CONF.demoTime;
    const itemsFF = [
      { k: '时延', v: m5.latency, unit: 'ms', th: COMM_TH.latencyMs, ok: m5.latency <= COMM_TH.latencyMs },
      { k: '丢包率', v: m5.loss, unit: '%', th: COMM_TH.lossPct, ok: m5.loss <= COMM_TH.lossPct },
      { k: '抖动', v: m5.jitter, unit: 'ms', th: COMM_TH.jitterMs, ok: m5.jitter <= COMM_TH.jitterMs }
    ];
    lastRun = {
      live: true, no: 'LIVE', dev,
      content: '通信测试 + 接口测试 + 校准联调 + 时钟同步',
      items: itemsFF, result: itemsFF.every(x => x.ok) ? '成功' : '失败',
      start: M.util.fmtDT(t0), end: M.util.fmtDT(new Date(t0.getTime() + 26000)),
      cost: '00:00:26', operator: ((M.users && M.users[0]) || { name: '管理员' }).name
    };
    syncReportBtn();
    const stEl = document.getElementById('cmState');
    if (stEl) { stEl.className = 'tag t-green'; stEl.textContent = '已完成'; }
    const sp = document.getElementById('cmStop'); if (sp) sp.disabled = true;
    U.toast('已跳过动画，6 步调测按同一套逻辑跑完，可生成报告', 'ok');
  }

  function bindLive() {
    const clr = document.getElementById('cmClr');
    if (clr) clr.onclick = () => document.getElementById('cmLog').innerHTML = '';
  }
  function stop() {
    const was = running;
    running = false; clearInterval(timer);
    const s = document.getElementById('cmState');
    if (s) { s.className = 'tag t-gray'; s.textContent = '已停止'; }
    const b = document.getElementById('cmStop'); if (b) b.disabled = true;
    if (was) U.toast('已停止调测，链路已断开；当前进度停留在第 ' + (step + 1) + ' 步', 'err');
  }

  function mount(view) {
    /* (3) step/running/lastRun 是模块级闭包变量，mount 不重置的话
       切走再回来上次进度还在、报告按钮仍可点 —— 但那份报告属于上一次会话。
       进入页面即重置为未开始。 */
    clearInterval(timer);
    step = 0; running = false; sec = 0; lastRun = null;
    paint();
    U.on(view, '[data-dev]', 'click', (e, el) => {
      dev = M.devices.find(d => d.id === el.dataset.dev);
      step = 0; running = false; clearInterval(timer);
      const tr = document.getElementById('cmTree');
      const keep = tr ? tr.scrollTop : 0;      // 保持树滚动位置
      paint();
      const tr2 = document.getElementById('cmTree');
      if (tr2) tr2.scrollTop = keep;
    });
    /* (2) 原来这里允许直接点步骤条改 step —— 不做任何测试点第 6 步，
       「生成调测报告」立刻从置灰变可点，报告照出。闸门形同虚设。
       进度只能由实际测试推进，步骤条改为只读展示。 */
    U.on(view, '[data-step]', 'click', () => U.toast(
      running ? '调测进行中，进度由测试自动推进' : '进度由「开始测试」推进，不能手动跳步', 'err'));
    U.on(view, '[data-ct]', 'click', (e, el) => {
      tab = el.dataset.ct; page = 1;
      view.querySelectorAll('[data-ct]').forEach(x => x.classList.toggle('on', x === el));
      document.getElementById('cmList').innerHTML = listBody();
    });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { page = +el.dataset.pg; document.getElementById('cmList').innerHTML = listBody(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { size = parseInt(el.value); page = 1; document.getElementById('cmList').innerHTML = listBody(); });
    U.on(view, '[data-f="proto"]', 'change', (e, el) => {
      const a = document.getElementById('cmAddr'), p = document.getElementById('cmPort');
      if (el.value === 'TCP') { a.value = 'tcp://' + dev.ip + ':9001'; p.value = 9001; }
      else if (el.value === 'WS') { a.value = 'ws://' + dev.ip + ':8080/push'; p.value = 8080; }
      else { a.value = 'http://' + dev.ip + ':8080/api/v1/data'; p.value = 8080; }
      U.toast('协议已切换为 ' + el.value + '，接入地址与端口已联动更新');
    });
    /* 点哪条出哪条 —— 原来无论点哪行，弹的都是当前选中设备的那份固定报告 */
    U.on(view, '[data-rep]', 'click', (e, el) => {
      const t = M.commTasks.find(x => x.no === +el.dataset.rep);
      if (t) reportModal(t);
    });
    U.on(view, '[data-rdl]', 'click', (e, el) => {
      const t = M.commTasks.find(x => x.no === +el.dataset.rdl);
      U.toast(`正式环境将导出第 ${el.dataset.rdl} 条《设备调测报告》PDF${t ? `（${t.dev.name} · ${t.result}）` : ''}；Demo 不生成文件`, 'err');
    });
    document.getElementById('cmStart').onclick = start;
    /* 演示动线不该被动画绑住：跳过动画直接推到终态，走的仍是 start 的同一套落库逻辑 */
    document.getElementById('cmSkip').onclick = () => { start(); fastForward(); };
    document.getElementById('cmStop').onclick = stop;
    document.getElementById('cmSave').onclick = () => U.toast('参数已保存至设备档案（Demo）', 'ok');
    document.getElementById('cmReconn').onclick = () => { U.toast('正在重新建立连接…'); setTimeout(start, 500); };
    syncReportBtn();
    document.getElementById('cmReport').onclick = () => {
      if (step < 5 || !lastRun) return U.toast('请先完成调测流程再生成报告', 'err');   // 兜底:置灰后正常点不到
      return reportModal(lastRun);
    };
  }

  /* ---- 调测报告：内容取自该条记录的真实结果 ----
     原实现整份报告是写死的字符串：无论点哪条记录、无论记录写着成功还是失败，
     一律「链路通过 延迟 23ms / 丢包 0.12%」「结论：设备可投入运行」。
     对一条标着"失败"的记录出具「可投入运行」，比没有报告糟得多 —— 调测报告是设备验收凭据。

     ── 注意：下面这套做法是**第二版**，第一版的原则已经作废，别照旧注释理解 ──
     第一版写的是「通过/不通过取自记录自身的 result，不自造阈值」。
     那条看似谨慎，实际是**从结论去挑指标**：报告先知道这次算成功还是失败，
     再把指标摆成配得上该结论的样子 —— 一份永远自洽、也永远证明不了任何事的报告。

     现在的三条：
       ① 结论由**阈值推导**：逐项拿该次调测自己记录的 t.items 与 COMM_TH 比，
          得到 derivedFail。阈值取数据层 M.COMM_TH（推导与参数总览共用同一份，
          数据层没导出时页面兜底常量，并在参数总览里注明来源是哪一个）。
          阈值仍属「待设备方确认」，所以页面写明它是 Demo 缺省值 —— 
          但"值待确认"和"不许有判据"是两回事，后者会让报告失去可证伪性。
       ② 记录里的 t.result 降级为**交叉探针**（recordedFail），不再充当结论：
          两者不一致时报 mismatch，把矛盾显式摆出来，而不是让某一方悄悄赢。
       ③ 只列该次实际执行的调测项（读 content），不再固定四项全列。 */
  function reportOf(t) {
    const d = t.dev;
    const names = String(t.content || '').split('+').map(x => x.trim()).filter(Boolean);
    const rs = CH.seeded('rpt|' + d.id + '|' + t.no);
    const judge = {};
    names.forEach(n => {
      if (n === '通信测试') {
        /* 读该次调测**自己记录的实测值**（t.items），不是 dev 上此刻的运行指标 ——
           dev.latency 是设备现在的负载表现，调测是几天前那一次测量，两者是不同的量。
           拿今天的运行指标去判几天前那次测试的结论，是量的混用：换任何阈值都对不上。 */
        const items = t.items || [];
        if (!items.length) { judge[n] = { ok: false, why: '该次调测未记录链路实测值' }; return; }
        const bad = items.filter(x => !x.ok);
        judge[n] = {
          ok: !bad.length,
          val: items.map(x => `${x.k} ${x.v}${x.unit}`).join(' / '),
          why: bad.map(x => `${x.k} ${x.v}${x.unit} > ${x.th}${x.unit}`).join('；')
        };
      } else if (n === '接口测试') {
        const code = rs(0, 99) < 92 ? 200 : rs(500, 504);
        judge[n] = { ok: code === 200, why: code === 200 ? '' : `HTTP ${code}`, val: `HTTP ${code}，字段校验 32/32` };
      } else if (n === '校准联调') {
        const res = +(rs(2, 9) / 10).toFixed(1);
        judge[n] = { ok: res <= 1, why: res > 1 ? `残差 ${res} m > 1 m` : '', val: `WGS-84 残差 ${res} m` };
      } else {
        const ntp = rs(1, 9);
        judge[n] = { ok: ntp <= 10, why: ntp > 10 ? `NTP 偏差 ${ntp} ms > 10 ms` : '', val: `NTP 偏差 ${ntp} ms` };
      }
    });
    const derivedFail = names.some(n => !judge[n].ok);
    const recordedFail = t.result === '失败';
    return { d, names, judge, derivedFail, recordedFail, mismatch: derivedFail !== recordedFail };
  }

  function reportModal(t) {
    const R = reportOf(t);
    const okTag = '<span style="color:#79e5a5">通过</span>';
    const noTag = '<span style="color:#ff8b95">不通过</span>';
    U.modal({
      title: '调测报告 · ' + R.d.name + '（' + (t.live ? '本次调测' : '第 ' + t.no + ' 条记录') + '）', width: '680px',
      body: `<div class="warnbox">本报告的单项结论<b>由该次调测自己记录的实测值与通过阈值推导</b>，
          不是固定文案，也不是从记录的「成功/失败」反推。
          <b>实测值取自本次调测记录，不是设备此刻的运行指标</b> —— 后者是今天的负载表现，
          与几天前那次测量不是同一个量。
          阈值 延迟 ≤${COMM_TH.latencyMs} ms／丢包 ≤${COMM_TH.lossPct}%／抖动 ≤${COMM_TH.jitterMs} ms，
          <b>待设备方确认</b>，见「参数总览 → 设备调测判据」。</div>
        ${U.kv([
        ['报告编号', `<span class="mono">RPT-${R.d.id}-${t.live ? 'LIVE' : M.util.p3(t.no)}</span>`],
        ['设备', `${R.d.name}　<span class="mono">${R.d.id}</span>`],
        ['型号 / 厂家', `${R.d.model} / ${R.d.vendor}`],
        ['设备当前状态', U.tag(R.d.status) + (R.d.alarm ? ' ' + U.tag('告警中', 't-amber') : '')],
        ['调测项', t.content],
        ['开始 / 结束', `${t.start} ~ ${t.end}`],
        ['耗时', t.cost], ['操作人', t.operator]
      ])}
        ${U.sect('分项结果（按阈值判定）', U.kv(R.names.map(n => {
          const j = R.judge[n];
          return [n, `${j.ok ? okTag : noTag}：${j.val || j.why}
            ${j.ok ? '' : `<div style="font-size:11px;color:#ff8b95;line-height:1.7">超限项：${j.why}</div>`}
            <span style="color:var(--txt-3);font-size:11px">（${TH_TBC}）</span>`];
        })))}
        ${R.derivedFail
          ? `<div class="warnbox" style="border-color:rgba(255,77,94,.45)">
              <b>结论：不通过。</b>${R.names.filter(n => !R.judge[n].ok).join('、')} 未达到当前阈值，
              <b>该设备不得投入运行</b>，须整改后复测并重新出具报告。</div>`
          : `<div style="border:1px solid rgba(47,208,110,.4);background:rgba(47,208,110,.10);border-radius:6px;padding:9px 11px;font-size:12.5px">
              <b style="color:#79e5a5">结论：通过。</b>各分项实测值均在当前阈值内，设备可投入运行。</div>`}
        ${R.mismatch && !t.live
          ? `<div class="warnbox" style="border-color:rgba(255,176,32,.55);margin-top:10px;line-height:1.85">
              <b>注意：本条记录的判定结果与按调测项推导的结论不一致。</b><br>
              记录写的是「<b>${t.result}</b>」，按本报告所列调测项推导应为「<b>${R.derivedFail ? '失败' : '成功'}</b>」。<br>
              ${!/通信测试/.test(t.content) && (t.failedItems || []).length
                ? `具体成因：本次<b>调测项为「${t.content}」，不含通信测试</b>，
                   但记录的不合格项是 <b>${(t.failedItems || []).join('、')}</b> —— 那是链路指标，
                   属于通信测试。<b>一次没做通信测试的调测，不应因链路指标不合格而判失败。</b>`
                : '两者依据的判定项不一致。'}<br>
              <b>本页不替任何一边圆场</b> —— 报告只呈现"本次调测项 + 实测值 + 由此得出的结论"，
              并把这处矛盾显式标出。已登记给数据层。</div>`
          : ''}
        ${U.kv([['签署', '平台团队：' + t.operator + ' ／ 设备方：待签署']])}`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn" data-act="dl">${U.icon('download')} 下载 PDF</button>`,
      on: { dl: () => U.toast('正式环境将导出《设备调测报告》PDF 并归档进证据台账；Demo 不生成文件', 'err') }
    });
  }

  function destroy() { clearInterval(timer); running = false; }
  g.PAGES = g.PAGES || {};
  g.PAGES.commission = { render, mount, destroy };
})(window);
