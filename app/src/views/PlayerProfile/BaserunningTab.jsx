import { memo } from "react";
import { TOKENS as T } from "../../theme.js";
import { num, fmt } from "../../utils/helpers.js";
import { TAB_BODY, TILE as tS, TILE_LABEL as tL, SECTION_LABEL as sectionLabel, SPLIT_LABEL, POT_LABEL, POT_VALUE, scoutColor } from "./_shared.js";

function GradeTile({ label, val, pot, hidePotential }) {
  const valN = num(val), potN = num(pot);
  return (
    <div style={tS}>
      <span style={tL}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        <span style={{ color: scoutColor(valN) }}>{valN ?? "—"}</span>
        {!hidePotential && potN != null && potN !== valN && (
          <span style={{ fontSize: 10, color: scoutColor(potN), marginLeft: 4 }}>→ {potN}</span>
        )}
      </span>
    </div>
  );
}

// Right-anchored "POT XXX" chip — consistent with PitchingTab/BattingTab.
function PotChip({ value, valueFmt }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={POT_LABEL}>POT </span>
      <span style={POT_VALUE}>{valueFmt(value)}</span>
    </span>
  );
}

function BsrValueTile({ label, vR, vL, wtd, pot, hidePotential }) {
  const showPot = !hidePotential && pot != null;
  return (
    <div style={tS}>
      <span style={tL}>{label}</span>
      <div style={{
        display: "grid",
        gridTemplateColumns: showPot ? "1fr auto" : "1fr",
        gap: 14,
        alignItems: "baseline",
      }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline", fontSize: 14, color: T.text, fontVariantNumeric: "tabular-nums" }}>
          {vL != null && (<span><span style={SPLIT_LABEL}>vL </span><span style={{ color: T.text, fontSize: 14 }}>{fmt(vL, 1)}</span></span>)}
          {vR != null && (<span><span style={SPLIT_LABEL}>vR </span><span style={{ color: T.text, fontSize: 14 }}>{fmt(vR, 1)}</span></span>)}
          {wtd != null && (<span><span style={SPLIT_LABEL}>wtd </span><span style={{ color: T.text, fontSize: 14, fontWeight: 700 }}>{fmt(wtd, 1)}</span></span>)}
        </div>
        {showPot && <PotChip value={pot} valueFmt={(v) => fmt(v, 1)} />}
      </div>
    </div>
  );
}

function BaserunningTab({ player }) {
  const brvR = player.baserunning?.vR;
  const brvL = player.baserunning?.vL;
  const brwtd = player.baserunning?.wtd;
  const proBR = player.prospect?.baserunning;
  const matured = !!player._matured;

  return (
    <div style={TAB_BODY}>
      {/* Section 1 — OOTP scouting grades (top) */}
      <div style={{ marginBottom: 14 }}>
        <div style={sectionLabel}>OOTP scouting grades</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          <GradeTile label="Speed" hidePotential={matured}
            val={player.ratings?.spe ?? player.SPE}
            pot={player.ratings?.potential?.spe ?? player["SPE P"]} />
          <GradeTile label="Baserunning" hidePotential={matured}
            val={player.ratings?.run ?? player.RUN}
            pot={player.ratings?.potential?.run ?? player["RUN P"]} />
          <GradeTile label="Stealing" hidePotential={matured}
            val={player.ratings?.sr ?? player.SR}
            pot={player.ratings?.potential?.sr ?? player["SR P"]} />
        </div>
      </div>

      {/* Section 2 — Model projections (bottom) */}
      <div>
        <div style={sectionLabel}>Model projections</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
          <BsrValueTile label="BSR (runs)" hidePotential={matured}
            vR={num(brvR?.bsr)} vL={num(brvL?.bsr)} wtd={num(brwtd?.bsr)}
            pot={num(proBR?.bsr)} />
          <BsrValueTile label="wSB (runs)" hidePotential={matured}
            vR={num(brvR?.wsb)} vL={num(brvL?.wsb)} wtd={num(brwtd?.wsb)}
            pot={num(proBR?.wsb)} />
          <BsrValueTile label="UBR (runs)" hidePotential={matured}
            vR={num(brvR?.ubr)} vL={num(brvL?.ubr)} wtd={num(brwtd?.ubr)}
            pot={num(proBR?.ubr)} />
          <div style={tS}>
            <span style={tL}>SB%</span>
            <div style={{
              display: "grid",
              gridTemplateColumns: !matured && num(proBR?.sbPct) != null && num(proBR.sbPct) !== num(player.baserunning?.sbPct) ? "1fr auto" : "1fr",
              gap: 14,
              alignItems: "baseline",
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                {num(player.baserunning?.sbPct) != null ? `${(num(player.baserunning.sbPct) * 100).toFixed(1)}%` : "—"}
              </span>
              {!matured && num(proBR?.sbPct) != null && num(proBR.sbPct) !== num(player.baserunning?.sbPct) && (
                <PotChip value={num(proBR.sbPct)} valueFmt={(v) => `${(v * 100).toFixed(1)}%`} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(BaserunningTab);
