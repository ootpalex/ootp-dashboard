// Shared utilities for DevAnalysis sub-charts.

export function niceScale(dataMin, dataMax, maxTicks = 8) {
  if (dataMin === dataMax) { dataMin -= 1; dataMax += 1; }
  const range = dataMax - dataMin;
  const roughStep = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const niceStep = norm <= 1.5 ? 1 * mag : norm <= 3 ? 2 * mag : norm <= 7 ? 5 * mag : 10 * mag;
  const min = Math.floor(dataMin / niceStep) * niceStep;
  const max = Math.ceil(dataMax / niceStep) * niceStep;
  const ticks = [];
  for (let v = min; v <= max + niceStep * 0.001; v += niceStep) ticks.push(Math.round(v * 1e9) / 1e9);
  return { min, max, ticks };
}

const BW_LOG_MIN = Math.log(0.1);
const BW_LOG_MAX = Math.log(5.0);
export const bwToSlider = (bw) => Math.round((Math.log(Math.max(0.1, bw)) - BW_LOG_MIN) / (BW_LOG_MAX - BW_LOG_MIN) * 100);
export const sliderToBw = (s) => {
  const raw = Math.exp(BW_LOG_MIN + (s / 100) * (BW_LOG_MAX - BW_LOG_MIN));
  if (raw <= 1.0) return Math.round(raw * 10) / 10;
  if (raw <= 2.0) return Math.round(raw * 5) / 5;
  return Math.round(raw * 2) / 2;
};

// Weighted percentile of an already-sorted list (must be sorted by the value
// you want percentile-ranked).
export function weightedPercentile(sorted, weights, p) {
  let cumW = 0;
  let totalW = 0;
  for (let i = 0; i < weights.length; i++) totalW += weights[i];
  const target = p * totalW;
  for (let i = 0; i < sorted.length; i++) {
    cumW += weights[i];
    if (cumW >= target) return sorted[i];
  }
  return sorted[sorted.length - 1];
}
