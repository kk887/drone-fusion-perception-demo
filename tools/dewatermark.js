#!/usr/bin/env node
/* =============================================================================
 * tools/dewatermark.js —— 离线去除本地瓦片上的服务商水印
 *
 * 水印特征：纯蓝 rgb(0,0,255) 粗体文字「www.centmap.cn」，与地图自身的
 * 水系浅蓝 rgb(164,205,255)、道路蓝完全可分，因此可精确定位、不伤地图内容。
 * 做法：把水印像素按「邻域非水印像素的中位色」填充（小半径 inpaint），
 * 而不是简单涂白 —— 后者会在浅色底图上留下明显色块。
 *
 * 用法：node tools/dewatermark.js [--dry]
 * ========================================================================== */
const fs = require('fs'), path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', 'dongying-demo', 'assets', 'tiles', 'DongyingTiles', 'AMap', 'roadmap');
const DRY = process.argv.includes('--dry');

/* 判定水印像素：高饱和纯蓝。阈值经实测——水印 (0,0,255)，水系 (164,205,255) */
function isWM(r, g, b) { return b > 200 && r < 90 && g < 90; }

async function processTile(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const idx = [];
  for (let i = 0; i < W * H; i++) {
    if (isWM(data[i * C], data[i * C + 1], data[i * C + 2])) idx.push(i);
  }
  if (!idx.length) return 0;

  /* 逐像素用邻域非水印色填充，半径逐步扩大直到取到样本 */
  const mask = new Uint8Array(W * H);
  idx.forEach(i => mask[i] = 1);
  for (const i of idx) {
    const x0 = i % W, y0 = (i / W) | 0;
    let r = 0, g = 0, b = 0, n = 0;
    for (let rad = 1; rad <= 6 && n < 4; rad++) {
      r = g = b = n = 0;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (mask[j]) continue;
        r += data[j * C]; g += data[j * C + 1]; b += data[j * C + 2]; n++;
      }
    }
    if (n) {
      data[i * C] = Math.round(r / n);
      data[i * C + 1] = Math.round(g / n);
      data[i * C + 2] = Math.round(b / n);
    } else {                       // 整块都是水印：退回底图常见底色
      data[i * C] = 247; data[i * C + 1] = 243; data[i * C + 2] = 235;
    }
  }
  if (!DRY) {
    await sharp(data, { raw: { width: W, height: H, channels: C } }).png({ compressionLevel: 9 }).toFile(file + '.tmp');
    fs.renameSync(file + '.tmp', file);
  }
  return idx.length;
}

(async () => {
  const files = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p); else if (n.endsWith('.png')) files.push(p);
    }
  })(ROOT);

  console.log(`扫描 ${files.length} 个瓦片${DRY ? '（试运行，不写入）' : ''}…`);
  let hit = 0, px = 0, done = 0;
  const CONC = 16;
  for (let i = 0; i < files.length; i += CONC) {
    const batch = files.slice(i, i + CONC);
    const res = await Promise.all(batch.map(f => processTile(f).catch(() => 0)));
    res.forEach(n => { if (n) { hit++; px += n; } });
    done += batch.length;
    if (done % 16000 === 0) process.stdout.write(`\r  已处理 ${done}/${files.length}  含水印 ${hit}`);
  }
  console.log(`\n完成：${files.length} 个瓦片，其中 ${hit} 个含水印，共清除 ${px.toLocaleString()} 像素`);
})();
