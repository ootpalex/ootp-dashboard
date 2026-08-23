import { useMemo } from "react";
import { TOKENS as T, posColor, proneColor, PRONE, warStyle, mixOklab } from "../../theme.js";
import { fmt, fmtAge, parseCSVBoolean } from "../../utils/helpers.js";
import { getMaxWar } from "../../utils/accessors.js";
import { ACTIVE_ROSTER_DEPTH } from "../../utils/constants.js";
import { optimizeDefensivePositions, assignPlayersToPositions } from "../../utils/positioning.js";
import { Section, TwoWayBadge } from "../../components/shared.jsx";

// Field-position chip coordinates in a 100×80 viewBox. Home plate at (50, 76);
// outfield is up. SS/2B pushed slightly further apart (35/65 vs the natural
// 40/60) so 140px chips don't overlap on narrower screens. DH sits in the
// on-deck area off to the right of home plate.
const POS_COORDS = {
  C:  { x: 50, y: 76 },
  "1B": { x: 75, y: 56 },
  "2B": { x: 65, y: 36 },
  SS:   { x: 35, y: 36 },
  "3B": { x: 25, y: 56 },
  LF:   { x: 15, y: 24 },
  CF:   { x: 50, y: 14 },
  RF:   { x: 85, y: 24 },
  DH:   { x: 92, y: 72 },
};
const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

// Diamond fills (inventory §B.10): grass = goodBg; dirt / mound = the RP tan (CHART.series6)
// mixed over panel at 8% / 25% in OKLab — derived from theme, not literals.
const DIRT = mixOklab(T.CHART.series6, 0.08, T.panel);
const MOUND = mixOklab(T.CHART.series6, 0.25, T.panel);

function isInjuredCheck(p) {
  return (p?.meta?.inj != null ? p.meta.inj === "Yes" : parseCSVBoolean(p?.INJ));
}

// 140px-wide card used everywhere on this page (field starters, rotation,
// bullpen, bench). Shows POS · full name (wraps to 2 lines if needed) · WAR ·
// age · injury proneness color. Empty slots render as dashed placeholders.
function PlayerCard({ p, label, onSelectPlayer }) {
  const war = p?._assignedVal ?? (p ? (p._type === "pitcher" ? p._war : getMaxWar(p)) : null);
  const injured = isInjuredCheck(p);
  const prone = p?.meta?.prone ?? p?.Prone;
  const empty = !p;

  return (
    <div
      onClick={p ? () => onSelectPlayer?.(p) : undefined}
      style={{
        width: 140,
        padding: "5px 8px 6px",
        borderRadius: T.radius,
        background: empty ? T.bg : T.panel,
        border: empty ? `1px dashed ${T.line2}` : `1px solid ${T.line2}`,
        cursor: empty ? "default" : "pointer",
        textAlign: "left",
        userSelect: "none",
        transition: "border-color 0.1s",
        boxSizing: "border-box",
      }}
      onMouseEnter={(e) => { if (!empty) e.currentTarget.style.borderColor = T.text; }}
      onMouseLeave={(e) => { if (!empty) e.currentTarget.style.borderColor = T.line2; }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
        <span style={{ color: posColor(label), fontFamily: T.fonts.narrow, fontSize: 11, fontWeight: 700 }}>{label}</span>
        {p && <span style={{ ...warStyle(war), fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmt(war)}</span>}
      </div>
      {empty ? (
        <div style={{ fontSize: 11, color: T.textDisabled, marginTop: 2 }}>—</div>
      ) : (
        <div style={{
          color: injured ? T.warn : T.text,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.25,
          marginTop: 1,
          wordBreak: "break-word",
        }}>
          {p.meta?.name ?? p.Name}
          <TwoWayBadge player={p} />
          {injured && <span style={{ color: T.bad, marginLeft: 4, fontSize: 9, fontFamily: T.fonts.narrow, fontWeight: 700 }}>INJ</span>}
        </div>
      )}
      {p && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 3, fontSize: 10, color: T.text3 }}>
          <span>{fmtAge(p._age)}</span>
          {prone && <span style={{ color: proneColor(prone), fontWeight: PRONE[prone]?.weight ?? 600 }}>{prone}</span>}
        </div>
      )}
    </div>
  );
}

// Diamond + 9 starter chips on an SVG field.
function FieldDiagram({ byPos, onSelectPlayer }) {
  return (
    <div style={{
      position: "relative",
      width: "100%",
      maxWidth: 640,
      aspectRatio: "10 / 8",
      margin: "0 auto",
    }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}>
        {/* Outfield grass. Foul-pole coords (2, 28) / (98, 28) are on the same
            straight line as home→3B bag (slope 1) and home→1B bag (slope -1),
            so the OF boundary continues smoothly from the infield baselines
            with no kink at the bags. */}
        <path d="M 50 76 L 2 28 Q 50 -24 98 28 Z" fill={T.goodBg} stroke={T.line} strokeWidth="0.25" />
        {/* Infield dirt diamond */}
        <path d="M 50 76 L 28 54 L 50 32 L 72 54 Z" fill={DIRT} stroke={T.line} strokeWidth="0.22" />
        {/* Infield grass (inner cutout) */}
        <path d="M 50 70 L 34 54 L 50 38 L 66 54 Z" fill={T.goodBg} stroke="none" />
        {/* Base markers */}
        <rect x="49" y="75" width="2" height="2" fill={T.text2} />
        <rect x="71" y="53" width="2" height="2" fill={T.text2} />
        <rect x="49" y="31" width="2" height="2" fill={T.text2} />
        <rect x="27" y="53" width="2" height="2" fill={T.text2} />
        {/* Pitcher's mound */}
        <circle cx="50" cy="54" r="2.4" fill={MOUND} stroke={T.line2} strokeWidth="0.18" />
        {/* Home plate */}
        <polygon points="48.5,76 51.5,76 51.5,77.3 50,78.3 48.5,77.3" fill={T.text} />
      </svg>
      {FIELD_POSITIONS.map((pos) => {
        const c = POS_COORDS[pos];
        return (
          <div key={pos} style={{
            position: "absolute",
            left: `${c.x}%`,
            top: `${c.y}%`,
            transform: "translate(-50%, -50%)",
            zIndex: 2,
          }}>
            <PlayerCard p={byPos[pos]} label={pos} onSelectPlayer={onSelectPlayer} />
          </div>
        );
      })}
    </div>
  );
}

export default function ActiveRosterSubTab({ data, team, onSelectPlayer }) {
  const teamHitters = useMemo(() => data.hitters.filter((h) => (h.meta?.org ?? h.ORG) === team), [data.hitters, team]);
  const teamPitchers = useMemo(() => data.pitchers.filter((p) => (p.meta?.org ?? p.ORG) === team), [data.pitchers, team]);

  const mlbHitters = useMemo(() => teamHitters.filter((h) =>
    ((h.meta?.lev ?? h.Lev) === "MLB" && (h.meta?.on40 ?? (h.ON40 === "Yes"))) || ((h.meta?.lev ?? h.Lev) === "MLB" && isInjuredCheck(h))
  ), [teamHitters]);
  const mlbPitchers = useMemo(() => teamPitchers.filter((p) =>
    ((p.meta?.lev ?? p.Lev) === "MLB" && (p.meta?.on40 ?? (p.ON40 === "Yes"))) || ((p.meta?.lev ?? p.Lev) === "MLB" && isInjuredCheck(p))
  ), [teamPitchers]);

  const { assigned, unassigned } = useMemo(() => {
    const result = assignPlayersToPositions(mlbHitters, mlbPitchers, ACTIVE_ROSTER_DEPTH, "current");

    const hitterPositions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
    const rawStarters = [];
    hitterPositions.forEach((pos) => {
      if (result.assigned[pos]?.length > 0) rawStarters.push(result.assigned[pos][0]);
    });
    if (rawStarters.length > 0) {
      const optimized = optimizeDefensivePositions(rawStarters, hitterPositions);
      hitterPositions.forEach((pos) => { result.assigned[pos] = []; });
      optimized.forEach((p) => { result.assigned[p._assignedPos] = [p]; });
    }
    return result;
  }, [mlbHitters, mlbPitchers]);

  const byPos = useMemo(() => {
    const m = {};
    FIELD_POSITIONS.forEach((pos) => { m[pos] = assigned[pos]?.[0] ?? null; });
    return m;
  }, [assigned]);

  const sp = assigned.SP ?? [];
  const rp = assigned.RP ?? [];
  const bench = unassigned;
  const filledStarters = Object.values(byPos).filter(Boolean).length;

  // Group labels: 12px Archivo Narrow sentence case (mockup sub-captions).
  const sectionLabel = { fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 6 };

  return (
    <Section
      title="Active Roster"
      state={`${filledStarters}/9 starters · ${sp.length}/5 SP · ${rp.length}/8 RP · ${bench.length} bench`}
      footer={<>Total: {mlbHitters.length + mlbPitchers.length} MLB-level players ({mlbHitters.length} position, {mlbPitchers.length} pitchers)</>}
    >
      <div style={{
        display: "grid",
        gridTemplateColumns: "286px 1fr 140px",
        gap: 16,
        alignItems: "start",
      }}>
        {/* Left column: Rotation (top) + Bullpen (bottom), both 2-col grids of 140px cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={sectionLabel}>Rotation ({sp.length}/5)</div>
            <div style={{ display: "grid", gridTemplateColumns: "140px 140px", gap: 6 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <PlayerCard key={"sp-" + i} p={sp[i] ?? null} label="SP" onSelectPlayer={onSelectPlayer} />
              ))}
            </div>
          </div>
          <div>
            <div style={sectionLabel}>Bullpen ({rp.length}/8)</div>
            <div style={{ display: "grid", gridTemplateColumns: "140px 140px", gap: 6 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <PlayerCard key={"rp-" + i} p={rp[i] ?? null} label="RP" onSelectPlayer={onSelectPlayer} />
              ))}
            </div>
          </div>
        </div>

        {/* Center: Field Diagram */}
        <div>
          <div style={{ ...sectionLabel, textAlign: "center" }}>Starting lineup</div>
          <FieldDiagram byPos={byPos} onSelectPlayer={onSelectPlayer} />
        </div>

        {/* Right column: Bench (single column of 140px cards) */}
        <div>
          <div style={sectionLabel}>Bench ({bench.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {bench.length === 0 ? (
              <div style={{ fontSize: 12, color: T.text3, padding: "8px 0" }}>
                No unassigned players
              </div>
            ) : (
              bench.map((p, i) => (
                <PlayerCard
                  key={p.ID + "-bench-" + i}
                  p={p}
                  label={p._type === "pitcher" ? (p.starter ? "SP" : "RP") : (p.meta?.pos ?? p.POS)}
                  onSelectPlayer={onSelectPlayer}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
