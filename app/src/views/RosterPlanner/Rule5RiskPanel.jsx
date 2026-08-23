// R5 protection shortlist droppable + below-threshold expander.
import { TOKENS as T, S } from "../../theme.js";
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
      <div style={{ ...S.toolbar, gap: 10 }}>
        <span style={{ fontFamily: T.fonts.narrow, fontSize: 12.5, color: T.text2, fontWeight: 600 }}>FV threshold:</span>
        <input
          type="range" min={-3} max={3} step={0.1} value={r5Threshold}
          onChange={e => setR5Threshold(parseFloat(e.target.value))}
          style={{ flex: 1, maxWidth: 280, accentColor: T.accent }}
        />
        <span style={{ fontSize: 12.5, color: T.warn, fontWeight: 700, minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {r5Threshold.toFixed(1)}
        </span>
        <button
          onClick={() => setR5Threshold(R5_DEFAULT_THRESHOLD)}
          style={{ ...S.pillBtn, fontSize: 11, padding: "2px 8px" }}
        >
          Reset
        </button>
      </div>
      <div>
        {r5.shortlist.length === 0 ? (
          <div style={{ padding: "8px 12px", color: T.text3, fontSize: 12, fontStyle: "italic" }}>
            No R5-exposed players meet the threshold.
          </div>
        ) : (
          <>
            <CompactRowHeader />
            {r5.shortlist.map(p => {
              const countdown = p._r5?.r5Countdown;
              // R5 countdown 0 → bad, >0 → warn (D.5).
              const tag = {
                label: countdown === 0 ? "R5 NOW" : `R5 in ${countdown}y`,
                bg: countdown === 0 ? T.badBg : T.warnBg,
                color: countdown === 0 ? T.bad : T.warn,
              };
              return (
                <CompactPlayerRow key={p._uid} player={p} onSelect={onSelectPlayer} tags={[tag]} />
              );
            })}
          </>
        )}
        {r5.others.length > 0 && (
          <div style={{ padding: "8px 12px 10px" }}>
            <button
              onClick={() => setShowOtherR5(!showOtherR5)}
              style={{ ...S.pillBtn, fontSize: 11, padding: "2px 9px", color: T.text2 }}
            >
              {showOtherR5 ? "Hide" : "Show"} other R5-eligible below threshold ({r5.others.length})
            </button>
            {showOtherR5 && (
              <div style={{ marginTop: 8, border: `1px solid ${T.line2}`, borderRadius: T.radius, overflow: "hidden" }}>
                <CompactRowHeader />
                {r5.others.map(p => {
                  const countdown = p._r5?.r5Countdown;
                  const tag = {
                    label: countdown === 0 ? "R5 NOW" : `R5 in ${countdown}y`,
                    bg: T.panel3, color: T.text2,
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
