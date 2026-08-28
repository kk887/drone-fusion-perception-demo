/* =============================================================================
 * map.js —— 轻量 Canvas 态势地图（东营）
 * 无外部瓦片依赖，可离线运行；正式版替换为地图瓦片服务接口 /api/v1/map/tile
 * ========================================================================== */
(function (g) {
  'use strict';
  /* 地图范围对齐本地瓦片的实际覆盖矩形（z12–z17 每列张数一致，矩形完整）。
     原范围 118.00–119.30 / 36.95–38.20 比瓦片略大，会在西侧与上下边缘露出无图区域
     （按原范围核算缺 42,738 张，实为边界超出而非瓦片不全）。
     现取瓦片的严格内接矩形：z12–z17 全级别 0 缺失，且完整覆盖 6 个区县与
     胜利机场、通航机场、胜利油田中心油库、东营港等全部关键设施。 */
  const B = { lon0: 118.114, lon1: 119.308, lat0: 36.937, lat1: 38.156 };
  /* 本地高德瓦片根路径（GCJ-02 切片，z2–z17）。离线可用，无外网依赖。 */
  const TILE_BASE = 'assets/tiles/DongyingTiles/AMap/roadmap/';
  /* 离线瓦片包每一级的实际覆盖范围 [xMin, xMax, yMin, yMax] —— **实测自瓦片目录**，不是推算。
     不能从某一级按 2 的幂推导：这个金字塔并非严格嵌套（低层级覆盖略宽于高层级），
     推出来会在 z14/z17 越界一列，于是去请求不存在的瓦片，控制台报 404 ——
     演示时对方打开开发者工具就能看见。
     换瓦片包后此表须重新实测；tools/tilecheck.js 会比对它与磁盘是否一致，漂移即报错。 */
  const TILE_EXTENT = {
    2: [3, 3, 1, 1], 3: [6, 6, 3, 3], 4: [13, 13, 6, 6], 5: [26, 26, 12, 12],
    6: [52, 53, 24, 24], 7: [105, 106, 49, 49], 8: [211, 212, 98, 99],
    9: [423, 425, 197, 199], 10: [847, 851, 394, 398], 11: [1695, 1702, 788, 797],
    12: [3391, 3405, 1577, 1595], 13: [6783, 6810, 3155, 3190],
    14: [13567, 13621, 6310, 6380], 15: [27134, 27243, 12621, 12761],
    16: [54269, 54487, 25242, 25523], 17: [108539, 108975, 50485, 51046]
  };

  /* 东营地理骨架（简化矢量，仅用于 Demo 视觉参考） */
  const COAST = [[118.02, 38.13], [118.30, 38.17], [118.62, 38.10], [118.90, 38.01], [119.10, 37.87],
  [119.20, 37.72], [119.06, 37.60], [118.99, 37.42], [118.93, 37.20], [118.89, 36.98]];
  const RIVER = [[118.02, 37.28], [118.20, 37.38], [118.40, 37.50], [118.60, 37.63], [118.80, 37.72],
  [118.98, 37.77], [119.10, 37.79]];
  const ROADS = [
    [[118.28, 36.98], [118.45, 37.25], [118.56, 37.48], [118.60, 37.78], [118.66, 38.02]],
    [[118.02, 37.62], [118.35, 37.58], [118.66, 37.52], [118.98, 37.46]],
    [[118.10, 37.05], [118.42, 37.10], [118.75, 37.16], [118.95, 37.24]],
    [[118.52, 36.98], [118.58, 37.30], [118.70, 37.60], [118.86, 37.86]]
  ];
  const LABELS = [
    { n: '东营市', lon: 118.582, lat: 37.449, s: 15, c: '#dbe9ff' },
    { n: '河口区', lon: 118.525, lat: 37.886, s: 12, c: '#9fb6d9' },
    { n: '利津县', lon: 118.256, lat: 37.490, s: 12, c: '#9fb6d9' },
    { n: '垦利区', lon: 118.548, lat: 37.588, s: 12, c: '#9fb6d9' },
    { n: '广饶县', lon: 118.407, lat: 37.053, s: 12, c: '#9fb6d9' },
    { n: '东营港', lon: 118.960, lat: 38.085, s: 11, c: '#9fb6d9' },
    { n: '渤海', lon: 119.12, lat: 38.05, s: 13, c: '#4c7fbf' },
    { n: '莱州湾', lon: 119.14, lat: 37.30, s: 12, c: '#4c7fbf' }
  ];

  function MapView(box, opt) {
    opt = opt || {};
    this.box = box; this.opt = opt;
    this.data = { airspaces: [], devices: [], targets: [], alarms: [] };
    this.layers = Object.assign({ device: true, track: true, nofly: true, suit: true, limit: true, alarm: true }, opt.layers);
    /* 瓦片底图（本地高德切片，GCJ-02）。数据仍为 WGS-84，绘制时按 GEO.wgsToPixel 纠偏 */
    this.tiles = opt.tiles !== false && !!g.GEO;
    this.tileCache = {}; this.tileZ = 12;
    this.zoom = opt.zoom || 1; this.ox = 0; this.oy = 0; this.t = 0; this.hover = null; this.sel = null;
    box.classList.add('mapwrap');
    const legendHtml = opt.legend === false ? '' : `<div class="maplegend">
        <div class="li"><span class="sw" style="border-color:#2fd06e"></span>合法目标轨迹</div>
        <div class="li"><span class="sw" style="border-color:#8ca0be"></span>不适用（异物 §4.2）</div>
        <div class="li"><span class="sw" style="border-color:#ff4d5e"></span>非法/告警目标</div>
        <div class="li"><span class="sw" style="border-color:#ff8b3d;border-top-style:dotted"></span>弥合段 (A03)</div>
        <div class="li"><span class="sw" style="border-color:#22d3ee;border-top-style:dotted"></span>预测段 (A04)</div>
        <div class="li"><span style="width:14px;text-align:center;color:#22d3ee">●</span>设备点位</div>
        ${(window.MOCK && window.MOCK.AIRSPACE_TYPES ? window.MOCK.AIRSPACE_TYPES : [])
          .filter((a, i, arr) => arr.findIndex(x => x.legend === a.legend) === i)
          .map(a => `<div class="li"><span class="sw" style="border-color:${a.color}"></span>${a.legend}</div>`).join('')}
      </div>`;
    box.innerHTML = `<canvas></canvas>
      <div class="mapctl">
        <div class="mb" data-z="in" role="button" aria-label="放大">${g.UI.icon('zoomIn')}</div><div class="mb" data-z="out" role="button" aria-label="缩小">${g.UI.icon('zoomOut')}</div><div class="mb" data-z="fit" role="button" aria-label="复位">${g.UI.icon('expand')}</div>
      </div>
      ${legendHtml}
      <div class="maptip"></div>
      <div class="mapscale"><span></span><div class="bar"></div></div>`;
    box.__map = this;          // 便于调试与外部程序化控制
    this.cv = box.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.tip = box.querySelector('.maptip');
    this._bind();
    this._resize();
    this._loop();
  }

  MapView.prototype._bind = function () {
    const self = this;
    this._ro = new ResizeObserver(() => self._resize());
    this._ro.observe(this.box);
    this.box.addEventListener('click', e => {
      const z = e.target.closest('[data-z]');
      if (z) {
        if (z.dataset.z === 'in') self.setZoom(self.zoom * 1.5);
        else if (z.dataset.z === 'out') self.setZoom(self.zoom / 1.5);
        else { self.zoom = 1; self.ox = self.oy = 0; self._fitTiles(); self.draw(); }
        return;
      }
      if (self.hover && self.opt.onPick) self.opt.onPick(self.hover);
    });
    this.cv.addEventListener('mousemove', e => {
      const r = self.cv.getBoundingClientRect();
      self.mx = e.clientX - r.left; self.my = e.clientY - r.top;
      self._hit();
    });
    this.cv.addEventListener('mouseleave', () => { self.hover = null; self.tip.style.display = 'none'; });
    let drag = null;
    this.cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, ox: self.ox, oy: self.oy }; });
    /* 挂在 window 上的监听器必须留引用，destroy() 时移除。
       原来只 disconnect 了 ResizeObserver，这两条永远留着 ——
       设备页每开一次详情就新建一个 MapView，每次漏两个，切多少次漏多少次。 */
    this._winUp = () => drag = null;
    window.addEventListener('mouseup', this._winUp);
    this._winMove = e => {
      if (!drag) return;
      self.ox = drag.ox + (e.clientX - drag.x); self.oy = drag.oy + (e.clientY - drag.y);
      self.draw();
    };
    window.addEventListener('mousemove', this._winMove);
    this.cv.addEventListener('wheel', e => {
      e.preventDefault();
      self.setZoom(self.zoom * (e.deltaY < 0 ? 1.18 : 0.85));
    }, { passive: false });
  };

  MapView.prototype._resize = function () {
    const r = this.box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.cv.width = r.width * dpr; this.cv.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._fitTiles();
  };

  /* 瓦片模式：Web Mercator 投影 + WGS-84→GCJ-02 纠偏，保证矢量要素与底图严丝合缝。
     无瓦片模式：沿用原线性投影（矢量示意底图）。 */
  MapView.prototype.px = function (lon, lat) {
    if (this.tiles) {
      const z = this.tileZ;
      const [pxX, pxY] = g.GEO.wgsToPixel(lon, lat, z);
      return [pxX - this.originX + this.ox, pxY - this.originY + this.oy];
    }
    const sx = this.w / (B.lon1 - B.lon0), sy = this.h / (B.lat1 - B.lat0);
    const base = Math.min(sx, sy) * this.zoom;
    const kx = Math.min(sx * this.zoom / base, 1.7);
    const cx = this.w / 2 + this.ox, cy = this.h / 2 + this.oy;
    return [cx + (lon - (B.lon0 + B.lon1) / 2) * base * kx, cy - (lat - (B.lat0 + B.lat1) / 2) * base];
  };

  /* 依据面板尺寸选择瓦片层级，并把东营中心对准画布中心 */
  MapView.prototype._fitTiles = function () {
    if (!this.tiles || !this.w) return;
    // 选择「一屏刚好铺满期望经度跨度」的层级；zoom 越大跨度越小 → 自动选到更高层级
    const span = (B.lon1 - B.lon0) / this.zoom;
    let z = 11, best = 1e9;
    // 下限取 8：窄面板（如 324px 宽的风险页地图）在 z9 一屏覆盖不足东营全域跨度
    for (let t = 8; t <= 17; t++) {
      const spanPx = g.GEO.TILE * Math.pow(2, t) * (span / 360);
      const diff = Math.abs(spanPx - this.w);
      if (diff < best) { best = diff; z = t; }
    }
    this.tileZ = z;
    const c = g.GEO.wgsToPixel((B.lon0 + B.lon1) / 2, (B.lat0 + B.lat1) / 2, z);
    this.originX = c[0] - this.w / 2;
    this.originY = c[1] - this.h / 2;
    this.tileCache = this.tileCache || {};
  };

  /* 缩放：以视口中心为锚点，缩放前后中心点对应的地理位置保持不变。
     瓦片模式下还需重算层级与原点，否则改了 zoom 底图不会跟着变。 */
  MapView.prototype.setZoom = function (z) {
    const nz = Math.max(1, Math.min(12, z));
    if (Math.abs(nz - this.zoom) < 1e-6) return;
    if (!this.tiles) { this.zoom = nz; return; }
    // 记录缩放前视口中心的地理坐标
    const cx = this.w / 2, cy = this.h / 2;
    const before = this.unpx(cx, cy);
    this.zoom = nz;
    this._fitTiles();
    // 缩放后把该地理坐标重新对准视口中心
    this.ox = 0; this.oy = 0;
    const after = this.px(before[0], before[1]);
    this.ox = cx - after[0]; this.oy = cy - after[1];
    this.draw();          // 立即重绘：rAF 在标签页不可见时会被暂停
  };

  /* 屏幕像素 → WGS-84（px 的逆运算，用于缩放锚点与点击取坐标） */
  MapView.prototype.unpx = function (sx, sy) {
    if (!this.tiles) {
      const kx0 = this.w / (B.lon1 - B.lon0), ky0 = this.h / (B.lat1 - B.lat0);
      const base = Math.min(kx0, ky0) * this.zoom;
      const kx = Math.min(kx0 * this.zoom / base, 1.7);
      const cx = this.w / 2 + this.ox, cy = this.h / 2 + this.oy;
      return [(sx - cx) / (base * kx) + (B.lon0 + B.lon1) / 2,
      (B.lat0 + B.lat1) / 2 - (sy - cy) / base];
    }
    const z = this.tileZ;
    const wx = sx - this.ox + this.originX, wy = sy - this.oy + this.originY;
    const gLon = g.GEO.pixelXToLon(wx, z), gLat = g.GEO.pixelYToLat(wy, z);
    return g.GEO.gcj02ToWgs84(gLon, gLat);      // 底图是 GCJ-02，换回平台的 WGS-84
  };

  MapView.prototype.setData = function (d) { Object.assign(this.data, d); return this; };
  MapView.prototype.setLayer = function (k, v) { this.layers[k] = v; return this; };
  MapView.prototype.destroy = function () {
    this._dead = true;
    if (this._ro) this._ro.disconnect();
    if (this._winUp) { window.removeEventListener('mouseup', this._winUp); this._winUp = null; }
    if (this._winMove) { window.removeEventListener('mousemove', this._winMove); this._winMove = null; }
  };

  MapView.prototype._hit = function () {
    const pts = this._pickPts || [];
    let best = null, bd = 14;
    for (const p of pts) {
      const d = Math.hypot(p.x - this.mx, p.y - this.my);
      if (d < bd) { bd = d; best = p; }
    }
    this.hover = best;
    if (best) {
      this.tip.style.display = 'block';
      this.tip.innerHTML = best.tip;
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      this.tip.style.left = Math.min(this.w - tw - 8, Math.max(8, best.x + 14)) + 'px';
      this.tip.style.top = Math.min(this.h - th - 8, Math.max(8, best.y - th - 10)) + 'px';
      this.cv.style.cursor = 'pointer';
    } else { this.tip.style.display = 'none'; this.cv.style.cursor = 'grab'; }
  };

  MapView.prototype._loop = function () {
    const self = this;
    (function f() { if (self._dead || !self.box.isConnected) return; self.t += 1; self.draw(); requestAnimationFrame(f); })();
  };

  /* 绘制本地瓦片（{z}/{x}/{y}.png，高德 GCJ-02 切片） */
  /* AOA 方位线：从上报设备射出一条带不确定扇区的射线，末端标「仅方位」。
     长度用固定像素而非真实距离 —— AOA 给不出距离，画一条有确定长度的线同样是编。 */
  MapView.prototype._drawBearing = function (c, t, P, col) {
    if (t.fromDeviceLon == null || t.azimuth == null) return;
    const o = P(t.fromDeviceLon, t.fromDeviceLat);
    const rad = (t.azimuth - 90) * Math.PI / 180;
    const L = 96, HALF = 4 * Math.PI / 180;            // 4° 测向不确定度【待确认：设备方提供】
    c.save();
    c.beginPath(); c.moveTo(o[0], o[1]);
    c.arc(o[0], o[1], L, rad - HALF, rad + HALF); c.closePath();
    c.fillStyle = col + '1c'; c.fill();
    c.beginPath(); c.moveTo(o[0], o[1]);
    c.lineTo(o[0] + Math.cos(rad) * L, o[1] + Math.sin(rad) * L);
    c.setLineDash([5, 4]); c.strokeStyle = col + 'cc'; c.lineWidth = 1.4; c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.arc(o[0], o[1], 2.5, 0, 7); c.fillStyle = col; c.fill();
    if (this.sel === t.id || t.tracked) {
      c.font = '9.5px "PingFang SC"'; c.fillStyle = col; c.textAlign = 'left';
      c.fillText('仅方位 ' + t.azimuth.toFixed(0) + '°',
        o[0] + Math.cos(rad) * (L + 6), o[1] + Math.sin(rad) * (L + 6));
    }
    c.restore();
  };

  MapView.prototype._drawTiles = function (c, W, H) {
    const z = this.tileZ, T = g.GEO.TILE;
    c.fillStyle = '#0d1a2e'; c.fillRect(0, 0, W, H);
    /* 取瓦片范围必须与绘制位置用同一套偏移：绘制时 dx = x*T - originX + ox，
       所以可视区对应的世界像素范围是 [originX-ox, originX-ox+W]。
       若此处漏掉 ox/oy，取来的瓦片会被画到视口外——请求全部 200 OK 却什么都看不到。 */
    let x0 = Math.floor((this.originX - this.ox) / T), x1 = Math.floor((this.originX - this.ox + W) / T);
    let y0 = Math.floor((this.originY - this.oy) / T), y1 = Math.floor((this.originY - this.oy + H) / T);
    // 夹到离线包实际覆盖范围内：越界的瓦片不存在，发出去只会拿回 404
    const cov = TILE_EXTENT[z];
    if (cov) { x0 = Math.max(x0, cov[0]); x1 = Math.min(x1, cov[1]);
      y0 = Math.max(y0, cov[2]); y1 = Math.min(y1, cov[3]); }
    const self = this;
    let pending = 0;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = z + '/' + x + '/' + y;
        let img = this.tileCache[key];
        if (img === undefined) {
          img = new Image();
          img.onload = () => { self.tileCache[key] = img; };
          img.onerror = () => { self.tileCache[key] = null; };   // 越界瓦片：记 null 不重复请求
          img.src = TILE_BASE + key + '.png';
          this.tileCache[key] = img;
          pending++;
          continue;
        }
        if (!img || !img.complete || !img.naturalWidth) { pending++; continue; }
        const dx = x * T - this.originX + this.ox, dy = y * T - this.originY + this.oy;
        c.drawImage(img, dx, dy, T, T);
      }
    }
    /* 深色主题适配：保留蓝色基调，但适当减轻压暗，让路网与地名更清楚。 */
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = 'rgba(5,20,39,.40)'; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'color';
    c.fillStyle = 'hsl(211,52%,29%)'; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    if (pending) {
      c.font = '11px "PingFang SC"'; c.fillStyle = 'rgba(159,182,217,.7)'; c.textAlign = 'left';
      c.fillText('瓦片加载中…', 12, H - 12);
    }
  };

  /* 瓦片模式下的叠加层（空域/设备/轨迹/告警），与矢量模式共用同一套绘制逻辑 */
  MapView.prototype._drawOverlays = function (c, W, H) {
    this._paintLayers(c, W, H);
  };

  MapView.prototype.draw = function () {
    const c = this.ctx, W = this.w, H = this.h;
    if (!W) return;
    const P = (a, b) => this.px(a, b);
    c.clearRect(0, 0, W, H);

    /* ---- 底图 ---- */
    if (this.tiles) { this._drawTiles(c, W, H); }
    else {
      const gr = c.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#0a1d3b'); gr.addColorStop(1, '#06162a');
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
    }
    if (this.tiles) { this._drawOverlays(c, W, H); return; }

    /* 海域 */
    c.beginPath();
    COAST.forEach((p, i) => { const q = P(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
    const e1 = P(B.lon1 + 1, B.lat0 - 1), e2 = P(B.lon1 + 1, B.lat1 + 1);
    c.lineTo(e1[0], e1[1]); c.lineTo(e2[0], e2[1]); c.closePath();
    c.fillStyle = 'rgba(12,54,101,.75)'; c.fill();
    c.strokeStyle = 'rgba(90,170,230,.5)'; c.lineWidth = 1.2; c.stroke();

    /* 经纬网 */
    c.strokeStyle = 'rgba(64,158,255,.07)'; c.lineWidth = 1;
    for (let lo = 118.0; lo <= 119.3; lo += 0.1) { const a = P(lo, B.lat0), b = P(lo, B.lat1); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
    for (let la = 37.0; la <= 38.2; la += 0.1) { const a = P(B.lon0, la), b = P(B.lon1, la); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }

    /* 道路 */
    c.strokeStyle = 'rgba(120,160,210,.22)'; c.lineWidth = 1.4;
    ROADS.forEach(r => { c.beginPath(); r.forEach((p, i) => { const q = P(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke(); });

    /* 黄河 */
    c.strokeStyle = 'rgba(94,168,235,.55)'; c.lineWidth = 2.6; c.lineCap = 'round';
    c.beginPath(); RIVER.forEach((p, i) => { const q = P(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke();
    c.strokeStyle = 'rgba(140,210,255,.25)'; c.lineWidth = 6; c.stroke();

    /* 地名 */
    c.textAlign = 'center'; c.textBaseline = 'middle';
    LABELS.forEach(l => {
      const q = P(l.lon, l.lat);
      c.font = `${l.s}px "PingFang SC",sans-serif`;
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillText(l.n, q[0] + 1, q[1] + 1);
      c.fillStyle = l.c; c.fillText(l.n, q[0], q[1]);
    });

    this._paintLayers(c, W, H);
  };

  /* 叠加层：空域 / 设备 / 轨迹 / 告警（两种底图模式共用） */
  MapView.prototype._paintLayers = function (c, W, H) {
    const P = (a, b) => this.px(a, b);
    const picks = [];

    /* 空域 */
    (this.data.airspaces || []).forEach(a => {
      // 图层归属读数据层声明，不在渲染层写第二份类型判断
      const key = (window.MOCK && window.MOCK.airspaceType) ? window.MOCK.airspaceType(a.type).layer
        : (a.type === '禁飞空域' ? 'nofly' : a.type === '适飞空域' ? 'suit' : 'limit');
      if (!this.layers[key]) return;
      c.beginPath();
      a.poly.forEach((p, i) => { const q = P(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
      c.closePath();
      c.fillStyle = a.color + '22'; c.fill();
      c.setLineDash([7, 5]); c.lineWidth = 1.6; c.strokeStyle = a.color; c.stroke(); c.setLineDash([]);
      // 斜线填充
      c.save(); c.clip();
      c.strokeStyle = a.color + '33'; c.lineWidth = 1;
      const bb = a.poly.reduce((m, p) => { const q = P(p[0], p[1]); return [Math.min(m[0], q[0]), Math.min(m[1], q[1]), Math.max(m[2], q[0]), Math.max(m[3], q[1])]; }, [1e9, 1e9, -1e9, -1e9]);
      for (let x = bb[0] - (bb[3] - bb[1]); x < bb[2]; x += 8) { c.beginPath(); c.moveTo(x, bb[1]); c.lineTo(x + (bb[3] - bb[1]), bb[3]); c.stroke(); }
      c.restore();
      const ctr = P(a.center.lon, a.center.lat);
      if (this.opt.showAirspaceLabels !== false) {
        c.font = '12px "PingFang SC"'; c.fillStyle = a.color; c.textAlign = 'center';
        c.fillText(a.type, ctr[0], ctr[1] - 7);
        c.font = '10.5px Menlo'; c.fillStyle = a.color + 'cc';
        c.fillText(a.id + (a.limit ? ' · ' + a.limitTx : ''), ctr[0], ctr[1] + 8);
      }
      picks.push({
        x: ctr[0], y: ctr[1], kind: 'airspace', data: a,
        tip: `<b style="color:${a.color}">${a.name}</b><dl class="kv" style="margin-top:6px">
          <dt>编号</dt><dd>${a.id}</dd><dt>类型</dt><dd>${a.type}</dd>
          <dt>限高</dt><dd>${a.limitTx}</dd><dt>管理单位</dt><dd>${a.unit}</dd></dl>`
      });
    });

    /* 设备点位 */
    if (this.layers.device) {
      (this.data.devices || []).slice(0, this.opt.maxDev || 90).forEach(d => {
        const q = P(d.lon, d.lat);
        if (q[0] < -20 || q[0] > W + 20 || q[1] < -20 || q[1] > H + 20) return;
        const col = d.status === '在线' ? (d.alarm ? '#ffb020' : '#22d3ee') : d.status === '离线' ? '#8ca0be' : '#ff4d5e';
        c.beginPath(); c.arc(q[0], q[1], 2.8, 0, 7); c.fillStyle = col; c.fill();
        c.beginPath(); c.arc(q[0], q[1], 5.4, 0, 7); c.strokeStyle = col + '55'; c.lineWidth = 1; c.stroke();
        if (d.alarm) {
          const r = 7 + (this.t % 60) / 60 * 9;
          c.beginPath(); c.arc(q[0], q[1], r, 0, 7);
          c.strokeStyle = `rgba(255,176,32,${(1 - (this.t % 60) / 60) * .7})`; c.stroke();
        }
        picks.push({
          x: q[0], y: q[1], kind: 'device', data: d,
          tip: `<b>${d.name}</b><dl class="kv" style="margin-top:6px">
            <dt>编号</dt><dd>${d.id}</dd><dt>类型</dt><dd>${d.type} / ${d.channel}</dd>
            <dt>状态</dt><dd style="color:${col}">${d.status}${d.alarm ? '（告警）' : ''}</dd>
            <dt>位置</dt><dd>${d.lon.toFixed(4)}°E, ${d.lat.toFixed(4)}°N</dd></dl>`
        });
      });
    }

    /* 目标轨迹 */
    if (this.layers.track) {
      (this.data.targets || []).forEach((t, ti) => {
        // §4.2：非无人机目标不做合法性判定，'不适用' 单列中性色，不得与「合法」同色
        const col = t.legal === '非法' ? '#ff4d5e' : t.legal === '异常' ? '#ff8b3d'
          : t.legal === '待确认' ? '#ffb020' : t.legal === '不适用' ? '#8ca0be' : '#2fd06e';
        /* AOA 目标只有方位角，没有经纬度（协议 v8.6）—— 画成从设备射出的方位线。
           当点画等于凭空给了一个平台并不知道的位置。 */
        if (t.posValid === false) { this._drawBearing(c, t, P, col); return; }
        const tr = t.track || [];
        if (tr.length > 1) {
          /* F0202:按点型分段绘制 —— 实测=动画虚线 / 弥合=橙色宽隙虚线(A03) / 预测=青色点线(A04) */
          const STYLE = {
            meas: { dash: [6, 4], col: col + (t.tracked ? 'ee' : '99'), w: t.tracked ? 2 : 1.3, anim: true },
            bridge: { dash: [3, 6], col: '#ff8b3d', w: 2, anim: false },
            pred: { dash: [2, 5], col: '#22d3ee', w: 1.6, anim: false }
          };
          let bridgeLabelAt = null;
          for (let i = 1; i < tr.length; i++) {
            const kind = tr[i].kind || 'meas';
            const st = STYLE[kind] || STYLE.meas;
            const a = P(tr[i - 1].lon, tr[i - 1].lat), b = P(tr[i].lon, tr[i].lat);
            c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
            c.setLineDash(st.dash); c.lineDashOffset = st.anim ? -(this.t * .6) % 10 : 0;
            c.strokeStyle = st.col; c.lineWidth = st.w; c.stroke();
            if (kind === 'bridge' && !bridgeLabelAt) bridgeLabelAt = a;
            if (kind !== 'meas' && (t.tracked || this.sel === t.id)) {
              c.setLineDash([]);
              c.beginPath(); c.arc(b[0], b[1], 2.2, 0, 7);
              c.strokeStyle = st.col; c.lineWidth = 1.2; c.stroke();   // 空心点标记非实测点
            }
          }
          c.setLineDash([]);
          if (bridgeLabelAt && (t.tracked || this.sel === t.id)) {
            c.font = '9.5px "PingFang SC"'; c.fillStyle = '#ffb083'; c.textAlign = 'left';
            c.fillText('注意：断裂-弥合', bridgeLabelAt[0] + 6, bridgeLabelAt[1] - 5);
          }
          const s = P(tr[0].lon, tr[0].lat);
          c.beginPath(); c.arc(s[0], s[1], 3, 0, 7); c.fillStyle = '#2fd06e'; c.fill();
        }
        const last = tr.length ? tr[tr.length - 1] : { lon: t.lon, lat: t.lat };
        const q = P(last.lon, last.lat);
        // 目标图标（旋翼）
        c.save(); c.translate(q[0], q[1]);
        if (t.tracked || this.sel === t.id) {
          const r = 10 + (this.t % 50) / 50 * 12;
          c.beginPath(); c.arc(0, 0, r, 0, 7);
          c.strokeStyle = `rgba(255,77,94,${(1 - (this.t % 50) / 50) * .8})`; c.lineWidth = 1.5; c.stroke();
        }
        c.rotate((this.t * .04) % 6.283);
        c.strokeStyle = col; c.lineWidth = 1.6;
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + Math.PI / 4;
          c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 6, Math.sin(a) * 6); c.stroke();
          c.beginPath(); c.arc(Math.cos(a) * 6, Math.sin(a) * 6, 2.4, 0, 7); c.stroke();
        }
        c.restore();
        c.beginPath(); c.arc(q[0], q[1], 2.4, 0, 7); c.fillStyle = col; c.fill();
        if (this.opt.showTargetLabels !== false && (t.tracked || this.sel === t.id || (this.data.targets || []).length <= 8)) {
          c.font = '10.5px Menlo'; c.textAlign = 'left';
          c.fillStyle = 'rgba(4,10,26,.8)'; c.fillRect(q[0] + 11, q[1] - 16, 62, 12);
          c.fillStyle = col; c.fillText(t.id.slice(-9), q[0] + 13, q[1] - 7);
        }
        picks.push({
          x: q[0], y: q[1], kind: 'target', data: t,
          tip: `<b style="color:${col}">${t.id}</b><dl class="kv" style="margin-top:6px">
            <dt>类型</dt><dd>${t.subtype || t.type}</dd><dt>高度</dt><dd>${t.alt} m</dd>
            <dt>速度</dt><dd>${t.speed} m/s</dd><dt>合法性</dt><dd style="color:${col}">${t.legal}${t.violation ? '（' + t.violation + '）' : ''}</dd>
            <dt>风险</dt><dd>${t.risk}</dd><dt>来源</dt><dd>${t.source}</dd></dl>`
        });
      });
    }

    /* 告警点位 */
    if (this.layers.alarm) {
      (this.data.alarms || []).slice(0, this.opt.maxAlarm || 8).forEach(a => {
        const t = (this.data.targets || []).find(x => x.id === a.targetId);
        /* 查不到区名就不画，不能落到第一个行政区 —— 那会把一条告警画在东营区，
           而它其实在哪没人知道。兜底可以降级为"显示不了"，不可以替换成另一个实体：
           前者用户看得见，后者用户看不见。 */
        const d = MOCK.DISTRICTS.find(x => x.name === a.district) || null;
        if (!t && !d) return;
        const lon = t ? t.lon : d.lon + 0.05, lat = t ? t.lat : d.lat + 0.03;
        const q = P(lon, lat);
        const col = a.level === '高' ? '#ff4d5e' : a.level === '中' ? '#ffb020' : '#3d8bff';
        const ph = (this.t % 70) / 70;
        c.beginPath(); c.arc(q[0], q[1], 5 + ph * 12, 0, 7);
        c.strokeStyle = col + Math.round((1 - ph) * 180).toString(16).padStart(2, '0'); c.lineWidth = 1.4; c.stroke();
        c.beginPath(); c.arc(q[0], q[1], 5, 0, 7); c.fillStyle = col; c.fill();
        c.fillStyle = '#fff'; c.font = 'bold 8px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('!', q[0], q[1]);
        picks.push({
          x: q[0], y: q[1], kind: 'alarm', data: a,
          tip: `<b style="color:${col}">${a.type}</b><dl class="kv" style="margin-top:6px">
            <dt>目标</dt><dd>${a.targetId}</dd><dt>等级</dt><dd>${a.level}</dd>
            <dt>时间</dt><dd>${a.time.slice(11)}</dd><dt>状态</dt><dd>${a.status}</dd></dl>`
        });
      });
    }
    this._pickPts = picks;

    /* 比例尺 */
    const s0 = this.px(118.5, 37.5), s1 = this.px(118.5 + 0.1, 37.5);
    const pxPer10km = Math.abs(s1[0] - s0[0]);
    const el = this.box.querySelector('.mapscale');
    if (el) { el.querySelector('span').textContent = '≈ 8.9 km'; el.querySelector('.bar').style.width = pxPer10km.toFixed(0) + 'px'; }
  };

  g.MapView = MapView;
})(window);
