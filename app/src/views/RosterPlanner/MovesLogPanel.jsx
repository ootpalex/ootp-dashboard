import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TOKENS as T, S, posColor } from "../../theme.js";
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

// Action colour map (inventory §A.2): protect warn · dfa/trade/nonTender bad ·
// promote good · demote text2 · sign/accept_option/tender goodSoft ·
// sign_milb/milfa series5 · decline_option badSoft · IL warn.
const ACTION_COLORS = {
  protect: T.warn, dfa: T.bad, trade: T.bad,
  promote: T.good, demote: T.text2, sign: T.goodSoft, sign_milb: T.CHART.series5,
  decline_option: T.badSoft, accept_option: T.goodSoft, milfa: T.CHART.series5,
  nonTender: T.bad, tender: T.goodSoft, ilShort: T.warn, ilLong: T.warn,
};

export { MOVE_LABELS };

function SortableMoveRow({ uid, move, player, label, deleteMove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uid });
  const meta = player?.meta || {};
  const color = ACTION_COLORS[move.action] || T.text2;
  const style = {
    display: "flex", alignItems: "center", gap: 10, padding: "3px 8px", minHeight: 31,
    background: isDragging ? T.accentBg : T.panel,
    border: `1px solid ${isDragging ? T.accent : T.line}`,
    borderRadius: T.radius, marginBottom: 4,
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
        style={{ color: T.textDisabled, fontSize: 12, cursor: "grab", padding: "0 4px", userSelect: "none" }}
      >
        &#x2630;
      </span>
      <span style={{ color: posColor(meta.pos), fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 12.5, width: 28 }}>{meta.pos || "?"}</span>
      <span style={{ color: T.text, fontSize: 12.5, fontWeight: 600, flex: 1 }}>{meta.name || uid}</span>
      <span style={{ fontFamily: T.fonts.narrow, fontSize: 12.5, color, fontWeight: 700, minWidth: 120 }}>{label}</span>
      <button
        onClick={() => deleteMove(uid)}
        style={{ ...S.pillBtn, fontSize: 11, padding: "2px 8px", color: T.text2 }}
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
      <div style={{ fontFamily: T.fonts.narrow, fontSize: 12.5, fontWeight: 700, color: T.text2, marginBottom: 6 }}>
        {year} season
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
    <Section title="Moves Log" count={`(${totalMoves} total)`}>
      <div style={{ fontSize: 12, color: T.text3, marginBottom: 8 }}>
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
