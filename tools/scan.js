#!/usr/bin/env node
/* =============================================================================
 * tools/scan.js —— 源码级合规扫描（真正的"全站"检查）
 *
 * 起因：mock.js 的 selfCheck() 只能校验数据集内部，无法看到页面代码。
 * 曾出现「全站不存在 ADS-B」断言通过、而 monitor.js 图例里仍渲染 ADS-B 的情况——
 * 名不副实的断言比没有断言更危险。故把跨文件的禁令检查独立成本脚本。
 *
 * 用法：node tools/scan.js        （退出码 0 = 全部通过，1 = 有违规）
 * ========================================================================== */
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'js');

/* 收集待扫描文件：assets/js/**\/*.js，排除 vendor 与本脚本 */
function collect(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name);
    const st = fs.statSync(f);
    if (st.isDirectory()) { if (name !== 'vendor') collect(f, out); }
    else if (name.endsWith('.js')) out.push(f);
  }
  return out;
}
const FILES = collect(SRC).concat([path.join(ROOT, 'index.html')]);

/* ---- 规则：每条含 名称 / 正则 / 说明 / 白名单(允许出现的上下文) ---- */
const RULES = [
  {
    name: '不得出现 ADS-B（协议设备类型枚举中不存在）',
    /* 只抓「当成真实数据源用」的写法。说明文案里指名它是编造的，是在执行这条规则而不是违反它 ——
       规则若不认语境，就会逼着人把教训从文案里删掉，那正好把知识删没了。 */
    skipLine: /编造|不得出现|同族|凭空|协议.{0,6}没有|枚举中不存在/,
    re: /ADS-?B/gi,
    why: '三份设备协议 grep 命中数为 0，属凭空编造（V1.1 任务书 A1）'
  },
  {
    name: '不得出现编造的设备厂家名（纪要 §7）',
    re: /海康威视|中电科14所|华宇电子|中兴通讯|天衡科技|航天宏图|大疆创新科技/g,
    why: '平台团队不得自行猜测真实硬件命令、参数或算法精度'
  },
  {
    /* 只抓「当作 target_type 用」的写法：类型筛选下拉、按 type 比较、类型分布数据源。
       AI_SUBTYPES 推断池与守护本规则的断言里出现这些词是合法的，故排除 subtype 上下文。 */
    name: '风筝/气球/孔明灯不得作为 target_type（只能是算法推断 subtype）',
    re: /['"](风筝|气球|孔明灯)['"]/g,
    why: 'objectType 只有 0/3/7/30/40/50/100/255 八值，设备侧报不出这三类（V1.1 任务书 A4）',
    // 豁免：subtype 推断池、来源标签、以及守护本规则的断言自身（断言正是在检查"不得作 type"）
    skipLine: /subtype|AI_SUBTYPES|srcTag|推断|includes\(t\.type\)|作为 target_type/
  },
  {
    name: '处置流程条必须引用 DISPOSAL_FLOW，不得自建环节数组',
    re: /\[\s*['"]告警触发['"]\s*,|\[\s*['"]发现违法['"]\s*,/g,
    why: '同一案件在不同页面显示不同环节，评审时当场会被抓（V1.1 任务书 B1）'
  },
  {
    /* A5 并存期专用：改了 legal/violation/risk 旧字段却没同步 Schema 字段，两套值会漂移。
       只在 mock.js 内检查赋值语句（页面层不应直接赋值这些字段）。 */
    name: 'A5 并存期：改旧判定字段必须同步 Schema 字段',
    re: /\.(legal|violation|risk)\s*=\s*(?!=)/g,
    why: '旧字段与 Schema 字段（legal_status/violation_reasons/risk_level）必须同步更新，否则回归时两套值漂移',
    onlyFiles: /mock\.js$/,
    skipLine: /legal_status|violation_reasons|risk_level|\/\/|\*/,
    // 配对写在相邻行同样算已同步（本轮为可读性把三组赋值拆成了多行）
    skipWindow: /violation_reasons|legal_status|risk_level/
  },
  {
    /* 平台当前时刻只有一个来源 M.now()。第二个时间源即使公式相同也会对不齐 ——
       app.js 的顶栏时钟原来自己捕获起点，比 M.now() 慢 5 秒；situation.js 的处置日志
       直接用机器时间，连时区都不同（平台显示 10:42，日志写 04:10）。
       app.js 一并纳入、不留例外：留了例外，下一个人就会把新的时间源写进外壳层。 */
    name: '页面与外壳层不得直接取系统时间（展示用时间戳须派生自 M.now()）',
    re: /new Date\s*\(\s*\)|Date\.now\s*\(/g,
    why: '第二个时间源与 M.now() 必然对不齐；界面上会同时出现两个"当前时刻"',
    // 注意：onlyFiles 匹配的是**绝对路径**，不能用 ^ 锚定。写 ^assets/... 会永不匹配，
    // 而规则照样显示绿灯 —— 一条作用域为空的规则和不存在没有区别。
    onlyFiles: /pages\/.*\.js$|assets\/js\/(app|ui|map|charts|video|search)\.js$/,
    // 豁免必须在相邻行显式声明用途，不接受隐式匹配
    skipWindow: /性能计时|耗时测量|逐帧动画|requestAnimationFrame|非展示用/
  },
  {
    /* 渲染期裸用随机数：同一份数据每次重绘都不一样，看起来像"实时变化"，
       实际只是无关交互触发了 paint()。派生展示值必须用 CH.seeded(稳定键) —— 同键同值。
       mock.js 是数据构造层，rnd() 本就是它的职责，故豁免。 */
    name: '页面层不得在渲染期裸用 Math.random（派生展示值须用 CH.seeded）',
    re: /Math\.random\s*\(/g,
    why: '无关交互触发重绘时数值会跳，读的人会以为数据在变；应改用 CH.seeded(稳定键)',
    onlyFiles: /pages\/.*\.js$|assets\/js\/(ui|map|charts|video)\.js$/,
    // 豁免必须显式写在上一行注释里（实时推流/动画），不接受隐式豁免
    skipWindow: /实时推流|逐帧动画|requestAnimationFrame/
  },
  {
    name: '不得出现旧状态枚举值',
    /* 告警页现允许用 flowStatus 展示“待处置”，但共享数据层的 status 仍不得写入该旧值。 */
    re: /(?:\bstatus\s*[:=]\s*['"]待处置['"]|['"]误报\/排除['"])/g,
    why: '共享 alarm_status 仍为新建/已确认/处置中/已关闭/误报；页面 flowStatus 可使用待处置'
  },
  {
    /* ── 兜底不得替换为另一个真实实体 ──────────────────────────────
       起因：`find(x => x.id === r.zoneId) || protectZones[0]` —— 上游停止写 zoneId 后
       （实测 0/153 有值），每条事件都显示成"第一个保护对象"的类型与半径：
       类型有值、半径有值、格式正常，**看不出任何异常**。
       兜底把"字段没了"变成了"字段有个错值"，比直接报错难发现得多；
       同族的还有 `find(admin) || users[0]`（拿别人冒充当前用户）、
       `find('当前生效') || versions[0]`（拿历史版本冒充现行规则）、
       `find(区名) || DISTRICTS[0]`（把新空域静默放到另一个区，再拿它去跑冲突检测 ——
       对着错误位置算出的"未检测到冲突"是一句错的保证，比不检测更糟）。

       判据不是形状，是**这个值有没有以用户可见、可纠正的形式呈现**：
       · 默认选中列表首项 ⇒ 安全。用户看得见选的是谁，也能随手改。
       · 解析成某个东西的类型/来源/身份/版本 ⇒ 不安全。它是一句断言，后续判定会直接采信。
       前者是后者的充分条件，且不需要追踪"这个变量后来去哪了"。

       但正则读不出"用户能不能纠正它"。所以本规则**不判断语义，只强制那个判断被写下来**：
       命中形状的行，必须在本行或上一行显式声明豁免

           // safe-default: 默认选中，用户可见可改

       没有声明的才报。自动豁免会成为新的漏洞，声明式豁免留下一条可审查的记录。 */
    name: '兜底不得替换为另一个真实实体（未声明豁免的 find(...) || 集合[下标]）',
    re: /\.find\s*\([^)]*\)\s*\|\|\s*[A-Za-z_$][\w$.]*\s*\[\s*\d+\s*\]/g,
    why: '兜底可以降级为"显示不了"，不可以替换成另一个实体：前者用户看得见，后者用户看不见。'
      + '确属安全默认（如默认选中，用户可见可改）请在该行或上一行写 // safe-default: 理由',
    skipWindow: /safe-default\s*:/,
    /* 先入待办档而不是违规档：现存命中全部落在本规则作者以外的文件里
       （map.js / mock.js / legality.js / users.js），而"这个兜底安不安全"只有属主判断得了。
       让新规则一上来就把全站 scan 判红，等于替别人做了判断，还会逼人为了让它变绿而
       随手加豁免注释 —— 那正是声明式豁免最该避免的用法。
       各属主标注完（或改掉）之后，把 todo 去掉即转为硬性违规。 */
    todo: true
  }
];

let fail = 0, todo = 0;
const results = [];
for (const rule of RULES) {
  const hits = [];
  for (const f of FILES) {
    if (rule.onlyFiles && !rule.onlyFiles.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    /* 块注释的**续行**也是注释：`/* ... ` 之后、`*​/` 之前的每一行都不是代码。
       只判断行首 // 或 * 会漏掉不以 * 开头的续行 —— 我写的那段说明里提到
       `Date.now()` 就被自己的规则判成了违规。 */
    let inBlock = false;
    text.split('\n').forEach((line, i) => {
      const wasInBlock = inBlock;
      const opens = (line.match(/\/\*/g) || []).length, closes = (line.match(/\*\//g) || []).length;
      if (opens > closes) inBlock = true; else if (closes > 0 && closes >= opens) inBlock = false;
      if (!rule.alsoComments && (wasInBlock || (opens > 0 && closes === 0))) return;
      rule.re.lastIndex = 0;
      if (rule.skipLine && rule.skipLine.test(line)) return;   // 合法上下文豁免
      /* 注释行不是代码。规则若把说明文字也算违规，就会逼人把教训从注释里删掉 ——
         而那正好把知识删没了（ADS-B 那条已经被这么误伤过一次）。
         需要连注释一起查的规则显式声明 alsoComments: true。 */
      if (!rule.alsoComments && /^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // 有些规则的"配对写法"会跨行（如旧字段与 Schema 字段各占一行），
      // 逐行匹配会误报。skipWindow 让规则在相邻若干行内寻找配对证据。
      if (rule.skipWindow) {
        const lines = text.split('\n');
        const lo = Math.max(0, i - 3), hi = Math.min(lines.length, i + 4);
        if (rule.skipWindow.test(lines.slice(lo, hi).join('\n'))) return;
      }
      if (rule.re.test(line)) {
        hits.push({ file: path.relative(ROOT, f), line: i + 1, text: line.trim().slice(0, 96) });
      }
    });
  }
  results.push({ rule, hits });
  if (hits.length) { if (rule.todo) todo++; else fail++; }
}

/* ---- 输出 ---- */
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', x: '\x1b[0m' };
console.log(`\n源码级合规扫描 · ${FILES.length} 个文件\n${'─'.repeat(64)}`);
for (const { rule, hits } of results) {
  const bad = hits.length > 0;
  const tag = !bad ? `${C.g}✓ 通过${C.x}` : rule.todo ? `${C.y}○ 待办${C.x}` : `${C.r}✗ 违规${C.x}`;
  console.log(`${tag}  ${rule.name}`);
  if (bad) {
    console.log(`      ${C.d}${rule.why}${C.x}`);
    hits.slice(0, 8).forEach(h => console.log(`      ${C.d}${h.file}:${h.line}${C.x}  ${h.text}`));
    if (hits.length > 8) console.log(`      ${C.d}… 另有 ${hits.length - 8} 处${C.x}`);
  }
}
console.log('─'.repeat(64));
if (fail) console.log(`${C.r}${fail} 条规则违规${C.x}${todo ? `，${todo} 条待办` : ''}\n`);
else console.log(`${C.g}全部通过${C.x}${todo ? `（${todo} 条待办，见上）` : ''}\n`);
process.exit(fail ? 1 : 0);
