import { memo } from "react";
import { gradeToColor, posColor, warStyle } from "../../theme.js";
import { num, fmt } from "../../utils/helpers.js";

const tS = { background: "rgba(15,23,42,0.6)", borderRadius: 6, border: "1px solid #1e293b", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 };
const tL = { fontSize: 9, color: "#475569", letterSpacing: 1, textTransform: "uppercase" };
const sectionLabel = { fontSize: 9, color: "#475569", marginBottom: 6, letterSpacing: 1 };
const scoutColor = (v) => { const n = num(v); return n != null ? gradeToColor(n) : "#475569"; };

// Grade tile — inner sub-rating (vL/vR/Pot triple). vL renders first (left-side
// matches the "L" prefix) for readability.
function GradeTile({ label, vR, vL, pot, hidePotential }) {
  const vRn = num(vR), vLn = num(vL), potN = num(pot);
  return (
    <div style={tS}>
      <span style={tL}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        <span style={{ color: scoutColor(vLn) }}>{vLn ?? "—"}</span>
        <span style={{ color: "#475569" }}> / </span>
        <span style={{ color: scoutColor(vRn) }}>{vRn ?? "—"}</span>
        {!hidePotential && potN != null && (
          <span style={{ fontSize: 10, color: scoutColor(potN), marginLeft: 4 }}>→ {potN}</span>
        )}
      </span>
    </div>
  );
}

function ValueTile({ label, value }) {
  return (
    <div style={tS}>
      <span style={tL}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{value}</span>
    </div>
  );
}

// Right-anchored "POT XXX" chip — matches the visual weight of vR/vL/wtd
// labels but in green to clearly signal "this is the projected potential."
function PotChip({ value, valueFmt }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "#4ade80aa", fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>POT </span>
      <span style={{ color: "#4ade80", fontWeight: 700, fontSize: 14 }}>{valueFmt(value)}</span>
    </span>
  );
}

// Slot for a single split value in the 4-quarter ProjTile grid.
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
function ProjTile({ label, vR, vL, wtd, pot, valueFmt = (v) => fmt(v, 1), hidePotential }) {
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

// FamilyBlock — outer parent block for a skill family. Renders the family
// title + headline grade (vR/vL→Pot) at the top, then nested children below.
// `stackTitle` puts the title on its own line above the grade. `centerContent`
// (only meaningful with stackTitle) centers both horizontally — used for
// Control which has no children and looks better centered.
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

// Per-role BF estimates (IP × ~4.18 PA/IP). Used to convert role-normalized
// counts into rate stats for display.
const BF_SP = 185.47 * 4.18;
const BF_RP = 69.55 * 4.18;

function PitchingTab({ player, role }) {
  const vR = player[role]?.vR;
  const vL = player[role]?.vL;
  const wtd = player[role]?.wtd;
  const pro = player.prospect?.[role];
  const sbPct = player[role]?.sbPct;
  const sbPctPot = pro?.sbPct;
  const bf = role === "sp" ? BF_SP : BF_RP;
  const matured = !!player._matured;

  const fmtRate = (v) => v == null ? "—" : v.toFixed(3).replace(/^0/, "");
  const fmtPct = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  const rateOf = (count) => count == null ? null : count / bf;

  // Pitch arsenal — pitchGrades sub-dict (current/potential per pitch type)
  const grades = player.pitchGrades || {};
  const PITCH_LABELS = { fb: "FB", sl: "SL", cb: "CB", cu: "CU", ch: "CH", si: "SI", sp: "SP", ct: "CT", fo: "FO", cc: "CC", sc: "SC", kc: "KC", kn: "KN" };
  const arsenal = Object.keys(PITCH_LABELS)
    .map((k) => ({ key: k, label: PITCH_LABELS[k], cur: num(grades.current?.[k]), pot: num(grades.potential?.[k]) }))
    .filter((p) => p.cur != null || p.pot != null);

  const veloDisplay = player.meta?.velo
    ? (player.meta?.vt && player.meta.vt !== player.meta.velo
        ? <>{player.meta.velo}<span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 4 }}>→ {player.meta.vt}</span></>
        : player.meta.velo)
    : "—";

  const stmRaw = num(player.ratings?.stm ?? player.meta?.stm ?? player.STM);
  const stmDisplay = stmRaw != null ? Math.round(stmRaw) : "—";

  return (
    <div style={{ padding: "12px 18px" }}>
      {/* Role caption */}
      <div style={{ marginBottom: 8, fontSize: 10, color: "#64748b" }}>
        Showing as <span style={{ color: posColor(role.toUpperCase()), fontWeight: 700 }}>{role === "sp" ? "STARTER" : "RELIEVER"}</span>
        <span style={{ marginLeft: 6 }}>(toggle in header to switch)</span>
      </div>

      {/* Section 1 — Model projections */}
      <div style={{ marginBottom: 14 }}>
        <div style={sectionLabel}>MODEL PROJECTIONS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
          <div style={tS}>
            <span style={tL}>WAR (wtd)</span>
            <div style={{
              display: "grid",
              gridTemplateColumns: !matured && num(pro?.war) != null && num(pro.war) !== num(wtd?.war) ? "1fr auto" : "1fr",
              gap: 14,
              alignItems: "baseline",
            }}>
              <span style={{ fontSize: 15, fontWeight: 700, ...warStyle(num(wtd?.war)) }}>{fmt(num(wtd?.war), 2)}</span>
              {!matured && num(pro?.war) != null && num(pro.war) !== num(wtd?.war) && (
                <PotChip value={num(pro.war)} valueFmt={(v) => fmt(v, 2)} />
              )}
            </div>
          </div>
          <ProjTile label="wOBA-against" vR={num(vR?.woba)} vL={num(vL?.woba)} wtd={num(wtd?.woba)} pot={num(pro?.woba)} valueFmt={fmtRate} hidePotential={matured} />
          <ProjTile label="RA/9" vR={num(vR?.ra9)} vL={num(vL?.ra9)} wtd={num(wtd?.ra9)} pot={num(pro?.ra9)} valueFmt={(v) => fmt(v, 2)} hidePotential={matured} />
          <ProjTile label="K%" vR={rateOf(num(vR?.so))} vL={rateOf(num(vL?.so))} wtd={rateOf(num(wtd?.so))} pot={rateOf(num(pro?.so))} valueFmt={fmtPct} hidePotential={matured} />
          <ProjTile label="BB%" vR={rateOf(num(vR?.ubb))} vL={rateOf(num(vL?.ubb))} wtd={rateOf(num(wtd?.ubb))} pot={rateOf(num(pro?.ubb))} valueFmt={fmtPct} hidePotential={matured} />
          <ProjTile label="HR%" vR={rateOf(num(vR?.hr))} vL={rateOf(num(vL?.hr))} wtd={rateOf(num(wtd?.hr))} pot={rateOf(num(pro?.hr))} valueFmt={fmtPct} hidePotential={matured} />
          <div style={tS}>
            <span style={tL}>SB%</span>
            <div style={{
              display: "grid",
              gridTemplateColumns: !matured && num(sbPctPot) != null && num(sbPctPot) !== num(sbPct) ? "1fr auto" : "1fr",
              gap: 14,
              alignItems: "baseline",
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#cbd5e1" }}>{fmtPct(num(sbPct))}</span>
              {!matured && num(sbPctPot) != null && num(sbPctPot) !== num(sbPct) && (
                <PotChip value={num(sbPctPot)} valueFmt={fmtPct} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Section 2 — OOTP scouting grades, nested by skill family */}
      <div>
        <div style={sectionLabel}>OOTP SCOUTING GRADES{matured ? "" : " (vL / vR → Potential)"}</div>

        {/* STUFF — full-width parent containing Velocity + the pitch arsenal */}
        <FamilyBlock
          title="Stuff"
          vR={player.ratings?.vR?.stu}
          vL={player.ratings?.vL?.stu}
          pot={player.ratings?.potential?.stu}
          matured={matured}
        >
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, alignItems: "stretch" }}>
            <ValueTile label="Velocity" value={veloDisplay} />
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.max(arsenal.length, 1)}, minmax(56px, 1fr))`,
              gap: 4,
            }}>
              {arsenal.length === 0 ? (
                <div style={{ ...tS, justifyContent: "center", color: "#475569", fontSize: 11 }}>
                  No pitch arsenal data
                </div>
              ) : arsenal.map((p) => (
                <div key={p.key} style={{ ...tS, padding: "6px 6px", textAlign: "center", alignItems: "center" }}>
                  <span style={{ ...tL, textAlign: "center" }}>{p.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>
                    <span style={{ color: scoutColor(p.cur) }}>{p.cur ?? "—"}</span>
                    {!matured && p.pot != null && p.pot !== p.cur && (
                      <span style={{ fontSize: 12, color: scoutColor(p.pot), marginLeft: 4 }}>→ {p.pot}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </FamilyBlock>

        {/* MOVEMENT (wide) + CONTROL (compact) + STAMINA (compact). alignItems:center
            keeps Control/Stamina at their natural height *and* vertically centers them
            against Movement (which is taller because of its children). */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginTop: 10, alignItems: "center" }}>
          <FamilyBlock
            title="Movement"
            vR={player.ratings?.vR?.mov}
            vL={player.ratings?.vL?.mov}
            pot={player.ratings?.potential?.mov}
            matured={matured}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <GradeTile label="HR Rate"
                vR={player.ratings?.vR?.hrr}
                vL={player.ratings?.vL?.hrr}
                pot={player.ratings?.potential?.hrr}
                hidePotential={matured} />
              <GradeTile label="BABIP"
                vR={player.ratings?.vR?.pbabip}
                vL={player.ratings?.vL?.pbabip}
                pot={player.ratings?.potential?.pbabip}
                hidePotential={matured} />
            </div>
          </FamilyBlock>

          <FamilyBlock
            title="Control"
            vR={player.ratings?.vR?.pcon}
            vL={player.ratings?.vL?.pcon}
            pot={player.ratings?.potential?.pcon}
            matured={matured}
            stackTitle
            centerContent
          />

          {/* Stamina — standalone, not a family. Centered like Control. */}
          <div style={{
            background: "rgba(15,23,42,0.4)",
            border: "1px solid #1e293b",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            alignItems: "center",
            textAlign: "center",
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1.4, textTransform: "uppercase" }}>
              Stamina
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{stmDisplay}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(PitchingTab);
