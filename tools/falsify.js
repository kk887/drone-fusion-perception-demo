#!/usr/bin/env node
/* 断言证伪工具
   ------------------------------------------------------------------
   一条断言的价值等于它可能失败的方式有多少。恒真的断言价值为零，
   而且比没有更糟 —— 它占着"已验证"的名额。

   本工具对数据层施加一批**定向注入**，每次注入后重跑 selfCheck，
   记录每条断言是否至少被某次注入弄红过。
   从未被任何注入弄红的断言会被单独列出：它们不一定是错的，
   但都需要人工确认"它到底能不能失败"。

   用法：node tools/falsify.js [--verbose]

   ── 关于新增与替换断言（规程）──────────────────────────────
   1. 新增断言必须在此文件里配一条注入，并确认它能被捕获。
      没有对应注入的断言，等同于没验证过它能否失败。
   2. 删改断言时，把被删那条的违例留成一条注入：
      新断言若真能覆盖旧的，这条注入就该被它捕获；
      捕获不到，说明是"替换"而不是"升级"，旧的防线空了。
      —— 这条规则本身就是被一次事故逼出来的：A5 收敛时我把
      「violation_reasons 未被截断」换成了「主违规取最严一条」，
      以为是升级，实际是把一道防线换成另一道，空缺几小时无人知。
   3. 逃生口：若旧断言的判据对象已被**结构性移除**（字段/副本不再存在），
      注入就写不出来了 —— 硬写只能先把已删的字段造回来，
      那注入的已经不是原违例，而是一个现实中不可能发生的状态。
      此时以「结构性保证」记录理由代替注入，并留下一条**守护该结构性事实**
      的断言（如「conf 字段已从数据层删除」），而不是原断言的注入。
      按字面执行会得到"捕获不到"，然后有人为了让它绿而留着一条
      守护已消失字段的断言 —— 那正是我们在治的"条目挂着但问题早没了"。
*/
const path = require('path');
const MOCK_FILE = path.join(__dirname, '..', 'assets', 'js', 'mock.js');
const VERBOSE = process.argv.includes('--verbose');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

function load() {
  delete require.cache[require.resolve(MOCK_FILE)];
  global.window = {};
  require(MOCK_FILE);
  return global.window.MOCK;
}

const M = load();
const names = M.selfCheck().map(a => a.name);
const base = M.selfCheck();
if (base.some(a => !a.ok)) {
  console.log(C.r + '基线自检未全过，先修复再跑证伪：' + C.x);
  base.filter(a => !a.ok).forEach(a => console.log('  ' + a.name + ' | ' + a.got));
  process.exit(1);
}

/* 注入用例：每条 = [名称, 施加函数 → 还原函数] */
const uav = () => M.allTargets.filter(t => t.type === '无人机');
const set = (o, k, v) => { const old = o[k]; o[k] = v; return () => { o[k] = old; }; };

const INJECTIONS = [
  ['判定结果越界', () => set(M.allTargets[3], 'legal', '疑似违规')],
  ['末条目标判定结果越界', () => set(M.allTargets[M.allTargets.length - 1], 'legal', '疑似违规')],
  ['空域类型越界', () => set(M.airspaces[0], 'type', '试验空域')],
  ['空域配色与声明不符', () => set(M.airspaces[1], 'color', '#123456')],
  ['告警状态越界', () => set(M.alarms[0], 'status', '待处置')],
  ['案件状态越界', () => set(M.cases[0], 'status', '已撤销')],
  ['轨迹状态越界', () => set(M.allTargets[5], 'track_status', '疑似分裂')],
  ['违规事由越界', () => { const t = uav().find(x => x.violation_reasons.length); const o = t.violation_reasons.slice(); t.violation_reasons = ['擅自起飞']; return () => { t.violation_reasons = o; }; }],
  ['重新引入 conf 字段（非首条）', () => { const t = M.allTargets[400]; t.conf = 88; return () => { delete t.conf; }; }],
  ['重新引入 violations 副本', () => { const t = M.allTargets[500]; t.violations = ['夜间飞行']; return () => { delete t.violations; }; }],
  ['violation_reasons 被截断', () => { const t = uav().find(x => x.violation_reasons.length > 1); const o = t.violation_reasons.slice(); t.violation_reasons = [o[0]]; return () => { t.violation_reasons = o; }; }],
  ['立案快照被截断', () => { const c = M.cases.find(x => x.filingSnapshot.violation_reasons.length > 1); const o = c.filingSnapshot.violation_reasons.slice(); c.filingSnapshot.violation_reasons = [o[0]]; return () => { c.filingSnapshot.violation_reasons = o; }; }],
  /* 必须挑一个「末项 ≠ 当前主违规」的样本：若随手取第一个多违规目标，
     它的末项可能**恰好就是**最严的那条，注入就成了空操作，于是"无人捕获"——
     而这既不是断言坏了，也不是数据坏了，是注入本身没有区分力。
     （2026-08-27 计划比对改真判据后数据重排，这条就这样漏了一次。） */
  ['主违规改取数组末项', () => { const t = uav().find(x => x.violation_reasons.length > 1
      && x.violation_reasons[x.violation_reasons.length - 1] !== x.violation);
    return t ? set(t, 'violation', t.violation_reasons[t.violation_reasons.length - 1]) : null; }],
  ['雷达目标填具体机型', () => { const t = uav().find(x => x.model === '未识别'); return t ? set(t, 'model', 'DJI Mavic 3') : null; }],
  ['5G-A 目标给定位精度', () => { const t = M.allTargets.find(x => x.source === '5G-A' && x.position_accuracy == null); return t ? set(t, 'position_accuracy', 9.9) : null; }],
  ['融合感知箱目标给 5G-A 任务号', () => { const t = M.allTargets.find(x => x.source === '融合感知箱'); return set(t, 'source_task_id', 'TASK12345'); }],
  ['source_confidence 与 facts 脱钩', () => { const t = M.allTargets[7]; return set(t, 'source_confidence', 0.11); }],
  ['无认定路径却给具名主体', () => { const c = M.cases[0]; const o = c.filingSnapshot.subject_source; c.filingSnapshot.subject_source = null; return () => { c.filingSnapshot.subject_source = o; }; }],
  ['违法目标既未立案也不在待办', () => { const q = M.pendingSubjects[0]; const o = q.targetId; q.targetId = 'NOPE'; return () => { q.targetId = o; }; }],
  ['轨迹点坐标越界', () => { const t = M.liveTargets[0]; const o = t.track[2].lon; t.track[2].lon = -0.05; return () => { t.track[2].lon = o; }; }],
  ['轨迹点分型统计与实际不符', () => { const t = M.liveTargets[0]; return set(t.track[1], 'kind', 'bridge'); }],
  ['弥合率退回常数', () => { const os = M.liveTargets.map(t => t.track.map(p => p.kind)); M.liveTargets.forEach(t => t.track.forEach((p, i) => { p.kind = (i >= 10 && i <= 13) ? 'bridge' : (i >= t.track.length - 2 ? 'pred' : 'meas'); })); return () => M.liveTargets.forEach((t, j) => t.track.forEach((p, i) => { p.kind = os[j][i]; })); }],
  ['高度缺失档被抹掉', () => { const b = M.stats.aglBands.find(x => x.absent); return set(b, 'value', 0); }],
  ['AOA 目标补上经纬度', () => { const t = M.allTargets.find(x => x.posValid === false); return set(t, 'lon', 118.5); }],
  ['立案快照跟随后续修订改变', () => { const c = M.cases[0]; return set(c.filingSnapshot, 'legal_status', '待确认'); }],
  ['风筝被当成目标类型', () => set(M.allTargets[9], 'type', '风筝')],
  ['设备停用但仍报在线', () => { const d = M.devices.find(x => x.disabled); return d ? set(d, 'status', '在线') : null; }],
  ['角色用户数与实际不符', () => set(M.ROLES[0], 'users', 99)],
  /* 当前用户与权限判定 */
  /* 风险事件状态机与通报记录 */
  /* 探针断言的数据侧证伪：把所有保护对象外圈缩到极小，两条规则之间不再存在分歧区，
     探针无从构造 —— 此时断言必须报"无法被验证"而不是默默通过。
     （规则实现被改回"取最近"这一路，已用替换实现的副本验证过会报红，
     那类属实现替换、不是数据注入。） */
  /* fail-closed 兜底：这两条注入模拟"新增枚举值忘了登记" */
  /* 反制授权凭据：这次缺陷是双向的，两个方向各注一次 */
  ['已实施反制的案件缺授权凭据', () => { const a = M.authLogs[0]; const i = M.authLogs.indexOf(a); M.authLogs.splice(i, 1); return () => M.authLogs.splice(i, 0, a); }],
  ['孤儿授权（案件未走到该环节）', () => { const c = M.cases.find(x => !x.counterApplicable || x.stage <= 3); return set(M.authLogs[1], 'caseId', c.id); }],
  ['未实施反制却标该环节已完成', () => { const c = M.cases.find(x => !x.counterApplicable); const st = c.steps[3]; const o = { d: st.done, t: st.t }; st.done = true; st.t = '2026-08-20 10:00:00'; return () => { st.done = o.d; st.t = o.t; }; }],
  ['干扰频段裸填具体值（无 bandSource）', () => set(M.authLogs[0], 'band', '2.4GHz / 5.8GHz / GNSS')],
  ['干扰频段出现已查明的误读产物 1.3G', () => set(M.authLogs[0], 'band', '900M / 1.3G')],
  /* T02 规格书到位后才可能存在的三条注入 */
  ['把雷达量程外的目标记为雷达探测', () => { const rst = M.devices.filter(v => v.type === '雷达');
    const dk = (x, y) => Math.sqrt(((x.lon - y.lon) * 88.5) ** 2 + ((x.lat - y.lat) * 111) ** 2);
    const t = M.allTargets.find(x => x.source !== '融合感知箱' && !rst.some(r => dk(r, x) <= 3.5));
    return t ? set(t, 'source', '融合感知箱') : null; }],
  ['雷达目标高度超过最大探测高度', () => { const t = M.allTargets.find(x => x.source === '融合感知箱' && x.heightAgl != null); return t ? set(t, 'heightAgl', 900) : null; }],
  ['雷达目标速度超出测量范围', () => { const t = M.allTargets.find(x => x.source === '融合感知箱'); return t ? set(t, 'speed', 140) : null; }],
  ['设备型号编造（既非占位也未登记）', () => { const d = M.devices.find(x => x.type === '光电'); return set(d, 'model', 'XYZ-999'); }],
  ['设备对象被塞回协议不存在的主机指标', () => { const d = M.devices[0]; d.cpu = 42; return () => { delete d.cpu; }; }],
  /* 计划命中：结论反向生成证据的三种形态 */
  ['给架次塞一个时窗不含它的计划号', () => { const t = M.allTargets.find(x => x.matched_plan_id);
    const other = M.flightPlans.find(p => new Date(p.start.replace(' ', 'T')).getTime() > t.ts);
    return other ? set(t, 'matched_plan_id', other.id) : null; }],
  ['给架次塞一个走廊不覆盖它的计划号', () => { const t = M.allTargets.find(x => x.matched_plan_id);
    const cur = t.matched_plan_id;
    const other = M.flightPlans.find(p => p.routeId && p.id !== cur
      && new Date(p.start.replace(' ', 'T')).getTime() <= t.ts
      && new Date(p.end.replace(' ', 'T')).getTime() >= t.ts);
    return other ? set(t, 'matched_plan_id', other.id) : set(t, 'matched_plan_id', 'FP_NOT_EXIST'); }],
  ['未命中的架次却带着计划号', () => { const t = M.allTargets.find(x => x.facts && x.facts.planMatch === '未命中');
    return t ? set(t, 'matched_plan_id', M.flightPlans[0].id) : null; }],
  /* 空域类违规的 referent 被抽走 / 被换成不禁飞的空域类型 */
  ['侵入禁飞区却没有对应的空域命中记录', () => { const t = M.allTargets.find(x => (x.violation_reasons || []).indexOf('侵入禁飞区') >= 0 && x.facts);
    const o = t.facts.zoneHits; t.facts.zoneHits = o.filter(h => h.reason !== '进入');
    return () => { t.facts.zoneHits = o; }; }],
  ['侵入禁飞区点名到一块并不禁飞的空域', () => { const t = M.allTargets.find(x => (x.violation_reasons || []).indexOf('侵入禁飞区') >= 0 && x.facts);
    const h = t.facts.zoneHits.find(x => x.reason === '进入'); const o = h.id;
    const z = M.airspaces.find(a => a.type === '限高区域');
    h.id = z.id; return () => { h.id = o; }; }],
  ['空域被标成本地可编辑（纪要 §4.1 平台只接收）', () => { const z = M.airspaces[0];
    const o = { s: z.source, e: z.editable }; z.source = '本地设立'; z.editable = true;
    return () => { z.source = o.s; z.editable = o.e; }; }],
  ['分类置信度凭空有值（Schema 未定义该字段）', () => set(M.allTargets[0], 'classification_confidence', 0.9)],
  ['分类置信度为空却说不出缺失原因', () => set(M.allTargets[0], 'clsConfWhy', '')],
  ['声称已执行范围校验的设备类型其实没有量程', () => { const d = M.devices.find(x => x.type === '雷达'); return set(d, 'cover', '【待确认：设备方提供】'); }],
  /* ---- 风险判定新口径（航线中心，RISK-route-v1）---- */
  ['风险事件挂到了不是最近的那条航线', () => { const e = M.riskEvents.find(x => x.nearestRouteId);
    const other = M.routes.find(r => r.status === '生效中' && r.id !== e.nearestRouteId);
    return other ? set(e, 'nearestRouteId', other.id) : null; }],
  ['>5km 的事件被判成中/高', () => { const e = M.riskEvents.find(x => x.nearestRouteKm > 5);
    return e ? set(e, 'level', '中') : null; }],
  ['贴近航线且高度重叠在窗内却未判高', () => { const e = M.riskEvents.find(x => x.level === '高');
    return e ? set(e, 'level', '中') : null; }],
  ['高度不可判定被静默当成不重叠', () => { const e = M.riskEvents.find(x => x.altOverlap == null && x.nearestRouteId);
    return e ? set(e, 'undeterminable', []) : null; }],
  ['风险事件挂到草稿/已停用航线', () => { const e = M.riskEvents[0];
    const d = M.routes.find(r => r.status !== '生效中');
    return d ? set(e, 'nearestRouteId', d.id) : null; }],
  ['处置建议凭空指名通知塔台', () => set(M.riskEvents[0], 'advice', '立即通知机场塔台 + 驱离作业')],
  /* 通道集合必须与处置方式自洽（资料原文：迫降四路全开 / 驱离除 ch2 外全开） */
  ['迫降记录少开一路干扰通道', () => { const a = M.authLogs.find(x => x.result === '迫降' && x.channels); return a ? set(a, 'channels', [1, 3, 4]) : null; }],
  ['驱离记录擅自开启 ch2 卫星导航干扰', () => { const a = M.authLogs.find(x => x.result === '退出管制区' && x.channels); return a ? set(a, 'channels', [1, 2, 3, 4]) : null; }],
  ['开了 ch2 却未标注卫星导航链路干扰（合规显性）', () => { const a = M.authLogs.find(x => x.gnssJam === true); return a ? set(a, 'gnssJam', false) : null; }],
  ['替原文未定义的处置方式（返航）补出通道', () => { const a = M.authLogs.find(x => x.result === '返航' && x.type === '公安授权信号干扰'); return a ? set(a, 'channels', [1, 3, 4]) : null; }],
  ['非干扰的反制记录也填了频段', () => { const a = M.authLogs.find(x => x.type === '反制处置'); return a ? set(a, 'band', '2.4G / 5.8G') : null; }],
  ['信号干扰授权挂到未实施干扰的案件', () => { const a = M.authLogs.find(x => x.type === '反制处置'); return a ? set(a, 'type', '公安授权信号干扰') : null; }],
  ['证据·指令报文与授权记录数量不符', () => { const f = M.evidenceFiles.find(x => x.kind === '指令报文与回执'); const i = M.evidenceFiles.indexOf(f); M.evidenceFiles.splice(i, 1); return () => M.evidenceFiles.splice(i, 0, f); }],
  ['证据·处罚文书与已结案数量不符', () => { const f = M.evidenceFiles.find(x => x.kind === '处罚文书'); const i = M.evidenceFiles.indexOf(f); M.evidenceFiles.splice(i, 1); return () => M.evidenceFiles.splice(i, 0, f); }],
  /* 推进闸门 / 回退 / 上级同步 */
  /* 「查询与执行同源」这条**没有数据侧注入**，属结构性保证：
     advanceCase 内部调用的是闭包里的 canAdvanceCase，替换导出的 M.canAdvanceCase 影响不到它
     —— 而"影响不到"正是这条不变式本身。
     已用**实现替换**验证过：在副本上给 advanceCase 写一份自己的判据（只查是否走完、不查归属），
     该断言立刻报红并列出 26 处不一致。副本已删。 */
  ['回退后残留完成时间', () => { const c = M.cases.find(x => x.stage < 6); const st = c.steps[c.stage]; const o = st.t; st.t = '2026-08-20 10:00:00'; return () => { st.t = o; }; }],
  ['回退未留理由', () => { const c = M.cases[0]; c.restageLog = [{ at: '2026-08-26 10:00:00', from: 3, to: 1, operator: '张三' }]; return () => { delete c.restageLog; }; }],
  ['同步记录说不出来源模块', () => { const r = M.riskNotices[0]; const o = r.srcModule; delete r.srcModule; return () => { r.srcModule = o; }; }],
  ['同步记录用单值字段承载关联（refs 被清空）', () => { const r = M.riskNotices[1]; const o = r.refs; r.refs = []; return () => { r.refs = o; }; }],
  ['同步回执退回成写死的词（无重试计数）', () => { const r = M.riskNotices[2]; const o = r.retry; delete r.retry; return () => { r.retry = o; }; }],
  ['案件状态与推导来源脱钩', () => { const c = M.cases.find(x => x.status === '已结案'); return set(c, 'status', '待归档'); }],
  ['未立案的案件被标为已立案', () => { const c = M.cases.find(x => x.stage < 3); return c ? set(c, 'status', '已立案') : null; }],
  ['环节有完成时间却标未完成', () => { const c = M.cases.find(x => x.steps.some(st => st.done)); const st = c.steps.find(x => x.done); return set(st, 'done', false); }],
  ['处置环节丢失归属模块', () => { const f = M.DISPOSAL_FLOW[3]; const o = f.owner; delete f.owner; return () => { f.owner = o; }; }],
  ['规则版本类型越界', () => set(M.ruleVersions[0], 'ruleKind', 'device')],
  ['同类规则出现两个当前生效版本', () => { const v = M.ruleVersions.find(x => x.ruleKind === 'airspace' && x.status === '历史'); return set(v, 'status', '当前生效'); }],
  ['某类规则没有当前生效版本', () => { const v = M.ruleVersions.find(x => x.ruleKind === 'route' && x.status === '当前生效'); return set(v, 'status', '历史'); }],
  ['版本记录缺发布人（无法审计）', () => { const v = M.ruleVersions[1]; const o = v.publisher; delete v.publisher; return () => { v.publisher = o; }; }],
  ['目标类型未登记（走兜底解析）', () => set(M.allTargets[12], 'type', '飞艇')],
  ['空域类型未登记（走兜底解析）', () => set(M.airspaces[1], 'type', '试验空域')],
  ['空域来源未登记（走兜底解析）', () => set(M.airspaces[2], 'source', '第三方平台')],
  ['风险等级与保护区配置脱钩', () => { const e = M.riskEvents.find(x => x.level === '低'); return set(e, 'level', '高'); }],
  ['最近机场字段被保护对象名覆盖', () => { const e = M.riskEvents[1]; return set(e, 'airport', '胜利油田中心油库'); }],
  ['风险事件状态越界', () => set(M.riskEvents[0], 'status', '待研判')],
  ['已通知的事件却没有通报记录', () => { const e = M.riskEvents.find(x => x.status === '已通知'); const ns = M.noticesOf(e.id); const idx = ns.map(n => M.riskNotices.indexOf(n)).sort((a,b)=>b-a); const saved = idx.map(i => [i, M.riskNotices[i]]); idx.forEach(i => M.riskNotices.splice(i,1)); return () => saved.reverse().forEach(([i,n]) => M.riskNotices.splice(i,0,n)); }],
  ['待核验的事件却已有通报记录', () => { const e = M.riskEvents.find(x => x.status === '待核验'); const clone = Object.assign({}, M.riskNotices[0], { id: 'RN_TEST', eventId: e.id }); M.riskNotices.push(clone); return () => { const i = M.riskNotices.findIndex(n => n.id === 'RN_TEST'); if (i >= 0) M.riskNotices.splice(i,1); }; }],
  ['已回执却没有回执时刻', () => { const n = M.riskNotices.find(x => x.ackStatus === '已回执'); const o = n.ackAt; n.ackAt = null; return () => { n.ackAt = o; }; }],
  ['通报走塔台专线却发给管理中心', () => { const n = M.riskNotices.find(x => x.channel === 'NC1'); return set(n, 'to', '东营市低空安全管理中心'); }],
  /* 注意：不能用 toISOString() 造时间戳 —— 它返回 UTC，而数据层用的是本地时间字符串。
     本地 UTC-4 时，`e.ts-10min` 经 toISOString 反而比 e.ts 晚 3 小时，注入就成了"更晚"，
     断言当然抓不到。时区在这个项目里已经咬过一次（顶栏/基准/机器时间三套），这里同理。 */
  ['通报时刻早于事件发生', () => { const n = M.riskNotices[0]; const e = M.riskEvents.find(y => y.id === n.eventId); const o = n.at; n.at = M.util.fmtDT(new Date(e.ts - 600000)); return () => { n.at = o; }; }],
  ['案件取证材料早于告警触发', () => { const f = M.evidenceFiles.find(x => ['光电录像','光电抓拍图','雷达轨迹快照','现场照片'].includes(x.kind) && x.refs.some(r => r.kind === 'case')); const c = M.cases.find(y => y.id === f.refs.find(r => r.kind === 'case').id); const d = new Date(c.ts - 600000); const o = f.capturedAt; f.capturedAt = d.toISOString().slice(0,19).replace('T',' '); return () => { f.capturedAt = o; }; }],
  ['归档记录说不出产生动作', () => { const f = M.evidenceFiles[5]; const o = f.originAction; f.originAction = ''; return () => { f.originAction = o; }; }],
  ['来源模块暴露内部标识', () => { const f = M.evidenceFiles[6]; return set(f, 'srcModule', 'rule-engine'); }],
  ['上级下发的空域被置为可编辑', () => { const a = M.airspaces.find(x => x.source === '上级管控平台'); return set(a, 'editable', true); }],
  ['空域缺少数据来源声明', () => { const a = M.airspaces[2]; const o = a.source; delete a.source; return () => { a.source = o; }; }],
  ['调测结论与实测指标脱钩', () => { const t = M.commTasks.find(x => x.result === '成功'); return set(t, 'result', '失败'); }],
  ['调测单项判定用了别的阈值', () => { const t = M.commTasks.find(x => x.items.some(i => i.k === '时延')); const it = t.items.find(i => i.k === '时延'); const o = it.th; it.th = 999; return () => { it.th = o; }; }],
  ['失败的调测说不出哪项不合格', () => { const t = M.commTasks.find(x => x.result === '失败'); const o = t.failedItems.slice(); t.failedItems = []; return () => { t.failedItems = o; }; }],
  ['指令报文取证时刻兜底成基准时刻', () => { const f = M.evidenceFiles.find(x => x.kind === '指令报文与回执'); return set(f, 'capturedAt', '2026-08-26 10:24:36'); }],
  ['失锁区间被标成实测', () => { const t = uav().find(x => x.facts && x.facts.trackOcclusion && x.track_points.some(p => p.kind === 'bridge')); const o = t.track_points.map(p => p.kind); t.track_points.forEach(p => p.kind = 'meas'); return () => t.track_points.forEach((p, i) => p.kind = o[i]); }],
  ['未失锁却出现弥合段', () => { const t = uav().find(x => x.facts && x.facts.trackOcclusion === false); const o = t.track_points[3].kind; t.track_points[3].kind = 'bridge'; return () => { t.track_points[3].kind = o; }; }],
  ['某角色没有可用账号', () => { const us = M.users.filter(u => u.role === 'R5'); const o = us.map(u => u.status); us.forEach(u => u.status = '已停用'); return () => us.forEach((u, i) => u.status = o[i]); }],
  ['审计员被赋予反制授权', () => { const i = M.PERM_MODULES.indexOf('反制/干扰授权'); const o = M.PERM.R5[i]; M.PERM.R5[i] = 'AUTH'; return () => { M.PERM.R5[i] = o; }; }],
  ['处置授权人被收回反制授权', () => { const i = M.PERM_MODULES.indexOf('反制/干扰授权'); const o = M.PERM.R2[i]; M.PERM.R2[i] = 'OP'; return () => { M.PERM.R2[i] = o; }; }],
  ['停用账号仍被放行', () => { const u = M.users.find(x => x.status !== '正常'); return set(u, 'status', '正常'); }],
  /* 下面这组针对"构造按规则 R、断言查规则 R"的一类断言 —— 静态筛把它们标为候选同源，
     但它们守的是**别处的代码违反 R**（场景改写、后续赋值），而不是构造自身。
     所以要证伪它们，注入必须模拟"别处赋了值"，而不是改构造。 */
  ['雷达目标被赋予 uav_sn', () => { const t = M.allTargets.find(x => x.type === '无人机' && !x.uav_sn && (!x.pilotPosition || !['协议破解', 'RemoteID'].includes(x.pilotPosition.device))); return t ? set(t, 'uav_sn', 'UAS123456') : null; }],
  ['光电目标被赋予分类置信度', () => { const t = M.allTargets.find(x => x.classification_confidence == null); return t ? set(t, 'classification_confidence', 0.9) : null; }],
  ['空域限高未声明基准', () => { const a = M.airspaces.find(x => x.limit !== 0); return a ? set(a, 'limitDatum', null) : null; }],
  ['今日遥控器被计入空中目标统计', () => { const t = M.todayTargets.find(x => x.type === '遥控器'); return t ? set(t, 'type', '无人机') : null; }],
  ['空中目标口径里混入遥控器', () => { const t = M.airborneTargets ? M.airborneTargets[0] : null; return t ? set(t, 'type', '遥控器') : null; }],
  ['非法目标的违规事由被清空', () => { const t = M.allTargets.find(x => x.legal === '非法'); const o = t.violation_reasons; t.violation_reasons = []; return () => { t.violation_reasons = o; }; }],
  ['案件指向非无人机目标', () => { const c = M.cases[0]; return set(c, 'targetId', M.allTargets.find(x => x.type === '鸟').id); }],
  ['驱鸟设备从台账消失', () => { const ds = M.devices.filter(d => d.deviceTypeAbbr === 'bsc'); const os = ds.map(d => d.deviceTypeAbbr); ds.forEach(d => d.deviceTypeAbbr = 'radar'); return () => ds.forEach((d, i) => d.deviceTypeAbbr = os[i]); }],
  ['反制设备 workState=0 被判为异常', () => { const d = M.devices.find(x => ['cm', 'dec', 'ifr', 'bsc'].includes(x.deviceTypeAbbr) && x.workState === 0); return d ? set(d, 'status', '异常') : null; }],
  ['轨迹状态被写成处置状态', () => set(M.allTargets[11], 'track_status', '处置中')],
  /* C02-3 航线偏离：无走廊几何时该事由无判据可依。
     三条注入分别对应三条断言 —— 事由凭空出现 / 不可判定未声明 / 不可判定被当成违规。 */
  ['无批准航线却判出偏离报备航线', () => { const t = uav().find(x => x.facts && x.facts.offRoute === null); const o = t.violation_reasons.slice(); t.violation_reasons = o.concat('偏离报备航线'); return () => { t.violation_reasons = o; }; }],
  ['偏航事由与 offRoute 事实脱钩', () => { const t = uav().find(x => x.facts && x.facts.offRoute === false); const o = t.violation_reasons.slice(); t.violation_reasons = o.concat('偏离报备航线'); return () => { t.violation_reasons = o; }; }],
  ['判偏航却没有轨迹', () => { const t = uav().find(x => x.facts && x.facts.offRoute === true); const o = t.track_points; t.track_points = []; return () => { t.track_points = o; }; }],
  ['offRoute 结论与几何复算不符', () => { const t = uav().find(x => x.facts && x.facts.offRoute === false && x.routeId); return set(t.facts, 'offRoute', true); }],
  ['track_points 被清空（Schema 必需字段）', () => { const t = uav().find(x => x.track_points && x.track_points.length); const o = t.track_points; t.track_points = null; return () => { t.track_points = o; }; }],
  ['track_status 与 facts 脱钩', () => { const t = uav().find(x => x.facts && x.facts.trackStatus === '稳定'); return set(t, 'track_status', '终止'); }],
  ['轨迹状态与轨迹质量不符', () => { const t = uav().find(x => x.facts && x.facts.maneuverEvents === 0 && !x.revised && !x.factsOverridden && x.facts.trackStatus === '稳定'); return t ? (function () { const o = t.facts.trackStatus; t.facts.trackStatus = '暂定'; t.track_status = '暂定'; return () => { t.facts.trackStatus = o; t.track_status = o; }; })() : null; }],
  /* 必须挑「事实确实与推导公式不符」的那个被改写目标：
     三个被标记的目标里只有一个真的偏离公式，挑错了这条注入不会产生真违例。 */
  ['场景改写事实但不留痕', () => {
    const f = x => x.facts.trackTerminated ? '终止' : x.facts.trackOcclusion ? '短时丢失' : (x.facts.maneuverEvents ? '暂定' : '稳定');
    const t = M.allTargets.find(x => x.factsOverridden && x.type === '无人机'
      && x.facts && x.facts.maneuverEvents !== undefined && x.facts.trackStatus !== f(x) && !x.revised);
    if (!t) return null;
    const o = t.factsOverridden; delete t.factsOverridden; return () => { t.factsOverridden = o; };
  }],
  ['offRoute 不可判定但未在 undeterminable 声明', () => { const t = uav().find(x => x.facts && x.facts.offRoute === null && (x.undeterminable || []).length); const o = t.undeterminable.slice(); t.undeterminable = []; return () => { t.undeterminable = o; }; }],
  ['计划对照给出横向偏航数值', () => { const p = M.flightPlans.find(x => x.deviation); return set(p.deviation, 'lateral', 420); }],
  /* 航线实体（设计 §8.5） */
  ['航路点走出东营范围', () => { const w = M.routes[0].waypoints[1]; return set(w, 'lon', 120.5); }],
  ['航线只剩一个航路点', () => { const r = M.routes[1]; const o = r.waypoints.slice(); r.waypoints = [o[0]]; return () => { r.waypoints = o; }; }],
  ['航线状态越界', () => set(M.routes[2], 'status', '待审批')],
  ['航线引入第三套高度基准', () => set(M.routes[3], 'altDatum', 'ellipsoid')],
  ['计划改挂别的航线但不更新反向关联', () => { const p = M.flightPlans.find(x => x.routeId); const other = M.routes.find(r => r.id !== p.routeId); return set(p, 'routeId', other.id); }],
  ['航路点数被存成字符串副本', () => { const p = M.flightPlans[0]; const d = Object.getOwnPropertyDescriptor(p, 'route'); delete p.route; p.route = '5 个航路点'; return () => { delete p.route; Object.defineProperty(p, 'route', d); }; }],
  ['C01 匹配档越界', () => { const t = uav().find(x => x.facts && x.facts.planMatch); return set(t.facts, 'planMatch', '大致命中'); }],
  ['航线走廊不可判定却报完全命中', () => { const t = uav().find(x => x.facts && x.facts.planMatch === '部分命中'); return set(t.facts, 'planMatch', '完全命中'); }],
  ['未命中却不报未经批准飞行', () => { const t = uav().find(x => x.facts && x.facts.planMatch === '未命中'); const o = t.violation_reasons.slice(); t.violation_reasons = o.filter(v => v !== '未经批准飞行'); return () => { t.violation_reasons = o; }; }],
  ['部分命中且无越界依据却判非法', () => { const t = uav().find(x => x.facts && x.facts.planMatch === '部分命中' && !x.facts.inNoFlyZone && !x.facts.overZoneHeight && !x.facts.overZoneTime && x.legal !== '非法'); return t ? set(t, 'legal', '非法') : null; }],
  ['不可判定项同时被写进违规事由', () => { const t = uav().find(x => (x.undeterminable || []).length); const o = t.violation_reasons.slice(); t.violation_reasons = o.concat(t.undeterminable[0]); return () => { t.violation_reasons = o; }; }],
  /* COM-04 证据台账。注意区分「真缺陷」与「规范变更」：
     改 status 让冻结文件被销毁 = 违反规则（必抓）；
     改 legalHold 让它不再冻结 = 改的是规则本身（spec，见下方 spec 组）。
     两者混在一起会得到一条"看起来能抓、实际抓不住"的断言。 */
  ['冻结中的证据被销毁', () => { const f = M.evidenceFiles.find(x => x.legalHold); return f ? set(f, 'status', '已销毁') : null; }],
  ['销毁记录被抹掉', () => { const f = M.evidenceFiles.find(x => x.status === '已销毁'); if (!f) return null; const o = f.destroyBy; delete f.destroyBy; return () => { f.destroyBy = o; }; }],
  ['删掉一份证据但不改案件件数', () => { const i = M.evidenceFiles.findIndex(x => x.refs.some(r => r.kind === 'case')); const f = M.evidenceFiles.splice(i, 1)[0]; return () => M.evidenceFiles.splice(i, 0, f); }],
  ['校验异常的处置说明被清空', () => { const f = M.evidenceFiles.find(x => x.verifyState === '哈希不一致'); return f ? set(f, 'verifyNote', '') : null; }],
  ['证据的关联被清空（孤儿证据）', () => { const f = M.evidenceFiles[10]; const o = f.refs; f.refs = []; return () => { f.refs = o; }; }],
  ['证据引用指向不存在的案件', () => { const f = M.evidenceFiles.find(x => x.refs.some(r => r.kind === 'case')); const r = f.refs.find(x => x.kind === 'case'); return set(r, 'id', 'CF_NOT_EXIST'); }],
  ['未结案案件的证据被解除冻结', () => { const f = M.evidenceFiles.find(x => x.legalHold); return f ? set(f, 'legalHold', false) : null; }],
  ['证据类型越界', () => set(M.evidenceFiles[3], 'kind', '录音')],
  ['到期日往前拨但不动取证日', () => { const f = M.evidenceFiles[6]; const y = +f.retainUntil.slice(0, 4); return set(f, 'retainUntil', (y - 1) + f.retainUntil.slice(4)); }],
  ['取证时刻落在未来', () => set(M.evidenceFiles[8], 'capturedAt', '2026-12-01 10:00:00')],
  /* 证据时间方向：两个方向相反，各测一次 —— 只测一个方向等于断言只有一半在工作 */
  ['事件取证类晚于事件结束', () => { const f = M.evidenceFiles.find(x => ['光电录像', '光电抓拍图', '雷达轨迹快照'].includes(x.kind) && x.refs.some(r => r.kind === 'case')); const c = M.cases.find(y => y.id === f.refs.find(r => r.kind === 'case').id); const d = new Date(c.time.replace(' ', 'T')); d.setDate(d.getDate() + 5); const o = f.capturedAt; f.capturedAt = d.toISOString().slice(0, 19).replace('T', ' '); return () => { f.capturedAt = o; }; }],
  ['事后材料类早于案发', () => { const f = M.evidenceFiles.find(x => ['处罚文书', '通报单回执', '现场照片', '指令报文与回执'].includes(x.kind) && x.refs.some(r => r.kind === 'case')); const c = M.cases.find(y => y.id === f.refs.find(r => r.kind === 'case').id); const d = new Date(c.time.replace(' ', 'T')); d.setDate(d.getDate() - 9); const o = f.capturedAt; f.capturedAt = d.toISOString().slice(0, 19).replace('T', ' '); return () => { f.capturedAt = o; }; }],
  ['留存期退回统一年限', () => { const f = M.evidenceFiles.find(x => x.kind === '调测报告'); const o = { d: f.retainDays, y: f.retainYears }; f.retainDays = null; f.retainYears = 5; return () => { f.retainDays = o.d; f.retainYears = o.y; }; }],
  ['证据状态与到期日脱钩', () => { const f = M.evidenceFiles.find(x => x.status === '在库' && x.retainLeftDays > 40); return set(f, 'status', '已到期待清理'); }],
  ['入库早于取证', () => { const f = M.evidenceFiles[9]; return set(f, 'ingestAt', '2020-01-01 00:00:00'); }],
  /* spec 类：改的是**规范/声明本身**，不是数据违反规范。
     数据层判不了它对不对 —— 声明是原始事实，没有第二个来源可以拿来比。
     硬要让它被捕获，只能再编一份声明去和它比，那就成了我们在治的恒真断言。 */
  ['【规范】临时管制区不再算绝对禁止空间', () => { const t = M.AIRSPACE_TYPES.find(x => x.type === '临时管制区'); return t ? set(t, 'forbidsAllPlans', false) : null; }, 'spec'],
  ['【规范】留存期从 5 年改为 1 年', () => { const o = M.EVID_PARAMS.retainYears; M.EVID_PARAMS.retainYears = 1; return () => { M.EVID_PARAMS.retainYears = o; }; }, 'spec'],
  ['【规范】冲突判定最小重叠率调到 100%', () => { const o = M.CONFLICT_MIN_OVERLAP; M.CONFLICT_MIN_OVERLAP = 100; return () => { M.CONFLICT_MIN_OVERLAP = o; }; }, 'spec'],
  /* 「X 合计 = Y 总数」这一族最容易两端同源：两边都从同一个数组现算，
     那么往数组里塞一条也不会让它失败。下面每条都是往底层数组注入，
     真断言会红，恒真断言不会 —— 这是分辨这一族的唯一办法。 */
  ...[['interfaces', '接口清单'], ['archiveLogs', '归档日志'], ['riskEvents', '风险事件'],
    ['devices', '设备台账'], ['users', '用户'], ['airspaces', '空域'], ['flightPlans', '飞行计划'],
    ['alarms', '告警'], ['cases', '案件'], ['allTargets', '目标']]
    .filter(([k]) => Array.isArray(M[k]))
    .map(([k, label]) => [`${label}数组多出一条`, () => {
      const arr = M[k];
      const clone = JSON.parse(JSON.stringify(arr[0]));
      clone.id = 'FALSIFY_' + k;
      arr.push(clone);
      return () => { const i = arr.indexOf(clone); if (i >= 0) arr.splice(i, 1); };
    }, 'probe'])
];

/* ---- 静态筛：同源的断言必然恒真，不用等注入就能判掉 ----
   只查一种机械可判的形态：**条件里比的字面量，在数据构造处也被写死**
   （`filingSnapshot.legal_status === '非法'` 而快照里正是写死的 '非法' —— 恒真）。

   曾经还有一条"比较两侧共用标识符"，已删：`设备总数 === 在线+离线+异常` 这类
   共用容器名是正常写法，那条一次报出 36 条候选，绝大多数是好断言。
   一个把好断言也标红的筛子，最后的结果是没人看它 —— 这正是我们在治的病。 */
function staticScreen() {
  const fs = require('fs');
  const src = fs.readFileSync(MOCK_FILE, 'utf8');
  const sc = src.indexOf('function selfCheck');
  const body = src.slice(sc);
  const build = src.slice(0, sc);                       // 数据构造区（selfCheck 之前）
  const out = [];
  // 逐个 add( 调用取出「条件表达式 + 断言名」
  const re = /add\(\s*(['`])([\s\S]*?)\1\s*,([\s\S]*?)\);\n/g;
  let m;
  while ((m = re.exec(body))) {
    const name = m[2], cond = m[3].split(/,\s*['`]/)[0];
    // ② 与写死的字面量比
    (cond.match(/['\`]([^'\`\n]{2,20})['\`]/g) || []).forEach(lit => {
      const v = lit.slice(1, -1);
      if (!/[\u4e00-\u9fa5A-Za-z]/.test(v)) return;
      const asAssign = new RegExp('[:=]\\s*[\'\`]' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\'\`]');
      if (asAssign.test(build)) out.push({ name, why: `与数据构造处写死的字面量「${v}」比较` });
    });
  }
  // 同一条断言的多个理由合并
  const byName = {};
  out.forEach(o => { (byName[o.name] = byName[o.name] || new Set()).add(o.why); });
  return byName;
}

const everRed = new Set();
const perInj = [];
INJECTIONS.forEach(([label, apply, kind]) => {
  let undo = null;
  try { undo = apply(); } catch (e) { perInj.push({ label, kind, err: e.message, hit: [] }); return; }
  if (!undo) { perInj.push({ label, kind, skip: '数据中无适用样本', hit: [] }); return; }
  let res, crash = null;
  try { res = M.selfCheck(); } catch (e) { crash = e.message; res = []; }
  const hit = res.filter(a => !a.ok).map(a => a.name);
  hit.forEach(n => everRed.add(n));
  undo();
  let after = [];
  try { after = M.selfCheck(); } catch (e) { after = [{ ok: false }]; }
  perInj.push({ label, kind, hit, crash, restored: after.every(a => a.ok) });
});

console.log(`\n${C.b}断言证伪 · ${names.length} 条断言 × ${INJECTIONS.length} 种注入${C.x}`);
console.log('─'.repeat(72));
let dirty = 0;
perInj.forEach(p => {
  if (p.err) { console.log(`${C.y}⚠ 注入失败${C.x}  ${p.label}  ${C.d}${p.err}${C.x}`); return; }
  if (p.skip) { console.log(`${C.d}○ 跳过${C.x}    ${p.label}  ${C.d}${p.skip}${C.x}`); return; }
  if (p.crash) { dirty++; console.log(`${C.r}✗ 自检崩溃${C.x}  ${p.label}  ${C.d}${p.crash}${C.x}`);
    console.log(`  ${C.d}断言抛异常会中断整个 selfCheck —— 一条没写稳，全部都不显示。按失败报，不按崩溃报。${C.x}`); return; }
  if (!p.restored) { dirty++; console.log(`${C.r}✗ 未还原${C.x}  ${p.label}`); return; }
  const tag = p.hit.length ? `${C.g}✓ 被捕获${C.x}`
    : p.kind === 'probe' ? `${C.y}◇ 两端同源${C.x}`
      : p.kind === 'spec' ? `${C.y}◈ 规范变更${C.x}` : `${C.r}✗ 无人捕获${C.x}`;
  console.log(`${tag}  ${p.label}` + (VERBOSE && p.hit.length ? `\n${C.d}          ↳ ${p.hit.join('；')}${C.x}` : `  ${C.d}(${p.hit.length} 条断言报红)${C.x}`));
});

const never = names.filter(n => !everRed.has(n));
console.log('─'.repeat(72));
const live = perInj.filter(p => !p.err && !p.skip);
const must = live.filter(p => !p.kind);
const missed = must.filter(p => p.restored && !p.hit.length);
const sameSrc = live.filter(p => p.kind === 'probe' && p.restored && !p.hit.length);
const specs = live.filter(p => p.kind === 'spec');
console.log(`必抓注入　　${must.filter(p => p.hit.length).length} / ${must.length} 被捕获`);
console.log(`断言被触发　${everRed.size} / ${names.length}`);
const stat = staticScreen();
if (never.length) {
  console.log(`\n${C.y}以下 ${never.length} 条断言未被任何注入弄红 —— 需人工确认它能否失败：${C.x}`);
  never.forEach(n => {
    const s2 = stat[n];
    console.log(`  ${C.d}·${C.x} ${n}` + (s2 ? `\n      ${C.r}⚠ 静态可疑：${[...s2].join('；')}${C.x}` : ''));
  });
}
const suspects = Object.keys(stat).filter(n => names.includes(n));
if (suspects.length) {
  console.log(`\n${C.y}静态筛出 ${suspects.length} 条候选同源断言（含已被注入弄红的，需人工判定）：${C.x}`);
  suspects.forEach(n => console.log(`  ${C.d}·${C.x} ${n}\n      ${C.d}${[...stat[n]].join('；')}${C.x}`));
}
if (missed.length) {
  console.log(`\n${C.r}以下注入无人捕获 —— 缺少对应断言：${C.x}`);
  missed.forEach(p => console.log(`  ${C.d}·${C.x} ${p.label}`));
}
if (specs.length) {
  console.log(`\n${C.y}以下改的是规范本身，数据层无法判定对错（不算缺陷）：${C.x}`);
  specs.forEach(p => console.log(`  ${C.d}·${C.x} ${p.label}` + (p.hit.length ? ` ${C.d}（顺带被 ${p.hit.length} 条断言捕获）${C.x}` : '')));
  console.log(`  ${C.d}声明是原始事实，没有第二个来源可比 —— 再编一份去比它，就成了恒真断言。${C.x}`);
  console.log(`  ${C.y}注意这类改动的性质：它不会在任何地方"变红"。${C.x}`);
  console.log(`  ${C.d}引擎、断言、参数总览、图例会全部一致地反映新声明，看起来比改之前还整齐。${C.x}`);
  console.log(`  ${C.d}风险不是"某处漏改了"，而是"全都改了，但没人签过字"。${C.x}`);
  console.log(`  ${C.d}防线在文档评审与业务方签认（见「参数总览」的确认状态），不在自检里。${C.x}`);
}
if (sameSrc.length) {
  console.log(`\n${C.y}以下聚合两端同源（数据层无对应不变量，不算缺陷）：${C.x}`);
  sameSrc.forEach(p => console.log(`  ${C.d}·${C.x} ${p.label}`));
  console.log(`  ${C.d}这类数字页面若硬编码，本层查不出 —— 归 tools/scan.js 的源码规则管。${C.x}`);
}
const fail = dirty > 0 || missed.length > 0;
console.log('─'.repeat(72));
console.log(fail ? `${C.r}存在未被捕获的必抓注入或未还原的数据${C.x}` : `${C.g}全部必抓注入均被捕获${C.x}`);
process.exit(fail ? 1 : 0);
