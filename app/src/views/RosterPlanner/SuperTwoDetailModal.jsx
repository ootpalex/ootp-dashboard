// Modal showing the Super-Two cutoff calculation workflow + sorted candidate list.
import { memo, Fragment } from "react";
import { TOKENS as T, S, posColor } from "../../theme.js";

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

// Roster status family: Active good · IL warn · Inactive 40 accent · minors text2.
function statusColor(label) {
  if (label === "Active") return T.good;
  if (label.includes("IL")) return T.warn;
  if (label === "Inactive 40") return T.accent;
  return T.text2;
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
  // Modal framing (B.8): scrim, S.box at maxWidth 880, one header strip; table
  // = the scorecard recipe (S.th / S.td, th not sticky inside the scrolling box).
  const sectionLabel = { fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 600, color: T.text3, marginBottom: 8 };
  const th = (extra) => ({ ...S.th, position: "static", padding: "6px 8px", ...extra });
  const td = (extra) => ({ ...S.td, padding: "0 8px", ...extra });

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: T.scrim, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Super-Two cutoff for ${arbYear} arb class`}
        style={{
          ...S.box,
          maxWidth: 880, width: "100%", maxHeight: "90vh", overflow: "auto",
          color: T.text,
        }}>
        {/* Header strip */}
        <div style={{ ...S.boxHead, position: "sticky", top: 0, zIndex: 1, padding: "8px 14px" }}>
          <span>Super-Two Cutoff for {arbYear} Arb Class</span>
          <button onClick={onClose} aria-label="Close" style={{ ...S.pillBtn, fontSize: 12, padding: "3px 9px" }}>✕ Close</button>
        </div>

        {/* Calculation workflow */}
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.line2}` }}>
          <div style={sectionLabel}>Calculation workflow</div>
          {lines.map(line => (
            <div key={line.n} style={{ display: "flex", gap: 10, marginBottom: 5, fontSize: 12.5, lineHeight: 1.35 }}>
              <span style={{ color: T.text3, minWidth: 16, fontVariantNumeric: "tabular-nums" }}>{line.n}.</span>
              <span style={{ color: T.text2, minWidth: 220 }}>{line.t}:</span>
              <span style={{ color: T.text }}>{line.v}</span>
            </div>
          ))}
        </div>

        {/* Player table */}
        <div style={{ padding: "12px 14px" }}>
          <div style={sectionLabel}>
            Players considered ({candidates.length} total, sorted by projected MLD desc)
          </div>
          <div style={{ ...S.tableWrap }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={th({ textAlign: "right", width: 40 })}>Rank</th>
                  <th style={th({ textAlign: "left" })}>Name</th>
                  <th style={th({ textAlign: "left", width: 50 })}>POS</th>
                  <th style={th({ textAlign: "left", width: 60 })}>ORG</th>
                  <th style={th({ textAlign: "left", width: 90 })}>Status</th>
                  <th style={th({ textAlign: "right", width: 80, ...S.groupRule })}>Current</th>
                  <th style={th({ textAlign: "right", width: 80 })}>Projected</th>
                  <th style={th({ textAlign: "center", width: 30, ...S.groupRule })}>S2</th>
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
                    <Fragment key={c.player._uid}>
                      <tr style={{ background: c.isSuperTwo ? T.accentBg2 : (i % 2 === 1 ? T.zebra : "transparent") }}>
                        <td style={td({ textAlign: "right", color: T.text3 })}>{i + 1}</td>
                        <td style={td({ ...S.tdName })}>{meta.name || "—"}</td>
                        <td style={td({ color: posColor(meta.pos), fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 13 })}>{meta.pos || "—"}</td>
                        <td style={td({ color: T.text2 })}>{meta.org || "—"}</td>
                        <td style={td({ color: statusColor(status), fontWeight: 600 })}>{status}</td>
                        <td style={td({ textAlign: "right", color: T.text2, ...S.groupRule })}>{fmtSt(c.currentMLD)}</td>
                        <td style={td({ textAlign: "right", fontWeight: 600 })}>{fmtSt(c.projectedMLD)}</td>
                        <td style={td({ textAlign: "center", color: c.isSuperTwo ? T.good : T.textDisabled, fontWeight: 700, ...S.groupRule })}>
                          {c.isSuperTwo ? "✓" : "✗"}
                        </td>
                      </tr>
                      {isCutoffRow && (
                        <tr>
                          <td colSpan={8} style={{
                            padding: "3px 0",
                            borderTop: `2px solid ${T.accent}`, borderBottom: `2px solid ${T.accent}`,
                            textAlign: "center", color: T.accent, fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 12,
                            background: T.accentBg,
                          }}>
                            ━━━ CUTOFF: {info.cutoffLabel} ━━━
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 20, textAlign: "center", color: T.text3 }}>
                      No players in the projected 2.xxx bucket.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 10 }}>
            Service-time displayed as Y.DDD where DDD = MLD mod 172. Status reflects current roster classification (drives whether daysToAdd is applied).
          </div>
        </div>
      </div>
    </div>
  );
});
