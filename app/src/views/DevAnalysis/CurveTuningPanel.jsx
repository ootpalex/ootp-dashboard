// Development Curve Tuning — v21 power-law creditAge.
// Single chart: parametric `creditAge = gapMax × (1 − t^gapExp)` with empirical
// `1 − progressCurve.p50` dashed reference. Two sliders: gapMax, gapExp.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TOKENS as T, S } from "../../theme.js";
import { Section } from "../../components/shared.jsx";
import { DEV_CURVE_RANGES } from "../../utils/constants.js";

const C = T.CHART;
const subStyle = { fontSize: 11.5, color: T.text3, marginBottom: 8, lineHeight: 1.45 };
const codeStyle = { color: T.text2, fontWeight: 600 };

const tickFmt = (v) => (typeof v === "number" ? v.toFixed(2) : v);
const valueFmt = (v) => (v == null ? "—" : v.toFixed(3));

// Compact slider card — vertical layout, ~300px wide.
function SliderCard({ label, value, min, max, step, onChange, displayValue, hint }) {
  return (
    <div style={{
      background: T.panel2,
      border: `1px solid ${T.line}`,
      borderRadius: T.radius,
      padding: "12px 14px",
      width: 300,
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      <div style={{ fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 600, color: T.text2 }}>{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%",
          height: 6,
          appearance: "none",
          background: T.line2,
          accentColor: T.accent,
          borderRadius: 3,
          outline: "none",
          cursor: "pointer",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: T.text3 }}>
        <span>{min}</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: T.accent, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{displayValue}</span>
        <span>{max}</span>
      </div>
      {hint && <div style={{ fontSize: 11, color: T.text3, marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// Compact maturity-age toggle (26 / 27 only).
function MaturityToggle({ value, onChange }) {
  const opt = (n) => ({
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: T.fonts.narrow,
    background: value === n ? T.accent : "transparent",
    color: value === n ? T.accentText : T.text2,
    border: "1px solid " + (value === n ? T.accent : T.line2),
    borderRadius: 0,
    cursor: "pointer",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: T.text2, fontWeight: 600 }}>Maturity Age</span>
      <div style={{ display: "flex", borderRadius: T.radius, overflow: "hidden", border: `1px solid ${T.line2}` }}>
        <button onClick={() => onChange(26)} style={{ ...opt(26), borderRight: `1px solid ${T.line2}` }}>26</button>
        <button onClick={() => onChange(27)} style={opt(27)}>27</button>
      </div>
    </div>
  );
}

export function CurveTuningPanel({
  curveSettings,
  gapMax, setGapMax,
  gapExp, setGapExp,
  maxCurrentAge, setMaxCurrentAge,
  curveSettingsDirty, isLocalDefault, isSavedDefault,
  creditFactorData,
  saveCurveSettings, resetCurveSettings, restoreDefaults,
}) {
  return (
    <Section title="Development Curve Tuning"
      footer={!curveSettingsDirty ? `saved: gapMax=${curveSettings.gapMax.toFixed(2)}, gapExp=${curveSettings.gapExp}, mat=${curveSettings.maxCurrentAge}${isSavedDefault ? "  (defaults)" : ""}` : undefined}>
      {/* creditAge by Age — parametric (solid) vs empirical (dashed). */}
      <div style={S.box}>
        <div style={S.boxHead}><span>creditAge — by Age</span></div>
        <div style={{ padding: 12 }}>
          <div style={subStyle}>
            Solid: parametric <span style={codeStyle}>gapMax × (1 − t^gapExp)</span> used by the FV formula.
            Dashed: empirical <span style={codeStyle}>1 − data.meta.progressCurve.hit.p50</span> reference for visual comparison.
            The parametric is intentionally more generous than empirical at moderate ages — high-pot prospects don't follow the median trajectory.
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={creditFactorData} margin={{ top: 8, right: 8, bottom: 24, left: 0 }}>
              <CartesianGrid stroke={C.grid} />
              <XAxis dataKey="age" stroke={C.axis} tick={{ fontSize: 10, fill: C.axis }} axisLine={{ stroke: C.grid }} tickLine={false} domain={[14, maxCurrentAge]} type="number" label={{ value: "age", position: "insideBottom", offset: -8, fill: C.axis, fontSize: 11 }} />
              <YAxis stroke={C.axis} tick={{ fontSize: 10, fill: C.axis }} axisLine={{ stroke: C.grid }} tickLine={false} domain={[0, 1]} tickFormatter={tickFmt} />
              <Tooltip contentStyle={{ background: C.tooltipBg, border: `1px solid ${C.tooltipBorder}`, borderRadius: T.radius, fontSize: 11 }} labelStyle={{ color: C.tooltipText }} itemStyle={{ color: T.text2 }} formatter={valueFmt} />
              <Legend verticalAlign="top" height={20} iconSize={8} wrapperStyle={{ fontSize: 10, color: T.text2 }} />
              <Line type="monotone" dataKey="parametric" stroke={C.series1} dot={false} strokeWidth={2.4} name="parametric (formula)" />
              <Line type="monotone" dataKey="empirical" stroke={T.text2} dot={false} strokeWidth={1.5} strokeDasharray="4 3" name="empirical (1 − progressCurve.p50)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two slider cards. */}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        <SliderCard
          label="Gap max"
          value={gapMax}
          min={DEV_CURVE_RANGES.gapMax.min}
          max={DEV_CURVE_RANGES.gapMax.max}
          step={DEV_CURVE_RANGES.gapMax.step}
          onChange={setGapMax}
          displayValue={gapMax.toFixed(2)}
          hint="Overall credit ceiling — the max fraction of (pot − cur) credited at age 14."
        />
        <SliderCard
          label="Gap exp"
          value={gapExp}
          min={DEV_CURVE_RANGES.gapExp.min}
          max={DEV_CURVE_RANGES.gapExp.max}
          step={DEV_CURVE_RANGES.gapExp.step}
          onChange={setGapExp}
          displayValue={gapExp.toString()}
          hint="Time-decay shape. Higher = flatter early/middle, sharper drop near maturity. Default 3 gives a smooth round decay."
        />
      </div>

      {/* Maturity + buttons */}
      <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <MaturityToggle value={maxCurrentAge} onChange={setMaxCurrentAge} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={saveCurveSettings} disabled={!curveSettingsDirty} style={{ ...S.btn, ...(curveSettingsDirty ? S.btnPrimary : { color: T.textDisabled, cursor: "default" }) }}>Save</button>
          <button onClick={resetCurveSettings} disabled={!curveSettingsDirty} style={{ ...S.btn, ...(curveSettingsDirty ? {} : { color: T.textDisabled, cursor: "default" }) }}>Revert</button>
          <button onClick={restoreDefaults} disabled={isLocalDefault} style={{ ...S.btn, ...(isLocalDefault ? { color: T.textDisabled, cursor: "default" } : {}) }}>Defaults</button>
        </div>
      </div>

      {/* Formula hint */}
      <div style={{ marginTop: 14, textAlign: "center", fontSize: 11.5, color: T.text3, lineHeight: 1.6 }}>
        FV = cur + gap × creditAge<br />
        creditAge = gapMax × (1 − t<sup>gapExp</sup>) &nbsp;|&nbsp; t = (age − 14) / (maxAge − 14)
      </div>
    </Section>
  );
}
