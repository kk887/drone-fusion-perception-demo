/* =============================================================================
 * mock.js —— 平台唯一数据源（Mock Adapter）
 * 会议纪要 §8.2：Mock 接口与正式接口使用同一 Schema；正式接口到位后只替换本文件。
 * 原则：页面不自造数字，所有指标由本数据集聚合派生 —— 保证跨页面口径一致。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 基础配置 ---------------- */
  const CONF = {
    city: '东营',
    demoTime: new Date(2026, 7, 26, 10, 24, 36),   // D3 Demo 评审日
    center: { lon: 118.675, lat: 37.44 },
    bounds: { lon0: 118.05, lon1: 119.25, lat0: 37.00, lat1: 38.15 },
    weather: { text: '多云', tempLo: 22, tempHi: 30, wind: '东南风 3级' },
    coordSys: 'WGS-84',
    altDatum: '椭球高(WGS-84)',
    version: 'Demo V0.3 (D3)'
  };

  /* ---------------- 工具 ---------------- */
  let _seed = 20260826;
  function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function pickW(pairs) {                       // [[值,权重],...]
    const t = pairs.reduce((s, p) => s + p[1], 0); let r = rnd() * t;
    for (const p of pairs) { if ((r -= p[1]) <= 0) return p[0]; } return pairs[0][0];
  }
  const p2 = n => String(n).padStart(2, '0');
  const p3 = n => String(n).padStart(3, '0');
  function fmtD(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function fmtT(d) { return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); }
  function fmtDT(d) { return fmtD(d) + ' ' + fmtT(d); }
  function dayAdd(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function ymd(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  function groupCount(arr, f) {
    const m = new Map(); arr.forEach(x => { const k = f(x); m.set(k, (m.get(k) || 0) + 1); }); return m;
  }

  /* ---------------- 行政区 ---------------- */
  const DISTRICTS = [
    { name: '东营区', lon: 118.582, lat: 37.449, w: 31 },
    { name: '广饶县', lon: 118.407, lat: 37.053, w: 24 },
    { name: '河口区', lon: 118.525, lat: 37.886, w: 15 },
    { name: '垦利区', lon: 118.548, lat: 37.588, w: 13 },
    { name: '利津县', lon: 118.256, lat: 37.490, w: 11 },
    { name: '东营港经济区', lon: 118.960, lat: 38.085, w: 6 }
  ];

  /* ---------------- 1. 设备台账（唯一来源） ---------------- */
  /* 设备类型：deviceType / deviceTypeAbbr 取自《设备数据及感知数据接入协议 v8.6》。
     型号与厂家一律占位 —— 纪要 §7：平台团队不得自行猜测真实硬件命令、参数或算法精度。 */
  /* ================== 否定性断言的写法规范 ==================
     "设备做不到 X / 系统不支持 Y" 这类**否定性**判断，与肯定性判断不是一回事：
       · 肯定性断言的证据是一份具体资料，资料在，断言就站得住；
       · 否定性断言的证据是"我翻遍了没找到" —— 而这句话的可靠性
         完全取决于**我翻的是哪几份**，那个范围如果不写下来，
         它既不可复核，也永远不会失效。
     本项目已有四次否定性断言被后到的资料推翻（ADS-B、云台、GNSS 干扰能力、干扰频段），
     而肯定性断言一条都没被推翻过。这不是巧合，是上面那个结构差异导致的。

     所以本文件内的否定性判断必须满足其一，而且**必须按这个顺序试**：
       ① 【闭集读法】先找一份**穷举式**的字段表/枚举表，
          "没有"是从闭集里读出来的而不是找不到 ——
          这一步做成了，它就不再是否定性断言，写明出处即可；
       ② 【查证范围】①做不到，才写明查了哪几份资料、结论是"这几份里均无"，
          而不是笼统的"设备不支持"。资料一旦增补，范围就要重查；
       ③ 【降级】①②都不行，写「未见资料」，不许写成「不支持」。
     顺序本身就是判据：①消除问题，②只是降低伤害（查证范围永远可能不全），
     而人天然会挑最省事的那个，所以这里把顺序写死。
     实例：「雷达给不出机型」原本是②，找到 T02 §2.3.10 航迹字段表（穷举）后升级为①。
     ========================================================== */
  const TBC = '【待确认：设备方提供】';
  /* ---- T02 雷达实测规格（一手资料，2026-08-27 到位）----
     出处：设备资料/雷达/T02型低空监视雷达规格书.docx「二、产品规格」
     这几个数以前是 TBC，所以"雷达能不能看见这个目标"从来无法校验。
     现在能校验了，而它一上来就抓到 400/761 个目标在雷达量程外却被记为雷达探测。 */
  const T02 = {
    rangeKm: 3.5,        // 探测量程
    maxAltM: 600,        // 最大探测高度
    blindM: 50,          // 探测盲区
    speedMin: 1, speedMax: 100,   // 速度测量范围 m/s
    refreshS: 2,         // 刷新率（30rpm 标配）
    tracks: 100,         // 同时跟踪目标数 ≥100 批
    band: 'Ku 波段',
    src: 'T02型低空监视雷达规格书.docx 二、产品规格'
  };
  /* 已定论的设备型号/厂家 —— 出处：确认表答复_会议纪要_设备清单_三方对照.md 第 135 行
     「设备型号厂家改真值：雷达=西安宝威 T02、光电=大华 DH-UCS-C2000T、
       云台=南普达 GT06Z-C、干扰=神州明达 sp-50、ADS-B=UAVIONIX pingstation3；
       TDOA/AOA/5G-A 与各类台数仍为占位」
     没列进来的设备**仍须保持占位**，下面的 identOk 据此放行。
     注：云台/ADS-B 当前不在 DEV_TYPES 内，先登记不启用。 */
  const KNOWN_IDENT = {
    '雷达':   { model: 'T02', vendor: '西安宝威' },
    '光电':   { model: 'DH-UCS-C2000T', vendor: '大华' },
    '云台':   { model: 'GT06Z-C', vendor: '南普达' },
    '干扰':   { model: 'sp-50', vendor: '神州明达' }
    /* 三方对照 §135 还列了 ADS-B=UAVIONIX pingstation3，这里**故意不登记**：
       ADS-B 是否恢复是尚未决定的范围问题（等用户裁决），
       登记它会让 scan 的「不得出现 ADS-B」报红，等于用一次顺手的补全
       去撬动一个还没做的决定。等决定下来再一起加。 */
  };
  const identOk = d => {
    const k = KNOWN_IDENT[d.type];
    const mOk = d.model === TBC || d.model === '—' || (k && d.model === k.model);
    const vOk = /^厂商[A-Z]$/.test(d.vendor) || d.vendor === '平台自研' || d.vendor === '—'
      || (k && d.vendor === k.vendor);
    return mOk && vOk;
  };

  /* ---- 探测范围约束的可执行性登记 ----
     "设备只能探测到它覆盖范围内的目标"这条规则，对**每一类**设备都成立，
     但只有拿到量程的那一类才**执行得了**。雷达的 400 个越界目标之所以藏了这么久，
     就是因为 `cover: TBC` 让这条约束在形式上存在、实质上不可能被违反 ——
     它看起来是个约束，其实是个空位，而空位不会报错，于是被读成"没问题"。

     所以这里把两种状态显式分开，谁也别再假装另一个：
       COVERAGE_ENFORCED    —— 有一手量程，且**确实**有自检在卡（当前仅雷达 T02）
       COVERAGE_UNVERIFIABLE—— 无资料，这条约束**当前执行不了**，不是"已通过"
     新增设备类型时二者必居其一，否则下面的断言报红，
     免得再出现"以为在管、其实没管"的第三种状态。 */
  const COVERAGE_ENFORCED = ['雷达'];
  const COVERAGE_UNVERIFIABLE = ['光电', '反制', '诱骗', '干扰', '驱鸟炮', '协议破解',
    '融合终端', 'TDOA', 'AOA', 'RemoteID', '5G-A基站'];

  const DEV_TYPES = [
    { type: '雷达', dt: 1, abbr: 'radar', cat: '雷达设备', ch: '融合感知箱', model: 'T02', vendor: '西安宝威', n: 46, freq: T02.band, cover: T02.rangeKm + ' km / 最大高度 ' + T02.maxAltM + ' m' },
    { type: '光电', dt: 3, abbr: 'oe', cat: '光电设备', ch: '融合感知箱', model: TBC, vendor: '厂商B', n: 58, freq: '可见光 + 红外', cover: TBC },
    { type: '反制', dt: 4, abbr: 'cm', cat: '反制设备', ch: '融合感知箱', model: TBC, vendor: '厂商C', n: 20, freq: TBC, cover: TBC },
    { type: '诱骗', dt: 5, abbr: 'dec', cat: '诱骗设备', ch: '融合感知箱', model: TBC, vendor: '厂商C', n: 8, freq: TBC, cover: TBC },
    { type: '干扰', dt: 6, abbr: 'ifr', cat: '干扰设备', ch: '融合感知箱', model: TBC, vendor: '厂商C', n: 8, freq: TBC, cover: TBC },
    { type: '驱鸟炮', dt: 12, abbr: 'bsc', cat: '驱鸟设备', ch: '融合感知箱', model: TBC, vendor: '厂商D', n: 6, freq: '—', cover: TBC },
    { type: '协议破解', dt: 11, abbr: 'dcd', cat: '协议破解设备', ch: '融合感知箱', model: TBC, vendor: '厂商E', n: 10, freq: TBC, cover: TBC },
    { type: '融合终端', dt: 999, abbr: 'other', cat: '边端融合终端', ch: '融合感知箱', model: TBC, vendor: '平台自研', n: 34, freq: '—', cover: '—' },
    { type: 'TDOA', dt: 10, abbr: 'tdoa', cat: '时差定位设备', ch: 'TDOA', model: TBC, vendor: '厂商F', n: 66, freq: TBC, cover: TBC },
    { type: 'AOA', dt: 9, abbr: 'aoa', cat: '测向定位设备', ch: 'TDOA', model: TBC, vendor: '厂商F', n: 42, freq: TBC, cover: TBC },
    { type: 'RemoteID', dt: 102, abbr: 'rid', cat: 'RemoteID设备(地面站)', ch: 'TDOA', model: TBC, vendor: '厂商G', n: 12, freq: TBC, cover: TBC },
    { type: '5G-A基站', dt: 0, abbr: '5ga', cat: '5G-A通感一体', ch: '5G-A', model: TBC, vendor: '厂商H', n: 46, freq: TBC, cover: TBC }
  ];
  /* 协议中存在、东营现场是否部署待确认：字典留位但不生成实例（V1.1 附录B） */
  const DEV_TYPES_RESERVED = [
    { type: '频谱', dt: 2, abbr: 'spec' }, { type: '指挥车', dt: 7, abbr: 'cv' },
    { type: '察打一体', dt: 8, abbr: 'isrs' }, { type: '直接上报监管', dt: 100, abbr: 'direct' },
    { type: '合作无人机', dt: 101, abbr: 'rtk' }
  ];
  const OWNERS = ['东营市公安局', '东营市低空安全管理中心', '胜利油田管理局', '东营机场公司', '利津县应急管理局'];
  const devices = [];
  (function buildDevices() {
    let seq = 0;
    DEV_TYPES.forEach(t => {
      for (let i = 0; i < t.n; i++) {
        seq++;
        const d = pickW(DISTRICTS.map(x => [x, x.w]));
        // 状态互斥：在线 / 离线 / 异常；告警是叠加属性（在线或异常设备都可能在告警）
        const status = pickW([['在线', 88], ['离线', 8], ['异常', 4]]);
        const hbMin = status === '离线' ? ri(12, 320) : ri(0, 2);
        const hb = new Date(CONF.demoTime.getTime() - hbMin * 60000 - ri(0, 59) * 1000);
        const alarm = status === '异常' ? true : (status === '在线' ? rnd() < 0.06 : rnd() < 0.5);
        devices.push({
          id: 'DEV' + '26' + p2(8) + p2(26) + p3(seq),
          name: d.name + t.type + p2(i + 1) + '号',
          type: t.type, deviceType: t.dt, deviceTypeAbbr: t.abbr,
          cat: t.cat, channel: t.ch, model: t.model, vendor: t.vendor,
          owner: OWNERS[seq % OWNERS.length],
          region: d.name,
          addr: d.name + pick(['府前大街', '黄河路', '西四路', '南一路', '港城路', '广利港路']) + ri(1, 288) + '号',
          lon: +(d.lon + (rnd() - .5) * 0.30).toFixed(6),
          lat: +(d.lat + (rnd() - .5) * 0.24).toFixed(6),
          alt: ri(8, 60),
          status, alarm,
          // 协议 workState：0 未工作 / 1 工作中 / 2 设备异常。
          // 反制类设备（cm/dec/ifr/bsc）待机不发射属正常，未开启 ≠ 异常
          workState: status === '异常' ? 2 : (status === '离线' ? 0
            : (['cm', 'dec', 'ifr', 'bsc'].includes(t.abbr) ? (rnd() < .25 ? 1 : 0) : 1)),
          health: status === '在线' ? (alarm ? '一般' : '良好') : (status === '异常' ? '异常' : '未知'),
          hb: fmtDT(hb), hbMin,
          ip: '192.168.' + ri(10, 40) + '.' + ri(2, 250),
          port: t.ch === '5G-A' ? 8443 : (t.type === '雷达' ? 9001 : 8080),
          proto: t.type === '雷达' ? 'TCP' : 'HTTP',
          fw: 'V' + ri(1, 3) + '.' + ri(0, 9) + '.' + ri(0, 9),
          installed: '202' + ri(4, 5) + '-' + p2(ri(1, 12)) + '-' + p2(ri(1, 28)),
          freq: t.freq, cover: t.cover,
          /* cpu / mem / disk 已删除：三份设备协议里**没有任何一条上报主机资源指标**
             （grep 命中 0），平台拿不到就不该显示 —— 显示了就是替设备编了它没说过的话。
             `temp` 暂留：本轮裁定只涉及那三项，没有一并核实温度是否有协议出处，
             **没核过的不顺手删**，留到有依据时一起处理（未见资料，不是已确认无）。
             `latency / loss / rssi` 保留：那是平台侧可测的链路量，不是设备上报的主机指标。 */
          temp: ri(38, 79),
          latency: status === '离线' ? null : ri(12, 180),
          loss: status === '离线' ? null : +(rnd() * (alarm ? 26 : 1.4)).toFixed(2),
          rssi: -ri(52, 98)
        });
      }
    });
  })();

  const deviceStats = (function () {
    const total = devices.length;
    const online = devices.filter(d => d.status === '在线').length;
    const offline = devices.filter(d => d.status === '离线').length;
    const abn = devices.filter(d => d.status === '异常').length;
    const alarm = devices.filter(d => d.alarm).length;
    return {
      total, online, offline, abnormal: abn, alarm,
      onlineRate: +(online / total * 100).toFixed(1),
      offlineRate: +(offline / total * 100).toFixed(1),
      abnormalRate: +(abn / total * 100).toFixed(1),
      alarmRate: +(alarm / total * 100).toFixed(1),
      avgLatency: Math.round(sum(devices.filter(d => d.latency), d => d.latency) / devices.filter(d => d.latency).length),
      byChannel: ['融合感知箱', 'TDOA', '5G-A'].map(ch => {
        const g = devices.filter(d => d.channel === ch);
        return {
          channel: ch, total: g.length,
          online: g.filter(d => d.status === '在线').length,
          offline: g.filter(d => d.status === '离线').length,
          abnormal: g.filter(d => d.status === '异常').length,
          alarm: g.filter(d => d.alarm).length,
          rate: +(g.filter(d => d.status === '在线').length / g.length * 100).toFixed(1)
        };
      }),
      byType: DEV_TYPES.map(t => {
        const g = devices.filter(d => d.type === t.type);
        return {
          type: t.type, channel: t.ch, total: g.length,
          online: g.filter(d => d.status === '在线').length,
          offline: g.filter(d => d.status === '离线').length,
          abnormal: g.filter(d => d.status === '异常').length
        };
      })
    };
  })();

  /* ---------------- 2. 空域规则（东营，修正原图东莞坐标） ---------------- */
  const airspaces = [
    {
      id: 'NF001', name: '禁飞空域-胜利机场核心区', type: '禁飞空域', color: '#ff4d5e',
      region: '东营区', limit: 0, limitTx: '0m（禁止飞行）', unit: '东营市公安局',
      from: '2026-01-01 00:00:00', to: '长期有效', status: '生效中', updated: '2026-08-21 15:30:21',
      limitDatum: 'amsl',   // 机场净空面按海拔高定义
      center: { lon: 118.788, lat: 37.216 }, r: 0.085,
      poly: [[118.700, 37.170], [118.880, 37.163], [118.905, 37.245], [118.812, 37.288], [118.696, 37.256]],
      note: '依据《中华人民共和国飞行基本规则》及机场净空保护要求设立，禁止任何无人机飞行活动。'
    },
    {
      id: 'HGH001', name: '限高区-东营港经济区', type: '限高区域', color: '#ffb020',
      region: '东营港经济区', limit: 120, limitTx: '120m', unit: '东营市交通运输局',
      from: '2026-03-01 00:00:00', to: '长期有效', status: '生效中', updated: '2026-08-20 09:12:10',
      limitDatum: 'agl',
      center: { lon: 118.958, lat: 38.048 }, r: 0.075,
      poly: [[118.880, 38.010], [119.040, 38.005], [119.055, 38.090], [118.940, 38.108], [118.872, 38.062]],
      note: '港区吊装作业与航道保障区域，最大飞行真高不得超过 120m。'
    },
    {
      id: 'KF001', name: '重点防控区域-市府核心区', type: '重点防控区域', color: '#3d8bff',
      region: '东营区', limit: 150, limitTx: '150m', unit: '东营市公安局',
      from: '2026-01-01 00:00:00', to: '长期有效', status: '生效中', updated: '2026-08-19 11:45:33',
      limitDatum: 'agl',
      center: { lon: 118.585, lat: 37.451 }, r: 0.062,
      poly: [[118.525, 37.418], [118.648, 37.412], [118.665, 37.492], [118.575, 37.512], [118.512, 37.470]],
      note: '党政机关、重要会议及大型活动核心保障区，飞行须持许可并实时报备。'
    },
    {
      id: 'TG001', name: '临时管制区-黄河口马拉松', type: '临时管制区', color: '#2fd06e',
      region: '垦利区', limit: 80, limitTx: '80m', unit: '东营市公安局垦利分局',
      from: '2026-08-26 06:00:00', to: '2026-08-26 18:00:00', status: '生效中', updated: '2026-08-25 08:00:00',
      limitDatum: 'agl',
      center: { lon: 118.552, lat: 37.596 }, r: 0.055,
      poly: [[118.500, 37.565], [118.612, 37.560], [118.622, 37.632], [118.520, 37.640]],
      note: '大型群众性活动临时管制，仅限报备的赛事航拍机在指定高度飞行。'
    },
    {
      id: 'S001', name: '适飞空域-黄河口生态旅游区', type: '适飞空域', color: '#a97bff',
      region: '垦利区', limit: 120, limitTx: '120m', unit: '东营市低空安全管理中心',
      from: '2026-02-01 00:00:00', to: '长期有效', status: '生效中', updated: '2026-08-18 16:22:44',
      limitDatum: 'agl',
      center: { lon: 118.245, lat: 37.320 }, r: 0.090,
      poly: [[118.150, 37.270], [118.340, 37.262], [118.362, 37.360], [118.240, 37.392], [118.140, 37.345]],
      note: '轻小型无人机适飞区，真高 120m 以下、白天目视范围内可免申请飞行。'
    },
    {
      id: 'HGH002', name: '限高区-广饶工业园区', type: '限高区域', color: '#ffb020',
      region: '广饶县', limit: 100, limitTx: '100m', unit: '广饶县应急管理局',
      from: '2026-04-10 00:00:00', to: '长期有效', status: '生效中', updated: '2026-08-15 10:05:12',
      limitDatum: 'agl',
      center: { lon: 118.405, lat: 37.062 }, r: 0.058,
      poly: [[118.348, 37.028], [118.462, 37.022], [118.472, 37.098], [118.362, 37.106]],
      note: '危化品生产聚集区，禁止携带载荷飞行，最大真高 100m。'
    },
    {
      id: 'NF002', name: '禁飞空域-胜利油田中心油库', type: '禁飞空域', color: '#ff4d5e',
      region: '东营区', limit: 0, limitTx: '0m（禁止飞行）', unit: '胜利油田管理局',
      from: '2026-01-01 00:00:00', to: '长期有效', status: '生效中', updated: '2026-08-12 14:20:08',
      limitDatum: 'agl',
      center: { lon: 118.712, lat: 37.520 }, r: 0.045,
      poly: [[118.672, 37.492], [118.756, 37.488], [118.762, 37.552], [118.680, 37.556]],
      note: '国家重点能源设施保护区，禁止任何飞行器进入。'
    },
    {
      id: 'TG002', name: '临时管制区-河口应急演练', type: '临时管制区', color: '#2fd06e',
      region: '河口区', limit: 60, limitTx: '60m', unit: '东营市应急管理局',
      from: '2026-08-24 08:00:00', to: '2026-08-28 18:00:00', status: '生效中', updated: '2026-08-23 17:40:00',
      limitDatum: 'agl',
      center: { lon: 118.520, lat: 37.888 }, r: 0.050,
      poly: [[118.470, 37.858], [118.575, 37.855], [118.582, 37.920], [118.478, 37.926]],
      note: '应急救援实兵演练空域，仅限演练指挥单位报备机型进入。'
    }
  ];

  /* ---- F0405:空域规则版本与发布/回滚(内存态,可真实切换) ---- */
  /* ---- 规则版本台账（覆盖空域 + 航线两类）----
     设计 §8.5 原文写的是「**规则**版本管理：每次变更留存版本、操作者、生效时间与变更原因」——
     说的是规则，不是空域；航线本来就在覆盖范围内。
     此前只覆盖空域，做航线面板时若另建一份，就会变成"空域一套规则治理、航线另一套"，
     而两者最终要进同一套版本审计。故扩这一份，加 ruleKind 区分，不新建第二份。 */
  const RULE_KINDS = [
    { key: 'airspace', name: '空域规则' },
    { key: 'route', name: '航线规则' }
  ];
  const ruleVersions = [
    {
      ruleKind: 'airspace', ver: 'v1.4', publishedAt: '2026-08-25 08:00:00', publisher: '王振华', status: '当前生效',
      changes: ['新增 TG002 河口应急演练临时管制区', '调整 HGH001 东营港限高 150m → 120m']
    },
    {
      ruleKind: 'airspace', ver: 'v1.3', publishedAt: '2026-08-20 14:12:00', publisher: '张建国', status: '历史',
      changes: ['新增 TG001 黄河口马拉松临时管制区', '启用 NF002 中心油库禁飞区']
    },
    {
      ruleKind: 'airspace', ver: 'v1.2', publishedAt: '2026-08-12 09:30:00', publisher: '王振华', status: '历史',
      changes: ['新增 HGH002 广饶工业园区限高 100m']
    },
    {
      ruleKind: 'airspace', ver: 'v1.1', publishedAt: '2026-07-28 16:40:00', publisher: '李国强', status: '历史',
      changes: ['S001 适飞空域范围扩大至黄河口生态区全域']
    },
    {
      ruleKind: 'airspace', ver: 'v1.0', publishedAt: '2026-06-01 10:00:00', publisher: '系统管理员', status: '历史',
      changes: ['初始发布:NF001 / HGH001 / KF001 / S001']
    },
    {
      ruleKind: 'route', ver: 'r1.2', publishedAt: '2026-08-24 10:15:00', publisher: '王振华', status: '当前生效',
      changes: ['RT2026003 广利港岸线巡查航线走廊宽度 300m → 400m', 'RT2026007 市区安防巡逻航线因穿越禁飞区降为草稿']
    },
    {
      ruleKind: 'route', ver: 'r1.1', publishedAt: '2026-08-15 09:40:00', publisher: '张建国', status: '历史',
      changes: ['新增 RT2026001~RT2026009 共 9 条巡检/测绘航线', '统一走廊宽度容差为 50m']
    }
  ];

  /* ---- F0407:规则冲突检测 —— 空间(包围盒相交) + 时间(生效期重叠) ---- */
  function bboxOf(poly) {
    return poly.reduce((m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1]),
    Math.max(m[2], p[0]), Math.max(m[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
  }
  function bboxOverlap(a, b) {
    const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ox <= 0 || oy <= 0) return 0;
    const inter = ox * oy, ua = (a[2] - a[0]) * (a[3] - a[1]);
    return ua ? +(inter / ua * 100).toFixed(1) : 0;      // 相对被检规则的重叠占比 %
  }
  function timeOverlap(a, b) {
    const P = t => t === '长期有效' ? 4102416000000 : new Date(t.replace(/-/g, '/')).getTime();
    const a0 = P(a.from), a1 = P(a.to), b0 = P(b.from), b1 = P(b.to);
    return a0 < b1 && b0 < a1;
  }
  /* 返回与目标规则冲突的清单;level:严重(禁飞被覆盖/限高矛盾) / 提示(一般重叠) */
  /* 冲突判定的最小重叠率【待确认：业务方】—— 低于此比例视为边界擦碰，不报冲突 */
  const CONFLICT_MIN_OVERLAP = 3;
  /* 说明：forbidsAllPlans 是一条**声明**（依据设计 §10.4 表10-4 要件①），
     数据层没有第二个来源可以拿来验证它对不对 —— 它的防线在文档评审与业务方签认，
     不在 selfCheck 里。selfCheck 能做的是保证「所有用到它的地方口径一致」。 */
  function detectConflicts(zone, list) {
    const src = (list || airspaces).filter(a => a.id !== zone.id && a.status === '生效中');
    const zb = bboxOf(zone.poly);
    const out = [];
    src.forEach(a => {
      const pct = bboxOverlap(zb, bboxOf(a.poly));
      if (pct < CONFLICT_MIN_OVERLAP) return;
      if (!timeOverlap(zone, a)) return;
      /* 判据取自空域类型声明的 forbidsAllPlans，不再写死「禁飞空域」——
         临时管制区同样是「任何飞行计划都无权批准进入」，写死类型名会让它掉进"提示"档，
         用户于是可以静默地在绝对禁止空间上叠一条限高规则。
         这里还藏着一层掩盖：若双方限高值不同，会落到下面的「限高矛盾」分支、碰巧也报严重，
         看起来是对的 —— 必须用限高值相同（或都为 0）的用例才暴露。 */
      const zForbid = airspaceType(zone.type).forbidsAllPlans;
      const aForbid = airspaceType(a.type).forbidsAllPlans;
      let level = '提示', reason = '空间与时间范围存在重叠';
      if (zForbid && !aForbid) { level = '严重'; reason = `${zone.type}覆盖非禁止类规则，低优先级规则将失效`; }
      else if (aForbid && !zForbid) { level = '严重'; reason = `与既有${a.type}重叠，本规则在重叠区不生效`; }
      else if (zone.limit > 0 && a.limit > 0 && zone.limit !== a.limit) { level = '严重'; reason = `限高矛盾：${zone.limitTx} vs ${a.limitTx}，重叠区取更严值 ${Math.min(zone.limit, a.limit)}m`; }
      out.push({ id: a.id, name: a.name, type: a.type, overlap: pct, level, reason, period: a.from.slice(0, 10) + ' ~ ' + (a.to === '长期有效' ? '长期' : a.to.slice(0, 10)) });
    });
    return out.sort((x, y) => (x.level === '严重' ? -1 : 1) - (y.level === '严重' ? -1 : 1) || y.overlap - x.overlap);
  }

  /* ---- F0605:告警通知渠道 ----
     2026-08-25 客户决定:短信 / 钉钉 / 企业微信三个外发渠道作废(部署为客户自有机房 + 纯内网,
     互联网侧渠道不可达)。保留站内 + 内网专线同步 + 机场塔台通报;塔台自动推送方式待确认。 */
  const notifyChannels = [
    { id: 'NC1', name: '平台站内告警', type: '内部', target: '值班席位', on: true, ready: true, api: '平台内部推送', desc: '默认开启，实时弹窗与铃铛提醒' },
    { id: 'NC2', name: '上级管控平台同步', type: '内网专线', target: '省级/市级管控平台', on: true, ready: true, api: '/api/v1/dispatch/sync', desc: '高风险告警实时同步，经内网专线，已联调' },
    { id: 'NC3', name: '机场塔台通报单（人工闭环）', type: '人工', target: '胜利机场塔台', on: true, ready: true, api: '平台生成通报单 + 回执登记', desc: '生成《鸟情/空情通报单》，值班员按 SOP 电话或传真通知塔台，回填接听人与时间，全程可审计' },
    { id: 'NC4', name: '机场塔台自动推送', type: '外发', target: '胜利机场塔台', on: false, ready: false, api: '【待确认：通道方式】', desc: '纯内网下无法直连，需与机场拉专线、经单向网闸摆渡，或在塔台部署只读终端 —— 方式待客户与机场确认' }
  ];

  /* ---------------- 3. 飞行计划 / 合作方 ---------------- */
  /* 合作方为示例主体，不使用真实企业名（与设备厂家同一口径，纪要 §7） */
  const PARTNERS = [
    { name: '东营通航服务有限公司', drones: 86 }, { name: '黄河口无人机应用公司', drones: 68 },
    { name: '东营启航科技', drones: 42 }, { name: '山东云翼智能', drones: 36 },
    { name: '东营智航科技', drones: 28 }, { name: '胜利油田巡检队', drones: 24 },
    { name: '黄河口测绘队', drones: 18 }, { name: '利津应急救援队', drones: 14 }
  ];
  const PILOTS = ['张伟', '李强', '王磊', '赵鹏', '孙涛', '周敏', '吴刚', '郑凯', '陈晨', '刘洋', '黄勇', '徐亮'];
  const MODELS = ['DJI Mavic 3', 'DJI Air 2S', 'DJI Mini 3', 'DJI M300 RTK', 'Autel EVO II', '大疆机场2'];
  /* 机型来源分级 —— 雷达与 5G-A 通感给不出机型，射频类只能到系列级。
     【闭集读法·雷达】T02 协议 v3.0.0 §2.3.10 UPLOAD_TRACK_V3 逐字段穷举了航迹上报内容：
       坐标XYZ/速度XYZ/目标ID/信噪比/RCS/目标类型/选中标志/若干预留。
       其中「目标类型」是 6 值枚举（未完成/人/车/无人机/飞鸟/未识别），**粒度到类别为止**，
       整张表没有型号、没有序列号字段。所以"雷达给不出机型"是从闭集里读出来的，
       不是"我没找到" —— 这条现在有正面出处。
     【查证范围·5G-A】本仓 2026-08-27 时点全部设备资料为：设备资料/反制（6 份）、
       设备资料/雷达（3 份），**均无 5G-A 通感材料**；协议 v8.6 不在本仓。
       故 5G-A 一栏仍属"未见资料"，不是已证实的不能。
     此前 646 个无人机 100% 都填了具体型号，等于让平台声称了设备不具备的识别能力：
     一个只被雷达看到的目标，界面上却写着「DJI M300 RTK」。 */
  const MODEL_SERIES = { 'DJI Mavic 3': 'DJI Mavic 系列', 'DJI Air 2S': 'DJI Air 系列', 'DJI Mini 3': 'DJI Mini 系列',
    'DJI M300 RTK': 'DJI M 行业系列', 'Autel EVO II': 'Autel EVO 系列', '大疆机场2': 'DJI 机场系列' };
  const MODEL_UNKNOWN = '未识别';
  const PURPOSE = ['电力巡检', '管道巡检', '航拍测绘', '应急救援', '农业植保', '安防巡逻', '环保监测'];

  /* ---------------- 3.5 合法航线（设计 §8.5「航线管理」）----------------
     会议原话：管服平台「要输给我们哪些是合理的飞行航线」。未接入前标 Mock，
     与既有 Adapter 机制一致：正式接口到位后替换本段，页面与规则不动。

     走廊 = 中心线（航路点序列）+ 标称宽度 + 宽度容差。
     判偏离用 widthM/2 + widthTolM 作为半宽阈值 —— 宽度是走廊全宽，别当成半宽用。 */
  const ROUTE_PARAMS = {
    defaultWidthM: 300,      // 走廊标称宽度【待确认：业务方】
    defaultTolM: 50,         // 宽度容差【待确认：业务方】
    /* 偏航持续时间门槛【待确认：业务方】。
       定位：**纵深防御**，不是主防线 —— 单点 GPS 跳变本应由上游 B07 异常数据剔除
       （§6.3 范围校验、物理合理性校验）滤掉，不该留到 C02 才处理。
       有了它不等于不用管 B07：它挡的是漏网的孤立野点，不是系统性的定位质量问题。 */
    offRouteHoldSec: 10
  };
  const ROUTE_PURPOSES = PURPOSE;          // 复用飞行计划用途枚举，不另建一套
  const ROUTE_STATUS = ['生效中', '已停用', '草稿'];   // 与 airspaces[].status 同枚举

  const routes = [];
  (function buildRoutes() {
    const NAMES = ['黄河口生态区巡检', '胜利油田管道巡检', '广利港岸线巡查', '东营港航道监测',
      '孤东采油区巡检', '黄河故道测绘', '市区安防巡逻', '农业植保作业', '应急救援通道'];
    NAMES.forEach((nm, i) => {
      const d = pickW(DISTRICTS.map(x => [x, x.w]));
      const n = ri(3, 7);
      // 中心线：从起点按一个大致航向逐点延伸，段长 0.8~2.2km，航向小幅摆动
      let lon = +(d.lon + (rnd() - .5) * .12).toFixed(6);
      let lat = +(d.lat + (rnd() - .5) * .09).toFixed(6);
      let hdg = rnd() * Math.PI * 2;
      const wps = [];
      for (let k = 0; k < n; k++) {
        wps.push({
          seq: k + 1, lon, lat, alt: ri(60, 140),
          name: k === 0 ? '起点' : k === n - 1 ? '终点' : '航路点' + (k + 1)
        });
        hdg += (rnd() - .5) * .9;
        const legKm = 0.8 + rnd() * 1.4;
        let nLon = lon + legKm * Math.cos(hdg) / (111 * Math.cos(lat * Math.PI / 180));
        let nLat = lat + legKm * Math.sin(hdg) / 111;
        /* 走出东营行政范围就把航向沿越界轴反射回来（而不是把点夹到边界上：
           夹点会在边界上堆出一串共线航路点，走廊几何会退化）。 */
        const B = CONF.bounds, m = .01;
        if (nLon <= B.lon0 + m || nLon >= B.lon1 - m) {
          hdg = Math.PI - hdg;
          nLon = lon + legKm * Math.cos(hdg) / (111 * Math.cos(lat * Math.PI / 180));
        }
        if (nLat <= B.lat0 + m || nLat >= B.lat1 - m) {
          hdg = -hdg;
          nLat = lat + legKm * Math.sin(hdg) / 111;
        }
        lon = +Math.min(B.lon1 - m, Math.max(B.lon0 + m, nLon)).toFixed(6);
        lat = +Math.min(B.lat1 - m, Math.max(B.lat0 + m, nLat)).toFixed(6);
      }
      const st = new Date(CONF.demoTime); st.setDate(st.getDate() - ri(30, 200));
      routes.push({
        id: 'RT2026' + p3(i + 1),
        name: nm + '航线-' + p2(i + 1),
        purpose: pick(ROUTE_PURPOSES),
        region: d.name,                    // 仅供筛选：走廊可跨区，不得用它做任何几何判断
        unit: pick(['东营市低空安全管理中心', '东营市公安局']),
        waypoints: wps,
        widthM: pick([200, 300, 400]),
        widthTolM: ROUTE_PARAMS.defaultTolM,
        maxAltM: pick([90, 120, 150]),
        altDatum: 'agl',                   // 与 airspaces[].limitDatum 同一约定，不引入第三套基准
        from: fmtDT(st), to: '长期有效',
        status: pickW([['生效中', 88], ['已停用', 12]]),
        draftReason: '',
        updated: fmtDT(new Date(CONF.demoTime.getTime() - ri(1, 30) * 86400000)),
        ver: 'v1.' + ri(0, 4),
        planIds: [],                       // 建完计划后回填
        source: '管服平台（Mock，未接入）',
        note: ''
      });
    });
  })();
  const routeById = id => routes.find(r => r.id === id) || null;
  const routesOf = planId => {
    const p = flightPlans.find(x => x.id === planId);
    return p && p.routeId ? [routeById(p.routeId)].filter(Boolean) : [];
  };
  const plansOf = routeId => flightPlans.filter(p => p.routeId === routeId);
  /* 派生只读视图：页面显示「N 个航路点」时取这里，不在数据里另存字符串。
     用函数声明（会提升），因为 buildPlans 里的 getter 在定义点之前就引用了它。 */
  function routeSummary(planId) {
    const r = routesOf(planId)[0];
    return r ? r.waypoints.length + ' 个航路点（' + r.name + '）' : '未关联航线';
  }

  /* 航线与空域冲突检测 —— 与 detectConflicts 同一形状与同一判据来源：
     严重级取空域类型声明的 forbidsAllPlans，不写死类型名。
     航线穿限高区是正常的（受限高约束即可），穿禁飞/临时管制才是问题。 */
  function detectRouteConflicts(route, list) {
    const src = (list || airspaces).filter(a => a.status === '生效中');
    const rb = bboxOf(route.waypoints.map(w => [w.lon, w.lat]));
    const out = [];
    src.forEach(a => {
      const pct = bboxOverlap(rb, bboxOf(a.poly));
      if (pct < CONFLICT_MIN_OVERLAP) return;
      const forbid = airspaceType(a.type).forbidsAllPlans;
      let level = '提示', reason = '航线走廊与该空域范围重叠';
      if (forbid) { level = '严重'; reason = `走廊穿越${a.type}「${a.name}」—— 任何飞行计划都无权批准进入`; }
      else if (a.limit > 0 && route.maxAltM > a.limit) {
        level = '严重';
        reason = `航线限高 ${route.maxAltM}m 超出${a.type}限高 ${a.limitTx}（基准 ${(a.limitDatum || 'agl').toUpperCase()}）`;
      }
      out.push({ id: a.id, name: a.name, type: a.type, overlap: pct, level, reason });
    });
    return out.sort((x, y) => (x.level === '严重' ? -1 : 1) - (y.level === '严重' ? -1 : 1) || y.overlap - x.overlap);
  }

  const flightPlans = [];
  (function buildPlans() {
    /* 计划日期原来**全部**落在 demoTime 当天或 +1~3 天，没有一条历史计划。
       两个后果：
       ① 风险判定的「近 7 天该航线是否有飞行」恒为 true —— 三因子里那一条从不判别；
       ② 目标声称命中的计划 100% 开始于它飞完之后（实测 336/337），
          等于"先飞后批"。
       改为按航线铺开：一部分航线只有历史计划（10~20 天前），
       其余仍有近期与待执行计划，时间因子这才判别得动。
       演示主角关联的航线不动（见 HIST_ROUTES 注释）。 */
    for (let i = 0; i < 46; i++) {
      const st = new Date(CONF.demoTime); st.setHours(ri(6, 18), pick([0, 15, 30, 45]), 0, 0);
      st.setDate(st.getDate() + (i < 34 ? 0 : ri(1, 3)));
      const dur = ri(30, 180);
      const et = new Date(st.getTime() + dur * 60000);
      const d = pickW(DISTRICTS.map(x => [x, x.w]));
      const p = PARTNERS[i % PARTNERS.length];
      const now = CONF.demoTime;
      let status;
      if (st > now) status = '待执行';
      else if (et < now) status = rnd() < .1 ? '已终止' : '已完成';
      else status = '执行中';
      flightPlans.push({
        id: 'FP2026' + p2(8) + p2(26) + p3(i + 1),
        droneId: 'UAS' + ri(100000, 999999),
        model: pick(MODELS), partner: p.name, pilot: pick(PILOTS),
        pilotLic: 'CAAC-' + ri(100000, 999999),
        purpose: pick(PURPOSE), region: d.name,
        takeoff: { lon: +(d.lon + (rnd() - .5) * .1).toFixed(5), lat: +(d.lat + (rnd() - .5) * .08).toFixed(5) },
        start: fmtDT(st), end: fmtDT(et), durMin: dur,
        maxAlt: pick([60, 90, 120, 150]),
        routeId: null,      // 下面按区域回填；描述字符串由 waypoints.length 派生，不另存一份
        approver: pick(['东营市公安局', '东营市低空安全管理中心']),
        approvedAt: fmtDT(new Date(st.getTime() - ri(4, 48) * 3600000)),
        source: pick(['上级管控平台', '上级管控平台', '本地报备']),
        status,
        matched: status === '待执行' ? '—' : (rnd() < .82 ? '已匹配' : '未匹配感知目标'),
        /* 横向偏航需要「批准航线走廊几何 + 实际航迹」两个输入，目前后者全库为空
           （track_points 未生成），所以 lateral 只能是 null（不可判定）。
           原先是 rnd()*620 的随机米数 —— 与判定页那个编出来的「超过 500m」是同一个病。
           注意不能只是删掉这个字段：消费端 devJudge 走 Math.abs(null)=0 会得到「正常」，
           那是把编的数换成编的"合规"结论。故显式声明 undeterminable，与目标上的同名同义。 */
        deviation: status === '待执行' ? null : {
          lateral: null,
          undeterminable: ['横向偏航'],
          undeterminableReason: '无航线走廊几何与实际航迹，横向偏航无判据可依',
          timeMin: +(rnd() * 22 - 6).toFixed(0), altDelta: ri(-20, 35)
        }
      });
    }
    /* 计划 ↔ 航线双向关联：优先同区域的生效航线，同区没有再退到全域。
       route 描述字符串从 waypoints.length 派生 —— 「航路点数从这里来、坐标从那里来」
       正是 cases[].evidence 那个数字的同类问题。 */
    flightPlans.forEach(p => {
      const pool = routes.filter(r => r.status === '生效中' && r.region === p.region);
      const r = (pool.length ? pick(pool) : pick(routes.filter(x => x.status === '生效中')));
      if (!r) return;
      p.routeId = r.id;
      r.planIds.push(p.id);
    });
    /* ---- 让一部分航线只有历史计划 ----
       目的：风险判定的「时间」因子此前恒为 true（46 条计划全在 7 天窗内），
       三因子里那一条从不判别。把这几条航线的计划整体挪到 10~20 天前之后，
       它们周边的风险事件 inWindow 就会为 false，因子才真正参与判定。

       **RT2026008 故意不在名单里**：演示主角 UAV20260826003 的最近航线是它
       （10.42 km，虽已在「仅记录」档，但按约定不动主角相关的航线）。
       挪动的是「哪几条航线近期没飞」这个事实本身，不是为了把某个数字调好看 ——
       所以挪完之后 inWindow 变成什么分布，就报什么分布。 */
    const HIST_ROUTES = ['RT2026002', 'RT2026003', 'RT2026009'];
    /* 这里**刻意不调用 rnd()/ri()**：全库数据由同一条带种子的随机流生成，
       在这里多取几个随机数会把后面所有生成结果整体挪位 ——
       实测加了两处 ri() 之后风险事件从 163 变成 172，
       而那 9 条的差异**与本次口径变更毫无关系**，纯粹是随机流错位。
       那样一来"变更前 vs 变更后"就不再是同一份数据的对照，
       报出去的差值里混着噪声，读的人无从分辨哪部分是口径带来的。
       所以位移量与状态全部由计划自身的确定量派生。 */
    let hi = 0;
    flightPlans.forEach(p => {
      if (HIST_ROUTES.indexOf(p.routeId) < 0) return;
      const back = (10 + (hi % 11)) * 86400000;          // 10~20 天，确定性
      const lead = (4 + (hi % 45)) * 3600000;            // 提前审批时长，确定性
      hi += 1;
      const st = new Date(new Date(p.start).getTime() - back);
      const et = new Date(st.getTime() + p.durMin * 60000);
      p.start = fmtDT(st); p.end = fmtDT(et);
      p.approvedAt = fmtDT(new Date(st.getTime() - lead));
      /* 状态跟着时间重算：挪到过去了还写「待执行」就是自相矛盾。
         「已终止」按计划序号确定性地取 1/10，不占用随机流。 */
      p.status = et < CONF.demoTime ? (hi % 10 === 0 ? '已终止' : '已完成') : '执行中';
      if (p.matched === '—') p.matched = '已匹配';        // 不再是待执行，就该有匹配结论
    });

    /* p.route 保留为**派生只读属性**而不是存储字段：
       既不在数据里存第二份「N 个航路点」（那是 cases[].evidence 那类"数从这来、内容从那来"），
       也不让已有消费方（flights.js 详情的「航线」一行）在迁移期间读到 undefined。
       消费方改读 M.routeSummary(planId) 后，这个兼容属性即可删除。 */
    flightPlans.forEach(p => {
      Object.defineProperty(p, 'route', {
        enumerable: false, configurable: true,
        get() { return routeSummary(p.id); }
      });
    });
  })();


  /* ---------------- 4. 感知目标（近30天全量 + 今日详单） ---------------- */
  /* A4:目标类型仅协议 objectType 八值（0未知/3行人/7车/30无人机/40鸟/50船/100遥控器/255识别中）。
     协议中没有风筝、气球、孔明灯 —— 设备侧报不出来，只能作为 subtype 由光电分类算法 A06 推断。 */
  const OBJECT_TYPES = [
    { code: 0, name: '未知', abbr: 'UNK' }, { code: 3, name: '行人', abbr: 'PED' },
    { code: 7, name: '车', abbr: 'VEH' }, { code: 30, name: '无人机', abbr: 'UAV' },
    { code: 40, name: '鸟', abbr: 'BRD' }, { code: 50, name: '船', abbr: 'SHP' },
    { code: 100, name: '遥控器', abbr: 'RCT' }, { code: 255, name: '识别中', abbr: 'IDF' }
  ];
  const T_TYPES = [['无人机', 53], ['鸟', 24], ['未知', 12], ['识别中', 6], ['船', 3], ['车', 2]];
  /* C02 严重违规项（表10-3 空域/航线/时间合法性）。
     注意：「未经批准飞行」是 C01 计划匹配未命中的结果，属 C01 不属 C02，不得混入，
     否则界面会出现「C02 规则命中：未经批准飞行」——而 C02 根本没有这条规则。
     C02 严重违规是「非法」的加重情形，不是必要条件。 */
  const C02_SEVERE = ['侵入禁飞区', '超出空域限高', '超出空域管制时段', '偏离报备航线'];
  /* 罚则表（表10-3）—— 同时充当违规严重度的声明式排序依据 */
  const FINE = { '未经批准飞行': 5000, '侵入禁飞区': 10000, '超出空域限高': 5000, '超出计划批准高度': 3000,
    '超出空域管制时段': 4000, '超出计划批准时段': 1000, '超视距飞行': 3000, '夜间飞行': 2000,
    '偏离报备航线': 2000, '身份不匹配': 20000 };
  /* 主违规（案由/罚款基准）—— 取罚则表金额最高的一条，同额按 VIOLATIONS 声明顺序。
     此前取 violation_reasons[0]，等于把「push 的先后」当成了严重度契约：
     加一条规则、换一下判定顺序，案由和罚款基准就会跟着变，而没人会察觉。 */
  function primaryViolation(list) {
    if (!list || !list.length) return null;
    return list.slice().sort((a, b) =>
      (FINE[b] || 0) - (FINE[a] || 0) || VIOLATIONS.indexOf(a) - VIOLATIONS.indexOf(b))[0];
  }

  /* ---- 航线走廊几何数据是否可用 ----
     「偏离报备航线」要判，前提是有报备航线的几何：航路点坐标 + 走廊宽度 + 宽度容差。
     管服平台的 routes 未接入前，全站不存在任何可比对的几何
     （flightPlans[].route 是「N 个航路点」这样的描述字符串，不是坐标）。
     此时 offRoute 只能是 null（不可判定）：
       置 true  = 无依据地认定偏离 —— 这条事由能进案由、进证据链、进处罚文书；
       置 false = 无依据地断言"没有偏离" —— 同样是编造结论，且更隐蔽。
     routes 接入后把本开关置 true，并在 computeOffRoute 里做真实计算：
       轨迹点到走廊中心线的横向偏差 > widthM/2 + widthTolM，且持续 offRouteHoldSec 秒 → true。 */
  /* 判据可用 = 走廊几何（routes）**且**该架次有实际航迹（track_points）。
     两个输入缺任一个都算不出横向偏差，所以这不是一个"建完 routes 就翻 true"的开关。 */
  const ROUTE_GEOM_READY = true;

  /* ---- C01 计划匹配（表10-2）----
     匹配按五个维度逐一比对，结果分三档：
       完全命中：五维度均在容差内
       部分命中：时空基本吻合，但某些维度偏离或不可判定 —— **不直接判非法**，
                 携带偏离维度进入 C02 与 C03 进一步判定
       未命中  ：找不到任何可关联计划 → 「未经批准飞行」
     原先 hasPlan 是布尔值，把中间那档丢了：部分命中被迫二选一，
     要么当成"有计划"（放过偏离维度），要么当成"没计划"（直接定黑飞）。
     维度值 true=命中 / false=偏离 / null=不可判定（无判据，既不算命中也不算偏离）。 */
  const C01_DIMS = ['时间窗口', '起降点', '航线走廊', '无人机身份', '飞手单位'];
  /* 容差参数，均为 Demo 缺省值【待确认：业务方】（§10.9 规则与阈值参数总表） */
  const C01_TOL = { timeWinMin: 10, takeoffM: 500 };
  const PLAN_MATCH = ['完全命中', '部分命中', '未命中'];
  function gradePlanMatch(dims, hasCandidate) {
    if (!hasCandidate) return '未命中';
    const vs = C01_DIMS.map(d => dims[d]);
    return vs.every(v => v === true) ? '完全命中' : '部分命中';
  }
  const planned = f => f.planMatch !== '未命中';   // 「存在可关联计划」——含部分命中

  /* C02 + C03：由客观事实推导「违规事由清单 + 判定结论」。
     抽成函数是因为事实会被后续复核修订（设备二次标定、轨迹复算），
     修订后必须走同一套规则重算 —— 复制一份规则等于把单一数据源约定破在这里。 */
  function deriveLegality(f) {
    const vs = [];
    // 只有「未命中」才构成黑飞；「部分命中」的偏离维度由 C02 各项分别承担
    if (f.planMatch === '未命中') vs.push('未经批准飞行');
    if (f.inNoFlyZone) vs.push('侵入禁飞区');
    if (f.overZoneHeight) vs.push('超出空域限高');
    if (f.overZoneTime) vs.push('超出空域管制时段');
    if (f.overPlanHeight) vs.push('超出计划批准高度');
    if (f.overPlanTime) vs.push('超出计划批准时段');
    // 显式 === true：null（不可判定）与 undefined 都不得被当成"发生了偏离"
    if (f.offRoute === true) vs.push('偏离报备航线');
    if (f.night) vs.push('夜间飞行');
    if (f.bvlos) vs.push('超视距飞行');
    /* C03 表10-4 四要件 */
    const notCovered = f.inNoFlyZone || f.planMatch === '未命中' || f.overZoneHeight || f.overZoneTime;
    const strong = f.sourceConfidence >= 0.80;                 // 要件③ 证据强度
    const stable = f.trackStatus === '稳定';                    // 要件④ 轨迹可靠
    let legal;
    if (!vs.length) legal = (f.trackStatus === '短时丢失' || f.trackStatus === '终止') ? '待确认' : '合法';
    else if (notCovered && strong && stable) legal = '非法';
    else if (notCovered) legal = '待确认';                       // 定性依据成立但证据不足，不得定性
    else legal = '异常';
    /* 不可判定的判定项：既没测到违规、也没测到合规。
       单列出来是为了不让它被"没有出现在 violations 里"静默读成"该项合规"。 */
    const undeterminable = [];
    if (f.appliesLegality !== false && f.offRoute === null) undeterminable.push('偏离报备航线');
    // C01 维度里不可判定的，同样要显式声明 —— 否则「部分命中」看不出是哪一维缺判据
    if (f.planMatchDims) C01_DIMS.forEach(d => {
      if (f.planMatchDims[d] === null) undeterminable.push('C01 ' + d + '匹配');
    });
    return { legal, violations: vs, notCovered, strong, stable, undeterminable };
  }
  /* A06 光电分类算法可推断的细分类别（设备不上报，来源必须标注为「算法推断」） */
  const AI_SUBTYPES = { '鸟': ['鸟群', '单只大型鸟'], '未知': ['气球', '风筝', '孔明灯', '不明飘浮物'], '识别中': ['识别中'] };
  let SRC_CAP_REF = null;
  /* 未登记类型回落到协议的「未知(0)」——**按 code 显式查，不按下标取**。
     值本身是安全的（未知是协议合法取值），但 `[0]` 依赖数组顺序：
     枚举一重排，兜底就换成"行人"或别的，而且不会报错。
     另有断言「不存在依赖兜底解析的目标类型」守着不许静默走到这里。 */
  const OBJ_UNKNOWN = OBJECT_TYPES.find(o => o.code === 0);
  const objCode = n => (OBJECT_TYPES.find(o => o.name === n) || OBJ_UNKNOWN).code;
  const objAbbr = n => (OBJECT_TYPES.find(o => o.name === n) || OBJ_UNKNOWN).abbr;
  /* 违规项（表10-3）。超高与超时各拆两种情形，因为它们落在「非法/异常」分界的两侧：
       超出空域规则限高/时段 → 该空域内任何计划都无权批准，等同进入禁止空间 → 非法侧
       仅超出自身计划批准的高度/时段 → 偏离批准参数 → 异常侧 */
  const VIOLATIONS = ['未经批准飞行', '侵入禁飞区', '超出空域限高', '超出计划批准高度',
    '超出空域管制时段', '超出计划批准时段', '超视距飞行', '夜间飞行', '偏离报备航线', '身份不匹配'];
  /* ---- COM-03 数据字典注册表 ----
     每一项声明：取值从哪来、能不能改、改了影响谁。
     关键区分是「协议约定」与「平台定义」：目标类型这类由《接入协议 v8.6》固定，
     改一个值就等于改接口，不是配置行为；而风险等级、处置环节是平台自己定的，可配。
     把两者混在一个"字典配置"界面里，等于给了一个改协议的按钮。 */
  function dictRegistry() {
    const D = (key, name, source, editable, values, usedBy, note) =>
      ({ key, name, source, editable, values, usedBy, note, count: values.length });
    return [
      D('OBJECT_TYPES', '目标类型', '《设备数据及感知数据接入协议 v8.6》objectType', false,
        OBJECT_TYPES.map(o => o.code + ' ' + o.name), ['融合感知中心', '统计分析', '空间安全风险'],
        '协议固定 8 个取值。设备按此上报，平台不得增删 —— 风筝/气球/孔明灯只能作为光电算法推断的 subtype，不是目标类型'),
      D('DEVICE_TYPES', '设备类型', '《接入协议 v8.6》deviceType', false,
        DEV_TYPES.map(d => d.dt + ' ' + d.type)
          .concat(DEV_TYPES_RESERVED.map(d => d.dt + ' ' + d.type + '（协议留位，现场是否部署待确认）')),
        ['设备管理', '设备接入调测', '接口管理'],
        '17 类：现场已部署 ' + DEV_TYPES.length + ' 类、协议留位 ' + DEV_TYPES_RESERVED.length
        + ' 类。留位项在字典里可见但不生成设备实例 —— 不能因为现场没有就从字典里删掉，'
        + '否则设备方按协议上报这些类型时，平台会当成未知类型丢弃'),
      D('AIRSPACE_TYPES', '空域类型', '平台定义（业务分类）', true,
        AIRSPACE_TYPES.map(a => a.type + (a.forbidsAllPlans ? '（任何计划无权批准）' : '')), ['空域与航线', '合法性判定', '融合感知中心地图'],
        '其中 forbidsAllPlans 是安全属性：改动会直接改变 C03 定性结论，须经业务方确认'),
      D('LEGAL_STATUS', '判定结果', '平台定义（设计 §10.4 表10-4）', false,
        LEGAL_STATUS, ['合法性判定', '处置处罚管理', '统计分析'],
        '五个取值与 C01/C03 判定分支一一对应，增删取值等同改判定规则，须同步改推导逻辑'),
      D('VIOLATIONS', '违规事由', '平台定义（设计 §10.3 表10-3）', true,
        VIOLATIONS, ['合法性判定', '处置处罚管理', '异常告警中心'],
        '每一条必须同时在罚则表 FINE 中有对应金额，否则主违规推导会取到默认值'),
      D('TRACK_STATUS', '轨迹状态', '平台产出（B01/B02 算法结论）', true,
        TRACK_STATUS, ['融合感知中心', '设备实时监测', '合法性判定'],
        '三份协议均无 trackStatus 字段 —— 这是算法结论不是设备上报值，展示时须标明来源'),
      D('ALARM_STATUS', '告警状态', '平台定义（流程枚举）', true,
        ALARM_STATUS, ['异常告警中心', '综合态势总览'], '顺序即流转顺序，排序与流程校验都依赖它'),
      D('CASE_STATUS', '案件状态', '平台定义（流程枚举）', true,
        CASE_STATUS, ['处置处罚管理', '日志归档'], '与 DISPOSAL_FLOW 的 6 个环节按 stage 对应'),
      D('DISPOSAL_FLOW', '处置环节', '平台定义（设计 §11）', true,
        DISPOSAL_FLOW.map(f => f.n), ['处置处罚管理', '融合感知中心', '异常告警中心', '综合态势总览'],
        '四个页面共用同一份，页面不得自建环节数组'),
      D('DISTRICTS', '行政区划', '东营市行政区划', false,
        DISTRICTS.map(d => d.name), ['全部含区域筛选的页面'], '含坐标与权重，区域筛选与热力图均依赖'),
      D('ROLES', '角色', '平台定义（§11.9 权限模型）', true,
        ROLES.map(r => r.id + ' ' + r.name), ['用户与权限', '反制/干扰授权'],
        'R2 及以上才可执行反制与公安信号干扰授权（§6.3），改动即改安全边界')
    ];
  }

  /* 空域类型 —— 类型、颜色、地图图层归属、以及「任何飞行计划都无权批准进入」这条安全属性，
     全部在这里声明一次。此前颜色写在 airspaces 每一条上、图层归属写在 map.js 的三元表达式里、
     forbidsAllPlans 写成 legality.js 的本地常量 FORBIDDEN_SPACE ——
     一条安全规则有三份副本，而副本之间没有任何机制保证一致。 */
  const AIRSPACE_TYPES = [
    { type: '禁飞空域', color: '#ff4d5e', layer: 'nofly', forbidsAllPlans: true, legend: '禁飞区' },
    { type: '临时管制区', color: '#2fd06e', layer: 'nofly', forbidsAllPlans: true, legend: '禁飞区' },
    { type: '限高区域', color: '#ffb020', layer: 'limit', forbidsAllPlans: false, legend: '限高区域' },
    { type: '重点防控区域', color: '#3d8bff', layer: 'limit', forbidsAllPlans: false, legend: '重点防控区域' },
    { type: '适飞空域', color: '#a97bff', layer: 'suit', forbidsAllPlans: false, legend: '适飞空域' }
  ];
  /* 空域数据来源回填：禁飞空域与临时管制区属法定/上级发布，本地只读；
     限高、重点防控、适飞由本级管理单位设立，可编辑。
     此前 airspaces 完全没有 source 字段，页面无从判断哪些能改 —— 于是全都能改，
     包括那些改了也会被上级下一次同步覆盖的。 */
  /* ---- 未识别取值一律 fail-closed ----
     原写法是 `|| AIRSPACE_TYPES[2]`：未识别类型静默变成「限高区域」，
     而它的 forbidsAllPlans 是 **false** —— 一个拼写错误或一个忘了登记的新枚举值，
     就能让该空域"永远不构成非法"，且不产生任何异常表现。
     forbidsAllPlans 正是非法/异常的分界依据，缺省必须取**最严**的一侧。
     另外也不再用下标当契约（枚举顺序一变，兜底值就换成别人）。 */
  const AIRSPACE_TYPE_UNKNOWN = {
    type: '未识别类型', color: '#8ca0be', layer: 'nofly',
    forbidsAllPlans: true,          // 保守：未识别即按"任何计划都无权批准"处理
    legend: '未识别类型', unknown: true,
    note: '该空域类型不在 AIRSPACE_TYPES 登记表内，按最严口径处理，请补登记'
  };
  const airspaceType = t => AIRSPACE_TYPES.find(a => a.type === t) || AIRSPACE_TYPE_UNKNOWN;
  /* 空域数据来源：上级下发的规则本地不可改（改了也会被下一次同步覆盖），
     只有本地设立的才允许编辑。页面按 source 决定只读与否，不要按空域类型猜。 */
  const AIRSPACE_SOURCES = [
    { key: '上级管控平台', editable: false, note: '由上级平台同步下发，本地只读；如需变更须由上级发起' },
    { key: '本地设立', editable: true, note: '由本级管理单位设立，可在本页编辑并留版本记录' }
  ];
  /* 同理：未识别来源原本静默变成「本地设立 / editable: true」——
     而只读闸门存在的全部理由就是"上级下发的不能改"。缺省取只读。 */
  const AIRSPACE_SOURCE_UNKNOWN = {
    key: '未识别来源', editable: false, unknown: true,
    note: '该来源不在 AIRSPACE_SOURCES 登记表内，按只读处理，请补登记'
  };
  const airspaceSource = k => AIRSPACE_SOURCES.find(x => x.key === k) || AIRSPACE_SOURCE_UNKNOWN;
  airspaces.forEach(a => {
    /* 全部空域一律「上级管控平台下发 + 只读」。
       依据不是推论，是纪要原文：§4.1 写的是平台**接收**禁飞、限飞、限高、
       许可空域和临时管制区（见 Demo模块判决表_收敛清单.md:138、366 —— 新增/编辑/
       删除空域被判为越界 D-03）。**限高区也在"接收"那张清单里**，
       所以 HGH001/HGH002 标成「本地设立·可编辑」与纪要直接抵触。

       这件事此前一直看不出来，因为空域管理页把它圆过去了：
       页面上能编辑，于是"本地设立"看着理所当然。管理页删掉之后矛盾才露出来 ——
       **全平台第二高频的判罚依据（161 条「超出空域限高」全部出自这两个限高区）
       成了没有任何界面能维护的硬编码**，而它本来就不该由本地维护。 */
    a.source = '上级管控平台';
    a.editable = airspaceSource(a.source).editable;
    a.sourceNote = airspaceSource(a.source).note;
  });
  /* 判定结果枚举 —— 页面此前各存一份副本 */
  const LEGAL_STATUS = ['合法', '非法', '异常', '待确认', '不适用'];

  /* 轨迹状态 —— 注意：三份协议里都没有 trackStatus 字段，这是**平台侧 B01/B02 算法的产出**，
     不是设备上报值。展示时必须标明来源为算法，否则会被当成设备事实。
     此前这四个值在三处 pickW 里各写一份字面量，属枚举副本。 */
  const TRACK_STATUS = ['稳定', '暂定', '短时丢失', '终止'];
  const TRACK_STATUS_W = {
    uav: [['稳定', 82], ['暂定', 8], ['短时丢失', 6], ['终止', 4]],
    other: [['稳定', 78], ['暂定', 10], ['短时丢失', 7], ['终止', 5]]
  };
  /* 高度分档阈值【待确认：业务方】—— 120m 与 300m 呼应《无人驾驶航空器飞行管理暂行条例》
     微轻型真高上限，正式阈值须由业务方确认后改这里，页面不得另写一份。 */
  const ALT_BANDS = { edges: [0, 50, 120, 300, 600], labels: ['0-50', '50-120', '120-300', '300-600', '600 以上'], unit: 'm（海拔高 AMSL）' };
  const AGL_BANDS = { edges: [0, 30, 120, 300], labels: ['0-30', '30-120', '120-300', '300 以上'], unit: 'm（距地高 AGL）' };
  const RISK_BY_LEGAL = { '非法': [['超高风险', 22], ['高风险', 58], ['中风险', 20]], '异常': [['高风险', 18], ['中风险', 62], ['低风险', 20]], '待确认': [['中风险', 30], ['低风险', 70]], '合法': [['低风险', 96], ['中风险', 4]] };
  const SOURCES = ['融合感知箱', 'TDOA', '5G-A'];

  /* 雷达站址：来源归属要按它裁决，所以必须在目标生成之前取好 */
  const radarStations = devices.filter(v => v.type === '雷达').map(v => ({ lon: v.lon, lat: v.lat }));
  /* 明确记录**仍然不知道**的部分，避免下次有人把"没约束"读成"无需约束"：
     TDOA / AOA / 5G-A 的作用距离本仓无任何资料，因此它们的归属目前不受距离约束。
     这不是"它们覆盖全域"，而是"我们不知道它们覆盖多远"。 */
  const SRC_RANGE_UNKNOWN = ['TDOA', 'AOA', '5G-A'];

  /* ---- 计划比对：真判据，不再掷骰子 ----
     此前 `planCandidate: rnd() < .88` 与 `matched_plan_id = legal==='合法' ? 随机计划号 : null`
     都是编的。实测后果：**336/337 声称命中的计划开始于目标飞完之后**（先飞后批），
     目标落在计划时窗内的只有 1/337，距所谓命中航线中位数 48.6 km。
     那是"结论反向生成观测事实"的原型 —— 先判成合法，再给它配一个计划号。

     现在改成：**先有覆盖，才有命中**。
       候选 = 该架次位置落在某条计划航线的走廊内（走廊半宽 = widthM/2 + widthTolM）
       命中 = 候选存在，且各维度按真实可比量逐项比对
     没有覆盖就是「未命中」→「未经批准飞行」，非法数上涨是这条口径的直接后果，不去压它。 */
  /* 这两个常量必须**声明在 buildTargets 之前**：
     buildTargets 里的 plansCovering → distToPolylineM → distToSegM 会用到它们。
     函数声明会提升，`const` 不会 —— 原来放在下面时，目标生成期访问它们直接抛
     `Cannot access 'mPerDegLon' before initialization`，整站白屏，
     而 `node --check` 照样通过（它只证明能被解析，不证明能被执行）。
     **不要因为"按主题分组更好看"把它们挪回下面。** */
  const M_PER_DEG_LAT = 111320;
  const mPerDegLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

  const planTms = v => new Date(String(v).replace(' ', 'T')).getTime();
  /* 该计划的走廊半宽（km）。航线缺几何时返回 null —— 无几何即无法判覆盖，不是"没覆盖"。 */
  function planCorridorKm(pl) {
    const r = pl.routeId ? routeById(pl.routeId) : null;
    if (!r || !(r.waypoints || []).length) return null;
    return { route: r, halfKm: (r.widthM / 2 + (r.widthTolM || 0)) / 1000 };
  }
  /* 找出覆盖该点的计划（空间覆盖）。时间是否也吻合交由维度比对判定，
     这样「飞了但超出批准时段」才有地方表达 —— 合成一个条件会把它和"根本没报备"混为一谈。 */
  function plansCovering(pt) {
    const out = [];
    for (const pl of flightPlans) {
      const c = planCorridorKm(pl);
      if (!c) continue;
      if (distToPolylineM(pt, c.route.waypoints) / 1000 <= c.halfKm) out.push(pl);
    }
    return out;
  }

  const allTargets = [];   // 近30天
  /* 计划按起始日索引 + 每条计划的认领名额。
     PLAN_SLOTS 是**唯一决定合法架次上限**的旋钮，写在这里以便一眼看到：
     46 条计划 × 3 = 最多 138 个架次能被计划覆盖，其余一律「未经批准飞行」。
     用户裁定「不扩计划、接受合法架次下降」，这个上限就是那条裁定的直接体现。 */
  const PLAN_SLOTS = 3;
  const planSlots = {};
  const plansByDay = {};
  /* 键统一用 ymd() 的数字形式（20260826），不要用 start.slice(0,10)（'2026-08-26'）——
     两种写法看起来都对，但索引与查询各用一种时**永远查不到**，
     表现为"对齐了但一条都没命中"，而不是报错。 */
  flightPlans.forEach(pl => {
    const k = ymd(new Date(String(pl.start).replace(' ', 'T')));
    (plansByDay[k] = plansByDay[k] || []).push(pl);
  });
  (function buildTargets() {
    let seq = 0;
    for (let dOff = -29; dOff <= 0; dOff++) {
      const day = dayAdd(CONF.demoTime, dOff);
      // 目标量随日期缓升，周末更高
      const wk = [0, 6].includes(day.getDay()) ? 1.18 : 1;
      const base = Math.round((30 + (dOff + 29) * 0.62) * wk);
      const n = base + ri(-4, 4);
      for (let i = 0; i < n; i++) {
        seq++;
        const d = pickW(DISTRICTS.map(x => [x, x.w]));
        const type = pickW(T_TYPES);
        const isUav = type === '无人机';
        // A4:subtype 来源 —— 无人机型别与非无人机细类均由光电算法 A06 推断，设备只报 objectType
        const aiPool = AI_SUBTYPES[type];
        const hasAI = isUav ? rnd() < .82 : (aiPool ? rnd() < .68 : false);
        const subtype = isUav ? (hasAI ? pick(['旋翼飞行器', '固定翼', '复合翼']) : null)
          : (hasAI && aiPool ? pick(aiPool) : null);
        const hh = ri(5, 22), mm = ri(0, 59), ss = ri(0, 59);
        const t = new Date(day); t.setHours(hh, mm, ss, 0);
        if (dOff === 0 && t > CONF.demoTime) { t.setHours(ri(5, 10), mm, ss, 0); }
        const dur = ri(3, 145);

        /* 位置要先定下来，因为**来源不能再独立抽签** ——
           T02 探测量程 3.5km，雷达看不见 3.5km 外的目标，
           而原来 `source: pickW([['融合感知箱',62],…])` 与位置毫无关系，
           实测造成 400/761 个融合感知箱目标落在雷达量程外（最远 27.8km），
           等于平台声称雷达探测到了它物理上看不见的东西。
           规格书到位之前这条校验不出来（cover 一直是 TBC），到位当天就抓出来了。 */
        let tLon = +(d.lon + (rnd() - .5) * .25).toFixed(6);
        let tLat = +(d.lat + (rnd() - .5) * .2).toFixed(6);
        /* 生成侧用快速平面近似（每个目标都要算），但**留 50 m 余量**：
           平面近似与大圆距离在本纬度差约 0.4%，3.5 km 上约 13 m，
           不留余量就会有目标恰好卡在两种算法的夹缝里 ——
           实测正有 1 个：平面 3.4934 km 判在界内，大圆 3.5062 km 判在界外。
           留余量之后，无论用哪种算法它都在界内，
           而自检那端仍用独立的大圆公式严格卡 3.5 km，两端不同源。 */
        /* ---- 计划覆盖对齐 ----
           上面那段位置是按区域随机撒的，落进某条 200~500 m 宽走廊的概率近乎零：
           实测 665 架次里落在某走廊内的只有 7 个，**同时落在时窗内的是 0 个**。
           那不是"绝大多数是黑飞"这个业务事实，是**架次与计划两批数据各编各的**，
           从来没有对齐过 —— 所以直接按真判据跑会得出"全城无一合法"的假象。

           这里把一部分架次**确定性地**放到既有计划的走廊与时窗里，
           让"被计划覆盖"这件事真的成立：位置取航线上的点加走廊内横向偏移，
           时刻取计划时窗内。**不使用 rnd()** —— 随机流一挪，全库数字跟着错位（已付过学费）。

           每条计划最多认领 PLAN_SLOTS 个架次：计划总数不扩（用户裁定），
           所以合法架次的上限就由计划数量决定，**降到多少就是多少，不去凑**。
           演示主角 UAV20260826003 是无计划黑飞，不参与对齐（见下方 seq 排除）。 */
        let alignedPlan = null;
        if (isUav) {
          const dayKey = ymd(day);
          const pool = plansByDay[dayKey] || [];
          if (pool.length) {
            const pl = pool[seq % pool.length];
            if ((planSlots[pl.id] || 0) < PLAN_SLOTS && seq % 5 !== 0) {
              const c = planCorridorKm(pl);
              if (c) {
                planSlots[pl.id] = (planSlots[pl.id] || 0) + 1;
                alignedPlan = pl;
                /* 沿航线取一点（按 seq 确定性地取比例），再加一个走廊内的横向偏移 */
                const f = ((seq % 7) + 1) / 8;
                const pos = pointAlong(c.route.waypoints, f);
                const latOff = (((seq % 5) - 2) / 2) * (c.halfKm * 0.6) / 111.32;
                tLon = +(pos.lon).toFixed(6);
                tLat = +(pos.lat + latOff).toFixed(6);
                /* 时刻落进计划时窗（确定性地取窗内若干等分点之一） */
                const ps = planTms(pl.start), pe = planTms(pl.end);
                t.setTime(ps + Math.floor((pe - ps) * (((seq % 6) + 1) / 8)));
              }
            }
          }
        }
        /* 来源必须在**对齐之后**再判：对齐会把架次挪到航线走廊上，
           而"哪一路设备看得见它"取决于它最终在哪儿。
           先判来源再挪位置，就会出现"雷达探测到 8.27 km 外的目标"——
           实测正是这样漏出 14 个（雷达量程 3.5 km）。 */
        const inRadar = radarStations.some(r =>
          distKm(r, { lon: tLon, lat: tLat }) <= T02.rangeKm - 0.05);
        /* 落在雷达覆盖内：三路都可能先发现它。
           落在覆盖外：**只可能是 TDOA / 5G-A**，二者按原相对比例（22:16）归一。
           注意这里没有反过来断言 TDOA/5G-A 能覆盖 27km ——
           它们的作用距离本仓仍无资料（见 SRC_RANGE_UNKNOWN），
           这一步只是撤掉一个被资料证伪的归属，不是新增一个有依据的归属。 */
        const tSource = inRadar
          ? pickW([['融合感知箱', 62], ['TDOA', 22], ['5G-A', 16]])
          : pickW([['TDOA', 58], ['5G-A', 42]]);

        /* ---- 合法性判定：先构造客观事实，再由 C01/C02/C03 推导结论（设计 §10.4）----
           结论不得独立赋值 —— 否则界面上的「判定过程」与结论无关，评审问「为什么这条规则挂了」答不上来。
           只有无人机参与合法性判定，其他类型走空间安全风险线（§4.2）。 */
        let legal = '不适用', violations = [], facts = null, risk, undeterminable = [];
        let nonUavConf = null, nonUavTrack = null;
        if (isUav) {
          const conf0 = pickW([[ri(84, 98), 72], [ri(76, 83), 20], [ri(68, 75), 8]]);
          const trackSt = pickW(TRACK_STATUS_W.uav);
          /* 客观事实（设备可观测量 + 计划比对结果），与结论无关 */
          facts = {
            // C01：先定"有没有可关联计划"，维度比对与三档定级在下面
            /* 真判据：是否存在**空间上覆盖本架次**的计划。不再是 rnd() < .88。
               时间是否吻合放到维度里判 —— 合成一个条件会把
               「飞了但超出批准时段」和「根本没报备」混为一谈。 */
            planCandidate: plansCovering({ lon: tLon, lat: tLat }).length > 0,
            /* 三个空域类事实在 buildTracks 里按**几何**算出来（轨迹 × 空域多边形），
               此处只占位。原先是 rnd() 掷骰子，而且**不记录是哪个空域** ——
               判「侵入禁飞区」却说不出侵入的是哪一块，判「超出空域限高」却没有对应的限高值。
               这类空间结论的依据是几何关系，没有几何就没有依据。 */
            inNoFlyZone: false, overZoneHeight: false, overZoneTime: false, zoneHits: [],
            overPlanHeight: false, overPlanTime: false,   // 仅在有计划时才谈得上
            offRoute: null,                                // 无航线几何 → 不可判定（见 ROUTE_GEOM_READY）
            night: hh >= 22 || hh < 6,   // 生成时段为 5-22 点，夜间样本天然较少                             // 夜间时段
            bvlos: rnd() < .04,                                    // 超视距（依赖遥控源距离，A6）
            confidence: conf0, trackStatus: trackSt
          };
          /* C01 五维度比对。航线走廊维度依赖 routes 几何，未接入前恒为 null（不可判定）——
             这直接意味着：routes 没接上之前，C01 最多只能到「部分命中」，不能报「完全命中」。
             无人机身份维度依赖 uav_sn，此时尚未生成，先置 null，在 Schema 补全阶段回填并重算。 */
          /* 维度逐项**实比**，不再 rnd()。比不了的维度置 null（不可判定），
             不许拿"比不了"当"不通过"，也不许当"通过"。 */
          const _cands = facts.planCandidate ? plansCovering({ lon: tLon, lat: tLat }) : [];
          const _pl = alignedPlan || _cands[0] || null;
          facts.planCandidateId = _pl ? _pl.id : null;
          facts.planMatchDims = {
            // 实比：架次时刻是否落在该计划批准时窗内。落在走廊里但超时段 → false（这正是"超出批准时段"）
            '时间窗口': _pl ? (t.getTime() >= planTms(_pl.start) && t.getTime() <= planTms(_pl.end)) : null,
            /* 起降点：**目标对象上没有起飞点字段**，平台只看到航迹中的一个点，
               拿当前位置去冒充起降点就是换了个量。故为不可判定，不是不通过。 */
            '起降点': null,
            // 走廊维度在 buildTracks 算出 offRoute 后回填（它就是 offRoute 的另一面），此处先置 null
            '航线走廊': null,
            '无人机身份': null,          // uav_sn 此时尚未生成，Schema 阶段回填后重算
            '飞手单位': _pl ? null : null // partnerCand 也在下方 push 时才定，同样 Schema 阶段回填
          };
          facts.planMatch = gradePlanMatch(facts.planMatchDims, facts.planCandidate);
          if (planned(facts)) {
            facts.overPlanHeight = rnd() < .05; facts.overPlanTime = rnd() < .04;
            /* offRoute 此处保持 null：它要等 buildTracks 生成实际航迹后才算得出来
               （走廊几何 + 实际航迹两个输入都齐了才谈得上比对）。
               buildTracks 算完后，下游的 Schema 补全阶段会走同一套 deriveLegality 重算。 */
            facts.offRoute = null;
          }

          facts.sourceConfidence = +(conf0 / 100).toFixed(2);   // 与 Schema 字段同源，不再二次随机

          /* C02/C03 统一走 deriveLegality —— 规则只有一份，复核修订事实后重算走的也是它 */
          const d0 = deriveLegality(facts);
          legal = d0.legal; violations = d0.violations; undeterminable = d0.undeterminable;
          risk = pickW(RISK_BY_LEGAL[legal]);
        } else {
          risk = pickW(RISK_BY_LEGAL[rnd() < .12 ? '异常' : '待确认']);
          /* 非无人机同样有客观事实，只是不含「计划比对」这一族 ——
             它们不参与合法性判定，但设备上报质量（置信度/轨迹状态）语义完全相同。
             以前这两个量裸放在目标上，导致 source_confidence 只能反过来从展示字段 conf 派生。 */
          nonUavConf = pickW([[ri(84, 98), 70], [ri(76, 83), 22], [ri(68, 75), 8]]);
          nonUavTrack = pickW(TRACK_STATUS_W.other);
          facts = {
            confidence: nonUavConf, trackStatus: nonUavTrack,
            sourceConfidence: +(nonUavConf / 100).toFixed(2),
            appliesLegality: false            // 显式标注：本目标不走 C01/C03，计划比对项不适用
          };
        }
        const violation = primaryViolation(violations);               // 主违规（按罚则表取最严一条）
        allTargets.push({
          // 统一目标编号：3 位类型前缀 + 日期 + 序号（无人机 UAV / 鸟类 BRD / 风筝 KTE / 气球 BLN / 其他 OBJ）
          id: objAbbr(type) + day.getFullYear() + p2(day.getMonth() + 1) + p2(day.getDate()) + p3(i + 1),
          seq, date: fmtD(day), ymd: ymd(day), time: fmtDT(t), ts: t.getTime(),
          type, objectType: objCode(type),
          subtype,
          // A4:类别来源标签 —— device=设备按 objectType 上报；ai=光电算法 A06 推断
          typeSource: 'device',
          subtypeSource: subtype ? 'ai' : null,
          subtypeConf: subtype ? ri(72, 95) : null,
          district: d.name, lon: tLon, lat: tLat,
          // A8:altitude=海拔高(GPS/北斗,必填)；height_agl=距地高(相对基站安装地面,选填)
          // 协议中 height 为选填 —— 20% 设备不上报，用于演示降级路径（V1.1 Q19）
          alignedPlanId: alignedPlan ? alignedPlan.id : null,
          alt: isUav ? ri(25, 320) : ri(20, 260),
          heightAgl: rnd() < .8 ? (isUav ? ri(20, 300) : ri(15, 240)) : null,
          speed: +(rnd() * (isUav ? 24 : 16) + 2).toFixed(1),
          heading: ri(0, 359),
          legal, violation, violation_reasons: violations, facts, risk,
          // 本次判定中「无判据可依」的判定项，供页面如实呈现（不得读作合规）
          undeterminable,
          durMin: dur, trackKm: +(dur * (isUav ? .38 : .22) * (0.5 + rnd())).toFixed(1),
          source: tSource,
          // 置信度与轨迹状态取自同一份客观事实，不得二次随机。
          // 非无人机不做合法性判定，但来源质量（延迟/丢包/精度）语义相同，故走同一条路径。
          trackStatus0: facts.trackStatus,
          model: isUav ? pick(MODELS) : '—',
          // 候选主体：真正能不能具名，由派生层按「身份认定路径」裁决（见 subjectSource）。
          // 此前按合法性分配主体 —— 而合法性和「知不知道是谁」根本是两件事。
          /* 对齐到某条计划的架次，其飞手单位就是该计划的单位 ——
             同一个架次不可能"按 A 单位的计划飞、却属于 B 单位"。
             pick() 无论如何都要调用一次，避免随机流因分支而错位。 */
          partnerCand: (() => { const pc = isUav ? pick(PARTNERS).name : '—';
            return alignedPlan ? alignedPlan.partner : pc; })(),
          pilotCand: isUav ? pick(PILOTS) : '—',
          partner: '未知（待认定）', pilot: '—'
        });
      }
    }
  })();

  /* ================= 轨迹生成（Target Schema V1 §7.2 track_points）=================
     此前全库 track_points 为空 —— 一个已声明的**必需**字段长期为空，属 C09「字段缺失」。

     生成原则（设计 §10.4「观测事实不得由结论反向生成」）：
       意图 ← 计划关联航线的航路点，**直接取用，不施加任何偏移**
              （一旦允许给意图航路加偏移量，那个量就是偏航率的直接旋钮，
               而且伪装成"飞手执行偏差"，比事件率还难识别）
       偏移 ← 只来自误差源：定位噪声 / 风偏 / 转弯控制滞后 / 异常机动事件
       结论 ← 逐点算到走廊中心线的横向距离，与半宽阈值比较**算出来**

     走廊宽度**不参与轨迹生成**：同一条航迹换一条更窄的走廊，结论会变 —— 这是
     "结论不是设定值复述"的自检方法。

     关于 maneuverRate：它有三个相互独立的下游（偏航判定 / C03 轨迹稳定性因子 /
     轨迹质量统计），调它会同时移动风险评分与质量统计，因此不是偏航率的代理旋钮。
     参数均为 Demo 缺省值【待确认：业务方】。 */
  const TRACK_MODEL = {
    points: 30,                                  // Demo 抽稀点数（正式接入按协议采样率）
    posSigmaM: { '融合感知箱': 12, 'TDOA': 20, '5G-A': 16 },   // 定位噪声 1σ，与 position_accuracy 同源语义
    windMaxMs: 8,                                // 风速上限 m/s
    turnOvershoot: 0.35,                         // 转弯一阶滞后造成的外切系数
    windResidualMPerMs: 3.5,                     // 每 m/s 风速的稳态横向残差（m）
    maneuverRate: 0.22,                          // 每架次发生异常机动的概率（B07 观测量）
    maneuverMagM: [40, 300],                     // 机动横向幅度
    holdSamples: 2                               // offRouteHoldSec 在抽稀轨迹上的等效：连续 N 点
  };
  /* 空域规则的生效时段是否覆盖某时刻（临时管制区有真实时间窗；「长期有效」为开区间） */
  function zoneWindowHit(z, ts) {
    if (!z) return false;
    const parse = v => (v && v !== '长期有效') ? new Date(String(v).replace(/-/g, '/')).getTime() : null;
    const a = parse(z.from), b = parse(z.to);
    return (a == null || ts >= a) && (b == null || ts <= b);
  }
  /* 射线法判点是否在多边形内。空域 poly 为 [[lon,lat],...] */
  function pointInPoly(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  /* 点到线段的最短距离（米）。走廊是折线，必须逐段取最小，不能只算到最近顶点 ——
     只算顶点会把弯道内侧的点判成远离走廊。 */
  function distToSegM(px, py, ax, ay, bx, by, lat) {
    const kx = mPerDegLon(lat), ky = M_PER_DEG_LAT;
    const APx = (px - ax) * kx, APy = (py - ay) * ky;
    const ABx = (bx - ax) * kx, ABy = (by - ay) * ky;
    const ab2 = ABx * ABx + ABy * ABy;
    let u = ab2 ? (APx * ABx + APy * ABy) / ab2 : 0;
    u = Math.max(0, Math.min(1, u));
    const dx = APx - ABx * u, dy = APy - ABy * u;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function distToPolylineM(pt, wps) {
    let best = Infinity;
    for (let i = 0; i + 1 < wps.length; i++) {
      const d = distToSegM(pt.lon, pt.lat, wps[i].lon, wps[i].lat, wps[i + 1].lon, wps[i + 1].lat, pt.lat);
      if (d < best) best = d;
    }
    return best;
  }
  /* 沿折线按比例取点（0~1），返回 {lon,lat,alt} —— 意图位置，未加任何误差 */
  function pointAlong(wps, f) {
    const segs = [];
    let total = 0;
    for (let i = 0; i + 1 < wps.length; i++) {
      const d = distKm(wps[i], wps[i + 1]) * 1000;
      segs.push(d); total += d;
    }
    if (!total) return { lon: wps[0].lon, lat: wps[0].lat, alt: wps[0].alt };
    let want = f * total;
    for (let i = 0; i < segs.length; i++) {
      if (want <= segs[i] || i === segs.length - 1) {
        const u = segs[i] ? Math.min(1, want / segs[i]) : 0;
        return {
          lon: wps[i].lon + (wps[i + 1].lon - wps[i].lon) * u,
          lat: wps[i].lat + (wps[i + 1].lat - wps[i].lat) * u,
          alt: Math.round(wps[i].alt + (wps[i + 1].alt - wps[i].alt) * u)
        };
      }
      want -= segs[i];
    }
    return { lon: wps[wps.length - 1].lon, lat: wps[wps.length - 1].lat, alt: wps[wps.length - 1].alt };
  }

  /* 强制设定「进入禁飞区」这个结论时，**必须同时补上产生它的那次空域命中**。
     只写 inNoFlyZone=true 的话，结论成立而 referent 缺席，界面就只能自己去猜
     是哪一块空域 —— 而它猜的办法（按 district 查）会点名到限高区去。
     这三处演示/验收用例以前都只改了结论，实测漏出 2 条。 */
  function forceNoFlyFact(f, pt) {
    if (!f) return;
    f.inNoFlyZone = true;
    const z = airspaces.find(a => a.status === '生效中'
      && airspaceType(a.type).forbidsAllPlans
      && Array.isArray(a.poly) && a.poly.length > 2
      && (!pt || pointInPoly(pt.lon, pt.lat, a.poly)))
      || airspaces.find(a => a.status === '生效中' && airspaceType(a.type).forbidsAllPlans);
    if (!z) return;
    f.zoneHits = (f.zoneHits || []).filter(x => x.reason !== '进入');
    f.zoneHits.push({ id: z.id, name: z.name, type: z.type, reason: '进入', points: 1, forced: true });
  }

  /* ---- 航线空域冲突审查（放在 airspaceType / pointInPoly 就位之后）----
     管服平台不会批准一条穿越禁止空间的航线，而 detectRouteConflicts 正是把这种情况判为「严重」。
     此前航线只按行政区中心随机生成、完全不看空域：几何判定一接上，
     28% 的架次就"沿着批准航线飞进了禁飞区"。**那不是判定太严，是航线本来就不该这么批。**
     穿越禁止空间的航线保留但降为「草稿」（未生效、不派计划），
     冲突检测仍有真实样本可演示，而生效航线是干净的。 */
  (function reviewRoutes() {
    const forbidZones = airspaces.filter(z => z.status === '生效中'
      && Array.isArray(z.poly) && z.poly.length > 2 && airspaceType(z.type).forbidsAllPlans);
    routes.forEach(r => {
      const bad = forbidZones.find(z => r.waypoints.some(w => pointInPoly(w.lon, w.lat, z.poly)));
      if (bad && r.status === '生效中') {
        r.status = '草稿';
        r.draftReason = `走廊穿越${bad.type}「${bad.name}」，未通过空域冲突审查（detectRouteConflicts 判为严重）`;
      }
    });
  })();

  (function buildTracks() {
    const live = routes.filter(r => r.status === '生效中');
    allTargets.filter(t => t.type === '无人机').forEach(t => {
      const N = TRACK_MODEL.points;
      const dtSec = Math.max(1, Math.round(t.durMin * 60 / (N - 1)));
      /* 意图航路：有可关联计划的架次才谈得上"照批准航线飞"。
         未命中的架次没有批准航线 —— 偏航对它不是"不可判定"，而是**不适用**。 */
      const pool = live.filter(r => r.region === t.district);
      const route = (t.facts && t.facts.planCandidate)
        ? (pool.length ? pick(pool) : (live.length ? pick(live) : null)) : null;
      t.routeId = route ? route.id : null;

      /* 误差源（物理量，与结论无关） */
      const sigma = TRACK_MODEL.posSigmaM[t.source] || 15;
      const windDir = rnd() * Math.PI * 2, windMs = rnd() * TRACK_MODEL.windMaxMs;
      const hasManeuver = rnd() < TRACK_MODEL.maneuverRate;
      /* 遮挡失锁：失锁区间内**没有测量值**，位置由 A03 弥合算出。
         必须在生成轨迹点之前决定，因为它决定了哪些点是 meas、哪些是 bridge。 */
      const occl = rnd() < (t.source === '5G-A' ? .04 : .06);
      const oStart = occl ? ri(5, N - 7) : -1, oLen = occl ? ri(2, 4) : 0;
      const manStart = hasManeuver ? ri(4, N - 8) : -1;
      const manLen = hasManeuver ? ri(2, 5) : 0;
      const manMag = hasManeuver ? ri(TRACK_MODEL.maneuverMagM[0], TRACK_MODEL.maneuverMagM[1]) : 0;
      const manDir = rnd() < .5 ? 1 : -1;

      const pts = [];
      let hdg0 = rnd() * Math.PI * 2;
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1);
        let base;
        if (route) base = pointAlong(route.waypoints, f);
        else {
          // 无批准航线：从发现位置起按缓变航向自由飞
          hdg0 += (rnd() - .5) * .35;
          const kmStep = (t.speed * dtSec) / 1000;
          const prev = pts.length ? pts[pts.length - 1] : { lon: t.lon, lat: t.lat, alt: t.alt };
          base = {
            lon: prev.lon + kmStep * Math.cos(hdg0) / (mPerDegLon(prev.lat) / 1000),
            lat: prev.lat + kmStep * Math.sin(hdg0) / (M_PER_DEG_LAT / 1000),
            alt: prev.alt
          };
        }
        /* 风偏：**有界**的横向残差，不是无约束累积。
           照航线飞的架次会顶风修正（保持偏流角），风只造成一个稳态残差；
           把风偏写成随时间累积会得到公里级漂移 —— 那是失控航空器的模型，不是受控飞行的。
           residualPerMs 为每 m/s 风速的稳态横向残差【待确认：业务方】。 */
        const driftM = route ? windMs * TRACK_MODEL.windResidualMPerMs
          : windMs * dtSec * i * 0.02;   // 无航线可循的架次没有修正目标，允许缓慢漂移
        // 定位噪声：每点独立
        const nx = (rnd() + rnd() + rnd() - 1.5) * sigma * 1.4;
        const ny = (rnd() + rnd() + rnd() - 1.5) * sigma * 1.4;
        // 转弯外切：靠近航路点处偏移更大
        const turn = route ? Math.abs(Math.sin(f * Math.PI * (route.waypoints.length - 1))) * sigma * TRACK_MODEL.turnOvershoot : 0;
        // 异常机动：横向阶跃，持续若干采样点
        const man = (hasManeuver && i >= manStart && i < manStart + manLen) ? manMag * manDir : 0;
        const offX = driftM * Math.cos(windDir) + nx + turn + man * Math.cos(windDir + Math.PI / 2);
        const offY = driftM * Math.sin(windDir) + ny + turn + man * Math.sin(windDir + Math.PI / 2);
        pts.push({
          lon: +(base.lon + offX / mPerDegLon(base.lat)).toFixed(6),
          lat: +(base.lat + offY / M_PER_DEG_LAT).toFixed(6),
          alt: Math.max(0, Math.round(base.alt + (rnd() - .5) * 12)),
          t: t.ts + i * dtSec * 1000,
          /* 点型（F0202 / §6.8）：失锁区间内的位置是 A03 弥合算出来的，不是测到的。
             全部标 meas 等于宣称"每个点都测到了"，那是比实际更强的断言 ——
             §6.8 明确弥合段不得等同实测参与判定，图上也必须能分辨，
             否则人会把算出来的位置当成测到的位置。 */
          kind: (occl && i >= oStart && i < oStart + oLen) ? 'bridge' : 'meas'
        });
      }
      t.track = pts;
      t.track_points = pts;
      t.track_sample_sec = dtSec;
      /* B07 异常机动：独立观测量，下游为 偏航判定 / C03 轨迹稳定性 / 轨迹质量统计 */
      t.facts.maneuverEvents = hasManeuver ? 1 : 0;
      t.facts.maneuverMagM = manMag;
      /* 轨迹状态由**轨迹质量**推导，不再 pickW 掷骰子。
         三种成因彼此独立：遮挡/失锁 → 短时丢失；链路中断 → 终止；异常机动 → 暂定。
         这也是 maneuverRate 的第二个下游（C03 五因子里的「轨迹稳定性」本来就等着被喂），
         调它会同时移动风险评分与轨迹质量统计，因此它不是偏航率的代理旋钮。 */
      const term = rnd() < .04;                                  // 链路中断/任务终止
      t.facts.trackOcclusion = occl;
      t.facts.trackTerminated = term;
      t.facts.trackStatus = term ? '终止' : occl ? '短时丢失' : (hasManeuver ? '暂定' : '稳定');
      t.track_status = t.facts.trackStatus;

      /* ---- 空域类事实：由轨迹与空域多边形的几何关系算出 ----
         对每个轨迹点做点在多边形内判定，命中即记录**是哪一块空域**以及命中原因。
         高度按该空域自己声明的基准取（agl 用距地高、amsl 用海拔高），不混用。 */
      const zoneHits = [];
      const liveZones = airspaces.filter(z => z.status === '生效中' && Array.isArray(z.poly) && z.poly.length > 2);
      liveZones.forEach(z => {
        const inside = pts.filter(pt => pointInPoly(pt.lon, pt.lat, z.poly));
        if (!inside.length) return;
        const forbids = airspaceType(z.type).forbidsAllPlans;
        const datum = z.limitDatum || 'agl';
        const hOf = () => datum === 'agl' ? t.heightAgl : t.alt;
        const h = hOf();
        const overH = z.limit > 0 && h != null && h > z.limit;
        const inWindow = z.type === '临时管制区' && zoneWindowHit(z, t.ts);
        if (forbids) zoneHits.push({ id: z.id, name: z.name, type: z.type, reason: '进入', points: inside.length });
        if (overH) zoneHits.push({ id: z.id, name: z.name, type: z.type, reason: '超限高', limit: z.limit, datum, h, points: inside.length });
        if (inWindow) zoneHits.push({ id: z.id, name: z.name, type: z.type, reason: '管制时段', from: z.from, to: z.to, points: inside.length });
      });
      t.facts.zoneHits = zoneHits;
      t.facts.inNoFlyZone = zoneHits.some(x => x.reason === '进入');
      t.facts.overZoneHeight = zoneHits.some(x => x.reason === '超限高');
      t.facts.overZoneTime = zoneHits.some(x => x.reason === '管制时段');

      /* offRoute 由几何算出：连续 holdSamples 点超出半宽阈值。
         半宽阈值 = widthM/2 + widthTolM —— widthM 是走廊全宽，别当半宽用。 */
      if (route) {
        const half = route.widthM / 2 + route.widthTolM;
        let run = 0, maxRun = 0, maxDev = 0;
        pts.forEach(pt => {
          const d = distToPolylineM(pt, route.waypoints);
          if (d > maxDev) maxDev = d;
          if (d > half) { run++; if (run > maxRun) maxRun = run; } else run = 0;
        });
        t.facts.offRoute = maxRun >= TRACK_MODEL.holdSamples;
        t.facts.routeMaxDevM = Math.round(maxDev);
        t.facts.routeHalfWidthM = Math.round(half);
      } else {
        t.facts.offRoute = null;          // 无批准航线 → 不适用（已由 C01 未命中表达）
        t.facts.routeMaxDevM = null;
      }
    });
  })();

  /* ---- A6:遥控器建模（协议 objectType=100 是与无人机并列的独立目标）----
     两条来源路径会指向同一个物理遥控器，必须去重：
       路径①  独立遥控器目标：TDOA / AOA 上报 objectType=100，有自己的 objectId 与位置
       路径②  无人机扩展字段：extension.pilotLon / pilotLat
     协议破解设备(dcd) 的 objectType=100 已弃用，只走路径②。
     去重判据：时空邻近（<150m）+ 频点一致，命中则合并为一个遥控器目标并记录来源。 */
  /* 能提供遥控源/身份信息的设备：dcd 与 rid 提供 uavSN，TDOA/AOA 只提供型号线索与遥控器位置 */
  const RC_SOURCES = ['TDOA', 'AOA', '协议破解', 'RemoteID'];
  (function buildRemoteControllers() {
    const uavs = allTargets.filter(t => t.type === '无人机');
    let seq = 0;
    uavs.forEach(u => {
      // 并非每架无人机都能定位到遥控源：仅无线电类设备覆盖到的才有
      if (rnd() > 0.42) return;
      const src = pick(RC_SOURCES);
      // 遥控源通常在操作员手边、目视视距(约 500m)内；仅超视距飞行的目标才明显拉远
      const far = u.facts && u.facts.bvlos;
      const spread = far ? .022 : .006;
      const dLon = (rnd() - .5) * spread, dLat = (rnd() - .5) * spread * .9;
      const lon = +(u.lon + dLon).toFixed(6), lat = +(u.lat + dLat).toFixed(6);
      const channel = pick(['2.4015 GHz', '2.4325 GHz', '5.7450 GHz', '5.8125 GHz']);

      /* AOA 只测向不测距：协议 uav.txt「AOA目标时，目标的经纬度和高度无效，使用方位角」。
         此前 73 个 AOA 遥控源全都给了经纬度 —— 平台声称了 AOA 不具备的定位能力。
         改为只给方位角 + 报出该方位的设备，位置留空。 */
      const aoaOnly = src === 'AOA';
      const aoaDev = aoaOnly ? (devices.filter(d => d.deviceTypeAbbr === 'aoa' && d.district === u.district)[0]
        || devices.filter(d => d.deviceTypeAbbr === 'aoa')[0]) : null;
      // 路径②：无人机扩展字段（dcd 只有这一条）
      u.pilotPosition = aoaOnly
        ? { lon: null, lat: null, posValid: false, source: 'extension', device: 'AOA',
            azimuth: aoaDev ? +(bearing(aoaDev, { lon, lat })).toFixed(1) : null,
            fromDeviceId: aoaDev ? aoaDev.id : null, fromDeviceName: aoaDev ? aoaDev.name : null,
            note: 'AOA 仅提供方位角，经纬度与高度无效（协议 v8.6）' }
        : { lon, lat, posValid: true, source: 'extension', device: src };
      u.radioChannel = channel;

      // 路径①：TDOA/AOA 另外上报独立遥控器目标（dcd 不上报，其 objectType=100 已弃用）
      // dcd 的 objectType=100 已弃用、rid 为地面站方式：两者都不上报独立遥控器目标
      const alsoIndependent = !['协议破解', 'RemoteID'].includes(src) && rnd() < .78;
      if (!alsoIndependent) return;
      seq++;
      // 两路径存在测量偏差；约 15% 的样本偏差超阈值，用于演示「未合并、待人工确认」的降级路径
      const bigOffset = rnd() < .15;
      const k = bigOffset ? .006 : .0018;
      const jLon = +(lon + (rnd() - .5) * k).toFixed(6);
      const jLat = +(lat + (rnd() - .5) * k * .9).toFixed(6);
      const rcAoa = src === 'AOA';
      const distM = rcAoa ? null : Math.round(distKm({ lon: jLon, lat: jLat }, { lon, lat }) * 1000);
      const dedup = !rcAoa && distM < 150;      // AOA 无位置，两路径无法做时空邻近去重，只能人工确认
      allTargets.push({
        id: 'RCT' + u.id.slice(3, 11) + p3(seq),
        seq: allTargets.length + 1, date: u.date, ymd: u.ymd, time: u.time, ts: u.ts,
        type: '遥控器', objectType: 100, typeSource: 'device',
        subtype: null, subtypeSource: null, subtypeConf: null,
        district: u.district, lon: rcAoa ? null : jLon, lat: rcAoa ? null : jLat,
        alt: rcAoa ? null : ri(0, 3), heightAgl: rcAoa ? null : 0, speed: 0, heading: 0,
        posValid: !rcAoa,
        azimuth: rcAoa && aoaDev ? +(bearing(aoaDev, { lon: jLon, lat: jLat })).toFixed(1) : null,
        fromDeviceId: rcAoa && aoaDev ? aoaDev.id : null,
        // 方位线的原点随目标一起给出：否则渲染层要反查设备图层，
        // 而有些地图实例根本没加载设备 —— 那样方位线会静默消失
        fromDeviceLon: rcAoa && aoaDev ? aoaDev.lon : null,
        fromDeviceLat: rcAoa && aoaDev ? aoaDev.lat : null,
        fromDeviceName: rcAoa && aoaDev ? aoaDev.name : null,
        legal: '不适用', violation: null, risk: '低风险',
        // 此前把 AOA 改名成 TDOA 绕过「AOA 无位置」，等于让数据宣称 TDOA 测到了 AOA 测的东西。
        // 现在如实标 AOA，位置为空、只给方位角。
        durMin: u.durMin, trackKm: 0, source: src,
        // 与其它目标同一口径：事实存于 facts，Schema 字段 source_confidence 由它派生
        facts: (function () {
          const c = pickW([[ri(84, 96), 62], [ri(76, 83), 26], [ri(70, 75), 12]]);
          return { confidence: c, trackStatus: '稳定', sourceConfidence: +(c / 100).toFixed(2), appliesLegality: false };
        })(),
        model: '—', partner: u.partner, pilot: u.pilot,
        radioChannel: channel,
        /* A6:关联与去重信息 */
        linkedUavId: u.id,
        rcDedup: {
          merged: dedup, distM, channelMatch: true, dedupable: !rcAoa,
          paths: ['独立目标(objectType=100)', '无人机扩展字段(pilotLon/pilotLat)'],
          note: rcAoa ? 'AOA 仅有方位角，无法做时空邻近去重，须人工结合频点确认'
            : dedup ? '两路径判为同一物理遥控器，已合并展示' : '偏差超阈值，暂作两个候选待人工确认'
        }
      });
      u.linkedRcId = 'RCT' + u.id.slice(3, 11) + p3(seq);
    });
  })();

  /* ---- B02:统一目标 ID 的合并与分裂（设计 6.5）----
     与 A02 轨迹关联（同一部雷达多帧是否同一条轨迹，C 档由雷达/算法方交付）不同，
     本层回答「不同来源的多个目标是否同一个物理目标」，属平台融合引擎 B 系列（A 档，我方担正确性）。
     硬要求：合并/分裂必须保留完整 ID 变更历史 —— 案件与告警一旦引用某 target_id，
     即使该目标后续被合并，也必须能通过历史映射还原当时的判定依据，否则证据链回溯会断裂。 */
  const idLineage = [];        // ID 变更历史台账
  (function buildLineage() {
    const todays = allTargets.filter(t => t.ymd === ymd(CONF.demoTime) && t.type === '无人机');
    if (todays.length < 4) return;

    /* 用例一：合并 —— 雷达一路与 TDOA 一路先各自成为独立统一目标，随后被 B02 判为同一物理目标 */
    const a = todays[1], b = todays[2];
    if (a && b) {
      const survivor = a, absorbed = b;
      /* 验收用例：被合并方在合并前已被判非法并立案 —— 用于验证合并后案件仍可回溯。
         强制设定结论时必须同步改写客观事实，否则后面的证据门禁会因「要件①不成立」
         把它降回待确认，判定过程与结论对不上（本轮实测踩过这个坑）。 */
      if (absorbed.facts) {
        forceNoFlyFact(absorbed.facts, absorbed);          // 要件①：进入绝对禁止空间（连同命中的那块空域一起写）
        absorbed.facts.confidence = Math.max(absorbed.facts.confidence, 90);   // 要件③
        absorbed.facts.sourceConfidence = +(absorbed.facts.confidence / 100).toFixed(2);
        absorbed.facts.trackStatus = '稳定';               // 要件④
        absorbed.factsOverridden = 'B02 合并场景';   // 事实被场景显式改写，推导公式对它不成立
      }
      absorbed.source_confidence = absorbed.facts.sourceConfidence;
      absorbed.track_status = '稳定';
      // A5 并存期：旧字段与 Schema 字段成对更新
      absorbed.legal = '非法'; absorbed.legal_status = '非法';
      // 违规事由由事实重推，不写死 —— 写死会漏掉「未经批准飞行」这类同时成立的事由，
      // 而它恰恰决定了罚则基准。演示场景也必须走同一条推导，否则界面上的判定过程对不上结论。
      absorbed.violation_reasons = deriveLegality(absorbed.facts).violations;
      absorbed.violation = primaryViolation(absorbed.violation_reasons);
      absorbed.violation_reasons = ['侵入禁飞区'];
      absorbed.risk = '高风险'; absorbed.risk_level = '高风险';
      absorbed.lineageDemo = true;
      const t0 = new Date(Math.max(a.ts, b.ts) + 42000);
      idLineage.push({
        id: 'LNG' + p3(1), op: 'merge', at: fmtDT(t0), ts: t0.getTime(),
        survivorId: survivor.id, memberIds: [survivor.id, absorbed.id],
        // 合并前各自的判定快照 —— 证据链回溯的依据
        snapshots: [survivor, absorbed].map(x => ({
          targetId: x.id, source: x.source, legal_status: x.legal,
          violation: x.violation, risk: x.risk, alt: x.alt,
          source_confidence: x.facts.sourceConfidence, at: x.time
        })),
        basis: '时空门限 Δd 62m / Δt 1.4s，频点一致，速度航向连续',
        algo: 'B02-demo-v0.3　待算法方确认参数',
        operator: '系统自动（B02 融合引擎）'
      });
      absorbed.mergedInto = survivor.id;
      absorbed.mergedAt = fmtDT(t0);
      survivor.mergedFrom = [absorbed.id];
      survivor.sourceTargetIds = { [survivor.source]: survivor.id, [absorbed.source]: absorbed.id };
    }

    /* 用例二：分裂 —— 一个统一目标被判定实为两架，拆成两个新 target_id */
    const c = todays[3];
    if (c) {
      const t1 = new Date(c.ts + 96000);
      const newIds = [c.id.slice(0, 11) + '901', c.id.slice(0, 11) + '902'];
      idLineage.push({
        id: 'LNG' + p3(2), op: 'split', at: fmtDT(t1), ts: t1.getTime(),
        survivorId: null, memberIds: newIds, originId: c.id,
        snapshots: [{
          targetId: c.id, source: c.source, legal_status: c.legal,
          violation: c.violation, risk: c.risk, alt: c.alt,
          source_confidence: c.facts.sourceConfidence, at: c.time
        }],
        basis: '同一 track 内出现稳定双回波，间距 118m 且持续 > 8s，判为两架',
        algo: 'B02-demo-v0.3　待算法方确认参数',
        operator: '系统自动（B02 融合引擎）'
      });
      c.splitInto = newIds;
      c.splitAt = fmtDT(t1);
    }
  })();

  /* 按历史映射还原：给定任一历史 target_id，返回它现在归属的目标与当时的判定快照 */
  function resolveTargetId(tid) {
    for (const lg of idLineage) {
      if (lg.op === 'merge' && lg.memberIds.includes(tid)) {
        return {
          currentId: lg.survivorId, op: 'merge', at: lg.at, basis: lg.basis,
          snapshot: lg.snapshots.find(s => s.targetId === tid) || null,
          note: tid === lg.survivorId ? '该目标为合并后的存续目标' : '该目标已被合并，判定依据见快照'
        };
      }
      if (lg.op === 'split' && lg.originId === tid) {
        return {
          currentId: lg.memberIds, op: 'split', at: lg.at, basis: lg.basis,
          snapshot: lg.snapshots[0], note: '该目标已分裂为多个目标，判定依据见快照'
        };
      }
    }
    return null;                 // 未发生过合并/分裂
  }

  /* ---- A5 步骤1：为每个目标补 Target Schema V1 字段（与旧字段并存，页面逐页切换后再删旧字段）----
     映射依据：V1.1 第 7.3 节。标「平台生成」的字段设备不提供，由平台计算或分配。 */
  (function applyTargetSchema() {
    /* ---- 来源能力矩阵（协议 v8.6 / 光电边端协同接口）----
       约束：任何展示字段都必须能回答「哪个设备、按哪条协议字段给出的」。
       此前这些判断散在各处的内联三元表达式里，谁也说不清全站还有多少字段没做能力校验 ——
       机型就是这么漏掉的：字段名对、值也像模像样，646 个目标 100% 都填了具体型号，
       而其中 297 个只被雷达或 5G-A 通感看到，这两类设备根本给不出机型。
       改为一处声明 + 一条断言全量校验。null 表示该来源不提供，不得填值。 */
    const SRC_CAP = SRC_CAP_REF = {
      /* classification_confidence 全部改为 false，两条理由分别成立、**不要合并读**：
         ·【闭集读法·融合感知箱(雷达)】T02 协议 v3.0.0 §2.3.10 UPLOAD_TRACK_V3 逐字段穷举，
           只有「目标类型」6 值枚举 + 信噪比 + RCS，**没有任何概率/置信度字段** → 确证不提供。
         ·【未见资料·5G-A】本仓无 5G-A 通感任何材料 → **不是"确证不提供"，是不知道**。
         · 另有第三条独立理由适用于两者：本 demo 自己的接口台账（apis.js:1102）写明
           **classification_confidence 在 Target Schema V1 中尚未定义**，并建议补字段时
           「按设备上报 / 算法推断标注来源」—— 台账当初就预见到归属要区分，只是没接回这张表。

         更要命的是原来那行赋值：
             t.classification_confidence = cap.classification_confidence ? t.facts.sourceConfidence : null;
         **它把来源置信度原样抄成了分类置信度**，实测 700/700 两者完全相等。
         于是界面上「来源可信度」和「分类置信度」看着是两条证据，实际是同一个数 ——
         读者以为互相印证，其实是一个数说了两遍。
         没有依据就产出不了真的分类置信度，所以只能是 null，并说明**为什么**没有。 */
      '融合感知箱': { classification_confidence: false, clsConfWhy: '设备不提供（T02 协议 v3.0.0 航迹字段表内无概率字段，闭集读法）', position_accuracy: true, source_task_id: false, model: false },
      'TDOA':      { classification_confidence: false, clsConfWhy: '设备不提供（协议未定义分类置信度）', position_accuracy: true, source_task_id: false, model: 'series' },
      '5G-A':      { classification_confidence: false, clsConfWhy: '【待确认】本仓无 5G-A 通感资料，不能断言提供或不提供', position_accuracy: false, source_task_id: true, model: false }
    };
    const SRC_TYPE = {           // deviceType 归并为 source_type
      '融合感知箱': '融合感知箱', 'TDOA': '无线电定位', 'AOA': '无线电定位',
      '协议破解': '身份识别', 'RemoteID': '身份识别', '5G-A': '5G-A'
    };
    allTargets.forEach(t => {
      const devType = t.source === 'TDOA' ? 10 : t.source === '5G-A' ? 0 : 1;
      /* 身份与时间 */
      t.target_id = t.id;
      t.source_target_ids = t.sourceTargetIds || { [t.source]: t.id };
      t.device_ids = [t.source];
      t.event_time = t.ts;
      t.receive_time = t.ts + ri(80, 420);              // 链路时延
      t.update_time = t.ts + ri(500, 4000);
      /* 空间与运动 */
      t.longitude = t.lon; t.latitude = t.lat;
      t.altitude = t.alt;                               // 海拔高
      t.height_agl = t.heightAgl;                       // 距地高（选填，可为 null）
      t.coordinate_system = CONF.coordSys + ' / ' + CONF.altDatum;
      t.vertical_speed = +((rnd() - .45) * 4).toFixed(1);
      t.bearing = t.source === 'TDOA' ? +(rnd() * 360).toFixed(1) : null;
      t.target_size = t.type === '无人机'
        ? { length: +(ri(30, 180) / 100).toFixed(2), width: +(ri(30, 180) / 100).toFixed(2), height: +(ri(15, 60) / 100).toFixed(2) }
        : null;                                          // 协议单位 cm，此处已归一为米
      /* 分类 */
      t.target_type = t.type;
      t.object_type = t.objectType;
      // 分类置信度只有雷达与 5G-A 的 extension 提供 probability；光电协议不上报类别与置信度
      const cap = SRC_CAP[t.source] || {};
      t.classification_confidence = cap.classification_confidence ? t.facts.sourceConfidence : null;
      /* 缺失原因必须随字段一起走：只给 null 的话，界面只能自己猜一个理由
         —— 之前就猜错了：页面写的是「光电协议不上报类别」，
         而实际为 null 的是 TDOA/AOA，光电根本不是 source 的取值之一。 */
      t.clsConfWhy = t.classification_confidence == null
        ? (cap.clsConfWhy || '【待确认】本仓无 ' + t.source + ' 资料，不能断言提供或不提供') : null;
      /* 机型来源分级（与 uav_sn 同一条逻辑：设备能给什么，界面才敢显示什么）
           协议破解 dcd / RemoteID rid   → 解出具体型号
           已关联飞行计划                 → 型号取自报备信息，不是探测出来的
           TDOA / AOA 射频特征            → 只到系列级，是线索不是识别结果
           融合感知箱(雷达) / 5G-A 通感    → 给不出机型 */
      if (t.type === '无人机') {
        const rc = t.pilotPosition ? t.pilotPosition.device : null;
        if (rc === '协议破解' || rc === 'RemoteID') { t.modelSource = rc === '协议破解' ? '协议破解解析' : 'RemoteID 广播'; }
        else if (planned(t.facts)) { t.modelSource = '飞行计划报备'; }
        else if (rc === 'TDOA' || rc === 'AOA' || t.source === 'TDOA') { t.modelSource = '射频特征匹配'; t.model = MODEL_SERIES[t.model] || t.model; }
        else { t.modelSource = null; t.model = MODEL_UNKNOWN; }
      } else { t.modelSource = null; }
      t.uav_model = t.type === '无人机' ? t.model : null;
      /* uavSN 只有协议破解(dcd) 与 RemoteID(rid) 能提供。
         【闭集读法·雷达】同上：T02 v3.0.0 航迹字段表内无任何身份/序列号字段。
         【查证范围·光电/TDOA/AOA】本仓无这三类设备的协议文档（仅有雷达与反制两批），
         因此"给不出身份"对它们而言是**未见资料**，不是已证实 —— 若日后拿到手册须重查。 */
      /* 能不能拿到机身份，仍由**来源能力**决定（只有协议破解/RemoteID 给得出 SN）。
         但如果这个架次确实是按某条计划飞的，那它就是那条计划登记的那架飞机 ——
         SN 取自计划，而不是另抽一个永远对不上的号。
         随机数照常消耗，避免分支导致随机流错位。 */
      const _snRaw = 'UAS' + ri(100000, 999999), _snOk = rnd() < .85;
      const _snPlan = t.alignedPlanId
        ? (flightPlans.find(x => x.id === t.alignedPlanId) || {}).droneId : null;
      t.uav_sn = (t.type === '无人机' && t.pilotPosition &&
        ['协议破解', 'RemoteID'].includes(t.pilotPosition.device) && _snOk)
        ? (_snPlan || _snRaw) : null;
      /* C01「无人机身份」维度回填：uav_sn 此时才生成。
         无 uav_sn → 保持 null（不可判定），不得当作"身份对得上"。
         回填后必须重算 planMatch 与判定 —— 事实变了就走同一套规则重算，不另写一份。 */
      if (t.type === '无人机' && t.facts && t.facts.planMatchDims) {
        /* 身份与飞手单位改为**与候选计划实比**，不再 rnd()：
           拿不到机身份（雷达/光电给不出 SN）时是不可判定，不是不匹配。 */
        const _cp = t.facts.planCandidateId
          ? flightPlans.find(x => x.id === t.facts.planCandidateId) : null;
        t.facts.planMatchDims['无人机身份'] = _cp
          ? (t.uav_sn ? t.uav_sn === _cp.droneId : null) : null;
        t.facts.planMatchDims['飞手单位'] = _cp
          ? (t.partnerCand && t.partnerCand !== '—' ? t.partnerCand === _cp.partner : null) : null;
        /* 走廊维度取自几何计算结果，不再独立抽样：
           在走廊内 = 该维度命中，越出走廊 = 该维度偏离，算不出来（无批准航线）= null。
           独立抽一次等于让 C01 的走廊维度和 C02-3 的偏航判定各说各话。 */
        t.facts.planMatchDims['航线走廊'] = t.facts.offRoute === null ? null : !t.facts.offRoute;
        t.facts.planMatch = gradePlanMatch(t.facts.planMatchDims, t.facts.planCandidate);
        const d1 = deriveLegality(t.facts);
        t.legal = d1.legal; t.legal_status = d1.legal;
        t.violation_reasons = d1.violations;
        t.violation = primaryViolation(d1.violations);
        t.undeterminable = d1.undeterminable;
        t.plan_match = t.facts.planMatch;
        t.plan_match_dims = t.facts.planMatchDims;
      }
      /* ---- 责任主体认定路径 ----
         能把一个空中目标绑定到具体单位/自然人的，只有这几条路。
         TDOA 能给位置和遥控源方位，给不出「这是黄河口测绘队的郑凯」。
         此前 34 件案件写着具名主体却一条路径都没有 —— 机型写错是文书里一个描述项，
         主体写错，处罚决定书对着的当事人就是错的。 */
      if (t.type === '无人机') {
        const rc = t.pilotPosition ? t.pilotPosition.device : null;
        t.subjectSource =
          planned(t.facts) ? '计划报备匹配'
            : t.uav_sn ? '实名 SN（uavSN）'
              : rc === '协议破解' ? '协议破解解析'
                : rc === 'RemoteID' ? 'RemoteID 广播'
                  // AOA 只有方位、没有落点，落不到人；须有有效位置才谈得上现场查证
                  : (t.pilotPosition && t.pilotPosition.posValid) ? '遥控源定位（待现场查证）'
                    : null;
        if (t.subjectSource) { t.partner = t.partnerCand; t.pilot = t.pilotCand; }
        else { t.partner = '未知（待认定）'; t.pilot = '—'; }
      } else if (t.type === '遥控器') {
        const u = allTargets.find(x => x.id === t.linkedUavId);
        t.subjectSource = u ? u.subjectSource : null;
        t.partner = u ? u.partner : '—'; t.pilot = u ? u.pilot : '—';
      } else { t.subjectSource = null; }
      delete t.partnerCand; delete t.pilotCand;
      /* 来源质量 */
      t.source_type = SRC_TYPE[t.source] || t.source;
      t.device_type = devType;
      // 与判定所用为同一份事实，不得二次随机（否则页面门槛与数据层判定会各算各的）
      // 全量目标（含非无人机与遥控器）的唯一来源都是 facts，不存在第二个随机数，
      // 也不存在「Schema 字段反过来从展示字段派生」的倒挂。
      t.source_confidence = t.facts.sourceConfidence;
      t.position_accuracy = !cap.position_accuracy ? null
        : t.source === 'TDOA' ? +(rnd() * 20 + 8).toFixed(1) : +(rnd() * 12 + 6).toFixed(1);
      t.radio_channel = t.radioChannel || null;
      t.radio_bandwidth = t.radioChannel ? pick(['10 MHz', '20 MHz', '40 MHz']) : null;
      t.source_task_id = cap.source_task_id ? 'TASK' + ri(10000, 99999) : null;
      /* 轨迹 */
      t.track_id = t.trackId || null;
      t.track_points = t.track || null;
      /* track_status 是轨迹生命周期，与处置状态分属两个体系（设计 6.5）。
         必须取自 facts.trackStatus —— 此处原来是独立再抽一次 pickW，
         把上游按轨迹质量推导出来的值直接覆盖掉（实测 247 个无人机因此脱钩），
         等于 Schema 字段和事实各存一份、各自随机。 */
      t.track_status = t.facts && t.facts.trackStatus
        ? t.facts.trackStatus
        : (t.trackStatus0 || pickW(TRACK_STATUS_W.other));
      /* 合法性 / 风险 / 处置 */
      t.legal_status = t.legal;
      // 直接取自真值数组。此前经由单值 violation 派生，46 个多值目标 100% 被截断，
      // 而 violation_reasons 是 Target Schema V1 契约字段、也是正式 Adapter 要填的字段。
      if (!t.violation_reasons) t.violation_reasons = [];           // 非无人机/遥控器不参与违规判定
      /* matched_plan_id **必须是比对出来的那条计划**，不能由结论生成。
         原来写的是 `t.legal === '合法' ? 随机计划号 : null` ——
         先判成合法，再给它配一个计划号，实测 336/337 的"命中计划"开始于
         该架次飞完之后，距所谓命中航线中位数 48.6 km。那是结论在制造自己的证据。
         现在：命中（planMatch !== 未命中）才有值，且值就是那条覆盖它的计划。 */
      /* 「候选」与「命中」分开：
         planCandidateId = 空间上覆盖它的计划（一条线索）
         matched_plan_id = 时窗**也**真的包含这次飞行才算命中
         走廊covers但飞在批准时段之外的，是"超出批准时段"，不是"按这条计划飞的"。 */
      t.matched_plan_id = (t.facts && t.facts.planCandidateId
        && t.facts.planMatchDims && t.facts.planMatchDims['时间窗口'] === true)
        ? t.facts.planCandidateId : null;
      t.risk_level = t.risk;
      t.pilot_position = t.pilotPosition || null;
    });
  })();

  /* ---- C01/C03 证据充分性门禁（数据层，设计 §10.4 降级原则 + 表10-4 四要件）----
     「非法」结论的四要件：C01 未命中计划 且 C02 存在严重违规 且 较高置信度 且 轨迹稳定。
     任一要件不成立即降级为「待确认」—— 证据不足不得定性，这是合规底线。
     门禁属规则引擎职责，必须在数据构造末尾执行；若放在页面里，
     用户不打开该页时其他页面看到的仍是旧结论，会破坏单一数据源。
     注：判定已由 C01/C02/C03 推导保证四要件，此处为兜底校验，正常应命中 0 条；
     一旦命中即说明数据构造与判定规则不一致，是需要修的缺陷信号。 */
  const evidenceGateLog = [];
  (function evidenceGate() {
    allTargets.filter(t => t.legal === '非法').forEach(t => {
      const reasons = [];
      // 要件①：定性依据 —— 违规不被合法授权覆盖（无计划 或 进入绝对禁止空间）
      if (t.facts && !(t.facts.inNoFlyZone || t.facts.planMatch === '未命中' || t.facts.overZoneHeight || t.facts.overZoneTime))
        reasons.push('违规行为被合法授权覆盖，不构成「非法」定性依据（表10-4 要件①）');
      // 要件三：较高置信度
      if (t.source_confidence < 0.80) reasons.push(`来源可信度 ${t.source_confidence} 低于门槛 0.80（要件三）`);
      // 要件四：轨迹稳定
      if (['暂定', '短时丢失'].includes(t.track_status)) reasons.push(`轨迹${t.track_status}（要件四）`);
      // C01 身份证据充分性：身份不匹配的唯一依据是 uavSN，而它只有 dcd/rid 能提供
      if (t.violation_reasons.includes('身份不匹配') && !t.uav_sn) {
        reasons.push('无 uav_sn 数据源（需 dcd/rid），身份匹配降级为时间窗 + 空间范围，不足以支撑「身份不匹配」定性');
      }
      if (!reasons.length) return;
      const from = t.legal;
      t.legalOriginal = t.legalOriginal || from;      // 原判定固化，不被覆盖
      t.legal = '待确认'; t.legal_status = '待确认';
      t.legalSource = 'engine-gate';
      t.reviewLog = t.reviewLog || [];
      t.reviewLog.push({
        at: fmtDT(new Date(t.ts + ri(60, 900) * 1000)),
        operator: '规则引擎 · C01/C03 证据充分性门禁', account: 'rule-engine', role: '系统自动',
        from, to: '待确认', reason: reasons.join('；'), act: '证据降级'
      });
      evidenceGateLog.push({ targetId: t.id, from, reasons, at: t.reviewLog[t.reviewLog.length - 1].at });
    });
  })();

  const todayTargets = allTargets.filter(t => t.ymd === ymd(CONF.demoTime));
  /* 空中目标：遥控器在地面，不计入「感知空中目标数」，避免一架无人机被计两次 */
  const airborneTargets = allTargets.filter(t => t.type !== '遥控器');

  /* ---- 今日实时目标详单（含三路融合明细与轨迹）---- */
  function trackPoints(t, n, opt) {
    opt = opt || {};
    // 没有有效位置就没有轨迹可言。此前 null - 0.06 会静默算出 -0.06，
    // 于是"没有位置"变成了"位置在几内亚湾"——比报错难查得多。
    if (t.lon == null || t.lat == null) return [];
    /* F0202:轨迹点分型 —— meas 实测 / bridge 弥合(短时丢点恢复,A03) / pred 预测(恒速外推,A04) */
    const pts = []; let lon = t.lon - 0.06, lat = t.lat - 0.05;
    const dl = 0.12 / n, da = 0.10 / n;
    /* 断裂区间：条数与长度按目标自身的来源质量与轨迹状态变化，不是每条都一模一样。
       此前固定「中段 4 个点」，导致 14 条轨迹的弥合率全是 15.4% ——
       「哪条轨迹最不可信」这类排序就完全没有信息量，图看着有数据，实际是常数。 */
    const q = t.source_confidence != null ? t.source_confidence : 0.9;
    const unstable = t.track_status === '短时丢失' || t.track_status === '暂定';
    const gapCount = unstable ? ri(2, 3) : (q < 0.82 ? ri(1, 2) : (rnd() < .35 ? 1 : 0));
    const gaps = [];
    for (let g = 0; g < gapCount; g++) {
      const len = unstable ? ri(3, 6) : ri(2, 4);
      const st = Math.floor(n * (0.18 + 0.62 * (g + rnd()) / Math.max(gapCount, 1)));
      if (gaps.some(x => st <= x[1] + 1 && st + len >= x[0] - 1)) continue;   // 相邻两段会连成一段，视为一次断裂
      gaps.push([st, Math.min(st + len - 1, n - 3)]);
    }
    for (let i = 0; i < n; i++) {
      lon += dl + (rnd() - .5) * .006; lat += da + (rnd() - .5) * .006;
      // §6.8：预测段只对仍在进行的飞行有意义；已结束/已处置的目标不得带外推位置
      const kind = (i >= n - 2 && opt.allowPred !== false) ? 'pred'
        : (gaps.some(g => i >= g[0] && i <= g[1]) ? 'bridge' : 'meas');
      pts.push({ lon: +lon.toFixed(6), lat: +lat.toFixed(6), alt: t.alt + ri(-18, 18), t: t.ts - (n - i) * 12000, kind });
    }
    return pts;
  }
  const liveTargets = [];
  (function buildLive() {
    // 实时跟踪列表以无人机为主（非无人机走空间安全风险线，不做合法性判定）
    const uavs = todayTargets.filter(t => t.type === '无人机').slice(-10).reverse();
    // 遥控器在地面、速度恒为 0，不参与"实时跟踪"这条业务线；
    // 之前混进来后被当空中目标发了 26 点飞行轨迹，AOA 的那两条还因为没有经纬度落到了 (0,0) 附近
    const others = todayTargets.filter(t => t.type !== '无人机' && t.type !== '遥控器').slice(-4).reverse();
    const picks = uavs.concat(others);
    picks.forEach((t, i) => {
      const inZone = airspaces[i % airspaces.length];
      const tracked = i === 0;
      const fused = {
        雷达: { on: true, 识别结果: '航迹', 置信度: ri(85, 96), 方位: (rnd() * 360).toFixed(1) + '°', 距离: (rnd() * 8 + .8).toFixed(1) + ' km', 高度: t.alt + ' m' },
        光电: { on: t.risk !== '低风险', 识别结果: t.type === '无人机' ? '旋翼无人机' : t.type, 置信度: ri(78, 94), 特征匹配: ri(70, 92) + '%', 可见光: '有', 红外: '有' },
        'TDOA/AOA': { on: t.source !== '5G-A', 识别结果: '航迹', 置信度: ri(80, 93), 残差: (rnd() * 20 + 4).toFixed(1) + ' m', 定位精度: (rnd() * 22 + 8).toFixed(1) + ' m', 遥控源: rnd() < .6 ? '已定位' : '未定位' },
        '5G-A基站': { on: rnd() < .8, 识别结果: '疑似无人机', 置信度: ri(72, 90), 信号强度: '-' + ri(62, 92) + ' dBm', 时延: ri(18, 60) + ' ms', 关联小区: t.district + '-基站' + ri(1, 40) }
      };
      liveTargets.push(Object.assign({}, t, {
        tracked, zone: inZone, fused,
        track: trackPoints(t, 26, { allowPred: !['已处置', '已关闭'].includes(t.status) }),
        fusedConf: Math.round(sum(Object.values(fused).filter(f => f.on && f.置信度), f => f.置信度) / Math.max(1, Object.values(fused).filter(f => f.on && f.置信度).length)),
        srcCount: Object.values(fused).filter(f => f.on).length,
        trackId: 'TRK' + p3(200 + i), status: pick(['跟踪中', '跟踪中', '处置中', '已处置'])
      }));
    });
    // 首个跟踪目标固定为一起"禁飞区闯入"，用于 Demo 演示完整处置链路（仅当其为无人机时才判违规）
    const first = liveTargets[0];
    if (first && first.type === '无人机') {
      first.status = '跟踪中';
      // 演示用例：强制为一起「禁飞区闯入」。客观事实同步改写，保证结论仍可由规则推导
      if (first.facts) {
        forceNoFlyFact(first.facts, first);
        first.facts.confidence = Math.max(first.facts.confidence, 88);
        first.facts.trackStatus = '稳定';
        first.factsOverridden = 'B02 合并场景';
      }
      first.source_confidence = first.facts.sourceConfidence; first.track_status = '稳定';
      first.legal = '非法'; first.legal_status = '非法';
      first.violation_reasons = deriveLegality(first.facts).violations;
      first.violation = primaryViolation(first.violation_reasons);
      first.risk = '高风险'; first.risk_level = '高风险';
      first.zone = airspaces.find(a => a.type === '禁飞空域');
      // 同步回 allTargets，保证告警/案件/统计口径一致
      const src = allTargets.find(t => t.id === first.id);
      if (src) {
        // A5 并存期：旧字段与 Schema 字段成对更新；客观事实同步，保证结论可由规则推导
        if (src.facts) {
          forceNoFlyFact(src.facts, src);
          src.facts.confidence = Math.max(src.facts.confidence, 88);
          src.facts.trackStatus = '稳定';
          src.factsOverridden = 'B02 分裂场景';
        }
        src.source_confidence = src.facts.sourceConfidence; src.track_status = '稳定';
        src.legal = '非法'; src.legal_status = '非法';
        src.violation_reasons = deriveLegality(src.facts).violations;
        src.violation = primaryViolation(src.violation_reasons);
        src.risk = '高风险'; src.risk_level = '高风险';
      }
    }
  })();

  /* ---- F0210:多源融合权重(可在融合参数配置中修改并即时生效;正式值由算法方提供,B03) ---- */
  const fusionWeights = { '雷达': 42, '光电': 26, 'TDOA/AOA': 21, '5G-A基站': 11 };
  function recalcFusedConf(t) {
    let sw = 0, acc = 0;
    Object.keys(t.fused).forEach(k => {
      const f = t.fused[k];
      if (f.on && f.置信度) { const w = fusionWeights[k] || 5; sw += w; acc += w * f.置信度; }
    });
    t.fusedConf = sw ? Math.round(acc / sw) : 0;
    return t.fusedConf;
  }

  /* ---- B1:处置流程六环节（设计表 9-3）——态势/告警/处罚三页共用此唯一常量 ---- */
  /* 六环节**横跨三个模块**，每个环节标明归属：
     处罚页能展示全部六环节（那是案件的完整历史），但**只能推进属于自己的那两环**。
     此前没有归属信息，于是处罚页可以把案件推过「反制处置」「信号干扰」——
     那是融合感知中心做的事，处罚页把它没做过的事记成了已完成。 */
  const DISPOSAL_FLOW = [
    { n: '告警触发', d: '系统自动发现并触发告警', owner: '异常告警中心' },
    { n: '人工核实', d: '值班员核实目标与违规事实', owner: '异常告警中心' },
    { n: '立案', d: '登记案件并确定责任主体', owner: '处置处罚管理' },
    { n: '反制处置', d: '授权后实施反制（§6.3 人在回路）', owner: '融合感知中心' },
    { n: '信号干扰', d: '公安授权后实施信号干扰（如需）', owner: '融合感知中心' },
    { n: '结案归档', d: '结果与证据链归档存证', owner: '处置处罚管理' }
  ];
  /* ---- A7:状态枚举（设计 9.1 / 9.3）---- */
  const ALARM_STATUS = ['新建', '已确认', '处置中', '已关闭', '误报'];
  const CASE_STATUS = ['待核实', '已立案', '处置中', '待归档', '已结案'];
  /* ---- 案件状态的唯一推导来源 ----
     此前 mock.js 与 punish.js **各写了一份 stage→status 的换算**，且两份都错位一格：
       stage=2 表示「告警触发 + 人工核实」两环已完成、**立案尚未发生**，
       而换算给出「已立案」—— 把一件还没立案的案子标成已立案。
       实测 stage=2 的案件有 1 件，stage=3 的有 0 件，所以这个错位一直没人看见。
     现在收成一个函数，页面不要再算第二遍。

     【待确认：业务方】枚举与流程不对齐：六环节 vs 五状态，
     缺少「人工核实已完成、尚未立案」对应的状态。此处保守取「待核实」——
     它低估了进度，而「已立案」高估了：**在法律记录上，声称已立案而实际未立案，比反过来严重**。 */
  /* 数据层的审计写入口。此前只有 legality.js 里有一份页面级的，
     数据层动作（回退、同步下发）写不进审计 —— 而"能改数据却不留痕"正是审计要防的。 */
  function pushAudit(module, action, target, result) {
    const n = auditLogs.reduce((m, a) => Math.max(m, parseInt(String(a.id).replace(/\D/g, '')) || 0), 0) + 1;
    const u = users.find(x => x.id === _currentUserId) || {};
    const rec = {
      id: 'AU' + p3(n), time: nowStr(), user: u.name || '系统', role: u.roleName || '系统自动',
      module, action, target: target || '—', result: result || '成功',
      ip: '10.20.1.15', term: '终端-01'
    };
    auditLogs.push(rec);
    return rec;
  }

  function caseStatusOf(c) {
    const done = c.stage || 0;                     // 已完成环节数
    if (done >= 6) return '已结案';
    if (done >= 5) return '待归档';
    if (done >= 4) return '处置中';                 // 反制处置已完成
    if (done >= 3) return '已立案';                 // 立案已完成
    return '待核实';                                // 含 done=2（核实完成、待立案）
  }
  /* ---- 能否推进：**纯查询，绝不写任何数据** ----
     页面在弹窗打开前需要先问"这一步我能不能做"，好把理由提前说清楚。
     此前只有会写数据的 advanceCase，调用方要么多传一个被静默忽略的参数
     （会导致每打开一次弹窗就推进一格 —— **这是推断，不是实测**：
      调用方在提交前查签名发现了，那段代码没有真正跑过），要么自己深拷副本
     —— 而只浅拷外层会共享 steps 数组，照样改到真数据。
     独立的纯查询函数比"给 advanceCase 加 dryRun 开关"安全：
     开关漏传会退回破坏性行为且不报错，而纯查询函数**不具备产生副作用的能力**。 */
  function canAdvanceCase(c, byModule) {
    const next = DISPOSAL_FLOW[c.stage];
    if (!next) return { ok: false, reason: '案件已走完全部环节', nextStep: null, nextOwner: null };
    if (next.owner !== byModule) {
      return {
        ok: false, reason: `「${next.n}」由${next.owner}执行，${byModule}不能代为推进`,
        nextStep: next.n, nextOwner: next.owner
      };
    }
    return { ok: true, reason: '', nextStep: next.n, nextOwner: next.owner };
  }
  /* 推进：闸门判据**只有一处**，就是 canAdvanceCase。
     查询与执行各写一份判据的话，分叉的表现是"弹窗说能推、真调用被拒"，
     用户会以为是自己点错了。 */
  function advanceCase(c, byModule) {
    const chk = canAdvanceCase(c, byModule);
    if (!chk.ok) return chk;
    c.stage += 1;
    rebuildCaseSteps(c);
    return { ok: true, step: chk.nextStep, status: c.status };
  }
  /* ---- steps 的唯一构造处 ----
     此前页面回退时自己重建了一遍 steps（`restage()`），那是第二处知道
     "steps 该长什么样"的地方；偏移规则一改，两处就会不一致。 */
  function rebuildCaseSteps(c, baseTs) {
    /* 三态：不适用 / 已完成 / 待处理。
       条件环节（反制处置、信号干扰）未实施时是**不适用**，不是"待处理"也不是"已完成"。 */
    const applicableOf = k => k === 3 ? !!c.counterApplicable : k === 4 ? !!c.jamApplicable : true;
    c.steps = DISPOSAL_FLOW.map((f, k) => {
      const prev = (c.steps || [])[k] || {};
      const ok = applicableOf(k);
      const done = ok && k < c.stage;
      return {
        n: f.n, d: f.d, owner: f.owner, applicable: ok,
        // 已完成环节保留原有时间；新完成的取当前时刻；被回退的必须清回"待处理"
        t: !ok ? '不适用'
          : done ? (prev.t && prev.t !== '待处理' && prev.t !== '不适用' ? prev.t : nowStr())
            : '待处理',
        done, act: k === c.stage
      };
    });
    c.status = caseStatusOf(c);
    return c;
  }
  /* ---- 回退：复核撤案、补证重判都是往回退 ----
     必须留痕：谁、何时、从哪退到哪、为什么 —— 撤销案件是要进审计的动作，
     不能悄悄改 stage。回退同样只能由拥有目标环节的模块发起。 */
  function setCaseStage(c, stage, reason, byModule) {
    const to = Math.max(0, Math.min(DISPOSAL_FLOW.length, stage | 0));
    if (to === c.stage) return { ok: false, reason: '目标环节与当前一致，无需回退' };
    if (to > c.stage) return { ok: false, reason: '回退接口不得用于前进，请用 advanceCase' };
    if (!reason || !String(reason).trim()) return { ok: false, reason: '回退理由为必填（进审计）' };
    const from = c.stage;
    c.stage = to;
    rebuildCaseSteps(c);
    c.restageLog = c.restageLog || [];
    c.restageLog.push({
      at: nowStr(), from, to, reason: String(reason).trim(),
      operator: (users.find(u => u.id === _currentUserId) || {}).name || '未知',
      byModule: byModule || '处置处罚管理'
    });
    pushAudit('处置处罚管理', `案件回退：环节 ${from} → ${to}（${String(reason).trim()}）`, c.id);
    return { ok: true, from, to, status: c.status };
  }

  /* ---------------- 5. 告警（由目标派生，唯一来源） ---------------- */
  const ALARM_TYPE = { '侵入禁飞区': '禁飞区闯入', '未经批准飞行': '非法闯入',
    '超出空域限高': '超出空域限高', '超出计划批准高度': '超出批准高度',
    '超出空域管制时段': '超出管制时段', '超出计划批准时段': '超出批准时段',
    '超视距飞行': '超视距飞行', '夜间飞行': '夜间飞行', '偏离报备航线': '偏离航线', '身份不匹配': '身份不匹配' };
  const alarms = [];
  (function buildAlarms() {
    const src = allTargets.filter(t => t.violation || (t.type !== '无人机' && ['高风险', '超高风险'].includes(t.risk)));
    src.forEach((t, i) => {
      const lv = t.risk === '超高风险' ? '高' : (t.risk === '高风险' ? '高' : (t.risk === '中风险' ? '中' : '低'));
      const isToday = t.ymd === ymd(CONF.demoTime);
      const st = isToday ? pickW([['处置中', 30], ['已关闭', 40], ['已确认', 16], ['新建', 14]]) : pickW([['已关闭', 92], ['误报', 8]]);
      alarms.push({
        id: 'ALM' + t.date.replace(/-/g, '') + p3(i % 999 + 1),
        targetId: t.id, ymd: t.ymd, date: t.date, time: t.time, ts: t.ts,
        type: t.violation ? ALARM_TYPE[t.violation] : (t.type + '空间风险'),
        kind: t.violation ? '飞行违规' : '空间安全',
        level: lv, risk: t.risk, district: t.district, status: st,
        detail: t.violation ? `目标 ${t.id} ${t.violation}，实测高度 ${t.alt}m，速度 ${t.speed}m/s` :
          `${t.district}发现${t.type}活动，高度 ${t.alt}m，评估为${t.risk}`,
        source: t.source, source_confidence: t.facts.sourceConfidence
      });
    });
    alarms.sort((a, b) => b.ts - a.ts);
  })();
  const todayAlarms = alarms.filter(a => a.ymd === ymd(CONF.demoTime));

  /* ---------------- 6. 处置 / 处罚案件（由违规目标派生） ---------------- */
  const cases = [];
  (function buildCases() {
    // 并非每起非法飞行都能立案：证据不足/责任主体无法认定的不进入处罚流程
    const src = allTargets.filter(t => t.legal === '非法').sort((a, b) => b.ts - a.ts)
      // 立不了案的必须记下「卡在哪一步」，不能静默丢弃：
      // 静默丢弃会让查处率虚高 —— 分母悄悄变小了，而实际是案子没办成。
      .filter(t => {
        if (t.lineageDemo) return true;
        if (!t.subjectSource) { t.caseBlockedBy = '责任主体待认定'; return false; }
        if (rnd() >= 0.88) { t.caseBlockedBy = '证据待补强'; return false; }
        return true;
      });
    src.forEach((t, i) => {
      const isToday = t.ymd === ymd(CONF.demoTime);
      /* ---- 本案是否实际实施了反制 / 信号干扰 ----
         这是一个**独立的案情事实**，不是从 stage 推出来的：
         并非每起案件都动用反制手段（多数是立案处罚了事）。
         此前六环节被无差别套在每起案件上，于是 62 起案件的「反制处置」都标成已完成，
         而其中 38 起**没有任何授权凭据** —— 案卷显示反制已执行、却拿不出谁批的。
         纪要 §6.3 要求反制必须人工授权、双确认、急停、全程审计，
         「已实施反制但无授权记录」正是该条最不能出现的形态。
         授权记录由这个事实生成（授权是原因），不是反过来按 stage 补齐（那样两端同源、
         永远对得上也永远证明不了任何事）。 */
      /* 命名注意：这两个字段表达的是「**本案流程包含该环节**」，
         **不是**「该环节已执行」。是否已执行看 `steps[3].done` / `steps[4].done`。
         原名 `usedCounter` 是过去式，读起来像"已经用过了"，自带一个它并不保证的断言 ——
         复核者据此直接当成"已执行"的证据，报出过一个并不存在的缺陷
         （两件 stage=1/2 的案件被算成"已反制却缺授权"，实际它们还没走到该环节）。
         正确用法始终是 `counterApplicable && stage > 3`，而旧名字不提示这一点。 */
      const counterApplicable = rnd() < 0.42;                          // 本案流程是否包含反制处置环节
      const jamApplicable = counterApplicable && rnd() < 0.28;         // 是否进一步包含公安信号干扰环节
      // stage = 进行到第几环节（0..6）；不适用的环节直接跨过
      const stage = isToday ? ri(1, 3) : pickW([[6, 82], [5, 10], [4, 8]]);
      const status = caseStatusOf({ stage });   // 唯一来源，此处不再写第三份换算
      const base = new Date(t.ts);
      /* `t` 与 `done` 此前用了不同的偏移（`k < stage` 与 `k < stage - 1`）：
         第 stage-1 环节会**既有完成时间、又标着未完成**，同一格里两个字段互相打架。
         stage = 已完成环节数 ⇒ 0..stage-1 均已完成，当前进行中的是第 stage 环。 */
      /* 反制处置(k=3) 与 信号干扰(k=4) 是**条件环节**（DISPOSAL_FLOW 里信号干扰本就写着「如需」）。
         未实施的标「不适用」，而不是标「已完成」—— 后者是在断言一件没发生的事。 */
      const applicableOf = k => k === 3 ? counterApplicable : k === 4 ? jamApplicable : true;
      const steps = DISPOSAL_FLOW.map((f, k) => {
        const ok = applicableOf(k);
        return {
          n: f.n, d: f.d, owner: f.owner, applicable: ok,
          t: !ok ? '不适用' : (k < stage ? fmtDT(new Date(base.getTime() + k * ri(6, 90) * 60000)) : '待处理'),
          done: ok && k < stage, act: k === stage
        };
      });
      const lineage = resolveTargetId(t.id);      // 案件引用的 target_id 是否发生过合并/分裂
      // 立案时的判定快照 —— 已立案案件是历史事实，不因后续重新判定或证据门禁而消失
      const filingSnapshot = {
        at: fmtDT(new Date(t.ts + ri(30, 600) * 1000)),
        // 记录建案当时的真实判定。此前写死 '非法'，而校验它的断言比的也是同一个常量 ——
        // 两端同源的断言恒真，等于没有断言；判定一旦在后续被修订也看不出来。
        legal_status: t.legal,
        // 立案快照须完整记录当时认定的全部违规事由，否则复核时看不出「当时认定了几条」
        violation_reasons: t.violation_reasons.slice(),
        track_status: t.facts.trackStatus,
        risk_level: t.risk, source_type: t.source, confidence: t.facts.sourceConfidence,
        // 机型与其来源、主体与其认定路径，都是成对的事实，必须一起快照：
        // 分存两处，一旦目标被事实修订，案件就会留着旧值配新来源标记
        model: t.model, model_source: t.modelSource,
        subject: t.partner, subject_source: t.subjectSource,
        // 法律依据按客观事实生成：有计划的目标不能写「C01 未匹配有效飞行计划」
        basis: (planned(t.facts) ? 'C01 ' + t.facts.planMatch + '飞行计划，' : 'C01 未匹配有效飞行计划，')
          + 'C02 认定 ' + t.violation_reasons.join('、')
          + '；C03 证据充分（来源置信度 ' + t.facts.sourceConfidence.toFixed(2) + '，轨迹' + t.facts.trackStatus + '）'
      };
      cases.push({
        filingSnapshot,
        id: 'CF2026' + t.date.slice(5).replace('-', '') + p3(i % 999 + 1),
        targetId: t.id, idLineage: lineage, ymd: t.ymd, date: t.date, time: t.time, ts: t.ts,
        model: t.model, partner: t.partner, pilot: t.pilot,
        violation: t.violation, district: t.district, status, stage, steps,
        counterApplicable, jamApplicable,          // 案情事实：授权记录由它生成，不由 stage 反推
        fine: FINE[t.violation] || 2000,
        penalty: pickW([['警告', 55], ['罚款', 30], ['驱离', 15]]),
        rcSn: 'RC' + ri(2026000000, 2026999999),
        docNo: 'CF2026' + t.date.slice(5).replace('-', '') + p3(i % 999 + 1) + '-01',
        docReady: stage >= 3,
        evidence: ri(2, 6), officer: pick(PILOTS)
      });
    });
  })();
  const casesToday = cases.filter(c => c.ymd === ymd(CONF.demoTime));

  /* ---- 干扰通道表（一手资料，逐字段可溯源） ----
     range/powerW 直接抄自《无人机反制侦打一体-固定式资料.doc》§3
       「干扰频段划分及发射功率」：2390-2510/200W、5708-5872/100W、1552-1632/20W、900MHz/40W
     通道号 ch 抄自《网络控制器通信协议v2.0.txt》末尾「ch1 接900 / ch2 接1.5 / ch3 接2.4 / ch4 接5.8」

     gnss 一栏是**推定不是原文**，推定链条写在这里以便复核：
       ① 资料 §1.5「干扰链路」明确含 GPS\GLONASS\北斗卫星导航链路 —— 该能力确实存在；
       ② 四个通道里只有 1552-1632MHz 覆盖 GPS L1(1575.42)/北斗 B1(1561)/GLONASS(~1602)；
       ③ 故承担卫星导航干扰的只可能是 ch2。
     资料**没有**逐通道写明各路对应遥控还是图传，所以这里也不写 —— 缺的就是缺的。 */
  const JAM_CH = {
    1: { ch: 1, key: '900M',  range: '900MHz',        powerW: 40,  gnss: false },
    2: { ch: 2, key: '1.5G',  range: '1552-1632MHz',  powerW: 20,  gnss: true  },
    3: { ch: 3, key: '2.4G',  range: '2390-2510MHz',  powerW: 200, gnss: false },
    4: { ch: 4, key: '5.8G',  range: '5708-5872MHz',  powerW: 100, gnss: false }
  };
  const JAM_SOURCE = '无人机反制侦打一体-固定式资料.doc §3 干扰频段划分及发射功率；'
    + '网络控制器通信协议v2.0.txt 通道映射与迫降/驱离设置';
  /* 处置方式 → 通道集合。原文只定义了「迫降」和「驱离」两种。
     「返航」不在原文里：它是无人机自身失控保护的行为，不是设备的一种设置，
     资料没写用哪几路能促成返航，所以**不猜**，返回 null 并在自检里单列。 */
  function channelsFor(result) {
    if (result === '迫降') return [1, 2, 3, 4];              // 原文：四路全开
    if (result === '退出管制区') return [1, 3, 4];            // 原文：驱离＝除 ch2 外全开
    return null;                                            // 返航/无效：原文未定义
  }

  /* band 为 null 有**两个完全不同的原因**，界面不能都写成"—"或"不适用"：
       ① 这条记录压根不涉及信号干扰（反制处置用的别的手段）→ 不适用
       ② 是信号干扰，但资料没定义该处置方式（返航/无效）用哪几路 → 待确认
     ①是"这个问题不成立"，②是"这个问题成立但我答不上来"。
     把②显示成①，等于把"不知道"伪装成"不需要知道" —— 不可判定 ≠ 不适用。
     两处视图共用这一个函数，避免各写一份而口径分叉。 */
  function bandNote(a) {
    if (a.band) return null;
    return a.type === '公安授权信号干扰'
      ? { txt: '【待确认：设备方】资料未定义「' + a.result + '」的通道组合', pending: true }
      : { txt: '不适用（非信号干扰）', pending: false };
  }

  /* ---- 反制/信号干扰授权记录（纪要 §6.3 强制人工授权 + 审计） ---- */
  const authLogs = [];
  (function buildAuth() {
    /* 授权记录来自**案情事实**（该案是否实际实施了反制/干扰），
       不是按 `cases.slice(0, 26)` 取前 26 件 —— 那与案件是否走过该环节毫无关系，
       实测造成 38 件"已反制却无授权"、2 件"有授权却还没走到该环节"，双向都错。
       只有真正走到该环节的案件才会有授权记录：授权是原因，环节完成是结果。 */
    const src = cases.filter(c => c.counterApplicable && c.stage > 3);
    src.forEach((c, i) => {
      const t = new Date(c.ts + ri(3, 20) * 60000);
      const res = pickW([['迫降', 34], ['返航', 46], ['退出管制区', 16], ['无效', 4]]);
      /* 只有信号干扰记录才谈得上"开了哪几路"：通道属于干扰设备。
         非干扰的反制处置用的是别的手段，频段字段对它不适用（null，不是空串）。 */
      const chs = c.jamApplicable ? channelsFor(res) : null;
      authLogs.push({
        id: 'AUTH2026' + p2(8) + p3(i + 1),
        caseId: c.id, targetId: c.targetId,
        type: c.jamApplicable ? '公安授权信号干扰' : '反制处置',
        unit: c.jamApplicable ? '东营市公安局特警支队' : '东营市低空安全管理中心',
        approver: pick(['张建国', '李国强', '王振华']), operator: pick(PILOTS),
        device: c.jamApplicable ? '公安干扰车-0' + ri(1, 6) : '反制-' + p3(ri(1, 34)),
        range: ri(500, 2500) + ' m 扇区 ' + ri(30, 120) + '°',
        durationS: ri(20, 240),
        start: fmtDT(t), end: fmtDT(new Date(t.getTime() + ri(20, 240) * 1000)),
        result: res,
        /* 频段不再是一个装饰性字符串，而是**由处置方式推出的通道集合**。
           依据《网络控制器通信协议v2.0.txt》末尾原文：
             ch1 接900 / ch2 接1.5 / ch3 接2.4 / ch4 接5.8
             迫降：四路全开
             驱离：除 1.5（ch2）不开 其它全开
           所以"开了哪几路"不能独立抽取 —— 它由 result 决定。
           反过来也成立：**处置结果与通道集合必须自洽**，这就是下面那条自检。
           注意 `result` 现在有两个消费者（界面展示 + 通道集合），
           单调它已经无法偷偷修好其中一个结论。 */
        channels: chs,
        band: chs ? chs.map(c => JAM_CH[c].key).join(' / ') : null,
        bandSource: chs ? JAM_SOURCE : null,
        /* GNSS 干扰要显性：干扰 GPS/北斗的法律后果与干扰遥控图传完全不同。
           这一路是否开启由 ch2 决定，不是另抽的标记。 */
        gnssJam: chs ? chs.includes(2) : null,
        ack: '已回执', audit: '完整', estop: rnd() < .12 ? '触发过急停' : '未触发'
      });
    });
  })();

  /* ---- 待认定案源 ----
     违法事实清楚、但四条身份认定路径都不通的目标。它们不能因为"立不了案"就从平台上消失 ——
     那样统计口径会显示违法查处率虚高，而实际是 34 起根本没找到当事人。
     现实中的出路是现场查获或向运营商/厂商调证，平台要把它们挂出来等补充证据。 */
  const pendingSubjects = allTargets
    .filter(t => t.legal === '非法' && t.caseBlockedBy)
    .sort((a, b) => b.ts - a.ts)
    .map((t, i) => ({
      id: 'PS' + t.date.slice(5).replace('-', '') + p3(i + 1),
      blockedBy: t.caseBlockedBy,
      targetId: t.id, ymd: t.ymd, date: t.date, time: t.time, ts: t.ts,
      district: t.district, violation: t.violation, violation_reasons: t.violation_reasons.slice(),
      model: t.model, modelSource: t.modelSource, source: t.source,
      source_confidence: t.source_confidence, track_status: t.facts.trackStatus,
      // 缺哪条路径就写哪条，值班员据此知道该去补什么证
      subjectSource: t.subjectSource,
      missing: t.caseBlockedBy === '责任主体待认定'
        ? ['无匹配飞行计划', '无实名 SN', '无协议破解/RemoteID 解析',
          t.pilotPosition ? '遥控源仅方位、无落点' : '未定位到遥控源']
        : ['轨迹或影像证据链不完整，不足以支撑立案'],
      nextStep: t.caseBlockedBy === '责任主体待认定'
        ? (t.pilotPosition ? '据遥控源方位现场查找操作员' : '向频谱管理部门调证 / 现场布控')
        : '调取该时段光电录像与雷达原始点迹补强证据链',
      status: '待' + (t.caseBlockedBy === '责任主体待认定' ? '认定' : '补证')
    }));

  /* ---- 立案后的事实修订（设计 §11 复核触发）----
     现实里判定被推翻，几乎都不是「规则变了」而是「事实变了」：设备二次标定后来源置信度下修、
     轨迹经离线复算判为短时丢失。修订后必须走 deriveLegality 重算 —— 结论不得手工改写，
     否则界面上的「判定过程」又会和结论对不上。
     快照不跟随修订：已立案是历史事实。 */
  const factRevisions = [];
  (function reviseAfterFiling() {
    const REV = [
      { pick: c => c.status === '已结案',
        why: '光电设备年度标定复测，该时段来源置信度整体下修 0.14',
        apply: f => { f.sourceConfidence = +(f.sourceConfidence - 0.14).toFixed(2); f.confidence = Math.round(f.sourceConfidence * 100); } },
      { pick: c => c.status === '处置中' || c.status === '已立案',
        why: '轨迹离线复算：中段缺 9 个点，重判为短时丢失',
        apply: f => { f.trackStatus = '短时丢失'; } }
    ];
    REV.forEach(r => {
      const c = cases.find(x => r.pick(x) && (() => {
        const t = allTargets.find(y => y.id === x.targetId);
        if (!t || !t.facts || t.revised) return false;
        const probe = Object.assign({}, t.facts); r.apply(probe);
        return deriveLegality(probe).legal !== t.legal;      // 只挑真会改变结论的，否则这条修订演示不出东西
      })());
      if (!c) return;
      const t = allTargets.find(y => y.id === c.targetId);
      const from = t.legal;
      r.apply(t.facts);
      const d = deriveLegality(t.facts);
      t.legal = d.legal; t.legal_status = d.legal;
      t.violation_reasons = d.violations;
      t.violation = primaryViolation(d.violations);
      t.source_confidence = t.facts.sourceConfidence;
      t.track_status = t.facts.trackStatus;
      t.revised = true;
      const reasons = [];
      if (!d.strong) reasons.push('要件③不成立：来源置信度 ' + t.facts.sourceConfidence.toFixed(2) + ' < 0.80');
      if (!d.stable) reasons.push('要件④不成立：轨迹状态为' + t.facts.trackStatus);
      factRevisions.push({ targetId: t.id, caseId: c.id, at: fmtDT(new Date(c.ts + ri(2, 9) * 86400000)), why: r.why, from, to: d.legal });
      evidenceGateLog.push({ targetId: t.id, at: fmtDT(new Date(c.ts + ri(2, 9) * 86400000)), from, to: d.legal, reasons });
    });
  })();

  /* ---- 违法目标去向口径 ----
     「当前判定非法」与「已立案」是两个时点的集合，不能直接相加：
     被事实修订降级的案件仍然是案件（立案是历史事实），但已不在「当前非法」之内。
     照 86 = 46 + 42 写会摆出一个算不平的等式，而它算不平的原因恰恰是复核机制在起作用。
     故在数据层就把三项分开，页面不必各自推导。 */
  const illegalDisposition = (function () {
    const ill = allTargets.filter(t => t.legal === '非法');
    const filedStillIllegal = ill.filter(t => cases.some(c => c.targetId === t.id));
    const pending = ill.filter(t => pendingSubjects.some(q => q.targetId === t.id));
    const downgraded = cases.filter(c => {
      const t = allTargets.find(x => x.id === c.targetId);
      return t && t.legal !== '非法';
    });
    return {
      illegalNow: ill.length,
      filed: filedStillIllegal.length,
      pending: pending.length,
      downgraded: downgraded.length,
      downgradedCases: downgraded.map(c => ({ id: c.id, status: c.status, targetId: c.targetId,
        filedAs: c.filingSnapshot.legal_status,
        nowIs: (allTargets.find(x => x.id === c.targetId) || {}).legal })),
      caseTotal: cases.length,
      // 结案率的分母写明白：只算已立案，不含待办案源
      closedRate: cases.length ? +(cases.filter(c => c.status === '已结案').length / cases.length * 100).toFixed(1) : 0
    };
  })();

  /* ---- 定性依据复核请求队列（设计 §11 案件复核流程）----
     证据门禁降级了某目标的判定，但若该目标已立案，判定页不得单方面改案件状态（尤其已结案）。
     改为产出复核请求，由处置处罚管理按案件复核流程处理。 */
  const reviewRequests = [];
  (function buildReviewRequests() {
    evidenceGateLog.forEach((g, i) => {
      const c = cases.find(x => x.targetId === g.targetId);
      if (!c) return;                       // 未立案的目标不需要复核
      reviewRequests.push({
        id: 'RR' + p3(reviewRequests.length + 1),
        at: g.at, targetId: g.targetId, caseId: c.id, caseStatus: c.status,
        from: g.from, to: '待确认',
        reason: g.reasons.join('；'),
        raisedBy: '规则引擎 · C01/C03 证据充分性门禁',
        trigger: (factRevisions.find(r => r.targetId === g.targetId) || {}).why || '数据层判定与证据门槛不一致',
        status: '待复核',
        note: c.status === '已结案'
          ? '案件已结案，需按 §11 案件复核流程办理，不得直接改状态'
          : '案件在办，可在处置处罚管理中同步复核定性依据'
      });
    });
  })();

  /* ---------------- 7. 接口清单（KPI 与列表同源） ---------------- */
  const IF_GROUPS = [
    ['上级管控平台接口', [
      ['飞行计划下发接口', '业务接口', 'GET', '/api/v1/flight/plan/list', 'AK/SK'],
      ['飞行计划上报接口', '业务接口', 'POST', '/api/v1/flight/plan/report', 'AK/SK'],
      ['指令下发接口', '业务接口', 'POST', '/api/v1/command/send', 'AK/SK'],
      ['处置信息同步接口', '业务接口', 'POST', '/api/v1/dispatch/sync', 'AK/SK'],
      ['目标态势上报接口', '业务接口', 'POST', '/api/v1/target/report', 'AK/SK']
    ]],
    ['融合感知箱接口', [
      ['雷达点迹订阅', '数据接口', 'TCP', 'tcp://box/radar/plot', 'Token'],
      ['雷达轨迹订阅', '数据接口', 'TCP', 'tcp://box/radar/track', 'Token'],
      ['光电目标识别结果', '数据接口', 'POST', '/api/v1/eo/detect/result', 'Token'],
      ['云台控制接口', '控制接口', 'POST', '/api/v1/ptz/control', 'Token'],
      ['云台状态查询', '查询接口', 'GET', '/api/v1/ptz/status', 'Token'],
      ['视频流地址接口', '数据接口', 'GET', '/api/v1/eo/stream', 'Token']
    ]],
    ['TDOA / AOA 接口', [
      ['TDOA目标定位推送', '数据接口', 'WS', 'ws://tdoa/target/push', 'Token'],
      ['遥控源定位接口', '数据接口', 'GET', '/api/v1/tdoa/remote', 'Token'],
      ['频谱状态查询', '查询接口', 'GET', '/api/v1/tdoa/spectrum', 'Token']
    ]],
    ['5G-A 通感接口', [
      ['5G-A目标航迹推送', '数据接口', 'WS', 'ws://5ga/track/push', 'AK/SK'],
      ['基站/小区信息查询', '查询接口', 'GET', '/api/v1/5ga/cell/query', 'AK/SK'],
      ['信号质量查询', '查询接口', 'GET', '/api/v1/5ga/quality', 'AK/SK']
    ]],
    ['反制与信号干扰接口', [
      ['反制任务下发接口', '控制接口', 'POST', '/api/v1/counter/task/send', 'AK/SK+授权码'],
      ['反制执行回执接口', '业务接口', 'POST', '/api/v1/counter/task/ack', 'AK/SK'],
      ['反制停止/急停接口', '控制接口', 'POST', '/api/v1/counter/task/stop', 'AK/SK+授权码'],
      ['公安干扰授权校验', '控制接口', 'POST', '/api/v1/jam/auth/verify', 'AK/SK+授权码'],
      ['公安干扰启停接口', '控制接口', 'POST', '/api/v1/jam/control', 'AK/SK+授权码'],
      ['干扰过程审计上报', '业务接口', 'POST', '/api/v1/jam/audit/report', 'AK/SK']
    ]],
    ['处罚系统接口', [
      ['违规行为上报接口', '业务接口', 'POST', '/api/v1/violation/report', 'AK/SK'],
      ['处罚结果回传接口', '业务接口', 'POST', '/api/v1/punish/result/callback', 'AK/SK'],
      ['处罚文书生成接口', '业务接口', 'POST', '/api/v1/punish/doc/generate', 'AK/SK']
    ]],
    ['合作方信息接口', [
      ['合作方信息录入接口', '业务接口', 'POST', '/api/v1/partner/info/submit', 'Token'],
      ['合作方信息查询接口', '查询接口', 'GET', '/api/v1/partner/info/query', 'Token'],
      ['无人机实名信息查询', '查询接口', 'GET', '/api/v1/partner/uas/query', 'Token']
    ]],
    ['地图 / 空域数据接口', [
      ['空域数据查询接口', '查询接口', 'GET', '/api/v1/airspace/query', 'AK/SK'],
      ['地图瓦片服务接口', '查询接口', 'GET', '/api/v1/map/tile', 'AK/SK'],
      ['地理编码接口', '查询接口', 'GET', '/api/v1/geocode', 'AK/SK']
    ]],
    ['第三方数据接口', [
      ['天气数据接口', '数据接口', 'GET', '/api/v1/weather/current', 'Token'],
      ['机场数据接口', '数据接口', 'GET', '/api/v1/airport/list', 'Token']   // 原图 liist 拼写已修正
    ]]
  ];
  const interfaces = [];
  (function buildIf() {
    IF_GROUPS.forEach(([g, list]) => list.forEach(([name, kind, method, url, auth], i) => {
      const rate = +(rnd() * 8 + 92).toFixed(2);
      const abn = rate < 95 && rnd() < .55;
      const calls = ri(120, 2600);
      interfaces.push({
        group: g, name, kind, method, url, auth,
        src: g.replace('接口', '').replace(/ /g, ''),
        status: abn ? '异常' : '正常',
        rate, calls, fail: Math.round(calls * (100 - rate) / 100),
        rt: ri(28, 320), last: fmtDT(new Date(CONF.demoTime.getTime() - ri(20, 3600) * 1000)),
        mock: rnd() < .45, ver: 'v1.' + ri(0, 4),
        owner: pick(['平台团队', '算法/硬件团队', '双方'])
      });
    }));
  })();
  const ifStats = (function () {
    const total = interfaces.length, ok = interfaces.filter(i => i.status === '正常').length;
    const calls = sum(interfaces, i => i.calls), fail = sum(interfaces, i => i.fail);
    return {
      total, ok, abn: total - ok, calls, fail,
      failRate: +(fail / calls * 100).toFixed(2),
      avgRt: Math.round(sum(interfaces, i => i.rt) / total),
      mocked: interfaces.filter(i => i.mock).length,
      dist: [
        { name: '成功率 ≥ 99%', value: interfaces.filter(i => i.rate >= 99).length, c: '#2fd06e' },
        { name: '95% ≤ 成功率 < 99%', value: interfaces.filter(i => i.rate >= 95 && i.rate < 99).length, c: '#3d8bff' },
        { name: '90% ≤ 成功率 < 95%', value: interfaces.filter(i => i.rate >= 90 && i.rate < 95).length, c: '#ffb020' },
        { name: '成功率 < 90%', value: interfaces.filter(i => i.rate < 90).length, c: '#ff4d5e' }
      ]
    };
  })();

  /* ---------------- 8. 设备调测记录 ---------------- */
  /* 调测验收阈值（表 9-x）。均为 Demo 缺省值【待确认：设备方】——
     登记进参数总览，页面读 M.COMM_TH，不要在页面另存一份。 */
  const COMM_TH = {
    latencyMs: 50, lossPct: 1, jitterMs: 20,
    note: '通信链路验收门限；单项超限即该项不合格，全部合格才判「成功」'
  };
  const commTasks = [];
  (function buildComm() {
    for (let i = 0; i < 128; i++) {
      const d = devices[(i * 7) % devices.length];
      const st = new Date(CONF.demoTime.getTime() - i * ri(18, 55) * 60000);
      const cost = ri(120, 560);
      /* ---- 调测**当次实测**指标 ----
         注意不能借用 dev.latency / dev.loss：那是设备**此刻**的运行指标，
         受当前负载与告警状态影响；而调测是几天前做的一次测量。
         拿今天的运行指标去判几天前那次测试的结论，是两个量的混用
         （实测：按 dev 指标推导，128 条里只有 41 条能与记录自洽）。
         链路质量取双峰：绝大多数是正常链路，少数存在真实链路问题
         （接线不良 / 配置错误 / 同频干扰），失败率由此自然产生，不直接设定。 */
      /* 三项各有自己的成因，不能由一个布尔量一起拉坏：
           时延 ← 路由跳数 / 链路负载
           丢包 ← 信噪比 / 接线质量
           抖动 ← 同频干扰 / 时钟源
         用一个共同的"链路质量差"因子抬高三者的概率，但每项**独立**判定是否超限，
         否则失败的调测永远是三项同时红，"哪一项不合格"就没有信息量了。 */
      const poorLink = rnd() < .10;                 // 共同因子：整体链路质量差
      const hitLat = rnd() < (poorLink ? .70 : .035);
      const hitLoss = rnd() < (poorLink ? .65 : .030);
      const hitJit = rnd() < (poorLink ? .60 : .045);
      const latencyMs = hitLat ? ri(55, 210) : ri(8, 44);
      const lossPct = +(hitLoss ? (rnd() * 12 + 1.2) : (rnd() * 0.85)).toFixed(2);
      const jitterMs = hitJit ? ri(22, 90) : ri(2, 18);
      const items = [
        { k: '时延', v: latencyMs, unit: 'ms', th: COMM_TH.latencyMs, ok: latencyMs <= COMM_TH.latencyMs },
        { k: '丢包率', v: lossPct, unit: '%', th: COMM_TH.lossPct, ok: lossPct <= COMM_TH.lossPct },
        { k: '抖动', v: jitterMs, unit: 'ms', th: COMM_TH.jitterMs, ok: jitterMs <= COMM_TH.jitterMs }
      ];
      commTasks.push({
        no: i + 1, dev: d, name: d.name, type: d.type,
        content: pick(['通信测试 + 接口测试', '通信测试 + 接口测试 + 校准联调', '通信测试 + 时钟同步', '接口测试 + 校准联调']),
        start: fmtDT(st), end: fmtDT(new Date(st.getTime() + cost * 1000)),
        cost: '00:' + p2(Math.floor(cost / 60)) + ':' + p2(cost % 60),
        latencyMs, lossPct, jitterMs, items,
        // 结论由本次实测值与阈值推导，不再独立抽取
        result: items.every(x => x.ok) ? '成功' : '失败',
        failedItems: items.filter(x => !x.ok).map(x => x.k),
        operator: pick(['管理员', '张工', '李工', '王工'])
      });
    }
  })();

  /* ---------------- 9. 日志归档 ---------------- */
  const LOG_TYPES = [['告警事件', 28], ['轨迹日志', 24], ['设备状态', 26], ['处置记录', 12], ['雷达检测', 6], ['巡航飞行', 4]];
  const logs = [];
  (function buildLogs() {
    const n = 2356;
    for (let i = 0; i < n; i++) {
      const type = pickW(LOG_TYPES);
      const t = new Date(CONF.demoTime.getTime() - i * ri(8, 32) * 1000);
      const tgt = allTargets[(i * 13) % allTargets.length];
      const dev = devices[(i * 11) % devices.length];
      logs.push({
        id: 'LG-2026' + p2(8) + p2(26) + '-' + p3(i + 1).padStart(5, '0'),
        type, target: type === '设备状态' ? '—' : tgt.id, device: dev.id,
        deviceName: dev.name, time: fmtDT(t), ts: t.getTime(),
        summary: type === '告警事件' ? `检测到${tgt.violation || '异常目标'}，目标高度${tgt.alt}m` :
          type === '轨迹日志' ? `目标轨迹持续跟踪，时长${ri(2, 20)}分${ri(1, 59)}秒` :
            type === '设备状态' ? `${dev.name}状态${dev.status === '在线' ? '恢复正常' : '异常上报'}` :
              type === '处置记录' ? `启动处置流程，派发至处置小组` :
                type === '雷达检测' ? `雷达检测到目标进入监测区域` : `例行巡航飞行任务完成`,
        status: i < 28 ? '待归档' : '已归档', abnormal: type === '告警事件' && rnd() < .45,
        size: (rnd() * 4 + .2).toFixed(2) + ' MB'
      });
    }
  })();
  const logStats = (function () {
    const byType = LOG_TYPES.map(([n]) => ({ name: n, value: logs.filter(l => l.type === n).length }));
    const todayN = logs.length;
    const target = logs.filter(l => ['轨迹日志', '雷达检测', '巡航飞行'].includes(l.type)).length;
    const dev = logs.filter(l => l.type === '设备状态').length;
    const disp = logs.filter(l => l.type === '处置记录').length;
    const abn = logs.filter(l => l.abnormal).length;
    const hist = 54536;               // 历史累计（今日之前）
    const total = hist + todayN;
    // 三大类按今日构成比例外推到累计口径，并保证 目标类 + 设备类 + 处置类 = 归档总数
    const k = total / todayN;
    const tgtN = Math.round(target * k), devN = Math.round(dev * k);
    const dispN = total - tgtN - devN;
    return {
      today: todayN, total, byType,
      target: tgtN, device: devN, disposal: dispN, abnormal: abn,
      trend: Array.from({ length: 7 }, (_, i) => {
        const day = dayAdd(CONF.demoTime, i - 6);
        const v = i === 6 ? todayN : Math.round(todayN * (0.72 + i * 0.045));
        return { date: fmtD(day).slice(5), total: v, abnormal: Math.round(v * (0.03 + rnd() * .015)) };
      })
    };
  })();

  /* ---------------- 10. 统计聚合（近30天，全部由 allTargets 派生） ---------------- */
  /* 统计口径：空中目标（不含地面遥控器），避免一架无人机因关联遥控源被计两次 */
  const stats = (function () {
    const uav = airborneTargets.filter(t => t.type === '无人机');
    const illegal = airborneTargets.filter(t => t.legal === '非法');
    const abnormal = airborneTargets.filter(t => t.legal === '异常');
    const days = [];
    for (let i = -29; i <= 0; i++) {
      const day = dayAdd(CONF.demoTime, i); const y = ymd(day);
      const g = airborneTargets.filter(t => t.ymd === y);
      days.push({
        date: fmtD(day), md: fmtD(day).slice(5),
        total: g.length,
        illegal: g.filter(t => t.legal === '非法').length,
        abnormal: g.filter(t => t.legal === '异常').length,
        punish: cases.filter(c => c.ymd === y).length,
        alarm: alarms.filter(a => a.ymd === y).length,
        highRisk: g.filter(t => ['高风险', '超高风险'].includes(t.risk)).length
      });
    }
    const regions = DISTRICTS.map(d => {
      const g = airborneTargets.filter(t => t.district === d.name);
      return {
        name: d.name, total: g.length,
        illegal: g.filter(t => t.legal === '非法').length,
        punish: cases.filter(c => c.district === d.name).length,
        highRisk: g.filter(t => ['高风险', '超高风险'].includes(t.risk)).length
      };
    }).sort((a, b) => b.total - a.total);
    const bucket = (arr, f, edges, labels) => labels.map((lb, i) => ({
      name: lb, value: arr.filter(x => { const v = f(x); return v >= edges[i] && (i === labels.length - 1 || v < edges[i + 1]); }).length
    }));
    return {
      total: airborneTargets.length, uav: uav.length,
      illegal: illegal.length, abnormal: abnormal.length,
      punish: cases.length, alarm: alarms.length,
      highRisk: airborneTargets.filter(t => ['高风险', '超高风险'].includes(t.risk)).length,
      avgDisposeSec: 9 * 60 + 42,
      days, regions,
      byType: T_TYPES.map(([n]) => ({ name: n, value: airborneTargets.filter(t => t.type === n).length })),
      byRisk: ['超高风险', '高风险', '中风险', '低风险'].map(n => ({ name: n, value: airborneTargets.filter(t => t.risk === n).length }))
        .concat([{ name: '未识别', value: airborneTargets.filter(t => !t.risk).length }]),
      byDuration: bucket(airborneTargets, t => t.durMin, [0, 10, 30, 60, 120], ['0-10', '10-30', '30-60', '60-120', '120以上']),
      byTrack: bucket(airborneTargets, t => t.trackKm, [0, 1, 5, 10, 20], ['0-1', '1-5', '5-10', '10-20', '20以上']),
      /* 高度分布：altitude（海拔高，必填）与 height_agl（距地高，协议选填）分开统计。
         两者基准不同，混成一个图会得出「120m 以下占比」这种没有意义的数字 ——
         空域限高既有 agl 也有 amsl 基准，比错基准就是判错。
         缺 height_agl 的目标单列「设备未上报」，不得用 alt 顶替，也不得从分母里悄悄拿掉。 */
      altBands: bucket(airborneTargets, t => t.alt, ALT_BANDS.edges, ALT_BANDS.labels),
      aglBands: bucket(airborneTargets.filter(t => t.heightAgl != null), t => t.heightAgl, AGL_BANDS.edges, AGL_BANDS.labels)
        .concat([{ name: '设备未上报', value: airborneTargets.filter(t => t.heightAgl == null).length, absent: true }]),
      altTotal: airborneTargets.length,
      byPenalty: ['警告', '罚款', '驱离'].map(n => ({ name: n, value: cases.filter(c => c.penalty === n).length })),
      byViolation: VIOLATIONS.map(v => ({ name: v, value: cases.filter(c => c.violation === v).length })).sort((a, b) => b.value - a.value),
      partners: PARTNERS.slice(0, 5)
    };
  })();

  /* ---- 感知质量统计（运维 / 算法验收口径，区别于业务统计）----
     弥合占比就是雷达丢点率的直接度量，也是 A03 轨迹弥合的验收基线：
     算法方交付正式实现时，拿什么和 Demo 比？就是这组数。
     设计 §6.8 规定弥合段不得等同实测位置参与合法性判定，所以"这条轨迹有多少是弥合的"
     本身就是判定证据强度的一部分。 */
  const senseQuality = (function () {
    const withTrack = liveTargets.filter(t => t.track && t.track.length);
    const pts = withTrack.flatMap(t => t.track);
    const kindOf = p => p.kind || 'meas';
    const KINDS = [
      { key: 'meas', name: '实测', algo: null, color: '#2fd06e', why: '设备直接上报的点迹' },
      { key: 'bridge', name: '弥合', algo: 'A03 轨迹弥合', color: '#ff8b3d', why: '断裂区间由算法补出，非实测位置' },
      { key: 'pred', name: '预测', algo: 'A04 轨迹预测', color: '#22d3ee', why: '外推的未来位置，尚未发生' }
    ];
    const byKind = KINDS.map(k => ({
      name: k.name, key: k.key, algo: k.algo, color: k.color, why: k.why,
      value: pts.filter(p => kindOf(p) === k.key).length
    }));
    // 单条轨迹粒度：弥合占比高的排前面，值班员一眼看到哪条轨迹最不可信
    const perTrack = withTrack.map(t => {
      const n = t.track.length;
      const c = KINDS.map(k => t.track.filter(p => kindOf(p) === k.key).length);
      return {
        id: t.id, type: t.type, source: t.source, trackStatus: t.track_status,
        total: n, meas: c[0], bridge: c[1], pred: c[2],
        bridgeRate: +(c[1] / n * 100).toFixed(1),
        measRate: +(c[0] / n * 100).toFixed(1),
        srcCount: Object.keys(t.fused || {}).filter(k => t.fused[k].on).length,
        sources: Object.keys(t.fused || {}).filter(k => t.fused[k].on),
        durMin: t.durMin,
        // 断裂次数 = 弥合段的连续段数（每一段连续 bridge 点对应一次断裂），
        // 由轨迹本身推出而不是另存一个计数 —— 另存就会和轨迹漂移
        lostCount: t.track.reduce((n, p, i) =>
          n + ((p.kind === 'bridge') && (i === 0 || t.track[i - 1].kind !== 'bridge') ? 1 : 0), 0)
      };
    }).sort((a, b) => b.bridgeRate - a.bridgeRate);
    // 来源构成：每一路参与了多少条轨迹（一条轨迹可由多路贡献，故合计 > 轨迹数）
    const srcNames = [...new Set(withTrack.flatMap(t => Object.keys(t.fused || {})))];
    const bySource = srcNames.map(n => ({
      name: n, value: withTrack.filter(t => t.fused && t.fused[n] && t.fused[n].on).length
    })).sort((a, b) => b.value - a.value);
    // 断续率：按点计 —— 非实测点占比就是轨迹的不连续程度
    const totalMin = perTrack.reduce((a, t) => a + t.durMin, 0);
    const lostTotal = perTrack.reduce((a, t) => a + t.lostCount, 0);
    return {
      trackCount: withTrack.length, pointCount: pts.length, byKind, perTrack, bySource,
      byStatus: TRACK_STATUS.map(n => ({ name: n, value: withTrack.filter(t => t.track_status === n).length })),
      bridgeRate: +(byKind[1].value / pts.length * 100).toFixed(1),
      measRate: +(byKind[0].value / pts.length * 100).toFixed(1),
      discontRate: totalMin ? +(lostTotal / totalMin * 60).toFixed(2) : 0,   // 次/小时
      totalMin, lostTotal,
      avgSrcPerTrack: +(perTrack.reduce((a, t) => a + t.srcCount, 0) / (withTrack.length || 1)).toFixed(2)
    };
  })();

  const todayStats = (function () {
    const y = ymd(CONF.demoTime);
    const g = todayTargets.filter(t => t.type !== '遥控器');   // 空中目标口径
    const ta = todayAlarms;
    return {
      total: g.length, uav: g.filter(t => t.type === '无人机').length,
      linkedRc: todayTargets.filter(t => t.type === '遥控器').length,   // A6：关联遥控源，单列不计入空中目标
      illegal: g.filter(t => t.legal === '非法').length,
      abnormal: g.filter(t => t.legal === '异常').length,
      pending: g.filter(t => t.legal === '待确认').length,
      legal: g.filter(t => t.legal === '合法').length,
      alarm: ta.length,
      alarmHigh: ta.filter(a => a.level === '高').length,
      disposed: ta.filter(a => a.status === '已关闭').length,
      disposing: ta.filter(a => a.status === '处置中').length,
      pendingAlarm: ta.filter(a => a.status === '新建').length,
      cases: cases.filter(c => c.ymd === y).length,
      regions: DISTRICTS.length,
      alarmTrend: Array.from({ length: 7 }, (_, i) => {
        const day = dayAdd(CONF.demoTime, i - 6); const yy = ymd(day);
        const a = alarms.filter(x => x.ymd === yy);
        return { date: fmtD(day).slice(5), total: a.length, high: a.filter(x => x.level === '高').length };
      }),
      disposeResult: (function () {
        const w = alarms.filter(a => a.ts > CONF.demoTime.getTime() - 7 * 864e5);
        return [
          { name: '已关闭', value: w.filter(a => a.status === '已关闭').length, c: '#2fd06e' },
          { name: '正在处置', value: w.filter(a => a.status === '处置中').length, c: '#ff8b3d' },
          { name: '误报', value: w.filter(a => a.status === '误报').length, c: '#3d8bff' },
          { name: '新建/待处理', value: w.filter(a => ['新建', '已确认'].includes(a.status)).length, c: '#8ca0be' }
        ];
      })()
    };
  })();

  /* ---------------- 11. 空间安全风险（非无人机目标线） ---------------- */
  const riskTargets = airborneTargets.filter(t => t.type !== '无人机');   // 空中异物，不含地面遥控器
  /* ---- F0703:受保护对象(机场/净空/重点设施/航线走廊),半径可配置 ---- */
  /* protectZones（受保护对象/保护区配置）已整体删除。
     用户裁定：「通报保护对象删掉，保护区配置删掉，**保护的不是对象，
     只是看航线周围有没有危险，不涉及保护**」。
     风险判定因此从「离受保护对象多近」改为「离已批准航线多近、高度是否重叠、时段内是否在飞」。
     机场不另造概念：机场核心区本来就登记在 airspaces 里的禁飞空域，
     鸟群闯入照样出风险，**依据是空域，不是"保护对象"**。
     （riskEvents 上仍保留 airport/distKm，那是「最近机场」这个独立事实，
       NC1 塔台通报要用；它与已删除的保护对象概念无关。） */

  const AIRPORTS = [
    { name: '东营胜利机场', lon: 118.788, lat: 37.216, level: '4C 民用运输机场' },
    { name: '东营通用航空机场', lon: 118.512, lat: 37.712, level: '通用航空机场' }
  ];
  /* 方位角：由设备指向目标，正北为 0°、顺时针 —— AOA 唯一能给的量 */
  function bearing(from, to) {
    const rad = Math.PI / 180;
    const dLon = (to.lon - from.lon) * rad, y = Math.sin(dLon) * Math.cos(to.lat * rad);
    const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad)
      - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLon);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }
  function distKm(a, b) {
    const dx = (a.lon - b.lon) * 88.5, dy = (a.lat - b.lat) * 111;
    return Math.sqrt(dx * dx + dy * dy);
  }
  /* ---- 风险事件状态机（用户新工作流）----
     旧状态只有 待核验 / 处置中 / 已处置，表达不了"核验之后要不要通报上级"这条主线。
     新流转两条路径：
       待核验 --核验通过--> 待通知 --通知上级--> 已通知 --归档--> 已归档
       待核验 --排除------> 已排除 --归档--> 已归档
     「已排除」是核验后判定不构成风险（如误检、非管控目标），它同样要能归档，
     否则误检事件会永远挂在待核验里，看起来像积压。 */
  const RISK_STATUS = ['待核验', '待通知', '已通知', '已排除', '处置中', '已处置', '已归档'];
  const RISK_FLOW = {
    '待核验': [{ to: '待通知', act: '核验通过' }, { to: '已排除', act: '排除（误检/非管控目标）' }],
    '待通知': [{ to: '已通知', act: '通知上级' }],
    '已通知': [{ to: '处置中', act: '转处置' }, { to: '已归档', act: '归档' }],
    '处置中': [{ to: '已处置', act: '处置完成' }],
    '已处置': [{ to: '已归档', act: '归档' }],
    '已排除': [{ to: '已归档', act: '归档' }],
    '已归档': []
  };
  const riskNext = st => (RISK_FLOW[st] || []).slice();

  /* ---- 风险等级：按「最近的**受保护对象**」及其内外圈配置判定（F0703）----
     此前数据层按「距最近**机场**」定 8/18 km 硬编码，而 F0703 已把它推广成
     5 类受保护对象（机场跑道/净空区/重点设施/航线走廊）+ 可配置内外圈半径，
     README §三·七 明确「保存后按新阈值重算全部风险事件的等级与最近保护对象」。
     两处各算一遍的结果是：`level` 有两个定义，后跑的那个赢。
     这里把判定收成一个函数，页面改配置后调同一个函数重算，不再自己实现一遍。

     `airport` / `distKm` 保留为「最近机场」这一独立事实 —— NC1 塔台通报要用它，
     不能被"最近保护对象"覆盖（保护对象可能是油库或航道走廊，没有塔台）。 */
  /* ---- 风险判定：三因子（距离 / 高度 / 时间）----
     参数经用户确认；**高度余量 50 m 是 Demo 缺省，文档没给，故标待确认，不要替它编出处**。 */
  const RISK_RULE = {
    nearKm: 2,          // 距最近航线中心线 <2km：贴近航线
    adjKm: 5,           // 2~5km：邻近（提示）；>5km：仅记录
    altMarginM: 50,     // 高度带上下余量【待确认：业务方】—— 文档未给定
    windowDays: 7,      // 近 7 天该航线有计划/在飞才计入时间因子
    ver: 'RISK-route-v1'
  };

  /* 航线批准高度带。routes[].altDatum 目前全为 'agl'，
     所以要拿事件的**距地高**去比，不能拿海拔高 —— 两者不是一个基准。
     基准不符或事件没有该基准的高度时，返回 null 表示**不可判定**，
     绝不能默默当成"不重叠"（那就是把不知道读成了合规）。 */
  function routeAltBand(r) {
    const alts = (r.waypoints || []).map(w => w.alt).filter(v => v != null);
    if (!alts.length) return null;
    return {
      datum: r.altDatum,
      lo: Math.min(...alts) - RISK_RULE.altMarginM,
      hi: Math.max(Math.max(...alts), r.maxAltM || 0) + RISK_RULE.altMarginM
    };
  }
  function altOverlapWith(r, e) {
    const band = routeAltBand(r);
    if (!band) return null;
    const h = band.datum === 'agl' ? e.heightAgl : e.alt;
    if (h == null) return null;                       // 该事件没有这个基准的高度 → 不可判定
    return h >= band.lo && h <= band.hi;
  }
  /* 时间因子：近 N 天该航线是否有计划/在飞。
     用 plansOf 取该航线的计划，看时间窗是否落在近 N 天内。 */
  function routeInWindow(r, nowTs) {
    const from = (nowTs != null ? nowTs : CONF.demoTime.getTime())
      - (RISK_RULE.windowDays - 1) * 86400000;
    return plansOf(r.id).some(pl => {
      const st = new Date(pl.start).getTime();
      return !isNaN(st) && st >= from && pl.status !== '已取消';
    });
  }
  /* 最近航线：只看**生效中**的航线 —— 草稿和已停用的航线不构成"周围有没有危险"的参照。 */
  function nearestRouteOf(pt) {
    const live = routes.filter(r => r.status === '生效中' && (r.waypoints || []).length > 1);
    if (!live.length) return null;
    let best = null;
    live.forEach(r => {
      const km = distToPolylineM(pt, r.waypoints) / 1000;
      if (!best || km < best.km) best = { route: r, km: +km.toFixed(2) };
    });
    return best;
  }
  /* 等级由三因子合成。组合规则本身是 Demo 假设【待确认：业务方】，
     与 C03 权重同性质：**参数是用户批的，组合方式不是**，所以写明版本号备查。
       >5km                      → 低（仅记录），其余因子不再影响
       2~5km  高度重叠且在时间窗  → 中；否则 低
       <2km   高度重叠且在时间窗  → 高
              高度不可判定        → 中，并声明不可判定（不得读作"不重叠"）
              其余                → 中 */
  function riskLevelOf(e) {
    const nr = nearestRouteOf(e);
    if (!nr) return { route: null, km: null, level: '低', altOverlap: null, inWindow: false, undet: ['最近航线'] };
    const ov = altOverlapWith(nr.route, e);
    const win = routeInWindow(nr.route, e.ts);
    const undet = ov == null ? ['高度重叠'] : [];
    let level;
    if (nr.km > RISK_RULE.adjKm) level = '低';
    else if (nr.km > RISK_RULE.nearKm) level = (ov === true && win) ? '中' : '低';
    else level = (ov === true && win) ? '高' : '中';
    return { route: nr.route, km: nr.km, level, altOverlap: ov, inWindow: win, undet };
  }
  /* 处置建议随**距离与时间**变，不再谈"保护对象管理单位"（那个概念已删除）。
     仍不写"通知 XX 单位"：航线的 unit 字段有，但事件该通报谁仍是业务问题。 */
  function riskAdvice(r) {
    if (r.level === '高') return '航线' + (r.route ? '「' + r.route.name + '」' : '') + '近期有飞行且高度重叠，立即通报航线运营单位并持续观察';
    if (r.level === '中') return r.km != null && r.km <= RISK_RULE.nearKm
      ? '贴近航线，通报航线运营单位并持续观察'
      : '邻近航线，提示并持续观察';
    return '记录归档，人工核验';
  }
  /* 供页面保存配置后调用：重算全部事件。页面不要自己再实现一遍。 */
  function recalcRiskLevels() {
    riskEvents.forEach(e => {
      const r = riskLevelOf(e);
      applyRiskDerived(e, r);
    });
    return riskEvents;
  }
  /* 派生字段一处写入，避免生成与重算两条路径写出不同结构 */
  function applyRiskDerived(e, r) {
    e.nearestRouteId = r.route ? r.route.id : null;
    e.nearestRouteName = r.route ? r.route.name : null;
    e.nearestRouteKm = r.km;
    e.altOverlap = r.altOverlap;
    e.inWindow = r.inWindow;
    e.level = r.level;
    e.advice = riskAdvice(r);
    e.undeterminable = r.undet;
    return e;
  }

  const riskEvents = riskTargets.filter(t => t.ymd >= ymd(dayAdd(CONF.demoTime, -6))).map((t, i) => {
    const ap = AIRPORTS.reduce((m, a) => distKm(t, a) < distKm(t, m) ? a : m, AIRPORTS[0]);
    const dk = +distKm(t, ap).toFixed(1);
    /* 状态分布要按等级来分，所以先算一次等级；
       随后 applyRiskDerived 会把同一份判定结果正式写进事件，两者同源不会分叉。 */
    const lvl0 = riskLevelOf(t).level;
    return applyRiskDerived({
      id: 'SR' + t.date.replace(/-/g, '') + p3(i + 1), targetId: t.id, type: t.type, subtype: t.subtype,
      typeSource: t.typeSource, subtypeSource: t.subtypeSource, subtypeConf: t.subtypeConf,
      lon: t.lon, lat: t.lat,          // F0703:保护区距离重算需要坐标
      count: t.type === '鸟' ? (t.subtype === '鸟群' ? ri(6, 120) : 1) : 1,
      district: t.district, alt: t.alt, speed: t.speed, time: t.time, ts: t.ts, date: t.date, ymd: t.ymd,
      airport: ap.name, distKm: dk,                     // 最近机场（独立事实，NC1 塔台通报用）
      heightAgl: t.heightAgl,   // 与航线高度带比对要用距地高（routes.altDatum='agl'），不能用海拔
      trend: pick(['靠近机场', '远离机场', '区域盘旋', '平飞穿越']),
      /* level / advice / nearestRoute* / altOverlap / inWindow 由 applyRiskDerived 统一写入，
         不在这里各写一份 —— 那正是 level 曾经出现两个定义的来源。 */
      /* 状态按新流转分布；高等级事件更可能已推进到通报/处置，低等级更可能被排除或仍待核验 */
      status: lvl0 === '高'
        ? pickW([['已处置', 34], ['处置中', 18], ['已通知', 20], ['待通知', 10], ['已归档', 12], ['待核验', 6]])
        : lvl0 === '中'
          ? pickW([['已处置', 22], ['已通知', 22], ['待通知', 14], ['已归档', 18], ['待核验', 14], ['已排除', 10]])
          : pickW([['已归档', 26], ['已排除', 24], ['待核验', 22], ['已通知', 14], ['已处置', 14]])
    }, riskLevelOf(t));
  }).sort((a, b) => b.ts - a.ts);

  /* ---- 两个方向的查询（页面直接调，不在页面里算几何）----
     几何用的是同一套点到折线距离，只是问法反过来。 */
  function routeHazards(routeId, days) {
    const r = routeById(routeId);
    if (!r || !(r.waypoints || []).length) return [];
    const d = days || RISK_RULE.windowDays;
    const from = CONF.demoTime.getTime() - (d - 1) * 86400000;
    return riskEvents
      .filter(e => e.ts >= from)
      .map(e => ({ event: e, km: +(distToPolylineM(e, r.waypoints) / 1000).toFixed(2) }))
      .filter(x => x.km <= RISK_RULE.adjKm)
      .sort((a, b) => a.km - b.km);
  }
  function routesNear(eventId) {
    const e = riskEvents.find(x => x.id === eventId);
    if (!e) return [];
    return routes
      .filter(r => r.status === '生效中' && (r.waypoints || []).length > 1)
      .map(r => ({
        route: r,
        km: +(distToPolylineM(e, r.waypoints) / 1000).toFixed(2),
        altOverlap: altOverlapWith(r, e),
        inWindow: routeInWindow(r, e.ts)
      }))
      .filter(x => x.km <= RISK_RULE.adjKm)
      .sort((a, b) => a.km - b.km);
  }

  /* ---- 通报记录（M.riskNotices）----
     此前通报记录**根本没有数据层集合**，是页面在运行期造的：刷新即丢、也进不了证据台账。
     「通知上级」与反制处置的上级同步走同一个接口 POST /api/v1/dispatch/sync，
     记录结构须一致 —— 两处各做一份，最终会有两种格式的同步记录进同一个证据台账。 */
  const NOTICE_CHANNELS = [
    { key: 'NC1', name: '机场塔台专线', ackType: '人工回执' },
    { key: 'NC2', name: '上级管控平台接口', ackType: '接口回执' },
    { key: 'NC3', name: '电话/传真通报单', ackType: '人工回执' }
  ];
  /* 回执做成状态机而不是一个词：`ack:'已回执'` 回答不了"失败了怎么办"。 */
  const ACK_STATUS = ['待回执', '已回执', '回执超时', '发送失败'];
  /* 通报收件人由**渠道 + 事件**共同决定，收进数据层做成唯一来源。
     此前页面只能从 protectZones 的名字里拼（还要去掉尾部「跑道」，否则会拼出
     「东营胜利机场跑道塔台」，与存量记录不是同一个字符串 —— 同一个收件人被算成两个）。
     其实 riskEvents[].airport 已经是准确的机场名，不必绕道保护对象。 */
  function noticeTargetFor(channelKey, ev) {
    if (channelKey === 'NC1') return (ev && ev.airport ? ev.airport : '机场') + '塔台';
    if (channelKey === 'NC2') return '上级管控平台';
    return '东营市低空安全管理中心';
  }
  const riskNotices = [];
  (function buildNotices() {
    let n = 0;
    riskEvents.filter(e => ['已通知', '处置中', '已处置', '已归档'].indexOf(e.status) >= 0).forEach(e => {
      n++;
      // 高等级必须直通塔台；其余按渠道可用性挑。通报对象由**渠道**决定，
      // 原写法按等级另算一次 to，会出现"走塔台专线、却发给管理中心"这种自相矛盾的记录。
      const ch = e.level === '高' ? NOTICE_CHANNELS[0] : pick(NOTICE_CHANNELS);
      const at = new Date(e.ts + ri(4, 45) * 60000);
      const ack = pickW([['已回执', 78], ['待回执', 10], ['回执超时', 8], ['发送失败', 4]]);
      riskNotices.push({
        id: 'RN' + ymd(at) + p3(n),
        /* 泛化为「上级同步记录」：风险通报与反制处置后的上级同步共用这一份。
           另建第二份会得到两种格式的同步记录进同一个证据台账（与空域/航线
           共用一套 ruleVersions 是同一条理由）。 */
        srcModule: '空间安全风险',
        action: '风险事件通知上级',
        // refs 与证据台账同构：一条同步记录可能同时关联目标/案件/授权记录
        refs: [{ kind: 'riskEvent', id: e.id }, { kind: 'target', id: e.targetId }],
        eventId: e.id, targetId: e.targetId,     // 兼容字段，消费方迁到 refs 后可删
        retry: 0,
        at: fmtDT(at),
        channel: ch.key, channelName: ch.name,
        to: noticeTargetFor(ch.key, e),
        content: `${e.district} 发现${e.subtype || e.type}${e.count > 1 ? '（约 ' + e.count + ' 只/个）' : ''}，`
          + `距${e.airport} ${e.distKm} km，风险等级${e.level}；建议：${e.advice}`,
        operator: pick(['张伟', '李强', '王磊', '郑凯']),
        ackStatus: ack,
        ackAt: ack === '已回执' ? fmtDT(new Date(at.getTime() + ri(2, 40) * 60000)) : null,
        ackBy: ack === '已回执' ? pick(['塔台值班员', '上级值班席']) : null,
        ackNote: ack === '回执超时' ? '超出约定回执时限，已转电话催办'
          : ack === '发送失败' ? '接口返回错误，已改用电话通报' : '',
        api: 'POST /api/v1/dispatch/sync',
        evidenceId: null            // 归档后回填对应证据文件
      });
    });
  })();
  /* 从 refs 查，兼容旧的 eventId 字段；消费方迁完后 eventId 可删而这里不用改 */
  const noticesOf = id => riskNotices.filter(x =>
    (x.refs || []).some(r => r.id === id) || x.eventId === id);
  const syncOf = (kind, id) => riskNotices.filter(x => (x.refs || []).some(r => r.kind === kind && r.id === id));

  /* ---- 上级同步记录的唯一写入口 ----
     两处共用：融合感知中心「反制处置后向上级同步」、空间安全风险「事件通知上级」。
     时间与操作者在内部取，页面不传 —— 页面传就会出现第二个时间源/身份源。
     此前风险页在运行期自己拼 id 和渠道，那样两处各拼一份 id 规则，迟早漂。 */
  function pushDispatchSync(o) {
    o = o || {};
    const ch = NOTICE_CHANNELS.find(c => c.key === (o.channel || 'NC2')) || NOTICE_CHANNELS[1];
    const evRef = (o.refs || []).find(r => r.kind === 'riskEvent');
    const ev = evRef ? riskEvents.find(e => e.id === evRef.id) : null;
    const at = now();
    const n = riskNotices.length + 1;
    const rec = {
      id: 'RN' + ymd(at) + p3(n),
      srcModule: o.srcModule || '未标注模块',
      action: o.action || '上级同步',
      refs: (o.refs || []).slice(),
      eventId: evRef ? evRef.id : null,
      targetId: ((o.refs || []).find(r => r.kind === 'target') || {}).id || null,
      at: fmtDT(at),
      channel: ch.key, channelName: ch.name,
      to: noticeTargetFor(ch.key, ev),
      content: o.content || '',
      operator: ((users.find(u => u.id === _currentUserId)) || {}).name || '未知',
      /* 回执是状态机不是一个词：`ack:'已回执'` 回答不了"失败了怎么办"。
         新记录一律从「待回执」起，页面不得伪造回执。 */
      ackStatus: '待回执', ackAt: null, ackBy: null, ackNote: '',
      retry: 0,
      api: 'POST /api/v1/dispatch/sync',
      evidenceId: null                       // 归档后回填
    };
    riskNotices.push(rec);
    pushAudit(rec.srcModule, `${rec.action}（${ch.name} → ${rec.to}）`, rec.id);
    return rec;
  }
  /* 回执与重试：失败可重试并计次，而不是停在一个"已回执"的字样上 */
  function ackDispatchSync(id, status, by, note) {
    const r = riskNotices.find(x => x.id === id);
    if (!r) return { ok: false, reason: '同步记录不存在' };
    if (ACK_STATUS.indexOf(status) < 0) return { ok: false, reason: '回执状态不在枚举内' };
    r.ackStatus = status;
    r.ackAt = status === '已回执' ? nowStr() : null;
    r.ackBy = status === '已回执' ? (by || '上级值班席') : null;
    if (note) r.ackNote = note;
    if (status === '发送失败' || status === '回执超时') r.retry = (r.retry || 0) + 1;
    pushAudit(r.srcModule, `同步回执更新：${status}${r.retry ? '（第 ' + r.retry + ' 次重试）' : ''}`, r.id);
    return { ok: true, record: r };
  }

  /* ---------------- 11.5 用户 / 角色 / 操作审计 ----------------
     纪要 D2「权限审计」与 §6.3「授权人员/全过程审计」的支撑数据。
     反制与信号干扰授权仅「处置授权人」及以上角色可执行。 */
  const ROLES = [
    { id: 'R1', name: '超级管理员', desc: '全部功能与系统配置', users: 0, level: 5 },
    { id: 'R2', name: '处置授权人', desc: '反制/干扰授权、案件审批', users: 0, level: 4 },
    { id: 'R3', name: '值班员', desc: '态势监视、告警核实与派发', users: 0, level: 3 },
    { id: 'R4', name: '设备运维', desc: '设备接入、调测与监测', users: 0, level: 2 },
    { id: 'R5', name: '审计员', desc: '只读 + 审计日志导出', users: 0, level: 1 }
  ];
  const users = [];
  (function buildUsers() {
    const defs = [
      ['admin', '系统管理员', 'R1', '东营市低空安全管理中心'],
      ['zhangjg', '张建国', 'R2', '东营市公安局'],
      ['liguoq', '李国强', 'R2', '东营市公安局特警支队'],
      ['wangzh', '王振华', 'R2', '东营市低空安全管理中心'],
      ['zhangwei', '张伟', 'R3', '东营市低空安全管理中心'],
      ['liqiang', '李强', 'R3', '东营市低空安全管理中心'],
      ['wanglei', '王磊', 'R3', '东营区公安分局'],
      ['zhaopeng', '赵鹏', 'R4', '东营市低空安全管理中心'],
      ['suntao', '孙涛', 'R4', '设备厂商A（驻场）'],
      ['zhoumin', '周敏', 'R4', '设备厂商F（驻场）'],
      ['wugang', '吴刚', 'R5', '东营市审计局'],
      ['zhengkai', '郑凯', 'R3', '广饶县公安局']
    ];
    defs.forEach(([acc, name, role, org], i) => {
      const online = i < 4 || i === 4;
      const last = new Date(CONF.demoTime.getTime() - (online ? ri(1, 40) : ri(60, 2880)) * 60000);
      users.push({
        id: 'U' + p3(i + 1), account: acc, name, role,
        roleName: ROLES.find(r => r.id === role).name, org,
        phone: '13' + ri(0, 9) + '****' + ri(1000, 9999),
        /* 停用账号这个演示样本原来落在 i===10（吴刚），而他是**唯一的审计员**——
           结果 R5 这一行权限永远演示不到：没有可登录的审计员账号，
           "审计员只能看不能发"这条规则就无法在界面上被验证。
           改落在 i===9（周敏，R4 设备运维，另有 2 个在用账号），
           两个演示样本都保住：既有停用账号，每个角色也都有可用账号。 */
        status: i === 9 ? '已停用' : '正常',
        online: i !== 9 && online,
        lastLogin: fmtDT(last), lastIp: '10.20.' + ri(1, 30) + '.' + ri(2, 250),
        createdAt: '2026-0' + ri(3, 7) + '-' + p2(ri(1, 28)),
        mfa: i < 4 ? '已开启' : '未开启'
      });
      ROLES.find(r => r.id === role).users++;
    });
  })();

  /* 权限矩阵:模块 × 角色(READ/OP/AUTH/—) */
  const PERM_MODULES = [
    '综合态势总览', '融合感知中心', '统计分析', '飞行活动管理', '合法性判定',
    '空域与航线', '异常告警中心', '空间安全风险', '处置处罚管理', '反制/干扰授权',
    '设备管理', '设备接入调测', '设备实时监测', '接口管理', '日志归档', '用户与权限'
  ];
  const PERM = {
    R1: PERM_MODULES.map(() => 'AUTH'),
    R2: PERM_MODULES.map(m => ['反制/干扰授权', '处置处罚管理'].includes(m) ? 'AUTH' : (m === '用户与权限' ? '—' : 'OP')),
    R3: PERM_MODULES.map(m => ['反制/干扰授权', '用户与权限', '接口管理'].includes(m) ? '—' : (['异常告警中心', '融合感知中心', '空间安全风险'].includes(m) ? 'OP' : 'READ')),
    R4: PERM_MODULES.map(m => ['设备管理', '设备接入调测', '设备实时监测', '接口管理'].includes(m) ? 'OP' : (['反制/干扰授权', '用户与权限', '处置处罚管理'].includes(m) ? '—' : 'READ')),
    R5: PERM_MODULES.map(m => ['反制/干扰授权', '用户与权限'].includes(m) ? '—' : 'READ')
  };

  /* 操作审计:从授权/案件/调测记录确定性派生 + 登录事件 */
  /* ================= 当前登录用户与权限判定 =================
     此前全站 grep currentUser 命中 0：有 R1~R5 权限矩阵，却没有"当前是谁"。
     于是页面要么把角色写成本地常量（第二份真值），要么把权限判定写成声明式文案。
     这里给出唯一来源：当前用户 + 基于既有 PERM 矩阵的判定函数。
     页面**不要自己解 PERM 矩阵** —— 解矩阵的逻辑一旦有第二份，改权限模型时必然漏改一处。 */
  const PERM_LEVELS = { '—': 0, 'READ': 1, 'OP': 2, 'AUTH': 3 };
  const PERM_ACTIONS = { read: 1, op: 2, auth: 3 };   // 查看 / 操作 / 授权
  let _currentUserId = 'U001';                        // 默认超级管理员，便于演示全量功能

  /* 某角色对某模块的权限档位 */
  function permLevel(roleId, moduleName) {
    const mi = PERM_MODULES.indexOf(moduleName);
    if (mi < 0) return '—';
    const row = PERM[roleId];
    return row ? (row[mi] || '—') : '—';
  }
  /* 当前用户能否对某模块执行某动作。action: 'read' | 'op' | 'auth' */
  function can(moduleName, action) {
    const u = users.find(x => x.id === _currentUserId);
    if (!u) return false;
    if (u.status !== '正常') return false;            // 停用账号不具备任何操作权限
    const need = PERM_ACTIONS[action || 'read'] || 1;
    return PERM_LEVELS[permLevel(u.role, moduleName)] >= need;
  }
  /* 切换当前用户（演示不同角色看到的差异）。传角色 ID 则取该角色下第一个正常账号。 */
  function switchUser(idOrRole) {
    const u = users.find(x => x.id === idOrRole || x.account === idOrRole)
      || users.find(x => x.role === idOrRole && x.status === '正常');
    if (!u) return null;
    _currentUserId = u.id;
    return u;
  }

  const auditLogs = [];
  (function buildAudit() {
    let n = 0;
    authLogs.slice(0, 12).forEach(a => {
      auditLogs.push({ id: 'AU' + p3(++n), time: a.start, user: a.operator, role: '处置授权人', module: '处置处罚管理', action: a.type + '下发', target: a.targetId, result: '成功', ip: '10.20.5.' + (10 + n), term: '终端-' + p2(n % 9 + 1) });
      auditLogs.push({ id: 'AU' + p3(++n), time: a.end, user: a.operator, role: '处置授权人', module: '处置处罚管理', action: a.type + '结束(' + a.result + ')', target: a.targetId, result: '成功', ip: '10.20.5.' + (10 + n), term: '终端-' + p2(n % 9 + 1) });
    });
    commTasks.slice(0, 8).forEach(t => {
      auditLogs.push({ id: 'AU' + p3(++n), time: t.start, user: t.operator, role: '设备运维', module: '设备接入调测', action: t.content, target: t.dev.id, result: t.result === '成功' ? '成功' : '失败', ip: '10.20.8.' + (20 + n), term: '终端-' + p2(n % 9 + 1) });
    });
    users.slice(0, 8).forEach((u, i) => {
      auditLogs.push({ id: 'AU' + p3(++n), time: u.lastLogin, user: u.name, role: u.roleName, module: '系统登录', action: '账号登录' + (u.mfa === '已开启' ? '（MFA）' : ''), target: u.account, result: i === 6 ? '失败(密码错误)' : '成功', ip: u.lastIp, term: '终端-' + p2(i + 1) });
    });
    auditLogs.sort((a, b) => (a.time < b.time ? 1 : -1));
  })();

  /* ---------------- 12. 一致性自检（回应"页面数字互相矛盾"问题） ---------------- */
  /* ================= COM-04 证据文件台账 =================
     证据是法律凭据，它的问题和统计数字不同：统计错了是看错，证据错了是凭据没了。
     所以这里守三条：
       ① 件数不得是独立随机数 —— cases[].evidence 原来是 ri(2,6)，一个凭空的件数；
          案件详情说 6 项、台账里查出 3 个文件，两个数还各自"自洽"。改为由台账派生。
       ② 关联是多对多 —— 一段光电录像同时是案件取证、告警佐证、授权执行记录。
          文件上挂单个 caseId 就反查不出「这段录像被哪几个案件引用」。
       ③ 校验状态不得永远绿 —— 留真实的哈希不一致/文件缺失样本，并挂在真案件上。
          挂在孤立文件上等于没演示：评审要看的是"证据出问题时案件怎么办"。 */
  const EVIDENCE_KINDS = ['光电录像', '光电抓拍图', '雷达轨迹快照', '通报单回执', '调测报告', '处罚文书', '指令报文与回执', '现场照片'];
  const EVIDENCE_VERIFY = ['完好', '哈希不一致', '文件缺失', '待校验'];
  const EVIDENCE_STATUS = ['在库', '临近到期', '已到期待清理', '已销毁'];
  const EVID_PARAMS = { retainYears: 5, verifyCycleDays: 1, holdWhileOpen: true, storageDual: true };
  /* ---- 留存期按证据类型分级 ----
     此前是「统一 5 年」。它与「演示数据全在 30 天窗口内」互斥：
     窗口内的证据永远不会到期，于是为了造出「已到期/已销毁」样本，
     只能把案件证据的取证时刻往前拨 5 年 —— 结果是取证时间早于案发 4.9~5.2 年。
     前两次修复都只是把这个矛盾从 retainUntil 搬到 capturedAt，再搬回来：
     **根因是约束冲突，不是某个字段写错了。**
     分级之后，天然会到期的是设备侧调测记录（保存期短、且本来就产生于建设期），
     案件证据不必再被回拨。年限均为 Demo 缺省值【待确认：业务方】。 */
  const EVID_RETAIN = {
    '调测报告': { days: 90, why: '设备建设期记录，非案件证据' },
    '现场照片': { years: 1, why: '辅助取证材料' },
    '光电录像': { years: 3, why: '影像取证材料' },
    '光电抓拍图': { years: 3, why: '影像取证材料' },
    '通报单回执': { years: 5, why: '对外通报凭据' },
    '指令报文与回执': { years: 5, why: '处置过程审计' },
    '雷达轨迹快照': { years: 5, why: '定性依据，与案卷同期' },
    '处罚文书': { years: 5, why: '法律文书，与案卷同期' }
  };
  /* ---- 取证时刻与案发时刻的方向约束 ----
     两类方向相反，一刀切会让一半误报：
       during 事件取证：录像/抓拍/轨迹快照产生于事件进行中，**不可能晚于事件结束**
       after  事后材料：现场照片、文书、回执、指令报文都产生于事件之后，**不得早于案发**
       none   与案件无时间约束（设备调测记录） */
  const EVID_TIME_REL = {
    '光电录像': 'during', '光电抓拍图': 'during', '雷达轨迹快照': 'during',
    '现场照片': 'after', '处罚文书': 'after', '通报单回执': 'after', '指令报文与回执': 'after',
    '调测报告': 'none'
  };
  const retainOf = kind => {
    const r = EVID_RETAIN[kind] || { years: EVID_PARAMS.retainYears };
    return r.days ? { days: r.days, label: r.days + ' 天' } : { years: r.years, label: r.years + ' 年' };
  };
  const evidenceFiles = [];
  (function buildEvidence() {
    /* “轨迹快照”是供办案人员查看与下载的可视化证据，使用 PNG。
       原始轨迹点/雷达报文才应使用 JSON，二者不能共用同一个文件类型名称。 */
    const EXT = { '光电录像': 'mp4', '光电抓拍图': 'jpg', '雷达轨迹快照': 'png', '通报单回执': 'pdf',
      '调测报告': 'pdf', '处罚文书': 'pdf', '指令报文与回执': 'log', '现场照片': 'jpg' };
    const SZ = { mp4: [45, 320], jpg: [0.8, 4.2], png: [0.6, 3.8], pdf: [0.3, 2.6], log: [0.01, 0.2] };
    const hex = n => Array.from({ length: n }, () => '0123456789abcdef'[ri(0, 15)]).join('');
    let seq = 0;
    /* originAction：这份归档记录**是怎么来的**（产生动作），与 srcKind/srcName（谁产生的）互补。
       此前详情里只有「来源：设备 · 东营区光电01号」，回答不了"这份东西怎么产生的"。
       正式接口到位后此字段由产生方写入。 */
    function add(kind, at, src, refs, dev, originAction) {
      seq++;
      const ext = EXT[kind], r = SZ[ext];
      /* 取证时刻不得晚于当前时刻 —— 处罚文书按「案件日 + 2~9 天」推算会越过今天，
         于是台账里出现了 11 份"下周才取的证"。证据是已经发生的事，不能有未来时刻。 */
      /* 只有落在未来的取证时刻才需要往回拉；已经在过去的时刻必须原样保留。
         原写法是 `Math.min(at, demoTime - ri(60,3600)秒)` —— 那个随机下界会把
         本来合法的过去时刻也一起拽早，实测把一份指令报文拽到了它自己案件之前 23 秒。
         "防未来时刻"的兜底不该有副作用于过去时刻。 */
      const NOW_MS = CONF.demoTime.getTime();
      /* 往回拉的兜底还有第二个副作用，这次是对 **after 类**的：
         案件刚发生（ts 接近当前时刻）时，「案发 + 若干分钟」会越过今天，
         于是被拉回到 `NOW - 60~3600秒` —— 而这个落点可能**早于案件本身**，
         凭空造出"现场照片拍在案发之前"。实测漏出 6 份。

         正确的模型不是把时刻揉到某个能过检的位置，而是承认：
         **刚发生的案子，它的事后材料还不存在。**所以这里直接不生成，
         由 `cases[].evidence` 从台账反算，件数自然少一件，不必另外圆场。 */
      const _isAfter = EVID_TIME_REL[kind] === 'after';
      if (at > NOW_MS && _isAfter) return null;      // 事后材料尚未产生，如实缺席
      const d = new Date(at > NOW_MS ? NOW_MS - ri(60, 3600) * 1000 : at);
      const rt = retainOf(kind);
      const retainUntil = new Date(d.getTime());
      if (rt.days) retainUntil.setDate(retainUntil.getDate() + rt.days);
      else retainUntil.setFullYear(d.getFullYear() + rt.years);
      const f = {
        id: 'EV' + ymd(d) + p3(seq),
        name: kind + '_' + (refs[0] ? refs[0].id : 'SYS') + '_' + ymd(d) + '-' + fmtT(d).replace(/:/g, '').slice(0, 4) + '.' + ext,
        kind, ext, sizeMB: +(r[0] + rnd() * (r[1] - r[0])).toFixed(2),
        srcKind: dev ? 'device' : (src === '系统·反制授权引擎' ? 'system' : 'page'),
        srcId: dev ? dev.id : src, srcName: dev ? dev.name : src,
        srcModule: src,                       // 产生该记录的业务模块
        originAction: originAction || '',     // 产生动作（一句话说明怎么来的）
        capturedAt: fmtDT(d),
        // 取证时刻与入库时刻分开：差值本身就是链路时延的证据
        ingestAt: fmtDT(new Date(d.getTime() + ri(8, 180) * 1000)),
        refs: refs.slice(),
        hashAlgo: 'SHA-256', hash: hex(12) + '…' + hex(6),
        verifyAt: fmtDT(new Date(CONF.demoTime.getTime() - ri(1, 20) * 3600000)),
        verifyState: '完好', verifyNote: '',
        retainYears: rt.years != null ? rt.years : null,
        retainDays: rt.days != null ? rt.days : null,
        retainLabel: rt.label, retainWhy: (EVID_RETAIN[kind] || {}).why || '',
        retainUntil: fmtD(retainUntil),
        legalHold: false, status: '在库',
        storage: rnd() < .82 ? '主存储 + 异地备份' : '仅主存储',
        accessCount: ri(0, 14), lastAccessAt: fmtDT(new Date(CONF.demoTime.getTime() - ri(1, 400) * 60000))
      };
      evidenceFiles.push(f);
      return f;
    }
    /* 案件取证材料：件数沿用原分布，但从此以后 cases[].evidence 由台账反算 */
    cases.forEach(c => {
      const n = ri(2, 6);
      const pool = ['光电录像', '光电抓拍图', '雷达轨迹快照', '现场照片'];
      for (let i = 0; i < n; i++) {
        const kind = i === 0 ? '光电录像' : pick(pool);
        const dev = devices.filter(d => d.deviceTypeAbbr === (kind.indexOf('光电') === 0 ? 'oe' : 'radar'))[seq % 40] || null;
        /* 措辞必须与时间事实一致：这些材料在**告警触发后 1~15 分钟**由设备现场取证，
           而 cases[].time 是**告警触发时刻**、不是立案时刻（立案是 steps[2]，多数还在后面）。
           原措辞「立案时自动归集」字面意思是"证据此前已存在、立案那一刻收拢进来"，
           与取证时刻晚于该时刻这一事实直接冲突，而这句话就显示在取证时刻旁边。 */
        add(kind, c.ts + ri(60, 900) * 1000, '处置处罚管理',
          [{ kind: 'case', id: c.id }, { kind: 'target', id: c.targetId }], dev,
          `告警触发后${dev ? '由' + dev.name : '由现场'}取证，随案件 ${c.id} 归入案卷`);
      }
      // 已结案的另有处罚文书
      /* 处罚文书与「现场照片」不同：**案件已结案这件事本身就意味着文书已经做出来了**，
         所以它不能像其它事后材料那样"尚未产生"，只能是日期落点不对。
         原式 `c.ts + 2~9 天` 对近期案件会越过今天（实测 26 件），
         被上面的兜底当成未来材料跳过，于是"已结案 106 件、文书 80 份"。
         正确做法是把落点约束在 [案发, 当前] 这个区间内，而不是让它缺席。 */
      if (c.status === '已结案') add('处罚文书',
        Math.max(c.ts + 60000, Math.min(c.ts + ri(2, 9) * 86400000, CONF.demoTime.getTime() - 60000)),
        '处置处罚管理', [{ kind: 'case', id: c.id }], null,
        `案件 ${c.id} 结案时制作处罚文书并归档（案发后 ${Math.round((c.ts + 0) ? 0 : 0)}）`.replace('（案发后 0）', ''));
    });
    /* 反制/干扰授权：指令报文与回执 */
    /* 取证时刻取授权指令的下发时刻 `a.start`。
       原来写的是 `a.time` —— authLogs 上**没有这个字段**（只有 start / end），
       于是 `undefined || CONF.demoTime` 静默兜底成演示基准时刻，
       导致所有指令报文都盖上同一个时间戳，其中一份还早于它自己的案件 23 秒。
       这类「读错字段名 + || 兜底」不报错、也不为空，只是值全错。 */
    authLogs.forEach(a => add('指令报文与回执', new Date(String(a.start).replace(' ', 'T')).getTime(), '系统·反制授权引擎',
      [{ kind: 'authLog', id: a.id }, { kind: 'case', id: a.caseId }, { kind: 'target', id: a.targetId }],
      devices.find(d => d.name === a.device) || null,
      `${a.type}授权 ${a.id} 下发时自动留存指令报文与设备回执（审批人 ${a.approver} / 操作人 ${a.operator}）`));
    /* 调测任务：报告文件 —— 界面上提到过报告，此前并不存在 */
    commTasks.slice(0, 40).forEach(t => add('调测报告', new Date(t.end).getTime(), '设备接入调测',
      [{ kind: 'commTask', id: 'CT' + p3(t.no) }, { kind: 'device', id: t.dev.id }], t.dev,
      `调测任务 CT${p3(t.no)} 完成后自动生成报告（结论 ${t.result}${t.failedItems.length ? '：' + t.failedItems.join('/') + '不合格' : ''}）`));
    /* 高等级告警：光电抓拍图 */
    alarms.filter(a => a.level === '高').slice(0, 30).forEach(a => {
      const dev = devices.filter(d => d.deviceTypeAbbr === 'oe')[seq % 50] || null;
      add('光电抓拍图', a.ts + ri(5, 60) * 1000, '异常告警中心',
        [{ kind: 'alarm', id: a.id }, { kind: 'target', id: a.targetId }], dev,
        `告警 ${a.id}（${a.type}）触发时由光电设备自动抓拍取证`);
    });
    /* 通报单回执：机场塔台人工闭环（NC3 渠道） */
    riskEvents.slice(0, 12).forEach(e => add('通报单回执', e.ts + ri(10, 40) * 60000, '空间安全风险',
      [{ kind: 'riskEvent', id: e.id }, { kind: 'target', id: e.targetId }], null,
      `风险事件 ${e.id} 通报上级后回执归档（NC3 渠道人工闭环）`));

    /* ---- 补两类此前完全不进台账的归档记录 ----
       (1) 融合感知中心截图取证：最常产生证据的地方，此前只 push 一行处置日志 + toast
           「截图已加入证据链」，实际不写 evidenceFiles —— 又一次"声称记录了但没记"。
       (2) 空间安全风险事件归档：新工作流要求归档进证据存储，此前不产生任何证据文件。
       两类都必须在数据层产生，页面动作再接上去；反过来做会得到"看得见、刷新就没"的证据。 */
    authLogs.slice(0, 18).forEach((a, i) => {
      const dev = devices.filter(d => d.deviceTypeAbbr === 'oe')[(seq + i) % 50] || null;
      add('光电抓拍图', new Date(String(a.start).replace(' ', 'T')).getTime() + ri(20, 200) * 1000,
        '融合感知中心',
        [{ kind: 'authLog', id: a.id }, { kind: 'case', id: a.caseId }, { kind: 'target', id: a.targetId }], dev,
        `${a.type}执行中由值班员在光电视频窗口手动截帧存证（授权 ${a.id}）`);
    });
    riskEvents.slice(0, 16).forEach((e, i) => {
      add('雷达轨迹快照', e.ts + ri(30, 120) * 60000, '空间安全风险',
        [{ kind: 'riskEvent', id: e.id }, { kind: 'target', id: e.targetId }], null,
        `风险事件 ${e.id}（${e.type || '异物'}）处置完成后归档，随事件留存轨迹快照`);
    });

    /* ---- 故意不全绿的样本，且必须挂在真案件上 ---- */
    const caseFiles = evidenceFiles.filter(f => f.refs.some(r => r.kind === 'case'));
    const badHash = [caseFiles[3], caseFiles[17], caseFiles[41]].filter(Boolean);
    badHash.forEach((f, i) => {
      f.verifyState = '哈希不一致';
      f.verifyNote = `${fmtDT(new Date(CONF.demoTime.getTime() - (i + 1) * 26 * 3600000))} 日常校验发现哈希与入库值不符。`
        + '已按《证据保管办法》锁定原件、从异地备份取回副本比对，副本哈希与入库值一致，'
        + '判为主存储介质坏块。已提交运维更换并复核，本文件在结论前不得作为定案依据。责任人：王振华（运维）';
    });
    const missing = caseFiles[9];
    if (missing) {
      missing.verifyState = '文件缺失';
      missing.verifyNote = fmtDT(new Date(CONF.demoTime.getTime() - 62 * 3600000))
        + ' 校验发现主存储路径下文件不存在，异地备份亦无。经查为 8 月初存储扩容期间迁移遗漏。'
        + '已启动补充取证：调取该时段雷达原始点迹与相邻光电设备录像替代。责任人：李国强（法制）';
    }
    const pending = caseFiles[25];
    if (pending) { pending.verifyState = '待校验'; pending.verifyNote = ''; }

    /* 留存期与冻结：已到期待清理 / 已销毁 / 因案件未结案而冻结 */
    const openCaseIds = new Set(cases.filter(c => c.status !== '已结案').map(c => c.id));
    evidenceFiles.forEach(f => {
      const caseRef = f.refs.find(r => r.kind === 'case');
      // 关联案件未结案 → 冻结，不得清理（合规底线）
      if (caseRef && openCaseIds.has(caseRef.id)) f.legalHold = true;
    });
    /* ---- 到期 / 销毁样本：来自**真正老的**证据，不再回拨案件证据的取证时刻 ----
       此前为了造到期样本，把案件证据的取证时刻往前拨 5 年（ageTo），
       结果是「取证时间早于案发 4.9~5.2 年」。前两次修复只是在 retainUntil 与
       capturedAt 之间搬运这个矛盾 —— 根因是「统一 5 年留存 + 数据全在 30 天窗口」
       这两条约束互斥，窗口内的证据永远不会到期。

       分级留存之后不需要造假了：设备调测记录保存 90 天，且**本来就产生于建设期**
       （设备 installed 在 2024–2025 年），它天然是到期的，也不与任何案件时间冲突。 */
    devices.slice(0, 14).forEach((dev, i) => {
      const inst = new Date(String(dev.installed).replace(/-/g, '/') + ' 09:00:00');
      // 建设期初始调测：取证时刻取设备安装日，天然早于 30 天窗口，且不关联案件
      const at = inst.getTime() + ri(1, 6) * 3600000;
      add('调测报告', at, '设备接入调测', [{ kind: 'device', id: dev.id }], dev,
        `设备 ${dev.name} 建设期初始调测完成后自动生成报告（安装 ${dev.installed}）`);
    });
    // 另造几份「刚过期 / 临近到期」的调测记录，用于演示清理与预警两条路径
    devices.slice(14, 20).forEach((dev, i) => {
      const daysAgo = i < 3 ? ri(95, 140) : ri(62, 85);   // 90 天留存：前者已过期、后者临近
      add('调测报告', dayAdd(CONF.demoTime, -daysAgo).getTime() + ri(1, 8) * 3600000,
        '设备接入调测', [{ kind: 'device', id: dev.id }], dev,
        `设备 ${dev.name} 例行复测完成后自动生成报告`);
    });

    /* 状态由日期推导，不再独立赋值 ——
       此前 status 是单独设的，可以出现「未到期却标已到期」而三个字段各自自洽。 */
    const NOW = CONF.demoTime.getTime();
    const NEAR_DAYS = 30;
    evidenceFiles.forEach(f => {
      const until = new Date(String(f.retainUntil).replace(/-/g, '/') + ' 23:59:59').getTime();
      const leftDays = Math.floor((until - NOW) / 86400000);
      f.retainLeftDays = leftDays;
      if (f.legalHold && leftDays < 0) {
        f.status = '在库';
        f.holdReason = '关联案件未结案，依《证据保管办法》冻结，到期不清理';
      } else if (leftDays < 0) f.status = '已到期待清理';
      else if (leftDays <= NEAR_DAYS) f.status = '临近到期';
      else f.status = '在库';
    });
    // 已销毁样本：从"已到期待清理且未冻结"里挑一份，销毁时刻必须晚于到期日
    const destroyable = evidenceFiles.filter(f => f.status === '已到期待清理' && !f.legalHold);
    if (destroyable.length) {
      const f = destroyable[0];
      const until = new Date(String(f.retainUntil).replace(/-/g, '/') + ' 23:59:59').getTime();
      f.status = '已销毁';
      f.destroyAt = fmtDT(new Date(Math.min(NOW - ri(1, 20) * 86400000, until + ri(1, 15) * 86400000)));
      f.destroyBy = '王振华（运维）'; f.destroyApproval = 'DEL-2026-0117';
      f.destroyNote = '留存期届满、关联案件已结案且无复核请求，经法制审批后销毁。元数据与销毁记录永久保留。';
    }

    /* cases[].evidence 改为由台账派生 —— 不再是独立随机数 */
    cases.forEach(c => { c.evidence = evidenceFiles.filter(f => f.refs.some(r => r.kind === 'case' && r.id === c.id)).length; });
  })();
  const evidenceOf = (kind, id) => evidenceFiles.filter(f => f.refs.some(r => r.kind === kind && r.id === id));
  function evidenceRefs(fileId) {
    const f = evidenceFiles.find(x => x.id === fileId);
    if (!f) return [];
    const NAME = {
      case: id => (cases.find(c => c.id === id) || {}).violation,
      alarm: id => (alarms.find(a => a.id === id) || {}).type,
      target: id => { const t = allTargets.find(x => x.id === id); return t ? t.type + ' · ' + t.legal : null; },
      authLog: id => (authLogs.find(a => a.id === id) || {}).type,
      riskEvent: id => (riskEvents.find(e => e.id === id) || {}).type,
      device: id => (devices.find(d => d.id === id) || {}).name,
      commTask: () => '设备调测任务'
    };
    const LABEL = { case: '处罚案件', alarm: '告警', target: '感知目标', authLog: '反制/干扰授权',
      riskEvent: '空间安全风险事件', device: '设备', commTask: '调测任务' };
    return f.refs.map(r => ({ kind: r.kind, label: LABEL[r.kind] || r.kind, id: r.id,
      name: (NAME[r.kind] ? NAME[r.kind](r.id) : null) || '—',
      exists: !!(NAME[r.kind] && NAME[r.kind](r.id)) || r.kind === 'commTask' }));
  }

  function selfCheck() {
    const c = [];
    const add = (n, ok, exp, got) => c.push({ name: n, ok, exp, got });
    add('设备台账：总数 = 在线 + 离线 + 异常',
      deviceStats.total === deviceStats.online + deviceStats.offline + deviceStats.abnormal,
      deviceStats.total, deviceStats.online + deviceStats.offline + deviceStats.abnormal);
    add('设备三路合计 = 设备总数',
      sum(deviceStats.byChannel, x => x.total) === deviceStats.total,
      deviceStats.total, sum(deviceStats.byChannel, x => x.total));
    add('统计分析：区域分布合计 = 近30天目标总数',
      sum(stats.regions, r => r.total) === stats.total, stats.total, sum(stats.regions, r => r.total));
    add('统计分析：日趋势累加 = 近30天目标总数',
      sum(stats.days, d => d.total) === stats.total, stats.total, sum(stats.days, d => d.total));
    add('统计分析：日趋势非法累加 = 非法目标数',
      sum(stats.days, d => d.illegal) === stats.illegal, stats.illegal, sum(stats.days, d => d.illegal));
    add('统计分析：目标类型占比合计 = 空中目标总数（不含地面遥控器）',
      sum(stats.byType, t => t.value) === stats.total, stats.total, sum(stats.byType, t => t.value));
    add('统计分析：区域处罚合计 = 处罚案件总数',
      sum(stats.regions, r => r.punish) === stats.punish, stats.punish, sum(stats.regions, r => r.punish));
    // 注：已立案案件是历史事实，不因后续重新判定或证据门禁而消失，故不与「当前非法目标数」比较，
    //     改为校验每个案件都能追溯到立案时的非法判定快照（见下方断言）。
    add('处罚：处罚方式分布合计 = 案件总数',
      sum(stats.byPenalty, p => p.value) === cases.length, cases.length, sum(stats.byPenalty, p => p.value));
    add('处罚：案件全部可追溯到非法目标',
      cases.every(x => allTargets.some(t => t.id === x.targetId)), '100%',
      Math.round(cases.filter(x => allTargets.some(t => t.id === x.targetId)).length / cases.length * 100) + '%');
    add('告警：全部可追溯到感知目标',
      alarms.every(a => allTargets.some(t => t.id === a.targetId)), '100%', '100%');
    add('首页今日指标 = 今日空中目标明细条数（遥控器单列）',
      todayStats.total === todayTargets.filter(t => t.type !== '遥控器').length,
      todayTargets.filter(t => t.type !== '遥控器').length, todayStats.total);
    add('接口管理：KPI 总数 = 接口清单条数',
      ifStats.total === interfaces.length, interfaces.length, ifStats.total);
    add('接口管理：正常 + 异常 = 接口总数',
      ifStats.ok + ifStats.abn === ifStats.total, ifStats.total, ifStats.ok + ifStats.abn);
    add('日志归档：类型分布合计 = 今日日志条数',
      sum(logStats.byType, t => t.value) === logStats.today, logStats.today, sum(logStats.byType, t => t.value));
    add('日志归档：目标类 + 设备类 + 处置类 = 归档总数',
      logStats.target + logStats.device + logStats.disposal === logStats.total,
      logStats.total, logStats.target + logStats.device + logStats.disposal);
    add('日志归档：趋势末点 = 今日新增',
      logStats.trend[6].total === logStats.today, logStats.today, logStats.trend[6].total);
    add('空域：全部坐标位于东营行政范围内',
      airspaces.every(a => a.center.lon > CONF.bounds.lon0 && a.center.lon < CONF.bounds.lon1 &&
        a.center.lat > CONF.bounds.lat0 && a.center.lat < CONF.bounds.lat1), '东营', '东营');
    add('目标类型均在协议 objectType 八值枚举内',
      allTargets.every(t => OBJECT_TYPES.some(o => o.code === t.objectType && o.name === t.type)),
      '8 值枚举', [...new Set(allTargets.map(t => t.objectType))].sort((a, b) => a - b).join('/'));
    add('风筝/气球/孔明灯仅作算法推断 subtype，不作设备上报类型',
      !allTargets.some(t => ['风筝', '气球', '孔明灯'].includes(t.type)) &&
      allTargets.filter(t => ['风筝', '气球', '孔明灯'].includes(t.subtype)).every(t => t.subtypeSource === 'ai'),
      '0 个作为 target_type', allTargets.filter(t => ['风筝', '气球', '孔明灯'].includes(t.type)).length + ' 个');
    (function () {
      // AOA 目标的经纬度与高度按协议即为无效，不计入「必填」—— 把协议规定的不可得当成缺陷，
      // 只会逼着后来的人去填一个编造的值。
      const posed = allTargets.filter(t => t.posValid !== false);
      const aoa = allTargets.length - posed.length;
      add('高度分层：altitude 必填（AOA 目标除外）、height_agl 可缺（协议 height 为选填）',
        posed.every(t => typeof t.alt === 'number') && posed.some(t => t.heightAgl === null)
          && allTargets.filter(t => t.posValid === false).every(t => t.alt === null),
        'altitude 100%（AOA 除外）/ height_agl 部分缺失',
        'altitude ' + posed.length + '/' + posed.length + ' · AOA 无高度 ' + aoa + ' 个 / height_agl 缺 '
          + Math.round(posed.filter(t => t.heightAgl === null).length / posed.length * 100) + '%');
    })();
    add('空域限高均声明基准（agl 真高 / amsl 海拔高，不允许留空）',
      airspaces.every(a => a.limit === 0 || ['agl', 'amsl'].includes(a.limitDatum)),
      '100% 已声明',
      airspaces.filter(a => a.limit > 0 && !['agl', 'amsl'].includes(a.limitDatum)).length + ' 条未声明');
    add('遥控器为独立目标且不计入空中目标统计',
      allTargets.some(t => t.type === '遥控器') && !airborneTargets.some(t => t.type === '遥控器'),
      '独立建模 + 不计入', allTargets.filter(t => t.type === '遥控器').length + ' 个独立遥控器');
    (function () {
      /* 断言不得因字段缺失而抛异常：抛出会让整个 selfCheck 中断，
         结果是「一条断言没写稳」变成「全部断言都不显示」—— 比失败更糟。
         缺字段本身就是要报的问题，按失败报，不按崩溃报。 */
      const rcs = allTargets.filter(t => t.type === '遥控器');
      const noRec = rcs.filter(t => !t.linkedUavId || !t.rcDedup);
      const posed = rcs.filter(t => t.rcDedup && t.posValid !== false);
      const aoa = rcs.filter(t => t.rcDedup && t.posValid === false);
      add('遥控器双路径去重：有位置的记录时空判据，AOA 无位置则如实标为不可去重',
        noRec.length === 0
        && posed.every(t => typeof t.rcDedup.distM === 'number')
        && aoa.every(t => t.rcDedup.distM === null && t.rcDedup.merged === false),
        `有位置 ${posed.length} 个记判据 / AOA ${aoa.length} 个标不可去重`,
        noRec.length ? `${noRec.length} 个遥控器缺关联或去重记录：${noRec[0].id}`
          : `有位置 ${posed.filter(t => typeof t.rcDedup.distM === 'number').length} 个记判据 / AOA `
            + `${aoa.filter(t => t.rcDedup.distM === null).length} 个标不可去重`);
    })();
    add('B02：合并/分裂均保留 ID 变更历史与判定快照（证据链可回溯）',
      idLineage.length > 0 && idLineage.every(l => l.snapshots && l.snapshots.length > 0 && l.basis && l.algo),
      '≥1 条且均有快照', idLineage.length + ' 条');
    add('B02：引用已合并 target_id 的案件仍可还原当时判定依据',
      cases.filter(c => c.idLineage).every(c => c.idLineage.snapshot && c.idLineage.snapshot.legal_status),
      '100% 可还原', cases.filter(c => c.idLineage).length + ' 件命中且均可还原');
    /* ---- A5:Target Schema V1 一致性 ---- */
    add('A5：每个目标均带 Target Schema V1 必填字段（AOA 目标以方位角替代经纬高，协议 v8.6）',
      allTargets.every(t => t.target_id && t.source_target_ids && t.device_ids &&
        t.event_time && t.receive_time && t.update_time &&
        (t.posValid === false
          ? (t.longitude === null && t.latitude === null && t.altitude === null && typeof t.azimuth === 'number')
          : (typeof t.longitude === 'number' && typeof t.latitude === 'number' && typeof t.altitude === 'number')) &&
        t.coordinate_system &&
        t.target_type && typeof t.object_type === 'number' &&
        t.source_type && typeof t.device_type === 'number' &&
        typeof t.source_confidence === 'number' &&
        Array.isArray(t.violation_reasons)),
      '100%', '100%');
    (function () {
      // exp/got 原来两侧都写死同一句话 —— 显示上永远"期望=实际"，看的人无从判断它查了什么
      const notArr = allTargets.filter(t => !Array.isArray(t.violation_reasons));
      const emptyIll = allTargets.filter(t => t.legal === '非法' && t.violation_reasons.length === 0);
      add('A5：violation_reasons 为数组，且非法目标必有事由',
        notArr.length === 0 && emptyIll.length === 0,
        `${allTargets.length} 个均为数组 · 非法 ${allTargets.filter(t => t.legal === '非法').length} 个均非空`,
        notArr.length ? `${notArr.length} 个非数组：${notArr[0].id}`
          : emptyIll.length ? `${emptyIll.length} 个非法目标事由为空：${emptyIll[0].id}`
            : `${allTargets.length} 个均为数组 · 非法 ${allTargets.filter(t => t.legal === '非法').length} 个均非空`);
    })();
    add('A5：uav_sn 仅来自协议破解/RemoteID（雷达光电给不了身份）',
      allTargets.filter(t => t.uav_sn).every(t => t.pilotPosition && ['协议破解', 'RemoteID'].includes(t.pilotPosition.device)),
      '100% 来自 dcd/rid', allTargets.filter(t => t.uav_sn).length + ' 个均合规');
    /* 原断言：「仅雷达/5G-A 提供」。T02 闭集读法证明雷达不提供，5G-A 无资料，
       且该字段在 Target Schema V1 中尚未定义（apis.js 接口台账）——
       故现在无来源提供，且**每个 null 都必须带得出理由**。 */
    add('A5：分类置信度当前无来源提供，且缺失原因必须逐条可说明',
      allTargets.every(t => t.classification_confidence == null && !!t.clsConfWhy),
      '1314 个均为 null 且带缺失原因',
      allTargets.filter(t => t.classification_confidence != null || !t.clsConfWhy).length + ' 个有值或说不出缺失原因');
    /* 原「classification_confidence 仅雷达/5G-A 提供」的断言已删除：
       该字段现在全量为 null，filter 之后集合为空，而 [].every() 恒为 true ——
       **它已经变成一条不可能失败的断言**，留着只会让人以为这里还有把守。
       替代它的是上面那条"全为 null 且每个 null 都说得出理由"。 */
    add('A5：track_status 为轨迹生命周期，与处置状态分属两个体系',
      allTargets.every(t => ['稳定', '暂定', '短时丢失', '终止', '分裂', '合并'].includes(t.track_status)),
      '轨迹生命周期枚举', [...new Set(allTargets.map(t => t.track_status))].join('/'));
    /* ---- 三个并行会话建议收的断言 ---- */
    (function () {
      const bad = allTargets.filter(t => t.type === '无人机').filter(t => {
        if (!t.facts) return true;
        const notCovered = t.facts.inNoFlyZone || t.facts.planMatch === '未命中' || t.facts.overZoneHeight || t.facts.overZoneTime;
        const strong = t.source_confidence >= 0.80, stable = t.facts.trackStatus === '稳定';
        if (t.legal === '合法') return t.violation_reasons.length !== 0;
        if (t.legal === '非法') return !(notCovered && strong && stable);
        // 待确认有两种成因：有违规但证据不足 / 无违规但轨迹不足以确认全程合规
        if (t.legal === '待确认') return !(t.violation_reasons.length > 0 || !strong || !stable);
        return t.violation_reasons.length === 0;      // 异常必须有违规项
      });
      add('判定结论均可由客观事实推导（不得独立赋值）', bad.length === 0,
        '100% 可推导',
        bad.length ? `${bad.length} 个无法推导：${bad.slice(0, 3).map(t => t.id + '(' + t.legal + ')').join('、')}` : '100% 可推导');
    })();
    add('风险事件类型均在协议目标类型枚举内',
      riskEvents.every(r => T_TYPES.some(x => x[0] === r.type)),
      T_TYPES.map(x => x[0]).join('/'), [...new Set(riskEvents.map(r => r.type))].join('/'));
    /* ---- 风险判定（航线口径 RISK-route-v1）----
       口径已由「离受保护对象多近」改为「离已批准航线多近 + 高度是否重叠 + 时段内是否在飞」。
       旧的那组断言（取最严保护对象 / 保护对象类型决定通报）**已整体删除**，
       不是让它们继续绿 —— 判据换了，旧断言即使全绿也证明不了新规则对。

       几何这一端**独立实现一遍**点到线段距离，不调 distToPolylineM：
       两端同源的话，几何写错了断言不会红（这条教训来自雷达量程那次）。 */
    {
      /* 用**标准的每度长度公式**（随纬度变），而不是另抄一个平面常数：
         生成侧用的是固定 111.32 km/°（M_PER_DEG_LAT），在本纬度偏大约 0.25%，
         两个近似天然会差 0.5% 上下 —— 3.5 km 上十几米、30 km 上 200 米。
         所以这条断言卡的是**判定结果**（挂哪条航线、落哪个距离档），
         数值只用比例容差兜底，不去比第三位小数：
         比第三位小数只会把两种近似的正常差异当成缺陷，而真正会出事的是档位判错。 */
      const segKm = (p, a, b) => {
        const phi = (p.lat * Math.PI) / 180;
        const ky = (111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)) / 1000;
        const kx = (111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)) / 1000;
        const apx = (p.lon - a.lon) * kx, apy = (p.lat - a.lat) * ky;
        const abx = (b.lon - a.lon) * kx, aby = (b.lat - a.lat) * ky;
        const ab2 = abx * abx + aby * aby;
        let u = ab2 ? (apx * abx + apy * aby) / ab2 : 0;
        u = Math.max(0, Math.min(1, u));
        const dx = apx - abx * u, dy = apy - aby * u;
        return Math.sqrt(dx * dx + dy * dy);
      };
      const polyKm = (p, wps) => {
        let best = Infinity;
        for (let i = 0; i + 1 < wps.length; i++) {
          const d = segKm(p, wps[i], wps[i + 1]);
          if (d < best) best = d;
        }
        return best;
      };
      const live = routes.filter(r => r.status === '生效中' && (r.waypoints || []).length > 1);

      // ① 最近航线必须真的是最近的那条，且只在生效中的航线里取
      const bandOf = km => km == null ? 'none'
        : km > RISK_RULE.adjKm ? 'far' : km > RISK_RULE.nearKm ? 'adj' : 'near';
      /* 判「选中的航线是否合理」而不是「是否恰好等于 argmin」：
         两条航线到同一点几乎等距时（实测有一例相差 14 m / 约 5 km，0.3%），
         两种近似会选出不同的那一条 —— 但**档位相同、结论相同**，
         这不是缺陷，是平局。要求严格等于 argmin 只会把平局判成错。
         真正要守的是：选中的那条**必须在最近距离的容差内**，且档位不能错。 */
      const tol = km => Math.max(0.02, km * 0.01);
      const wrongNear = riskEvents.filter(e => {
        if (!live.length) return e.nearestRouteId != null;
        let bestKm = Infinity;
        live.forEach(r => { const k = polyKm(e, r.waypoints); if (k < bestKm) bestKm = k; });
        const chosen = live.find(r => r.id === e.nearestRouteId);
        if (!chosen) return true;                                        // 挂到了不存在/非生效的航线
        const chosenKm = polyKm(e, chosen.waypoints);
        if (chosenKm - bestKm > tol(bestKm)) return true;                // 明显不是最近的那条
        if (bandOf(e.nearestRouteKm) !== bandOf(chosenKm)) return true;  // 档位必须与它自己的距离一致
        return Math.abs(e.nearestRouteKm - chosenKm) > tol(chosenKm);    // 存的数要对得上
      });
      add('最近航线、距离档位经独立几何重算一致，且只取生效中的航线',
        wrongNear.length === 0, riskEvents.length + ' 条一致',
        wrongNear.length + ' 条与独立重算不符');

      const draftIds = routes.filter(r => r.status !== '生效中').map(r => r.id);
      add('草稿/已停用航线不得成为风险判定的参照',
        !riskEvents.some(e => draftIds.indexOf(e.nearestRouteId) >= 0), '0 条',
        riskEvents.filter(e => draftIds.indexOf(e.nearestRouteId) >= 0).length + ' 条挂到了非生效航线');

      // ② 等级必须与三因子的**规则原文**一致（阈值写死，不回调 riskLevelOf）
      const expect = e => {
        if (e.nearestRouteKm == null) return '低';
        if (e.nearestRouteKm > RISK_RULE.adjKm) return '低';
        if (e.nearestRouteKm > RISK_RULE.nearKm) return (e.altOverlap === true && e.inWindow) ? '中' : '低';
        return (e.altOverlap === true && e.inWindow) ? '高' : '中';
      };
      const badLvl = riskEvents.filter(e => e.level !== expect(e));
      add('风险等级与三因子规则一致（距离 ' + RISK_RULE.nearKm + '/' + RISK_RULE.adjKm + ' km + 高度重叠 + 时间窗）',
        badLvl.length === 0, riskEvents.length + ' 条一致',
        badLvl.length + ' 条与规则不符：' + badLvl.slice(0, 2).map(e => e.id + ' 期望' + expect(e) + ' 实为' + e.level).join('、'));

      // ③ >5km 一律低：这条单列，因为它是用户裁定里最硬的一句
      const farBad = riskEvents.filter(e => e.nearestRouteKm != null && e.nearestRouteKm > RISK_RULE.adjKm && e.level !== '低');
      add('距最近航线 >' + RISK_RULE.adjKm + ' km 的事件一律为低（仅记录）',
        farBad.length === 0, '0 条越档', farBad.length + ' 条超出 ' + RISK_RULE.adjKm + ' km 却非低');

      // ④ 高度不可判定必须显式声明，不得被读成"不重叠"
      const undetBad = riskEvents.filter(e => e.altOverlap == null
        && (e.undeterminable || []).indexOf('高度重叠') < 0 && e.nearestRouteId != null);
      add('高度无法比对时必须声明不可判定（不得当作"不重叠"）',
        undetBad.length === 0, '0 条静默',
        undetBad.length + ' 条高度不可判定却未声明');

      // ⑤ 基准一致性：航线是 agl，就必须拿距地高比，拿海拔比是换了基准
      const aglRoutes = live.filter(r => r.altDatum === 'agl').map(r => r.id);
      const datumBad = riskEvents.filter(e => e.altOverlap != null
        && aglRoutes.indexOf(e.nearestRouteId) >= 0 && e.heightAgl == null);
      add('与 agl 基准航线比高度时必须有距地高（不得拿海拔高冒充）',
        datumBad.length === 0, '0 条串基准',
        datumBad.length + ' 条没有距地高却给出了高度重叠结论');

      // ⑥ 旧口径字段必须清干净，否则页面可能还在读它
      const legacy = riskEvents.filter(e => 'nearZone' in e || 'nearZoneKm' in e || 'nearZoneType' in e);
      add('旧保护对象字段（nearZone*）已从风险事件上清除',
        legacy.length === 0, '0 条残留', legacy.length + ' 条仍带 nearZone*');
      add('数据层不再导出 protectZones（保护区概念已删除）',
        typeof protectZonesRemovedProbe === 'undefined', '已删除', '仍存在');
      /* ⑦ 三个因子里有没有**当前根本不起作用**的？
         实测：全部 46 条飞行计划的 start 都落在 2026-08-26~08-29，
         也就是**整体位于 7 天窗口内**，于是 inWindow 对 163 条事件恒为 true。
         这不是代码错，是数据分布导致该因子当前**不具判别力** ——
         但如果不写出来，三因子规则看起来在工作，实际只有两个因子在起作用，
         跟 `cover: TBC` 那种"形式上存在、实质不可能被违反"是同一类。
         所以这里显式登记，并且**双向**校验：
           · 恒定的因子必须在册（否则误以为它在判别）
           · 一旦数据分布变了、因子重新有判别力，它必须从册上移除（否则登记本身过期）
         后一条尤其重要：登记表也是会过期的判据。 */
      const varies = f => { const vs = new Set(riskEvents.map(f)); return vs.size > 1; };
      const FACTORS = [
        { name: '距离档', vary: varies(e => e.nearestRouteKm == null ? 'n' : e.nearestRouteKm > RISK_RULE.adjKm ? 'f' : e.nearestRouteKm > RISK_RULE.nearKm ? 'a' : 'r') },
        { name: '高度重叠', vary: varies(e => String(e.altOverlap)) },
        { name: '时间窗', vary: varies(e => String(e.inWindow)) }
      ];
      /* 2026-08-27：'时间窗' 已摘册。
         此前它恒为 true（全部计划都在窗内），登记为无判别力；
         把 RT2026002/03/09 的计划挪成历史计划之后它开始判别，
         **这条断言的后半条当场报红提醒摘册** —— 登记表本身会过期，这就是那一次。 */
      const RISK_FACTOR_VACUOUS = [];
      const shouldList = FACTORS.filter(f => !f.vary).map(f => f.name);
      const wrongList = FACTORS.filter(f => f.vary && RISK_FACTOR_VACUOUS.indexOf(f.name) >= 0).map(f => f.name);
      const missList = shouldList.filter(n => RISK_FACTOR_VACUOUS.indexOf(n) < 0);
      add('无判别力的风险因子必须显式登记，且恢复判别力后要及时摘掉',
        missList.length === 0 && wrongList.length === 0,
        '登记表与实测判别力一致（当前恒定：' + (shouldList.join('/') || '无') + '）',
        /* 通过时也要给出内容：全库 183 条里只有这两条登记式断言的 got 会是空串，
           而"got 恒非空"作为一条无例外的规则，比"大部分非空"好用得多 ——
           取数方就不用为空值单独写分支。 */
        (missList.length ? '未登记的恒定因子：' + missList.join('/') + '；' : '')
          + (wrongList.length ? '已恢复判别力却仍在册：' + wrongList.join('/') : '')
          || '在册：' + (RISK_FACTOR_VACUOUS.join('/') || '无') + '；实测恒定：' + (shouldList.join('/') || '无'));
    }

    add('处置建议与等级一致，且不得凭空指名通报单位',
      riskEvents.every(e => e.advice === riskAdvice({
        level: e.level, km: e.nearestRouteKm,
        route: e.nearestRouteId ? routeById(e.nearestRouteId) : null
      })) && !riskEvents.some(e => /塔台/.test(e.advice)),
      '100% 一致且无越权通报',
      riskEvents.filter(e => /塔台/.test(e.advice)).length + ' 条仍声称通知塔台');
    add('最近机场字段仍是独立事实（未被航线判定覆盖）',
      riskEvents.every(e => AIRPORTS.some(a => a.name === e.airport)),
      '100% 为机场名',
      [...new Set(riskEvents.filter(e => !AIRPORTS.some(a => a.name === e.airport)).map(e => e.airport))].join('/') || '100% 为机场名');

    add('风险事件状态均在枚举内',
      riskEvents.every(e => RISK_STATUS.indexOf(e.status) >= 0),
      RISK_STATUS.join('/'), [...new Set(riskEvents.map(e => e.status))].join('/'));
    add('已通知/处置中/已处置/已归档的事件必须有通报记录（通知上级是这些状态的前置动作）',
      riskEvents.filter(e => ['已通知', '处置中', '已处置', '已归档'].indexOf(e.status) >= 0)
        .every(e => noticesOf(e.id).length > 0),
      '100% 有通报记录',
      riskEvents.filter(e => ['已通知', '处置中', '已处置', '已归档'].indexOf(e.status) >= 0
        && noticesOf(e.id).length === 0).length + ' 个缺通报记录');
    add('待核验/待通知/已排除的事件不应有通报记录（尚未通知或已排除）',
      riskEvents.filter(e => ['待核验', '待通知', '已排除'].indexOf(e.status) >= 0)
        .every(e => noticesOf(e.id).length === 0),
      '0 个',
      riskEvents.filter(e => ['待核验', '待通知', '已排除'].indexOf(e.status) >= 0
        && noticesOf(e.id).length > 0).length + ' 个');
    add('通报回执状态均在枚举内，且已回执必须有回执时刻与回执人',
      riskNotices.every(x => ACK_STATUS.indexOf(x.ackStatus) >= 0
        && (x.ackStatus !== '已回执' || (x.ackAt && x.ackBy))),
      ACK_STATUS.join('/'),
      riskNotices.filter(x => ACK_STATUS.indexOf(x.ackStatus) < 0
        || (x.ackStatus === '已回执' && !(x.ackAt && x.ackBy))).length + ' 条不符');
    /* 直接与 noticeTargetFor 比对：页面新增通报也必须调它，两边就不可能分叉。
       原写法在断言里另写一遍映射规则，等于规则有两份。 */
    add('通报对象与所用渠道一致（取自 noticeTargetFor，不得各写一份映射）',
      riskNotices.every(x => x.to === noticeTargetFor(x.channel, riskEvents.find(e => e.id === x.eventId))),
      '100% 一致',
      riskNotices.filter(x => x.to !== noticeTargetFor(x.channel, riskEvents.find(e => e.id === x.eventId))).length + ' 条不符');
    add('通报时刻晚于事件发生时刻',
      riskNotices.every(x => {
        const e = riskEvents.find(y => y.id === x.eventId);
        return e ? new Date(String(x.at).replace(' ', 'T')).getTime() >= e.ts : false;
      }), '100% 晚于事件',
      riskNotices.filter(x => { const e = riskEvents.find(y => y.id === x.eventId); return !e || new Date(String(x.at).replace(' ', 'T')).getTime() < e.ts; }).length + ' 条早于事件');
    add('驱鸟处置入口的设备基础存在（deviceTypeAbbr=bsc）',
      devices.some(d => d.deviceTypeAbbr === 'bsc'), '≥1 台',
      devices.filter(d => d.deviceTypeAbbr === 'bsc').length + ' 台');
    add('反制类设备 workState=0 属常态，不得计入异常（协议语义）',
      devices.filter(d => ['cm', 'dec', 'ifr', 'bsc'].includes(d.deviceTypeAbbr) && d.workState === 0)
        .every(d => d.status !== '异常'), '0 台误判', '0 台误判');
    (function () {
      // 断言的意义在于「快照与当前判定可以不同」：有目标被事实修订降级后，
      // 快照仍应停在立案时的结论。两端若同源，这条断言恒真、等于没写。
      const drifted = cases.filter(c => {
        const t = allTargets.find(x => x.id === c.targetId);
        return t && t.legal !== c.filingSnapshot.legal_status;
      });
      /* 判据换成「快照 === 该案件被修订前的判定」——
         原来写的是「快照 === '非法'」，而快照存的就是立案时的判定、立案又只从非法目标派生，
         两端同源、恒真。现在拿的是 factRevisions 独立记录的 from 值，两端不同源。 */
      const snapDrift = factRevisions.filter(r => {
        const c = cases.find(x => x.id === r.caseId);
        return c && c.filingSnapshot.legal_status !== r.from;
      });
      add('立案快照不随后续判定修订而改变（快照 = 修订记录中的原判定）',
        snapDrift.length === 0 && drifted.length === factRevisions.length,
        `${factRevisions.length} 件被修订，快照均停留在原判定`,
        snapDrift.length ? `${snapDrift.length} 件快照已被改写：${snapDrift[0].caseId}`
          : `${factRevisions.length} 件被修订、快照 0 件改写；当前判定与快照不一致的共 ${drifted.length} 件`);
      add('判定被修订的已立案目标均产生复核请求（不得单方面改案件状态）',
        factRevisions.every(r => reviewRequests.some(q => q.targetId === r.targetId)),
        factRevisions.length + ' 件',
        reviewRequests.filter(q => factRevisions.some(r => r.targetId === q.targetId)).length + '/' + factRevisions.length + ' 件');
    })();
    (function () {
      const bad = allTargets.filter(t => t.violation !== primaryViolation(t.violation_reasons));
      add('主违规恒等于罚则表最严一条（不得取数组首项）',
        bad.length === 0, '完全一致',
        bad.length ? `${bad.length} 个不符：${bad.slice(0, 2).map(t => t.id).join('、')}` : '完全一致');
    })();
    (function () {
      const bad = cases.filter(c => {
        const t = allTargets.find(x => x.id === c.targetId);
        return t && t.violation_reasons.length !== (c.filingSnapshot.violation_reasons || []).length;
      });
      add('立案快照完整记录当时认定的全部违规事由（法律凭据完整性）',
        bad.length === 0, '完全一致',
        bad.length ? `${bad.length} 件漏记：${bad.slice(0, 2).map(c => c.id).join('、')}` : '完全一致');
    })();
    (function () {
      const ill = allTargets.filter(t => t.legal === '非法');
      const covered = ill.filter(t => cases.some(c => c.targetId === t.id) || pendingSubjects.some(q => q.targetId === t.id));
      const D = illegalDisposition;
      add('违法目标去向完整：要么立案、要么进待办案源并记明卡在哪一步',
        covered.length === ill.length, ill.length + ' 个全部有去向',
        covered.length + '/' + ill.length + '（立案 ' + D.filed + ' · 待办 ' + D.pending + '）');
      // 反向：每个案件也必须能说清它的目标现在是什么判定 —— 降级的要单列，不能混进"已立案且仍非法"
      add('违法目标去向等式闭合：当前非法 = 已立案且仍非法 + 待办，降级案件另计',
        D.filed + D.pending === D.illegalNow && D.filed + D.downgraded === D.caseTotal,
        `${D.illegalNow} = ${D.filed} + ${D.pending}，另计降级 ${D.downgraded} 件`,
        `${D.illegalNow} = ${D.filed} + ${D.pending}（${D.filed + D.pending === D.illegalNow ? '闭合' : '不闭合'}）· ` +
        `案件 ${D.caseTotal} = 仍非法 ${D.filed} + 已降级 ${D.downgraded}`);
      const named = cases.filter(c => c.partner.indexOf('未知') < 0);
      add('具名责任主体必有认定路径（处罚决定书的当事人不得靠推测）',
        named.every(c => c.filingSnapshot.subject_source),
        named.length + ' 件全部有路径',
        named.filter(c => c.filingSnapshot.subject_source).length + '/' + named.length + ' 件');
    })();
    (function () {
      const FLDS = ['classification_confidence', 'position_accuracy', 'source_task_id'];
      const bad = [];
      allTargets.forEach(t => {
        const cap = SRC_CAP_REF[t.source]; if (!cap) return;
        FLDS.forEach(f => { if (!cap[f] && t[f] != null) bad.push(t.id + '.' + f + '(' + t.source + ')'); });
      });
      add('来源能力矩阵：设备不提供的字段不得有值（协议 v8.6）',
        bad.length === 0, '完全匹配',
        bad.length ? `${bad.length} 处越权：${bad.slice(0, 2).join('、')}` : `${allTargets.length} 个目标 × ${FLDS.length} 字段全部匹配`);
    })();
    (function () {
      // 机型识别能力必须与数据来源匹配：雷达/5G-A 给不出机型，射频特征只能到系列级
      const uav = allTargets.filter(t => t.type === '无人机');
      const bad = uav.filter(t => {
        const rc = t.pilotPosition ? t.pilotPosition.device : null;
        const canExact = rc === '协议破解' || rc === 'RemoteID' || planned(t.facts);
        const canSeries = rc === 'TDOA' || rc === 'AOA' || t.source === 'TDOA';
        if (canExact) return t.model === MODEL_UNKNOWN;
        if (canSeries) return !/系列/.test(t.model);
        return t.model !== MODEL_UNKNOWN;                 // 无任何型号来源却填了型号
      });
      add('机型识别粒度不得超出数据来源能力（雷达/通感给不出机型）',
        bad.length === 0, '完全匹配',
        bad.length ? `${bad.length} 个越权：${bad.slice(0, 2).map(t => t.id + '(' + t.source + '→' + t.model + ')').join('、')}` : '完全匹配');
    })();
    (function () {
      const S = stats;
      const aSum = S.altBands.reduce((a, b) => a + b.value, 0);
      const gSum = S.aglBands.reduce((a, b) => a + b.value, 0);
      const absent = (S.aglBands.find(b => b.absent) || {}).value;
      const realAbsent = allTargets.filter(t => t.type !== '遥控器' && t.heightAgl == null).length;
      add('高度分档合计 = 参与统计目标总数（两种基准各自闭合，缺失档不得丢弃）',
        aSum === S.altTotal && gSum === S.altTotal && absent === realAbsent,
        `海拔 ${S.altTotal} / 距地 ${S.altTotal} · 未上报 ${realAbsent}`,
        `海拔 ${aSum} / 距地 ${gSum} · 未上报档记 ${absent}`);
    })();
    (function () {
      const Q = senseQuality;
      const sum = Q.byKind.reduce((a, k) => a + k.value, 0);
      const bad = Q.perTrack.filter(r => {
        const t = liveTargets.find(x => x.id === r.id);
        return !t || r.total !== t.track.length
          || r.meas !== t.track.filter(p => (p.kind || 'meas') === 'meas').length
          || r.bridge !== t.track.filter(p => p.kind === 'bridge').length
          || r.pred !== t.track.filter(p => p.kind === 'pred').length;
      });
      add('感知质量：三类点型合计 = 轨迹点总数，且单条分型数与 kind 字段实测一致',
        sum === Q.pointCount && bad.length === 0,
        `${Q.pointCount} 点 · ${Q.trackCount} 条全部一致`,
        `${sum}/${Q.pointCount} 点` + (bad.length ? ` · ${bad.length} 条不一致：${bad[0].id}` : ` · ${Q.trackCount} 条全部一致`));
      add('感知质量：弥合率非常数（固定分型模式会让「哪条轨迹最不可信」失去信息量）',
        new Set(Q.perTrack.map(r => r.bridgeRate)).size > 1,
        '至少 2 种取值',
        new Set(Q.perTrack.map(r => r.bridgeRate)).size + ' 种取值（' +
        Math.min(...Q.perTrack.map(r => r.bridgeRate)) + '% ~ ' + Math.max(...Q.perTrack.map(r => r.bridgeRate)) + '%）');
    })();
    (function () {
      const bad = [];
      liveTargets.forEach(t => (t.track || []).forEach(p => {
        if (p.lon == null || p.lat == null || !(p.lon > 117 && p.lon < 120 && p.lat > 36 && p.lat < 39))
          bad.push(t.id + '@' + p.lon + ',' + p.lat);
      }));
      add('轨迹点坐标均有效且落在东营范围内（无位置的目标不得生成轨迹）',
        bad.length === 0, '全部有效',
        bad.length ? `${bad.length} 个越界：${bad[0]}` : `${liveTargets.reduce((a, t) => a + (t.track || []).length, 0)} 点全部有效`);
    })();
    (function () {
      const undecl = airspaces.filter(a => !AIRSPACE_TYPES.some(x => x.type === a.type));
      const mism = airspaces.filter(a => { const d = AIRSPACE_TYPES.find(x => x.type === a.type); return d && a.color !== d.color; });
      add('空域类型与配色均出自 AIRSPACE_TYPES 声明（安全属性不得存副本）',
        undecl.length === 0 && mism.length === 0,
        `${airspaces.length} 条全部匹配`,
        undecl.length ? `${undecl.length} 个类型未声明：${undecl[0].type}`
          : mism.length ? `${mism.length} 个配色不符：${mism[0].name}` : `${airspaces.length} 条全部匹配`);
      const legalVals = [...new Set(allTargets.map(t => t.legal))].filter(v => LEGAL_STATUS.indexOf(v) < 0);
      add('判定结果取值均在 LEGAL_STATUS 枚举内',
        legalVals.length === 0, '全部在枚举内',
        legalVals.length ? `越界值：${legalVals.join('、')}` : `${LEGAL_STATUS.length} 个取值全部合法`);
    })();
    (function () {
      /* 字典的价值在于它是权威源，所以断言必须拿它去比**实际数据**，
         而不是比它自己算出来的另一个数 —— 后者两端同源、恒真，占着"已验证"的名额却什么都没验。
         （这条断言的第一版就是那样写的，证伪测试注入违例后它仍然通过，才发现。） */
      const R = dictRegistry();
      const decl = k => (R.find(x => x.key === k) || { values: [] }).values;
      const strip = v => String(v).replace(/^\d+\s+/, '').replace(/（.*$/, '');
      const CHECKS = [
        ['LEGAL_STATUS', '判定结果', [...new Set(allTargets.map(t => t.legal))]],
        ['AIRSPACE_TYPES', '空域类型', [...new Set(airspaces.map(a => a.type))]],
        ['ALARM_STATUS', '告警状态', [...new Set(alarms.map(a => a.status))]],
        ['CASE_STATUS', '案件状态', [...new Set(cases.map(c => c.status))]],
        ['TRACK_STATUS', '轨迹状态', [...new Set(allTargets.map(t => t.track_status).filter(Boolean))]],
        ['VIOLATIONS', '违规事由', [...new Set(allTargets.flatMap(t => t.violation_reasons))]],
        ['OBJECT_TYPES', '目标类型', [...new Set(allTargets.map(t => t.type))]],
        ['DEVICE_TYPES', '设备类型', [...new Set(devices.map(d => d.type))]]
      ];
      const bad = [];
      CHECKS.forEach(([k, name, actual]) => {
        const d = decl(k).map(strip);
        actual.forEach(v => { if (d.indexOf(v) < 0) bad.push(name + '「' + v + '」未在字典中声明'); });
      });
      add('数据中实际出现的枚举值均已在数据字典声明（字典对不上真值就是假权威）',
        bad.length === 0, `${CHECKS.length} 类枚举全部覆盖`,
        bad.length ? `${bad.length} 处未声明：${bad.slice(0, 2).join('；')}` : `${CHECKS.length} 类枚举全部覆盖`);
      const roMustBe = ['OBJECT_TYPES', 'DEVICE_TYPES', 'LEGAL_STATUS', 'DISTRICTS'];
      const wrongRo = roMustBe.filter(k => { const d = R.find(x => x.key === k); return d && d.editable; });
      add('协议约定与判定规则相关的字典标为只读（配置界面不得提供改协议的按钮）',
        wrongRo.length === 0, roMustBe.length + ' 项全部只读',
        wrongRo.length ? `${wrongRo.join('、')} 被标为可配置` : roMustBe.length + ' 项全部只读');
    })();
    (function () {
      /* A5 收敛的结构性判据：字段必须不存在，不能靠"数值一致"证明收敛。
         这四条原本没有任何断言守护 —— 是 tools/falsify.js 注入后无人报红才发现的。
         其中 violation_reasons 截断那条更尴尬：我在字段收敛时把原来的守护断言
         改成了「主违规取最严一条」，等于把一道防线换成了另一道，而不是加了一道。 */
      const withConf = allTargets.filter(t => 'conf' in t);
      add('A5：conf 字段已从数据层删除（结构性判据，不以数值一致代替）',
        withConf.length === 0, '0 个目标带 conf',
        withConf.length ? `${withConf.length} 个仍带 conf：${withConf.slice(0, 2).map(t => t.id).join('、')}` : '0 个目标带 conf');
      const withVs = allTargets.filter(t => 'violations' in t);
      add('A5：内部副本 violations 已删除（契约字段 violation_reasons 为唯一真值）',
        withVs.length === 0, '0 个目标带 violations',
        withVs.length ? `${withVs.length} 个重新出现副本：${withVs.slice(0, 2).map(t => t.id).join('、')}` : '0 个目标带 violations');
      // 截断守护：多值目标数不得低于按事实推算的应有数
      const shouldMulti = allTargets.filter(t => t.facts && t.facts.appliesLegality !== false
        && deriveLegality(t.facts).violations.length > 1);
      const isMulti = shouldMulti.filter(t => t.violation_reasons.length > 1);
      add('violation_reasons 未被截断（按客观事实重推，多值目标数须一致）',
        isMulti.length === shouldMulti.length,
        `应有多值 ${shouldMulti.length} 个`,
        `实际多值 ${isMulti.length} / 应有 ${shouldMulti.length}` +
        (isMulti.length < shouldMulti.length
          ? `，被截断：${shouldMulti.filter(t => t.violation_reasons.length <= 1).slice(0, 2).map(t => t.id).join('、')}` : ''));
      const aoaPos = allTargets.filter(t => t.posValid === false && (t.lon != null || t.lat != null || t.alt != null));
      add('AOA 目标不得有经纬度与高度（协议 v8.6：AOA 目标经纬高无效，使用方位角）',
        aoaPos.length === 0, '0 个 AOA 目标带位置',
        aoaPos.length ? `${aoaPos.length} 个越权：${aoaPos.slice(0, 2).map(t => t.id).join('、')}` : '0 个 AOA 目标带位置');
    })();
    (function () {
      /* 拿一条已有的绝对禁止空间和一条非禁止规则做真实重叠，检验冲突判定认不认 forbidsAllPlans。
         用例特意让两者限高相同 —— 限高不同会掉进「限高矛盾」分支、碰巧也报严重，掩盖真问题。 */
      const forbid = airspaces.find(a => airspaceType(a.type).forbidsAllPlans);
      if (!forbid) return;
      const probe = Object.assign({}, forbid, {
        id: 'PROBE', name: '探针规则', type: AIRSPACE_TYPES.find(t => !t.forbidsAllPlans).type,
        limit: forbid.limit, limitTx: forbid.limitTx
      });
      const hit = detectConflicts(probe, airspaces.concat()).find(c => c.id === forbid.id);
      add('与绝对禁止空间重叠必判「严重」（判据取 forbidsAllPlans，不认类型名）',
        !!hit && hit.level === '严重',
        '严重', hit ? `${hit.level}（${hit.reason}）` : '未检出重叠 —— 探针构造失效');
    })();
    (function () {
      const E = evidenceFiles;
      const cntBad = cases.filter(c => c.evidence !== evidenceOf('case', c.id).length);
      add('案件证据件数 = 台账中该案件的文件数（不得是独立随机数）',
        cntBad.length === 0, `${cases.length} 件全部一致`,
        cntBad.length ? `${cntBad.length} 件不符：${cntBad[0].id}（详情记 ${cntBad[0].evidence} / 台账 ${evidenceOf('case', cntBad[0].id).length}）`
          : `${cases.length} 件全部一致`);
      const orphan = E.filter(f => !f.refs || !f.refs.length);
      add('不存在无归属的孤儿证据（每份文件至少关联一个业务实体）',
        orphan.length === 0, '0 份孤儿', orphan.length ? `${orphan.length} 份无关联：${orphan[0].id}` : '0 份孤儿');
      const badEnum = E.filter(f => EVIDENCE_KINDS.indexOf(f.kind) < 0
        || EVIDENCE_VERIFY.indexOf(f.verifyState) < 0 || EVIDENCE_STATUS.indexOf(f.status) < 0);
      add('证据类型/校验状态/保管状态均在枚举内',
        badEnum.length === 0, `${E.length} 份全部合法`,
        badEnum.length ? `${badEnum.length} 份越界：${badEnum[0].id}` : `${E.length} 份全部合法`);
      // 校验异常必须有处置说明 —— 「待校验」是尚未校验，不适用
      const noNote = E.filter(f => ['哈希不一致', '文件缺失'].includes(f.verifyState) && !f.verifyNote);
      add('校验异常的证据必须记录处置说明（发现时间 + 流程 + 责任人）',
        noNote.length === 0,
        `异常 ${E.filter(f => ['哈希不一致', '文件缺失'].includes(f.verifyState)).length} 份均有说明`,
        noNote.length ? `${noNote.length} 份无说明：${noNote[0].id}` : `异常 ${E.filter(f => ['哈希不一致', '文件缺失'].includes(f.verifyState)).length} 份均有说明`);
      // 合规底线：冻结的证据不得被销毁
      const violated = E.filter(f => f.legalHold && f.status === '已销毁');
      add('冻结中的证据不得被销毁（合规底线）',
        violated.length === 0, `冻结 ${E.filter(f => f.legalHold).length} 份，0 份被销毁`,
        violated.length ? `${violated.length} 份违规销毁：${violated[0].id}` : `冻结 ${E.filter(f => f.legalHold).length} 份，0 份被销毁`);
      // 销毁的必须留痕
      const noTrace = E.filter(f => f.status === '已销毁' && !(f.destroyAt && f.destroyBy && f.destroyApproval));
      add('已销毁的证据仍在台账中可查，且留有销毁人/时间/审批号',
        noTrace.length === 0, `已销毁 ${E.filter(f => f.status === '已销毁').length} 份均留痕`,
        noTrace.length ? `${noTrace.length} 份无销毁记录：${noTrace[0].id}` : `已销毁 ${E.filter(f => f.status === '已销毁').length} 份均留痕`);
      // 引用不得指向已不存在的对象
      const dangling = [];
      E.forEach(f => evidenceRefs(f.id).forEach(r => { if (!r.exists) dangling.push(f.id + '→' + r.kind + ':' + r.id); }));
      add('证据引用均指向存在的业务实体（无悬空引用）',
        dangling.length === 0, `${E.reduce((a, f) => a + f.refs.length, 0)} 条引用全部有效`,
        dangling.length ? `${dangling.length} 条悬空：${dangling[0]}` : `${E.reduce((a, f) => a + f.refs.length, 0)} 条引用全部有效`);
      // 冻结规则本身：未结案的案件其证据必须冻结
      /* 时间线一致性：到期日恒等于取证日 + 留存年。
         此前造过期样本时把 retainUntil 往回拨而没动 capturedAt，出现「2026-08-25 取证、
         2026-08-17 到期」—— status 自洽、retainYears 自洽，三个字段摆一起才露馅。
         若将来出现「个案延长留存」，应加 retainExtended 标记并在此放宽，而不是删掉这条。 */
      /* 注意：new Date('2021-08-18') 按 **UTC 午夜** 解析，在负时区读回来会退一天。
         必须按本地分量构造，否则这条断言自己就会报出 336 份"不符"。 */
      const addY = (dstr, y) => {
        const [Y, Mo, D] = dstr.split('-').map(Number);
        return fmtD(new Date(Y + y, Mo - 1, D));
      };
      /* 留存期分级后单位有两种（年 / 天），逐份按各自单位复算到期日。
         此前写死按"年"复算，调测报告改成 90 天之后会全部误报。 */
      const addDays = (ymdStr, n) => {
        const d = new Date(String(ymdStr).replace(/-/g, '/') + ' 00:00:00');
        d.setDate(d.getDate() + n); return fmtD(d);
      };
      const expectUntil = f => f.retainDays != null
        ? addDays(f.capturedAt.slice(0, 10), f.retainDays)
        : addY(f.capturedAt.slice(0, 10), f.retainYears);
      const timeBad = E.filter(f => f.retainExtended ? false : expectUntil(f) !== f.retainUntil);
      add('证据到期日 = 取证日 + 该类型留存期（留存期是"证据保存多久"的答案，不能对不上）',
        timeBad.length === 0, `${E.length} 份时间线一致`,
        timeBad.length ? `${timeBad.length} 份不符：${timeBad[0].id}（取证 ${timeBad[0].capturedAt.slice(0, 10)} / 到期 ${timeBad[0].retainUntil} / 留存 ${timeBad[0].retainLabel}）`
          : `${E.length} 份时间线一致`);
      /* ---- 取证时刻与案发时刻的方向约束（两类方向相反）----
         一刀切成「取证不得晚于案发」会让 30 份处罚文书全部误报（文书本来就在案发之后）；
         放宽成「只要有关联即可」又会变成恒真断言。故按类型分方向各查各的。 */
      const caseOf = f => {
        const r = (f.refs || []).find(x => x.kind === 'case');
        return r ? cases.find(c => c.id === r.id) : null;
      };
      const tms = v => new Date(String(v).replace(' ', 'T')).getTime();
      // during 类：事件进行中取证，不得晚于「案发 + 该架次飞行时长 + 缓冲」
      const duringBad = E.filter(f => EVID_TIME_REL[f.kind] === 'during').filter(f => {
        const c = caseOf(f); if (!c) return false;
        const tgt = allTargets.find(t => t.id === c.targetId);
        const spanMin = (tgt ? tgt.durMin : 60) + 30;
        return tms(f.capturedAt) > tms(c.time) + spanMin * 60000;
      });
      add('事件取证类不得晚于事件结束（录像/抓拍/轨迹快照产生于事件进行中）',
        duringBad.length === 0, '0 份晚于事件',
        duringBad.length ? `${duringBad.length} 份：${duringBad[0].id}（${duringBad[0].kind} 取证 ${duringBad[0].capturedAt}）` : '0 份晚于事件');
      // after 类：事后材料，不得早于案发
      const afterBad = E.filter(f => EVID_TIME_REL[f.kind] === 'after').filter(f => {
        const c = caseOf(f); if (!c) return false;
        return tms(f.capturedAt) < tms(c.time);
      });
      add('事后材料类不得早于案发（文书/回执/现场照片/指令报文产生于事件之后）',
        afterBad.length === 0, '0 份早于案发',
        afterBad.length ? `${afterBad.length} 份：${afterBad[0].id}（${afterBad[0].kind} 取证 ${afterBad[0].capturedAt}）` : '0 份早于案发');
      add('每类证据的留存期取自分级表（不得回到统一年限）',
        E.every(f => {
          const r = EVID_RETAIN[f.kind]; if (!r) return false;
          return r.days != null ? f.retainDays === r.days : f.retainYears === r.years;
        }), '100% 按类型',
        E.filter(f => { const r = EVID_RETAIN[f.kind]; return !r || (r.days != null ? f.retainDays !== r.days : f.retainYears !== r.years); }).length + ' 份不符');
      add('证据状态由到期日推导（不得独立赋值）',
        E.every(f => {
          if (f.status === '已销毁') return !!f.destroyAt;
          const left = f.retainLeftDays;
          if (f.legalHold && left < 0) return f.status === '在库' && !!f.holdReason;
          return f.status === (left < 0 ? '已到期待清理' : left <= 30 ? '临近到期' : '在库');
        }), '100% 与到期日一致',
        E.filter(f => f.status !== '已销毁' && !(f.legalHold && f.retainLeftDays < 0)
          && f.status !== (f.retainLeftDays < 0 ? '已到期待清理' : f.retainLeftDays <= 30 ? '临近到期' : '在库')).length + ' 份脱钩');

      add('指令报文与回执的取证时刻 = 对应授权指令的下发时刻（不得兜底成演示基准时刻）',
        E.filter(f => f.kind === '指令报文与回执').every(f => {
          const r = (f.refs || []).find(x => x.kind === 'authLog');
          const a = r ? authLogs.find(x => x.id === r.id) : null;
          return a ? f.capturedAt === a.start : false;
        }), '100% 对齐授权时刻',
        E.filter(f => f.kind === '指令报文与回执').filter(f => {
          const r = (f.refs || []).find(x => x.kind === 'authLog');
          const a = r ? authLogs.find(x => x.id === r.id) : null;
          return !a || f.capturedAt !== a.start;
        }).length + ' 份未对齐');

      /* 这条原来把 ['光电录像','光电抓拍图','雷达轨迹快照','现场照片'] 一律要求
         「取证时刻不得早于案件时刻」—— 但前三类在 EVID_TIME_REL 里明写是 `during`：
         录像和轨迹快照产生于**事件进行中**，本来就早于立案。
         也就是说同一个方向约束在本文件里有两份模型，而这一条用的是错的那份，
         只不过此前的随机样本恰好没走到冲突区，它就一直绿着。
         （这次删 cpu/mem/disk 让随机流整体挪位，样本一变它立刻现形。）

         `originAction` 的措辞是「告警触发后**调取**该时段光电录像」——
         "调取"是事后的动作，"取证时刻"是画面被拍下的时刻，两者不是一回事。
         把措辞当成对 capturedAt 的约束，是把调取时间读成了取证时间。

         改为只对 `after` 类生效，并直接读 EVID_TIME_REL 这个唯一来源，
         不再在断言里另抄一份种类清单 —— 抄一份就会有第二个定义。 */
      const capBad = E.filter(f => EVID_TIME_REL[f.kind] === 'after')
        .filter(f => {
          const r = (f.refs || []).find(x => x.kind === 'case');
          const c = r ? cases.find(y => y.id === r.id) : null;
          return c ? new Date(String(f.capturedAt).replace(' ', 'T')).getTime() < c.ts : false;
        });
      add('事后类取证材料不得早于案发（after 类，种类取自 EVID_TIME_REL）',
        capBad.length === 0, '0 份早于案发',
        capBad.length ? `${capBad.length} 份：${capBad[0].id}（${capBad[0].kind}）` : '0 份早于案发');

      add('每份归档记录都能说明来源模块与产生动作（originAction）',
        E.every(f => f.srcModule && f.originAction && f.originAction.length > 6),
        '100% 可说明',
        E.filter(f => !f.srcModule || !f.originAction || f.originAction.length <= 6).length + ' 份说不清来源');
      add('来源模块取值均为业务模块名（不得暴露内部标识）',
        E.every(f => PERM_MODULES.indexOf(f.srcModule) >= 0 || f.srcModule === '系统·反制授权引擎'),
        '均为业务模块名',
        [...new Set(E.filter(f => PERM_MODULES.indexOf(f.srcModule) < 0 && f.srcModule !== '系统·反制授权引擎')
          .map(f => f.srcModule))].join('/') || '均为业务模块名');
      add('融合感知中心截图取证与风险事件归档均已进入台账',
        E.some(f => f.srcModule === '融合感知中心') && E.some(f => f.srcModule === '空间安全风险' && f.kind === '雷达轨迹快照'),
        '两类均在台账',
        `融合感知中心 ${E.filter(f => f.srcModule === '融合感知中心').length} 份 / 风险归档 ${E.filter(f => f.srcModule === '空间安全风险' && f.kind === '雷达轨迹快照').length} 份`);

      const future = E.filter(f => f.capturedAt > fmtDT(CONF.demoTime));
      add('证据取证时刻不得晚于当前时刻（不存在"下周才取的证"）',
        future.length === 0, '0 份未来取证',
        future.length ? `${future.length} 份在未来：${future[0].id} @ ${future[0].capturedAt}` : '0 份未来取证');
      const ingestBad = E.filter(f => f.ingestAt < f.capturedAt);
      add('入库时刻不早于取证时刻（两者之差是链路时延证据）',
        ingestBad.length === 0, '0 份倒挂',
        ingestBad.length ? `${ingestBad.length} 份倒挂：${ingestBad[0].id}` : '0 份倒挂');
      const shouldHold = E.filter(f => {
        const cr = f.refs.find(r => r.kind === 'case'); if (!cr) return false;
        const c = cases.find(x => x.id === cr.id);
        return c && c.status !== '已结案' && !f.legalHold;
      });
      add('未结案案件的证据一律冻结（到期也不清理）',
        shouldHold.length === 0, '0 份漏冻结',
        shouldHold.length ? `${shouldHold.length} 份漏冻结：${shouldHold[0].id}` : '0 份漏冻结');
    })();
    /* 兜底路径是 fail-closed 的安全网，不是正常路径：任何空域走到它都说明有枚举没登记。
       没有这条断言，新增枚举值忘了登记不会报错，只会静默按"最严"处理 ——
       比 fail-open 好，但仍然是"规则表和数据不一致"。 */
    /* objCode/objAbbr 的兜底值（未知/UNK）本身是协议里的合法取值，不像空域那两处是 fail-open；
       但**静默依赖它**同样有害：未登记的目标类型会悄悄变成「未知」，
       而未知类型不参与合法性判定 —— 等于绕过审查，只是绕得比较体面。 */
    /* 时间基准这条**不适合放在 selfCheck 里**：
       断言只能调 now() 自己，两端同源 —— 把实现改成 `new Date()` 它照样通过
       （实测：替换导出的 M.now 后注入无人捕获，因为内部调用走的是闭包）。
       真正能守住它的是**源码层规则**：页面层不得直接 new Date() / Date.now()。
       那条归 tools/scan.js（主控在做）。这里只留数据侧能查的部分 —— 见下面
       「证据取证时刻不得晚于当前时刻」等既有断言。 */
    /* 查询与执行同源：对任意案件 × 任意模块，两者的可否结论必须一致。
       这条不依赖数据里恰好有卡在某环的案件 —— 遍历现有案件 × 三个模块即全覆盖，
       正好避开我们被坑过几次的"没有样本走到那条路径"。 */
    (function () {
      const mods = [...new Set(DISPOSAL_FLOW.map(f => f.owner))];
      const bad = [];
      cases.forEach(c => mods.forEach(m => {
        const q = canAdvanceCase(c, m).ok;
        // 在深拷副本上试执行：advanceCase 会写 steps，浅拷会改到真数据
        const copy = Object.assign({}, c, { steps: c.steps.map(x => Object.assign({}, x)) });
        const e = advanceCase(copy, m).ok;
        if (q !== e) bad.push(c.id + '/' + m);
      }));
      add('推进闸门查询与执行同源（canAdvanceCase ⟺ advanceCase）',
        bad.length === 0, `${cases.length} 件 × ${mods.length} 模块全一致`,
        bad.length ? bad.slice(0, 3).join(' ') + ` 等 ${bad.length} 处不一致` : `${cases.length} 件 × ${mods.length} 模块全一致`);
    })();
    add('纯查询不得写数据（canAdvanceCase 调用前后案件不变）',
      (function () {
        const c = cases[0];
        const snap = JSON.stringify({ s: c.stage, st: c.status, sp: c.steps });
        DISPOSAL_FLOW.map(f => f.owner).forEach(m => canAdvanceCase(c, m));
        return JSON.stringify({ s: c.stage, st: c.status, sp: c.steps }) === snap;
      })(), '调用前后逐字节一致', '调用前后逐字节一致');
    add('未完成环节不得残留完成时间（待处理 / 不适用 两态，不得是时间戳）',
      cases.every(c => c.steps.every((st, k) =>
        k >= c.stage ? (st.t === '待处理' || st.t === '不适用') : true)),
      '0 个残留',
      cases.filter(c => c.steps.some((st, k) => k >= c.stage && st.t !== '待处理' && st.t !== '不适用')).length + ' 件残留');
    add('回退均留痕（谁/何时/从哪到哪/为什么）',
      cases.filter(c => c.restageLog && c.restageLog.length)
        .every(c => c.restageLog.every(r => r.at && r.operator && r.reason && typeof r.from === 'number' && typeof r.to === 'number')),
      '100% 完整',
      cases.filter(c => (c.restageLog || []).some(r => !(r.at && r.operator && r.reason))).length + ' 条不完整');

    /* ---- 反制授权凭据：双向对账 ----
       这次的缺陷正好是**双向**的（38 件缺授权 + 2 条孤儿授权），
       单向断言各自都抓不住：只写①孤儿照样通过，只写②缺失照样通过。 */
    const needAuth = cases.filter(c => c.counterApplicable && c.stage > 3);
    add('① 已实施反制且走过该环节的案件必须有授权凭据（§6.3 人在回路）',
      needAuth.every(c => authLogs.some(a => a.caseId === c.id)),
      needAuth.length + ' 件全部有凭据',
      needAuth.filter(c => !authLogs.some(a => a.caseId === c.id))
        .slice(0, 3).map(c => c.id).join(' ') || needAuth.length + ' 件全部有凭据');
    add('② 每条授权记录都对应一个确实实施了反制且走到该环节的案件（无孤儿授权）',
      authLogs.every(a => {
        const c = cases.find(x => x.id === a.caseId);
        return c && c.counterApplicable && c.stage > 3;
      }), '0 条孤儿',
      authLogs.filter(a => {
        const c = cases.find(x => x.id === a.caseId);
        return !c || !c.counterApplicable || c.stage <= 3;
      }).map(a => a.id).join(' ') || '0 条孤儿');
    add('未实施反制的案件不得把「反制处置」标为已完成（不得断言未发生的事）',
      cases.filter(c => !c.counterApplicable).every(c => c.steps[3].done === false && c.steps[3].t === '不适用'),
      '0 件',
      cases.filter(c => !c.counterApplicable && (c.steps[3].done || c.steps[3].t !== '不适用')).length + ' 件');
    add('信号干扰授权仅出现在实施了干扰的案件上',
      authLogs.filter(a => a.type === '公安授权信号干扰')
        .every(a => (cases.find(x => x.id === a.caseId) || {}).jamApplicable === true),
      '100% 对应',
      authLogs.filter(a => a.type === '公安授权信号干扰'
        && (cases.find(x => x.id === a.caseId) || {}).jamApplicable !== true).length + ' 条不符');
    /* 频段守卫按**出处**放行，不按取值放行。
       原先是一张值黑名单（GNSS/2.4GHz/5.8GHz/900M/1.3G 一律判假）——
       那等于把"目前没有资料"固化成了"这些值永远是错的"。
       资料一旦到位，黑名单会**主动拒绝正确答案，而且拒绝时看起来像在保护我们**。
       改为：要么明确留白，要么给出处；两者都没有才算编造。 */
    const bandUnknown = b => b == null || /^【待确认/.test(String(b));
    const bandBad = authLogs.filter(a => !bandUnknown(a.band) && !String(a.bandSource || '').trim());
    add('干扰频段要么留白、要么带出处（bandSource），不得裸填具体值',
      bandBad.length === 0,
      '0 条无出处频段',
      bandBad.length + ' 条填了具体频段却没写出处：'
        + [...new Set(bandBad.map(a => a.band))].slice(0, 3).join('/'));

    /* 下面三条把**资料原文的数值直接写死在断言里**，而不是回调 channelsFor()。
       回调等于两端同源：channelsFor 写错了，断言跟着一起错，永远绿。
       写死原文值之后，实现一旦偏离资料，这里就会红。 */
    const jamLogs = authLogs.filter(a => a.type === '公安授权信号干扰');
    const chStr = a => (a.channels || []).join(',');
    const forced = jamLogs.filter(a => a.result === '迫降');
    add('迫降的干扰记录＝四路全开（资料原文：迫降 四路全开）',
      forced.every(a => chStr(a) === '1,2,3,4' && a.gnssJam === true),
      forced.length + ' 条均为 1,2,3,4',
      forced.filter(a => chStr(a) !== '1,2,3,4' || a.gnssJam !== true).length + ' 条通道集合与原文不符');
    const repelled = jamLogs.filter(a => a.result === '退出管制区');
    add('驱离的干扰记录＝除 ch2(1.5G) 外全开（资料原文：驱离 除1.5不开）',
      repelled.every(a => chStr(a) === '1,3,4' && a.gnssJam === false),
      repelled.length + ' 条均为 1,3,4 且未开卫星导航干扰',
      repelled.filter(a => chStr(a) !== '1,3,4' || a.gnssJam !== false).length + ' 条通道集合与原文不符');
    const undef = jamLogs.filter(a => a.result === '返航' || a.result === '无效');
    /* 干扰记录里"没有通道"必须**恰好**发生在资料未定义的处置方式上。
       右端不是回调 bandNote/channelsFor，而是按资料原文定义过的两种方式反推，
       所以实现漏了一种、或多补了一种，两边数字都会对不上。 */
    const docDefined = ['迫降', '退出管制区'];
    add('干扰记录缺通道的条数 = 资料未定义该处置方式的条数（不可判定必须显式声明）',
      jamLogs.filter(a => a.channels == null).length
        === jamLogs.filter(a => !docDefined.includes(a.result)).length,
      jamLogs.filter(a => !docDefined.includes(a.result)).length + ' 条待确认',
      '缺通道 ' + jamLogs.filter(a => a.channels == null).length
        + ' 条 ≠ 未定义处置方式 ' + jamLogs.filter(a => !docDefined.includes(a.result)).length + ' 条');
    add('原文未定义通道组合的处置方式（返航/无效）不得编造通道',
      undef.every(a => a.channels == null && a.band == null),
      undef.length + ' 条留空',
      undef.filter(a => a.channels != null).length + ' 条替原文补了通道');
    add('非信号干扰的反制记录不谈频段（通道属于干扰设备）',
      authLogs.filter(a => a.type !== '公安授权信号干扰').every(a => a.band == null && a.channels == null),
      '0 条越界',
      authLogs.filter(a => a.type !== '公安授权信号干扰' && a.band != null).length + ' 条非干扰记录填了频段');
    /* 1.3G 单独拉黑：它不是"暂时没依据"，是**已查明的误读产物**
       —— v8.6 那行「900M,1.3G」是格式示例，被当成枚举去问了客户。
       这条与上面那条性质不同，所以不能合并：上面等资料，这条等不到。 */
    add('干扰频段不得出现 1.3G（已查明系格式示例被误读为枚举）',
      !authLogs.some(a => /1\.3\s*G/i.test(String(a.band))),
      '0 条',
      authLogs.filter(a => /1\.3\s*G/i.test(String(a.band))).length + ' 条出现 1.3G');

    /* ---- 追加型台账对账（右端均不从台账自身派生）---- */
    add('证据·反制授权引擎条数 = 授权记录条数（双向无孤儿）',
      (function () {
        const ev = evidenceFiles.filter(f => f.kind === '指令报文与回执');
        const ids = new Set(authLogs.map(a => a.id));
        return ev.length === authLogs.length
          && ev.every(f => (f.refs || []).some(r => r.kind === 'authLog' && ids.has(r.id)));
      })(),
      authLogs.length + ' ↔ ' + authLogs.length,
      evidenceFiles.filter(f => f.kind === '指令报文与回执').length + ' ↔ ' + authLogs.length);
    add('证据·处罚文书条数 = 已结案案件数',
      evidenceFiles.filter(f => f.kind === '处罚文书').length === cases.filter(c => c.status === '已结案').length,
      cases.filter(c => c.status === '已结案').length + ' 件',
      evidenceFiles.filter(f => f.kind === '处罚文书').length + ' ↔ ' + cases.filter(c => c.status === '已结案').length);
    add('通报记录覆盖所有已通知及之后的风险事件（双向）',
      (function () {
        const need = riskEvents.filter(e => ['已通知', '处置中', '已处置', '已归档'].indexOf(e.status) >= 0);
        return need.every(e => noticesOf(e.id).length > 0)
          && riskNotices.every(x => !x.eventId || riskEvents.some(e => e.id === x.eventId));
      })(), '双向 0 差异', '双向 0 差异');

    /* 上级同步记录 */
    add('同步记录均标明来源模块与产生动作',
      riskNotices.every(x => x.srcModule && x.action),
      '100% 可说明',
      riskNotices.filter(x => !x.srcModule || !x.action).length + ' 条说不清');
    add('同步记录的 refs 与证据台账同构（[{kind,id}]，不用单值字段承载关联）',
      riskNotices.every(x => Array.isArray(x.refs) && x.refs.length
        && x.refs.every(r => r && r.kind && r.id)),
      '100% 同构',
      riskNotices.filter(x => !Array.isArray(x.refs) || !x.refs.length).length + ' 条不符');
    add('同步记录的回执为状态机且失败可计次（不得是一个写死的词）',
      riskNotices.every(x => ACK_STATUS.indexOf(x.ackStatus) >= 0 && typeof x.retry === 'number'),
      ACK_STATUS.join('/') + ' + retry',
      riskNotices.filter(x => ACK_STATUS.indexOf(x.ackStatus) < 0 || typeof x.retry !== 'number').length + ' 条不符');

    /* 规则版本台账（设计 §8.5 说的是"规则"，覆盖空域与航线两类） */
    /* 案件状态与流程 */
    add('案件状态取自唯一推导来源 caseStatusOf（不得各写一份 stage→status 换算）',
      cases.every(c => c.status === caseStatusOf(c)),
      '100% 同源',
      cases.filter(c => c.status !== caseStatusOf(c)).length + ' 件不一致');
    add('未立案的案件不得标为「已立案」及其之后的状态（法律记录不得高估进度）',
      cases.filter(c => c.stage < 3).every(c => c.status === '待核实'),
      '0 件高估',
      cases.filter(c => c.stage < 3 && c.status !== '待核实')
        .map(c => c.id + '(stage=' + c.stage + '→' + c.status + ')').join(' ') || '0 件高估');
    /* 三态一致性：不适用 ⇒ 未完成且时间为"不适用"；已完成 ⇔ 时间是时间戳 */
    const stepBad = c => c.steps.some(st =>
      st.applicable === false ? (st.done || st.t !== '不适用')
        : ((st.t !== '待处理') !== !!st.done));
    add('环节的「适用性/完成标记/完成时间」三者一致',
      cases.every(c => !stepBad(c)), '100% 一致',
      cases.filter(stepBad).length + ' 件不一致');
    add('每个处置环节都标明归属模块（否则无法阻止跨模块代为推进）',
      DISPOSAL_FLOW.every(f => !!f.owner)
      && cases.every(c => c.steps.every(st => !!st.owner)),
      '100% 有归属',
      DISPOSAL_FLOW.filter(f => !f.owner).map(f => f.n).join('/') || '100% 有归属');
    add('跨模块推进被拒绝（处罚页不能代为完成反制处置）',
      (function () {
        const c = cases.find(x => x.stage === 3);
        if (!c) {   // 没有恰好停在「立案已完成」的案件，用一个临时对象验规则本身
          const probe = { stage: 3, steps: DISPOSAL_FLOW.map(f => ({ n: f.n, owner: f.owner, done: false, act: false, t: '待处理' })) };
          return advanceCase(probe, '处置处罚管理').ok === false;
        }
        return advanceCase(Object.assign({}, c, { steps: c.steps.map(x => Object.assign({}, x)) }), '处置处罚管理').ok === false;
      })(),
      '拒绝', '拒绝');

    add('规则版本类型均在 RULE_KINDS 枚举内',
      ruleVersions.every(v => RULE_KINDS.some(k => k.key === v.ruleKind)),
      RULE_KINDS.map(k => k.key).join('/'),
      [...new Set(ruleVersions.map(v => v.ruleKind))].join('/'));
    add('每类规则有且只有一个「当前生效」版本',
      RULE_KINDS.every(k => versionsOf(k.key).filter(v => v.status === '当前生效').length === 1),
      '每类各 1 个',
      RULE_KINDS.map(k => k.name + ':' + versionsOf(k.key).filter(v => v.status === '当前生效').length).join(' '));
    add('每类规则的版本台账非空（航线与空域共用同一份治理机制）',
      RULE_KINDS.every(k => versionsOf(k.key).length > 0),
      '两类均有版本记录',
      RULE_KINDS.map(k => k.name + ':' + versionsOf(k.key).length + ' 条').join(' '));
    add('版本记录均含发布时间、发布人与变更说明（缺任一项则无法审计）',
      ruleVersions.every(v => v.publishedAt && v.publisher && Array.isArray(v.changes) && v.changes.length),
      '100% 完整',
      ruleVersions.filter(v => !(v.publishedAt && v.publisher && Array.isArray(v.changes) && v.changes.length)).length + ' 条不完整');

    add('不存在依赖兜底解析的目标类型（全部登记在 OBJECT_TYPES 内）',
      allTargets.every(t => OBJECT_TYPES.some(o => o.name === t.type)),
      '0 个走兜底',
      [...new Set(allTargets.filter(t => !OBJECT_TYPES.some(o => o.name === t.type)).map(t => t.type))].join('/') || '0 个走兜底');

    add('不存在依赖兜底解析的空域（类型与来源都能精确匹配到登记表）',
      airspaces.every(a => !airspaceType(a.type).unknown && !airspaceSource(a.source).unknown),
      '0 条走兜底',
      airspaces.filter(a => airspaceType(a.type).unknown || airspaceSource(a.source).unknown)
        .map(a => a.id + '(' + a.type + '/' + a.source + ')').join(' ') || '0 条走兜底');
    add('未识别的空域类型按最严处理（fail-closed，不得放行）',
      airspaceType('__不存在的类型__').forbidsAllPlans === true
      && airspaceSource('__不存在的来源__').editable === false,
      '未识别→禁止/只读',
      `未识别类型 forbidsAllPlans=${airspaceType('__x__').forbidsAllPlans} / 未识别来源 editable=${airspaceSource('__x__').editable}`);

    add('每条空域都声明数据来源，且只读性与来源一致',
      airspaces.every(a => AIRSPACE_SOURCES.some(x => x.key === a.source)
        && a.editable === airspaceSource(a.source).editable),
      '100% 声明且一致',
      airspaces.filter(a => !AIRSPACE_SOURCES.some(x => x.key === a.source)
        || a.editable !== airspaceSource(a.source).editable).length + ' 条不符');
    add('上级下发的空域本地不可编辑（改了会被下次同步覆盖）',
      airspaces.filter(a => a.source === '上级管控平台').every(a => a.editable === false),
      '100% 只读',
      airspaces.filter(a => a.source === '上级管控平台' && a.editable !== false).length + ' 条可改');

    add('每个角色至少有一个可用账号（否则该角色的权限行永远演示不到）',
      ROLES.every(r => users.some(u => u.role === r.id && u.status === '正常')),
      '5 个角色均有可用账号',
      ROLES.filter(r => !users.some(u => u.role === r.id && u.status === '正常')).map(r => r.name).join('/') || '5 个角色均有可用账号');
    add('权限判定取自 PERM 矩阵（不得另存一份权限副本）',
      ROLES.every(r => PERM_MODULES.every(m => {
        const lv = permLevel(r.id, m);
        return PERM_LEVELS[lv] !== undefined;
      })), '100% 取自矩阵', '100% 取自矩阵');
    add('反制/干扰授权仅超管与处置授权人可授权（§6.3 人在回路）',
      ROLES.every(r => (permLevel(r.id, '反制/干扰授权') === 'AUTH') === (r.id === 'R1' || r.id === 'R2')),
      '仅 R1/R2',
      ROLES.filter(r => (permLevel(r.id, '反制/干扰授权') === 'AUTH') !== (r.id === 'R1' || r.id === 'R2')).map(r => r.id).join('/') || '仅 R1/R2');
    add('停用账号不具备任何操作权限',
      (function () {
        const dis = users.find(u => u.status !== '正常');
        if (!dis) return false;
        const keep = _currentUserId; _currentUserId = dis.id;
        const ok = !can('综合态势总览', 'read') && !can('反制/干扰授权', 'auth');
        _currentUserId = keep;
        return ok;
      })(), '停用账号 0 权限', '停用账号 0 权限');

    add('调测结论由本次实测指标与阈值推导（不得独立抽取）',
      commTasks.every(t => t.result === (t.items.every(x => x.ok) ? '成功' : '失败')),
      '100% 可推导',
      commTasks.filter(t => t.result !== (t.items.every(x => x.ok) ? '成功' : '失败')).length + ' 条不一致');
    add('调测单项判定与阈值一致（阈值取自 COMM_TH，不得各写一份）',
      commTasks.every(t => t.items.every(x =>
        x.ok === (x.v <= x.th) && x.th === COMM_TH[{ '时延': 'latencyMs', '丢包率': 'lossPct', '抖动': 'jitterMs' }[x.k]])),
      '100% 一致',
      commTasks.filter(t => t.items.some(x => x.ok !== (x.v <= x.th))).length + ' 条不一致');
    add('失败的调测必须列出不合格项（说不出哪项不合格的结论无法复核）',
      commTasks.filter(t => t.result === '失败').every(t => t.failedItems.length > 0)
      && commTasks.filter(t => t.result === '成功').every(t => t.failedItems.length === 0),
      '一一对应',
      commTasks.filter(t => (t.result === '失败') !== (t.failedItems.length > 0)).length + ' 条不一致');

    add('用户与权限：角色用户数合计 = 用户总数',
      ROLES.reduce((t, r) => t + r.users, 0) === users.length, users.length, ROLES.reduce((t, r) => t + r.users, 0));
    /* ---- C2:协议对齐断言（V1.1 任务书 C 节）---- */
    add('设备台账：每台设备均带协议 deviceType / deviceTypeAbbr',
      devices.every(d => typeof d.deviceType === 'number' && d.deviceTypeAbbr),
      '100%', devices.every(d => typeof d.deviceType === 'number') ? '100%' : '存在缺失');
    // 注：本断言只覆盖数据层；页面代码中的残留由 tools/scan.js 源码扫描负责
    add('数据层：融合权重与目标源卡中无协议外数据源',
      !Object.keys(fusionWeights).some(k => /ADS-?B/i.test(k)) &&
      !Object.keys(liveTargets[0].fused).some(k => /ADS-?B/i.test(k)),
      '0 处', Object.keys(fusionWeights).filter(k => /ADS-?B/i.test(k)).length + ' 处');
    /* 原断言是「型号必须**全部**是占位」。那在所有设备都没资料时是对的，
       但它把"目前没有资料"固化成了"永远不许有值" —— 与频段黑名单同一个毛病：
       资料一到，它就会**主动拒绝正确答案**（T02 规格书到位当天它就报红了）。
       改为按**出处**放行：要么是占位，要么是三方对照 §135 登记过的真值。
       KNOWN_IDENT 里列的是已定论的，没列的一律仍须占位 —— 编造依然报红。 */
    /* ---- 雷达能力边界（T02 规格书，2026-08-27 到位）----
       右端是规格书上的数，不是回调生成逻辑，所以生成逻辑改坏了这里会红。
       这三条在规格书到位之前**无法存在**——cover/量程一直是 TBC。 */
    {
      const rst = devices.filter(v => v.type === '雷达').map(v => ({ lon: v.lon, lat: v.lat }));
      const rt = allTargets.filter(t => t.source === '融合感知箱');
      /* 断言这一端**故意不用 distKm** —— 生成侧用的就是它，两端同源的话
         公式本身写错时这条断言不会报红（同源断言只能查漂移，查不出实现错）。
         这里用大圆距离（haversine）独立算一遍：**两个实现都判在界内才算过**。
         两者在本纬度上差约 0.4%（3.5km 上约 13 m），只在卡边界的目标上才现形 ——
         已知有 1 个鸟类目标正落在这个夹缝里（平面 3.4934 / 大圆 3.5062 km），
         按更保守的大圆值判定，所以生成侧留了余量而不是贴着 3.5 生成。 */
      const gcKm = (a, b) => {
        const R = 6371.0088, rad = x => x * Math.PI / 180;
        const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
        const h = Math.sin(dLat / 2) ** 2
          + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
      };
      const out = rt.filter(t => !rst.some(r => gcKm(r, t) <= T02.rangeKm));
      add('雷达探测的目标必须落在某部雷达的探测量程内（T02：' + T02.rangeKm + ' km）',
        out.length === 0, '0 个越界',
        out.length + ' 个目标在所有雷达量程外却记为雷达探测（大圆距离），最远 '
          + (out.length ? Math.max(...out.map(t => Math.min(...rst.map(r => gcKm(r, t))))).toFixed(2) : 0) + ' km');
      const hi = rt.filter(t => t.heightAgl != null && t.heightAgl > T02.maxAltM);
      add('雷达探测的目标不得超过最大探测高度（T02：' + T02.maxAltM + ' m）',
        hi.length === 0, '0 个越界', hi.length + ' 个超过 ' + T02.maxAltM + ' m');
      const sp = rt.filter(t => t.speed < T02.speedMin || t.speed > T02.speedMax);
      add('雷达探测的目标速度须在测量范围内（T02：' + T02.speedMin + '-' + T02.speedMax + ' m/s）',
        sp.length === 0, '0 个越界', sp.length + ' 个超出速度测量范围');
    }
    {
      const types = [...new Set(devices.map(d => d.type))];
      const unregistered = types.filter(t =>
        !COVERAGE_ENFORCED.includes(t) && !COVERAGE_UNVERIFIABLE.includes(t));
      add('每类设备的探测范围约束，要么在执行、要么登记为执行不了（不得有第三种状态）',
        unregistered.length === 0, types.length + ' 类均已登记',
        unregistered.length + ' 类既未执行也未登记：' + unregistered.join('/'));
      /* 反向也要卡：登记为"在执行"的类型，其 cover 不能还是占位 ——
         否则又回到"声称在管、其实没数"的老状态。 */
      const fake = COVERAGE_ENFORCED.filter(t =>
        devices.filter(d => d.type === t).some(d => /待确认|TBC/.test(String(d.cover))));
      add('声称已执行范围校验的设备类型，必须真的有量程值',
        fake.length === 0, '0 类空转', fake.join('/') + ' 声称在校验但 cover 仍是占位');
    }
    /* 协议不存在的主机指标不得出现在设备对象上。
       右端列的是**字段名黑名单**而不是"必须为空"，因为这几个字段的问题不是取值不对，
       而是**它们本身不该存在** —— 协议里没有这条上报，平台就没有这个数。 */
    {
      const HOST_METRIC_FORBIDDEN = ['cpu', 'mem', 'disk'];
      const bad = devices.filter(d => HOST_METRIC_FORBIDDEN.some(k => k in d));
      add('设备对象不得携带协议不存在的主机指标字段（cpu/mem/disk）',
        bad.length === 0, '0 台携带',
        bad.length + ' 台仍带主机指标：'
          + [...new Set(bad.flatMap(d => HOST_METRIC_FORBIDDEN.filter(k => k in d)))].join('/'));
    }
    /* ---- 计划命中必须经得起点开验证 ----
       这条把"结论反向生成观测事实"的路彻底封死：
       matched_plan_id 不再是判成合法之后配的一个号，而是**必须真的对得上**——
       计划存在、时窗真包含这次飞行、走廊真覆盖这个位置。
       几何这一端独立实现，不调 distToPolylineM（两端同源就查不出实现错）。 */
    {
      const segKm2 = (p, a, b) => {
        const phi = p.lat * Math.PI / 180;
        const ky = (111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)) / 1000;
        const kx = (111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)) / 1000;
        const apx = (p.lon - a.lon) * kx, apy = (p.lat - a.lat) * ky;
        const abx = (b.lon - a.lon) * kx, aby = (b.lat - a.lat) * ky;
        const ab2 = abx * abx + aby * aby;
        let u = ab2 ? (apx * abx + apy * aby) / ab2 : 0;
        u = Math.max(0, Math.min(1, u));
        const dx = apx - abx * u, dy = apy - aby * u;
        return Math.sqrt(dx * dx + dy * dy);
      };
      const polyKm2 = (p, w) => { let b = Infinity;
        for (let i = 0; i + 1 < w.length; i++) { const d = segKm2(p, w[i], w[i + 1]); if (d < b) b = d; }
        return b; };
      const tms2 = v => new Date(String(v).replace(' ', 'T')).getTime();
      const why = t => {
        const pl = flightPlans.find(x => x.id === t.matched_plan_id);
        if (!pl) return t.id + ' 指向不存在的计划 ' + t.matched_plan_id;
        if (t.ts < tms2(pl.start)) return t.id + ' 飞行于 ' + fmtDT(new Date(t.ts))
          + '，而计划 ' + pl.id + ' 起于 ' + pl.start + '（先飞后批）';
        if (t.ts > tms2(pl.end)) return t.id + ' 飞行时刻晚于计划 ' + pl.id + ' 结束时间 ' + pl.end;
        const r = pl.routeId ? routeById(pl.routeId) : null;
        if (!r || !(r.waypoints || []).length) return t.id + ' 的计划 ' + pl.id + ' 无航线几何';
        const half = (r.widthM / 2 + (r.widthTolM || 0)) / 1000;
        return t.id + ' 距计划航线 ' + polyKm2(t, r.waypoints).toFixed(2) + ' km，超出走廊半宽 ' + half.toFixed(2) + ' km';
      };
      const bad = allTargets.filter(t => t.matched_plan_id).filter(t => {
        const pl = flightPlans.find(x => x.id === t.matched_plan_id);
        if (!pl) return true;
        if (t.ts < tms2(pl.start) || t.ts > tms2(pl.end)) return true;
        const r = pl.routeId ? routeById(pl.routeId) : null;
        if (!r || !(r.waypoints || []).length) return true;
        return polyKm2(t, r.waypoints) > (r.widthM / 2 + (r.widthTolM || 0)) / 1000 + 0.02;
      });
      add('命中的计划必须真的对得上：计划存在 + 时窗包含飞行时刻 + 走廊覆盖位置',
        bad.length === 0,
        allTargets.filter(t => t.matched_plan_id).length + ' 条命中全部可验证',
        /* 失败时直接给出**是哪一条、为什么**，不要只报个数 —— 报红之后还得再查一遍
           才知道查什么，那份时间是白花的。 */
        bad.length + ' 条对不上：' + bad.slice(0, 2).map(why).join('；'));

      add('未命中的架次不得携带 matched_plan_id（结论不得反向生成证据）',
        !allTargets.some(t => t.matched_plan_id && t.facts && t.facts.planMatch === '未命中'),
        '0 条',
        allTargets.filter(t => t.matched_plan_id && t.facts && t.facts.planMatch === '未命中')
          .map(t => t.id).slice(0, 3).join('/') || '0 条');

      add('计划比对候选来自真实覆盖，不得独立抽取（planCandidate 与几何一致）',
        allTargets.filter(t => t.facts && t.facts.planCandidate)
          .every(t => t.facts.planCandidateId
            && flightPlans.some(pl => pl.id === t.facts.planCandidateId)),
        '100% 有据',
        allTargets.filter(t => t.facts && t.facts.planCandidate && !t.facts.planCandidateId)
          .map(t => t.id).slice(0, 3).join('/') || '100% 有据');
    }
    /* ---- C01 维度的判别力登记（与风险三因子那条同一形状）----
       某个维度如果**全库恒为 null**，它就不参与任何判定，
       而 gradePlanMatch 要求五维全为真才算「完全命中」——
       于是只要有一维恒 null，「完全命中」就永远出不来。
       这件事必须显式登记：否则界面上「完全命中」看起来只是"暂时没碰上"，
       实际它是**结构上不可达**。（页面 RULES 里 C01 的说明与这里对应。）
       双向校验：恒 null 的维度必须在册；一旦它恢复判别力，必须从册上摘掉。 */
    {
      const uavT = allTargets.filter(t => t.type === '无人机' && t.facts && t.facts.planMatchDims);
      const varies = d => uavT.some(t => t.facts.planMatchDims[d] !== null);
      const C01_VACUOUS = ['起降点'];       // 目标对象无起飞点字段，无法与计划起降点比对
      const shouldList = C01_DIMS.filter(d => !varies(d));
      const missing = shouldList.filter(d => C01_VACUOUS.indexOf(d) < 0);
      const stale = C01_DIMS.filter(d => varies(d) && C01_VACUOUS.indexOf(d) >= 0);
      add('恒不可判定的 C01 维度必须登记，且恢复判别力后要摘掉',
        missing.length === 0 && stale.length === 0,
        '登记表与实测一致（当前恒 null：' + (shouldList.join('/') || '无') + '）',
        (missing.length ? '未登记：' + missing.join('/') + '；' : '')
          + (stale.length ? '已恢复判别力却仍在册：' + stale.join('/') : '')
          || '在册：' + (C01_VACUOUS.join('/') || '无') + '；实测恒 null：' + (shouldList.join('/') || '无'));
      /* 有恒 null 维度时，「完全命中」必然为 0 —— 这条把上面那句话钉成可验证的。
         右端不是回调 gradePlanMatch（同源），而是直接数结果。 */
      add('存在恒不可判定维度时，C01 不得出现「完全命中」',
        shouldList.length === 0
          || uavT.filter(t => t.facts.planMatch === '完全命中').length === 0,
        '0 条完全命中（因 ' + (shouldList.join('/') || '—') + ' 恒不可判定）',
        uavT.filter(t => t.facts.planMatch === '完全命中').length + ' 条完全命中，与恒 null 维度矛盾');
    }
    /* 每条空域类违规都必须指得出**是哪一块空域**，而且那块空域的类型要对得上事由。
       这条守的是"被点名的对象是不是真的"：结论可以是真的，referent 却可能是编的
       —— 页面曾按 district 另查一遍空域，把限高区当成禁飞区点名。
       右端按事由 ↔ 空域类型的对应关系反查，不回调 zoneHits 的生成逻辑。 */
    {
      const REASON_TYPE = { '进入': '禁飞空域', '超限高': '限高区域', '管制时段': '临时管制区' };
      const VIO_REASON = { '侵入禁飞区': '进入', '超出空域限高': '超限高', '超出空域管制时段': '管制时段' };
      const bad = [];
      allTargets.forEach(t => {
        const vs = t.violation_reasons || [];
        Object.keys(VIO_REASON).forEach(v => {
          if (vs.indexOf(v) < 0) return;
          const hit = ((t.facts && t.facts.zoneHits) || []).find(x => x.reason === VIO_REASON[v]);
          if (!hit) { bad.push(t.id + ' 的「' + v + '」找不到对应的空域命中记录'); return; }
          const z = airspaces.find(a => a.id === hit.id);
          if (!z) { bad.push(t.id + ' 的「' + v + '」指向不存在的空域 ' + hit.id); return; }
          /* 限高只可能出自「限高区域」以外的空域吗？不一定 —— 禁飞区也可以有限高。
             所以这里只对"进入"卡死类型：能让全平台无权批准的只有禁飞类空域。 */
          if (VIO_REASON[v] === '进入' && !AIRSPACE_TYPES.find(x => x.type === z.type && x.forbidsAllPlans)) {
            bad.push(t.id + ' 的「' + v + '」点名了 ' + z.type + '「' + z.name + '」，该类型并不禁止全部飞行');
          }
        });
      });
      add('空域类违规必须指得出是哪一块空域，且该空域类型与事由相符',
        bad.length === 0,
        allTargets.filter(t => (t.violation_reasons || []).some(v => /禁飞|限高|管制时段/.test(v))).length + ' 条均可追溯',
        bad.length + ' 条对不上：' + bad.slice(0, 2).join('；'));
    }
    /* 空域来源单一且只读 —— 纪要 §4.1 平台只"接收"空域。
       右端写死「上级管控平台」这个字面值，不回调生成逻辑：
       生成侧若改回按类型分流，这里就会红。 */
    {
      const notUpper = airspaces.filter(z => z.source !== '上级管控平台');
      add('空域来源一律为上级下发（纪要 §4.1 平台只接收，不本地设立）',
        notUpper.length === 0, airspaces.length + ' 个均为上级下发',
        notUpper.length + ' 个仍标本地设立：' + notUpper.map(z => z.id + '(' + z.type + ')').join('/'));
      const editable = airspaces.filter(z => z.editable !== false);
      add('空域一律不可本地编辑（新增/编辑/删除属越界 D-03）',
        editable.length === 0, '0 个可编辑',
        editable.length + ' 个仍可编辑：' + editable.map(z => z.id).join('/'));
    }
    add('设备台账：型号/厂家要么是占位，要么是已登记的真值（不得编造）',
      devices.every(d => identOk(d)), '0 条编造',
      devices.filter(d => !identOk(d)).length + ' 条既非占位也不在登记表内：'
        + [...new Set(devices.filter(d => !identOk(d)).map(d => d.type + '=' + d.model))].slice(0, 3).join('/'));
    add('告警状态取值均在 alarm_status 枚举内',
      alarms.every(a => ALARM_STATUS.includes(a.status)), ALARM_STATUS.join('/'),
      [...new Set(alarms.map(a => a.status))].join('/'));
    add('案件状态取值均在 case_status 枚举内',
      cases.every(c => CASE_STATUS.includes(c.status)), CASE_STATUS.join('/'),
      [...new Set(cases.map(c => c.status))].join('/'));
    add('处置流程为设计表 9-3 的六环节（三页共用同一常量）',
      DISPOSAL_FLOW.length === 6 && cases.every(c => c.steps.length === 6),
      '6 环节', DISPOSAL_FLOW.length + ' 环节');
    add('目标编号格式统一（类型前缀 + YYYYMMDD + NNN）',
      allTargets.every(t => new RegExp('^(' + OBJECT_TYPES.map(o => o.abbr).join('|') + ')\\d{8}\\d{3}$').test(t.id)), '100%', '100%');
    add('目标编号前缀与目标类型一致',
      allTargets.every(t => t.id.slice(0, 3) === objAbbr(t.type)),
      '100%', '100%');
    /* Schema 字段与事实同源 —— falsify 里「source_confidence 与 facts 脱钩」一直是条无人捕获的注入，
       说明这道防线只存在于构造代码的写法里，没有断言守着：改一处赋值就能让两者分叉且无人察觉。 */
    add('source_confidence 由 facts.sourceConfidence 派生（不得各存一份）',
      allTargets.filter(t => t.facts && t.facts.sourceConfidence != null)
        .every(t => t.source_confidence === t.facts.sourceConfidence),
      '100% 同源',
      allTargets.filter(t => t.facts && t.facts.sourceConfidence != null
        && t.source_confidence !== t.facts.sourceConfidence).length + ' 个脱钩');

    /* ---- 航线实体（设计 §8.5）---- */
    add('航线走廊几何完整（≥2 个航路点且坐标在东营范围内）',
      routes.length > 0 && routes.every(r => Array.isArray(r.waypoints) && r.waypoints.length >= 2
        && r.waypoints.every(w => w.lon > CONF.bounds.lon0 && w.lon < CONF.bounds.lon1
          && w.lat > CONF.bounds.lat0 && w.lat < CONF.bounds.lat1)),
      routes.length + ' 条均合规',
      routes.filter(r => !Array.isArray(r.waypoints) || r.waypoints.length < 2
        || r.waypoints.some(w => w.lon <= CONF.bounds.lon0 || w.lon >= CONF.bounds.lon1
          || w.lat <= CONF.bounds.lat0 || w.lat >= CONF.bounds.lat1)).length + ' 条越界或点数不足');
    add('航线状态取值均在枚举内',
      routes.every(r => ROUTE_STATUS.indexOf(r.status) >= 0),
      ROUTE_STATUS.join('/'), [...new Set(routes.map(r => r.status))].join('/'));
    add('航线高度基准与空域同一约定（不引入第三套基准）',
      routes.every(r => ['agl', 'amsl'].indexOf(r.altDatum) >= 0),
      'agl/amsl', [...new Set(routes.map(r => r.altDatum))].join('/'));
    add('计划与航线双向关联自洽',
      flightPlans.filter(p => p.routeId).every(p => {
        const r = routeById(p.routeId);
        return r && r.planIds.indexOf(p.id) >= 0;
      }) && routes.every(r => r.planIds.every(id => {
        const p = flightPlans.find(x => x.id === id);
        return p && p.routeId === r.id;
      })),
      '双向一致',
      flightPlans.filter(p => p.routeId && !(routeById(p.routeId) || { planIds: [] }).planIds.includes(p.id)).length + ' 条单向');
    add('航路点数不在数据层另存字符串（由 waypoints 派生）',
      flightPlans.every(p => !Object.prototype.hasOwnProperty.call(p, 'route')
        || Object.getOwnPropertyDescriptor(p, 'route').get !== undefined),
      '派生属性',
      flightPlans.filter(p => Object.prototype.hasOwnProperty.call(p, 'route')
        && !Object.getOwnPropertyDescriptor(p, 'route').get).length + ' 条存了字符串副本');

    /* ---- C01 三档匹配 ---- */
    const uavF = allTargets.filter(t => t.facts && t.facts.appliesLegality !== false && t.type === '无人机');
    add('C01 匹配结果取值均在三档枚举内',
      uavF.every(t => PLAN_MATCH.indexOf(t.facts.planMatch) >= 0),
      PLAN_MATCH.join('/'), [...new Set(uavF.map(t => t.facts.planMatch))].join('/'));
    add('任一维度不可判定即不得报「完全命中」（五维度须全部命中）',
      uavF.filter(t => t.facts.planMatch === '完全命中')
        .every(t => C01_DIMS.every(d => t.facts.planMatchDims[d] === true)),
      '0 个含 null/false 却报完全命中',
      uavF.filter(t => t.facts.planMatch === '完全命中'
        && !C01_DIMS.every(d => t.facts.planMatchDims[d] === true)).length + ' 个');
    add('C01 航线走廊维度与 C02-3 偏航判定同源（不得各自抽样）',
      uavF.every(t => t.facts.planMatchDims['航线走廊']
        === (t.facts.offRoute === null ? null : !t.facts.offRoute)),
      '100% 同源',
      uavF.filter(t => t.facts.planMatchDims['航线走廊']
        !== (t.facts.offRoute === null ? null : !t.facts.offRoute)).length + ' 个脱钩');
    add('「未经批准飞行」当且仅当 C01 未命中',
      uavF.every(t => ((t.violation_reasons || []).indexOf('未经批准飞行') >= 0)
        === (t.facts.planMatch === '未命中')),
      '一一对应',
      uavF.filter(t => ((t.violation_reasons || []).indexOf('未经批准飞行') >= 0)
        !== (t.facts.planMatch === '未命中')).length + ' 个不一致');
    add('部分命中且无其他越界依据的目标不得判为非法（§10.2 部分命中不直接定性）',
      uavF.filter(t => t.facts.planMatch === '部分命中'
        && !t.facts.inNoFlyZone && !t.facts.overZoneHeight && !t.facts.overZoneTime)
        .every(t => t.legal !== '非法'),
      '0 个',
      uavF.filter(t => t.facts.planMatch === '部分命中' && !t.facts.inNoFlyZone
        && !t.facts.overZoneHeight && !t.facts.overZoneTime && t.legal === '非法').length + ' 个');

    /* ---- 航线偏离：无几何数据不得产生该事由 ---- */
    /* 计划对照的横向偏航需要「计划 ↔ 实际架次」的关联，而 flightPlans 与 allTargets
       目前没有这条关联（matched 只是个标签）。所以即便走廊几何与航迹都齐了，
       plan-vs-actual 仍算不出来 —— 保持声明不可判定，不得给出数值。
       断言不做 ROUTE_GEOM_READY 短路：短路后它会变成恒真断言。 */
    add('计划对照的横向偏航须声明不可判定，且不得给出数值',
      flightPlans.filter(p => p.deviation).every(p =>
        p.deviation.lateral === null && (p.deviation.undeterminable || []).indexOf('横向偏航') >= 0),
      '100% 声明不可判定',
      flightPlans.filter(p => p.deviation && !(p.deviation.lateral === null
        && (p.deviation.undeterminable || []).indexOf('横向偏航') >= 0)).length + ' 条仍给数值');

    /* 注意：这条原来写成「ROUTE_GEOM_READY || 没有该事由」，几何接入后会短路成恒真。
       改为在两种状态下都有实义的判据：事由必须与 facts.offRoute 一一对应。 */
    add('「偏离报备航线」当且仅当 facts.offRoute 为 true',
      allTargets.filter(t => t.facts && t.facts.appliesLegality !== false).every(t =>
        ((t.violation_reasons || []).indexOf('偏离报备航线') >= 0) === (t.facts.offRoute === true)),
      '一一对应',
      allTargets.filter(t => t.facts && t.facts.appliesLegality !== false
        && ((t.violation_reasons || []).indexOf('偏离报备航线') >= 0) !== (t.facts.offRoute === true)).length + ' 个不一致');
    add('判偏航的架次必须同时具备走廊几何与实际航迹（两个输入缺一不可）',
      allTargets.filter(t => t.facts && t.facts.offRoute === true).every(t =>
        t.routeId && routeById(t.routeId) && Array.isArray(t.track_points) && t.track_points.length >= 2),
      '100% 具备',
      allTargets.filter(t => t.facts && t.facts.offRoute === true
        && !(t.routeId && Array.isArray(t.track_points) && t.track_points.length >= 2)).length + ' 个缺输入');
    add('offRoute 结论与轨迹几何独立复算一致（结论是算出来的，不是设定的）',
      allTargets.filter(t => t.facts && t.facts.offRoute !== null && t.routeId).every(t => {
        const r = routeById(t.routeId); if (!r) return false;
        // 断言必须能在数据畸形时判假，而不是抛异常 —— 抛异常等于这条防线在最需要它的时候失效
        if (!Array.isArray(t.track_points) || t.track_points.length < 2) return false;
        const half = r.widthM / 2 + r.widthTolM;
        let run = 0, maxRun = 0;
        t.track_points.forEach(pt => {
          const d = distToPolylineM(pt, r.waypoints);
          if (d > half) { run++; if (run > maxRun) maxRun = run; } else run = 0;
        });
        return (maxRun >= TRACK_MODEL.holdSamples) === (t.facts.offRoute === true);
      }), '100% 一致',
      allTargets.filter(t => t.facts && t.facts.offRoute !== null && t.routeId).length + ' 个已复算');
    add('无批准航线的架次不得判偏航（不适用 ≠ 违规）',
      allTargets.filter(t => t.facts && !t.routeId).every(t =>
        t.facts.offRoute !== true && (t.violation_reasons || []).indexOf('偏离报备航线') < 0),
      '0 个',
      allTargets.filter(t => t.facts && !t.routeId && (t.facts.offRoute === true
        || (t.violation_reasons || []).indexOf('偏离报备航线') >= 0)).length + ' 个');
    add('track_points 已填充（Schema V1 必需字段，此前全库为空属 C09 字段缺失）',
      allTargets.filter(t => t.type === '无人机').every(t => Array.isArray(t.track_points) && t.track_points.length >= 2),
      '100% 填充',
      allTargets.filter(t => t.type === '无人机' && !(Array.isArray(t.track_points) && t.track_points.length >= 2)).length + ' 个仍为空');
    add('track_status 由 facts.trackStatus 派生（不得各存一份）',
      allTargets.filter(t => t.facts && t.facts.trackStatus)
        .every(t => t.track_status === t.facts.trackStatus),
      '100% 同源',
      allTargets.filter(t => t.facts && t.facts.trackStatus && t.track_status !== t.facts.trackStatus).length + ' 个脱钩');
    /* 推导公式只适用于生成了航迹的无人机；非无人机不走航线模型，其轨迹状态另有来源。
       revised 的架次事实被复核修订过，公式自然不再成立，故排除。 */
    add('失锁区间的轨迹点标为弥合段，不得宣称为实测（§6.8）',
      allTargets.filter(t => t.facts && t.facts.trackOcclusion && Array.isArray(t.track_points))
        .every(t => t.track_points.some(p => p.kind === 'bridge')),
      '100% 有弥合段',
      allTargets.filter(t => t.facts && t.facts.trackOcclusion && Array.isArray(t.track_points)
        && !t.track_points.some(p => p.kind === 'bridge')).length + ' 个仍全标实测');
    add('未失锁的架次不得出现弥合段（弥合是失锁的结果，不是随机装饰）',
      allTargets.filter(t => t.facts && t.facts.trackOcclusion === false && Array.isArray(t.track_points))
        .every(t => t.track_points.every(p => p.kind === 'meas')),
      '0 个',
      allTargets.filter(t => t.facts && t.facts.trackOcclusion === false && Array.isArray(t.track_points)
        && t.track_points.some(p => p.kind !== 'meas')).length + ' 个');
    add('无人机轨迹状态与轨迹质量一致（终止 > 遮挡 > 异常机动 > 稳定）',
      allTargets.filter(t => t.type === '无人机' && t.facts && t.facts.maneuverEvents !== undefined
        && !t.revised && !t.factsOverridden)
        .every(t => t.facts.trackStatus === (t.facts.trackTerminated ? '终止'
          : t.facts.trackOcclusion ? '短时丢失' : (t.facts.maneuverEvents ? '暂定' : '稳定'))),
      '100% 一致',
      allTargets.filter(t => t.type === '无人机' && t.facts && t.facts.maneuverEvents !== undefined
        && !t.revised && !t.factsOverridden
        && t.facts.trackStatus !== (t.facts.trackTerminated ? '终止'
          : t.facts.trackOcclusion ? '短时丢失' : (t.facts.maneuverEvents ? '暂定' : '稳定'))).length + ' 个不一致');
    /* 上一条把 revised / factsOverridden 排除在外，这条负责守住那个排除口：
       凡事实与推导公式不符的，必须能说明原因（复核修订过，或被场景显式改写并留痕）。
       原先写成「有标记的目标都有标记」——只检查了带标记的那批，删掉标记反而检查不到，
       是一条与构造同源的循环断言。 */
    const formulaOf = t => t.facts.trackTerminated ? '终止'
      : t.facts.trackOcclusion ? '短时丢失' : (t.facts.maneuverEvents ? '暂定' : '稳定');
    add('事实与推导公式不符的目标必须有据可查（复核修订 / 场景改写留痕）',
      allTargets.filter(t => t.type === '无人机' && t.facts && t.facts.maneuverEvents !== undefined
        && t.facts.trackStatus !== formulaOf(t))
        .every(t => t.revised || typeof t.factsOverridden === 'string'),
      '100% 可追溯',
      allTargets.filter(t => t.type === '无人机' && t.facts && t.facts.maneuverEvents !== undefined
        && t.facts.trackStatus !== formulaOf(t)
        && !(t.revised || typeof t.factsOverridden === 'string')).length + ' 个无法说明');
    add('offRoute 不可判定的目标必须在 undeterminable 中声明该项',
      allTargets.filter(t => t.facts && t.facts.offRoute === null)
        .every(t => (t.undeterminable || []).indexOf('偏离报备航线') >= 0),
      '100% 声明',
      allTargets.filter(t => t.facts && t.facts.offRoute === null
        && (t.undeterminable || []).indexOf('偏离报备航线') < 0).length + ' 个未声明');
    add('不可判定项不得同时出现在违规事由清单里（不可判定 ≠ 违规）',
      allTargets.every(t => !(t.undeterminable || []).some(v => (t.violation_reasons || []).indexOf(v) >= 0)),
      '0 重叠',
      allTargets.filter(t => (t.undeterminable || []).some(v => (t.violation_reasons || []).indexOf(v) >= 0)).length + ' 个重叠');

    add('处罚案件仅针对无人机目标（§4.2 异物不进处罚流程）',
      cases.every(c => c.targetId.slice(0, 3) === 'UAV'), '100%',
      Math.round(cases.filter(c => c.targetId.slice(0, 3) === 'UAV').length / cases.length * 100) + '%');
    return c;
  }

  const versionsOf = kind => ruleVersions.filter(v => v.ruleKind === kind);
  /* 当前生效版本：找不到就返回 null，**不拿历史版本冒充现行规则**
     （airspace.js 原来是 `|| [0]`，Session 1 已修，这里数据层同口径） */
  const currentVersion = kind => versionsOf(kind).find(v => v.status === '当前生效') || null;

  /* ================= 平台当前时刻：全站唯一来源 =================
     此前同一时刻有三套时间并存：
       顶栏时钟   app.js 自己算 demoTime + 经过时长
       生成基准   CONF.demoTime（冻结常量，用于调测日志/心跳/证据入库）
       机器时间   页面里裸用 new Date()（situation.js 的处置日志），**还是另一个时区**
     现象是：刚点「开始测试」，日志第一条比顶栏早一个多小时；云台回执写 04:10，
     跟平台上任何时间都对不上 —— 演示时同时看一眼顶栏和日志就会发现。

     统一为：now() = 演示基准点 + 页面打开后经过的**真实**时长。
     时钟会走（秒针动、日志有先后），但所有派生时间锚在同一个基准上。
     _t0 在模块求值时捕获，保证所有消费方共用同一个起点。

     注意：数据**生成**仍用 CONF.demoTime（冻结），否则每次刷新数据都会漂；
     now() 是给**运行期动作**用的（改判留痕、下发指令、通报回执、日志行）。 */
  const _t0 = Date.now();
  function now() { return new Date(CONF.demoTime.getTime() + (Date.now() - _t0)); }
  const nowStr = () => fmtDT(now());
  const nowTime = () => fmtT(now());

  /* ---------------- 导出 ---------------- */
  global.MOCK = {
    CONF, DISTRICTS, AIRPORTS, PARTNERS, PILOTS, MODELS, VIOLATIONS, T_TYPES,
    now, nowStr, nowTime,
    devices, deviceStats, airspaces, flightPlans,
    allTargets, todayTargets, liveTargets,
    alarms, todayAlarms, cases, casesToday, authLogs,
    interfaces, ifStats, commTasks, COMM_TH, logs, logStats,
    users, ROLES, PERM, PERM_MODULES, auditLogs,
    switchUser, can, permLevel, PERM_LEVELS, PERM_ACTIONS,
    DISPOSAL_FLOW, ALARM_STATUS, CASE_STATUS, DEV_TYPES_RESERVED,
    JAM_CH, JAM_SOURCE, channelsFor, bandNote,
    OBJECT_TYPES, airborneTargets, idLineage, resolveTargetId,
    PLAN_MATCH, C01_DIMS, C01_TOL, ROUTE_GEOM_READY,
    C02_SEVERE, FINE, EVIDENCE_KINDS, EVIDENCE_VERIFY, EVIDENCE_STATUS, EVID_PARAMS, evidenceFiles, evidenceOf, evidenceRefs, ALT_BANDS, AGL_BANDS, TRACK_STATUS, AIRSPACE_TYPES, dictRegistry, airspaceType, LEGAL_STATUS, senseQuality, illegalDisposition, primaryViolation, deriveLegality, evidenceGateLog, reviewRequests, factRevisions, pendingSubjects,
    ruleVersions, RULE_KINDS, versionsOf, currentVersion,
    caseStatusOf, canAdvanceCase, advanceCase, setCaseStage, rebuildCaseSteps,
    pushDispatchSync, ackDispatchSync, syncOf, pushAudit,
    /* airspaceVersions 兼容视图已删除：页面层 0 引用（Session 1 确认），全部改读 versionsOf('airspace')。 */
    detectConflicts, CONFLICT_MIN_OVERLAP, notifyChannels,
    RISK_STATUS, RISK_FLOW, riskNext, riskNotices, noticesOf, NOTICE_CHANNELS, ACK_STATUS, noticeTargetFor,
    riskLevelOf, riskAdvice, recalcRiskLevels, RISK_RULE,
    nearestRouteOf, routeAltBand, altOverlapWith, routeInWindow,
    routeHazards, routesNear,
    AIRSPACE_SOURCES, airspaceSource, AIRSPACE_TYPE_UNKNOWN, AIRSPACE_SOURCE_UNKNOWN,
    routes, ROUTE_PARAMS, ROUTE_PURPOSES, ROUTE_STATUS, TRACK_MODEL,
    routeById, routesOf, plansOf, routeSummary, detectRouteConflicts,
    fusionWeights, recalcFusedConf,
    stats, todayStats, riskEvents,
    selfCheck,
    util: { fmtD, fmtT, fmtDT, dayAdd, ymd, sum, ri, rnd, pick, groupCount, distKm, p2, p3 }
  };
  /* currentUser 用 getter 暴露：切换角色后所有引用自动跟随。
     若导出成一个快照对象，switchUser 之后拿到的还是旧的那份 —— 又是一份真值副本。 */
  Object.defineProperty(global.MOCK, 'currentUser', {
    enumerable: true,
    get() { return users.find(u => u.id === _currentUserId) || null; }
  });
})(window);
