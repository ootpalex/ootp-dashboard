import { S, posColor } from "../../theme.js";
import { Section, PillBtn } from "../../components/shared.jsx";

const TYPE_TITLES = {
  protect: "Must Protect (R5)",
  considerProtect: "Consider Protecting (R5)",
  milfa: "MiLB FA Risk",
  dfa: "DFA Candidates",
  promote: "Promote to Active",
};
const TYPE_COLORS = {
  protect: "#f97316",
  considerProtect: "#fbbf24",
  milfa: "#c084fc",
  dfa: "#ef4444",
  promote: "#22c55e",
};
const GROUP_ORDER = ["protect", "considerProtect", "milfa", "dfa", "promote"];

export function SuggestionsPanel({ suggestions, showSuggestions, setShowSuggestions, moves, applyMove }) {
  return (
    <Section title="Smart Suggestions" actions={
      <PillBtn active={showSuggestions} onClick={() => setShowSuggestions(!showSuggestions)}>
        {showSuggestions ? "Hide" : "Show"}
      </PillBtn>
    }>
      {showSuggestions && suggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {GROUP_ORDER.map(type => {
            const group = suggestions.filter(s => s.type === type);
            if (group.length === 0) return null;
            return (
              <div key={type}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TYPE_COLORS[type], marginBottom: 6 }}>
                  {TYPE_TITLES[type]}
                </div>
                {group.map(s => {
                  const meta = s.player.meta || {};
                  const alreadyApplied = moves[s.playerId]?.action === s.action;
                  return (
                    <div key={s.playerId} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 10px",
                      background: alreadyApplied ? "rgba(34,197,94,0.08)" : "rgba(15,23,42,0.3)",
                      border: "1px solid #1e293b", borderRadius: 6, marginBottom: 4,
                    }}>
                      <span style={{ color: posColor(meta.pos), fontWeight: 700, fontSize: 11 }}>{meta.pos}</span>
                      <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, flex: 1 }}>{meta.name}</span>
                      <span style={{ color: "#64748b", fontSize: 11, flex: 2 }}>{s.reason}</span>
                      {!alreadyApplied && (
                        <button
                          onClick={() => applyMove(s.playerId, s.action)}
                          style={{ ...S.pillBtn, borderColor: TYPE_COLORS[type], color: TYPE_COLORS[type], fontSize: 10, padding: "3px 10px" }}
                        >
                          Apply
                        </button>
                      )}
                      {alreadyApplied && (
                        <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 600 }}>Applied</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {showSuggestions && suggestions.length === 0 && (
        <div style={{ color: "#475569", fontSize: 12, fontStyle: "italic" }}>
          No suggestions — roster looks clean!
        </div>
      )}
      {!showSuggestions && (
        <div style={{ color: "#475569", fontSize: 12 }}>
          Click "Show" for AI-powered roster management suggestions
        </div>
      )}
    </Section>
  );
}
