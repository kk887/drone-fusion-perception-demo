/* ===== 2. 融合感知中心（实时态势） ===== */
(function (g) {
  const M = MOCK, U = UI;
  let map = null, sel = null, timer = null;

  const FLOW = M.DISPOSAL_FLOW;   // B1:六环节唯一常量，三页共用
  /* 顶部筛选条状态。此前这四个下拉没有任何事件绑定 —— 用户以为筛过了、看到的却是全量数据，
     在核心态势页会直接导致误判，故补齐并让地图/告警/目标三处同步收敛。 */
  let flt = { region: '东营市全域', ttype: '全部', risk: '全部', src: '全部' };
  function matchFilter(t) {
    if (flt.region !== '东营市全域' && t.district !== flt.region) return false;
    if (flt.ttype !== '全部' && t.type !== flt.ttype) return false;
    if (flt.risk !== '全部' && t.risk !== flt.risk) return false;
    if (flt.src !== '全部' && t.source !== flt.src) return false;
    return true;
  }
  const shownTargets = () => M.liveTargets.filter(matchFilter);
  function shownAlarms() {
    const ids = new Set(shownTargets().map(t => t.id));
    return M.todayAlarms.filter(a => {
      if (flt.region !== '东营市全域' && a.district !== flt.region) return false;
      // 与筛选后的目标集合保持一致：告警必须能追溯到当前视图里的目标
      if (flt.ttype !== '全部' || flt.risk !== '全部' || flt.src !== '全部') return ids.has(a.targetId);
      return true;
    });
  }

  function render() {
    sel = M.liveTargets[0];
    const t = M.CONF.demoTime;
    const from = M.util.fmtDT(new Date(t.getTime() - 3600000));

    return `
    <div class="panel" style="flex:none;margin-bottom:12px">
      <div class="toolbar" style="border:0">
        ${U.field('区域', U.select('region', ['东营市全域', ...M.DISTRICTS.map(d => d.name)], flt.region))}
        ${U.field('时间范围', `<span class="mono" style="font-size:12px;color:var(--txt-2);padding:0 4px"
          title="实时态势固定展示最近 1 小时；历史时段请使用「轨迹回放」或前往日志归档">${from} ~ ${M.util.fmtDT(t)}
          <span style="color:var(--txt-3)">（近 1 小时）</span></span>`)}
        ${U.field('目标类型', U.select('ttype', ['全部', ...M.T_TYPES.map(x => x[0])], flt.ttype))}
        ${U.field('风险等级', U.select('risk', ['全部', '超高风险', '高风险', '中风险', '低风险'], flt.risk))}
        ${U.field('数据来源', U.select('src', ['全部', '融合感知箱', 'TDOA', '5G-A'], flt.src))}
        <span style="flex:1"></span>
        <span id="stFltInfo" style="font-size:11.5px"></span>
        <span style="font-size:11.5px;color:var(--txt-3);margin-left:10px">图层控制见地图右上角</span>
      </div>
    </div>

    <div class="row" style="height:calc(100vh - 184px);min-height:560px;padding-bottom:12px">
      <!-- 左栏：地图(主) + 多源融合识别结果 -->
      <div class="col" style="flex:1;min-width:0">
        ${U.panel({
      title: false, style: 'flex:1;min-height:0', nopad: true, bodyStyle: 'padding:6px',
      body: `<div id="stMap" style="width:100%;height:100%"></div>`
    })}
        ${U.panel({
      /* 原来这里是四张完整来源卡（每张 5~6 个字段）铺满 346px。
         甲方关心的是「发现了什么、可不可信、下一步怎么办」，四张卡回答的却是
         「每一路各自上报了哪些字段」—— 那是设备联调要看的东西。
         现在压成一条贡献条（谁接入了、置信度多少、权重多少），
         逐路字段、关联关系、点迹诊断、融合参数全部收进「技术详情」抽屉，一个都没删。 */
      title: '多源融合结果', sub: `融合置信度阈值 80%`, style: 'flex:none;height:228px',
      extra: `<button class="btn ghost" id="btnTech">⚙ 技术详情</button>`,
      body: `<div id="stFuse"></div>`
    })}
      </div>

      <!-- 右栏：当前目标与处置 → 处置流程 → 实时告警 -->
      <div class="col" style="width:420px;flex:none">
        ${U.panel({
      title: '当前追踪目标 · 处置', style: 'flex:none', nopad: true,
      extra: `<span id="stTag"></span>`,
      bodyStyle: 'padding:12px;overflow:auto',
      body: `<div id="stTarget"></div>`
    })}
        ${U.panel({
      title: '实时告警列表', style: 'flex:1;min-height:172px',
      extra: `<span class="lnk" onclick="location.hash='#/alarms'">查看更多 ›</span>`,
      nopad: true, bodyStyle: 'padding:8px;overflow:auto',
      body: `<div class="alarm" id="stAlarms"></div>`
    })}
      </div>
    </div>`;
  }


  /* 注册到参数总览（COM-03）—— 融合权重真值在 mock.js，这里只是把它登记进总览 */
  U.regParams({
    key: 'FUSE_W', name: '多源融合权重', page: '融合感知中心', hash: '#/situation',
    ver: 'B03-demo-v1', confirmed: false, owner: '算法方',
    basis: '设计 §6.5 加权融合（B03，A 档我方担正确性）',
    affects: ['融合置信度', '目标可信度排序', 'C03 来源可信度因子'],
    items: () => Object.keys(M.fusionWeights).map(k => ({ n: k, v: M.fusionWeights[k] + '%' }))
        .concat([{ n: '融合置信度阈值', v: '80%' }])
  });
  U.regParams({
    key: 'ALT_BANDS', name: '飞行高度分档阈值', page: '统计分析', hash: '#/stats',
    ver: 'demo-v1', confirmed: false, owner: '业务方',
    basis: '呼应《暂行条例》微轻型真高上限',
    affects: ['统计分析高度分布'],
    items: () => [
      { n: '海拔高（AMSL）分档', v: M.ALT_BANDS.edges.join(' / ') + ' m' },
      { n: '距地高（AGL）分档', v: M.AGL_BANDS.edges.join(' / ') + ' m' }
    ]
  });

  /* ---- 右上：当前追踪目标 ---- */
  function paintTarget() {
    const t = sel;
    document.getElementById('stTarget').innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:17px">🛩</span>
        <b class="mono" style="font-size:14px">${t.id}</b>${U.legal(t.legal)}${U.risk(t.risk)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:12.5px">
        ${[['类型', t.subtype], ['速度', t.speed + ' m/s'],
        ['高度', t.alt + ' m'], ['轨迹', t.trackId + ' · ' + t.track.length + '点']]
        .map(([k, v]) => `<div style="display:flex;gap:6px;min-width:0">
            <span style="color:var(--txt-3);flex:none">${k}</span><span style="color:var(--txt);overflow:hidden;text-overflow:ellipsis">${v}</span></div>`).join('')}
      </div>
      <div style="margin-top:5px;font-size:12.5px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;gap:6px"><span style="color:var(--txt-3);flex:none">经纬度</span>
          <span class="mono">${t.lon.toFixed(3)}°E, ${t.lat.toFixed(3)}°N</span></div>
        <div style="display:flex;gap:6px"><span style="color:var(--txt-3);flex:none">数据来源</span>
          <span>${t.srcCount} 路（融合置信度 <b style="color:#8fbaff">${t.fusedConf}%</b>）</span></div>
        <div style="display:flex;gap:6px"><span style="color:var(--txt-3);flex:none">所在空域</span>
          <span style="min-width:0">${t.zone ? `${t.zone.name}（${t.zone.limitTx}）` : '—'}</span></div>
        <div style="display:flex;gap:6px"><span style="color:var(--txt-3);flex:none">合法性</span>
          <span style="min-width:0">${t.type === '无人机'
        ? (t.violation ? `<span style="color:#ff8b95">${t.legal} · ${t.violation}</span>` : t.legal)
        : `<span class="tag t-gray">不适用</span> <span style="color:var(--txt-3);font-size:11px">非无人机走空间安全风险线（§4.2）</span>`}</span></div>
      </div>
      <div id="stAct" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line-2)"></div>`;
  }

  /* ---- 五路融合卡 + 雷达—光电关联(F0209 · A08) ---- */
  function ensureAssoc(t) {
    if (!t.assoc) {
      const rr = CH.seeded('assoc' + t.id);
      t.assoc = {
        vid: 'V-' + M.util.p2(rr(1, 8)), conf: rr(82, 94),
        dd: (rr(60, 220) / 10).toFixed(1), dt: (rr(2, 9) / 10).toFixed(1), da: (rr(5, 30) / 10).toFixed(1),
        status: t.fused['光电'].on ? '自动关联' : '未关联'
      };
    }
    return t.assoc;
  }
  /* 每一路的所属接入路与颜色：贡献条和技术详情共用，不各写一份 */
  const CH_OF = {
    '雷达': ['第1路 · 融合感知箱', '#3d8bff'], '光电': ['第1路 · 融合感知箱', '#ffb020'],
    'TDOA/AOA': ['第3路 · TDOA', '#a97bff'], '5G-A基站': ['第2路 · 5G-A', '#22d3ee']
  };
  const SHORT = { '雷达': '雷达', '光电': '光电', 'TDOA/AOA': 'TDOA', '5G-A基站': '5G-A' };

  function paintFuse() {
    const t = sel, f = t.fused;
    const bars = Object.keys(f).map(k => {
      const s2 = f[k], c = (CH_OF[k] || [null, '#8ca0be'])[1];
      const w = M.fusionWeights[k];
      return `<div class="s ${s2.on ? '' : 'off'}">
        <div class="sh"><span class="dot-s" style="background:${s2.on ? c : '#5a6c88'}"></span>
          <b>${SHORT[k] || k}</b><span class="st">${s2.on ? s2.识别结果 : '未接入'}</span></div>
        <div class="bar"><i style="width:${s2.on ? s2.置信度 : 0}%;background:${c}"></i></div>
        <div class="sv"><span>置信度${w != null ? ' · 权重 ' + w + '%' : ''}</span>
          <b class="mono" style="color:${s2.on ? c : 'var(--txt-3)'}">${s2.on ? s2.置信度 + '%' : '—'}</b></div>
      </div>`;
    }).join('');
    document.getElementById('stFuse').innerHTML = `
      <div style="display:flex;align-items:center;gap:22px;margin-bottom:12px;flex-wrap:wrap">
        <div><div style="font-size:12.5px;color:var(--txt-3)">融合置信度</div>
          <div style="font-size:32px;font-weight:700;line-height:1.15;font-family:'DIN Alternate',Menlo,sans-serif;
            color:${t.fusedConf >= 80 ? '#79e5a5' : '#ffd07a'}">${t.fusedConf}<span style="font-size:17px">%</span></div></div>
        <div style="font-size:13.5px;line-height:1.9;color:var(--txt-2)">
          <div>当前结论　<b style="color:var(--txt)">${t.subtype || t.type}</b>　${U.legal(t.legal)}　${U.risk(t.risk)}</div>
          <div>接入来源　<b style="color:var(--txt)">${t.srcCount}</b> 路　·　建议动作
            <b style="color:#79e6f6">${t.type === '无人机'
        ? (t.legal === '非法' ? '核实后申请反制授权' : '持续跟踪')
        : M.riskAdvice(M.riskLevelOf(t))}</b></div>
        </div>
      </div>
      <div class="srcbar">${bars}</div>`;
  }

  /* 技术详情抽屉：逐路字段 + 三个诊断入口。默认不展示，需要时再展开。 */
  let drawerEl = null;
  function closeDrawer() {
    if (drawerEl) { drawerEl.remove(); drawerEl = null; }
    document.querySelectorAll('.drawer-mask').forEach(x => x.remove());
  }
  function techDrawer() {
    closeDrawer();
    const f = sel.fused;
    const cards = Object.keys(f).map(k => {
      const s2 = f[k];
      const col = s2.on ? (s2.置信度 >= 80 ? '#2fd06e' : '#ffb020') : '#8ca0be';
      const w = M.fusionWeights[k] != null ? `<span class="tag t-blue" style="margin-left:4px">权重 ${M.fusionWeights[k]}%</span>` : '';
      const ch = CH_OF[k] || ['—', '#8ca0be'];
      return `<div class="fc" style="border:1px solid var(--line);border-radius:6px;background:var(--panel-2);
          padding:10px 12px;margin-bottom:10px;${s2.on ? '' : 'opacity:.5'}">
        <h5 style="font-size:13.5px;color:#9ec6ff;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">
          <span>${k}</span><span>${w}<span class="tag" style="background:${col}22;color:${col};border-color:${col}55">${s2.on ? '接入' : '无数据'}</span></span></h5>
        <div style="font-size:11.5px;color:${ch[1]};margin-bottom:6px">${ch[0]}</div>
        ${U.kv(Object.keys(s2).filter(x => x !== 'on').map(x => [x, x === '置信度' ? (s2[x] ? `<b style="color:${col}">${s2[x]}%</b>` : '—') : s2[x]]))}
      </div>`;
    }).join('');
    const mask = document.createElement('div'); mask.className = 'drawer-mask';
    mask.onclick = closeDrawer;
    drawerEl = document.createElement('div');
    drawerEl.className = 'drawer';
    drawerEl.innerHTML = `<div class="dh">技术详情 · <span class="mono" style="font-size:14px">${sel.id}</span>
        <span class="x" data-x>✕</span></div>
      <div class="db">
        <div style="font-size:13px;color:var(--txt-3);margin-bottom:8px">各来源上报字段</div>
        ${cards}</div>`;
    document.body.appendChild(mask); document.body.appendChild(drawerEl);
    drawerEl.querySelector('[data-x]').onclick = closeDrawer;
  }

  /* ---- 告警列表 ---- */
  function paintAlarms() {
    const list = shownAlarms();
    if (!list.length) {
      document.getElementById('stAlarms').innerHTML =
        '<div class="empty">当前筛选条件下无告警<div style="font-size:11.5px;margin-top:4px">可点击上方「清除」恢复全量</div></div>';
      return;
    }
    document.getElementById('stAlarms').innerHTML = list.slice(0, 12).map(a => `
      <div class="a lv-${a.level}" data-alm="${a.targetId}">
        <div class="r1"><span class="id">${a.targetId}</span>${U.tag(a.type)}
          ${U.tag(a.level === '高' ? '高风险' : a.level === '中' ? '中风险' : '低风险')}
          <span style="margin-left:auto" class="mono" style="color:var(--txt-3)">${a.time.slice(11)}</span></div>
        <div class="r2"><span>${a.district}</span><span>${U.tag(a.status)}</span></div>
      </div>`).join('');
  }

  /* ---- 反制授权弹窗（修正原型"一键反制"绕过授权的问题） ---- */
  function counterModal(target, onAuthorized) {
    const t = target || sel;
    if (!t) return U.toast('未找到关联目标，无法发起联动反制', 'err');
    if (t.type !== '无人机') {
      return U.toast('该目标为' + (t.subtype || t.type) + '，按 §4.2 不进入反制流程，请使用空间安全风险处置', 'err');
    }
    const dev = M.devices.filter(d => d.type === '反制' && d.status === '在线').slice(0, 4);
    const zoneOk = !!t.zone;
    const legalRisk = M.liveTargets.filter(x => x.id !== t.id && Math.abs(x.lon - t.lon) < .08 && Math.abs(x.lat - t.lat) < .08 && x.legal === '合法');
    U.modal({
      title: '反制处置授权确认',
      width: '720px',
      body: `<div class="warnbox">⚠ 反制/干扰属受控操作。依据会议纪要 §6.3 与 §11.1，必须完成
        <b>目标确认 → 空域与范围校验 → 合法目标影响评估 → 设备状态校验 → 人工双确认</b>，
        执行过程全程留痕，支持随时停止与急停。</div>
        ${U.sect('① 目标确认', U.kv([
        ['目标编号', `<b class="mono">${t.id}</b>`], ['轨迹编号', t.trackId || '归档轨迹'],
        ['融合置信度', `${t.fusedConf}%（${t.srcCount} 路来源）`],
        ['违规判定', `${t.legal} / ${t.violation || '—'}`],
        ['当前位置', `${t.lon.toFixed(4)}°E, ${t.lat.toFixed(4)}°N, 高度 ${t.alt} m`]
      ]))}
        ${U.sect('② 空域与作用范围校验', U.kv([
        ['所在空域', t.zone ? `${t.zone.name}（${t.zone.type} · ${t.zone.limitTx}）` : '未落入管制空域'],
        ['校验结果', zoneOk ? `<span class="tag t-green">通过 · 目标位于管制空域内</span>` : `<span class="tag t-amber">需人工判定 · 目标不在管制空域</span>`],
        ['作用范围', `以设备为中心 1,500 m / 扇区 60°`],
        ['合法目标影响', legalRisk.length ? `<span class="tag t-red">范围内存在 ${legalRisk.length} 个合法飞行目标，需规避</span>` : `<span class="tag t-green">范围内无合法飞行目标</span>`]
      ]))}
        ${U.sect('③ 处置设备与参数', `
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            ${U.field('反制设备', U.select('dev', dev.map(d => ({ v: d.id, t: d.name + '（' + d.status + '）' }))))}
            ${U.field('处置方式', U.select('mode', ['压制迫降', '驱离返航', '链路干扰']))}
            ${U.field('持续时长', `<input class="ip" style="width:76px" value="60"> 秒`)}
          </div>
          ${U.kv([['授权编号', `<span class="mono">AUTH2026${M.util.p2(8)}${M.util.p3(27)}</span>`],
        ['授权单位', '东营市低空安全管理中心'], ['操作人', '管理员（当前登录）'],
        ['公安信号干扰', '本次不涉及（如需请在处置处罚管理中发起授权流程）']])}`)}
        ${U.sect('④ 人工双确认', `
          <label class="chk"><input type="checkbox" data-c="1">我已核对目标身份与违规事实，确认对该目标实施反制处置</label>
          <label class="chk"><input type="checkbox" data-c="2">我已确认作用范围内无合法飞行目标与地面安全风险，并知悉本次操作将全程审计</label>`)}`,
      footer: `<button class="btn" data-close>取消</button>
        <button class="btn danger" data-act="go" disabled id="btnGo">确认授权并下发指令</button>`,
      mounted: el => {
        const upd = () => {
          const n = [...el.querySelectorAll('[data-c]')].filter(x => x.checked).length;
          el.querySelector('#btnGo').disabled = n < 2;
        };
        el.querySelectorAll('[data-c]').forEach(c => c.onchange = upd);
      },
      on: {
        go: () => {
          U.closeModal();
          if (onAuthorized) onAuthorized(t);
          else execCounter(t);
        }
      }
    });
  }

  function execCounter(target) {
    const t = target || sel;
    let sec = 0, video = null;
    U.modal({
      title: '反制指令执行监视',
      width: '720px',
      body: `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12.5px;color:#9ec6ff">光电实时视频（取证录像中 · §6.2）</span>
          <span>
            <button class="btn ghost" data-act="vis" style="height:24px;font-size:11.5px">可见光</button>
            <button class="btn ghost" data-act="ir" style="height:24px;font-size:11.5px">热成像</button>
            <button class="btn ghost" data-act="snap" style="height:24px;font-size:11.5px">📷 截图取证</button>
          </span></div>
        <div id="exVideo" style="margin-bottom:10px"></div>
        <div id="exLog" style="font:12px/1.9 Menlo,monospace;color:var(--txt-2);height:150px;overflow:auto;
          background:rgba(3,9,26,.7);border:1px solid var(--line-2);border-radius:6px;padding:10px"></div>
        <div style="display:flex;gap:14px;margin-top:12px" id="exSt">
          ${[['指令状态', '已接受'], ['执行状态', '执行中'], ['回执', '等待'], ['耗时', '0s']].map(([k, v]) =>
        `<div style="flex:1;border:1px solid var(--line);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:11px;color:var(--txt-3)">${k}</div><div style="font-size:14px;margin-top:3px">${v}</div></div>`).join('')}
        </div>`,
      footer: `<button class="btn warn" data-act="stop">停止处置</button>
        <button class="btn danger" data-act="estop">■ 急停</button>
        <button class="btn" data-close>关闭</button>`,
      on: {
        stop: () => { push('[STOP] 操作人下发停止指令，设备已停止发射'); finish('已停止'); },
        estop: () => { push('[E-STOP] 触发急停，所有反制设备立即停止并上报审计'); finish('急停'); },
        vis: () => { if (video) video.mode = 'visible'; },
        ir: () => { if (video) video.mode = 'ir'; },
        snap: () => { push('[EVID] 已截取当前帧存证 snapshot_' + t.id + '_' + sec + 's.jpg（含时间戳与设备水印）'); U.toast('截图已加入证据链', 'ok'); }
      },
      mounted: el => {
        video = new EOVideo(el.querySelector('#exVideo'), { height: 218, targetId: t.id, device: '光电吊舱-02', locked: true });
      }
    });
    const box = () => document.getElementById('exLog');
    function push(s) {
      const b = box(); if (!b) return;
      b.innerHTML += `<div><span style="color:var(--txt-3)">${M.util.fmtT(new Date(M.CONF.demoTime.getTime() + sec * 1000))}</span> ${s}</div>`;
      b.scrollTop = b.scrollHeight;
    }
    /* 方位角必须由设备与目标的真实位置算出。原来是 Math.random()*360 ——
       日志里写着"反制设备指向 XX 目标、方位 217.4°"，而那个数和目标在哪毫无关系，
       每次重绘还会变。处置日志是取证材料的一部分，不能填一个编的角度。 */
    function nearestCM(tg) {
      /* 按实际距离挑最近的反制设备，不按区县名匹配 ——
         设备上根本没有 district 字段（是 region），名字里的区县只是字符串；
         原来那句 d.district === tg.district 永远不成立，于是每次都退化成"台账里的第一台"，
         日志里就出现了「河口区反制01号」指向垦利区目标。 */
      let best = null, bd = Infinity;
      M.devices.forEach(d => {
        if (d.deviceTypeAbbr !== 'cm' || d.lon == null) return;
        const km = M.util.distKm ? M.util.distKm(d, tg) : Math.hypot(d.lon - tg.lon, d.lat - tg.lat) * 100;
        if (km < bd) { bd = km; best = d; }
      });
      return { dev: best, km: bd };
    }
    function bearingToTarget(tg) {
      const { dev } = nearestCM(tg);
      if (!dev || tg.lon == null) return '—';
      const rad = Math.PI / 180, dLon = (tg.lon - dev.lon) * rad;
      const y = Math.sin(dLon) * Math.cos(tg.lat * rad);
      const x = Math.cos(dev.lat * rad) * Math.sin(tg.lat * rad)
        - Math.sin(dev.lat * rad) * Math.cos(tg.lat * rad) * Math.cos(dLon);
      return ((Math.atan2(y, x) / rad + 360) % 360).toFixed(1);
    }

    const script = [
      `[AUTH] 授权校验通过，授权编号 AUTH2026${M.util.p2(8)}${M.util.p3(27)}`,
      `[API ] POST /api/v1/counter/task/send → 200 {"taskId":"CT${t.id.slice(3)}","status":"accepted"}`,
      (function () {
        const { dev, km } = nearestCM(t);
        return dev
          ? `[DEV ] ${dev.name} 就位（距目标 ${km.toFixed(1)} km），指向 目标 ${t.id}，方位 ${bearingToTarget(t)}°`
          : `[DEV ] 无可用反制设备 —— 该区域未部署反制类设备，本条处置需现场支援`;
      })(),
      `[EXEC] 处置执行中… 作用范围 1500m / 扇区 60°`,
      `[EO  ] 光电云台联动跟踪，目标锁定，视频取证已开始录制`,
      `[TRK ] 目标高度由 ${t.alt}m 下降至 ${Math.max(20, t.alt - 40)}m，速度下降 42%`,
      `[ACK ] POST /api/v1/counter/task/ack → 执行回执：目标已返航`,
      /* 上级同步：处置完成必须向上级主管部门报送。
         接口清单里 POST /api/v1/dispatch/sync 一直存在，但这条链路从没被调用过 ——
         「通知周边」通知的是塔台/分局/油田保卫处，都是平级单位，不是上级。
         空间安全风险页的「通知上级」走的是同一个接口，两处必须用同一份记录结构，
         否则会出现两种格式的上级同步记录，而它们最终都要进证据台账。 */
      (function () {
        const u = M.currentUser;
        return `[SYNC] POST /api/v1/dispatch/sync → 东营市公安局低空管理科`
          + `（渠道 NC2 上级管控平台接口 · 操作人 ${u.name}/${u.roleName}）`;
      })(),
      (function () {
        // 回执是结构不是一个词：失败要能重试并计次，不能静默当成功
        const rr = CH.seeded('sync' + t.id)(1, 100);
        return rr > 12
          ? `[SYNC] ← 回执 ✓ 已接收（上级平台 200 · 记录已入通报台账，待归入证据）`
          : `[SYNC] ← 回执 ✗ 超时未响应，已置「待重试」（重试 1/3，不影响本次处置结果）`;
      })(),
      `[ARCH] 处置结果与证据链已归档（轨迹 + 视频 + 告警 + 授权记录 + 上级同步回执）`
    ];
    let i = 0;
    timer = setInterval(() => {
      if (!document.getElementById('exLog')) { clearInterval(timer); return; }
      sec += 2;
      if (i < script.length) { push(script[i++]); }
      const st = document.getElementById('exSt');
      if (st) st.children[3].lastElementChild.textContent = sec + 's';
      if (i === script.length) {
        clearInterval(timer);
        finish('已完成');
        U.toast('✅ 反制处置完成，回执已接收，结果已归档', 'ok');
        setTimeout(() => effectModal(t), 500);       // F0811:效果评估
      }
    }, 700);
    function finish(txt) {
      clearInterval(timer);
      const st = document.getElementById('exSt');
      if (!st) return;
      st.children[1].lastElementChild.textContent = txt;
      st.children[2].lastElementChild.innerHTML = '<span style="color:#79e5a5">已接收</span>';
    }
  }

  /* ---- F0811:反制效果评估(A11) —— 依处置前后轨迹形成结论并写入案件 ---- */
  function effectModal(t) {
    const rr = CH.seeded('eff' + t.id);
    const altBefore = t.alt, altAfter = Math.max(15, t.alt - rr(30, 60));
    const spdBefore = +t.speed, spdAfter = +(spdBefore * (rr(35, 60) / 100)).toFixed(1);
    const verdict = altAfter < 40 ? '迫降' : spdAfter < spdBefore * .5 ? '返航' : '退出管制区';
    const vc = verdict === '迫降' ? 't-green' : verdict === '返航' ? 't-blue' : 't-amber';
    // 写入内存:供处置处罚管理的案件详情引用(§单一数据源)
    M.counterEffects = M.counterEffects || {};
    M.counterEffects[t.id] = {
      verdict, altBefore, altAfter, spdBefore, spdAfter,
      durationS: rr(40, 120), evaluatedAt: M.util.fmtDT(M.CONF.demoTime)
    };
    U.modal({
      title: '反制效果评估（F0811 · A11）', width: '560px',
      body: `<div class="warnbox">功能性实现（B档）：由处置前后轨迹变化形成结论并写入案件；
          <b>量化判据阈值待算法方标定</b>。结论已回写目标 ${t.id} 的处置记录。</div>
        <div style="display:flex;align-items:center;gap:14px;padding:12px;border:1px solid var(--line);border-radius:8px;margin-bottom:12px">
          <div style="font-size:30px">${verdict === '迫降' ? '🛬' : verdict === '返航' ? '↩️' : '➡️'}</div>
          <div><div style="font-size:12px;color:var(--txt-3)">评估结论</div>
            <div style="font-size:20px;font-weight:700"><span class="tag ${vc}" style="font-size:16px;padding:2px 10px">${verdict}</span></div></div>
          <div style="margin-left:auto;text-align:right;font-size:11.5px;color:var(--txt-3)">评估时间<br>${M.util.fmtT(M.CONF.demoTime)}</div>
        </div>
        ${U.kv([
        ['处置前高度', altBefore + ' m'], ['处置后高度', `${altAfter} m　<span class="dn">↓ ${altBefore - altAfter}m</span>`],
        ['处置前速度', spdBefore + ' m/s'], ['处置后速度', `${spdAfter} m/s　<span class="dn">↓ ${(100 - spdAfter / spdBefore * 100).toFixed(0)}%</span>`],
        ['有效作用时长', M.counterEffects[t.id].durationS + ' s'],
        ['判定依据', '高度持续下降 + 速度骤降 → 目标失去正常飞行能力'],
        ['结论去向', '已写入案件处置记录与日志归档，作为效果佐证']])}`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn pri" data-close onclick="location.hash='#/punish';UI.toast('可在处置处罚管理查看该目标的效果评估','ok')">前往案件查看</button>`
    });
  }

  function mount(view) {
    map = new MapView(document.getElementById('stMap'), {
      maxDev: 46, maxAlarm: 6, zoom: 1.06, legend: false,   // 图例已并入图层浮层，避免地图上两个框重复

      onPick: p => {
        if (p.kind === 'target') { sel = M.liveTargets.find(t => t.id === p.data.id) || sel; refresh(); }
      }
    });
    applyFilter();      // 依当前筛选装载地图/告警/目标
    map.sel = sel.id;
    refresh();

    // 图层控制浮层(从工具条移入地图右上角,腾出纵向空间)
    const lyBox = document.createElement('div');
    lyBox.className = 'maplayers';
    // 图层开关 + 图例合一:每项带线型/色块标识
    /* 空域三项由 M.AIRSPACE_TYPES 生成 —— 图层键、名称、配色都不在这里再写一份。
       之前 map.js 里一份、这里一份，而"临时管制区属于禁飞图层"这条只写在 map.js 的三元表达式里，
       图例上就成了「限高 / 管制区」，把一个绝对禁止空间说成了限高区。 */
    const AT = M.AIRSPACE_TYPES;
    const layerLabel = k => [...new Set(AT.filter(a => a.layer === k).map(a => a.legend))].join(' / ');
    const layerColor = k => (AT.find(a => a.layer === k) || {}).color;
    const LY = [
      ['device', '设备点位', '<span class="sw dot" style="background:#22d3ee"></span>'],
      ['track', '无人机轨迹', '<span class="sw ln" style="border-color:#2fd06e"></span>']
    ].concat([...new Set(AT.map(a => a.layer))].map(k =>
      [k, layerLabel(k), `<span class="sw ln" style="border-color:${layerColor(k)}"></span>`]));
    lyBox.innerHTML = `<div class="lyt">图层与图例</div>` +
      LY.map(([k, n, sw]) => `<label><input type="checkbox" data-layer="${k}" checked>${sw}${n}</label>` +
        (k === 'track' ? `<div class="sub"><i style="border-color:#ff4d5e"></i>非法/告警</div>
          <div class="sub"><i style="border-color:#ff8b3d"></i>弥合段 A03</div>
          <div class="sub"><i style="border-color:#22d3ee"></i>预测段 A04</div>` : '')).join('');
    document.getElementById('stMap').appendChild(lyBox);
    U.on(view, '[data-layer]', 'change', (e, el) => map.setLayer(el.dataset.layer, el.checked));
    U.on(view, '[data-alm]', 'click', (e, el) => {
      const t = M.liveTargets.find(x => x.id === el.dataset.alm);
      if (t) { sel = t; map.sel = t.id; refresh(); }
      else U.toast('该告警目标已脱离实时跟踪窗口，可在「异常告警中心」查看历史详情');
    });
    // 筛选：改下拉即时生效（地图、告警列表、当前目标三处同步）
    U.on(view, '[data-f]', 'change', (e, el) => {
      if (flt[el.dataset.f] === undefined) return;      // 只处理顶部筛选条的四个下拉
      flt[el.dataset.f] = el.value;
      applyFilter(); refresh();
    });
    document.getElementById('btnTech').onclick = techDrawer;
  }

  function paintActions() {
    const t = sel, isUav = t.type === '无人机';
    document.getElementById('stAct').innerHTML = isUav
      ? `
         <div style="display:flex;gap:8px;margin-top:8px">
           <button class="btn" id="btnVideo" style="flex:1;justify-content:center">📹 实时视频</button>
           <button class="btn" id="btnReplay" style="flex:1;justify-content:center">轨迹回放</button>
         </div>`
      : `<button class="btn big" style="width:100%;justify-content:center" disabled title="非无人机目标不进入反制流程">
           ⚡ 发起联动反制（不适用）</button>
         <div style="display:flex;gap:8px;margin-top:8px">
           <button class="btn" id="btnVideo" style="flex:1;justify-content:center">📹 实时视频</button>
           <button class="btn" id="btnNotify" style="flex:1;justify-content:center">通知机场/周边</button>
           <button class="btn" id="btnDrive" style="flex:1;justify-content:center">派发驱离</button>
           <button class="btn" id="btnRisk" style="flex:1;justify-content:center">转风险监测 →</button>
         </div>
         <div class="warnbox" style="margin:6px 0 0;padding:6px 9px;font-size:11px;line-height:1.5">
           §4.2：<b>${t.subtype || t.type}</b>不做合法性判定、不进入反制与处罚流程，仅风险评估与通知/驱离。</div>`;
    bindActions(isUav);
  }
  function bindActions(isUav) {
    const g2 = id => document.getElementById(id);
    g2('btnVideo').onclick = () => videoModal(sel);
    if (isUav) {
      g2('btnReplay').onclick = () => replayModal(sel);
    } else {
      g2('btnNotify').onclick = () => U.toast('已通知东营胜利机场塔台与属地派出所（回执 2/2）', 'ok');
      g2('btnDrive').onclick = () => U.toast('已派发驱离作业任务至属地保障单位', 'ok');
      g2('btnRisk').onclick = () => { U.toast('正在跳转空间安全风险监测…'); setTimeout(() => location.hash = '#/risk', 600); };
    }
  }

  /* F0206 视频 + F0207 云台控制。显式接收目标，供融合感知与告警详情共用同一套交互。 */
  function videoModal(t) {
      if (!t) return U.toast('未找到关联目标，无法打开实时视频', 'err');
      let v = null;
      const ptz = { az: 118.7, el: 12.4, zoom: 8.0, busy: false, tracking: false };
      U.modal({
        title: '光电实时视频与云台控制 · ' + t.id, width: '900px',
        body: `<div style="display:flex;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span style="font-size:12px;color:var(--txt-3)">光电吊舱-02 · 联动跟踪中（A07/A08）</span>
              <span><button class="btn ghost" data-act="vis" style="height:24px;font-size:11.5px">可见光</button>
              <button class="btn ghost" data-act="ir" style="height:24px;font-size:11.5px">热成像</button>
              <button class="btn ghost" data-act="snap" style="height:24px;font-size:11.5px">📷 截图取证</button></span></div>
            <div id="lvVideo"></div>
            <div style="margin-top:8px;font-size:11px;color:var(--txt-3)">正式版 /api/v1/eo/stream 拉流；本画面为 Demo 模拟渲染，接口 Schema 一致。</div>
          </div>
          <div style="width:252px;flex:none">
            <div style="font-size:12.5px;color:#9ec6ff;margin-bottom:4px">光电跟踪（F0207）</div>
            <div class="warnbox" style="margin:0 0 8px;padding:6px 8px;font-size:10.5px;line-height:1.55">
              依《光电设备边端协同接口》，云台<b>由平台下发跟踪任务后自行指向目标</b>，
              协议未提供手动瞄准动作（<span class="mono">AbsMoveByAngle / SetHome / MoveHome /
              DetectToggle / TrackToggle</span> 均标注「暂不支持」）。<br>
              可用事件仅 <b>BeginTracking / EndTracking / HeartBeat</b>。
            </div>
            ${(function () {
        /* 下发跟踪是处置动作不是查看动作 —— 按 §11.9 权限模型判定，不在页面里另解 PERM 矩阵。
           解矩阵的逻辑一旦有第二份，改权限模型时必然漏改一处。 */
        const okOp = M.can('融合感知中心', 'op');
        const cu = M.currentUser;
        return `<div style="display:flex;gap:6px;margin-bottom:8px">
              <button class="btn pri" data-ptz="begin" style="flex:1;justify-content:center"
                ${okOp ? '' : `disabled title="当前角色「${cu.roleName}」为只读，不可下发处置动作"`}>▶ 下发跟踪</button>
              <button class="btn" data-ptz="end" style="flex:1;justify-content:center"
                ${okOp ? '' : 'disabled'}>■ 结束跟踪</button>
            </div>
            ${okOp ? '' : `<div class="warnbox" style="margin:0 0 8px;padding:6px 8px;font-size:10.5px;line-height:1.5">
              当前登录角色 <b>${cu.name}（${cu.roleName}）</b> 对本模块为<b>只读</b>，
              可查看跟踪状态与指令回执，不可下发跟踪任务（§11.9）。</div>`}`;
      })()}
            <div id="ptzSt">${U.kv([['方位角', '118.7°'], ['俯仰角', '12.4°'], ['变倍', '8.0x'], ['云台状态', '<span class="tag t-green">就绪</span>']])}</div>
            <button class="btn ghost" data-ptz="query" style="width:100%;justify-content:center;margin:6px 0"
              title="CameraStatus：协议表「支持」列为是、备注列疑似「暂不支持」，待设备方确认">⟳ 状态查询 CameraStatus <span class="tag t-amber" style="margin-left:4px">待确认</span></button>
            <div style="font-size:11px;color:#9ec6ff;margin-bottom:3px">指令回执</div>
            <div id="ptzLog" style="font:10px/1.7 Menlo,monospace;color:var(--txt-3);height:96px;overflow:auto;
              background:rgba(3,9,26,.7);border:1px solid var(--line-2);border-radius:5px;padding:5px 7px"></div>
            <div style="font-size:10.5px;color:var(--txt-3);margin-top:5px">
              A09 云台控制由设备方交付（C档验收）；引导源见下方跟踪任务</div>
          </div></div>`,
        on: {
          vis: () => { if (v) v.mode = 'visible'; },
          ir: () => { if (v) v.mode = 'ir'; },
          snap: () => U.toast('截图已存证并关联目标 ' + t.id, 'ok')
        },
        mounted: el => {
          v = new EOVideo(el.querySelector('#lvVideo'), { height: 322, targetId: t.id, locked: true });
          const log = el.querySelector('#ptzLog');
          function push(txt, cls) {
            log.insertAdjacentHTML('afterbegin', `<div style="${cls === 'warn' ? 'color:#ffd07a' : cls === 'ok' ? 'color:#79e5a5' : ''}">${M.nowTime()} ${txt}</div>`);
            while (log.children.length > 24) log.lastElementChild.remove();
          }
          function paintSt(state) {
            el.querySelector('#ptzSt').innerHTML = U.kv([
              ['方位角', ptz.az.toFixed(1) + '°　<span style="color:var(--txt-3);font-size:11px">只读</span>'],
              ['俯仰角', ptz.el.toFixed(1) + '°　<span style="color:var(--txt-3);font-size:11px">只读</span>'],
              ['变倍', ptz.zoom.toFixed(1) + 'x'],
              ['跟踪状态', ptz.tracking ? '<span class="tag t-green">跟踪中</span>' : '<span class="tag t-gray">未跟踪</span>'],
              ['引导源', ptz.tracking ? `<span class="mono">${t.trackId || '—'}</span> <span style="color:var(--txt-3)">(雷达)</span>` : '—'],
              ['云台状态', state || '<span class="tag t-green">就绪</span>']]);
          }
          el.addEventListener('click', e2 => {
            const b = e2.target.closest('[data-ptz]'); if (!b || b.disabled || ptz.busy) return;
            const k = b.dataset.ptz;
            // B3:仅保留《光电设备边端协同接口》标注「支持」的事件
            if (k === 'query') {
              push('CameraStatus → az=' + ptz.az.toFixed(1) + ' el=' + ptz.el.toFixed(1) + ' zoom=' + ptz.zoom.toFixed(1) + ' state=ready', 'ok');
              push('  ⚠ CameraStatus 支持状态待设备方确认（协议表支持列与备注列不一致）', 'warn');
              paintSt(); return;
            }
            if (k === 'begin') {
              // 引导源:雷达轨迹引导光电(A08 真实机制)
              const bs = { id: t.trackId || t.id, type: 1, typeName: '雷达' };
              /* 下发跟踪是处置动作不是查看动作 —— 它会占用设备、改变视场覆盖，
                 并产生一份带目标编号的录像作为法律凭据。不告知就下发，
                 等于让人在不知情的情况下产生了证据。 */
              if (!ptz.confirmed) {
                U.modal({
                  title: '确认下发光电跟踪任务', width: '520px',
                  body: `<div class="warnbox">下发后将发生以下四件事，请确认：</div>
                    ${U.kv([
                    ['① 视场变更', `该光电将转向 <b class="mono">${t.id}</b>，
                       <b style="color:#ffb083">其原覆盖区域在跟踪期间无光电观测</b>`],
                    ['② 设备占用', '跟踪期间该光电不接受其他目标的跟踪任务，需先结束当前跟踪'],
                    ['③ 产生证据', `录像将<b style="color:#ffb083">绑定目标编号 ${t.id} 入证据台账</b>，
                       按留存策略保存，关联案件未结案时冻结不可清理`],
                    ['④ 跟丢处理', '目标丢失超时后自动结束跟踪并回报，云台停留在最后方位，需人工确认']
                  ])}
                    <div style="margin-top:8px;font-size:11.5px;color:var(--txt-3)">
                      引导源：${bs.typeName} <span class="mono">${bs.id}</span>（A08 雷达引导光电）</div>
                    <div style="margin-top:9px;padding-top:9px;border-top:1px solid var(--line)">
                      <label class="chk"><input type="checkbox" data-pc>
                        我知悉上述四项后果，确认下发本次光电跟踪任务</label>
                      <div style="font-size:11px;color:var(--txt-3);margin-top:5px">
                        操作人 <b style="color:#79e6f6">${M.currentUser.name}</b>（${M.currentUser.roleName}
                        · ${M.currentUser.org}），本次下发将记入操作审计。</div>
                    </div>`,
                  footer: `<button class="btn ghost" data-close>取消</button>
                    <button class="btn pri" data-close data-ptzgo disabled>确认下发</button>`,
                  mounted: el3 => {
                    const go = el3.querySelector('[data-ptzgo]'), ck = el3.querySelector('[data-pc]');
                    ck.onchange = () => { go.disabled = !ck.checked; };
                    go.onclick = () => { ptz.confirmed = true; setTimeout(() => {
                      const b2 = document.querySelector('[data-ptz="begin"]'); if (b2) b2.click(); }, 120); };
                  }
                });
                return;
              }
              ptz.confirmed = false;
              ptz.busy = true;
              push('BeginTracking { targetId:"' + t.id + '", bootstrapSourceId:"' + bs.id + '", bootstrapSourceType:' + bs.type + '(' + bs.typeName + ') }');
              paintSt('<span class="tag t-cyan">跟踪任务下发中…</span>');
              setTimeout(() => {
                ptz.busy = false; ptz.tracking = true;
                push('回执 ✓ 光电已接管跟踪 · 引导源 ' + bs.typeName + ' ' + bs.id
                  + ' · 操作人 ' + M.currentUser.name + '(' + M.currentUser.roleName + ')'
                  + ' · 耗时 ' + CH.seeded('bt' + t.id)(300, 900) + 'ms', 'ok');
                paintSt();
              }, 800);
              return;
            }
            if (k === 'end') {
              ptz.tracking = false;
              push('EndTracking { targetId:"' + t.id + '" } → 回执 ✓ 跟踪已结束', 'ok');
              paintSt(); return;
            }
          });
          push('光电边端连接就绪 · HeartBeat 1s/次 · 可用事件: BeginTracking / EndTracking');
        }
      });
  }

  function paintTag() {
    const el = document.getElementById('stTag');
    if (!el) return;
    const map = { '跟踪中': ['t-cyan', '#22d3ee'], '处置中': ['t-orange', '#ff8b3d'], '已处置': ['t-green', '#2fd06e'] };
    const [cls, col] = map[sel.status] || ['t-gray', '#8ca0be'];
    el.innerHTML = `<span class="tag ${cls}"><span class="dot-s" style="background:${col}"></span>${sel.status}</span>`;
  }
  /* ---- F0203:历史轨迹回放(时间轴/倍速/暂停/跳转/单目标聚焦) ---- */
  function replayModal(target, relatedAlarm) {
    const t = target || sel, tr = t && t.track;
    if (!t || !tr || !tr.length) return U.toast('该目标暂无可回放的轨迹数据', 'err');
    let idx = 0, playing = true, speed = 1, focus = true, rmap = null, timer = null;
    const t0 = tr[0].t, t1 = tr[tr.length - 1].t;
    const alarm = relatedAlarm || M.todayAlarms.find(a => a.targetId === t.id);
    const alarmPct = alarm ? Math.max(0, Math.min(100, (alarm.ts - t0) / (t1 - t0) * 100)) : null;
    U.modal({
      title: '轨迹回放 · ' + t.id + '（' + (t.trackId || '归档轨迹') + '）', width: '860px',
      body: `<div id="rpMap" style="height:340px;border:1px solid var(--line-2);border-radius:6px"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
          <button class="btn" data-act="toggle" id="rpPlay" style="width:64px;justify-content:center">⏸ 暂停</button>
          <button class="btn ghost" data-act="speed" id="rpSpeed">${speed}x</button>
          <div style="flex:1;position:relative">
            <input type="range" id="rpSlider" min="0" max="${tr.length - 1}" value="0" style="width:100%;accent-color:#3d8bff">
            ${alarmPct != null ? `<span title="${alarm.type} ${alarm.time.slice(11)}" style="position:absolute;left:${alarmPct}%;top:-7px;width:8px;height:8px;border-radius:50%;background:#ff4d5e;box-shadow:0 0 0 3px rgba(255,77,94,.25)"></span>` : ''}
          </div>
          <span class="mono" id="rpTime" style="width:70px;text-align:right;font-size:12px"></span>
          <label class="chk" style="margin:0"><input type="checkbox" id="rpFocus" checked>聚焦</label>
        </div>
        <div style="display:flex;gap:16px;margin-top:8px;font-size:12px;color:var(--txt-2)" id="rpInfo"></div>
        ${alarm ? `<div style="margin-top:6px;font-size:11.5px;color:#ff8b95">⚑ 时间轴红点：${alarm.time.slice(11)} 触发「${alarm.type}」告警</div>` : ''}`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn" data-act="export">⭳ 导出回放片段</button>`,
      mounted: el => {
        rmap = new MapView(el.querySelector('#rpMap'), { zoom: 2.2, legend: false, layers: { device: false, alarm: false } });
        const slider = el.querySelector('#rpSlider');
        slider.oninput = () => { idx = +slider.value; paintFrame(); };
        el.querySelector('#rpFocus').onchange = e2 => focus = e2.target.checked;
        function paintFrame() {
          const cur = tr[idx];
          rmap.setData({
            airspaces: M.airspaces.filter(a => a.status === '生效中'),
            targets: [Object.assign({}, t, { tracked: true, track: tr.slice(0, idx + 1), lon: cur.lon, lat: cur.lat, alt: cur.alt })],
            devices: [], alarms: []
          });
          if (focus) { const q = rmap.px(cur.lon, cur.lat); rmap.ox += rmap.w / 2 - q[0]; rmap.oy += rmap.h / 2 - q[1]; }
          slider.value = idx;
          el.querySelector('#rpTime').textContent = M.util.fmtT(new Date(cur.t));
          el.querySelector('#rpInfo').innerHTML =
            `<span>进度 <b class="mono">${idx + 1}/${tr.length}</b></span>
             <span>高度 <b class="mono">${cur.alt} m</b></span>
             <span>点型 ${cur.kind === 'meas' ? '<span class="tag t-green">实测</span>' : cur.kind === 'bridge' ? '<span class="tag t-orange">弥合(A03)</span>' : '<span class="tag t-cyan">预测(A04)</span>'}</span>
             <span style="color:var(--txt-3)">时段 ${M.util.fmtT(new Date(t0))} ~ ${M.util.fmtT(new Date(t1))}</span>`;
        }
        paintFrame();
        timer = setInterval(() => {
          if (!el.isConnected) { clearInterval(timer); if (rmap) rmap.destroy(); return; }
          if (!playing) return;
          idx += speed;
          if (idx >= tr.length) idx = 0;          // 循环回放
          paintFrame();
        }, 400);
      },
      on: {
        toggle: el => { playing = !playing; el.querySelector('#rpPlay').textContent = playing ? '⏸ 暂停' : '▶ 播放'; },
        speed: el => { speed = speed === 8 ? 1 : speed * 2; el.querySelector('#rpSpeed').textContent = speed + 'x'; },
        export: () => U.toast('已导出回放片段（轨迹 GeoJSON + 告警标记），可作证据附件', 'ok')
      }
    });
  }

  function applyFilter() {
    const ts = shownTargets(), as = shownAlarms();
    if (map) map.setData({
      airspaces: M.airspaces,
      devices: M.devices.filter((d, i) => i % 4 === 0),
      targets: ts, alarms: as
    });
    if (ts.length && !ts.some(t => t.id === sel.id)) { sel = ts[0]; if (map) map.sel = sel.id; }
    paintAlarms();
    const badge = document.getElementById('stFltInfo');
    if (badge) {
      const on = flt.region !== '东营市全域' || flt.ttype !== '全部' || flt.risk !== '全部' || flt.src !== '全部';
      badge.innerHTML = on
        ? `<span class="tag t-amber">已筛选</span> <span style="color:var(--txt-2)">目标 ${ts.length}/${M.liveTargets.length} · 告警 ${as.length}/${M.todayAlarms.length}</span>
           <span class="lnk" id="stFltReset" style="margin-left:6px">清除</span>`
        : `<span style="color:var(--txt-3)">目标 ${ts.length} · 告警 ${as.length}</span>`;
      const rs = document.getElementById('stFltReset');
      if (rs) rs.onclick = () => {
        flt = { region: '东营市全域', ttype: '全部', risk: '全部', src: '全部' };
        document.querySelectorAll('#view [data-f]').forEach(el => { if (flt[el.dataset.f] != null) el.value = flt[el.dataset.f]; });
        applyFilter(); refresh();
      };
    }
  }

  function refresh() {
    paintTarget(); paintFuse(); paintAlarms(); paintTag(); paintActions();
  }

  function destroy() { if (map) map.destroy(); map = null; if (timer) clearInterval(timer); closeDrawer(); }
  /* 跨页只暴露查看型媒体能力；处置、筛选等仍由融合感知页面自己管理。 */
  g.TARGET_MEDIA = { openVideo: videoModal, openReplay: replayModal };
  g.TARGET_ACTIONS = { openCounterAuth: counterModal };
  g.PAGES = g.PAGES || {};
  g.PAGES.situation = { render, mount, destroy };
})(window);
