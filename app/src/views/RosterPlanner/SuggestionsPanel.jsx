import { TOKENS as T, posColor } from "../../theme.js";
import { Section, PillBtn } from "../../components/shared.jsx";
import { actionBtn } from "./_shared.js";

const TYPE_TITLES = {
  protect: "Must Protect (R5)",
  considerProtect: "Consider Protecting (R5)",
  milfa: "MiLB FA Risk",
  dfa: "DFA Candidates",
  promote: "Promote to Active",
};
const TYPE_COLORS = {
  protect: T.warn,
  considerProtect: T.warn,
  milfa: T.CHART.series5,
  dfa: T.bad,
  promote: T.good,
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
                <div style={{ fontFamily: T.fonts.narrow, fontSize: 12.5, fontWeight: 700, color: TYPE_COLORS[type], marginBottom: 6 }}>
                  {TYPE_TITLES[type]}
                </div>
                {group.map(s => {
                  const meta = s.player.meta || {};
                  const alreadyApplied = moves[s.playerId]?.action === s.action;
                  return (
                    <div key={s.playerId} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "4px 10px", minHeight: 31,
                      background: alreadyApplied ? T.goodBg : T.panel,
                      border: `1px solid ${alreadyApplied ? T.good : T.line}`, borderRadius: T.radius, marginBottom: 4,
                    }}>
                      <span style={{ color: posColor(meta.pos), fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 12.5 }}>{meta.pos}</span>
                      <span style={{ color: T.text, fontSize: 12.5, fontWeight: 600, flex: 1 }}>{meta.name}</span>
                      <span style={{ color: T.text3, fontSize: 12, flex: 2 }}>{s.reason}</span>
                      {!alreadyApplied && (
                        <button
                          onClick={() => applyMove(s.playerId, s.action)}
                          style={actionBtn(TYPE_COLORS[type])}
                        >
                          Apply
                        </button>
                      )}
                      {alreadyApplied && (
                        <span style={{ fontFamily: T.fonts.narrow, fontSize: 12, color: T.good, fontWeight: 700 }}>Applied</span>
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
        <div style={{ color: T.text3, fontSize: 12.5, fontStyle: "italic" }}>
          No suggestions — roster looks clean!
        </div>
      )}
      {!showSuggestions && (
        <div style={{ color: T.text3, fontSize: 12.5 }}>
          Click "Show" for AI-powered roster management suggestions
        </div>
      )}
    </Section>
  );
}
