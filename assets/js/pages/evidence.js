/* ===== 16. 证据存储管理（COM-04 文件与证据存储 · P0） =====
   证据是法律凭据，不是日志。归档管的是「发生过什么」，这里管的是「凭据还在不在、动没动过、
   谁看过、什么时候能删」。所以独立成页而不是并进日志归档 —— 保管要求不同。

   当前页面聚焦证据文件台账与文件信息，下载按钮使用 Demo 交互反馈。 */
(function (g) {
  const M = MOCK, U = UI;
  let st = {
    page: 1, size: 10, kind: '全部', verify: '全部', status: '全部', refKind: '全部',
    kw: '', onlyBad: false, sel: null, sort: 'captured', dir: -1, mod: '全部'
  };

  const ALL = '全部';
  const REF_LABEL = { case: '处罚案件', target: '感知目标', alarm: '告警', riskEvent: '空间安全风险事件', authLog: '反制/干扰授权', commTask: '调测任务', device: '设备', airspace: '空域' };

  const VC = { '完好': 't-green', '哈希不一致': 't-red', '文件缺失': 't-red', '待校验': 't-amber' };
  const SC = { '在库': 't-green', '临近到期': 't-amber', '已到期待清理': 't-orange', '已销毁': 't-gray' };
  const isBad = f => f.verifyState !== '完好';

  /* ===== 归档来源模块 =====
     用户的心智是"按模块看"（哪个模块归档了什么），不是"按文件类型看"。
     ── 这里曾经由本页自己推断模块，现已改为直接读数据层的 f.srcModule ──
     旧规则是「页面产出归该页面；调测报告归设备接入调测；指令报文与回执归反制与干扰授权；
     其余设备直采归融合感知」，据此算出"融合感知 279 份"。数据层给的是"处置处罚 300 / 融合感知 18"。
     同一批文件两个结论，两边各自自洽 —— 差异全在那 249 份"设备拍的、挂在案件上"的文件上。
     用数据判了：这 249 份的 capturedAt 全部**晚于**所引案件的立案时刻（1.2~15.0 分钟，
     249/249 无一例外，两边时间基准同格式可比）。即证据是立案之后、在案件驱动下才产生的，
     不是先有证据再归集。所以产生动作发生在处置处罚管理，旧规则把它们算给融合感知是错的。
     结论：模块归属只认数据层的 srcModule，本页不再推断 —— 页面重算一遍就等于多一个会分叉的口径。 */
  const moduleOf = f => f.srcModule;
  const MODULES = () => [...new Set(M.evidenceFiles.map(f => f.srcModule))];

  /* 到期日与取证时刻是两个独立字段，这里如实相减；数据不一致时结果为负，
     页面不替数据层兜底 —— 兜住了就再也没人会发现它是错的。 */
  function daysLeft(f) {
    const d0 = new Date(f.capturedAt.slice(0, 10)), d1 = new Date(f.retainUntil);
    return Math.round((d1 - M.CONF.demoTime) / 864e5);
  }
  function retainSane(f) { return f.retainUntil >= f.capturedAt.slice(0, 10); }

  const SORTERS = {
    captured: f => f.capturedAt,
    kind: f => M.EVIDENCE_KINDS.indexOf(f.kind),
    size: f => f.sizeMB,
    verify: f => M.EVIDENCE_VERIFY.indexOf(f.verifyState),
    status: f => M.EVIDENCE_STATUS.indexOf(f.status),
    refs: f => f.refs.length,
    access: f => f.accessCount
  };
  const SORT_NOTE = { verify: '（完好→异常）', status: '（在库→已销毁）', kind: '（按类型枚举顺序）' };
  function sortTh(key, label) {
    const on = st.sort === key;
    return `<span class="lnk" data-sort="${key}" role="button" tabindex="0" title="点击按「${label}」排序${SORT_NOTE[key] || ''}"
      style="color:inherit;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:rgba(156,198,255,.5)"
      >${label}${on ? `<span style="font-size:10px;margin-left:2px">${st.dir < 0 ? '▼' : '▲'}</span>` : ''}</span>`;
  }

  function rows() {
    const kw = st.kw.toLowerCase();
    const f = M.evidenceFiles.filter(x =>
      (st.kind === ALL || x.kind === st.kind) &&
      (st.verify === ALL || x.verifyState === st.verify) &&
      (st.status === ALL || x.status === st.status) &&
      (st.refKind === ALL || x.refs.some(r => r.kind === st.refKind)) &&
      (st.mod === ALL || moduleOf(x) === st.mod) &&
      (!st.onlyBad || isBad(x) || x.status === '已到期待清理' || !retainSane(x)) &&
      /* originAction 一并进检索域：它里面带着案件号、调测任务号、授权号、风险事件号，
         而这些编号在别的字段里未必出现（如"授权 AUTH202608001"只存在于这句话里）。
         不收进来的话，按授权号根本搜不到对应的指令报文。 */
      (!kw || (x.id + ' ' + x.name + ' ' + x.srcName + ' ' + x.kind + ' ' + x.srcModule + ' ' +
        (x.originAction || '') + ' ' +
        x.refs.map(r => r.id).join(' ')).toLowerCase().indexOf(kw) >= 0));
    const gt = SORTERS[st.sort];
    if (!gt) return f;
    return f.sort((a, b) => { const x = gt(a), y = gt(b); return (x < y ? -1 : x > y ? 1 : 0) * st.dir; });
  }

  function legacyRender() {
    const ctx = U.consume('evidence');
    if (ctx && ctx.id) {
      const hit = M.evidenceFiles.find(f => f.id === ctx.id);
      if (hit) { st.sel = hit; st.kind = st.verify = st.status = st.refKind = ALL; st.kw = ''; st.onlyBad = false; }
    }
    st.sel = st.sel || M.evidenceFiles[0];
    const F = M.evidenceFiles;
    const bad = F.filter(isBad).length;
    const held = F.filter(f => f.legalHold).length;
    const due = F.filter(f => f.status === '已到期待清理').length;
    const caseIds = new Set();
    F.forEach(f => f.refs.forEach(r => { if (r.kind === 'case') caseIds.add(r.id); }));
    const gb = (F.reduce((s, f) => s + f.sizeMB, 0) / 1024).toFixed(1);
    const d30 = M.util.dayAdd(M.CONF.demoTime, -29);
    const in30 = F.filter(f => new Date(f.ingestAt) >= d30).length;

    const noCase = F.filter(f => !f.refs.some(r => r.kind === 'case')).length;
    /* KPI 以**文件生命周期**领衔而不是以"关联案件"领衔：
       关联案件放第一屏会把这个页面框成处罚的附属，而它管的是文件本身
       —— 完整性、留存到期、法定冻结、销毁留痕、跨实体反查。 */
    return `${U.kpis([
      { label: '完整性异常', value: U.num(bad), color: bad ? 'red' : 'green', icon: 'alert', desc: bad ? '哈希不一致 / 文件缺失 / 待校验' : '全部校验完好' },
      { label: '冻结中（未结案）', value: U.num(held), color: 'purple', icon: 'check', desc: '到期不清理，销毁被拦截' },
      { label: '已到期待清理', value: U.num(due), color: due ? 'orange' : 'green', icon: 'alert', desc: '需法制审批后销毁' },
      {
        label: '不属于任何案件', value: U.num(noCase), color: 'cyan', icon: 'archive',
        desc: `占 ${U.pct(noCase, F.length, 0)} —— 调测报告 / 通报回执 / 指令回执等`
      },
      { label: '证据文件总数', value: U.num(F.length), color: 'blue', icon: 'archive', desc: `占用 ${gb} GB · 近30天入库 ${in30} · 关联案件 ${caseIds.size} 件` },
      { label: '留存 / 校验', value: M.EVID_PARAMS.retainYears, unit: '年', color: 'amber', icon: 'zone', desc: `每 ${M.EVID_PARAMS.verifyCycleDays} 天全量校验 · 待业务方确认` }
    ])}
    <div class="warnbox" style="margin-top:12px;line-height:1.85;border-color:rgba(61,139,255,.45);background:rgba(61,139,255,.08)">
      本页管的是<b>文件本身的生命周期</b>（完整性 / 留存到期 / 法定冻结 / 销毁留痕 / 跨实体反查），
      不是案件办到哪一步 —— 后者在「处置处罚管理」。两者不重复：
      <b>${U.num(noCase)} 份（${U.pct(noCase, F.length, 0)}）证据不属于任何案件</b>，
      它们只存在于这里。
      ${/* 曾经这里挂着一条"归档来源尚未全覆盖"的警示：融合感知的截图取证、风险事件归档
           这两类动作会提示"已加入证据链"却不写台账。数据层补齐后（融合感知 18 份、
           空间安全风险 28 份）缺口已消，警示随之撤掉 —— 缺口条目和它对应的问题必须同生共死，
           问题没了还留着条目，和有问题却没条目一样坏。 */''}
    </div>

    ${/* 底部那一行统计图（归档来源模块 / 完整性校验结果 / 入库趋势 / 存储占用）已按用户要求删除。
         主行高度改为 100vh-277px —— 与 flights / risk 用同一个实测标定值：
         view 内除主行外的固定开销 183px、可视高 = 100vh-94。
         先按 100vh-236 试过，1440×900 下内容反而比可视高 41px（是撑出去不是留空白），
         **"空白"和"溢出"在只看一个差值时区分不出来，必须分两个方向量**。 */''}
    <div class="row" style="margin-top:12px;height:calc(100vh - 365px);min-height:527px">
      ${U.panel({
      title: '证据文件台账', style: 'flex:1;min-width:0', nopad: true,
      body: `<div class="toolbar">
          ${U.field('类型', U.select('kind', [ALL, ...M.EVIDENCE_KINDS], st.kind))}
          ${U.field('完整性', U.select('verify', [ALL, ...M.EVIDENCE_VERIFY], st.verify))}
          ${U.field('保管状态', U.select('status', [ALL, ...M.EVIDENCE_STATUS], st.status))}
          ${U.field('来源模块', U.select('mod', [ALL, ...MODULES()], st.mod))}
          ${U.field('关联对象', U.select('refKind', [ALL, ...Object.keys(REF_LABEL).map(k => ({ v: k, t: REF_LABEL[k] }))], st.refKind))}
          <input class="ip" id="evKw" style="width:180px" placeholder="编号 / 名称 / 关联对象编号" value="${st.kw}">
          <span style="flex:1"></span>
          <label class="chk" style="margin:0"><input type="checkbox" id="evBad" ${st.onlyBad ? 'checked' : ''}>只看需处理</label>
        </div>
        <div id="evList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
    })}
      ${U.panel({
      title: '证据详情', style: 'width:452px;flex:none', nopad: true, extra: `<span id="evSt"></span>`,
      body: `<div id="evDetail" style="flex:1;overflow:auto;padding:12px"></div>`
    })}
    </div>

    </div>`;
  }

  function render() {
    const ctx = U.consume('evidence');
    if (ctx && ctx.id) {
      const hit = M.evidenceFiles.find(f => f.id === ctx.id);
      if (hit) {
        st.sel = hit;
        st.kind = st.verify = st.status = st.refKind = st.mod = ALL;
        st.kw = '';
        st.onlyBad = false;
      }
    }
    st.sel = st.sel || M.evidenceFiles[0];
    return `<div style="height:100%;display:flex;flex-direction:column;min-height:0">
      <div class="row" style="flex:1;min-height:0;padding-bottom:6px">
        ${U.panel({
          title: '证据文件台账', style: 'flex:1;min-width:0', nopad: true,
          body: `<div class="toolbar">
            ${U.field('类型', U.select('kind', [ALL, ...M.EVIDENCE_KINDS], st.kind))}
            ${U.field('完整性', U.select('verify', [ALL, ...M.EVIDENCE_VERIFY], st.verify))}
            ${U.field('保管状态', U.select('status', [ALL, ...M.EVIDENCE_STATUS], st.status))}
            ${U.field('来源模块', U.select('mod', [ALL, ...MODULES()], st.mod))}
            ${U.field('关联对象', U.select('refKind', [ALL, ...Object.keys(REF_LABEL).map(k => ({ v: k, t: REF_LABEL[k] }))], st.refKind))}
            <input class="ip" id="evKw" style="width:180px" placeholder="编号 / 名称 / 关联对象编号" value="${st.kw}">
            <span style="flex:1"></span>
            <label class="chk" style="margin:0"><input type="checkbox" id="evBad" ${st.onlyBad ? 'checked' : ''}>只看需处理</label>
          </div>
          <div id="evList" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>`
        })}
        ${U.panel({
          title: '证据详情', style: 'width:452px;flex:none', nopad: true,
          body: `<div id="evDetail" style="flex:1;overflow:auto;padding:12px"></div>`
        })}
      </div>
    </div>`;
  }

  function list() {
    const all = rows(), page = all.slice((st.page - 1) * st.size, st.page * st.size);
    return U.table([
      {
        t: sortTh('kind', '证据编号 / 类型'), w: '132px', cls: 'num',
        render: f => `<div>${f.id}</div><div style="font-size:11px;color:var(--txt-3)">${f.kind}</div>`
      },
      {
        /* 文件名是本表最小宽度的来源（td 是 nowrap，声明宽度压不住内容），放开换行两行截断 */
        t: '文件 / 来源', render: f => `<div title="${f.name}" style="white-space:normal;line-height:1.4;
          max-height:31px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${f.name}</div>
          <div style="font-size:11px;color:var(--txt-3)">${f.srcKind === 'device' ? '设备 ' : f.srcKind === 'page' ? '页面 ' : '系统 '}${f.srcName}</div>`
      },
      {
        t: sortTh('captured', '取证时刻'), w: '124px', cls: 'num',
        render: f => `<div>${f.capturedAt.slice(5, 16)}</div>
          <div style="font-size:11px;color:var(--txt-3)">入库 +${Math.max(0, Math.round((new Date(f.ingestAt) - new Date(f.capturedAt)) / 1000))}s</div>`
      },
      { t: sortTh('size', '大小'), w: '72px', align: 'right', cls: 'num', render: f => f.sizeMB.toFixed(1) + ' MB' },
      { t: sortTh('verify', '完整性'), w: '92px', render: f => U.tag(f.verifyState, VC[f.verifyState]) },
      {
        t: sortTh('status', '保管'), w: '108px',
        render: f => `${U.tag(f.status, SC[f.status])}${f.legalHold ? ' <span class="tag t-purple" title="关联案件未结案，冻结中">冻</span>' : ''}`
      },
      {
        t: sortTh('refs', '引用'), w: '58px', align: 'right', cls: 'num',
        render: f => f.refs.length
      }
    ], page, { rowId: f => f.id, activeId: st.sel && st.sel.id })
      + U.pager({ total: all.length, page: st.page, size: st.size });
  }

  /* 调阅记录直接读全站操作审计，不另存一份 —— 访问审计如果是第二份数据，就永远对不上 */
  const accessLogs = f => (M.auditLogs || []).filter(a => a.module === '证据存储' && a.target === f.id);

  function legacyDetail() {
    const f = st.sel;
    const stEl = document.getElementById('evSt');
    if (!f) { if (stEl) stEl.innerHTML = ''; return '<div class="empty">请选择证据文件</div>'; }
    if (stEl) stEl.innerHTML = U.tag(f.verifyState, VC[f.verifyState]) + ' ' + U.tag(f.status, SC[f.status]);
    const refs = M.evidenceRefs(f.id);
    const left = daysLeft(f), sane = retainSane(f);
    const logs = accessLogs(f);

    return `<div style="margin-bottom:10px"><b class="mono" style="font-size:14px">${f.id}</b>
        <div style="font-size:11.5px;color:var(--txt-2);margin-top:3px;word-break:break-all">${f.name}</div></div>

      ${U.sect('文件信息', U.kv([
      ['类型', U.tag(f.kind, 't-cyan')],
      ['格式 / 大小', `${f.ext.toUpperCase()} · ${f.sizeMB.toFixed(2)} MB`],
      ['存储方式', f.storage],
      ['产生者', `${f.srcKind === 'device' ? '设备' : f.srcKind === 'page' ? '页面' : '系统'} · ${f.srcName}
        ${f.srcKind === 'device' ? `<span class="mono lnk" data-ev-go="device|${f.srcId}">${f.srcId}</span>` : ''}`],
      /* 产生者与归属模块是两件事，必须分两行：357 份是设备拍的，但其中 249 份的归属模块是
         处置处罚管理（立案后按案件调取取证）。合成一行会让人以为"设备拍的就归融合感知"。 */
      ['归属模块', U.tag(f.srcModule, 't-blue')],
      /* originAction 是一句自然语言，说明"这份东西怎么来的"。台账的价值在于每份都说得清来源，
         没有这一行，一份证据就只是一个文件名 —— 无法判断它该不该在这里、是谁的责任。 */
      ['产生动作', `<span style="line-height:1.6">${f.originAction}</span>`],
      ['取证时刻', f.capturedAt],
      ['入库时刻', `${f.ingestAt}　<span style="color:var(--txt-3);font-size:11px">链路时延 ${Math.max(0, Math.round((new Date(f.ingestAt) - new Date(f.capturedAt)) / 1000))}s</span>`]
    ]))}

      ${U.sect('完整性校验', U.kv([
      ['算法', f.hashAlgo],
      ['哈希', `<span class="mono" style="font-size:11px;word-break:break-all">${f.hash}</span>`],
      ['上次校验', f.verifyAt],
      ['校验结果', U.tag(f.verifyState, VC[f.verifyState])]
    ]) + (isBad(f)
      ? `<div class="warnbox" style="border-color:rgba(255,77,94,.45);margin-top:8px;line-height:1.85">
           <b>处置流程</b><br>${f.verifyNote || '⚠ 未记录处置说明 —— 校验异常必须写明发现时间、处置流程与责任人'}</div>`
      : `<div style="font-size:11px;color:var(--txt-3);margin-top:6px;line-height:1.7">
           每 ${M.EVID_PARAMS.verifyCycleDays} 天全量比对一次入库哈希。校验只做比对与记录，
           <b>不会自动"修复"</b> —— 异常必须人工判定来源并留痕。</div>`))}

      ${U.sect('保管与留存', U.kv([
      ['留存期', f.retainYears + ' 年　<span class="tag t-amber">待业务方确认</span>'],
      ['到期日', `${f.retainUntil}${sane
        ? `　<span style="color:${left < 0 ? '#ff8b95' : left < 60 ? '#ffd07a' : 'var(--txt-3)'}">${left < 0 ? '已过期 ' + (-left) + ' 天' : '剩余 ' + left + ' 天'}</span>`
        : `　<span class="tag t-red" title="到期日早于取证时刻，该记录的时间线不成立">数据异常</span>`}`],
      ['保管状态', U.tag(f.status, SC[f.status])],
      ['法律冻结', f.legalHold
        ? `<span class="tag t-purple">冻结中</span> <span style="font-size:11.5px;color:var(--txt-3)">${f.holdReason || ''}</span>`
        : '<span class="tag t-gray">未冻结</span>']
    ]) + (sane ? '' : `<div class="warnbox" style="border-color:rgba(255,77,94,.45);margin-top:8px;line-height:1.8">
        <b>⚠ 该记录到期日（${f.retainUntil}）早于取证时刻（${f.capturedAt.slice(0, 10)}）</b>，时间线不成立。
        本页不替数据层修正这类矛盾 —— 兜住了就再也没人会发现它是错的。已登记给数据层修正。</div>`)
      + (f.status === '已销毁' ? U.kv([
        ['销毁时间', f.destroyAt], ['销毁执行人', f.destroyBy],
        ['销毁审批号', `<span class="mono">${f.destroyApproval}</span>`],
        ['销毁说明', f.destroyNote]
      ]) + `<div style="font-size:11px;color:var(--txt-3);margin-top:-6px;line-height:1.7">
          文件实体已销毁，<b>元数据与销毁记录永久保留</b> —— 台账里查得到"曾经有过、谁在何时依何审批销毁"。</div>` : ''))}

      ${U.sect(`被引用（${refs.length} 处）`, refs.length
      ? refs.map(r => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;
            border-bottom:1px solid rgba(64,158,255,.08);font-size:12px">
            <span class="tag t-gray" style="flex:none">${r.label}</span>
            <span class="mono ${r.exists ? 'lnk' : ''}" ${r.exists ? `data-ev-go="${r.kind}|${r.id}"` : ''}
              style="flex:none">${r.id}</span>
            <span style="flex:1;min-width:0;color:var(--txt-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name || ''}</span>
            ${r.exists ? '' : '<span class="tag t-red" title="引用指向的对象已不存在">悬空</span>'}
          </div>`).join('')
      : '<div style="color:var(--txt-3);font-size:12px">无引用 —— 孤儿证据，应核实来源后归档或清理</div>')
      + `<div style="font-size:11px;color:var(--txt-3);margin-top:6px;line-height:1.7">
          一份证据可同时被案件、告警、授权记录引用。点编号可直达对应页面并选中该条。</div>`}

      ${U.sect(`调阅记录（累计 ${f.accessCount} 次）`, logs.length
      ? logs.slice(0, 8).map(a => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;
            padding:4px 0;border-bottom:1px solid rgba(64,158,255,.08)">
            <span class="mono" style="color:var(--txt-3)">${a.time.slice(5)}</span>
            <span style="flex:1">${a.user}（${a.role}）· ${a.action}</span>
            <span class="mono" style="color:var(--txt-3)">${a.ip}</span></div>`).join('')
      : `<div style="color:var(--txt-3);font-size:12px">本会话内尚无调阅记录。
           历史累计 ${f.accessCount} 次，最近一次 ${f.lastAccessAt}。</div>`)}

      ${U.sect('操作', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn" data-evact="read">🔍 调阅（记入审计）</button>
        <button class="btn" data-evact="verify">✓ 立即校验</button>
        <button class="btn danger" data-evact="destroy" style="grid-column:span 2"
          ${f.status === '已销毁' ? 'disabled title="该文件已销毁"' : ''}>⛔ 申请销毁</button>
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--txt-3);line-height:1.8">
        本页<b>不提供下载与在线预览</b>：Demo 无真实文件，做一个点了没反应的下载按钮比明说没有更有害。
        正式环境下载须经审批并逐次记入调阅审计。</div>`)}`;
  }

  function detail() {
    const f = st.sel;
    if (!f) return '<div class="empty">请选择证据文件</div>';
    return '<div style="margin-bottom:10px">'
      + '<b class="mono" style="font-size:14px">' + f.id + '</b>'
      + '<div style="font-size:11.5px;color:var(--txt-2);margin-top:3px;word-break:break-all">' + f.name + '</div>'
      + '</div>'
      + U.sect('文件信息', U.kv([
        ['类型', U.tag(f.kind, 't-cyan')],
        ['格式 / 大小', f.ext.toUpperCase() + ' · ' + f.sizeMB.toFixed(2) + ' MB'],
        ['归属模块', U.tag(f.srcModule, 't-blue')],
        ['产生动作', '<span style="line-height:1.6">' + f.originAction + '</span>'],
        ['取证时刻', f.capturedAt],
        ['入库时刻', f.ingestAt]
      ]))
      + U.sect('操作', '<button class="btn pri" data-evact="download" '
        + 'style="width:100%;height:36px;justify-content:center">⭳ 下载</button>');
  }

  function paint() {
    document.getElementById('evList').innerHTML = list();
    document.getElementById('evDetail').innerHTML = detail();
  }

  function mount(view) {
    paint();
    /* 这里原本初始化底部四块（evMod 归档来源模块条形图 / evVerify 完整性校验环图 /
       evTrend 入库趋势 / evSize 存储占用），已随面板一并删除。
       moduleOf 与 MODULES() 保留 —— 台账的「来源模块」筛选器仍在用它们。
       台账列表与详情（含每行的来源说明）按要求原样保留。 */
    U.on(view, '[data-row]', 'click', (e, el) => {
      st.sel = M.evidenceFiles.find(f => f.id === el.dataset.row) || st.sel;
      U.selectRow(document.getElementById('evList'), el.dataset.row);
      document.getElementById('evDetail').innerHTML = detail();      // 只刷详情，不重建列表
    });
    U.on(view, '[data-pg]', 'click', (e, el) => { if (el.dataset.pg) { st.page = +el.dataset.pg; paint(); } });
    U.on(view, '[data-size]', 'change', (e, el) => { st.size = parseInt(el.value); st.page = 1; paint(); });
    U.on(view, '[data-f]', 'change', (e, el) => { st[el.dataset.f] = el.value; st.page = 1; paint(); });

    const doSort = key => {
      if (st.sort === key) st.dir = -st.dir;
      else { st.sort = key; st.dir = (key === 'captured' || key === 'size' || key === 'refs') ? -1 : 1; }
      st.page = 1; paint();
      const sc = document.querySelector('#evList .scroll');
      if (sc) sc.scrollTop = 0;
    };
    U.on(view, '[data-sort]', 'click', (e, el) => doSort(el.dataset.sort));
    U.on(view, '[data-sort]', 'keydown', (e, el) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSort(el.dataset.sort); }
    });

    /* 反向引用直达：复用 search.js 的深链表，不在这里重抄一份「哪类实体去哪个页面」 */
    U.on(view, '[data-ev-go]', 'click', (e, el) => {
      const [kind, id] = el.dataset.evGo.split('|');
      if (g.SEARCH && g.SEARCH.goEntity) g.SEARCH.goEntity(kind, id);
      else U.toast('检索模块未加载，无法直达', 'err');
    });

    U.on(view, '[data-evact]', 'click', (e, el) => {
      if (el.disabled) return;
      const k = el.dataset.evact;
      if (k === 'download') return doDownload();
      if (k === 'read') return doRead();
      if (k === 'verify') return doVerify();
      if (k === 'destroy') return destroyModal();
    });

    document.getElementById('evKw').oninput = e => { st.kw = e.target.value.trim(); st.page = 1; paint(); };
    document.getElementById('evBad').onchange = e => { st.onlyBad = e.target.checked; st.page = 1; paint(); };
  }

  const OPER = () => (M.users && M.users[0]) || { name: '值班员', roleName: '值班员' };

  function doDownload() {
    if (!st.sel) return;
    U.toast('已下载 ' + st.sel.name, 'ok');
  }

  /* 调阅：真实写全站操作审计并累加次数 —— 访问审计不是另一份数据 */
  function doRead() {
    const f = st.sel, u = OPER();
    f.accessCount++;
    f.lastAccessAt = M.util.fmtDT(M.CONF.demoTime);
    M.auditLogs.unshift({
      id: 'AU' + f.id.slice(-6) + M.util.p2(f.accessCount),
      time: f.lastAccessAt, user: u.name, role: u.roleName, module: '证据存储',
      action: `调阅证据（${f.kind}）`, target: f.id, result: '成功', ip: '10.20.6.31', term: '终端-01'
    });
    document.getElementById('evDetail').innerHTML = detail();
    U.toast(`已调阅 ${f.id}，本次调阅已记入操作审计`, 'ok');
  }

  /* 立即校验：只做比对与记录，异常不会自己变好 —— 一个点一下就转绿的校验按钮是假的 */
  function doVerify() {
    const f = st.sel;
    f.verifyAt = M.util.fmtDT(M.CONF.demoTime);
    document.getElementById('evDetail').innerHTML = detail();
    paint();
    U.toast(isBad(f)
      ? `已重新比对 ${f.id}：仍为「${f.verifyState}」。校验只比对不修复，须按处置流程人工闭环`
      : `已重新比对 ${f.id}：哈希与入库值一致，结果「完好」`, isBad(f) ? 'err' : 'ok');
  }

  /* 申请销毁：冻结与未到期两道闸门都要真拦，且拦截理由写清楚 */
  function destroyModal() {
    const f = st.sel, left = daysLeft(f);
    const blocks = [];
    if (f.legalHold) blocks.push(`该证据处于<b>法律冻结</b>状态：${f.holdReason || '关联案件未结案'}`);
    if (retainSane(f) && left > 0) blocks.push(`留存期未届满，尚余 <b>${left}</b> 天（到期日 ${f.retainUntil}）`);
    U.modal({
      title: '申请销毁证据 · ' + f.id, width: '620px',
      body: `<div class="warnbox">销毁是<b>不可逆</b>操作。依《证据保管办法》：留存期届满、关联案件已结案且无复核请求，
          经法制审批后方可销毁；<b>文件实体销毁后，元数据与销毁记录永久保留</b>，台账仍可查。</div>
        ${U.kv([
        ['证据编号', `<span class="mono">${f.id}</span>`],
        ['类型 / 大小', `${f.kind} · ${f.sizeMB.toFixed(2)} MB`],
        ['被引用', M.evidenceRefs(f.id).map(r => `${r.label} ${r.id}`).join('；') || '无'],
        ['留存到期', f.retainUntil + (retainSane(f) ? `（${left > 0 ? '尚余 ' + left + ' 天' : '已届满'}）` : '（数据异常：早于取证时刻）')],
        ['法律冻结', f.legalHold ? `<span class="tag t-purple">冻结中</span>` : `<span class="tag t-gray">未冻结</span>`]
      ])}
        ${blocks.length
          ? `<div class="warnbox" style="border-color:rgba(255,77,94,.45);margin-top:10px;line-height:1.9">
               <b>⛔ 不满足销毁条件，申请已拦截：</b><br>${blocks.map((b, i) => (i + 1) + '. ' + b).join('<br>')}</div>`
          : `${U.sect('审批信息', `${U.field('销毁审批号', `<input class="ip" data-fapp style="flex:1" placeholder="如 DEL-2026-0118">`)}
               <label class="chk"><input type="checkbox" data-c>我已确认该证据留存期届满、关联案件已结案且无复核请求，并知悉本次销毁不可逆、将永久记录审批号与执行人</label>`)}`}`,
      footer: blocks.length
        ? `<button class="btn" data-close>知道了</button>`
        : `<button class="btn" data-close>取消</button>
           <button class="btn danger" data-act="go" id="evDelGo" disabled>确认销毁</button>`,
      mounted: el => {
        const c = el.querySelector('[data-c]');
        if (c) c.onchange = () => { el.querySelector('#evDelGo').disabled = !c.checked; };
      },
      on: {
        go: el => {
          const app = (el.querySelector('[data-fapp]').value || '').trim();
          if (!app) return U.toast('必须填写销毁审批号 —— 没有审批号就无法回答"谁批准删的"', 'err');
          const u = OPER();
          f.status = '已销毁';
          f.destroyAt = M.util.fmtDT(M.CONF.demoTime);
          f.destroyBy = u.name + '（' + u.roleName + '）';
          f.destroyApproval = app;
          f.destroyNote = '留存期届满、关联案件已结案且无复核请求，经审批后销毁。元数据与销毁记录永久保留。';
          M.auditLogs.unshift({
            id: 'AUDEL' + f.id.slice(-6), time: f.destroyAt, user: u.name, role: u.roleName,
            module: '证据存储', action: `销毁证据（审批号 ${app}）`, target: f.id, result: '成功',
            ip: '10.20.6.31', term: '终端-01'
          });
          U.closeModal();
          g.APP.rerender();
          U.toast(`${f.id} 已销毁；元数据与销毁记录保留在台账中，可随时追溯`, 'ok');
        }
      }
    });
  }

  /* ===== COM-03 参数登记（模块加载时执行）===== */
  U.regParams({
    key: 'EVID', name: '证据留存与保管策略', page: '证据存储管理', hash: '#/evidence',
    ver: 'demo-v1', confirmed: false, owner: '法制 / 业务方',
    basis: '需求文档 COM-04 文件与证据存储；留存年限与冻结规则均为 Demo 缺省值',
    affects: ['证据到期判定', '销毁闸门', '完整性校验周期', '存储容量规划'],
    items: () => [
      { n: '默认留存期', v: M.EVID_PARAMS.retainYears + ' 年' },
      { n: '完整性校验周期', v: '每 ' + M.EVID_PARAMS.verifyCycleDays + ' 天全量比对' },
      { n: '未结案冻结', v: M.EVID_PARAMS.holdWhileOpen ? '开启（到期不清理）' : '关闭' },
      { n: '存储策略', v: M.EVID_PARAMS.storageDual ? '主存储 + 异地备份' : '仅主存储' },
      { n: '当前冻结份数', v: M.evidenceFiles.filter(f => f.legalHold).length + ' 份' },
      { n: '销毁前置条件', v: '留存届满 + 已结案 + 无复核请求 + 法制审批号' }
    ]
  });

  g.PAGES = g.PAGES || {};
  g.PAGES.evidence = { render, mount };
})(window);
