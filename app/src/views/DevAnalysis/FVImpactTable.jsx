// FV Impact Analysis — v21 layout: age columns × cohort percentile rows.
// Each cell uses the empirical cur-WAR at (age, percentile) from the embedded
// devCurve as the cur input, and the user-controlled examplePot as pot. The
// cell sub-text shows that cur value so the relationship between cur and FV
// is explicit. Under v21's `FV = cur + gap × creditAge` formula, this layout
// shows two structural properties:
//   1. High-percentile rows rise with age (cur grows with cohort age).
//   2. Low-percentile rows fall with age (creditAge × gap shrinks faster
//      than cur recovers).
//   3. FV ≥ cur for every non-mature cell (formula invariant).
import { memo, useMemo, useState } from "react";
import { S, warStyle } from "../../theme.js";
import { NumInput } from "../../components/shared.jsx";
import { calcFutureValue } from "../../utils/futureValue.js";

const AGE_COLS = [14, 16, 18, 20, 22, 24, 26];
const PCT_ROWS = [
  { key: "p99", label: "99th" },
  { key: "p95", label: "95th" },
  { key: "p90", label: "90th" },
  { key: "p75", label: "75th" },
  { key: "p50", label: "50th" },
  { key: "p25", label: "25th" },
  { key: "p10", label: "10th" },
];

const COHORT_LABELS = { hit: "Hitters", sp: "Starters", rp: "Relievers (scaled)" };

export const FVImpactTable = memo(function FVImpactTable({ curveOpts, devCurves }) {
  const { gapMax, gapExp, maxCurrentAge } = curveOpts;
  const [examplePot, setExamplePot] = useState(3.0);
  const [cohort, setCohort] = useState("hit");

  const curve = devCurves?.[cohort] ?? null;

  // Build a quick {age: row} lookup for the cohort's percentiles.
  const byAge = useMemo(() => {
    if (!Array.isArray(curve)) return {};
    return Object.fromEntries(curve.map((r) => [r.age, r]));
  }, [curve]);

  const rows = useMemo(() => {
    if (!curve) return [];
    return PCT_ROWS.map((pr) => ({
      ...pr,
      cells: AGE_COLS.map((age) => {
        const row = byAge[age];
        if (!row || row[pr.key] == null) return { fv: null, cur: null, mature: false, overAchiever: false };
        const cur = row[pr.key];   // empirical cur-WAR at this (age, percentile)
        const mature = age >= maxCurrentAge;
        const overAchiever = cur > examplePot;
        // calcFutureValue handles both early returns (mature → cur, cur > pot → cur)
        // and the standard `cur + gap × creditAge` math. Always returns FV ≥ cur.
        const fv = calcFutureValue(cur, examplePot, age, curveOpts);
        return { fv, cur, mature, overAchiever };
      }),
    }));
  }, [byAge, curve, examplePot, curveOpts, maxCurrentAge]);

  if (!devCurves) {
    return (
      <div style={{ fontSize: 11, color: "#475569" }}>
        Pipeline-emitted devCurve missing from data.meta — rebuild dashboard.json with the v21 pipeline.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>
        Each cell: empirical cur-WAR at (age, percentile) plugged into the v21 FV formula at the chosen example pot.
        Top number is FV; bottom number is the cur value used. High-percentile rows rise with age (cur grows toward pot);
        low-percentile rows fall with age (creditAge shrinks faster than cur grows). Mature cells (age ≥ {maxCurrentAge})
        return cur. Cells where cur &gt; example pot are "over-achievers" — FV = cur in that case.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Cohort:</label>
          <select value={cohort} onChange={(e) => setCohort(e.target.value)} style={{ ...S.filterSelect }}>
            <option value="hit">Hitters</option>
            <option value="sp">Starters</option>
            <option value="rp">Relievers (scaled)</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Example Potential WAR:</label>
          <NumInput min={-5} max={15} step={0.5} value={examplePot} onChange={setExamplePot}
            style={{ width: 60, background: "#0f172a", border: "1px solid #334155", borderRadius: 4, ...warStyle(examplePot), fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
        </div>
        <div style={{ fontSize: 11, color: "#475569" }}>
          ({COHORT_LABELS[cohort]} • cur values from data.meta.devCurve)
        </div>
      </div>

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 60 }}>Dev%</th>
              {AGE_COLS.map((a) => (
                <th key={a} style={{ ...S.th, textAlign: "center" }}>age {a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, cells }) => {
              const isP50 = key === "p50";
              return (
                <tr key={key} style={{ background: isP50 ? "rgba(56,189,248,0.07)" : (PCT_ROWS.findIndex(r => r.key === key) % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)") }}>
                  <td style={{ ...S.td, fontWeight: isP50 ? 800 : 700, color: isP50 ? "#7dd3fc" : "#e2e8f0" }}>{label}</td>
                  {cells.map((c, ci) => (
                    <td key={ci} style={{ ...S.td, textAlign: "center", opacity: c.mature ? 0.55 : 1 }}>
                      {c.fv != null ? (
                        <div>
                          <span style={{ ...warStyle(c.fv), fontWeight: 700 }}>{c.fv.toFixed(2)}</span>
                          <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>
                            {c.mature ? "mature" : c.overAchiever ? `cur=${c.cur.toFixed(1)} (over)` : `cur=${c.cur.toFixed(1)}`}
                          </div>
                        </div>
                      ) : "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>
        Settings: gapMax={gapMax?.toFixed(2)}, gapExp={gapExp}, maxAge={maxCurrentAge}, Pot={examplePot.toFixed(1)}, cohort={COHORT_LABELS[cohort]}
      </div>
    </div>
  );
});
