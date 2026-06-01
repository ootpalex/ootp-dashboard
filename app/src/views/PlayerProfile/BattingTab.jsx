import { memo } from "react";
import { gradeToColor } from "../../theme.js";
import { num, fmt } from "../../utils/helpers.js";
import { getBatR } from "../../utils/accessors.js";

const tS = { background: "rgba(15,23,42,0.6)", borderRadius: 6, border: "1px solid #1e293b", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 };
const tL = { fontSize: 9, color: "#475569", letterSpacing: 1, textTransform: "uppercase" };
const sectionLabel = { fontSize: 9, color: "#475569", marginBottom: 6, letterSpacing: 1 };
const scoutColor = (v) => { const n = num(v); return n != null ? gradeToColor(n) : "#475569"; };
const scoutColorInv = (v) => { const n = num(v); return n != null ? gradeToColor(100 - n) : "#475569"; };

// Estimate plate appearances from a split's projected events. Uses OBP
// (which is exported on every split, vR/vL/wtd, and on prospect.batting) to
// recover total PA: PA = on-base events / OBP. This avoids the circular
// trap of using league BABIP to estimate outs-on-BIP (that would force
// computed BABIP back to league average for every player).
function estimatePA(s) {
  if (!s) return null;
  const obp = num(s.obp);
  if (obp == null || obp <= 0) return null;
  const onBase = (num(s.hr) ?? 0) + (num(s.hMinusHr) ?? 0) + (num(s.ubb) ?? 0) + (num(s.hbp) ?? 0);
  if (onBase <= 0) return null;
  return onBase / obp;
}

function rateOf(count, pa) {
  if (count == null || pa == null || pa <= 0) return null;
  return count / pa;
}

function babip(s) {
  if (!s) return null;
  const hMinusHr = num(s.hMinusHr);
  const so = num(s.so), ubb = num(s.ubb), hbp = num(s.hbp) ?? 0, hr = num(s.hr);
  if (hMinusHr == null || so == null || ubb == null || hr == null) return null;
  const pa = estimatePA(s);
  if (pa == null) return null;
  const bip = pa - so - ubb - hbp - hr;
  if (bip <= 0) return null;
  return hMinusHr / bip;
}

// Combine vR + vL into a wtd-equivalent split. `obp` comes from the
// already-exported wtd OBP so PA estimation works for the combined object.
function combineSplits(vR, vL, wtd) {
  if (!vR && !vL) return null;
  return {
    hr:       (num(vR?.hr) ?? 0)       + (num(vL?.hr) ?? 0),
    ubb:      (num(vR?.ubb) ?? 0)      + (num(vL?.ubb) ?? 0),
    hbp:      (num(vR?.hbp) ?? 0)      + (num(vL?.hbp) ?? 0),
    so:       (num(vR?.so) ?? 0)       + (num(vL?.so) ?? 0),
    hMinusHr: (num(vR?.hMinusHr) ?? 0) + (num(vL?.hMinusHr) ?? 0),
    obp:      num(wtd?.obp),
  };
}

function GradeTile({ label, vR, vL, pot, inverted, hidePotential }) {
  const clr = inverted ? scoutColorInv : scoutColor;
  const vRn = num(vR), vLn = num(vL), potN = num(pot);
  return (
    <div style={tS}>
      <span style={tL}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        <span style={{ color: clr(vLn) }}>{vLn ?? "—"}</span>
        <span style={{ color: "#475569" }}> / </span>
        <span style={{ color: clr(vRn) }}>{vRn ?? "—"}</span>
        {!hidePotential && potN != null && (
          <span style={{ fontSize: 10, color: clr(potN), marginLeft: 4 }}>→ {potN}</span>
        )}
      </span>
    </div>
  );
}

// Slot for a single split value in the 4-quarter ProjTile grid. Renders
// nothing if value is null so the slot stays empty but maintains its column.
function Slot({ label, value, valueFmt }) {
  if (value == null) return <span />;
  return (
    <span style={{ fontSize: 14, color: "#cbd5e1", whiteSpace: "nowrap" }}>
      <span style={{ color: "#64748b", fontSize: 10 }}>{label} </span>
      <span style={{ fontWeight: 700 }}>{valueFmt(value)}</span>
    </span>
  );
}
function PotSlot({ value, valueFmt }) {
  if (value == null) return <span />;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "#4ade80aa", fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>POT </span>
      <span style={{ color: "#4ade80", fontWeight: 700, fontSize: 14 }}>{valueFmt(value)}</span>
    </span>
  );
}

// 4-quarter grid: vL · vR · wtd · pot, each left-aligned in its slot.
// Missing values leave empty quarters.
function ProjTile({ label, vR, vL, wtd, pot, valueFmt, hidePotential }) {
  return (
    <div style={tS}>
      <span style={tL}>{label}</span>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 6,
        alignItems: "baseline",
      }}>
        <Slot label="vL"  value={vL}  valueFmt={valueFmt} />
        <Slot label="vR"  value={vR}  valueFmt={valueFmt} />
        <Slot label="wtd" value={wtd} valueFmt={valueFmt} />
        <PotSlot value={hidePotential ? null : pot} valueFmt={valueFmt} />
      </div>
    </div>
  );
}

// FamilyBlock — outer parent block for a skill family. Mirrors the PitchingTab
// version so Movement/Contact look the same. `stackTitle` puts the title on
// its own line; `centerContent` (only meaningful with stackTitle) horizontally
// centers content. Hitter Contact uses the default (inline title bar + children).
function FamilyBlock({ title, vR, vL, pot, matured, children, stackTitle, centerContent }) {
  const vRn = num(vR), vLn = num(vL), potN = num(pot);
  const gradeRow = (
    <span style={{ fontSize: 15, fontWeight: 700 }}>
      <span style={{ color: scoutColor(vLn) }}>{vLn ?? "—"}</span>
      <span style={{ color: "#475569" }}> / </span>
      <span style={{ color: scoutColor(vRn) }}>{vRn ?? "—"}</span>
      {!matured && potN != null && (
        <span style={{ fontSize: 12, color: scoutColor(potN), marginLeft: 6 }}>→ {potN}</span>
      )}
    </span>
  );
  const titleSpan = (
    <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1.4, textTransform: "uppercase" }}>
      {title}
    </span>
  );
  return (
    <div style={{
      background: "rgba(15,23,42,0.4)",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: "10px 12px",
    }}>
      {stackTitle ? (
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          alignItems: centerContent ? "center" : "flex-start",
          textAlign: centerContent ? "center" : "left",
        }}>
          {titleSpan}
          {gradeRow}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: children ? 10 : 0, flexWrap: "wrap" }}>
          {titleSpan}
          {gradeRow}
        </div>
      )}
      {children}
    </div>
  );
}

function BattingTab({ player }) {
  const bvR = player.batting?.vR;
  const bvL = player.batting?.vL;
  const bwtd = player.batting?.wtd;
  const proB = player.prospect?.batting;
  const matured = !!player._matured;

  const batRcur = getBatR(player);
  const batRpot = num(proB?.batR);

  const fmtRate = (v) => v == null ? "—" : v.toFixed(3).replace(/^0/, "");
  const fmtPct = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

  // Per-split BABIP (vR/vL/wtd + potential). Wtd is computed from the combined
  // vR + vL counts paired with the exported wtd OBP, so the wtd row in the
  // ProjTile carries a real number instead of leaving the slot empty.
  const bWtdCombined = combineSplits(bvR, bvL, bwtd);
  const babipVR  = babip(bvR);
  const babipVL  = babip(bvL);
  const babipWtd = babip(bWtdCombined);
  const babipPot = babip(proB);

  // Per-split rates (K%, BB%, HR%) + wtd + potential.
  const paR = estimatePA(bvR);
  const paL = estimatePA(bvL);
  const paW = estimatePA(bWtdCombined);
  const paP = estimatePA(proB);

  return (
    <div style={{ padding: "12px 18px" }}>
      {/* Section 1 — OOTP scouting grades (top), Contact as parent of Avoid K + BABIP */}
      <div style={{ marginBottom: 14 }}>
        <div style={sectionLabel}>OOTP SCOUTING GRADES{matured ? "" : " (vL / vR → Potential)"}</div>

        {/* CONTACT — full-width parent containing Avoid K + BABIP */}
        <FamilyBlock
          title="Contact"
          vR={player.ratings?.vR?.con ?? player["CON vR"]}
          vL={player.ratings?.vL?.con ?? player["CON vL"]}
          pot={player.ratings?.potential?.con ?? player["CON P"]}
          matured={matured}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <GradeTile label="Avoid K" hidePotential={matured}
              vR={player.ratings?.vR?.k ?? player["K vR"]}
              vL={player.ratings?.vL?.k ?? player["K vL"]}
              pot={player.ratings?.potential?.k ?? player["K P"]} />
            <GradeTile label="BABIP" hidePotential={matured}
              vR={player.ratings?.vR?.ba ?? player["BA vR"]}
              vL={player.ratings?.vL?.ba ?? player["BA vL"]}
              pot={player.ratings?.potential?.ht ?? player["HT P"]} />
          </div>
        </FamilyBlock>

        {/* POWER + GAP + EYE — three standalone family blocks in a row.
            Using FamilyBlock (no children) gives them the same 15px headline
            font as Contact, so they read as peer top-level grades. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
          <FamilyBlock title="Power" matured={matured}
            vR={player.ratings?.vR?.pow ?? player["POW vR"]}
            vL={player.ratings?.vL?.pow ?? player["POW vL"]}
            pot={player.ratings?.potential?.pow ?? player["POW P"]} />
          <FamilyBlock title="Gap" matured={matured}
            vR={player.ratings?.vR?.gap ?? player["GAP vR"]}
            vL={player.ratings?.vL?.gap ?? player["GAP vL"]}
            pot={player.ratings?.potential?.gap ?? player["GAP P"]} />
          <FamilyBlock title="Eye" matured={matured}
            vR={player.ratings?.vR?.eye ?? player["EYE vR"]}
            vL={player.ratings?.vL?.eye ?? player["EYE vL"]}
            pot={player.ratings?.potential?.eye ?? player["EYE P"]} />
        </div>
      </div>

      {/* Section 2 — Model projections (bottom) */}
      <div>
        <div style={sectionLabel}>MODEL PROJECTIONS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
          {/* BatR — single tile shows vL / vR / wtd / pot in the 4-quarter grid. */}
          <ProjTile label="BatR"
            vR={num(bvR?.batR)} vL={num(bvL?.batR)} wtd={batRcur} pot={batRpot}
            valueFmt={(v) => fmt(v, 1)} hidePotential={matured} />

          {/* Rate stats */}
          <ProjTile label="wOBA"
            vR={num(bvR?.woba)} vL={num(bvL?.woba)} wtd={num(bwtd?.woba)} pot={num(proB?.woba)}
            valueFmt={fmtRate} hidePotential={matured} />
          <ProjTile label="OBP"
            vR={num(bvR?.obp)} vL={num(bvL?.obp)} wtd={num(bwtd?.obp)} pot={num(proB?.obp)}
            valueFmt={fmtRate} hidePotential={matured} />
          <ProjTile label="BABIP"
            vR={babipVR} vL={babipVL} wtd={babipWtd} pot={babipPot}
            valueFmt={fmtRate} hidePotential={matured} />

          {/* K%, BB%, HR% */}
          <ProjTile label="K%"
            vR={rateOf(num(bvR?.so),  paR)}
            vL={rateOf(num(bvL?.so),  paL)}
            wtd={rateOf(num(bWtdCombined?.so), paW)}
            pot={rateOf(num(proB?.so), paP)}
            valueFmt={fmtPct} hidePotential={matured} />
          <ProjTile label="BB%"
            vR={rateOf(num(bvR?.ubb), paR)}
            vL={rateOf(num(bvL?.ubb), paL)}
            wtd={rateOf(num(bWtdCombined?.ubb), paW)}
            pot={rateOf(num(proB?.ubb), paP)}
            valueFmt={fmtPct} hidePotential={matured} />
          <ProjTile label="HR%"
            vR={rateOf(num(bvR?.hr),  paR)}
            vL={rateOf(num(bvL?.hr),  paL)}
            wtd={rateOf(num(bWtdCombined?.hr), paW)}
            pot={rateOf(num(proB?.hr), paP)}
            valueFmt={fmtPct} hidePotential={matured} />
        </div>
      </div>
    </div>
  );
}

export default memo(BattingTab);
