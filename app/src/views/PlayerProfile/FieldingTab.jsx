import { memo } from "react";
import { TOKENS as T, S, posColor, warStyle } from "../../theme.js";
import { colRule } from "../../components/shared.jsx";
import { num } from "../../utils/helpers.js";
import { isEligible, getRunsP, getWar, getWarP } from "../../utils/accessors.js";
import {
  DEF_SPECTRUM_BY_SLUG,
  DEF_SPECTRUM_DEFAULT,
  ARM_THR_BY_SLUG,
  ARM_THR_DEFAULT,
} from "../../utils/constants.js";
import { leaguePercentile, TAB_BODY, TILE as tS, TILE_LABEL as tL, SECTION_LABEL as sectionLabel, SUB_LABEL, SEP_COLOR, NULL_COLOR, scoutColor, pctColor } from "./_shared.js";

// Eligibility table columns (§B.3 item 14): Pos | WAR RunsP | PosAdj Score.
const ELIG_COLS = [
  { key: "pos", label: "Pos", group: "identity" },
  { key: "war", label: "WAR (vL / vR / wtd)", group: "value" },
  { key: "runsP", label: "RunsP", group: "value" },
  { key: "adj", label: "PosAdj", group: "score", align: "right" },
  { key: "score", label: "Score", group: "score", align: "right" },
];

const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const INF_POS = ["1B", "2B", "3B", "SS"];
const OF_POS = ["LF", "CF", "RF"];

function fmtRunVal(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

function fmtWar(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function fmtAdj(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

function RatingTile({ label, val }) {
  const n = num(val);
  return (
    <div style={tS}>
      <span style={tL}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: scoutColor(n) }}>
        {n ?? "—"}
      </span>
    </div>
  );
}

// Inline percentile mini-pill (56px track): a filled pill to pct% on a panel3
// track, coloured by the OOTP-grade equivalent of the percentile (same rule as
// the header PercentileBar) so green = above avg, red = below.
function PercentileMini({ pct }) {
  if (pct == null) return null;
  const color = pctColor(pct);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ position: "relative", display: "inline-block", width: 56, height: 8 }}>
        <span style={{ position: "absolute", inset: 0, background: T.panel3, borderRadius: T.radiusPill }} />
        <span style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${Math.max(0, Math.min(100, pct))}%`, minWidth: 4, background: color, borderRadius: T.radiusPill }} />
        <span style={{ position: "absolute", top: 0, left: "50%", width: 1, height: 8, background: T.line2 }} />
      </span>
      <span style={{ color, fontWeight: 700, fontSize: 11, fontVariantNumeric: "tabular-nums", minWidth: 18, textAlign: "right" }}>{pct}</span>
    </span>
  );
}

// Split cell for the WAR column: vL / vR / wtd → POT, all colored by warStyle.
function WarCell({ vR, vL, wtd, pot, matured }) {
  const fmt = (v) => v == null ? "—" : fmtWar(v);
  const colorFor = (v) => v == null ? { color: NULL_COLOR } : warStyle(v);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      <span style={{ ...colorFor(vL), fontWeight: 600 }}>{fmt(vL)}</span>
      <span style={{ color: SEP_COLOR }}>/</span>
      <span style={{ ...colorFor(vR), fontWeight: 600 }}>{fmt(vR)}</span>
      <span style={{ color: SEP_COLOR }}>/</span>
      <span style={{ ...colorFor(wtd), fontWeight: 800 }}>{fmt(wtd)}</span>
      {!matured && pot != null && (
        <>
          <span style={{ color: SEP_COLOR }}>→</span>
          <span style={{ color: T.good, fontWeight: 700 }}>{fmt(pot)}</span>
        </>
      )}
    </span>
  );
}

function FieldingTab({ player, peerPools, leagueSlug }) {
  const fr = player.fieldingRatings ?? {};
  const isCatcher = isEligible(player, "C");
  const isInf = INF_POS.some((pos) => isEligible(player, pos));
  const isOf = OF_POS.some((pos) => isEligible(player, pos));
  const matured = !!player._matured;

  // Per-league defensive-spectrum + arm threshold (Option B inputs).
  const defSpectrum = DEF_SPECTRUM_BY_SLUG[leagueSlug] || DEF_SPECTRUM_DEFAULT;
  const armThr = ARM_THR_BY_SLUG[leagueSlug] ?? ARM_THR_DEFAULT;
  const ofArm = num(fr.ofArm);

  // Compute Option B score per eligible position; identify the score winner.
  // Iteration order matches BESTPOS_FIELD_ORDER (hardest → easiest) so the
  // argmax resolves ties toward the harder position.
  const eligibleField = ["C", "SS", "CF", "2B", "3B", "LF", "RF", "1B"].filter(
    (pos) => isEligible(player, pos)
  );
  let bestScorePos = null;
  let bestScoreVal = -Infinity;
  const scores = {};
  for (const pos of eligibleField) {
    const runsP = num(getRunsP(player, pos));
    if (runsP == null) continue;
    const adj = defSpectrum[pos] ?? 0;
    scores[pos] = runsP + adj;
    if (scores[pos] > bestScoreVal) {
      bestScoreVal = scores[pos];
      bestScorePos = pos;
    }
  }

  // bestPos label (matches the table column everywhere else). When the score
  // winner is an outfield corner, the leaf is decided by arm-split (mirrors
  // calcBestPos in utils/dataProcessing.js).
  const lfElig = scores["LF"] != null;
  const rfElig = scores["RF"] != null;
  const armHi = ofArm != null && ofArm >= armThr;
  let displayedBestPos = bestScorePos;
  if (bestScorePos === "LF" || bestScorePos === "RF") {
    displayedBestPos = armHi ? "RF" : "LF";
  }

  // Display order: displayed bestPos first, then defensive spectrum.
  const orderedPositions = eligibleField.slice().sort((a, b) => {
    if (a === displayedBestPos) return -1;
    if (b === displayedBestPos) return 1;
    return FIELD_POSITIONS.indexOf(a) - FIELD_POSITIONS.indexOf(b);
  });

  // Arm-split indicator: marks the LF/RF row whose label was selected by the
  // OF arm vs. threshold rule. Only meaningful when both LF and RF are eligible.
  const isArmLeaf = (pos) => {
    if (pos !== "LF" && pos !== "RF") return false;
    if (!lfElig || !rfElig) return false;
    const leaf = armHi ? "RF" : "LF";
    return pos === leaf;
  };

  return (
    <div style={TAB_BODY}>
      {/* Section 1 — OOTP scouting grades (top) */}
      {(isCatcher || isInf || isOf) && (
        <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...sectionLabel, marginBottom: 0 }}>OOTP scouting grades</div>
          {isCatcher && (
            <div>
              <div style={SUB_LABEL}>Catcher</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                <RatingTile label="C Ability" val={fr.cAbi} />
                <RatingTile label="Framing"   val={fr.cFrm} />
                <RatingTile label="Arm"       val={fr.cArm} />
              </div>
            </div>
          )}
          {isInf && (
            <div>
              <div style={SUB_LABEL}>Infield</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                <RatingTile label="IF Range"   val={fr.ifRng} />
                <RatingTile label="IF Errors"  val={fr.ifErr} />
                <RatingTile label="IF Arm"     val={fr.ifArm} />
                <RatingTile label="Turn DP"    val={fr.tdp} />
              </div>
            </div>
          )}
          {isOf && (
            <div>
              <div style={SUB_LABEL}>Outfield</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                <RatingTile label="OF Range"  val={fr.ofRng} />
                <RatingTile label="OF Errors" val={fr.ofErr} />
                <RatingTile label="OF Arm"    val={fr.ofArm} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section 2 — Model projections per position (compact table) */}
      {orderedPositions.length > 0 && (
        <div>
          <div style={sectionLabel}>Model projections per position</div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  {ELIG_COLS.map((c, ci) => (
                    <th key={c.key} style={{ ...S.th, padding: "6px 8px", ...(colRule(ELIG_COLS, ci) || {}), ...(c.align ? { textAlign: c.align } : {}) }}>
                      {c.key === "war" ? `WAR (vL / vR / wtd${matured ? "" : " → POT"})` : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderedPositions.map((pos, ri) => {
                  const isBest = pos === displayedBestPos;
                  const armLeaf = isArmLeaf(pos);
                  const warWtd = num(getWar(player, pos));
                  const warVR  = num(getWar(player, pos, "vR"));
                  const warVL  = num(getWar(player, pos, "vL"));
                  const warPot = num(getWarP(player, pos));
                  const runsP = num(getRunsP(player, pos));
                  const pool = peerPools?.fielding?.byPos?.[pos.toLowerCase()] ?? null;
                  const pct = runsP != null && pool ? leaguePercentile(runsP, pool) : null;
                  const adj = defSpectrum[pos] ?? 0;
                  const score = scores[pos];
                  const td = (ci, extra) => ({ ...S.td, padding: "0 8px", height: 32, ...(colRule(ELIG_COLS, ci) || {}), ...extra });
                  const rowBg = isBest ? { background: T.goodBg } : (ri % 2 === 1 ? S.zebraRow : undefined);
                  return (
                    <tr key={pos} style={rowBg}>
                      <td style={td(0)}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.15 }}>
                          <span style={{ fontFamily: T.fonts.narrow, color: posColor(pos), fontWeight: 700, fontSize: 13 }}>
                            {pos}{isBest ? " ★" : ""}{armLeaf ? <span style={{ color: T.text3, marginLeft: 4 }}>⤴</span> : null}
                          </span>
                          {armLeaf && ofArm != null && (
                            <span style={{ fontFamily: T.fonts.narrow, fontSize: 11, color: T.text3 }}>arm {ofArm}</span>
                          )}
                        </div>
                      </td>
                      <td style={td(1)}>
                        <WarCell vR={warVR} vL={warVL} wtd={warWtd} pot={warPot} matured={matured} />
                      </td>
                      <td style={td(2)}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                          <span style={{ ...warStyle(runsP), fontWeight: 700, fontSize: 12, minWidth: 40, display: "inline-block" }}>
                            {fmtRunVal(runsP)}
                          </span>
                          <PercentileMini pct={pct} />
                        </span>
                      </td>
                      <td style={td(3, { textAlign: "right", ...warStyle(adj) })}>
                        {fmtAdj(adj)}
                      </td>
                      <td style={td(4, { textAlign: "right", fontSize: 13, ...warStyle(score), fontWeight: 800 })}>
                        {fmtAdj(score)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {orderedPositions.length === 0 && !isCatcher && !isInf && !isOf && (
        <div style={{ fontSize: 12, color: T.text3, padding: "12px 0" }}>
          No fielding eligibility data available.
        </div>
      )}
    </div>
  );
}

export default memo(FieldingTab);
