import { useState, useMemo } from "react";
import { S } from "../theme.js";
import { saveLeagueSettings } from "../utils/settings.js";

export default function LeagueSettingsModal({ settings, onSave, onClose, autoExcluded, allTeams }) {
  const [draft, setDraft] = useState({ ...settings });
  const set = (key, val) => setDraft((d) => ({ ...d, [key]: val }));

  const effectiveExcluded = useMemo(() => {
    const auto = new Set(autoExcluded || []);
    const manual = new Set(draft.manualExclusions || []);
    const included = new Set(draft.manualInclusions || []);
    const combined = new Set([...auto, ...manual]);
    included.forEach((t) => combined.delete(t));
    return [...combined].sort();
  }, [autoExcluded, draft.manualExclusions, draft.manualInclusions]);

  const availableForExclusion = useMemo(() => {
    const excluded = new Set(effectiveExcluded);
    return (allTeams || []).filter((t) => !excluded.has(t)).sort();
  }, [allTeams, effectiveExcluded]);

  const toggleAutoInclude = (team) => {
    setDraft((d) => {
      const incl = new Set(d.manualInclusions || []);
      if (incl.has(team)) { incl.delete(team); } else { incl.add(team); }
      return { ...d, manualInclusions: [...incl] };
    });
  };

  const addManualExclusion = (team) => {
    setDraft((d) => ({
      ...d,
      manualExclusions: [...new Set([...(d.manualExclusions || []), team])],
    }));
  };

  const removeManualExclusion = (team) => {
    setDraft((d) => ({
      ...d,
      manualExclusions: (d.manualExclusions || []).filter((t) => t !== team),
    }));
  };

  const isAutoExcluded = (team) => (autoExcluded || []).includes(team);
  const isForceIncluded = (team) => (draft.manualInclusions || []).includes(team);

  const inputStyle = { ...S.searchInput, width: "100%" };
  const labelStyle = { fontSize: 11, color: "#64748b", letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 4, display: "block" };
  const sectionGap = { marginBottom: 18 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 28, width: 520, maxHeight: "85vh", overflowY: "auto", fontFamily: "'JetBrains Mono', monospace", color: "#cbd5e1" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0" }}>League Settings</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
        </div>

        <div style={sectionGap}>
          <label style={labelStyle}>League Name</label>
          <input value={draft.leagueName} onChange={(e) => set("leagueName", e.target.value)} style={inputStyle} placeholder="e.g. SSB" />
        </div>

        <div style={sectionGap}>
          <label style={labelStyle}>StatsPlus URL</label>
          <input value={draft.statsplusUrl} onChange={(e) => set("statsplusUrl", e.target.value)} style={inputStyle} placeholder="https://atl-01.statsplus.net/ssb/" />
          <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>Base URL for your league's StatsPlus site (e.g. https://atl-01.statsplus.net/ssb/)</div>
        </div>

        <div style={sectionGap}>
          <label style={labelStyle}>International FA Tag</label>
          <input value={draft.iafaTag} onChange={(e) => set("iafaTag", e.target.value)} style={inputStyle} placeholder="IAFA" />
          <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>Value in the Manual column that identifies international free agents</div>
        </div>

        <div style={sectionGap}>
          <label style={labelStyle}>Draft Demands</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}>
              <input type="checkbox" checked={draft.draftDemands} onChange={(e) => set("draftDemands", e.target.checked)} />
              Enable draft demand tracking
            </label>
          </div>
          {draft.draftDemands && (
            <div style={{ marginTop: 8 }}>
              <label style={{ ...labelStyle, fontSize: 10 }}>Draft Budget ($)</label>
              <input type="number" value={draft.draftBudget} onChange={(e) => set("draftBudget", Math.max(0, parseInt(e.target.value) || 0))} style={{ ...inputStyle, width: 180 }} placeholder="0" />
            </div>
          )}
        </div>

        <div style={sectionGap}>
          <label style={labelStyle}>Excluded Teams</label>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 8 }}>Teams with player counts below 25% of league average are auto-detected. You can override or manually add exclusions.</div>
          {effectiveExcluded.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {effectiveExcluded.map((team) => {
                const auto = isAutoExcluded(team);
                const forced = isForceIncluded(team);
                return (
                  <span key={team} style={{
                    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px",
                    borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: forced ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                    border: `1px solid ${forced ? "#22c55e" : "#dc2626"}`,
                    color: forced ? "#86efac" : "#fca5a5",
                  }}>
                    {team}
                    {auto && <span style={{ fontSize: 9, color: "#64748b" }}>(auto)</span>}
                    {auto ? (
                      <button onClick={() => toggleAutoInclude(team)} title={forced ? "Re-exclude" : "Force include"} style={{ background: "none", border: "none", color: forced ? "#22c55e" : "#dc2626", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>{forced ? "↩" : "✓"}</button>
                    ) : (
                      <button onClick={() => removeManualExclusion(team)} title="Remove exclusion" style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>✕</button>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>No teams excluded</div>
          )}
          {availableForExclusion.length > 0 && (
            <select onChange={(e) => { if (e.target.value) { addManualExclusion(e.target.value); e.target.value = ""; } }} style={{ ...S.filterSelect, width: "100%" }} defaultValue="">
              <option value="" disabled>+ Add manual exclusion...</option>
              {availableForExclusion.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
          <button onClick={onClose} style={{ ...S.pillBtn, borderColor: "#334155", color: "#94a3b8" }}>Cancel</button>
          <button onClick={() => { saveLeagueSettings(draft); onSave(draft); }} style={{ ...S.pillBtn, borderColor: "#3b82f6", color: "#93c5fd", background: "rgba(59,130,246,0.15)" }}>Save</button>
        </div>
      </div>
    </div>
  );
}
