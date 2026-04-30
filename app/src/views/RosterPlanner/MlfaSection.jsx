// MiLB Free Agents accordion — prospects losing MiLB rights in the planning year.
import { S } from "../../theme.js";
import { CompactRowHeader, CompactPlayerRow } from "./CompactPlayerRow.jsx";

export function MlfaSection({
  mlfaPlayers, activePlanYear, showMlfa, setShowMlfa, moves, applyMove, onSelectPlayer,
}) {
  if (mlfaPlayers.length === 0) return null;
  return (
    <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b", borderRadius: 8, marginBottom: 12 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: "1px solid #1e293b",
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#c084fc" }}>
          MiLB Free Agents ({activePlanYear}) — {mlfaPlayers.length} player{mlfaPlayers.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={() => setShowMlfa(!showMlfa)}
          style={{ ...S.pillBtn, fontSize: 10, padding: "3px 10px", borderColor: "#7c3aed", color: "#c084fc" }}
        >
          {showMlfa ? "Hide" : "Show"}
        </button>
      </div>
      {showMlfa && (
        <div style={{ padding: 8 }}>
          <CompactRowHeader />
          {mlfaPlayers.map(p => {
            const tag = { label: "MiLB FA", bg: "rgba(124,58,237,0.15)", color: "#c084fc" };
            const alreadySigned = moves[p._uid]?.action === "sign_milb";
            const resignAction = alreadySigned
              ? <span style={{ color: "#4ade80", fontWeight: 700, fontSize: 9 }}>Re-signed</span>
              : <button
                  onClick={(e) => { e.stopPropagation(); applyMove(p._uid, "sign_milb"); }}
                  style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#4ade80", fontSize: 9, padding: "2px 8px" }}
                >Re-sign</button>;
            return <CompactPlayerRow key={p._uid} player={p} onSelect={onSelectPlayer} tags={[tag]} actions={resignAction} />;
          })}
        </div>
      )}
    </div>
  );
}
