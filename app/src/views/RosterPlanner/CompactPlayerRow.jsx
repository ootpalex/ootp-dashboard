import { memo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { posColor, warStyle, devPctColor } from "../../theme.js";
import { fmt, fmtAge, fmtSalary } from "../../utils/helpers.js";
import { isEligible, isCurrentlyEligible } from "../../utils/accessors.js";

export const ROW_COLS = "20px 32px 140px 28px 42px 42px 40px 42px 56px 40px 1fr";

export function CompactRowHeader() {
  const th = { fontSize: 9, color: "#64748b", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase" };
  return (
    <div style={{
      display: "grid", gridTemplateColumns: ROW_COLS, alignItems: "center", gap: 4,
      padding: "3px 6px", background: "rgba(15,23,42,0.35)", borderBottom: "1px solid #1e293b",
    }}>
      <span />
      <span style={th}>POS</span>
      <span style={th}>NAME</span>
      <span style={th}>AGE</span>
      <span style={{ ...th, textAlign: "right" }}>WAR</span>
      <span style={{ ...th, textAlign: "right" }}>POT</span>
      <span style={{ ...th, textAlign: "right" }}>DEV%</span>
      <span style={{ ...th, textAlign: "right" }}>FV</span>
      <span style={{ ...th, textAlign: "right" }}>SALARY</span>
      <span style={{ ...th, textAlign: "center" }}>OPT</span>
      <span />
    </div>
  );
}

// Positions a hitter has the ratings for but not yet the reps — surfaced as
// a dev note ("Needs reps at SS, CF") under the row.
const DEV_NOTE_POSITIONS = ["C", "SS", "CF", "2B", "3B", "LF", "RF"];

function devNeedsPositions(player) {
  if (!player || player._type === "pitcher" || player.meta?.isPitcher) return [];
  const primary = player.meta?.pos;
  return DEV_NOTE_POSITIONS.filter(pos =>
    pos !== primary &&
    isEligible(player, pos) &&
    !isCurrentlyEligible(player, pos)
  );
}

export const CompactPlayerRow = memo(function CompactPlayerRow({ player, onSelect, tags, highlight, highlightKind, actions }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: player._uid });
  const [hovered, setHovered] = useState(false);
  const meta = player.meta || {};
  const pos = meta.pos || "?";
  const options = player._options || {};
  const devPct = player._devPct;
  const devPctInt = devPct != null ? Math.round(devPct * 100) : null;
  const yearStatus = player._yearStatus || {};
  const salaryLabel = fmtSalary(yearStatus.salary);
  const isNonGuaranteed = yearStatus.salary > 0 && yearStatus.guaranteed === false;
  const style = {
    display: "grid",
    gridTemplateColumns: ROW_COLS,
    alignItems: "center",
    gap: 4,
    padding: "3px 6px",
    borderBottom: "1px solid #1e293b",
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    cursor: "grab",
    fontSize: 11,
    background: highlight
      ? (highlightKind === "potential" ? "rgba(139,92,246,0.12)" : "rgba(250,204,21,0.12)")
      : hovered ? "rgba(56,189,248,0.10)" : undefined,
    boxShadow: highlight
      ? (highlightKind === "potential" ? "inset 2px 0 0 #a78bfa" : "inset 2px 0 0 #facc15")
      : hovered ? "inset 2px 0 0 #38bdf8" : undefined,
  };
  const needs = devNeedsPositions(player);
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ color: "#475569", fontSize: 10, textAlign: "center" }}>&#x2630;</span>
      <span style={{ color: posColor(pos), fontWeight: 700 }}>{pos}</span>
      <span
        style={{ color: "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
        onClick={(e) => { e.stopPropagation(); onSelect(player._original || player); }}
        title={meta.name}
      >
        {meta.name || "?"}
      </span>
      <span style={{ color: "#94a3b8" }}>{fmtAge(player._age)}</span>
      <span style={{ textAlign: "right", ...warStyle(player._war) }}>{fmt(player._war, 1)}</span>
      <span style={{ textAlign: "right", ...warStyle(player._warP) }}>{fmt(player._warP, 1)}</span>
      <span style={{ textAlign: "right", fontWeight: 600, color: devPctInt != null ? devPctColor(devPctInt) : "#475569" }}>
        {devPctInt != null ? `${devPctInt}` : "—"}
      </span>
      <span style={{ textAlign: "right", ...warStyle(player._fv) }}>{fmt(player._fv, 1)}</span>
      <span style={{
        fontSize: 10, textAlign: "right", fontWeight: 600,
        color: salaryLabel ? (isNonGuaranteed ? "#fbbf24" : "#cbd5e1") : "#475569",
      }} title={isNonGuaranteed ? "Non-guaranteed salary (arb / auto-renew)" : undefined}>
        {salaryLabel || "—"}
      </span>
      <span style={{
        fontSize: 9, textAlign: "center",
        color: options.isLastOptionYear ? "#fde047" : options.outOfOptions ? "#fca5a5" : "#64748b",
        fontWeight: (options.isLastOptionYear || options.outOfOptions) ? 700 : 400,
      }} title={
        options.isLastOptionYear ? "Burning their last option year — demoting next season requires waivers" :
        options.outOfOptions ? "Out of options — must clear waivers to demote" : undefined
      }>
        {options.isLastOptionYear ? "Last Opt"
          : options.outOfOptions ? "NoOpt"
          : options.remaining != null ? `${options.remaining}o` : ""}
      </span>
      <span style={{ fontSize: 9, color: "#94a3b8", display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center" }}>
        {needs.length > 0 && (
          <span
            title={`Has the ratings for ${needs.join(", ")} but needs in-game reps before OOTP grants full credit there.`}
            style={{ padding: "1px 5px", borderRadius: 3, background: "rgba(139,92,246,0.15)", color: "#c4b5fd", fontWeight: 600 }}
          >
            Needs reps: {needs.join("/")}
          </span>
        )}
        {tags && tags.map((t, i) => (
          <span key={i} style={{ padding: "1px 5px", borderRadius: 3, background: t.bg, color: t.color, fontWeight: 600 }}>{t.label}</span>
        ))}
        {actions}
      </span>
    </div>
  );
});
