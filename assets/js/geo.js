/* =============================================================================
 * geo.js —— 坐标系转换与 Web Mercator 投影
 *
 * 为什么需要：本地瓦片是高德（AMap）切片，使用 GCJ-02 火星坐标系；
 * 而平台全部感知数据、空域规则、设备点位都是 WGS-84（协议 §8.1 统一基准）。
 * 二者在东营一带相差约 300–600 m —— 直接把 WGS-84 坐标画到高德瓦片上，
 * 无人机会落在错误的位置，禁飞区边界也会错位，这在监管系统里是不可接受的。
 * 因此：数据保持 WGS-84 不变，仅在「绘制到瓦片底图」时做一次 WGS-84 → GCJ-02 纠偏。
 * ========================================================================== */
(function (g) {
  'use strict';

  const PI = Math.PI;
  const A = 6378245.0;              // 克拉索夫斯基椭球长半轴
  const EE = 0.00669342162296594323; // 偏心率平方

  function outOfChina(lon, lat) {
    return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55);
  }
  function transformLat(x, y) {
    let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    ret += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
    ret += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
    return ret;
  }
  function transformLon(x, y) {
    let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
    ret += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
    ret += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
    return ret;
  }

  /* WGS-84 → GCJ-02（高德/腾讯底图坐标系） */
  function wgs84ToGcj02(lon, lat) {
    if (outOfChina(lon, lat)) return [lon, lat];
    let dLat = transformLat(lon - 105.0, lat - 35.0);
    let dLon = transformLon(lon - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
    dLon = (dLon * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
    return [lon + dLon, lat + dLat];
  }

  /* GCJ-02 → WGS-84（迭代逼近，用于把底图点击位置换回平台坐标） */
  function gcj02ToWgs84(lon, lat) {
    if (outOfChina(lon, lat)) return [lon, lat];
    let wLon = lon, wLat = lat;
    for (let i = 0; i < 3; i++) {
      const [tLon, tLat] = wgs84ToGcj02(wLon, wLat);
      wLon += lon - tLon; wLat += lat - tLat;
    }
    return [wLon, wLat];
  }

  /* ---- Web Mercator（EPSG:3857）像素坐标：与 {z}/{x}/{y}.png 瓦片对齐 ---- */
  const TILE = 256;
  function lonToPixelX(lon, z) { return (lon + 180) / 360 * TILE * Math.pow(2, z); }
  function latToPixelY(lat, z) {
    const s = Math.sin(lat * PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * PI)) * TILE * Math.pow(2, z);
  }
  function pixelXToLon(px, z) { return px / (TILE * Math.pow(2, z)) * 360 - 180; }
  function pixelYToLat(py, z) {
    const n = PI - 2 * PI * py / (TILE * Math.pow(2, z));
    return 180 / PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  g.GEO = {
    wgs84ToGcj02, gcj02ToWgs84,
    lonToPixelX, latToPixelY, pixelXToLon, pixelYToLat, TILE,
    /* 便捷：WGS-84 直接算到瓦片像素（含纠偏），绘制层统一走这里 */
    wgsToPixel: function (lon, lat, z) {
      const [gLon, gLat] = wgs84ToGcj02(lon, lat);
      return [lonToPixelX(gLon, z), latToPixelY(gLat, z)];
    }
  };
})(window);
