#!/usr/bin/env node
/* =============================================================================
 * tools/tilecheck.js —— 本地瓦片完整性校验
 *
 * 关键：地图范围 B 从 map.js 实际读取，而不是在本文件里抄一份。
 * 抄一份的话，map.js 改了边界这里不会跟随，校验结果会与实际渲染脱节
 * （本轮就发生过：边界对齐后按旧值仍报 35,570 张缺失）。
 * ========================================================================== */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const TILES = path.join(ROOT, 'assets', 'tiles', 'DongyingTiles', 'AMap', 'roadmap');

/* 从 map.js 解析 B —— 单一事实来源 */
const src = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'map.js'), 'utf8');
const m = src.match(/const B = \{\s*lon0:\s*([\d.]+),\s*lon1:\s*([\d.]+),\s*lat0:\s*([\d.]+),\s*lat1:\s*([\d.]+)\s*\}/);
if (!m) { console.error('✗ 无法从 map.js 解析地图范围 B'); process.exit(1); }
const B = { lon0: +m[1], lon1: +m[2], lat0: +m[3], lat1: +m[4] };

const xt = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
const yt = (lat, z) => {
  const s = Math.sin(lat * Math.PI / 180);
  return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z));
};

console.log(`\n瓦片完整性校验　地图范围（读自 map.js）`);
console.log(`  经度 ${B.lon0} ~ ${B.lon1}　纬度 ${B.lat0} ~ ${B.lat1}`);
console.log('─'.repeat(56));
console.log('  级别      期望      实际     缺失    缺失率');

let totalExp = 0, totalHave = 0, badLevels = 0;
for (const z of [9, 10, 11, 12, 13, 14, 15, 16, 17]) {
  const dir = path.join(TILES, String(z));
  if (!fs.existsSync(dir)) continue;
  const x0 = xt(B.lon0, z), x1 = xt(B.lon1, z), y0 = yt(B.lat1, z), y1 = yt(B.lat0, z);
  const expect = (x1 - x0 + 1) * (y1 - y0 + 1);
  let have = 0;
  for (let x = x0; x <= x1; x++) {
    const d = path.join(dir, String(x));
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      const y = +f.replace('.png', '');
      if (y >= y0 && y <= y1) have++;
    }
  }
  const miss = expect - have;
  if (miss > 0) badLevels++;
  totalExp += expect; totalHave += have;
  console.log(`  z${String(z).padEnd(3)} ${String(expect).padStart(9)} ${String(have).padStart(9)} ${String(miss).padStart(8)}   ${(miss / expect * 100).toFixed(2)}%`);
}
console.log('─'.repeat(56));
const miss = totalExp - totalHave;
console.log(`  合计  ${String(totalExp).padStart(9)} ${String(totalHave).padStart(9)} ${String(miss).padStart(8)}   ${(miss / totalExp * 100).toFixed(2)}%\n`);
/* map.js 的 TILE_EXTENT 是**实测常量** —— 渲染层靠它夹住瓦片请求范围。
   不能从某一级按 2 的幂推算：这个金字塔并非严格嵌套（低层级覆盖略宽），
   推算会在 z14/z17 越界一列，去请求不存在的瓦片，控制台报 404。
   换瓦片包后若忘了重测，渲染层就会按旧范围画 —— 要么少画一块，要么 404。
   这里比对常量与磁盘，漂移即报错。 */
let extentFail = false;
(function checkExtent() {
  const em = src.match(/const TILE_EXTENT = \{([\s\S]*?)\};/);
  if (!em) { console.log('⚠ map.js 中未找到 TILE_EXTENT，跳过一致性校验\n'); return; }
  const decl = {};
  em[1].replace(/(\d+):\s*\[([^\]]+)\]/g, (_, z, v) => { decl[z] = v.split(',').map(Number); return ''; });
  const bad = [];
  fs.readdirSync(TILES).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b).forEach(z => {
    const zp = path.join(TILES, String(z));
    const xs = fs.readdirSync(zp).map(Number).sort((a, b) => a - b);
    let ymin = Infinity, ymax = -1;
    xs.forEach(x => {
      const ys = fs.readdirSync(path.join(zp, String(x))).filter(f => f.endsWith('.png')).map(f => +f.slice(0, -4));
      ymin = Math.min(ymin, ...ys); ymax = Math.max(ymax, ...ys);
    });
    const got = [xs[0], xs[xs.length - 1], ymin, ymax];
    if (JSON.stringify(decl[z]) !== JSON.stringify(got)) bad.push({ z, decl: decl[z], got });
  });
  if (bad.length) {
    extentFail = true;
    console.log(`✗ map.js TILE_EXTENT 与磁盘不一致（${bad.length} 级）`);
    bad.slice(0, 4).forEach(b => console.log(`    z${b.z}  常量 ${JSON.stringify(b.decl)}  实测 ${JSON.stringify(b.got)}`));
    console.log('    渲染层按常量夹住瓦片请求范围，不一致会导致少画或 404。请重测后更新 map.js。\n');
  } else {
    console.log(`✓ map.js TILE_EXTENT 与磁盘一致（${Object.keys(decl).length} 级）`);
  }
})();

if (miss > 0) { console.log(`✗ 缺失 ${miss} 张，涉及 ${badLevels} 个级别\n`); process.exit(1); }
if (extentFail) process.exit(1);
console.log('✓ 地图范围内瓦片完整，无缺失\n');
