// Development Curve Tuning — v21 power-law creditAge.
// Single chart: parametric `creditAge = gapMax × (1 − t^gapExp)` with empirical
// `1 − progressCurve.p50` dashed reference. Two sliders: gapMax, gapExp.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Section } from "../../components/shared.jsx";
import { DEV_CURVE_RANGES } from "../../utils/constants.js";

const boxStyle = { background: "rgba(15,23,42,0.4)", border: "1px solid #1e293b", borderRadius: 8, padding: 16 };
const titleStyle = { fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 };
const subStyle = { fontSize: 11, color: "#64748b", marginBottom: 8 };

const tickFmt = (v) => (typeof v === "number" ? v.toFixed(2) : v);
const valueFmt = (v) => (v == null ? "—" : v.toFixed(3));

// Compact slider card — vertical layout, ~300px wide.
function SliderCard({ label, value, min, max, step, onChange, displayValue, hint, gradient }) {
  return (
    <div style={{
      background: "rgba(15,23,42,0.6)",
      border: "1px solid #1e293b",
      borderRadius: 10,
      padding: "14px 16px",
      width: 300,
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#cbd5e1", letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
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
          background: gradient ?? "linear-gradient(90deg, #1e293b 0%, #38bdf8 100%)",
          borderRadius: 3,
          outline: "none",
          cursor: "pointer",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: "#475569" }}>
        <span>{min}</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#38bdf8", lineHeight: 1 }}>{displayValue}</span>
        <span>{max}</span>
      </div>
      {hint && <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// Compact maturity-age toggle (26 / 27 only).
function MaturityToggle({ value, onChange }) {
  const opt = (n) => ({
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    background: value === n ? "#3b82f6" : "transparent",
    color: value === n ? "#fff" : "#94a3b8",
    border: "1px solid " + (value === n ? "#3b82f6" : "#334155"),
    borderRadius: 0,
    cursor: "pointer",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Maturity Age</span>
      <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #334155" }}>
        <button onClick={() => onChange(26)} style={{ ...opt(26), borderRight: "1px solid #334155" }}>26</button>
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
    <Section title="Development Curve Tuning">
      {/* creditAge by Age — parametric (solid) vs empirical (dashed). */}
      <div style={boxStyle}>
        <div style={titleStyle}>creditAge — by Age</div>
        <div style={subStyle}>
          Solid: parametric <code style={{ fontSize: 10 }}>gapMax × (1 − t^gapExp)</code> used by the FV formula.
          Dashed: empirical <code style={{ fontSize: 10 }}>1 − data.meta.progressCurve.hit.p50</code> reference for visual comparison.
          The parametric is intentionally more generous than empirical at moderate ages — high-pot prospects don't follow the median trajectory.
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={creditFactorData} margin={{ top: 8, right: 8, bottom: 24, left: 0 }}>
            <CartesianGrid stroke="#1e293b" />
            <XAxis dataKey="age" stroke="#64748b" tick={{ fontSize: 10 }} domain={[14, maxCurrentAge]} type="number" label={{ value: "age", position: "insideBottom", offset: -8, fill: "#64748b", fontSize: 11 }} />
            <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 1]} tickFormatter={tickFmt} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 11 }} formatter={valueFmt} />
            <Legend verticalAlign="top" height={20} iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="parametric" stroke="#38bdf8" dot={false} strokeWidth={2.4} name="parametric (formula)" />
            <Line type="monotone" dataKey="empirical" stroke="#94a3b8" dot={false} strokeWidth={1.5} strokeDasharray="4 3" name="empirical (1 − progressCurve.p50)" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Two slider cards. */}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        <SliderCard
          label="Gap Max"
          value={gapMax}
          min={DEV_CURVE_RANGES.gapMax.min}
          max={DEV_CURVE_RANGES.gapMax.max}
          step={DEV_CURVE_RANGES.gapMax.step}
          onChange={setGapMax}
          displayValue={gapMax.toFixed(2)}
          hint="Overall credit ceiling — the max fraction of (pot − cur) credited at age 14."
          gradient="linear-gradient(90deg, #1e293b 0%, #38bdf8 100%)"
        />
        <SliderCard
          label="Gap Exp"
          value={gapExp}
          min={DEV_CURVE_RANGES.gapExp.min}
          max={DEV_CURVE_RANGES.gapExp.max}
          step={DEV_CURVE_RANGES.gapExp.step}
          onChange={setGapExp}
          displayValue={gapExp.toString()}
          hint="Time-decay shape. Higher = flatter early/middle, sharper drop near maturity. Default 3 gives a smooth round decay."
          gradient="linear-gradient(90deg, #1e293b 0%, #a78bfa 100%)"
        />
      </div>

      {/* Maturity + buttons */}
      <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <MaturityToggle value={maxCurrentAge} onChange={setMaxCurrentAge} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={saveCurveSettings} disabled={!curveSettingsDirty} style={{ padding: "6px 14px", fontSize: 11, background: curveSettingsDirty ? "#3b82f6" : "#1e293b", color: curveSettingsDirty ? "#fff" : "#475569", border: "none", borderRadius: 4, cursor: curveSettingsDirty ? "pointer" : "default" }}>Save</button>
          <button onClick={resetCurveSettings} disabled={!curveSettingsDirty} style={{ padding: "6px 14px", fontSize: 11, background: "#1e293b", color: curveSettingsDirty ? "#94a3b8" : "#475569", border: "1px solid #334155", borderRadius: 4, cursor: curveSettingsDirty ? "pointer" : "default" }}>Revert</button>
          <button onClick={restoreDefaults} disabled={isLocalDefault} style={{ padding: "6px 14px", fontSize: 11, background: "#1e293b", color: isLocalDefault ? "#475569" : "#94a3b8", border: "1px solid #334155", borderRadius: 4, cursor: isLocalDefault ? "default" : "pointer" }}>Defaults</button>
        </div>
      </div>

      {/* Formula hint */}
      <div style={{ marginTop: 14, textAlign: "center", fontSize: 11, color: "#64748b", fontFamily: "monospace", lineHeight: 1.6 }}>
        FV = cur + gap × creditAge<br />
        creditAge = gapMax × (1 − t<sup>gapExp</sup>) &nbsp;|&nbsp; t = (age − 14) / (maxAge − 14)
      </div>
      {!curveSettingsDirty && (
        <div style={{ marginTop: 6, textAlign: "center", fontSize: 10, color: "#475569" }}>
          saved: gapMax={curveSettings.gapMax.toFixed(2)}, gapExp={curveSettings.gapExp}, mat={curveSettings.maxCurrentAge}{isSavedDefault ? "  (defaults)" : ""}
        </div>
      )}
    </Section>
  );
}
