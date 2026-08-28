/* =============================================================================
 * charts.js —— ECharts 主题与常用图表工厂
 * ========================================================================== */
(function (g) {
  'use strict';
  const C = { blue: '#3d8bff', cyan: '#22d3ee', green: '#2fd06e', amber: '#ffb020', orange: '#ff8b3d', red: '#ff4d5e', purple: '#a97bff', pink: '#ff5fa2', gray: '#8ca0be' };
  const PALETTE = [C.blue, C.green, C.amber, C.red, C.purple, C.cyan, C.orange, C.gray];
  const AX = {
    axisLine: { lineStyle: { color: 'rgba(64,158,255,.25)' } },
    axisLabel: { color: '#8ba3c7', fontSize: 11 },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: 'rgba(64,158,255,.09)' } }
  };
  const TIP = {
    backgroundColor: 'rgba(6,16,42,.95)', borderColor: 'rgba(64,158,255,.4)',
    textStyle: { color: '#e6f0ff', fontSize: 12 }, confine: true,
    axisPointer: { lineStyle: { color: 'rgba(64,158,255,.4)' } }
  };
  const LEG = { textStyle: { color: '#9fb6d9', fontSize: 11 }, itemWidth: 10, itemHeight: 8, icon: 'roundRect' };

  const insts = [];
  function make(el, opt) {
    if (!el) return null;
    const ch = echarts.init(el, null, { renderer: 'canvas' });
    ch.setOption(opt);
    const ro = new ResizeObserver(() => ch.resize());
    ro.observe(el);
    insts.push({ ch, ro, el });
    return ch;
  }
  function disposeAll() {
    while (insts.length) { const i = insts.pop(); try { i.ro.disconnect(); i.ch.dispose(); } catch (e) { } }
  }

  /* 折线（可多条） */
  function line(el, o) {
    const series = o.series.map((s, i) => ({
      name: s.name, type: 'line', data: s.data, smooth: s.smooth !== false,
      symbol: 'circle', symbolSize: s.symbolSize || 5,
      yAxisIndex: s.yAxisIndex || 0,
      lineStyle: { width: 2, color: s.color || PALETTE[i] },
      itemStyle: { color: s.color || PALETTE[i], borderWidth: 1.5, borderColor: '#071231' },
      label: s.label ? { show: true, color: s.color || PALETTE[i], fontSize: 10, position: 'top' } : { show: false },
      areaStyle: s.area ? {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: (s.color || PALETTE[i]) + '55' }, { offset: 1, color: (s.color || PALETTE[i]) + '00' }])
      } : null
    }));
    return make(el, {
      grid: Object.assign({ left: 38, right: o.y2 ? 42 : 14, top: o.legend === false ? 16 : 32, bottom: 24 }, o.grid),
      tooltip: Object.assign({ trigger: 'axis' }, TIP),
      legend: o.legend === false ? { show: false } : Object.assign({ right: 6, top: 2 }, LEG),
      xAxis: Object.assign({ type: 'category', data: o.x, boundaryGap: false }, AX, { splitLine: { show: false } }),
      yAxis: [Object.assign({ type: 'value', name: o.yName, scale: !!o.yScale, nameTextStyle: { color: '#6c86ad', fontSize: 10 } }, AX)]
        .concat(o.y2 ? [Object.assign({ type: 'value', name: o.y2, nameTextStyle: { color: '#6c86ad', fontSize: 10 } }, AX, { splitLine: { show: false } })] : []),
      series
    });
  }

  /* 柱状 */
  function bar(el, o) {
    return make(el, {
      grid: Object.assign({ left: 40, right: 14, top: o.legend === false ? 18 : 32, bottom: 24 }, o.grid),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, TIP),
      legend: o.legend === false ? { show: false } : Object.assign({ right: 6, top: 2 }, LEG),
      xAxis: Object.assign({ type: 'category', data: o.x }, AX, { splitLine: { show: false } }),
      yAxis: Object.assign({ type: 'value', name: o.yName, nameTextStyle: { color: '#6c86ad', fontSize: 10 } }, AX),
      series: o.series.map((s, i) => ({
        name: s.name, type: 'bar', data: s.data, barMaxWidth: s.width || 26,
        stack: s.stack,
        label: s.label !== false ? { show: true, position: 'top', color: '#9fb6d9', fontSize: 10, formatter: s.fmt } : { show: false },
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: s.colorBy ? (p => s.colorBy(p)) : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: s.color || PALETTE[i] }, { offset: 1, color: (s.color || PALETTE[i]) + '44' }])
        }
      }))
    });
  }

  /* 横向条 */
  function hbar(el, o) {
    return make(el, {
      grid: Object.assign({ left: 96, right: 44, top: 8, bottom: 8 }, o.grid),
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, TIP),
      xAxis: Object.assign({ type: 'value', show: false }, AX),
      yAxis: Object.assign({ type: 'category', data: o.y, inverse: true }, AX, { splitLine: { show: false }, axisLine: { show: false }, axisLabel: { color: '#8ba3c7', fontSize: 11, width: 90, overflow: 'truncate' } }),
      series: [{
        type: 'bar', data: o.data, barMaxWidth: 13,
        label: { show: true, position: 'right', color: '#cfe0f8', fontSize: 11 },
        itemStyle: {
          borderRadius: 3,
          color: p => new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: (o.colors ? o.colors[p.dataIndex] : PALETTE[p.dataIndex % 8]) + '55' },
            { offset: 1, color: o.colors ? o.colors[p.dataIndex] : PALETTE[p.dataIndex % 8] }])
        }
      }]
    });
  }

  /* 环形
     用户反馈修复:
     ① 中心文字改用 pie label position:'center'(空数据占位项),真正几何居中,窗口缩放自动跟随;
     ② 根据容器实际宽度自适应:窄容器图例移到底部、环居中,避免图例压环;
     ③ 图例文本过长自动截断。 */
  function donut(el, o) {
    if (!el) return null;
    // 容器尚未完成布局时(切换页签/首次渲染),clientWidth 为 0 会让窄容器判断误用兜底值 → 延迟一帧重试
    if (!el.clientWidth && !(o._retry > 2)) {
      o._retry = (o._retry || 0) + 1;
      requestAnimationFrame(() => donut(el, o));
      return null;
    }
    const total = o.data.reduce((s, d) => s + d.value, 0);
    const w = el.clientWidth || 300, h = el.clientHeight || 200;
    const narrow = o.narrow != null ? o.narrow : w < 320;          // 窄容器:上环下图例
    const center = narrow ? ['50%', '40%'] : (o.center || ['32%', '50%']);
    const radius = narrow ? ['40%', '58%'] : (o.radius || (o.data.length >= 7 ? ['44%', '64%'] : ['52%', '74%']));
    const legFs = o.data.length >= 7 ? 10 : 11;
    const legend = o.legend === false ? { show: false } : (narrow
      ? Object.assign({ orient: 'horizontal', bottom: 0, left: 'center', itemGap: 6, itemWidth: 8, itemHeight: 8, type: 'scroll',
          pageIconColor: '#9fb6d9', pageIconSize: 10, pageTextStyle: { color: '#9fb6d9', fontSize: 10 },
          textStyle: { color: '#9fb6d9', fontSize: 10 },
          formatter: n => { const d = o.data.find(x => x.name === n); return `${n} ${d ? d.value.toLocaleString() : ''}`; } }, {})
      : Object.assign({ orient: 'vertical', right: 4, top: 'center', itemGap: o.data.length >= 7 ? 6 : 9, type: 'scroll',
          pageIconColor: '#9fb6d9', pageTextStyle: { color: '#9fb6d9' },
          textStyle: { color: '#9fb6d9', fontSize: legFs, width: Math.max(90, w - w * parseFloat(center[0]) / 100 - Math.min(w, h) * parseFloat(radius[1]) / 200 - 30), overflow: 'truncate' },
          formatter: n => { const d = o.data.find(x => x.name === n); return `${n}  ${d ? d.value.toLocaleString() : ''}${o.showPct !== false && d ? ' (' + (d.value / total * 100).toFixed(1) + '%)' : ''}`; } }, {}));
    const showCenter = o.centerText !== false;
    return make(el, {
      tooltip: Object.assign({ trigger: 'item', formatter: p => p.value == null ? '' : `${p.name}<br/><b>${p.value.toLocaleString()}</b> (${p.percent}%)` }, TIP),
      legend,
      series: [{
        type: 'pie', radius, center,
        avoidLabelOverlap: true, labelLine: { show: false },
        label: { show: false },
        itemStyle: { borderColor: '#071231', borderWidth: 2 },
        data: o.data.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: d.c || (o.colors ? o.colors[i] : PALETTE[i % 8]) } }))
      }].concat(showCenter ? [{
        // 透明占位系列,专门承载几何居中的中心文字(label position:center 以 series center 为锚点)
        type: 'pie', radius: ['0%', '1%'], center, silent: true,
        label: {
          show: true, position: 'center',
          formatter: `{a|${o.centerLabel || '总计'}}\n{b|${(o.centerValue != null ? o.centerValue : total).toLocaleString()}}`,
          rich: {
            a: { color: '#8ba3c7', fontSize: 11, lineHeight: 16 },
            b: { color: '#e6f0ff', fontSize: 17, fontWeight: 700, lineHeight: 22, fontFamily: 'Menlo' }
          }
        },
        labelLine: { show: false }, itemStyle: { color: 'transparent' }, tooltip: { show: false },
        data: [{ value: 1, name: '' }]
      }] : [])
    });
  }

  /* 仪表环（单值百分比） */
  function ring(el, o) {
    return make(el, {
      series: [{
        type: 'gauge', startAngle: 90, endAngle: -270, radius: '92%',
        pointer: { show: false }, progress: { show: true, roundCap: true, width: 9, itemStyle: { color: o.color || C.blue } },
        axisLine: { lineStyle: { width: 9, color: [[1, 'rgba(255,255,255,.09)']] } },
        splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
        title: { show: !!o.label, offsetCenter: [0, '26%'], color: '#8ba3c7', fontSize: 11 },
        detail: { valueAnimation: true, offsetCenter: [0, '-4%'], fontSize: o.fs || 20, color: '#e6f0ff', formatter: o.fmt || (v => v + '%') },
        data: [{ value: o.value, name: o.label || '' }]
      }]
    });
  }

  /* 实时折线（多条，滚动） */
  function realtime(el, o) {
    return line(el, o);
  }

  /* 确定性伪随机:输入同一字符串永远得到同一序列,用于详情页派生字段 */
  function seeded(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function (a, b) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return a + h % (b - a + 1); };
  }

  g.CH = {
    seeded, make, line, bar, hbar, donut, ring, realtime, disposeAll, C, PALETTE };
})(window);
