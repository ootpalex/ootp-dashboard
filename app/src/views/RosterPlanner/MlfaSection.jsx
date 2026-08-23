// MiLB Free Agents accordion — prospects losing MiLB rights in the planning year.
import { TOKENS as T, S } from "../../theme.js";
import { CompactRowHeader, CompactPlayerRow } from "./CompactPlayerRow.jsx";
import { POTENTIAL_CHIP_BG, actionBtn } from "./_shared.js";

export function MlfaSection({
  mlfaPlayers, activePlanYear, showMlfa, setShowMlfa, moves, applyMove, onSelectPlayer,
}) {
  if (mlfaPlayers.length === 0) return null;
  const violet = T.CHART.series5; // MiLB-FA family (D.5)
  return (
    <div style={S.box}>
      <div style={{ ...S.boxHead, paddingLeft: 14, boxShadow: `inset 3px 0 0 ${violet}` }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>MiLB Free Agents ({activePlanYear})</span>
          <span style={{ fontWeight: 500, color: T.text3 }}>{mlfaPlayers.length} player{mlfaPlayers.length !== 1 ? "s" : ""}</span>
        </span>
        <button
          onClick={() => setShowMlfa(!showMlfa)}
          style={actionBtn(violet)}
        >
          {showMlfa ? "Hide" : "Show"}
        </button>
      </div>
      {showMlfa && (
        <div>
          <CompactRowHeader />
          {mlfaPlayers.map(p => {
            const tag = { label: "MiLB FA", bg: POTENTIAL_CHIP_BG, color: violet };
            const alreadySigned = moves[p._uid]?.action === "sign_milb";
            const resignAction = alreadySigned
              ? <span style={{ color: T.good, fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 11 }}>Re-signed</span>
              : <button
                  onClick={(e) => { e.stopPropagation(); applyMove(p._uid, "sign_milb"); }}
                  style={actionBtn("good", { fontSize: 11, padding: "1px 8px" })}
                >Re-sign</button>;
            return <CompactPlayerRow key={p._uid} player={p} onSelect={onSelectPlayer} tags={[tag]} actions={resignAction} />;
          })}
        </div>
      )}
    </div>
  );
}
