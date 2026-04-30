// R5 protection shortlist droppable + below-threshold expander.
import { S } from "../../theme.js";
import { DroppablePanel } from "./Panels.jsx";
import { CompactRowHeader, CompactPlayerRow } from "./CompactPlayerRow.jsx";
import { BUCKET_CONFIG } from "./_shared.js";
import { R5_DEFAULT_THRESHOLD } from "../../utils/rosterPlanning/index.js";

export function Rule5RiskPanel({
  r5, r5Threshold, setR5Threshold, showOtherR5, setShowOtherR5, onSelectPlayer,
}) {
  return (
    <DroppablePanel
      bucketId="r5Protect"
      title={`Rule 5 Protection Shortlist (${r5.shortlist.length})`}
      subtitle={`FV ≥ ${r5Threshold.toFixed(1)} — drag into 40-Man to protect`}
      accent={BUCKET_CONFIG.r5Risk.color}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
        borderBottom: "1px solid #1e293b", background: "rgba(15,23,42,0.35)",
      }}>
        <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>FV threshold:</span>
        <input
          type="range" min={-3} max={3} step={0.1} value={r5Threshold}
          onChange={e => setR5Threshold(parseFloat(e.target.value))}
          style={{ flex: 1, maxWidth: 280 }}
        />
        <span style={{ fontSize: 12, color: "#fbbf24", fontWeight: 700, minWidth: 44, textAlign: "right" }}>
          {r5Threshold.toFixed(1)}
        </span>
        <button
          onClick={() => setR5Threshold(R5_DEFAULT_THRESHOLD)}
          style={{ ...S.pillBtn, fontSize: 10, padding: "3px 8px" }}
        >
          Reset
        </button>
      </div>
      <div style={{ padding: 8 }}>
        {r5.shortlist.length === 0 ? (
          <div style={{ padding: "8px 10px", color: "#475569", fontSize: 11, fontStyle: "italic" }}>
            No R5-exposed players meet the threshold.
          </div>
        ) : (
          <>
            <CompactRowHeader />
            {r5.shortlist.map(p => {
              const countdown = p._r5?.r5Countdown;
              const tag = {
                label: countdown === 0 ? "R5 NOW" : `R5 in ${countdown}y`,
                bg: countdown === 0 ? "rgba(239,68,68,0.15)" : "rgba(249,115,22,0.15)",
                color: countdown === 0 ? "#fca5a5" : "#fdba74",
              };
              return (
                <CompactPlayerRow key={p._uid} player={p} onSelect={onSelectPlayer} tags={[tag]} />
              );
            })}
          </>
        )}
        {r5.others.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => setShowOtherR5(!showOtherR5)}
              style={{
                ...S.pillBtn, fontSize: 10, padding: "3px 10px",
                borderColor: "#334155", color: "#64748b",
              }}
            >
              {showOtherR5 ? "Hide" : "Show"} other R5-eligible below threshold ({r5.others.length})
            </button>
            {showOtherR5 && (
              <div style={{ marginTop: 4 }}>
                <CompactRowHeader />
                {r5.others.map(p => {
                  const countdown = p._r5?.r5Countdown;
                  const tag = {
                    label: countdown === 0 ? "R5 NOW" : `R5 in ${countdown}y`,
                    bg: "rgba(100,116,139,0.15)", color: "#94a3b8",
                  };
                  return <CompactPlayerRow key={p._uid} player={p} onSelect={onSelectPlayer} tags={[tag]} />;
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </DroppablePanel>
  );
}
