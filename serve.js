/* 本地静态服务：node serve.js  →  http://localhost:8899
   同一局域网内其他人可用启动时打印的 http://<本机IP>:8899 访问。
   （Demo 也可直接双击 index.html 打开，无需本服务） */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
/* 当前仓库根即静态站点根。服务端只放行 index.html 与 assets/，
   避免 README、tools、serve.js 等开发文件被局域网访问。 */
const ROOT = __dirname, PORT = 8899, HOST = '0.0.0.0';
const T = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'
};
http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p !== '/index.html' && !p.startsWith('/assets/')) { s.writeHead(404); return s.end('404 ' + p); }
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep)) { s.writeHead(403); return s.end('forbidden'); }
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); return s.end('404 ' + p); }
    s.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    s.end(d);
  });
}).listen(PORT, HOST, () => {
  /* 把局域网地址直接打出来 —— 不打的话，演示时要现查 ifconfig，
     而现场大概率是「连了 Wi-Fi 又插了网线」，两个地址里挑错一个就连不上。 */
  const nets = os.networkInterfaces();
  const lan = [];
  Object.keys(nets).forEach(name => (nets[name] || []).forEach(a => {
    if (a.family !== 'IPv4' || a.internal) return;
    // utun/ipsec 是 VPN 隧道，198.18/169.254 不是局域网地址 —— 标出来，别人连不上
    const vpn = /^(utun|ipsec|ppp|tap)/.test(name) || /^(198\.1[89]\.|169\.254\.)/.test(a.address);
    lan.push({ name, ip: a.address, vpn });
  }));
  const real = lan.filter(x => !x.vpn), fake = lan.filter(x => x.vpn);
  console.log('\n  无人机融合感知平台 Demo 已启动\n');
  console.log('  本机：      http://localhost:' + PORT);
  if (real.length) {
    console.log('\n  局域网（把下面的地址发给对方）：');
    real.forEach((x, i) => console.log('    ' + (i === 0 ? '→' : ' ') + ' http://' + x.ip + ':' + PORT
      + '   ' + (x.name === 'en1' ? '[Wi-Fi]' : '[' + x.name + ']')));
    console.log('\n  对方须与本机在同一 Wi-Fi / 同一网段。电脑或手机浏览器直接打开即可。');
  } else {
    console.log('\n  局域网：    未检测到可用网卡（未联网？）');
  }
  if (fake.length) {
    console.log('\n  以下是 VPN / 虚拟网卡地址，别人连不上，不要发：');
    fake.forEach(x => console.log('      http://' + x.ip + ':' + PORT + '   (' + x.name + ')'));
  }
  console.log('\n  停止服务：  Ctrl+C\n');
});
