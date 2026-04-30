// FV impact: ages × dev percentiles, fed by waaPercentileData + curveOpts.
import { memo, useMemo, useState } from "react";
import { S, waaStyle } from "../../theme.js";
import { NumInput } from "../../components/shared.jsx";
import { calcFutureValue, fmtRiskExp } from "../../utils/futureValue.js";

export const FVImpactTable = memo(function FVImpactTable({ curveOpts, waaPercentileData }) {
  const { maxCurrentAge, riskMin, riskMax, riskExp, gapMax, riskMode, logitK } = curveOpts;
  const [examplePot, setExamplePot] = useState(5.0);
  const ages = [16, 18, 20, 22, 24, 25, 26];
  const pctKeys = ["p10", "p25", "median", "p75", "p90", "p95", "p99"];
  const pctDevPct = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];
  const pctLabels = ["10th", "25th", "50th", "75th", "90th", "95th", "99th"];

  const rows = useMemo(() => {
    if (!waaPercentileData || waaPercentileData.length === 0) return [];
    const findClosest = (age) => {
      let best = null, bestDist = Infinity;
      for (const d of waaPercentileData) {
        const dist = Math.abs(d.age - age);
        if (dist < bestDist) { bestDist = dist; best = d; }
      }
      return best;
    };
    return ages.map((age) => {
      const data = findClosest(age);
      const cols = pctKeys.map((key, i) => {
        const curWAA = data ? data[key] : 0;
        if (age >= maxCurrentAge) {
          return { fv: curWAA, curWAA, mature: true };
        }
        if (curWAA > examplePot) return { fv: null, curWAA, mature: false };
        const fv = calcFutureValue(curWAA, examplePot, age, pctDevPct[i], curveOpts);
        return { fv, curWAA, mature: false };
      });
      return { age, cols };
    });
  }, [curveOpts, examplePot, waaPercentileData, maxCurrentAge]);

  if (!waaPercentileData || waaPercentileData.length === 0) {
    return <div style={{ fontSize: 11, color: "#475569" }}>Not enough data to compute FV impact table.</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
        Shows Future Value across ages and development percentiles. Current WAA comes from the distribution chart above
        (what a player at that dev% actually has at that age). Gap = Potential − Current shrinks for better developers.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Example Potential WAA:</label>
        <NumInput min={-5} max={15} step={0.5} value={examplePot} onChange={setExamplePot}
          style={{ width: 60, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, ...waaStyle(examplePot), fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 50 }}>Age</th>
              {pctLabels.map((l) => (
                <th key={l} style={{ ...S.th, textAlign: "center" }}>{l} Dev%</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ age, cols }, ri) => (
              <tr key={age} style={{ background: ri % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                <td style={{ ...S.td, fontWeight: 700, color: "#e2e8f0" }}>{age}</td>
                {cols.map((c, ci) => (
                  <td key={ci} style={{ ...S.td, textAlign: "center", opacity: c.mature ? 0.5 : 1 }}>
                    {c.fv != null ? (
                      <div>
                        <span style={{ ...waaStyle(c.fv), fontWeight: 700 }}>{c.fv.toFixed(2)}</span>
                        <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>
                          {c.mature ? "current only" : `cur: ${c.curWAA.toFixed(1)}`}
                        </div>
                      </div>
                    ) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>
        Settings: Maturity={maxCurrentAge}, RiskMin={riskMin.toFixed(2)}, RiskMax={riskMax.toFixed(2)}, {riskMode === 'logit' ? `Mode=logit(k=${logitK.toFixed(2)})` : `RiskFlex=${fmtRiskExp(riskExp)}`}, GapMax={gapMax.toFixed(2)}, Pot={examplePot.toFixed(1)}
      </div>
    </div>
  );
});
