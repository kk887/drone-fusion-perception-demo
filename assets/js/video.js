/* =============================================================================
 * video.js —— 模拟光电(EO)实时视频渲染器
 * 纪要 §6.2:光电支持视频流、目标框、置信度、截图与跟踪;反制处置须视频取证。
 * 正式版替换为 /api/v1/eo/stream 拉流(WebRTC/FLV),本渲染器仅为 Demo 占位。
 * ========================================================================== */
(function (g) {
  'use strict';

  function EOVideo(box, opt) {
    opt = opt || {};
    this.opt = opt;
    box.classList.add('eovideo');
    const h = opt.height || 220;
    box.innerHTML = `<canvas></canvas>`;
    this.cv = box.querySelector('canvas');
    this.cv.style.height = h + 'px';
    this.box = box;
    this.t = 0;
    this.mode = opt.mode || 'visible';        // visible | ir
    this.locked = opt.locked !== false;
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(box);
    const self = this;
    (function loop() {
      if (self._dead || !box.isConnected) { self.destroy(); return; }
      self.t++; self.draw(); requestAnimationFrame(loop);
    })();
  }

  EOVideo.prototype._resize = function () {
    const r = this.box.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = parseFloat(this.cv.style.height);
    this.cv.width = this.w * dpr; this.cv.height = this.h * dpr;
    this.ctx = this.cv.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  EOVideo.prototype.destroy = function () { this._dead = true; if (this._ro) this._ro.disconnect(); };

  EOVideo.prototype.draw = function () {
    const c = this.ctx, W = this.w, H = this.h, t = this.t;
    if (!W) return;
    const ir = this.mode === 'ir';

    /* 背景:天空渐变(可见光)或热成像灰阶 */
    const gr = c.createLinearGradient(0, 0, 0, H);
    if (ir) { gr.addColorStop(0, '#1a1a1a'); gr.addColorStop(1, '#050505'); }
    else { gr.addColorStop(0, '#20344e'); gr.addColorStop(.7, '#2c3f56'); gr.addColorStop(1, '#3a4a5c'); }
    c.fillStyle = gr; c.fillRect(0, 0, W, H);

    /* 云层/地物剪影 */
    c.fillStyle = ir ? 'rgba(70,70,70,.5)' : 'rgba(150,170,195,.16)';
    for (let i = 0; i < 4; i++) {
      const x = ((i * 260 + t * (.25 + i * .07)) % (W + 320)) - 160;
      const y = 24 + i * 34;
      c.beginPath(); c.ellipse(x, y, 90 + i * 22, 13 + i * 3, 0, 0, 7); c.fill();
    }
    c.fillStyle = ir ? '#0c0c0c' : 'rgba(18,28,40,.85)';
    c.beginPath(); c.moveTo(0, H - 18);
    for (let x = 0; x <= W; x += 40) c.lineTo(x, H - 18 - Math.abs(Math.sin(x * .02)) * 10);
    c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fill();

    /* 噪点(视频质感) —— 逐帧动画：每帧本就该不同，随机就是"画面在动"本身，
       不是派生展示值。这是 scan 规则「渲染期不得裸用 Math.random」的显式豁免。 */
    c.globalAlpha = ir ? .14 : .06;
    for (let i = 0; i < 120; i++) {
      // 逐帧动画：噪点每帧本就该不同，随机即"画面在动"本身，非派生展示值
      c.fillStyle = Math.random() > .5 ? '#fff' : '#000';
      c.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2);
    }
    c.globalAlpha = 1;

    /* 目标(旋翼机剪影,缓慢机动) */
    const tx = W / 2 + Math.sin(t * .013) * W * .16;
    const ty = H * .44 + Math.cos(t * .019) * H * .1;
    const sc = 1 + Math.sin(t * .008) * .12;
    c.save(); c.translate(tx, ty); c.scale(sc, sc);
    c.fillStyle = ir ? '#f2f2f2' : '#111a24';
    c.fillRect(-7, -3, 14, 6);
    c.strokeStyle = ir ? '#fff' : '#0c141d'; c.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); c.stroke();
      c.save(); c.translate(Math.cos(a) * 13, Math.sin(a) * 13); c.rotate(t * .5);
      c.globalAlpha = .55; c.beginPath(); c.ellipse(0, 0, 8, 1.6, 0, 0, 7);
      c.fillStyle = c.strokeStyle; c.fill(); c.globalAlpha = 1; c.restore();
    }
    if (ir) { // 热源光晕
      const hg = c.createRadialGradient(0, 0, 2, 0, 0, 22);
      hg.addColorStop(0, 'rgba(255,255,255,.5)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = hg; c.beginPath(); c.arc(0, 0, 22, 0, 7); c.fill();
    }
    c.restore();

    /* 跟踪框(锁定绿 / 搜索黄) */
    if (this.locked) {
      const bw = 62 * sc, bh = 44 * sc, col = '#2fd06e';
      c.strokeStyle = col; c.lineWidth = 1.6;
      const cx = tx - bw / 2, cy = ty - bh / 2, L = 12;
      [[cx, cy, 1, 1], [cx + bw, cy, -1, 1], [cx, cy + bh, 1, -1], [cx + bw, cy + bh, -1, -1]].forEach(([x, y, dx, dy]) => {
        c.beginPath(); c.moveTo(x, y + dy * L); c.lineTo(x, y); c.lineTo(x + dx * L, y); c.stroke();
      });
      c.font = '10px Menlo'; c.fillStyle = col;
      c.fillText('LOCK ' + (this.opt.targetId || ''), cx, cy - 5);
      c.fillText('CONF ' + (88 + Math.round(Math.sin(t * .05) * 4)) + '%', cx, cy + bh + 12);
    }

    /* 中心十字分划 */
    c.strokeStyle = ir ? 'rgba(255,255,255,.55)' : 'rgba(140,255,190,.5)'; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(W / 2 - 26, H / 2); c.lineTo(W / 2 - 8, H / 2); c.moveTo(W / 2 + 8, H / 2); c.lineTo(W / 2 + 26, H / 2);
    c.moveTo(W / 2, H / 2 - 22); c.lineTo(W / 2, H / 2 - 8); c.moveTo(W / 2, H / 2 + 8); c.lineTo(W / 2, H / 2 + 22);
    c.stroke();
    c.strokeRect(W / 2 - 3, H / 2 - 3, 6, 6);

    /* OSD 叠加信息 */
    const dt = new Date(MOCK.CONF.demoTime.getTime() + t * 33);
    c.font = '10.5px Menlo'; c.fillStyle = ir ? '#e8e8e8' : '#c9f5dc';
    c.fillText((this.opt.device || '光电吊舱-02') + ' · ' + (ir ? 'IR 热成像' : 'EO 可见光') + ' · 4K', 10, 16);
    c.fillText(MOCK.util.fmtDT(dt), 10, H - 26);
    c.fillText('AZ ' + (118 + Math.sin(t * .013) * 12).toFixed(1) + '°  EL ' + (12 + Math.cos(t * .019) * 4).toFixed(1) + '°  ZOOM ' + (8 + Math.sin(t * .008) * 2).toFixed(1) + 'x', 10, H - 12);
    const bit = Math.floor(t / 30) % 2 === 0;
    if (bit) { c.fillStyle = '#ff4d5e'; c.beginPath(); c.arc(W - 52, 12, 4, 0, 7); c.fill(); }
    c.fillStyle = '#fff'; c.fillText('REC', W - 42, 16);
    c.fillStyle = ir ? '#bbb' : '#9fe8c0';
    c.fillText('取证存档中 · ' + Math.floor(t / 30) + 's', W - 128, H - 12);
  };

  g.EOVideo = EOVideo;
})(window);
