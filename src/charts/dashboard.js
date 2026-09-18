import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';

const CHART_OPTS = {
  layout: {
    background: { color: '#ffffff' },
    textColor: '#5a6570',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(90, 101, 112, 0.08)' },
    horzLines: { color: 'rgba(90, 101, 112, 0.08)' },
  },
  crosshair: {
    mode: 0,
    vertLine: { color: 'rgba(30, 90, 110, 0.35)', width: 1, style: 2 },
    horzLine: { color: 'rgba(30, 90, 110, 0.35)', width: 1, style: 2 },
  },
  rightPriceScale: {
    borderColor: 'rgba(90, 101, 112, 0.15)',
    scaleMargins: { top: 0.08, bottom: 0.12 },
  },
  timeScale: {
    borderColor: 'rgba(90, 101, 112, 0.15)',
    timeVisible: true,
    secondsVisible: false,
  },
};

function toLine(times, values) {
  const data = [];
  for (let i = 0; i < times.length; i++) {
    if (values[i] == null || !Number.isFinite(values[i])) continue;
    data.push({ time: times[i], value: values[i] });
  }
  return data;
}

export function createDashboardCharts(containers) {
  const priceChart = createChart(containers.price, {
    ...CHART_OPTS,
    height: containers.price.clientHeight || 360,
  });
  const rsiChart = createChart(containers.rsi, {
    ...CHART_OPTS,
    height: containers.rsi.clientHeight || 120,
    rightPriceScale: {
      ...CHART_OPTS.rightPriceScale,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: { ...CHART_OPTS.timeScale, visible: false },
  });
  const macdChart = createChart(containers.macd, {
    ...CHART_OPTS,
    height: containers.macd.clientHeight || 130,
  });

  const candleSeries = priceChart.addSeries(CandlestickSeries, {
    upColor: '#1f8a5b',
    downColor: '#c44536',
    borderUpColor: '#1f8a5b',
    borderDownColor: '#c44536',
    wickUpColor: '#1f8a5b',
    wickDownColor: '#c44536',
  });

  const ma50Series = priceChart.addSeries(LineSeries, {
    color: '#2f6fed',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    title: 'MM50',
  });
  const ma100Series = priceChart.addSeries(LineSeries, {
    color: '#d64545',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    title: 'MM100',
  });
  const ma200Series = priceChart.addSeries(LineSeries, {
    color: '#1f8a5b',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    title: 'MM200',
  });
  const trendSeries = priceChart.addSeries(LineSeries, {
    color: '#6b4ea3',
    lineWidth: 2,
    lineStyle: 0,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'Tendance',
  });

  const levelSeries = [];

  const rsiSeries = rsiChart.addSeries(LineSeries, {
    color: '#6b4ea3',
    lineWidth: 2,
    priceLineVisible: false,
    title: 'RSI',
  });
  const rsiUpper = rsiChart.addSeries(LineSeries, {
    color: 'rgba(196, 69, 54, 0.35)',
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  const rsiLower = rsiChart.addSeries(LineSeries, {
    color: 'rgba(31, 138, 91, 0.35)',
    lineWidth: 1,
    lineStyle: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  const macdHistSeries = macdChart.addSeries(HistogramSeries, {
    priceLineVisible: false,
    lastValueVisible: false,
  });
  const macdLineSeries = macdChart.addSeries(LineSeries, {
    color: '#2f6fed',
    lineWidth: 2,
    priceLineVisible: false,
    title: 'MACD',
  });
  const macdSignalSeries = macdChart.addSeries(LineSeries, {
    color: '#e09b2d',
    lineWidth: 2,
    priceLineVisible: false,
    title: 'Signal',
  });

  // Sync time scales
  let syncing = false;
  const charts = [priceChart, rsiChart, macdChart];
  charts.forEach((source) => {
    source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      charts.forEach((c) => {
        if (c !== source) c.timeScale().setVisibleLogicalRange(range);
      });
      syncing = false;
    });
  });

  const levelLines = [];

  function clearLevels() {
    while (levelLines.length) {
      const line = levelLines.pop();
      try {
        candleSeries.removePriceLine(line);
      } catch {
        /* ignore */
      }
    }
    while (levelSeries.length) {
      const s = levelSeries.pop();
      try {
        priceChart.removeSeries(s);
      } catch {
        /* ignore */
      }
    }
  }

  function setData({ candles, ma50, ma100, ma200, rsiArr, macdObj, levels, trendline }) {
    const times = candles.map((c) => c.time);
    candleSeries.setData(
      candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    ma50Series.setData(toLine(times, ma50));
    ma100Series.setData(toLine(times, ma100));
    ma200Series.setData(toLine(times, ma200));

    clearLevels();
    for (const row of levels.rows) {
      const color = row.type === 'resistance' ? '#c44536' : '#1f8a5b';
      const line = candleSeries.createPriceLine({
        price: row.mid,
        color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: row.level,
      });
      levelLines.push(line);
    }

    if (trendline) {
      trendSeries.setData([
        { time: trendline.startTime, value: trendline.startPrice },
        { time: trendline.endTime, value: trendline.endPrice },
      ]);
    } else {
      trendSeries.setData([]);
    }

    rsiSeries.setData(toLine(times, rsiArr));
    const rsiGuide = times
      .map((t, i) => (rsiArr[i] != null ? t : null))
      .filter(Boolean);
    if (rsiGuide.length) {
      rsiUpper.setData(rsiGuide.map((t) => ({ time: t, value: 70 })));
      rsiLower.setData(rsiGuide.map((t) => ({ time: t, value: 30 })));
    } else {
      rsiUpper.setData([]);
      rsiLower.setData([]);
    }

    const histData = [];
    for (let i = 0; i < times.length; i++) {
      const v = macdObj.hist[i];
      if (v == null) continue;
      histData.push({
        time: times[i],
        value: v,
        color: v >= 0 ? 'rgba(31, 138, 91, 0.65)' : 'rgba(196, 69, 54, 0.65)',
      });
    }
    macdHistSeries.setData(histData);
    macdLineSeries.setData(toLine(times, macdObj.line));
    macdSignalSeries.setData(toLine(times, macdObj.signal));

    priceChart.timeScale().fitContent();
  }

  function resize() {
    priceChart.applyOptions({
      width: containers.price.clientWidth,
      height: containers.price.clientHeight || 360,
    });
    rsiChart.applyOptions({
      width: containers.rsi.clientWidth,
      height: containers.rsi.clientHeight || 120,
    });
    macdChart.applyOptions({
      width: containers.macd.clientWidth,
      height: containers.macd.clientHeight || 130,
    });
  }

  const ro = new ResizeObserver(resize);
  ro.observe(containers.price);
  ro.observe(containers.rsi);
  ro.observe(containers.macd);
  resize();

  return {
    setData,
    resize,
    destroy() {
      ro.disconnect();
      priceChart.remove();
      rsiChart.remove();
      macdChart.remove();
    },
  };
}
