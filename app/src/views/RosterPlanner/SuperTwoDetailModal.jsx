// Modal showing the Super-Two cutoff calculation workflow + sorted candidate list.
import { memo } from "react";
import { posColor } from "../../theme.js";

const DAYS_PER_SEASON = 172;

function fmtSt(mld) {
  if (mld == null) return "—";
  return `${Math.floor(mld / DAYS_PER_SEASON)}.${String(mld % DAYS_PER_SEASON).padStart(3, "0")}`;
}

function rosterStatusLabel(player) {
  const m = player?.meta || {};
  if (m._ilLong) return "60-day IL";
  if (m._ilShort) return "15-day IL";
  if (m.act === true) return "Active";
  if (m.ic && m.ic !== "-" && m.ic !== "" && m.lev === "MLB") return "MLB IL";
  if (m.on40 === true) return "Inactive 40";
  return m.lev || "Minors";
}

function statusColor(label) {
  if (label === "Active") return "#4ade80";
  if (label.includes("IL")) return "#fbbf24";
  if (label === "Inactive 40") return "#60a5fa";
  return "#94a3b8";
}

function workflowLines(info, gameYear) {
  const { seasonDay, limbo, daysToAdd, algoOffset, candidates, cutoffIndex, cutoffLabel } = info;
  const arbYear = gameYear + algoOffset + 1;
  const N = candidates.length;

  const stateText = seasonDay > 0
    ? `In-season, day ${seasonDay} of ${gameYear}`
    : limbo
      ? `Offseason — ${gameYear} regular season complete`
      : `Pre-season ${gameYear}`;

  const daysText = seasonDay > 0
    ? `${DAYS_PER_SEASON - seasonDay} (rest of ${gameYear}) + ${algoOffset} future seasons = ${daysToAdd}`
    : limbo
      ? `0 (${gameYear} already in MLD) + ${algoOffset} future seasons = ${daysToAdd}`
      : `${DAYS_PER_SEASON} (full ${gameYear} ahead) + ${algoOffset} future seasons = ${daysToAdd}`;

  return [
    { n: 1, t: "Detected season state",        v: stateText },
    { n: 2, t: "Days to project ahead",        v: daysText },
    { n: 3, t: "Per-player projection",        v: `Active and IL players gain ${daysToAdd} days; minors and inactive 40-man do not accrue` },
    { n: 4, t: "Players in the 2-year class",  v: `${N} projected between 2.000 and 2.171 (≥86 days accrued last year)` },
    { n: 5, t: "Top-22% threshold",            v: `${cutoffIndex + 1}th-ranked player sets cutoff at ${cutoffLabel}` },
    { n: 6, t: "Result",                       v: `${arbYear} arb-class cutoff = ${cutoffLabel}` },
  ];
}

export const SuperTwoDetailModal = memo(function SuperTwoDetailModal({ open, info, gameYear, onClose }) {
  if (!open || !info) return null;
  const arbYear = gameYear + info.algoOffset + 1;
  const lines = workflowLines(info, gameYear);
  const candidates = info.candidates || [];

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10,
          maxWidth: 880, width: "100%", maxHeight: "90vh", overflow: "auto",
          color: "#e2e8f0", fontFamily: "monospace",
        }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid #1e293b",
          position: "sticky", top: 0, background: "#0f172a", zIndex: 1,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa" }}>
            Super-Two Cutoff for {arbYear} Arb Class
          </div>
          <button onClick={onClose}
            style={{
              background: "transparent", border: "1px solid #475569", color: "#94a3b8",
              borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer",
            }}>✕ Close</button>
        </div>

        {/* Calculation workflow */}
        <div style={{ padding: "16px 18px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            Calculation workflow
          </div>
          {lines.map(line => (
            <div key={line.n} style={{ display: "flex", gap: 10, marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: "#475569", minWidth: 16 }}>{line.n}.</span>
              <span style={{ color: "#94a3b8", minWidth: 220 }}>{line.t}:</span>
              <span style={{ color: "#e2e8f0" }}>{line.v}</span>
            </div>
          ))}
        </div>

        {/* Player table */}
        <div style={{ padding: "12px 18px" }}>
          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            Players considered ({candidates.length} total, sorted by projected MLD desc)
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid #1e293b" }}>
                <th style={{ textAlign: "right", padding: "6px 8px", width: 40 }}>Rank</th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "6px 8px", width: 50 }}>POS</th>
                <th style={{ textAlign: "left", padding: "6px 8px", width: 60 }}>ORG</th>
                <th style={{ textAlign: "left", padding: "6px 8px", width: 90 }}>Status</th>
                <th style={{ textAlign: "right", padding: "6px 8px", width: 80 }}>Current</th>
                <th style={{ textAlign: "right", padding: "6px 8px", width: 80 }}>Projected</th>
                <th style={{ textAlign: "center", padding: "6px 8px", width: 30 }}>S2</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => {
                const meta = c.player?.meta || {};
                const status = rosterStatusLabel(c.player);
                // Render the cutoff divider AFTER the last ✓ row so ties at
                // the cutoff value all stay above the line.
                const isCutoffRow = c.isSuperTwo
                  && (i + 1 === candidates.length || !candidates[i + 1].isSuperTwo);
                return (
                  <>
                    <tr key={c.player._uid} style={{
                      borderBottom: "1px solid #0f172a",
                      background: c.isSuperTwo ? "rgba(167,139,250,0.05)" : "transparent",
                    }}>
                      <td style={{ textAlign: "right", padding: "5px 8px", color: "#475569" }}>{i + 1}</td>
                      <td style={{ padding: "5px 8px", color: "#e2e8f0", fontWeight: 600 }}>{meta.name || "—"}</td>
                      <td style={{ padding: "5px 8px", color: posColor(meta.pos), fontWeight: 700 }}>{meta.pos || "—"}</td>
                      <td style={{ padding: "5px 8px", color: "#94a3b8" }}>{meta.org || "—"}</td>
                      <td style={{ padding: "5px 8px", color: statusColor(status) }}>{status}</td>
                      <td style={{ textAlign: "right", padding: "5px 8px", color: "#94a3b8" }}>{fmtSt(c.currentMLD)}</td>
                      <td style={{ textAlign: "right", padding: "5px 8px", color: "#e2e8f0", fontWeight: 600 }}>{fmtSt(c.projectedMLD)}</td>
                      <td style={{ textAlign: "center", padding: "5px 8px", color: c.isSuperTwo ? "#4ade80" : "#475569", fontWeight: 700 }}>
                        {c.isSuperTwo ? "✓" : "✗"}
                      </td>
                    </tr>
                    {isCutoffRow && (
                      <tr key={`${c.player._uid}-cutoff`}>
                        <td colSpan={8} style={{
                          padding: "4px 0",
                          borderTop: "2px solid #a78bfa", borderBottom: "2px solid #a78bfa",
                          textAlign: "center", color: "#a78bfa", fontWeight: 700, fontSize: 11,
                          background: "rgba(167,139,250,0.08)",
                        }}>
                          ━━━ CUTOFF: {info.cutoffLabel} ━━━
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
                    No players in the projected 2.xxx bucket.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 12 }}>
            Service-time displayed as Y.DDD where DDD = MLD mod 172. Status reflects current roster classification (drives whether daysToAdd is applied).
          </div>
        </div>
      </div>
    </div>
  );
});
