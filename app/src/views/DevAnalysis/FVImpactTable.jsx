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
import { TOKENS as T, S, warStyle } from "../../theme.js";
import { Section, NumInput, colRule } from "../../components/shared.jsx";
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

// Scorecard column grammar: Dev% | ages (one group rule between them).
const COLS = [
  { key: "pct", label: "Dev%", w: 60, group: "pct" },
  ...AGE_COLS.map((a) => ({ key: String(a), label: `age ${a}`, group: "ages", align: "center" })),
];
const edgePad = (i, v) => (i === 0 ? { padding: `${v} 6px ${v} 12px` } : i === COLS.length - 1 ? { padding: `${v} 12px ${v} 6px` } : {});
const thStyle = (i) => ({ ...S.th, ...(colRule(COLS, i) || {}), ...(COLS[i].align ? { textAlign: COLS[i].align } : {}), ...edgePad(i, "6px"), ...(COLS[i].w ? { width: COLS[i].w } : {}) });
const tdStyle = (i) => ({ ...S.td, ...(colRule(COLS, i) || {}), ...(COLS[i].align ? { textAlign: COLS[i].align } : {}), ...edgePad(i, "0") });

const TITLE = "Future Value Impact Analysis";

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
      <Section title={TITLE}>
        <div style={{ fontSize: 12, color: T.text3 }}>
          Pipeline-emitted devCurve missing from data.meta — rebuild dashboard.json with the v21 pipeline.
        </div>
      </Section>
    );
  }

  return (
    <Section title={TITLE}
      toolbar={<>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: T.text2, fontWeight: 600 }}>Cohort:</label>
          <select value={cohort} onChange={(e) => setCohort(e.target.value)} style={{ ...S.filterSelect }}>
            <option value="hit">Hitters</option>
            <option value="sp">Starters</option>
            <option value="rp">Relievers (scaled)</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: T.text2, fontWeight: 600 }}>Example Potential WAR:</label>
          <NumInput min={-5} max={15} step={0.5} value={examplePot} onChange={setExamplePot}
            style={{ width: 60, background: T.bg, border: `1px solid ${T.line2}`, borderRadius: T.radius, ...warStyle(examplePot), fontSize: 12, fontWeight: 700, fontFamily: "inherit", textAlign: "center", padding: "2px 4px" }} />
        </div>
        <div style={{ fontSize: 11.5, color: T.text3 }}>
          ({COHORT_LABELS[cohort]} • cur values from data.meta.devCurve)
        </div>
      </>}
      footer={`Settings: gapMax=${gapMax?.toFixed(2)}, gapExp=${gapExp}, maxAge=${maxCurrentAge}, Pot=${examplePot.toFixed(1)}, cohort=${COHORT_LABELS[cohort]}`}>
      <div style={{ fontSize: 11.5, color: T.text3, marginBottom: 12, lineHeight: 1.45 }}>
        Each cell: empirical cur-WAR at (age, percentile) plugged into the v21 FV formula at the chosen example pot.
        Top number is FV; bottom number is the cur value used. High-percentile rows rise with age (cur grows toward pot);
        low-percentile rows fall with age (creditAge shrinks faster than cur grows). Mature cells (age ≥ {maxCurrentAge})
        return cur. Cells where cur &gt; example pot are "over-achievers" — FV = cur in that case.
      </div>

      {/* Table runs edge to edge inside the box body (the box border is the rule). */}
      <div style={{ margin: "0 -12px -12px" }}>
        <div style={{ ...S.tableWrap, border: "none", borderRadius: 0, borderTop: `1px solid ${T.line2}` }}>
          <table style={S.table}>
            <thead>
              <tr>
                {COLS.map((c, i) => <th key={c.key} style={thStyle(i)}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, label, cells }) => {
                const isP50 = key === "p50";
                return (
                  <tr key={key} style={isP50 ? S.needRow : (PCT_ROWS.findIndex(r => r.key === key) % 2 === 0 ? undefined : S.zebraRow)}>
                    <td style={{ ...tdStyle(0), fontFamily: T.fonts.narrow, fontWeight: isP50 ? 800 : 700, color: isP50 ? T.accent : T.text }}>{label}</td>
                    {cells.map((c, ci) => (
                      <td key={ci} style={{ ...tdStyle(ci + 1), height: 38, opacity: c.mature ? 0.55 : 1 }}>
                        {c.fv != null ? (
                          <div>
                            <span style={{ ...warStyle(c.fv), fontWeight: 700 }}>{c.fv.toFixed(2)}</span>
                            <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>
                              {c.mature ? "mature" : c.overAchiever ? `cur=${c.cur.toFixed(1)} (over)` : `cur=${c.cur.toFixed(1)}`}
                            </div>
                          </div>
                        ) : <span style={{ color: T.textDisabled }}>—</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
});
