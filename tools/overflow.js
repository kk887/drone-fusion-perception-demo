#!/usr/bin/env node
/* 横向溢出体检探针（生成器）
   ------------------------------------------------------------------
   为什么是"生成器"而不是像 scan.js 那样直接出结论：
   横向溢出是**布局量**，必须有真实排版引擎才能测。本仓库无 package.json、
   无 node_modules，Node 侧拿不到 layout。所以本工具打印一段自检探针，
   贴进 Demo 的浏览器 console 执行。

   用法：
     node tools/overflow.js            打印探针（贴进 console 执行）
     node tools/overflow.js --copy     同时送进剪贴板（macOS）

   ── 关于"验磁盘上那份，不验脑子里那份" ──
   本工具原先放在 dongying-demo/ 内，可以用 fetch('/tools/overflow.js') 把探针原文
   抠出来 eval，测的就是磁盘上那一份。**tools/ 已移出静态服务根**（服务根里的东西
   公网隧道一开全可下载，而本目录写满内部判据与缺陷史），所以那条通路没有了。
   现在的做法（自动化环境下）：临时投放 → 取用 → 立即删除，全在同一轮内：

     node tools/overflow.js | sed -n '/^(async function/,/^})()$/p' > dongying-demo/.probe.tmp.js
     # 浏览器：fetch('/.probe.tmp.js') → eval
     rm dongying-demo/.probe.tmp.js

   仍然是"从磁盘取"，中间不经人工改写；暴露窗口只有几秒，且文件已进 .gitignore。
   手工场景直接 `--copy` 贴进 console 也可以，关键是**现场生成**：
   同一轮里从磁盘生成、立刻使用。**不要保存一份探针副本反复用** ——
   那就退回成"验脑子里那份"了。

   ── 判据为什么长这样：四版都错过 ──────────────────────────────
   v1  查 `.scroll` 类名
       → 类名≠滚动容器。app.css 里 `.pb` 有 overflow:auto 却没有这个类，
         于是九次复现全部落空，真正溢出的元素一次都没进过查询结果。
   v2  查元素自身 computed overflow-x
       → 仍然错：在 **overflow:visible 的元素**上量 scrollWidth 毫无意义。
         visible 元素越界只是"画到自己盒外"，裁切只发生在
         **最近的非 visible 祖先**上。risk 页那 4~5px 就是这么误报的：
         内容画到 x=1395，而最近的裁切祖先右边界 1414 —— 一个字都没少。
   v3  加 ellipsis / 可滚动 豁免
       → 把 auto/scroll 整档豁免掉了，等于把"出现横向滚动条"这类缺陷
         从体检里删掉 —— 而那正是本项目当初要治的东西。
   v4  只在**裁切容器**上判定，并分两档（见下）。

   ── 两档 ────────────────────────────────────────────────────
   A 静默裁切  ：overflow-x 为 hidden/clip 且内容越界
                 ⇒ 用户没有任何手段看到，属数据可达性缺陷，必须修。
   B 横向滚动条：overflow-x 为 auto/scroll 且确实滚得动
                 ⇒ 内容可达但布局已破，属观感缺陷。
   豁免：text-overflow:ellipsis（已向用户提示截断）；
        负偏移的绝对定位装饰（如 .st::after 流程连线，实测真实内容越界为 0）。

   ── 强制自检（本工具最重要的一条）────────────────────────────
   出数前先注入一个必然溢出的 hidden 盒和一个 auto 盒，
   两档必须各抓到一个，且移除后归零，才允许打印结果。
   理由：**测量工具坏掉时的表现是"全绿"，与真的没问题完全一样。**
   探针自己就出过这个 bug —— overflow:hidden 的盒子 scrollLeft
   可以被脚本改写，被误判成"用户可滚动"而豁免，注入的真阳性没被抓到；
   若不是先注入真阳性，这个 bug 会一直躺着而报告一直全绿。
   注入必须覆盖工具声称能查的**每一类**，只验证其中一类不足以说明其余有效。
   （这与 falsify.js 对断言做定向注入是同一条纪律，
     区别只在对象：那边约束判定逻辑，这边约束测量工具本身。）

   ── 环境限制：有一类问题本工具查不到 ──────────────────────────
   本探针量的是**导航后的静态渲染态**。
   `scrollWidth`/`getBoundingClientRect` 是同步读取，不依赖 RO/rAF，
   因此即使在隐藏的浏览器面板里也有效。
   但"渲染完再改变窗口宽度、不重新导航"这条**重排路径查不了**：
   面板隐藏时 document.hidden=true，ResizeObserver 与 rAF 一次都不触发
   （实测 RO 回调数为 0，连 observe 后本该有的首次回调都没有），
   charts.js 里 `ResizeObserver → ch.resize()` 因此跑不起来，
   读到的溢出全是环境假象。**该路径必须在可见窗口里手动拖一次才能判定。**
   探针会读 document.hidden 并在结果里标注这条覆盖边界，不要把它测掉的当没问题。
*/
'use strict';
const { execSync } = require('child_process');

const PROBE = String.raw`
(async function () {
  const CLIP = ['hidden', 'clip', 'auto', 'scroll'];
  const contentRight = root => {
    let max = -1e9;
    const walk = n => {
      if (n.nodeType === 1) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        // 负偏移绝对定位 = 连接线一类装饰，不参与内容边界
        if (cs.position !== 'absolute' || parseFloat(cs.right) >= 0) max = Math.max(max, n.getBoundingClientRect().right);
        [...n.childNodes].forEach(walk);
      } else if (n.nodeType === 3 && n.nodeValue.trim()) {
        const rg = document.createRange(); rg.selectNodeContents(n);
        [...rg.getClientRects()].forEach(r => { if (r.width) max = Math.max(max, r.right); });
      }
    };
    [...root.childNodes].forEach(walk);
    return max;
  };
  const scan = () => {
    const A = [], B = [];
    document.querySelectorAll('#view, #view *').forEach(el => {
      const cs = getComputedStyle(el), ox = cs.overflowX;
      if (!CLIP.includes(ox)) return;                 // 不裁切 ⇒ 不判定
      if (cs.textOverflow === 'ellipsis') return;     // 已提示用户
      const tag = el.tagName + '.' + String(el.className || el.id).trim().slice(0, 26);
      if (ox === 'auto' || ox === 'scroll') {
        // 用户真能滚的只有 auto/scroll；hidden 的 scrollLeft 虽可被脚本改写，用户却滚不到
        const o = el.scrollLeft; el.scrollLeft = o + 60; const d = el.scrollLeft - o; el.scrollLeft = o;
        if (d > 1) B.push(Math.round(el.scrollWidth - el.clientWidth) + 'px ' + tag);
        return;
      }
      const r = el.getBoundingClientRect();
      const ov = Math.round(contentRight(el) - (r.right - parseFloat(cs.borderRightWidth || 0)));
      if (ov > 1) A.push(ov + 'px ' + tag);
    });
    return { A: [...new Set(A)], B: [...new Set(B)] };
  };

  // ---- 前置：视口必须达到设计基准宽度 ----
  // 真阳性自检只能证明"探针能发现溢出"，证明不了"此刻的视口值得测量"。
  // 两种情况都会让每一页报出一堆溢出，而数字看着像真的、格式也正常：
  //   · 面板被折叠 → innerWidth 为 0，读数纯属假象；
  //   · 视口低于设计基准（本项目按 1440 / 1600 设计）→ 溢出是真的，
  //     但它回答的是"这套布局支不支持 1200 宽"，**不是**"页面有没有裁切缺陷"。
  //     把后者的答案填进前者的报告，就是一次问错问题。
  // 所以不达基准一律拒绝出数，并说明拒绝的理由，而不是给一份看起来正常的清单。
  var BASE_W = 1440;
  if (innerWidth < BASE_W) {
    console.error('视口 ' + innerWidth + 'px 低于设计基准 ' + BASE_W + 'px'
      + (innerWidth === 0 ? '（面板已折叠）' : '') + ' —— 此状态下的溢出读数不回答本判据要问的问题，拒绝出数。');
    return '视口低于基准 ' + BASE_W + 'px（当前 ' + innerWidth + 'px）';
  }

  // ---- 强制自检：两档各注入一个必然溢出的真阳性 ----
  const v = document.getElementById('view');
  const mk = (id, ox) => {
    const b = document.createElement('div'); b.id = id;
    b.style.cssText = 'overflow-x:' + ox + ';width:100px';
    b.innerHTML = '<div style="width:340px">自检</div>';
    v.appendChild(b); return b;
  };
  const a = mk('__stA', 'hidden'), b = mk('__stB', 'auto');
  const s = scan();
  const okA = s.A.some(x => x.includes('__stA')) && !s.B.some(x => x.includes('__stA'));
  const okB = s.B.some(x => x.includes('__stB')) && !s.A.some(x => x.includes('__stB'));
  a.remove(); b.remove();
  const res = scan();
  const clean = !res.A.some(x => x.includes('__st')) && !res.B.some(x => x.includes('__st'));
  if (!(okA && okB && clean)) {
    console.error('探针自检未通过 —— 拒绝出数。A类真阳性:' + okA + ' B类真阳性:' + okB + ' 移除后干净:' + clean);
    console.error('工具坏掉时的表现是"全绿"，与真的没问题无法区分，所以这里必须停。');
    return '自检未通过';
  }

  // ---- 取被测文件的版本标记 ----
  // 两份报告若基于不同版本的源文件，数字不可比 —— 而报告本身看不出这一点。
  // 曾经两个会话按同一方法查同一件事，一个得"38/24、边界干净"、一个得"44/18、无边界"，
  // 都不是算错：mock.js 在两次测量之间被改了。**测量需要一个稳定的环境，
  // 就像它需要一个够宽的视口** —— 视口那条已经守住了，这条以前没有。
  // 用内容指纹而不是 Last-Modified：本地静态服务器不一定发这个头（实测就没发），
  // 而"取不到版本"和"版本没变"在报告里长得一样 —— 指纹只依赖文件内容本身，不依赖服务端配合。
  var stamp = '(未取到)';
  try {
    // 用内容指纹而不是 Last-Modified：本地静态服务器不一定发那个头（实测就没发），
    // 而"取不到版本"和"版本没变"在报告里长得一模一样 —— 指纹只依赖文件内容本身。
    // 字节数必须走 arrayBuffer().byteLength，**不能用 text().length**：
    // 后者是 UTF-16 码元数，中文一字 1 码元却占 3 字节，本文件 203841 码元 / 269693 字节。
    // 我曾拿码元数与磁盘 wc -c 比对，据此误判"取到的是缓存旧副本"，差点去修一个不存在的缓存 bug。
    var resp = await fetch('/assets/js/mock.js', { cache: 'no-store' });
    var buf = await resp.clone().arrayBuffer();
    var txt = await resp.text(), h = 5381;
    for (var i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
    stamp = buf.byteLength + 'B/' + h.toString(16);
  } catch (e) { stamp = '(取版本失败: ' + e.message + ')'; }

  // ---- 数据层是否正在被编辑 ----
  // 共用工作区里，别人多步编辑的中间态会被读到：一天内三次报"紧急/失败"，
  // 三次读数都是真的、三次都不是最终状态（白屏那次、175/3 那次、183/1 那次）。
  // 约定：数据层多步编辑期间创建 dongying-demo/.editing，改完删除。
  //
  // ⚠️ 第一版把标记放在会话的 scratchpad 目录，用 fetch('/scratchpad/…') 取 ——
  // 那个目录**不在静态服务根内**，永远 404，于是"编辑中"恒为 false：
  // **一个永远不会报警的告警**，比没有这个检查更糟，因为它让人以为查过了。
  // 现在标记必须落在服务得到的路径下，并且区分三种状态：
  //   200 → 编辑中   404 → 未编辑   其它/抛错 → 检查本身失效（要说出来，不能当成"未编辑"）
  var editing = 'unknown';
  try {
    var e = await fetch('/.editing', { cache: 'no-store' });
    editing = e.status === 200 ? 'editing' : e.status === 404 ? 'idle' : ('检查异常 HTTP ' + e.status);
  } catch (err) { editing = '检查失效：' + err.message; }
  if (editing === 'editing') console.warn('⚠ 数据层标记为「编辑中」—— 本次读数可能是中间态，报出去之前先问一声');
  else if (editing !== 'idle') console.warn('⚠ 编辑标记检查失效（' + editing + '）—— 无法判断是否读到中间态');

  // ---- 逐页体检 ----
  const pages = Object.keys(window.PAGES || {}).sort();
  const back = location.hash;
  const out = {};
  for (const p of pages) {
    location.hash = '#/' + p;
    await new Promise(r => setTimeout(r, 950));
    const h = scan();
    out[p] = (h.A.length || h.B.length) ? { A静默裁切: h.A, B横向滚动条: h.B } : 0;
  }
  location.hash = back;
  const bad = Object.entries(out).filter(([, v]) => v !== 0);
  console.log('%c横向溢出体检 ' + innerWidth + '×' + innerHeight,
    'font-weight:bold;color:' + (bad.length ? '#ff6b6b' : '#3ddc97'));
  console.log('自检：A/B 两档真阳性均已捕获，探针可信');
  console.log(bad.length ? out : '全部 ' + pages.length + ' 页：A=0 B=0');
  console.log('%c覆盖边界：本次只覆盖【导航后的静态渲染态】。' +
    (document.hidden
      ? '当前 document.hidden=true，ResizeObserver/rAF 均不触发，"渲染后改窗口宽度不重新导航"的重排路径【未被覆盖】，需在可见窗口手动拖动验证。'
      : '窗口可见，可另行手动拖动宽度验证重排路径。'),
    'color:#f0a500');
  console.log('%c数据层版本（mock.js Last-Modified）：' + stamp, 'color:#8fbaff');
  /* selfCheck 顺带带出来：失败详情在 got 里（不是 msg/detail/why —— 那三个都取不到，
     我曾据此三次误报"断言没带详情"）。报失败一律贴 {name, exp, got} 三元组。 */
  var sc = (window.MOCK && window.MOCK.selfCheck) ? window.MOCK.selfCheck() : [];
  var scBad = sc.filter(function (x) { return !x.ok; })
    .map(function (x) { return { name: x.name, exp: String(x.exp), got: String(x.got) }; });
  if (scBad.length) console.warn('selfCheck 失败 ' + scBad.length + ' 条：', scBad);

  return {
    vw: innerWidth, hidden: document.hidden, 数据层版本: stamp,
    数据层编辑状态: editing,        // editing | idle | 检查失效说明
    selfCheck: sc.length + '/' + scBad.length + ' 失败',
    selfCheck失败: scBad,
    结果: bad.length ? out : 'clean'
  };
})()
`.trim();

const TIP = `
把下面整段贴进 Demo 的浏览器 console。两档宽度各跑一次（1440×900 / 1600×950），
两档都过才算通过 —— 曾出现过只在 1600 下溢出的情形：
.field 是 flex，input 的浏览器默认 min-width 约 170px 收不下去，
而 repeat(auto-fit,minmax(196px,1fr)) 在 1600 下排 3 列（每列 207px），
反而比 1440 的 2 列更窄。把窗口拉宽会让容器变窄，很反直觉，别只测一档。
`.trim();

console.log(TIP + '\n\n' + PROBE + '\n');
if (process.argv.includes('--copy')) {
  try { execSync('pbcopy', { input: PROBE }); console.log('（已复制到剪贴板）'); }
  catch { console.log('（复制失败，手动选中上面那段）'); }
}
