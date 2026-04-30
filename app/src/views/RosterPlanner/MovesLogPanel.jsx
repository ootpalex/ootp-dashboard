import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { S, posColor } from "../../theme.js";
import { Section } from "../../components/shared.jsx";

const MOVE_LABELS = {
  protect: "Add to 40-Man (R5)", dfa: "DFA / Release", trade: "Trade Away",
  promote: "Promote to Active", demote: "Demote to Inactive",
  sign: "Re-sign (MLB)", sign_milb: "Re-sign (MiLB)",
  decline_option: "Decline Option", accept_option: "Accept Option",
  nonTender: "Non-Tender",
  tender: "Sign (Arb)",
  ilShort: "Place on 15-day IL", ilLong: "Place on 60-day IL",
};

const ACTION_COLORS = {
  protect: "#fb923c", dfa: "#ef4444", trade: "#ef4444",
  promote: "#22c55e", demote: "#94a3b8", sign: "#4ade80", sign_milb: "#c084fc",
  decline_option: "#fca5a5", accept_option: "#4ade80", milfa: "#c084fc",
  nonTender: "#ef4444", tender: "#4ade80", ilShort: "#fbbf24", ilLong: "#f97316",
};

export { MOVE_LABELS };

function SortableMoveRow({ uid, move, player, label, deleteMove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uid });
  const meta = player?.meta || {};
  const color = ACTION_COLORS[move.action] || "#94a3b8";
  const style = {
    display: "flex", alignItems: "center", gap: 10, padding: "5px 8px",
    background: isDragging ? "rgba(56,189,248,0.12)" : "rgba(15,23,42,0.3)",
    border: `1px solid ${isDragging ? "#38bdf8" : "#1e293b"}`,
    borderRadius: 6, marginBottom: 4,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <span
        {...attributes}
        {...listeners}
        title="Drag to reorder priority"
        style={{ color: "#475569", fontSize: 12, cursor: "grab", padding: "0 4px", userSelect: "none" }}
      >
        &#x2630;
      </span>
      <span style={{ color: posColor(meta.pos), fontWeight: 700, fontSize: 11, width: 28 }}>{meta.pos || "?"}</span>
      <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, flex: 1 }}>{meta.name || uid}</span>
      <span style={{ fontSize: 11, color, fontWeight: 600, minWidth: 120 }}>{label}</span>
      <button
        onClick={() => deleteMove(uid)}
        style={{
          ...S.pillBtn, fontSize: 10, padding: "2px 8px",
          borderColor: "#475569", color: "#94a3b8",
        }}
        title="Remove this move"
      >
        ✕ Undo
      </button>
    </div>
  );
}

function YearGroup({ year, items, deleteMove, reorderMoves }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const ids = items.map(i => i.uid);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        {year} Season
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          reorderMoves(year, active.id, over.id);
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {items.map(item => (
            <SortableMoveRow key={item.uid} {...item} deleteMove={deleteMove} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

export function MovesLogPanel({ movesLog, totalMoves, deleteMove, reorderMoves }) {
  if (movesLog.length === 0) return null;
  return (
    <Section title={`Moves Log (${totalMoves} total)`}>
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>
        Drag the ☰ handle to reorder by priority (highest at top).
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {movesLog.map(({ year, items }) => (
          <YearGroup
            key={year}
            year={year}
            items={items}
            deleteMove={deleteMove}
            reorderMoves={reorderMoves}
          />
        ))}
      </div>
    </Section>
  );
}
