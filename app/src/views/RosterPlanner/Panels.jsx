// Layout primitives shared across RosterPlanner: SummaryCard, DragOverlayRow,
// DroppablePanel, CoverageStrip, SlotGroup.
// Styling: Night Scorecard — every colour from TOKENS / S (theme.js); the
// bucket colour draws a 3px inset left rule on each panel's header strip.
import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { TOKENS as T, S, posColor } from "../../theme.js";
import { CompactRowHeader, CompactPlayerRow } from "./CompactPlayerRow.jsx";

// Stat tile = scorecard box + compact header strip (label) + value body.
export const SummaryCard = memo(function SummaryCard({ label, value, subtitle, color = T.text2, alert, onClick }) {
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      title={onClick ? "Click for details" : undefined}
      style={{
        ...S.box, border: `1px solid ${alert ? T.bad : T.line2}`,
        flex: "1 1 120px", minWidth: 120,
        cursor: onClick ? "pointer" : "default",
      }}>
      <div style={{ ...S.boxHead, minHeight: 26, padding: "4px 12px", fontSize: 12, fontWeight: 600, color: alert ? T.badSoft : T.text3, background: alert ? T.badBg : T.panel2, borderBottomColor: alert ? T.bad : T.line2 }}>
        {label}
      </div>
      <div style={{ padding: "8px 12px 10px" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        {subtitle && <div style={{ fontSize: 11.5, color: T.text3, marginTop: 3 }}>{subtitle}</div>}
      </div>
    </div>
  );
});

// dnd-kit DragOverlay content: panel3 + 2px accent border is the lift cue (D.12 — no shadow).
export function DragOverlayRow({ player }) {
  const meta = player?.meta || {};
  if (!player) return null;
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "center", padding: "5px 12px",
      background: T.panel3, border: `2px solid ${T.accent}`, borderRadius: T.radius,
      fontSize: 12.5, color: T.text,
    }}>
      <span style={{ color: posColor(meta.pos), fontFamily: T.fonts.narrow, fontWeight: 700 }}>{meta.pos}</span>
      <span style={{ fontWeight: 600 }}>{meta.name}</span>
    </div>
  );
}

export function DroppablePanel({ bucketId, title, subtitle, accent, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: bucketId });
  return (
    <div ref={setNodeRef} style={{
      ...S.box,
      background: isOver ? T.accentBg2 : T.panel,
      border: `1px solid ${isOver ? T.accent : T.line2}`,
      transition: "border-color 0.15s, background 0.15s",
    }}>
      <div style={{ ...S.boxHead, justifyContent: "flex-start", gap: 8, paddingLeft: 14, boxShadow: `inset 3px 0 0 ${accent}` }}>
        <span>{title}</span>
        {subtitle && <span style={{ fontSize: 12, fontWeight: 500, color: T.text3 }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function tileStyle(count, need, ideal) {
  if (count < need) return { bg: T.badBg, color: T.badSoft, border: T.bad };
  if (ideal != null && count < ideal) return { bg: T.warnBg, color: T.warn, border: T.warn };
  return { bg: T.goodBg, color: T.goodSoft, border: T.good };
}

export function CoverageStrip({ coverage, coveragePotential, onHover, hoveredPos, requirements, ideals }) {
  const order = requirements ? Object.keys(requirements) : ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF"];
  const defaultNeed = () => 2;
  const defaultIdeal = (pos) => pos === "C" ? null : 3;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 12px", borderBottom: `1px solid ${T.line}` }}>
      {order.map(pos => {
        const count = coverage[pos] ?? 0;
        const potentialCount = coveragePotential?.[pos] ?? 0;
        const need = requirements ? requirements[pos] : defaultNeed(pos);
        const ideal = ideals ? ideals[pos] : defaultIdeal(pos);
        const s = tileStyle(count, need, ideal);
        const isHovered = hoveredPos === pos;
        const title = potentialCount > 0
          ? `${pos}: ${count} currently eligible, ${potentialCount} with ratings but no experience${ideal != null ? ` (need ≥${need}, ideal ≥${ideal})` : ` (need ≥${need})`}`
          : `${count} ${pos}${ideal != null ? ` (need ≥${need}, ideal ≥${ideal})` : ` (need ≥${need})`}`;
        return (
          <span key={pos}
            onMouseEnter={() => onHover && onHover(pos)}
            onMouseLeave={() => onHover && onHover(null)}
            title={title}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "2px 8px", borderRadius: T.radius,
              background: s.bg, border: `1px solid ${isHovered ? T.accent : s.border}`, color: s.color,
              fontFamily: T.fonts.narrow, fontSize: 12.5, fontWeight: 700, cursor: "default",
              transition: "border-color 0.1s",
            }}>
            <span style={{ color: posColor(pos) }}>{pos}</span>
            <span>{count}</span>
            {potentialCount > 0 && (
              <span style={{ color: T.CHART.series5, fontSize: 11, fontWeight: 600 }}>+{potentialCount}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function SlotGroup({ title, players, onSelect, target, need, tagFn, highlightUids, highlightUidsPotential }) {
  const shortage = need != null && players.length < need;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 10px", background: T.panel2,
        borderBottom: `1px solid ${T.line}`, borderTop: `1px solid ${T.line2}`,
      }}>
        <span style={{ fontFamily: T.fonts.narrow, fontSize: 12.5, fontWeight: 700, color: shortage ? T.badSoft : T.text }}>
          {title}
        </span>
        <span style={{ fontFamily: T.fonts.narrow, fontSize: 12, color: shortage ? T.badSoft : T.text3, fontWeight: 600 }}>
          {players.length}{target ? `/${target}` : ""}{need != null ? ` (min ${need})` : ""}
        </span>
      </div>
      {players.length === 0 && (
        <div style={{ padding: "6px 10px", color: shortage ? T.text3 : T.textDisabled, fontSize: 12, fontStyle: "italic" }}>
          {shortage ? "Requirement unmet" : "—"}
        </div>
      )}
      {players.length > 0 && <CompactRowHeader />}
      {players.map(p => {
        const isCurrent = highlightUids && highlightUids.has(p._uid);
        const isPotential = !isCurrent && highlightUidsPotential && highlightUidsPotential.has(p._uid);
        return (
          <CompactPlayerRow
            key={p._uid}
            player={p}
            onSelect={onSelect}
            tags={tagFn ? tagFn(p) : undefined}
            highlight={isCurrent || isPotential}
            highlightKind={isPotential ? "potential" : "current"}
          />
        );
      })}
    </div>
  );
}
