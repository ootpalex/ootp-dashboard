// Development Curve Tuning — sliders + gap/risk preview charts.
// State stays in coordinator (FV impact + prospect preview need to read it),
// so this panel takes everything as props.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { S } from "../../theme.js";
import { Section, PillBtn, NumInput, TabGroup } from "../../components/shared.jsx";
import { G5_DEFAULTS, G5_POWER_DEFAULTS } from "../../utils/constants.js";
import { riskExpToSlider, sliderToRiskExp, fmtRiskExp } from "../../utils/futureValue.js";

export function CurveTuningPanel({
  curveSettings,
  // local state
  maxCurrentAge, setLocalMaxCurrentAge,
  riskMin, riskMax, handleRiskMin, handleRiskMax,
  riskExp, setLocalRiskExp,
  riskMode, setLocalRiskMode,
  logitK, setLocalLogitK,
  gapMax, setLocalGapMax,
  gapExp, setLocalGapExp,
  // computed flags
  curveSettingsDirty, isLocalDefault, isSavedDefault,
  // chart data
  curveData, riskCurveData,
  // setters with side effects
  saveCurveSettings, resetCurveSettings, restoreDefaults,
}) {
  const onLogitMode = () => {
    setLocalRiskMode('logit');
    handleRiskMin(G5_DEFAULTS.riskMin);
    handleRiskMax(G5_DEFAULTS.riskMax);
    setLocalLogitK(G5_DEFAULTS.logitK);
    setLocalGapMax(G5_DEFAULTS.gapMax);
    setLocalGapExp(G5_DEFAULTS.gapExp);
  };
  const onPowerMode = () => {
    setLocalRiskMode('power');
    handleRiskMin(G5_POWER_DEFAULTS.riskMin);
    handleRiskMax(G5_POWER_DEFAULTS.riskMax);
    setLocalRiskExp(G5_POWER_DEFAULTS.riskExp);
    setLocalGapMax(G5_POWER_DEFAULTS.gapMax);
    setLocalGapExp(G5_POWER_DEFAULTS.gapExp);
  };

  return (
    <Section title="Development Curve Tuning">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 16 }}>
        {/* Gap Factor Box */}
        <div style={{ background: "rgba(15,23,42,0.4)", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Gap Factor</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Maturity Age</label>
                <NumInput min={24} max={32} step={1} value={maxCurrentAge} onChange={setLocalMaxCurrentAge}
                  style={{ width: 48, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
              </div>
              <input type="range" min={24} max={32} step={1} value={maxCurrentAge} onChange={(e) => setLocalMaxCurrentAge(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "#3b82f6" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
                <span>24</span><span>32</span>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Gap Max</label>
                <NumInput min={0.00} max={1.00} step={0.01} value={gapMax} onChange={setLocalGapMax}
                  style={{ width: 52, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
              </div>
              <input type="range" min={0.00} max={1.00} step={0.01} value={gapMax} onChange={(e) => setLocalGapMax(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#ef4444" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
                <span>0 (full gap penalty)</span><span>1.00 (no gap penalty)</span>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Gap Flex</label>
                <NumInput min={1} max={20} step={0.1} value={gapExp} onChange={setLocalGapExp}
                  style={{ width: 52, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
              </div>
              <input type="range" min={1} max={20} step={0.1} value={gapExp} onChange={(e) => setLocalGapExp(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#a855f7" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
                <span>1 (linear)</span><span>20 (tight hug)</span>
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={curveData} margin={{ top: 12, right: 20, bottom: 25, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="age" tick={{ fill: "#64748b", fontSize: 10 }} label={{ value: "Age", position: "insideBottom", offset: -5, fill: "#64748b", fontSize: 10 }} />
              <YAxis domain={[0, 1]} tick={{ fill: "#64748b", fontSize: 10 }} label={{ value: "Gap Factor", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(value) => [value.toFixed(3), "Gap Factor"]}
                labelFormatter={(v) => `Age ${v}`}
              />
              <Line type="monotone" dataKey="gapFactor" stroke="#ef4444" strokeWidth={2} dot={false} name="Gap Factor" />
              <ReferenceLine x={maxCurrentAge} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={1} label={{ value: `Maturity (${maxCurrentAge})`, fill: "#f59e0b", fontSize: 10, position: "insideTop" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* Risk Factor Box */}
        <div style={{ background: "rgba(15,23,42,0.4)", border: "1px solid #1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Risk Factor</div>
            <TabGroup label="Risk curve mode" style={{ display: "flex", gap: 4 }}>
              <PillBtn active={riskMode === 'logit'} onClick={onLogitMode}>Logit</PillBtn>
              <PillBtn active={riskMode === 'power'} onClick={onPowerMode}>Power</PillBtn>
            </TabGroup>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Risk Min</label>
                <NumInput min={0} max={1.00} step={0.05} value={riskMin} onChange={handleRiskMin}
                  style={{ width: 52, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
              </div>
              <input type="range" min={0} max={1.00} step={0.05} value={riskMin} onChange={(e) => handleRiskMin(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#f59e0b" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
                <span>0 (max discount)</span><span>1.00 (no discount)</span>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Risk Max</label>
                <NumInput min={0} max={1.00} step={0.05} value={riskMax} onChange={handleRiskMax}
                  style={{ width: 52, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
              </div>
              <input type="range" min={0} max={1.00} step={0.05} value={riskMax} onChange={(e) => handleRiskMax(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#22c55e" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
                <span>0</span><span>1.00 (full credit)</span>
              </div>
            </div>
            {riskMode === 'power' ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Risk Flex</label>
                  <NumInput min={0.01} max={100} step={0.01} value={riskExp} onChange={setLocalRiskExp}
                    style={{ width: 52, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
                </div>
                <input type="range" min={0} max={1} step={0.005} value={riskExpToSlider(riskExp)} onChange={(e) => setLocalRiskExp(sliderToRiskExp(parseFloat(e.target.value)))}
                  style={{ width: "100%", accentColor: "#a855f7" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
                  <span>0.01 (concave)</span><span>100 (tight hug)</span>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Edge Sensitivity</label>
                  <NumInput min={0.1} max={2.0} step={0.05} value={logitK} onChange={setLocalLogitK}
                    style={{ width: 52, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
                </div>
                <input type="range" min={0.1} max={2.0} step={0.05} value={logitK} onChange={(e) => setLocalLogitK(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "#a855f7" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569" }}>
                  <span>0.1 (steep edges)</span><span>1.0 (linear)</span><span>2.0 (steep middle)</span>
                </div>
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={riskCurveData} margin={{ top: 12, right: 20, bottom: 25, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="devPct" tick={{ fill: "#64748b", fontSize: 10 }} label={{ value: "Dev Percentile", position: "insideBottom", offset: -5, fill: "#64748b", fontSize: 10 }} />
              <YAxis domain={[0, 1]} tick={{ fill: "#64748b", fontSize: 10 }} label={{ value: "Risk Factor", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(value) => [value.toFixed(3), "Risk Factor"]}
                labelFormatter={(v) => `Dev% ${v}`}
              />
              <Line type="monotone" dataKey="riskFactor" stroke="#f59e0b" strokeWidth={2} dot={false} name="Risk Factor" />
              <ReferenceLine y={1} stroke="#334155" strokeDasharray="5 5" strokeWidth={1} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        {curveSettingsDirty && <button onClick={saveCurveSettings} style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#86efac", background: "rgba(34,197,94,0.15)", padding: "5px 16px", fontSize: 12, fontWeight: 700 }}>Save Settings</button>}
        {curveSettingsDirty && !isSavedDefault && <button onClick={resetCurveSettings} style={{ ...S.pillBtn, borderColor: "#334155", color: "#64748b", padding: "5px 12px", fontSize: 11 }}>Restore to Last Saved</button>}
        {!isLocalDefault && <button onClick={restoreDefaults} style={{ ...S.pillBtn, borderColor: "#3b82f6", color: "#93c5fd", background: "rgba(59,130,246,0.10)", padding: "5px 12px", fontSize: 11 }}>Restore to Defaults</button>}
        {curveSettingsDirty && <span style={{ fontSize: 10, color: "#f59e0b" }}>unsaved changes</span>}
        {!curveSettingsDirty && <span style={{ fontSize: 10, color: "#475569" }}>saved: Maturity={curveSettings.maxCurrentAge}, GapMax={curveSettings.gapMax.toFixed(2)}, GapFlex={curveSettings.gapExp.toFixed(1)}, RiskMin={curveSettings.riskMin.toFixed(2)}, RiskMax={curveSettings.riskMax.toFixed(2)}, {(curveSettings.riskMode ?? 'logit') === 'logit' ? `Mode=logit(k=${(curveSettings.logitK ?? 0.5).toFixed(2)})` : `RiskFlex=${fmtRiskExp(curveSettings.riskExp)}`}</span>}
      </div>
      <div style={{ marginTop: 12, background: "rgba(15,23,42,0.6)", borderRadius: 6, padding: 12, border: "1px solid #1e293b" }}>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>
          t = min(1, (age - 14) / ({maxCurrentAge} - 14))
        </div>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", marginTop: 4 }}>
          gapFactor = max(0, {gapMax.toFixed(2)} * (1 - t^{gapExp.toFixed(1)}))
        </div>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", marginTop: 4 }}>
          {riskMode === 'logit'
            ? `riskFactor = ${riskMin.toFixed(2)} + (${riskMax.toFixed(2)} - ${riskMin.toFixed(2)}) * logit(dp, k=${logitK.toFixed(2)})`
            : `riskFactor = ${riskMin.toFixed(2)} + (${riskMax.toFixed(2)} - ${riskMin.toFixed(2)}) * dp^${fmtRiskExp(riskExp)}`}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", marginTop: 4 }}>
          FV = curWAA + gap * riskFactor * gapFactor
        </div>
      </div>
    </Section>
  );
}
