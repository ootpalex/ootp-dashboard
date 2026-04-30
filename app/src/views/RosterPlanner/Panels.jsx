// Layout primitives shared across RosterPlanner: SummaryCard, DragOverlayRow,
// DroppablePanel, CoverageStrip, SlotGroup.
import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { posColor } from "../../theme.js";
import { CompactRowHeader, CompactPlayerRow } from "./CompactPlayerRow.jsx";

export const SummaryCard = memo(function SummaryCard({ label, value, subtitle, color = "#94a3b8", alert, onClick }) {
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      style={{
        background: alert ? "rgba(239,68,68,0.1)" : "rgba(15,23,42,0.5)",
        border: `1px solid ${alert ? "#dc2626" : "#1e293b"}`,
        borderRadius: 8, padding: "12px 14px", flex: "1 1 120px", minWidth: 120,
        cursor: onClick ? "pointer" : "default",
      }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: -0.5 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
});

export function DragOverlayRow({ player }) {
  const meta = player?.meta || {};
  if (!player) return null;
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "center", padding: "6px 12px",
      background: "rgba(30,41,59,0.95)", border: "1px solid #3b82f6", borderRadius: 6,
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)", fontSize: 12, color: "#e2e8f0",
    }}>
      <span style={{ color: posColor(meta.pos), fontWeight: 700 }}>{meta.pos}</span>
      <span style={{ fontWeight: 600 }}>{meta.name}</span>
    </div>
  );
}

export function DroppablePanel({ bucketId, title, subtitle, accent, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: bucketId });
  return (
    <div ref={setNodeRef} style={{
      background: isOver ? "rgba(96,165,250,0.05)" : "rgba(15,23,42,0.3)",
      border: `1px solid ${isOver ? "#3b82f6" : "#1e293b"}`,
      borderRadius: 8, marginBottom: 12,
      transition: "border-color 0.15s, background 0.15s",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderBottom: "1px solid #1e293b", background: "rgba(15,23,42,0.5)", borderRadius: "8px 8px 0 0",
      }}>
        <span style={{ width: 8, height: 22, background: accent, borderRadius: 2 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{title}</span>
        {subtitle && <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function tileStyle(count, need, ideal) {
  if (count < need) return { bg: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "#dc2626" };
  if (ideal != null && count < ideal) return { bg: "rgba(250,204,21,0.12)", color: "#fde047", border: "#ca8a04" };
  return { bg: "rgba(34,197,94,0.12)", color: "#4ade80", border: "#22c55e" };
}

export function CoverageStrip({ coverage, coveragePotential, onHover, hoveredPos, requirements, ideals }) {
  const order = requirements ? Object.keys(requirements) : ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF"];
  const defaultNeed = () => 2;
  const defaultIdeal = (pos) => pos === "C" ? null : 3;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 12px", background: "rgba(15,23,42,0.4)", borderBottom: "1px solid #1e293b" }}>
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
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 8px", borderRadius: 4,
              background: s.bg, border: `1px solid ${isHovered ? "#facc15" : s.border}`, color: s.color,
              fontSize: 11, fontWeight: 700, cursor: "default",
              transform: isHovered ? "scale(1.05)" : undefined,
              transition: "transform 0.1s, border-color 0.1s",
            }}>
            <span style={{ color: posColor(pos) }}>{pos}</span>
            <span>{count}</span>
            {potentialCount > 0 && (
              <span style={{ color: "#a78bfa", fontSize: 9, fontWeight: 600 }}>+{potentialCount}</span>
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
        padding: "4px 10px", background: "rgba(15,23,42,0.5)",
        borderBottom: "1px solid #1e293b", borderTop: "1px solid #1e293b",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: shortage ? "#fca5a5" : "#cbd5e1", letterSpacing: 0.3 }}>
          {title}
        </span>
        <span style={{ fontSize: 10, color: shortage ? "#fca5a5" : "#64748b", fontWeight: 600 }}>
          {players.length}{target ? `/${target}` : ""}{need != null ? ` (min ${need})` : ""}
        </span>
      </div>
      {players.length === 0 && (
        <div style={{ padding: "6px 10px", color: "#475569", fontSize: 11, fontStyle: "italic" }}>
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
