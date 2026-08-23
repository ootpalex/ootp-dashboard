import { memo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { TOKENS as T, posColor, warStyle, devPctColor } from "../../theme.js";
import { fmt, fmtAge, fmtSalary } from "../../utils/helpers.js";
import { isEligible, isCurrentlyEligible } from "../../utils/accessors.js";
import { POTENTIAL_BG, POTENTIAL_CHIP_BG, TAG_CHIP } from "./_shared.js";

export const ROW_COLS = "20px 32px 140px 28px 42px 42px 40px 42px 56px 40px 1fr";

// Column header for the compact rows: 12px Archivo Narrow 600 text2 on the
// panel-2 strip (the table-head recipe), sentence case.
export function CompactRowHeader() {
  const th = { fontFamily: T.fonts.narrow, fontSize: 12, color: T.text2, fontWeight: 600, whiteSpace: "nowrap" };
  return (
    <div style={{
      display: "grid", gridTemplateColumns: ROW_COLS, alignItems: "center", gap: 4,
      padding: "0 6px", height: 26, background: T.panel2, borderBottom: `1px solid ${T.line2}`,
    }}>
      <span />
      <span style={th}>Pos</span>
      <span style={th}>Name</span>
      <span style={th}>Age</span>
      <span style={{ ...th, textAlign: "right" }}>WAR</span>
      <span style={{ ...th, textAlign: "right" }}>Pot</span>
      <span style={{ ...th, textAlign: "right" }}>Dev%</span>
      <span style={{ ...th, textAlign: "right" }}>FV</span>
      <span style={{ ...th, textAlign: "right" }}>Salary</span>
      <span style={{ ...th, textAlign: "center" }}>Opt</span>
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
  // Coverage highlight: current = accentBg, potential = series5 at 12%; hover = panel3.
  // The 2px left rule is an inset border, not a shadow (D.12 / inventory B.11).
  const style = {
    display: "grid",
    gridTemplateColumns: ROW_COLS,
    alignItems: "center",
    gap: 4,
    padding: "0 6px",
    minHeight: 29,
    borderBottom: `1px solid ${T.line}`,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    cursor: "grab",
    fontSize: 12,
    color: T.text,
    fontVariantNumeric: "tabular-nums",
    background: highlight
      ? (highlightKind === "potential" ? POTENTIAL_BG : T.accentBg)
      : hovered ? T.panel3 : undefined,
    boxShadow: highlight
      ? (highlightKind === "potential" ? `inset 2px 0 0 ${T.CHART.series5}` : `inset 2px 0 0 ${T.accent}`)
      : hovered ? `inset 2px 0 0 ${T.accent}` : undefined,
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
      <span style={{ color: T.textDisabled, fontSize: 10, textAlign: "center" }}>&#x2630;</span>
      <span style={{ color: posColor(pos), fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 12.5 }}>{pos}</span>
      <span
        style={{ color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
        onClick={(e) => { e.stopPropagation(); onSelect(player._original || player); }}
        title={meta.name}
      >
        {meta.name || "?"}
      </span>
      <span style={{ color: T.text2 }}>{fmtAge(player._age)}</span>
      <span style={{ textAlign: "right", ...warStyle(player._war) }}>{fmt(player._war, 1)}</span>
      <span style={{ textAlign: "right", ...warStyle(player._warP) }}>{fmt(player._warP, 1)}</span>
      <span style={{ textAlign: "right", fontWeight: 600, color: devPctInt != null ? devPctColor(devPct) : T.textDisabled }}>
        {devPctInt != null ? `${devPctInt}` : "—"}
      </span>
      <span style={{ textAlign: "right", ...warStyle(player._fv) }}>{fmt(player._fv, 1)}</span>
      <span style={{
        fontSize: 11.5, textAlign: "right", fontWeight: 600,
        color: salaryLabel ? (isNonGuaranteed ? T.warn : T.text) : T.textDisabled,
      }} title={isNonGuaranteed ? "Non-guaranteed salary (arb / auto-renew)" : undefined}>
        {salaryLabel || "—"}
      </span>
      <span style={{
        fontFamily: T.fonts.narrow, fontSize: 11, textAlign: "center", whiteSpace: "nowrap",
        color: options.isLastOptionYear ? T.warn : options.outOfOptions ? T.badSoft : T.text3,
        fontWeight: (options.isLastOptionYear || options.outOfOptions) ? 700 : 500,
      }} title={
        options.isLastOptionYear ? "Burning their last option year — demoting next season requires waivers" :
        options.outOfOptions ? "Out of options — must clear waivers to demote" : undefined
      }>
        {options.isLastOptionYear ? "Last Opt"
          : options.outOfOptions ? "NoOpt"
          : options.remaining != null ? `${options.remaining}o` : ""}
      </span>
      <span style={{ fontSize: 11, color: T.text2, display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center", padding: "2px 0" }}>
        {needs.length > 0 && (
          <span
            title={`Has the ratings for ${needs.join(", ")} but needs in-game reps before OOTP grants full credit there.`}
            style={{ ...TAG_CHIP, background: POTENTIAL_CHIP_BG, color: T.CHART.series5 }}
          >
            Needs reps: {needs.join("/")}
          </span>
        )}
        {tags && tags.map((t, i) => (
          <span key={i} style={{ ...TAG_CHIP, background: t.bg, color: t.color, ...(t.border ? { border: `1px solid ${t.border}`, lineHeight: "14px" } : {}) }}>{t.label}</span>
        ))}
        {actions}
      </span>
    </div>
  );
});
