/* ===== 8. 接口管理 ===== */
(function (g) {
  const M = MOCK, U = UI, S = M.ifStats;
  let sel = M.interfaces[0], tab = 'detail', kw = '', fs = '全部状态', collapsed = {};

  /* ---- COM-03 参数总览登记（模块加载时执行）---- */
  U.regParams({
    key: 'C09_BASE', name: 'C09 一致性校验基线', page: '接口管理', hash: '#/apis',
    ver: 'demo-v2', confirmed: false, owner: '双方接口负责人',
    basis: '设计 §9.5 / 表9-6 四类问题；基线条目数随数据层演进而变',
    affects: ['一致性校验报告结论', 'A5 与 D4 的验收判据'],
    items: () => {
      const l = c09List(), a = ledgerAudit();
      return [
        { n: '基线条目数', v: l.length + ' 条' },
        { n: '阻断性问题', v: l.filter(x => x.block).length + ' 条（控制无回执）' },
        { n: '字段核对判据版本', v: 'v2（按接口类型分别适用：协议 / 数据层 / 平台内部产出）' },
        { n: '台账字段引用', v: `${a.data + a.proto + a.platform} 个（未命中 ${a.miss.length}）` },
        { n: '条目自动核销', v: '有客观判据的条目委托数据层断言实时核验，判不了返回「无法判定」' }
      ];
    }
  });
  U.regParams({
    key: 'API_LIMIT', name: '接口限流与重试策略', page: '接口管理', hash: '#/apis',
    ver: 'demo-v1', confirmed: false, owner: '平台运维 / 双方接口负责人',
    basis: '纪要 §8.1「控制类接口必须具备幂等、回执与急停」；具体数值为 Demo 缺省值',
    affects: ['限流设置页签', '重试策略页签', '控制类接口下发行为'],
    items: () => [
      { n: 'QPS 上限', v: '控制接口 5 / 其它 200' },
      { n: '并发上限', v: '控制接口 1 / 其它 64' },
      { n: '熔断阈值', v: '连续失败 5 次 / 10s，半开探测 30s' },
      { n: '重试策略', v: '控制类禁止自动重试；其它 3 次，1s / 2s / 4s 指数退避' },
      { n: '超时时间', v: '3000 ms' }
    ]
  });

  /* =========================================================================
   * B8-1 接口台账签字确认与冻结（D4 接口冻结凭据，会议纪要 §8.1）
   *
   * 冻结不是给台账盖个章就完事：冻结后「新增接口」被真实拦截，接口详情与列表
   * 显示冻结状态，冻结期内一旦登记破坏性变更，台账自动转为「待重新签字」，
   * 必须双方接口负责人重新签字才能恢复。签字人从 MOCK.users 取（平台侧 / 厂商
   * 驻场侧），不另造人名。
   * ====================================================================== */
  const SIGN_SIDES = [
    { side: '平台方接口负责人', pick: u => u.org.indexOf('设备厂商') < 0 && (u.roleName === '设备运维' || u.roleName === '超级管理员') },
    { side: '设备方接口负责人', pick: u => u.org.indexOf('设备厂商') >= 0 }
  ];
  const FREEZE_PROCESS = [
    '① 变更方在「接口版本与变更记录」中登记变更（类型 / 字段 / 说明 / 变更人）',
    '② 非破坏性变更：登记即生效，版本号 minor 递增，冻结状态不变',
    '③ 破坏性变更（删除字段 / 类型变更 / 可选改必填 / 字段重命名）：必须双方评审通过，版本号 major 递增',
    '④ 冻结期内出现破坏性变更 → 台账转「待重新签字」，双方接口负责人重新签字后恢复冻结',
    '⑤ 解冻需填写变更单号与原因，全过程记入冻结留痕'
  ];
  let ledgerVer = 'IF-LEDGER-v1.0';        // 台账版本（整批冻结时递增）
  let frzSeq = 0;                          // 冻结凭据流水号
  const frz = {};                          // 接口名 → { no, ver, at, signs:[], status, pending }
  const freezeLog = [];                    // 冻结/重新签字/解冻/破坏性变更 留痕

  const frzOf = i => frz[i.name] || null;
  function frzStat() {
    const l = M.interfaces.map(i => frz[i.name]).filter(Boolean);
    return {
      total: M.interfaces.length,
      frozen: l.filter(x => x.status === '已冻结').length,
      pending: l.filter(x => x.status === '待重新签字').length
    };
  }
  function frzTag(i) {
    const f = frzOf(i);
    return f ? U.tag(f.status, f.status === '已冻结' ? 't-green' : 't-red') : U.tag('未冻结', 't-gray');
  }
  function ledgerTag() {
    const t = frzStat();
    if (t.pending) return U.tag('待重新签字', 't-red');
    if (!t.frozen) return U.tag('未冻结', 't-gray');
    return U.tag(t.frozen === t.total ? '已冻结' : '部分冻结', t.frozen === t.total ? 't-green' : 't-amber');
  }
  function frzRecord(action, by, reason, detail, scope) {
    freezeLog.unshift({
      seq: freezeLog.length + 1, at: M.util.fmtDT(M.CONF.demoTime),
      action, by, reason, detail, scope: scope || '—', ver: ledgerVer
    });
    save();
  }

  /* =========================================================================
   * B8-2 接口版本与变更记录
   *
   * 每个接口的版本历史由该接口自身派生：当前版本取 MOCK.interfaces[].ver，
   * 历史版本沿版本号回溯，变更涉及的字段取自该接口真实的请求参数 Schema
   * （reqSchema），不凭空编字段名。CH.seeded 保证同一接口两次查看完全一致。
   * ====================================================================== */
  const CHANGE_KINDS = [
    { k: '新增字段', b: false }, { k: '枚举值扩充', b: false }, { k: '字段说明修订', b: false },
    { k: '字段重命名', b: true }, { k: '字段类型变更', b: true }, { k: '可选改必填', b: true }, { k: '删除字段', b: true }
  ];
  const isBreaking = k => (CHANGE_KINDS.find(c => c.k === k) || {}).b === true;
  const TYPES_POOL = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
  const OPS = M.users.filter(u => u.roleName === '设备运维' || u.roleName === '超级管理员');
  const REVIEWERS = M.users.filter(u => u.roleName === '超级管理员' || u.roleName === '处置授权人');

  /* 变更影响范围：依附录A（本页 LEDGER 页面—接口—字段映射台账）反查受影响页面与元素。
     查不到 → 该接口没有任何页面/控制/调测/统计/审计用途，本身就是 C09「页面未引用字段」。 */
  function impactOf(i, field) {
    /* 用子串匹配要小心:若某接口地址是另一个的前缀(如 /a/b 与 /a/bc),
       会把「已被页面引用」误判成真 —— 和 C09 里 track 含 ack 那个 bug 同一类,
       校验器自己出错比没有校验器更危险。这里要求命中处后面不再接路径字符。 */
    const PC = /[A-Za-z0-9_\/-]/;                 // 路径字符
    const hit = txt => {
      let k = txt.indexOf(i.url);
      while (k >= 0) {
        // 两侧都要是边界:只挡尾部只能防前缀型(/a/b 被 /a/b/c 命中),
        // 头部不挡则后缀/中段型照样漏(短地址 /b/c 命中长文本 /a/b/c)。
        const okBefore = k === 0 || !PC.test(txt.charAt(k - 1));
        const okAfter = !PC.test(txt.charAt(k + i.url.length));
        if (okBefore && okAfter) return true;
        k = txt.indexOf(i.url, k + 1);
      }
      return false;
    };
    const hits = LEDGER.filter(r => hit(r[2]));
    const fh = field ? hits.filter(r => r[3].split(',').some(f => f.trim() === field)) : [];
    return {
      pages: [...new Set(hits.map(r => r[0]))],
      elements: hits.map(r => r[0] + ' · ' + r[1]),
      fieldPages: [...new Set(fh.map(r => r[0]))]
    };
  }

  function fieldsOf(i) { const p = reqSchema(i).properties || {}; return Object.keys(p); }
  function typeOf(i, f) { const p = reqSchema(i).properties || {}; return (p[f] || {}).type || 'string'; }

  const verStore = {};
  function history(i) {
    if (verStore[i.name]) return verStore[i.name];
    const r = CH.seeded('ver:' + i.url), flds = fieldsOf(i);
    const minor = parseInt(i.ver.split('.')[1] || '0', 10);
    const out = [];
    for (let n = 0; n <= minor; n++) {
      const at = M.util.fmtDT(new Date(M.CONF.demoTime.getTime() - (minor - n) * r(6, 20) * 86400000 - r(0, 43200) * 1000));
      const by = OPS[r(0, OPS.length - 1)];
      if (n === 0) {
        out.push({
          ver: 'v1.0', at, by: by.name, org: by.org, status: minor === 0 ? '当前生效' : '历史',
          changes: [{ kind: '首次发布', field: flds.join(' / '), note: '接口首次发布，字段口径见「请求参数」', breaking: false }],
          review: null
        });
        continue;
      }
      const cnt = r(1, 2), items = [];
      for (let m = 0; m < cnt; m++) {
        const kd = CHANGE_KINDS[r(0, CHANGE_KINDS.length - 1)];
        const f = flds[r(0, flds.length - 1)];
        const tp = typeOf(i, f);
        items.push({
          kind: kd.k, field: f, breaking: kd.b,
          note: kd.k === '字段类型变更' ? TYPES_POOL[r(0, TYPES_POOL.length - 1)] + ' → ' + tp
            : kd.k === '可选改必填' ? '该字段由可选调整为必填'
              : kd.k === '删除字段' ? '字段下线，改由上级字段承载'
                : kd.k === '字段重命名' ? '命名对齐 Target Schema V1'
                  : kd.k === '枚举值扩充' ? '按设备协议补充取值'
                    : kd.k === '新增字段' ? '按设计方案补充该字段' : '仅修订字段说明，取值口径不变'
        });
      }
      const brk = items.some(x => x.breaking);
      const rv = REVIEWERS[r(0, REVIEWERS.length - 1)];
      out.push({
        ver: 'v1.' + n, at, by: by.name, org: by.org, status: n === minor ? '当前生效' : '历史',
        changes: items,
        review: brk ? { by: rv.name, at, result: '评审通过', note: '双方确认字段口径与错误码后放行' } : null
      });
    }
    out.reverse();
    verStore[i.name] = out;
    return out;
  }
  const brkCount = i => history(i).reduce((t, v) => t + v.changes.filter(c => c.breaking).length, 0);

  /* 数据源提示（B7 在设备管理页切换，这里只读展示，证明模式是全站生效的） */
  function dsChip() {
    const D = g.DATASOURCE;
    if (!D) return '';
    return `<span class="tag ${D.tagCls}" id="apDs" style="cursor:pointer"
      title="当前平台数据源模式（在「设备管理」页切换）">数据源：${D.name}${D.snapshot ? ' @ ' + D.snapshot : ''}</span>`;
  }

  const PAGE_MAP = [
    ['综合态势总览', '融合目标/告警/设备/空域', '必需'],
    ['融合感知中心', '三路目标、轨迹、融合置信度、反制授权', '必需'],
    ['飞行活动管理', '飞行计划、无人机与飞手身份', '必需'],
    ['合法性判定', '计划匹配 + 空域规则 + 违规原因', '必需'],
    /* 「空域与航线」页已删除。空域规则本身仍在（判定引擎与航线态势都在用），
       但它不再有独立页面，故从「页面—接口」台账里去掉这一行 ——
       台账列的是页面对接口的需求，页面没了这条需求就不存在了。 */
    ['异常告警中心', '告警、去重升级、处置指令', '必需'],
    ['空间安全风险', '非无人机目标、距最近航线走廊', '必需'],
    ['处置处罚管理', '反制、公安干扰授权、处罚文书', '必需'],
    ['设备接入调测', '设备协议、云台控制、调测回执', '必需'],
    ['接口管理', '全部接口元数据与调用日志', '必需']
  ];

  function rows() {
    return M.interfaces.filter(i =>
      (fs === '全部状态' || i.status === fs) &&
      (!kw || i.name.includes(kw) || i.url.includes(kw)));
  }

  function render() {
    return `${U.kpis([
      { label: '接口总数', value: U.num(S.total), color: 'blue', icon: 'api', desc: `${new Set(M.interfaces.map(i => i.group)).size} 个分组` },
      { label: '正常接口', value: U.num(S.ok), color: 'green', icon: 'check', desc: `占比 ${U.pct(S.ok, S.total)}` },
      { label: '异常接口', value: U.num(S.abn), color: 'red', icon: 'alert', desc: `需排查` },
      { label: '今日调用次数', value: U.num(S.calls), color: 'cyan', icon: 'chart', desc: `失败 ${U.num(S.fail)} 次` },
      { label: '平均响应时间', value: S.avgRt, unit: 'ms', color: 'purple', icon: 'mon', desc: `较昨日 ${U.delta(-8.5, { lowerBetter: true })}` },
      { label: 'Mock 占位接口', value: U.num(S.mocked), color: 'amber', icon: 'tool', desc: `正式接口到位后替换 Adapter` }
    ])}

    <div class="row" style="margin-top:12px;height:calc(100vh - 454px);min-height:438px">
      ${U.panel({
      title: false, style: 'flex:1.55', nopad: true,
      body: `<div class="toolbar">
          <button class="btn pri" id="apAdd">＋ 新增接口</button>
          <button class="btn" id="apTest">🔗 联调测试</button>
          <button class="btn" id="apDoc">📄 查看文档</button>
          <button class="btn" id="apExp">⭳ 导出配置</button>
          <button class="btn" id="apLedger">▤ 字段映射台账</button>
          <button class="btn" id="apVer">⛃ 版本与冻结</button>
          <button class="btn warn" id="apCheck">✓ 接口一致性校验</button>
          ${canSeeSelfCheck() ? `<button class="btn warn" id="apSelf">✓ 数据一致性自检</button>` : ''}
          <span style="flex:1"></span>
          ${dsChip()}
          <input class="ip" id="apKw" style="width:190px" placeholder="请输入接口名称或地址搜索">
          ${U.select('st', ['全部状态', '正常', '异常'], fs)}
        </div>
        <div id="apFrz">${frzBar()}</div>
        <div id="apList" style="flex:1;overflow:auto;min-height:0"></div>`
    })}
      ${U.panel({
      title: '<span id="apTitle"></span>', style: 'width:430px', nopad: true,
      extra: `<span id="apSt"></span>`,
      body: `<div class="tabs" style="padding:0 12px">${[['detail', '接口详情'], ['log', '调用日志'], ['limit', '限流设置'], ['retry', '重试策略']]
        .map(([k, t]) => `<span class="tab ${tab === k ? 'on' : ''}" data-at="${k}">${t}</span>`).join('')}</div>
        <div id="apDetail" style="flex:1;overflow:auto;padding:12px"></div>`
    })}
    </div>

    <div class="row" style="height:218px;margin-top:12px;padding-bottom:12px">
      ${U.panel({
      title: '接口调用趋势', sub: '近 7 天', style: 'flex:1.6',
      extra: U.select('gran', ['按天', '按小时']),
      body: `<div id="apTrend" style="height:100%"></div>`
    })}
      ${U.panel({ title: '接口成功率分布', style: 'flex:1', body: `<div id="apDist" style="height:100%"></div>` })}
      ${U.panel({
      title: '调用失败 TOP5 接口', sub: '今日', style: 'width:320px',
      body: `<div id="apFail" style="height:100%"></div>`
    })}
    </div>`;
  }

  /* 冻结状态条：不打开弹窗也能一眼看到「冻了几个、谁签的、什么时候、哪个版本」 */
  function frzBar() {
    const t = frzStat();
    const c = t.pending ? '#ff4d5e' : t.frozen === t.total && t.frozen ? '#2fd06e' : t.frozen ? '#ffb020' : '#6c86ad';
    const last = freezeLog.find(x => x.action === '签字冻结' || x.action === '重新签字');
    const info = t.pending
      ? `<span style="color:#ff96a0">${t.pending} 个接口因破坏性变更待重新签字</span> —— 须双方接口负责人重新签字后恢复冻结`
      : t.frozen
        ? `已冻结 <b>${t.frozen}/${t.total}</b> 个接口 · 台账版本 <span class="mono">${ledgerVer}</span>` +
        (last ? ` · 最近签字 ${last.by} · ${last.at}` : '')
        : `台账版本 <span class="mono">${ledgerVer}</span> · 共 ${S.total} 个接口 / ${new Set(M.interfaces.map(i => i.group)).size} 个分组
           · D4 需接口负责人签字确认后冻结`;
    return `<div style="display:flex;align-items:center;gap:9px;padding:6px 12px;font-size:12px;
        border-bottom:1px solid var(--line-2);background:${c}12;flex-wrap:wrap">
      <span>${t.pending ? '⚠' : t.frozen ? '🔒' : '🔓'}</span>
      ${ledgerTag()}
      <span style="color:var(--txt-3)">${info}</span>
      <span style="flex:1;min-width:8px"></span>
      <span class="lnk" id="apFrzOne">${!frzOf(sel) ? '对「' + sel.name + '」签字冻结 ›'
        : frzOf(sel).status === '待重新签字' ? '「' + sel.name + '」重新签字 ›' : '当前接口冻结凭据 ›'}</span>
      <span class="lnk" id="apFrzOpen">版本与冻结总览 ›</span>
    </div>`;
  }

  function list() {
    const all = rows();
    const groups = [...new Set(all.map(i => i.group))];
    return groups.map(gr => {
      const g2 = all.filter(i => i.group === gr);
      const open = !collapsed[gr];
      return `<div style="padding:7px 12px;background:rgba(61,139,255,.08);border-bottom:1px solid var(--line-2);
          cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:8px" data-grp="${gr}">
          <span>${open ? '▾' : '▸'}</span><b>${gr}</b><span style="color:var(--txt-3)">(${g2.length})</span>
          ${g2.some(i => i.status === '异常') ? U.tag('含异常', 't-red') : ''}
        </div>
        ${open ? `<table class="tb" style="margin-bottom:0"><tbody>
          ${g2.map(i => `<tr data-if="${i.name}" class="${sel.name === i.name ? 'on' : ''}">
            <td style="width:150px"><div title="${i.name}" style="white-space:normal;line-height:1.4">${i.name}</div></td>
            <td style="width:84px">${U.tag(i.kind, 't-blue')}</td>
            <td style="width:60px" class="num">${i.method}</td>
            <td class="num" style="font-size:11px"><div title="${i.url}" style="white-space:normal;line-height:1.4;word-break:break-all">${i.url}</div></td>
            <td style="width:78px"><div style="white-space:normal;line-height:1.4;font-size:11.5px">${i.auth}</div></td>
            <td style="width:70px">${U.tag(i.status)}${frzOf(i)
              ? (frzOf(i).status === '已冻结'
                ? ' <span title="已冻结 ' + frzOf(i).no + ' · 冻结版本 ' + frzOf(i).ver + ' · ' + frzOf(i).signs.map(x => x.name).join('/') + ' ' + frzOf(i).at + '">🔒</span>'
                : ' <span title="' + frzOf(i).pending + '">⚠</span>') : ''}</td>
            <td style="width:66px" class="num">${i.rate}%</td>
            <td style="width:96px" class="num" style="font-size:11px">
              <div>${String(i.last).slice(0, 10)}</div>
              <div style="font-size:11px;color:var(--txt-3)">${String(i.last).slice(11, 16)}</div></td>
            <td style="width:112px"><span class="lnk" data-ifop="test|${i.name}">测试</span>
              <span class="lnk" data-ifop="doc|${i.name}">文档</span>
              <span class="lnk" data-ifop="ver|${i.name}">版本</span></td></tr>`).join('')}
        </tbody></table>` : ''}`;
    }).join('') + `<div style="padding:8px 12px;color:var(--txt-3);font-size:12px;border-top:1px solid var(--line-2)">
      共 ${groups.length} 组 ${all.length} 条（接口总数 ${S.total}，当前筛选 ${all.length}）</div>`;
  }

  function detail() {
    const i = sel;
    document.getElementById('apTitle').textContent = i.name;
    document.getElementById('apSt').innerHTML = U.tag(i.status) + (i.mock ? ' ' + U.tag('Mock', 't-amber') : '');
    if (tab === 'detail') {
      return U.kv([['接口分组', i.group], ['接口类型', i.kind], ['请求方式', i.method],
      ['接口地址', `<span class="mono">${i.url}</span>`], ['鉴权方式', i.auth],
      ['接口版本', `<b class="mono">${i.ver}</b>　<span class="lnk" data-verlink>变更记录 (${history(i).length}) ›</span>`
        + (brkCount(i) ? `　${U.tag('破坏性变更 ' + brkCount(i) + ' 次', 't-red')}` : '')],
      ['冻结状态', frzTag(i) + (frzOf(i)
        ? ` <span class="mono" style="font-size:11.5px;color:var(--txt-3)">${frzOf(i).no}</span>` : '')
        + `　<span class="lnk" data-signlink>${!frzOf(i) ? '签字冻结 ›'
          : frzOf(i).status === '待重新签字' ? '重新签字 ›' : '冻结凭据 ›'}</span>`],
      ...(frzOf(i) ? [
        ['冻结版本', `<b class="mono">${frzOf(i).ver}</b>${frzOf(i).ver !== i.ver ? `　<span class="tag t-amber">当前 ${i.ver}，已偏离冻结版本</span>` : ''}`],
        ['签字人', frzOf(i).signs.map(x => `${x.side}：<b>${x.name}</b>（${x.org}）`).join('<br>')],
        ['签字时间', frzOf(i).at],
        ...(frzOf(i).pending ? [['待办', `<span style="color:#ff96a0">${frzOf(i).pending}</span>`]] : [])
      ] : []),
      ['来源系统', i.src], ['责任方', i.owner],
      ['当前状态', U.tag(i.status)], ['今日调用', U.num(i.calls) + ' 次'], ['成功率', i.rate + '%'],
      ['平均响应', i.rt + ' ms'], ['最近调用', i.last],
      ['实现方式', i.mock ? '<span class="tag t-amber">Mock（待替换为正式接口）</span>' : '<span class="tag t-green">正式接口</span>']])
        + U.sect('请求参数', `<pre class="code">${JSON.stringify(reqSchema(i), null, 2)}</pre>`)
        + U.sect('响应示例', `<pre class="code">${JSON.stringify(resSample(i), null, 2)}</pre>`);
    }
    if (tab === 'log') {
      const rr = CH.seeded(i.url);           // 确定性:同一接口的日志两次查看一致
      const logs = Array.from({ length: 12 }, (_, k) => {
        const bad = k === 3 && i.status === '异常';
        return {
          t: M.util.fmtDT(new Date(M.CONF.demoTime.getTime() - k * rr(40, 400) * 1000)),
          code: bad ? 500 : 200, rt: bad ? rr(400, 900) : rr(20, 200), op: '系统服务'
        };
      });
      return U.table([
        { t: '时间', k: 't', cls: 'num' },
        { t: '状态码', w: '68px', render: r => `<span style="color:${r.code === 200 ? '#79e5a5' : '#ff8b95'}">${r.code}</span>` },
        { t: '响应时间', w: '86px', cls: 'num', render: r => r.rt + 'ms' },
        { t: '操作人', k: 'op', w: '80px' }
      ], logs);
    }
    if (tab === 'limit') {
      return `<div class="warnbox">限流与熔断保护上游系统；反制/干扰类<b>控制接口不做自动重试</b>，避免重复下发指令。</div>` +
        U.kv([['QPS 上限', i.kind === '控制接口' ? '5' : '200'], ['并发上限', i.kind === '控制接口' ? '1' : '64'],
        ['熔断阈值', '连续失败 5 次 / 10s'], ['熔断恢复', '半开探测 30s'],
        ['降级策略', i.mock ? '使用 Mock 数据兜底' : '返回上次成功缓存'],
        ['白名单', '上级管控平台、公安专网']]);
    }
    return `<div class="warnbox">依据 §8.1：控制类接口必须具备<b>幂等、回执与急停</b>；重试仅对查询/数据类接口开启。</div>` +
      U.kv([['是否重试', i.kind === '控制接口' ? '<span class="tag t-red">否（控制类禁止自动重试）</span>' : '<span class="tag t-green">是</span>'],
      ['重试次数', i.kind === '控制接口' ? '—' : '3'], ['重试间隔', i.kind === '控制接口' ? '—' : '1s / 2s / 4s（指数退避）'],
      ['幂等键', i.kind === '控制接口' ? 'taskId + authCode' : 'requestId'],
      ['超时时间', '3000 ms'], ['失败告警', '连续失败 3 次触发运维告警']]);
  }

  function reqSchema(i) {
    if (i.url.includes('counter') || i.url.includes('jam')) {
      return { type: 'object', required: ['taskId', 'targetId', 'authCode', 'operator'], properties: { taskId: { type: 'string', desc: '任务ID（幂等键）' }, targetId: { type: 'string', desc: '目标ID' }, authCode: { type: 'string', desc: '授权编号' }, operator: { type: 'string', desc: '操作人' }, range: { type: 'object', desc: '作用范围' }, duration: { type: 'integer', desc: '时长(秒)' } } };
    }
    if (i.url.includes('flight/plan')) {
      return { type: 'object', required: ['planId', 'droneId', 'operator'], properties: { planId: { type: 'string', desc: '飞行计划ID' }, droneId: { type: 'string', desc: '无人机ID' }, operator: { type: 'string', desc: '操作人' }, takeoffPoint: { type: 'object', desc: '起飞点' }, route: { type: 'array', desc: '航线点集合' } } };
    }
    return { type: 'object', required: ['targetId', 'eventTime'], properties: { targetId: { type: 'string', desc: '平台统一目标ID' }, eventTime: { type: 'string', desc: '设备时间(ISO8601)' }, longitude: { type: 'number' }, latitude: { type: 'number' }, altitude: { type: 'number', desc: '椭球高(m)' }, sourceType: { type: 'string', desc: '来源：BOX/TDOA/5GA' }, confidence: { type: 'number' } } };
  }
  function resSample(i) {
    return { code: 200, message: 'success', data: { requestId: 'REQ' + (100000 + (i.url.length * 7919) % 900000), status: 'received', serverTime: '2026-08-26T10:24:36+08:00' } };
  }

  function paint() {
    const f = document.getElementById('apFrz');
    if (f) { f.innerHTML = frzBar(); bindFrz(); }
    document.getElementById('apList').innerHTML = list();
    document.getElementById('apDetail').innerHTML = detail();
  }
  function bindFrz() {
    const b = document.getElementById('apFrzOpen');
    if (b) b.onclick = freezeModal;
    const o = document.getElementById('apFrzOne');
    if (o) o.onclick = () => signModal(sel);
  }

  function mount(view) {
    paint();
    CH.line(document.getElementById('apTrend'), {
      x: Array.from({ length: 7 }, (_, i) => M.util.fmtD(M.util.dayAdd(M.CONF.demoTime, i - 6)).slice(5)),
      yName: '次数', y2: '成功率%', yScale: true,
      series: [
        { name: '调用次数', data: Array.from({ length: 7 }, (_, i) => Math.round(S.calls * (.82 + i * .03))), color: CH.C.blue, area: true },
        { name: '成功率', data: Array.from({ length: 7 }, (_, i) => +(100 - S.failRate + [-.3, .2, -.1, .4, -.2, .1, 0][i]).toFixed(2)), color: CH.C.green, yAxisIndex: 1 }
      ]
    });
    CH.donut(document.getElementById('apDist'), { data: S.dist, center: ['32%', '50%'] });
    const failTop = [...M.interfaces].sort((a, b) => b.fail - a.fail).slice(0, 5);
    CH.hbar(document.getElementById('apFail'), {
      y: failTop.map(i => i.name), data: failTop.map(i => i.fail),
      colors: failTop.map(i => i.status === '异常' ? '#ff4d5e' : '#ffb020')
    });

    U.on(view, '[data-grp]', 'click', (e, el) => { collapsed[el.dataset.grp] = !collapsed[el.dataset.grp]; document.getElementById('apList').innerHTML = list(); });
    U.on(view, '[data-if]', 'click', (e, el) => {
      sel = M.interfaces.find(i => i.name === el.dataset.if);
      U.selectRow(document.getElementById('apList'), el.dataset.if, 'data-if');
      document.getElementById('apDetail').innerHTML = detail();
    });
    U.on(view, '[data-at]', 'click', (e, el) => {
      tab = el.dataset.at;
      view.querySelectorAll('[data-at]').forEach(x => x.classList.toggle('on', x === el));
      document.getElementById('apDetail').innerHTML = detail();
    });
    U.on(view, '[data-ifop]', 'click', (e, el) => {
      e.stopPropagation();
      const [op, n] = el.dataset.ifop.split('|');
      sel = M.interfaces.find(i => i.name === n);
      if (op === 'test') testModal();
      else if (op === 'doc') { tab = 'detail'; paint(); U.toast('已在右侧展示「' + n + '」的参数与响应示例'); }
      else verModal(sel);
    });
    document.getElementById('apKw').oninput = e => { kw = e.target.value.trim(); document.getElementById('apList').innerHTML = list(); };
    U.on(view, '[data-f="st"]', 'change', (e, el) => { fs = el.value; document.getElementById('apList').innerHTML = list(); });
    document.getElementById('apAdd').onclick = () => {
      const t = frzStat();
      if (t.frozen === t.total && t.total) return U.toast(`接口台账已整批冻结（${ledgerVer}，${t.frozen}/${t.total} 个接口），
        新增接口属台账变更：须先在「版本与冻结」中提交变更并由双方评审，或解冻后再操作。`, 'err');
      if (t.frozen) return U.toast(`已有 ${t.frozen}/${t.total} 个接口冻结，新增接口需在「版本与冻结」中登记并同步映射台账（§8.2）。`, 'err');
      U.toast('新增接口需登记：协议、鉴权、字段、错误码、样例报文（§8.1）');
    };
    document.getElementById('apTest').onclick = testModal;
    document.getElementById('apDoc').onclick = () => U.toast('接口文档（OpenAPI 3.0）已在新窗口打开（Demo）');
    document.getElementById('apExp').onclick = () => U.toast('已导出「接口总表.xlsx」共 ' + S.total + ' 条', 'ok');
    document.getElementById('apCheck').onclick = checkModal;
    const sf = document.getElementById('apSelf');
    if (sf) sf.onclick = selfCheckModal;
    document.getElementById('apLedger').onclick = ledgerModal;
    document.getElementById('apVer').onclick = freezeModal;
    U.on(view, '[data-verlink]', 'click', () => verModal(sel));
    U.on(view, '[data-signlink]', 'click', () => signModal(sel));
    const ds = document.getElementById('apDs');
    if (ds) ds.onclick = () => location.hash = '#/devices';
    bindFrz();
  }

  function testModal() {
    const i = sel;
    U.modal({
      title: '联调测试 · ' + i.name, width: '680px',
      body: `${U.kv([['请求方式', i.method], ['接口地址', `<span class="mono">${i.url}</span>`], ['鉴权', i.auth]])}
        <div style="margin-top:10px;font-size:12.5px;color:var(--txt-2);margin-bottom:5px">请求体</div>
        <pre class="code" style="max-height:150px">${JSON.stringify(reqSchema(i).properties && Object.keys(reqSchema(i).properties).reduce((o, k) => (o[k] = '<' + k + '>', o), {}), null, 2)}</pre>
        <div style="margin-top:10px;font-size:12.5px;color:var(--txt-2);margin-bottom:5px">响应</div>
        <pre class="code" id="apRes" style="max-height:150px">// 点击「发送请求」</pre>`,
      footer: `<button class="btn" data-close>关闭</button><button class="btn pri" data-act="send">发送请求</button>`,
      on: {
        send: el => {
          el.querySelector('#apRes').textContent = '// 200 OK · ' + M.util.ri(20, 180) + 'ms\n' + JSON.stringify(resSample(i), null, 2);
          U.toast('请求成功（Demo Mock 响应）', 'ok');
        }
      }
    });
  }

  /* F1003:页面—接口—字段映射台账(每个页面元素↔接口字段,支持按接口/字段反查) */
  const LEDGER = [
    ['综合态势总览', '今日感知目标数 KPI', '/api/v1/target/report', 'target_id,event_time', '统计'],
    ['综合态势总览', '区域态势图目标点', 'ws://5ga/track/push 等三路', 'longitude,latitude,altitude', '显示'],
    ['综合态势总览', '告警事件列表', '平台告警服务', 'id,level,status', '显示'],
    ['融合感知中心', '五源融合卡-雷达', 'tcp://box/radar/track', 'objectId,speedX,speedY,speedZ,rcs,probability', '显示'],
    ['融合感知中心', '五源融合卡-光电', '/api/v1/eo/detect/result', 'objectType,probability,bbox', '显示'],
    ['融合感知中心', '五源融合卡-TDOA', 'ws://tdoa/target/push', 'longitude,latitude,pilotLon,pilotLat', '显示'],
    ['融合感知中心', '光电实时视频', '/api/v1/eo/stream', 'mediaPullStream,mediaAiPullStream', '显示'],
    ['融合感知中心', '云台方向/点动按钮', '/api/v1/ptz/control', 'panOrientAngle,tiltOrientAngle', '控制'],
    ['融合感知中心', '云台状态区', '/api/v1/ptz/status', 'panOrientAngle,tiltOrientAngle,focalLen,hfov,vfov', '显示'],
    ['融合感知中心', '跟踪任务下发', '/api/v1/ptz/control', 'event,bootstrapSourceId,bootstrapSourceType', '控制'],
    ['融合感知中心', '反制授权弹窗-下发', '/api/v1/counter/task/send', 'taskId,targetId,authCode,range', '控制'],
    ['融合感知中心', '执行监视-回执格', '/api/v1/counter/task/ack', 'taskId,status,result', '显示'],
    ['融合感知中心', '急停按钮', '/api/v1/counter/task/stop', 'taskId,authCode,reason', '控制'],
    ['飞行活动管理', '计划列表', '/api/v1/flight/plan/list', 'id,droneId,pilot,route', '显示'],
    ['飞行活动管理', '计划—感知匹配', '平台规则引擎 C01', 'matched_plan_id,legal_status', '显示'],
    ['合法性判定', '判定过程 C02 行', '/api/v1/airspace/query', 'id,limit,poly', '显示'],
    ['合法性判定', '转处置立案按钮', '/api/v1/violation/report', 'target_id,violation,evidence', '控制'],
    /* 空域绘制/编辑入口已随页面删除。这行原本就是本台账里唯一的空域**写**接口，
       而接口清单中空域只有 GET /api/v1/airspace/query（无写接口）——
       删掉它同时消掉了一处早先的口径不一致。 */
    ['异常告警中心', '批量处置按钮', '平台处置服务', 'alarm_ids,action,operator', '控制'],
    ['空间安全风险', '航线影响评估', '平台风险引擎 RISK-route-v1', 'nearestRouteId,nearestRouteKm,altOverlap', '显示'],
    ['处置处罚管理', '公安干扰授权表单', '/api/v1/jam/auth/verify', 'approvalNo,unit,band,range,duration', '控制'],
    ['处置处罚管理', '干扰启停/急停', '/api/v1/jam/control', 'action,taskId,authCode', '控制'],
    ['处置处罚管理', '授权记录表', '/api/v1/jam/audit/report', 'id,operator,estop,audit', '审计'],
    ['处置处罚管理', '处罚文书预览/下载', '/api/v1/punish/doc/generate', 'docNo,caseId,penalty', '显示'],
    ['设备接入调测', '参数配置表单', '设备协议(§8.1)', 'ip,port,proto,auth,report_cycle', '调测'],
    ['设备接入调测', '坐标校准区', '设备协议(§8.1)', 'coordinate_system,offset_lon/lat/alt', '调测'],
    ['设备实时监测', '资源/链路图表', '设备心跳上报', 'cpu,mem,latency,loss,rssi', '统计'],
    ['接口管理', '调用日志页签', '网关访问日志', 'code,rt,operator', '审计'],
    ['日志归档', '完整日志内容', '统一数据模型(§9)', 'type,target,deviceName,summary', '审计'],
    ['用户与权限', '操作审计表', '平台审计服务', 'user,module,action,result,ip', '审计']
  ];
  /* =========================================================================
   * 台账字段核对（A5 验收点：台账写的字段名必须与 mock.js 真实字段一一对上）
   *
   * 做成页面里可重复执行的检查，而不是一次性人工审 —— A5 之后数据层还会变，
   * 人工审的结论会过期，页面里的检查不会。
   *
   * 三分类而不是二分类：台账里本来就有一部分字段只存在于**接口层**
   * （控制指令参数、报文字段），它们不落在 MOCK 数据上是正常的。
   * 把它们和"名字写错了"混为一谈，会让核对结果永远是红的，红久了就没人看。
   * ====================================================================== */
  /* 字段名核对分三类，判据按**行**而不是按字段全局套用：
     设备协议类接口的字段必须能在三份协议原文里找到；平台自有接口的字段则应落在 MOCK 数据上。
     把两者混在一起判，会把 legal_status / caseId / cpu 这些平台字段全判成"协议里没有"，
     一次报 50 多条红 —— 红久了就没人看，等于没有检查。

     协议真名取自（逐条 grep 原文核实，不抄二手结论）：
       uav.txt   《设备数据及感知数据接入协议 v8.6》：objectId/objectType/probability/
                 longitude/latitude/altitude/speedX,Y,Z/rcs/length/width/height/uavSN/
                 deviceId/deviceType/detectionRange/pilotLon/pilotLat/mediaPullStream/mediaAiPullStream
       eo.txt    《光电设备边端协同接口》：panOrientAngle/tiltOrientAngle/focalLen/hfov/vfov/
                 bootstrapSourceId/bootstrapSourceType/event(BeginTracking|EndTracking)
       proto.txt 《探测反制设备控制协议 V2.4》：deviceId/targetId/duration/code/msg
     注：mediaPullStream / mediaAiPullStream 在 uav.txt 而非 eo.txt。 */
  const PROTO_FIELD = new Set([
    'objectId', 'objectType', 'probability', 'longitude', 'latitude', 'altitude',
    'speedX', 'speedY', 'speedZ', 'rcs', 'length', 'width', 'height',
    'uavSN', 'deviceId', 'deviceType', 'detectionRange', 'pilotLon', 'pilotLat',
    'mediaPullStream', 'mediaAiPullStream',
    'panOrientAngle', 'tiltOrientAngle', 'focalLen', 'hfov', 'vfov',
    'bootstrapSourceId', 'bootstrapSourceType', 'event',
    'targetId', 'duration', 'code', 'msg'
  ]);
  /* 协议里确实没有、由平台产出或属部署配置的字段 —— 不是错，但必须与协议字段区分开，
     否则设备方会以为这些要他们提供。 */
  const PLATFORM_FIELD = new Set([
    'bbox',                                             // 光电目标框：平台侧渲染用，协议未定义
    'ip', 'port', 'proto', 'auth', 'report_cycle',      // 接入部署配置
    'coordinate_system', 'offset_lon/lat/alt',          // 坐标校准参数
    'cpu', 'mem', 'latency', 'loss', 'rssi',            // 心跳运维指标
    'taskId', 'authCode', 'action', 'reason', 'priority', 'task_type', 'direction',
    'angle', 'alarm_ids', 'approvalNo', 'range', 'operator'   // 授权闭环字段（纪要 §6.3 我方要求）
  ]);
  /* 设备协议类接口：这些行的字段名必须对得上协议原文 */
  const isProtoIface = url => /^(tcp:\/\/box|ws:\/\/tdoa|ws:\/\/5ga|\/api\/v1\/eo\/|\/api\/v1\/ptz\/)/.test(url)
    || url.indexOf('设备协议') >= 0 || url.indexOf('设备心跳') >= 0;

  function realFields() {
    const set = new Set();
    ['allTargets', 'devices', 'airspaces', 'flightPlans', 'alarms', 'cases', 'logs',
      'authLogs', 'users', 'auditLogs', 'interfaces', 'riskEvents', 'commTasks'].forEach(k => {
        const arr = M[k];
        if (Array.isArray(arr) && arr[0]) Object.keys(arr[0]).forEach(f => set.add(f));
      });
    return set;
  }
  function fieldKind(f, iface) {
    if (isProtoIface(iface || '')) {
      if (PROTO_FIELD.has(f)) return 'proto';
      if (PLATFORM_FIELD.has(f)) return 'platform';
      return 'miss';
    }
    if (realFields().has(f)) return 'data';
    if (PLATFORM_FIELD.has(f) || PROTO_FIELD.has(f)) return 'platform';
    return 'miss';
  }
  function ledgerAudit() {
    const out = { data: 0, proto: 0, platform: 0, miss: [] };
    LEDGER.forEach(r => r[3].split(',').map(x => x.trim()).filter(Boolean).forEach(f => {
      const k = fieldKind(f, r[2]);
      if (k === 'miss') out.miss.push({ page: r[0], elem: r[1], f });
      else out[k]++;
    }));
    return out;
  }
  const FK_STYLE = {
    data: 'color:#79e5a5', proto: 'color:#22d3ee', platform: 'color:#8fbaff',
    miss: 'color:#ff8b95;text-decoration:underline wavy rgba(255,77,94,.7)'
  };
  const FK_TITLE = {
    data: '平台数据层字段：在 mock.js 的数据集上真实存在',
    proto: '设备协议字段：在三份协议原文中逐条 grep 核实存在',
    platform: '平台内部产出 / 部署配置：协议里没有，由平台侧产生 —— 不需要设备方提供',
    miss: '未命中：协议原文与平台数据集里都没有这个名字 —— 台账写错了，D4 冻结前必须清掉'
  };

  /* ---------------------------------------------------------------------
   * 台账核对的提取面（D4 冻结后由 tools/ 侧核对工具取用）
   *
   * 暴露的是**声明与判据函数本身**，不是结论快照 —— 工具调同一个 ledgerAudit()，
   * 而不是在 node 侧再写一套分类逻辑。理由同 tools/tilecheck.js 从 map.js 读 B 常量：
   * 抄一份就有两份定义，两份一旦漂移，先绿的那份会掩盖后红的那份。
   *
   * 现在不接：LEDGER 的分类逻辑还在随台账核对演进，此时固化提取器会让每次改动落在两处。
   * D4 冻结、台账不再变之后再接 —— 那时它核对的才是一份稳定的签字对象。
   * ------------------------------------------------------------------ */
  g.LEDGER_EXPORT = function () {
    return {
      rows: LEDGER.map(r => ({
        page: r[0], element: r[1], iface: r[2],
        fields: r[3].split(',').map(x => x.trim()).filter(Boolean), usage: r[4]
      })),
      protoFields: [...PROTO_FIELD],
      platformFields: [...PLATFORM_FIELD],
      isProtoIface: isProtoIface,     // 判据函数本体，工具直接调
      fieldKind: fieldKind,
      audit: ledgerAudit               // 同一个实现，不另写
    };
  };

  function ledgerModal() {
    let kw2 = '', pg = '全部页面';
    const pages = ['全部页面', ...new Set(LEDGER.map(r => r[0]))];
    const UC = { '显示': 't-blue', '控制': 't-red', '统计': 't-cyan', '审计': 't-green', '调测': 't-amber' };
    function rows() {
      return LEDGER.filter(r => (pg === '全部页面' || r[0] === pg) &&
        (!kw2 || r.some(c => c.toLowerCase().includes(kw2.toLowerCase()))));
    }
    function tbl() {
      const list = rows();
      return U.table([
        { t: '页面', w: '110px', render: r => r[0] },
        { t: '页面元素', w: '170px', render: r => r[1] },
        { t: '接口', w: '210px', render: r => `<span class="mono" style="font-size:11px">${r[2]}</span>` },
        {
          t: '关键字段', render: r => `<span class="mono" style="font-size:11px">${r[3].split(',').map(x => {
            const f = x.trim(), k = fieldKind(f, r[2]);
            return `<span style="${FK_STYLE[k]}" title="${FK_TITLE[k]}">${f}</span>`;
          }).join('<span style="color:var(--txt-3)">, </span>')}</span>`
        },
        { t: '用途', w: '62px', align: 'center', render: r => U.tag(r[4], UC[r[4]]) }
      ], list, { maxH: '380px' }) +
        (function () {
          const a = ledgerAudit();
          return `<div style="padding:7px 2px;font-size:11.5px;color:var(--txt-3);white-space:normal">
            命中 ${list.length} / ${LEDGER.length} 条 ·
            §8.2 双向约束:页面元素必有接口来源,接口字段必有页面/控制/调测/统计/审计用途<br>
            <b>字段核对（A5 + D4 冻结前置）：</b>
            <span style="${FK_STYLE.data}">平台数据层 ${a.data}</span> ·
            <span style="${FK_STYLE.proto}">设备协议字段 ${a.proto}</span> ·
            <span style="${FK_STYLE.platform}">平台内部产出 ${a.platform}</span> ·
            <span style="${FK_STYLE.miss}">未命中 ${a.miss.length}</span>
            ${a.miss.length ? '　—— ' + a.miss.map(x => x.f + '（' + x.page + '·' + x.elem + '）').join('；')
              : '　—— 台账字段与三份协议原文、mock.js 数据集全部对齐，可作为 D4 冻结的签字对象'}</div>`;
        })();
    }
    U.modal({
      title: '页面—接口—字段映射台账（F1003）', width: '900px',
      body: `<div style="display:flex;align-items:center;gap:9px;margin-bottom:10px;padding:7px 10px;border-radius:6px;
          background:rgba(61,139,255,.08);border:1px solid var(--line-2);font-size:12.5px">
          <span>${frzStat().frozen ? '🔒' : '🔓'}</span>${ledgerTag()}
          <span style="color:var(--txt-3)">${frzStat().frozen
        ? '已冻结 ' + frzStat().frozen + '/' + frzStat().total + ' 个接口 · 台账版本 <span class="mono">' + ledgerVer + '</span>'
        : '本台账是 D4 接口冻结的签字底稿：接口负责人签字确认后接口冻结，其后变更须走评审流程。'}</span>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:10px">
          ${U.select('lp', pages, pg)}
          <input class="ip" id="ldKw" style="flex:1" placeholder="反查:输入接口地址或字段名,如 authCode / ptz / latitude">
        </div><div id="ldBody">${tbl()}</div>`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn" data-close onclick="UI.toast('台账已导出 Excel,可作为双方接口负责人签字底稿(§8.2)','ok')">⭳ 导出台账</button>
        <button class="btn pri" data-act="sign">${frzStat().frozen === frzStat().total ? '🔒 查看冻结凭据' : '✍ 整批签字确认并冻结'}</button>`,
      on: { sign: () => frzStat().frozen === frzStat().total ? freezeModal() : signModal('all') },
      mounted: el => {
        el.querySelector('#ldKw').oninput = e2 => { kw2 = e2.target.value.trim(); el.querySelector('#ldBody').innerHTML = tbl(); };
        el.querySelector('[data-f="lp"]').onchange = e2 => { pg = e2.target.value; el.querySelector('#ldBody').innerHTML = tbl(); };
      }
    });
  }

  /* ---------------------------------------------------------------------
   * B8-1 签字确认 + 冻结
   * ------------------------------------------------------------------ */
  /* target: 单个接口对象 | 'all' 整批。已处于「待重新签字」的接口走重新签字流程。 */
  function signModal(target) {
    const all = target === 'all';
    const list = all ? M.interfaces : [target];
    const re = !all && frzOf(target) && frzOf(target).status === '待重新签字';
    if (!all && frzOf(target) && !re) return frzOneModal(target);   // 已冻结 → 看凭据
    const cands = SIGN_SIDES.map(x => ({ side: x.side, list: M.users.filter(x.pick) }));
    const no = 'IF-FREEZE-' + M.util.fmtD(M.CONF.demoTime).replace(/-/g, '') + '-' + String(frzSeq + 1).padStart(2, '0');
    U.modal({
      title: re ? '破坏性变更后重新签字 · ' + target.name
        : all ? '接口台账整批签字确认与冻结（D4）' : '接口签字确认与冻结（D4）· ' + target.name,
      width: '720px',
      body: `<div class="warnbox">${re
        ? `该接口冻结期内出现破坏性变更：<b>${frzOf(target).pending}</b><br>依 §8.1，破坏性变更须由双方接口负责人重新签字后方可恢复冻结。`
        : '签字即形成 <b>D4 接口冻结凭据</b>：冻结记录「谁签的 / 何时签的 / 冻结的是哪个版本 / 当前冻结状态」，冻结后变更须走下方流程。'}</div>
        ${U.kv([
        ['冻结范围', all ? `全部 ${S.total} 个接口 / ${new Set(M.interfaces.map(i => i.group)).size} 个分组 · 字段映射台账 ${LEDGER.length} 条`
          : `单个接口：<b>${target.name}</b> <span class="mono" style="font-size:11.5px">${target.url}</span>`],
        ['冻结版本', all
          ? `各接口按其<b>当前版本</b>冻结（台账版本 <span class="mono">${ledgerVer}</span>）`
          : `<b class="mono">${target.ver}</b>（该接口当前版本，冻结后此版本即为基线）`],
        ['冻结编号', `<b class="mono">${no}</b>`],
        ['签字时间', M.util.fmtDT(M.CONF.demoTime)],
        ['受影响页面', all ? '全部页面' : (impactOf(target).pages.join('、') || '<span style="color:#ffd07a">未在附录A 台账中登记（属 C09「页面未引用字段」）</span>')]
      ])}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          ${cands.map((c, k) => U.field(c.side, `<select class="sel" data-f="s${k}" style="flex:1">
            <option value="">请选择（必填）</option>
            ${c.list.map(u => `<option value="${u.id}">${u.name} · ${u.org}</option>`).join('')}
          </select>`)).join('')}
        </div>
        ${U.sect('冻结后变更流程', `<ol style="margin:0;padding-left:4px;list-style:none;font-size:12.5px;color:var(--txt-2);line-height:1.9">
          ${FREEZE_PROCESS.map(x => `<li>${x}</li>`).join('')}</ol>`)}
        <label class="chk"><input type="checkbox" data-f="c1">① 接口清单、字段口径、错误码已逐条核对，与《系统设计方案》附录 A 一致</label>
        <label class="chk"><input type="checkbox" data-f="c2">② 冻结后任何变更须提交变更登记并由双方评审，不得直接改线上接口</label>
        <label class="chk"><input type="checkbox" data-f="c3">③ 破坏性变更须双方重新签字并升 major 版本</label>`,
      footer: `<button class="btn" data-close>取消</button>
        <button class="btn pri" data-act="ok">✍ ${re ? '重新签字并恢复冻结' : '签字确认并冻结'}</button>`,
      on: {
        ok: el => {
          const picks = cands.map((c, k) => {
            const u = M.users.find(x => x.id === el.querySelector('[data-f="s' + k + '"]').value);
            return u ? { side: c.side, name: u.name, org: u.org, at: M.util.fmtDT(M.CONF.demoTime) } : null;
          });
          if (picks.some(x => !x)) return U.toast('平台方与设备方接口负责人均须签字', 'err');
          if (!['c1', 'c2', 'c3'].every(c => el.querySelector('[data-f="' + c + '"]').checked))
            return U.toast('请勾选全部三项确认后再签字', 'err');
          frzSeq++;
          const at = M.util.fmtDT(M.CONF.demoTime);
          const pend = re ? frzOf(target).pending : '';
          list.forEach(i => {
            frz[i.name] = { no, ver: i.ver, at, signs: picks, status: '已冻结', pending: '' };
          });
          frzRecord(re ? '重新签字' : '签字冻结', picks.map(x => x.name).join(' / '),
            re ? '破坏性变更后重新签字' : '接口负责人签字确认',
            (re ? '触发原因：' + pend + '；' : '') + `冻结编号 ${no}，冻结版本 ` +
            (all ? '各接口当前版本' : target.ver),
            all ? `全部 ${S.total} 个接口` : target.name);
          save();
          U.closeModal();
          paint();
          U.toast(`已冻结：${no} · ${all ? '全部 ' + S.total + ' 个接口' : target.name + ' ' + target.ver}
            · ${picks.map(x => x.name).join(' / ')} 于 ${at} 签字`, 'ok');
        }
      }
    });
  }

  /* 单接口冻结凭据 */
  function frzOneModal(i) {
    const f = frzOf(i);
    U.modal({
      title: '接口冻结凭据 · ' + i.name, width: '640px',
      body: `<div class="warnbox">本凭据即 D4「接口冻结」的书面依据：冻结编号、冻结版本、签字人、签字时间四项齐备，
          缺任一项都不足以作为冻结证明。</div>
        ${U.kv([
        ['接口', `<b>${i.name}</b> <span class="mono" style="font-size:11.5px">${i.url}</span>`],
        ['冻结状态', frzTag(i)],
        ['冻结编号', `<b class="mono">${f.no}</b>`],
        ['冻结版本', `<b class="mono">${f.ver}</b>` + (f.ver !== i.ver
          ? `　<span class="tag t-amber">当前版本 ${i.ver} 已偏离冻结基线</span>` : '　<span class="tag t-green">与当前版本一致</span>')],
        ['签字人', f.signs.map(x => `${x.side}：<b>${x.name}</b>（${x.org}）`).join('<br>')],
        ['签字时间', f.at],
        ['受影响页面', impactOf(i).pages.join('、') || '未在附录A 台账中登记'],
        ['变更流程', FREEZE_PROCESS.map(x => x).join('<br>')]
      ])}${f.pending ? `<div class="warnbox" style="border-color:rgba(255,77,94,.45);background:rgba(255,77,94,.10);margin-top:10px">
          ${f.pending}</div>` : ''}`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn warn" data-act="un">🔓 申请解冻</button>
        ${f.pending ? `<button class="btn pri" data-act="re">✍ 重新签字</button>` : ''}`,
      on: { un: () => unfreezeModal(i), re: () => signModal(i) }
    });
  }

  function freezeModal() {
    const brk = M.interfaces.reduce((t, i) => t + brkCount(i), 0);
    const t = frzStat();
    U.modal({
      title: '接口版本与冻结管理（B8 · D4）', width: '940px',
      body: `${U.kv([
        ['台账状态', ledgerTag() + `　已冻结 <b>${t.frozen}</b> / 待重新签字 <b style="color:#ff96a0">${t.pending}</b> / 共 ${t.total} 个接口`],
        ['台账版本', `<b class="mono">${ledgerVer}</b>`],
        ['接口版本概况', `累计破坏性变更 <b style="color:#ff8b95">${brk}</b> 次（均已评审）`]
      ])}
        ${U.sect('冻结后变更流程', `<ol style="margin:0;padding-left:4px;list-style:none;font-size:12.5px;color:var(--txt-2);line-height:1.9">
          ${FREEZE_PROCESS.map(x => `<li>${x}</li>`).join('')}</ol>`)}
        ${U.sect('各接口版本 / 冻结状态', U.table([
        { t: '接口名称', w: '180px', render: i => i.name },
        { t: '当前版本', w: '76px', align: 'center', render: i => `<b class="mono">${i.ver}</b>` },
        { t: '版本数', w: '56px', align: 'center', render: i => history(i).length },
        { t: '破坏性', w: '64px', align: 'center', render: i => brkCount(i) ? U.tag(brkCount(i) + ' 次', 't-red') : '<span style="color:var(--txt-3)">—</span>' },
        { t: '冻结状态', w: '90px', align: 'center', render: i => frzTag(i) },
        {
          t: '冻结凭据', w: '190px', render: i => frzOf(i)
            ? `<div class="mono" style="font-size:11px">${frzOf(i).no} @ ${frzOf(i).ver}</div>
               <div style="font-size:11px;color:var(--txt-3);white-space:normal">${frzOf(i).signs.map(x => x.name).join(' / ')} · ${frzOf(i).at}</div>`
            : '<span style="color:var(--txt-3)">—</span>'
        },
        { t: '影响页面', w: '70px', align: 'center', render: i => impactOf(i).pages.length || `<span class="tag t-amber">0</span>` },
        {
          t: '操作', w: '132px', align: 'center', render: i => `<span class="lnk" data-vv="${i.name}">变更记录</span>
            <span class="lnk" data-sg="${i.name}">${frzOf(i) ? '凭据' : '签字'}</span>`
        }
      ], M.interfaces, { maxH: '250px' }))}
        ${freezeLog.length ? U.sect('冻结留痕', U.table([
          { t: '#', w: '34px', align: 'center', render: r => r.seq },
          { t: '时间', w: '92px', cls: 'num', render: r => `<div>${r.at.slice(0, 10)}</div><div>${r.at.slice(11)}</div>` },
          { t: '动作', w: '90px', align: 'center', render: r => U.tag(r.action, r.action === '解冻' ? 't-amber' : r.action === '破坏性变更' ? 't-red' : 't-green') },
          { t: '范围', w: '150px', render: r => `<div style="white-space:normal">${r.scope}</div>` },
          { t: '操作人', w: '120px', render: r => `<div style="white-space:normal">${r.by}</div>` },
          { t: '说明', w: '300px', render: r => `<div style="white-space:normal;font-size:11.5px;color:var(--txt-3)">${r.reason} · ${r.detail}</div>` }
        ], freezeLog, { maxH: '150px' })) : ''}`,
      footer: `<button class="btn" data-close>关闭</button>
        ${t.frozen ? `<button class="btn warn" data-act="unall">🔓 整批解冻</button>` : ''}
        ${t.frozen === t.total && t.total ? '' : `<button class="btn pri" data-act="sign">✍ 整批签字确认并冻结</button>`}`,
      on: { sign: () => signModal('all'), unall: () => unfreezeModal('all') },
      mounted: el => el.addEventListener('click', e => {
        const v = e.target.closest('[data-vv]');
        if (v) { sel = M.interfaces.find(x => x.name === v.dataset.vv); return verModal(sel); }
        const g2 = e.target.closest('[data-sg]');
        if (g2) { sel = M.interfaces.find(x => x.name === g2.dataset.sg); return signModal(sel); }
      })
    });
  }

  function unfreezeModal(target) {
    const all = target === 'all';
    const list = all ? M.interfaces.filter(i => frzOf(i)) : [target];
    U.modal({
      title: all ? '整批解冻接口台账' : '申请解冻 · ' + target.name, width: '560px',
      body: `<div class="warnbox">解冻后接口可再次增删改，<b>相应 D4 冻结凭据随之失效</b>；
          重新冻结时台账版本号递增，须重新签字。解冻全过程记入冻结留痕。</div>
        ${U.kv([['解冻范围', all ? `全部已冻结接口（${list.length} 个）` : `${target.name}（凭据 ${frzOf(target).no}）`]])}
        ${U.field('变更单号', `<input class="ip" data-f="no" style="flex:1" placeholder="必填，如 CR-2026-0826-01">`)}
        ${U.field('解冻原因', `<input class="ip" data-f="rs" style="flex:1;margin-top:10px" placeholder="必填，如：新增 RemoteID 上报接口">`)}
        ${U.field('申请人', `<select class="sel" data-f="by" style="flex:1;margin-top:10px">
          ${OPS.map(u => `<option>${u.name}</option>`).join('')}</select>`)}`,
      footer: `<button class="btn" data-close>取消</button><button class="btn danger" data-act="ok">确认解冻</button>`,
      on: {
        ok: el => {
          const no = el.querySelector('[data-f="no"]').value.trim();
          const rs = el.querySelector('[data-f="rs"]').value.trim();
          if (!no || !rs) return U.toast('变更单号与解冻原因均为必填', 'err');
          const by = el.querySelector('[data-f="by"]').value;
          const nos = [...new Set(list.map(i => frzOf(i).no))].join('、');
          list.forEach(i => { delete frz[i.name]; });
          if (all) ledgerVer = 'IF-LEDGER-v1.' + (parseInt(ledgerVer.split('.')[1] || '0', 10) + 1);
          frzRecord('解冻', by, rs, '变更单号 ' + no + '，冻结凭据 ' + nos + ' 失效',
            all ? `全部已冻结接口（${list.length} 个）` : target.name);
          save();
          U.closeModal();
          paint();
          U.toast(`已解冻（变更单 ${no}）：${all ? list.length + ' 个接口，台账版本升至 ' + ledgerVer : target.name}`, 'ok');
        }
      }
    });
  }

  /* ---------------------------------------------------------------------
   * B8-2 接口版本与变更记录
   * ------------------------------------------------------------------ */
  function verModal(i) {
    const h = history(i);
    U.modal({
      title: '接口版本与变更记录 · ' + i.name, width: '900px',
      body: `<div class="warnbox">变更记录是 D4 接口冻结的配套凭据：
          <b>破坏性变更（删除字段 / 字段类型变更 / 可选改必填 / 字段重命名）必须经双方评审</b>；
          接口冻结期内出现破坏性变更，该接口转「待重新签字」。
          「影响范围」依据附录A 页面—接口—字段映射台账反查。</div>
        ${U.kv([['接口地址', `<span class="mono">${i.url}</span>`], ['当前版本', `<b class="mono">${i.ver}</b>`],
        ['历史版本', h.length + ' 个'], ['破坏性变更', brkCount(i) ? `<span style="color:#ff8b95">${brkCount(i)} 次</span>（均已评审）` : '0 次'],
        ['冻结状态', frzTag(i) + (frzOf(i) ? ` <span class="mono" style="font-size:11.5px">${frzOf(i).no} @ ${frzOf(i).ver}</span>` : '')],
        ['影响范围（附录A）', impactOf(i).elements.length
          ? impactOf(i).pages.map(x => U.tag(x, 't-blue')).join(' ') +
          `<div style="font-size:11.5px;color:var(--txt-3);margin-top:4px">${impactOf(i).elements.join('；')}</div>`
          : '<span style="color:#ffd07a">该接口未出现在附录A 台账中（C09「页面未引用字段」）</span>']])}
        <div style="margin-top:12px">${verList(i)}</div>`,
      footer: `<button class="btn" data-close>关闭</button><button class="btn pri" data-act="add">＋ 登记变更</button>`,
      on: { add: () => addChangeModal(i) }
    });
  }
  function verList(i) {
    const imp = impactOf(i);
    return U.table([
      { t: '版本', w: '64px', render: v => `<b class="mono">${v.ver}</b>` },
      { t: '变更时间', w: '92px', cls: 'num', render: v => `<div>${v.at.slice(0, 10)}</div><div>${v.at.slice(11)}</div>` },
      { t: '变更人', w: '78px', render: v => `<div style="white-space:normal">${v.by}</div>` },
      {
        t: '变更内容', w: '270px', render: v => v.changes.map(c =>
          `<div style="line-height:1.7;white-space:normal">${c.breaking ? U.tag('破坏性', 't-red') : U.tag(c.kind === '首次发布' ? '发布' : '兼容', 't-green')}
            <b>${c.kind}</b>：<span class="mono" style="font-size:11.5px;color:#a9d4ff">${c.field}</span>
            <span style="color:var(--txt-3)">— ${c.note}</span></div>`).join('')
      },
      {
        /* 影响范围：字段级命中优先（该字段被哪些页面用），否则退回接口级 */
        t: '影响范围（页面）', w: '180px', render: v => {
          const ps = [...new Set(v.changes.reduce((a, c) => {
            const f = impactOf(i, c.field).fieldPages;
            return a.concat(f.length ? f : imp.pages);
          }, []))];
          return ps.length
            ? `<div style="white-space:normal">${ps.map(x => U.tag(x, 't-blue')).join(' ')}</div>`
            : '<span class="tag t-amber">未登记映射</span>';
        }
      },
      {
        t: '评审结论', w: '134px', render: v => v.review
          ? `<div style="font-size:11.5px;line-height:1.6;white-space:normal">${U.tag(v.review.result, 't-green')}<br>
             <span style="color:var(--txt-3)">${v.review.by} · ${v.review.at.slice(0, 10)}</span></div>`
          : '<span style="color:var(--txt-3);white-space:normal">兼容变更<br>无需评审</span>'
      },
      { t: '状态', w: '76px', align: 'center', render: v => U.tag(v.status, v.status === '当前生效' ? 't-green' : 't-gray') }
    ], history(i), { maxH: '300px' });
  }

  function addChangeModal(i) {
    let kind = CHANGE_KINDS[0].k;
    const flds = fieldsOf(i);
    function reviewBox() {
      const b = isBreaking(kind);
      if (!b) return `<div style="font-size:12.5px;color:var(--txt-2);padding:8px 10px;border-radius:6px;
          background:rgba(47,208,110,.08);border:1px solid rgba(47,208,110,.3)">
          兼容性变更：版本号 minor 递增（${i.ver} → ${nextVer(i, false)}），无需评审，台账冻结状态不变。</div>`;
      return `<div class="warnbox" style="border-color:rgba(255,77,94,.45);background:rgba(255,77,94,.10)">
          <b>破坏性变更</b>：版本号 major 递增（${i.ver} → ${nextVer(i, true)}），<b>必须双方评审</b>。
          ${frzOf(i) && frzOf(i).status === '已冻结'
        ? `该接口当前处于冻结状态（${frzOf(i).no} @ ${frzOf(i).ver}），提交后转为「待重新签字」，须双方接口负责人重新签字。` : ''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
          ${U.field('评审人', `<select class="sel" data-f="rv" style="flex:1">
            <option value="">请选择（必填）</option>${REVIEWERS.map(u => `<option>${u.name}</option>`).join('')}</select>`)}
          ${U.field('评审结论', U.select('rr', ['评审通过', '评审不通过']))}
        </div>
        ${frzOf(i) ? U.field('变更单号', `<input class="ip" data-f="cr" style="flex:1;margin-top:10px" placeholder="冻结期内变更必填，如 CR-2026-0826-02">`) : ''}`;
    }
    U.modal({
      title: '登记接口变更 · ' + i.name, width: '660px',
      body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${U.field('变更类型', `<select class="sel" data-f="kd" style="flex:1">${CHANGE_KINDS.map(c =>
        `<option value="${c.k}">${c.k}${c.b ? '（破坏性）' : ''}</option>`).join('')}</select>`)}
          ${U.field('涉及字段', `<select class="sel" data-f="fd" style="flex:1">${flds.map(f =>
          `<option value="${f}">${f} : ${typeOf(i, f)}</option>`).join('')}</select>`)}
        </div>
        ${U.field('变更说明', `<input class="ip" data-f="note" style="flex:1;margin-top:10px" placeholder="必填，说明改了什么、为什么改">`)}
        ${U.field('变更人', `<select class="sel" data-f="by" style="flex:1;margin-top:10px">${OPS.map(u =>
          `<option value="${u.id}">${u.name} · ${u.org}</option>`).join('')}</select>`)}
        <div id="chgRv" style="margin-top:12px">${reviewBox()}</div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">提交变更</button>`,
      mounted: el => {
        el.querySelector('[data-f="kd"]').onchange = e2 => {
          kind = e2.target.value;
          el.querySelector('#chgRv').innerHTML = reviewBox();
        };
      },
      on: {
        ok: el => {
          const note = el.querySelector('[data-f="note"]').value.trim();
          if (!note) return U.toast('请填写变更说明', 'err');
          const b = isBreaking(kind);
          const rv = el.querySelector('[data-f="rv"]');
          const cr = el.querySelector('[data-f="cr"]');
          if (b && !rv.value) return U.toast('破坏性变更必须填写评审人（§8.1）', 'err');
          if (b && frzOf(i) && !cr.value.trim()) return U.toast('该接口已冻结，破坏性变更须填写变更单号', 'err');
          const rr = b ? el.querySelector('[data-f="rr"]').value : null;
          if (b && rr === '评审不通过') return U.toast('评审不通过的破坏性变更不予登记，请修改方案后重新提交', 'err');
          const u = M.users.find(x => x.id === el.querySelector('[data-f="by"]').value);
          const field = el.querySelector('[data-f="fd"]').value;
          const nv = nextVer(i, b);
          const h = history(i);
          h.forEach(v => { if (v.status === '当前生效') v.status = '历史'; });
          h.unshift({
            ver: nv, at: M.util.fmtDT(M.CONF.demoTime), by: u.name, org: u.org, status: '当前生效',
            changes: [{ kind, field, breaking: b, note }],
            review: b ? { by: rv.value, at: M.util.fmtDT(M.CONF.demoTime), result: rr, note: '双方评审通过后放行' } : null
          });
          i.ver = nv;                                   // 真实改写 MOCK.interfaces 的版本号
          if (b && frzOf(i)) {                          // 冻结期内破坏性变更 → 该接口待重新签字
            frzOf(i).status = '待重新签字';
            frzOf(i).pending = `${nv}：${kind}「${field}」偏离冻结版本 ${frzOf(i).ver}（变更单 ${cr.value.trim()}）`;
            frzRecord('破坏性变更', u.name, '冻结期内破坏性变更',
              i.name + ' ' + frzOf(i).pending + ' · 评审人 ' + rv.value, i.name);
          }
          save();
          U.closeModal();
          paint();
          verModal(i);
          U.toast(`已登记变更：${i.name} ${nv}（${kind}·${field}）${b ? '，破坏性变更已记评审' : ''}`
            + (b && frzOf(i) ? '；该接口转为「待重新签字」' : ''),
            b && frzOf(i) ? 'err' : 'ok');
        }
      }
    });
  }
  function nextVer(i, breaking) {
    const m = i.ver.replace('v', '').split('.');
    return breaking ? 'v' + (parseInt(m[0], 10) + 1) + '.0' : 'v' + m[0] + '.' + (parseInt(m[1], 10) + 1);
  }

  /* =========================================================================
   * B8-3 C09 一致性校验四类问题（V1.1 表 9-6）
   *   字段缺失 / 单位不一致 / 页面未引用字段 / 控制无回执
   *   —— 四类都要能「检出 + 跟踪关闭」，其中「控制无回执」是阻断性问题，界面必须区分。
   *
   * 能算的就算：「控制无回执」「页面未引用字段」由接口清单 + 附录A 映射台账实时推导，
   * 接口一变结论就跟着变；「字段缺失」「单位不一致」取自协议核对已登记的口径冲突，
   * 不自行编造（纪要 §7）。
   * ====================================================================== */
  const C09_CATS = {
    '控制无回执': { block: true, cls: 't-red', why: '控制指令下发后无法确认执行结果，违反 §8.1「控制类接口必须具备幂等、回执与急停」' },
    /* 定义按设计文档 §10 / 表9-6 修订：不止「长期为空」，也含「取值长期不完整」 */
    '字段缺失': {
      block: false, cls: 't-amber',
      why: '接口定义中声明但实际长期为空，或取值长期不完整（如声明为多值而实际只承载单值）；'
        + '为空的由设备方补齐或在接口中删除，不完整的须补齐取值来源，不得以「能显示」为由搁置'
    },
    '单位不一致': { block: false, cls: 't-orange', why: '同一物理量在不同协议/页面中基准或单位不同，不可直接比较' },
    '页面未引用字段': { block: false, cls: 't-blue', why: '接口未被任何页面消费，违反 §8.2 双向约束' }
  };
  let c09 = null, c09Saved = {};

  /* 人工登记的条目也要能自动核销。
     「控制无回执」「页面未引用字段」是从接口清单实时推导的，数据一变结论就变；
     但「字段缺失」「单位不一致」这几条是人工登记的静态条目 —— 数据层修好之后它们不会自己消失，
     会一直挂着「待处理」，下一个人得重查一遍才发现问题早没了（这正是登记制最典型的失效方式）。
     所以给有客观判据的条目挂一个 verify()：{gone:true} 显示「当前数据未复现·可核销」，
     {gone:null} 表示当前数据不足以判定 —— 不假装知道。
     注意：仍然不自动关闭，关闭要人来做并留下处理说明。 */
  /* 条目的实时核验：能委托就委托，不自己再算一遍。
     数据层已为这两条不变量建立结构性断言（#53 conf 已删除 / #55 violation_reasons 未被截断），
     且它们已进 tools/falsify.js 的必抓注入集 —— 页面侧再写一套判据只会多一个漂移源：
     两套一旦不一致，先绿的那套会掩盖后红的那套。
     委托时统一处理三种情形：找不到该断言 → 无法判定（不默认通过）；断言红 → 未满足；断言绿 → 可核销。 */
  function byAssert(keys, okNote) {
    const all = M.selfCheck();
    const hit = keys.map(k => all.find(x => x.name.indexOf(k) >= 0)).filter(Boolean);
    if (hit.length < keys.length) {
      const missing = keys.filter(k => !all.some(x => x.name.indexOf(k) >= 0));
      return { gone: null, note: '数据层缺少守护断言「' + missing.join('」「') + '」，无法判定（不默认通过）' };
    }
    const bad = hit.filter(x => !x.ok);
    if (bad.length) return { gone: false, note: '数据层断言未通过：' + bad.map(x => x.name).join('；') };
    return { gone: true, note: okNote + '：' + hit.map(x => '「' + x.name + '」').join(' + ') + ' 均通过' };
  }

  const C09_VERIFY = {
    'conf / source_confidence（含取值不一致）': () =>
      byAssert(['conf 字段已从数据层删除', '内部副本 violations 已删除'], '关闭判据已满足'),

    'violation_reasons 取值不完整（非字段不存在）': () =>
      /* 两个原发生点各有一条守护：#55 覆盖目标侧（按客观事实重推），
         「立案快照完整记录」覆盖快照侧。缺一条就会留下假绿灯，所以两条都要求。 */
      byAssert(['violation_reasons 未被截断', '立案快照完整记录'], '两个原发生点均有守护且通过'),

    '台账字段名与协议原文不符（D4 冻结前置）': () => {
      /* 这一条**只能在页面侧判**：LEDGER 声明在 apis.js 里，数据层与 falsify.js 够不着它。
         因此它是三条里唯一自带判据的，证伪需在浏览器侧做（已跑：注入错名 → 未命中数上升 → 不再标可核销）。 */
      const a = ledgerAudit();
      return a.miss.length
        ? { gone: false, note: `仍有 ${a.miss.length} 个字段未命中：` + a.miss.map(x => x.f).join('、') }
        : {
          gone: true, note: `关闭判据已满足：台账 ${a.data + a.proto + a.platform} 个字段引用全部对齐（`
            + `平台数据层 ${a.data} · 设备协议字段 ${a.proto} · 平台内部产出 ${a.platform}），未命中 0`
        };
    }
  };

  function c09Verify(it) {
    const f = C09_VERIFY[it.target];
    if (!f) return null;
    try { return f(); } catch (e) { return null; }
  }
  function c09Build() {
    const out = [];
    const add = (cat, target, desc, fix) => out.push({
      id: 'C09-' + String(out.length + 1).padStart(2, '0'),
      key: cat + '|' + target, cat, block: C09_CATS[cat].block,
      target, desc, fix, status: '待处理', by: '', at: '', note: '', evi: ''
    });
    /* ① 控制无回执（阻断性）：同组内找不到回执/确认接口的控制类接口 */
    M.interfaces.filter(i => i.kind === '控制接口').forEach(i => {
      /* 注意:不能用 url.indexOf('ack') —— 「tcp://box/radar/track」里也含 ack,
         会把「云台控制无回执」这条阻断性问题误判成已有回执。按末段路径精确匹配。 */
      const ack = M.interfaces.some(x => x.group === i.group &&
        (x.url.split('?')[0].split('/').pop() === 'ack' || x.name.indexOf('回执') >= 0 || x.name.indexOf('确认') >= 0));
      if (!ack) add('控制无回执', i.name,
        `控制接口 ${i.url} 在「${i.group}」分组内找不到回执/确认接口，指令下发后无法确认执行结果与幂等状态`,
        '补充回执接口（如 /ack）或在响应中返回 taskId + 执行状态，并在附录A 台账登记「回执」用途');
    });
    /* ② 页面未引用字段：接口未出现在附录A 映射台账 */
    M.interfaces.forEach(i => {
      if (!impactOf(i).elements.length) add('页面未引用字段', i.name,
        `${i.url} 未出现在附录A 页面—接口—字段映射台账中，无页面/控制/调测/统计/审计用途`,
        '补登映射台账，或确认该接口是否应下线（§8.2 双向约束）');
    });
    /* ③ 字段缺失（协议核对已登记） */
    add('字段缺失', 'uavSN（无人机实名编号）',
      '仅协议破解(dcd)与 RemoteID(rid) 设备能提供 uavSN；若东营现场未部署这两类设备，C01「身份不匹配」判定没有数据支撑',
      '确认现场是否部署 dcd/rid；否则 C01 降级为时间窗 + 空间范围匹配，并在判定页面显式标注降级（V1.1 附录B Q13）');
    add('字段缺失', 'subtype / classification_confidence',
      'objectType 枚举 8 值中没有风筝/气球/孔明灯，页面这三类只能来自光电分类算法 A06 推断，但接口 Schema 未定义 subtype 与置信度字段',
      '在 Target Schema V1 中补 subtype 与 classification_confidence，并按「设备上报 / 算法推断」标注来源');
    add('字段缺失', 'violation_reasons 取值不完整（非字段不存在）',
      '注意：该字段存在，问题是**内容被截断**，不要去找一个不存在的字段。'
      + '派生链为 violations（真值，多值）→ mock.js:456 violation = violations[0]（丢掉其余）'
      + '→ mock.js:702 violation_reasons = [violation]（再从截断后的单值包回数组）。'
      + '实测：violations 多值的目标 46 个，其 violation_reasons 全部（46/46）只保留第一条；'
      + 'mock.js:899 立案快照同源，涉及多违规目标的案件 19 件全部（19/19）只记了 1 条。'
      + '整体看仅占目标总数 3.4%，任何全局指标都不报警，但对受影响的那批是 100% 错。'
      + '影响最重的是 filingSnapshot.violation_reasons —— 它是法律凭据性质的记录，'
      + '复核时看不出立案当时究竟认定了几条违规（处置处罚页「立案判定核查」的「违规事由」行读的就是它）',
      'violation_reasons 直接取自 violations 数组，不再经由单值的 violation 中转；'
      + 'mock.js:702 与 mock.js:899（立案快照）两处同改。'
      + '【与 C09-21 的处置顺序差别】同样是「已修复」，两者删字段的约束不同：'
      + 'C09-21 的修法是让契约字段回退依赖待删字段（conf），因此必须先指定真实来源再删，顺序颠倒会把数据删空；'
      + '本条的修法是让契约字段直接接真值，修完即消除依赖，A5 删不删 violation 都不会把它删空，无顺序约束。'
      + '这个差别要到删字段那一刻才显形，A5 时需按条目分别处置');

    add('字段缺失', '台账字段名与协议原文不符（D4 冻结前置）',
      '台账是 D4 接口冻结的**签字对象**：签一份字段名与协议对不上的台账，等于把错误固化成双方共识 —— '
      + '之后设备方按台账实现、我方按协议实现，要到联调才发现，那时改的已不是一行字符串。'
      + '核对发现 7 行设备协议类接口的字段名在三份协议里 0 命中，属**编了协议中不存在的字段名**'
      + '（与 ADS-B 编造设备、机型超出来源能力同族的第三种形态）：'
      + 'azimuth/quality/track_id → objectId,speedX,speedY,speedZ,rcs,probability；'
      + 'target_type/classification_confidence → objectType,probability；'
      + 'position/accuracy/rc_position → longitude,latitude,pilotLon,pilotLat；'
      + 'stream_url/codec → mediaPullStream,mediaAiPullStream（在 uav.txt 而非 eo.txt）；'
      + 'az/el/zoom/state → panOrientAngle,tiltOrientAngle,focalLen,hfov,vfov；'
      + 'task_type/priority → event,bootstrapSourceId,bootstrapSourceType',
      '已按三份协议原文逐条 grep 核实后改为协议真名；协议里确实没有的（bbox 目标框、心跳运维指标、'
      + '接入部署配置、§6.3 授权闭环字段）单列为「平台内部产出」，与协议字段区分开，避免设备方误以为需其提供。'
      + '核对已内建进「字段映射台账」弹窗实时执行（三分类 + 未命中汇总），'
      + '关闭判据：台账字段核对未命中数 = 0');

    /* ④ 单位不一致（协议核对已登记） */
    add('单位不一致', 'altitude / height_agl',
      '上行协议 altitude 为椭球高(WGS-84)，空域限高按 AGL 真高或 AMSL 海拔高定义，限高判定需 height_agl —— 三者基准不同不可直接比较',
      '接口补充高度基准字段，平台统一换算，并在 C02 判定过程中显示所用基准');
    add('单位不一致', 'conf / source_confidence（含取值不一致）',
      '【问题】单位不一致 + 取值不一致：① conf 为 0~100 百分数、source_confidence 为 0~1 比值，'
      + 'case.filingSnapshot.confidence 取自 conf，并排显示成「96% vs 0.96%」；'
      + '② conf 原有三条生成路径，其中两条与 source_confidence 互不相干'
      + '（mock.js:475 其它非无人机 ri(72,98)、mock.js:536 遥控器 ri(70,92)），曾实测 665/1335 取值本身不同。'
      + '【现状】数据层已统一 source_confidence，三组碰撞率均达 100%，但派生方向存在问题：'
      + '646 个无人机目标走 facts.sourceConfidence（正向），'
      + '700 个非无人机目标（鸟 281 / 未知 144 / 遥控器 130 / 识别中 78 / 船 38 / 车 29）走 conf/100 回退 —— '
      + '即契约字段反过来依赖了计划删除的字段，且这 700 个正是空间安全风险主线的全部对象',
      '【关闭判据】只认「conf 字段已从数据层删除」，不得用数值一致判定收敛。'
      + '原因是统计判据在这里只有一半能力：碰撞率呈现随机指纹（其它非无人机 3.12%≈1/27、遥控器 4.50%≈1/23）'
      + '可以证伪「派生没接上」，但完全一致不能证实「接到了正确来源」—— 从一个待删字段派生出来同样是 100%。'
      + '【A5 注意】删除 conf 前须先为上述 700 个非无人机目标的 source_confidence 指定真实事实来源，'
      + '否则删掉 conf 就断了它们唯一的取值来源；覆盖 :475 与 :536 两处生成点，只改一处会漏掉遥控器。'
      + '（对比：violation_reasons 那条的修法是直接接真值，修完即无顺序约束——两者不可套用同一处置顺序）。'
      + '本条随 conf 字段删除一并关闭');
    add('单位不一致', '速度分量 vx / vy / vz',
      '两份设备协议对速度轴向与单位的定义不一致【待确认：设备方确认正负方向与单位】',
      '由设备方书面确认后统一到 Target Schema，并在调测阶段用实测数据校验');
    /* 恢复此前的跟踪状态 */
    out.forEach(x => { const v = c09Saved[x.key]; if (v) Object.assign(x, v); });
    return out;
  }
  function c09List() { if (!c09) c09 = c09Build(); return c09; }
  function c09Stat() {
    const l = c09List();
    return {
      total: l.length, block: l.filter(x => x.block).length,
      blockOpen: l.filter(x => x.block && x.status !== '已关闭').length,
      closed: l.filter(x => x.status === '已关闭').length,
      doing: l.filter(x => x.status === '处理中').length
    };
  }
  function c09Close(it) {
    U.modal({
      title: '处理 C09 问题 · ' + it.id, width: '620px',
      body: `${it.block ? `<div class="warnbox" style="border-color:rgba(255,77,94,.45);background:rgba(255,77,94,.10)">
          <b>阻断性问题</b>：${C09_CATS[it.cat].why}。关闭前必须给出<b>回执接口地址或变更单号</b>作为凭据，不能只写一句「已处理」。</div>` : ''}
        ${U.kv([['类别', U.tag(it.cat, C09_CATS[it.cat].cls) + (it.block ? ' ' + U.tag('阻断', 't-red') : '')],
        ['涉及对象', it.target], ['问题', `<div style="white-space:normal">${it.desc}</div>`],
        ['建议处理', `<div style="white-space:normal;color:var(--txt-3)">${it.fix}</div>`]])}
        ${(function () {
        const v = c09Verify(it);
        if (!v) return '';
        return `<div style="margin:10px 0;padding:8px 10px;border-radius:6px;font-size:12.5px;white-space:normal;
            border:1px solid ${v.gone === true ? 'rgba(47,208,110,.35)' : 'rgba(108,134,173,.35)'};
            background:${v.gone === true ? 'rgba(47,208,110,.08)' : 'rgba(108,134,173,.08)'}">
            <b>实时核验：</b>${v.note}${v.gone === true ? '　—— 关闭判据已满足，可直接核销（仍需填写处理说明留痕）' : ''}</div>`;
      })()}
        ${U.field('处理状态', U.select('stt', ['处理中', '已关闭'],
        (function () { const v = c09Verify(it); return v && v.gone === true ? '已关闭' : (it.status === '待处理' ? '处理中' : it.status); })()))}
        ${it.block ? U.field('凭据（回执接口 / 变更单号）', `<input class="ip" data-f="evi" style="flex:1;margin-top:10px"
          placeholder="必填，如 /api/v1/ptz/ack 或 CR-2026-0826-03" value="${it.evi}">`) : ''}
        ${U.field('处理说明', `<input class="ip" data-f="note" style="flex:1;margin-top:10px"
          placeholder="必填，写清怎么处理的 / 与谁确认的" value="${it.note}">`)}
        ${U.field('处理人', `<select class="sel" data-f="by" style="flex:1;margin-top:10px">
          ${OPS.map(u => `<option ${u.name === it.by ? 'selected' : ''}>${u.name}</option>`).join('')}</select>`)}`,
      footer: `<button class="btn" data-close>取消</button><button class="btn pri" data-act="ok">保存</button>`,
      on: {
        ok: el => {
          const note = el.querySelector('[data-f="note"]').value.trim();
          const stt = el.querySelector('[data-f="stt"]').value;
          if (!note) return U.toast('请填写处理说明', 'err');
          const evi = it.block ? el.querySelector('[data-f="evi"]').value.trim() : '';
          if (it.block && stt === '已关闭' && !evi)
            return U.toast('阻断性问题关闭必须填写回执接口地址或变更单号', 'err');
          it.status = stt; it.note = note; it.evi = evi;
          it.by = el.querySelector('[data-f="by"]').value;
          it.at = M.util.fmtDT(M.CONF.demoTime);
          save();
          U.closeModal();
          checkModal();
          U.toast(`${it.id} 已标记为「${stt}」`, stt === '已关闭' ? 'ok' : '');
        }
      }
    });
  }

  /* =========================================================================
   * 数据一致性自检（原顶栏入口迁入本页）
   *
   * 迁到这里的理由不是版面，而是性质：它校验的是**设计约束**（单一数据源约定），
   * 不是业务功能 —— 和同在本页的 C09 接口一致性校验是一对：
   * 一个校验接口口径一致，一个校验数据口径一致。页面十本身定位就是工程治理页。
   *
   * 可见性用 users.js 那套现成的权限矩阵（角色 × 模块），不新造机制。
   * ====================================================================== */
  /* 当前登录用户 —— 读数据层的 M.currentUser（getter，跟随 switchUser 实时变）。
     两次问题叠在这一行上，一起修掉：
     ① 原来是 `find(account==='admin') || M.users[0]`：账号集合一变就**拿别人冒充当前用户**，
        而角色直接决定下面的权限判定，等于身份换人的同时权限也换了，界面照常显示一个人名。
     ② 即使把兜底改成 null，它仍是**模块加载时求值的 const** —— 写死查 admin、只算一次，
        于是在本页切换成审计员，这里照旧显示"系统管理员"：全站出现两个"我是谁"的来源。
        而且正因为被这样固定住，运行期根本构造不出兜底路径，这处改动**当时无法实测**。
        —— 测不到它，恰恰是因为它以不该有的方式被钉死了；测试困难本身是设计的信号。
     现在改成每次调用时读，身份与权限都跟随 switchUser。
     注意 currentUser 是**属性不是函数**（getter），写成 M.currentUser() 会直接抛错。
     权限也不再手工去 PERM 里按下标取，改用数据层的 permLevel(role, 模块) —— 
     按下标取要求页面知道 PERM_MODULES 的顺序，那是又一份隐式契约。 */
  const me = () => M.currentUser || null;
  function selfCheckPerm() {
    const u = me();
    if (!u) return '—';                       // 认不出身份 ⇒ 无权限（最严侧）
    return M.permLevel(u.role, '接口管理') || '—';
  }
  const canSeeSelfCheck = () => selfCheckPerm() !== '—';

  function selfCheckModal() {
    const list = M.selfCheck();
    const bad = list.filter(x => !x.ok), good = list.filter(x => x.ok);
    const row = (r, i) => `<tr>
      <td style="width:40px;text-align:center;color:var(--txt-3)">${i + 1}</td>
      <td style="white-space:normal">${r.name}</td>
      <td style="width:150px;text-align:right"><span class="mono">${r.exp}</span></td>
      <td style="width:150px;text-align:right"><span class="mono" style="${r.ok ? '' : 'color:#ff8b95'}">${r.got}</span></td>
      <td style="width:74px;text-align:center">${U.tag(r.ok ? '通过' : '不通过', r.ok ? 't-green' : 't-red')}</td></tr>`;
    const head = `<tr><th style="width:40px">#</th><th>一致性断言</th>
      <th style="width:150px;text-align:right">期望</th><th style="width:150px;text-align:right">实际</th>
      <th style="width:74px;text-align:center">结果</th></tr>`;
    U.modal({
      title: `数据一致性自检 <span class="tag ${bad.length ? 't-red' : 't-green'}" style="margin-left:10px">${good.length}/${list.length} 通过</span>`,
      width: '860px',
      body: `<div class="warnbox">纪要 §8.2：<b>页面每个字段必须有数据来源</b>。全站指标由同一份数据集派生，
          下列断言在每次打开时<b>实时计算</b>（期望值同样是算出来的，不是写死的常量）——
          写死期望值会出现「期望 100% 实际 100% 却标红」这种自欺的绿灯。</div>
        ${bad.length ? `<div style="margin-top:12px">
            <div style="font-size:13px;color:#ff96a0;margin-bottom:6px">✗ 未通过 ${bad.length} 条（需先处理）</div>
            <div class="scroll" style="max-height:220px;border:1px solid rgba(255,77,94,.3);border-radius:6px">
              <table class="tb"><thead>${head}</thead><tbody>${bad.map(row).join('')}</tbody></table></div>
          </div>` : `<div style="margin-top:12px;padding:9px 11px;border-radius:6px;
            border:1px solid rgba(47,208,110,.35);background:rgba(47,208,110,.08);font-size:12.5px">
            ✓ 全部 ${list.length} 条断言通过 —— 全站指标口径自洽</div>`}
        <div style="margin-top:12px">
          <div id="scToggle" class="lnk" style="font-size:12.5px;user-select:none">▸ 展开已通过的 ${good.length} 条</div>
          <div id="scPass" style="display:none;margin-top:6px">
            <div class="scroll" style="max-height:300px"><table class="tb"><thead>${head}</thead>
              <tbody>${good.map(row).join('')}</tbody></table></div>
          </div>
        </div>
        <div style="margin-top:10px;font-size:11.5px;color:var(--txt-3);white-space:normal">
          可见性：按「用户与权限」的角色权限矩阵限定 —— 当前登录 <b>${me() ? `${me().name}（${me().roleName}）` : '未识别当前登录账号，按无权限处理'}</b>，
          对「接口管理」模块权限 <span class="mono">${selfCheckPerm()}</span>。值班员（该模块无权限）看不到本入口。</div>`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn pri" data-close onclick="UI.toast('自检报告已导出（Demo）','ok')">⭳ 导出自检报告</button>`,
      mounted: el => {
        const t = el.querySelector('#scToggle'), b = el.querySelector('#scPass');
        t.onclick = () => {
          const open = b.style.display !== 'none';
          b.style.display = open ? 'none' : 'block';
          t.textContent = (open ? '▸ 展开' : '▾ 收起') + `已通过的 ${good.length} 条`;
        };
      }
    });
  }

  function checkModal() {
    const issues = [
      { p: '融合感知中心', f: '反制"一键执行"缺少授权码字段', s: '已修复', d: '已改为授权弹窗，下发时携带 authCode + operator + range' },
      { p: '设备接入调测', f: '协议类型 TCP 与 HTTP 路径混用', s: '已修复', d: '协议与接入地址联动生成' },
      { p: '接口管理', f: '接口地址拼写 /airport/liist', s: '已修复', d: '更正为 /api/v1/airport/list' },
      { p: '处置处罚管理', f: '公安干扰缺少审批编号与审计字段', s: '已修复', d: '新增授权编号/联动单位/作用范围/启停/急停/审计' },
      { p: '空域与航线', f: '空域坐标属东莞（22.9°N,113.8°E）', s: '已修复', d: '全部更正为东营（37.x°N,118.x°E）' },
      { p: '全站', f: '同一数值被用于不同口径指标', s: '已修复', d: '所有指标改为单一数据源派生，见「数据一致性自检」' },
      { p: '光电/云台', f: '云台运动控制参数未确认', s: '待设备方确认', d: '角度范围、速度、响应时间、回执格式（纪要 §16.2）' },
      { p: '融合置信度', f: '多源融合权重为 Demo 默认值', s: '待算法方提供', d: 'B03 正式权重与降级策略' }
    ];
    const t = c09Stat();
    /* 阻断性问题排最前，其次未关闭 */
    const rows2 = c09List().slice().sort((x, y) =>
      (y.block - x.block) || ((x.status === '已关闭') - (y.status === '已关闭')) || (x.id < y.id ? -1 : 1));
    U.modal({
      title: '一致性校验报告（F1004 · C09）', width: '960px',
      body: `<div class="warnbox">纪要 §8.2：<b>页面每个字段/按钮必须有接口来源，接口每个字段必须有页面、控制、调测、统计或审计用途。</b>
        C09 四类问题须<b>可检出、可跟踪关闭</b>；其中<b style="color:#ff96a0">「控制无回执」为阻断性问题</b>，
        关闭需提供回执接口或变更单号。</div>
        ${U.sect(`① C09 四类问题跟踪　<span style="font-weight:400;font-size:12px;color:var(--txt-3)">共 ${t.total} 条 ·
          <b style="color:#ff96a0">阻断 ${t.block} 条（未关闭 ${t.blockOpen}）</b> · 处理中 ${t.doing} · 已关闭 ${t.closed}</span>`,
        U.table([
          { t: '编号', w: '74px', cls: 'num', render: r => r.id },
          {
            t: '类别', w: '116px', render: r => U.tag(r.cat, C09_CATS[r.cat].cls) +
              (r.block ? `<div style="margin-top:3px">${U.tag('阻断性', 't-red')}</div>` : '')
          },
          { t: '涉及对象', w: '160px', render: r => `<div style="white-space:normal">${r.target}</div>` },
          {
            /* 条目描述可能很长(如 C09-21 记了三条生成路径与判据边界)。
               这里按行数视觉截断,全文保留在 DOM 与「处理」弹窗里 —— 截字符会丢信息,截行不会。 */
            t: '问题描述 / 建议处理', w: '330px', render: r => `<div style="white-space:normal;display:-webkit-box;
                -webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">${r.desc}</div>
              <div style="white-space:normal;font-size:11.5px;color:var(--txt-3);margin-top:2px;display:-webkit-box;
                -webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">→ ${r.fix}</div>
              ${(r.desc.length + r.fix.length) > 190 ? `<div style="font-size:11px;color:#8fbaff;margin-top:3px">点「${r.status === '已关闭' ? '查看' : '处理'}」看完整说明 ›</div>` : ''}`
          },
          {
            t: '状态', w: '150px', render: r => {
              const v = r.status === '已关闭' ? null : c09Verify(r);
              return U.tag(r.status, r.status === '已关闭' ? 't-green' : r.status === '处理中' ? 't-cyan' : 't-amber')
                + (v && v.gone === true ? `<div style="margin-top:3px">${U.tag('当前数据未复现 · 可核销', 't-green')}</div>` : '')
                + (v && v.gone === null ? `<div style="margin-top:3px">${U.tag('无法判定', 't-gray')}</div>` : '')
                + (v ? `<div style="white-space:normal;font-size:11px;color:var(--txt-3);margin-top:3px">${v.note}</div>` : '')
                + (r.status === '待处理' ? '' : `<div style="white-space:normal;font-size:11px;color:var(--txt-3);margin-top:3px">
                  ${r.by} · ${r.at.slice(5, 16)}<br>${r.note}${r.evi ? '<br>凭据：<span class="mono">' + r.evi + '</span>' : ''}</div>`);
            }
          },
          { t: '操作', w: '66px', align: 'center', render: r => `<span class="lnk" data-c9="${r.id}">${r.status === '已关闭' ? '查看' : '处理'}</span>` }
        ], rows2, { maxH: '320px' }))}
        ${U.sect('② 页面 × 能力依赖矩阵', U.table([
        { t: '页面', k: 0, render: r => r[0], w: '160px' },
        { t: '核心依赖', render: r => r[1] },
        { t: '融合目标', w: '86px', align: 'center', render: r => U.tag(r[2], 't-green') },
        { t: '接口就绪', w: '96px', align: 'center', render: r => { const ok = CH.seeded(r[0])(0, 3) > 0; return U.tag(ok ? 'Mock 就绪' : '待厂家', ok ? 't-blue' : 't-amber'); } }
      ], PAGE_MAP))}
        ${U.sect('③ 原型稿问题与处理', U.table([
        { t: '页面', k: 'p', w: '130px' },
        { t: '发现的问题', k: 'f', w: '270px' },
        { t: '状态', w: '110px', render: r => U.tag(r.s, r.s === '已修复' ? 't-green' : 't-amber') },
        { t: '处理说明', k: 'd' }
      ], issues))}`,
      footer: `<button class="btn" data-close>关闭</button>
        <button class="btn pri" data-close onclick="UI.toast('校验报告已导出（Demo）','ok')">⭳ 导出校验报告</button>`,
      mounted: el => el.addEventListener('click', e => {
        const t2 = e.target.closest('[data-c9]');
        if (t2) c09Close(c09List().find(x => x.id === t2.dataset.c9));
      })
    });
  }

  /* ---- B8 状态持久化：签字冻结 / 版本变更 / C09 跟踪 刷新后仍在 ---- */
  const AKEY = 'api.b8.v1';
  function save() {
    try {
      sessionStorage.setItem(AKEY, JSON.stringify({
        ledgerVer, frzSeq, frz, freezeLog, vers: verStore,
        ifVer: M.interfaces.reduce((o, i) => (o[i.name] = i.ver, o), {}),
        c09: (c09 || []).reduce((o, x) => (x.status !== '待处理'
          ? (o[x.key] = { status: x.status, by: x.by, at: x.at, note: x.note, evi: x.evi }) : 0, o), {})
      }));
    } catch (e) { /* sessionStorage 不可用时降级为内存态 */ }
  }
  (function restore() {
    try {
      const v = JSON.parse(sessionStorage.getItem(AKEY) || 'null');
      if (!v) return;
      ledgerVer = v.ledgerVer || ledgerVer;
      frzSeq = v.frzSeq || 0;
      Object.assign(frz, v.frz || {});
      (v.freezeLog || []).forEach(x => freezeLog.push(x));
      Object.assign(verStore, v.vers || {});
      // MOCK 每次刷新重建,冻结/变更改写过的接口版本号要还原
      M.interfaces.forEach(i => { if (v.ifVer && v.ifVer[i.name]) i.ver = v.ifVer[i.name]; });
      c09Saved = v.c09 || {};
    } catch (e) { }
  })();

  /* F0407（空域规则冲突检测阈值）从已删除的「空域与航线」页迁来。
     它的 UI 消费方（新增/编辑空域时的冲突提示）确实随页面消失了，但**判定本身没有**：
     mock.js 的 detectConflicts 仍在跑，数据层有断言守着它，flights 的航线周边态势也用它。
     参数的去留看的是判据还在不在，不是那个页面还在不在。 */
  U.regParams({
    key: 'F0407', name: '空域规则冲突检测阈值', page: '接口管理 · 判据登记', hash: '#/apis',
    ver: 'demo-v1', confirmed: false, owner: '业务方',
    basis: '需求文档 F0407 规则冲突检测；判定实现在 mock.js detectConflicts()',
    affects: ['航线与空域冲突检测（flights 航线周边态势）', '数据层 selfCheck 冲突断言'],
    note: '原「新增/编辑空域时的冲突提示」入口已随空域管理页删除；判定实现与断言仍在数据层，故参数保留',
    items: () => [
      { n: '最小重叠率（低于此值不报冲突）', v: M.CONFLICT_MIN_OVERLAP + '%' },
      { n: '时间重叠判据', v: '生效期存在交集' },
      // 「哪些类型算绝对禁止」由 AIRSPACE_TYPES.forbidsAllPlans 声明，这里读它而不是再抄一遍类型名
      {
        n: '严重级判据一：与绝对禁止空间重叠',
        v: M.AIRSPACE_TYPES.filter(t => t.forbidsAllPlans).map(t => t.type).join(' / ')
      },
      { n: '严重级判据二', v: '双方均有限高且取值不同 → 重叠区取更严值' },
      { n: '严重冲突处理', v: '首次保存拦截，二次确认才放行' }
    ]
  });


  g.PAGES = g.PAGES || {};
  g.PAGES.apis = { render, mount };
})(window);
