import { useState, useMemo } from "react";
import { TOKENS as T, S } from "../theme.js";
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

  // Sunken wells; focus → focus border + ring (the one allowed shadow).
  const inputStyle = { ...S.searchInput, width: "100%", boxSizing: "border-box" };
  const onWellFocus = (e) => { e.currentTarget.style.borderColor = T.focus; e.currentTarget.style.boxShadow = `0 0 0 2px ${T.focusRing}`; };
  const onWellBlur = (e) => { e.currentTarget.style.borderColor = T.line2; e.currentTarget.style.boxShadow = "none"; };
  const labelStyle = { fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 4, display: "block" };
  const helpStyle = { fontSize: 11, color: T.text3, marginTop: 4, lineHeight: 1.4 };
  const sectionGap = { marginBottom: 16 };
  const iconBtn = { background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1, fontFamily: "inherit" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: T.scrim }} />
      <div style={{ position: "relative", ...S.box, width: 520, maxHeight: "85vh", display: "flex", flexDirection: "column", fontFamily: "inherit", color: T.text }} onClick={(e) => e.stopPropagation()}>
        <div style={S.boxHead}>
          <span>League Settings</span>
          <button onClick={onClose} style={{ ...iconBtn, color: T.text3, fontSize: 15, padding: "2px 4px" }}>✕</button>
        </div>

        <div style={{ padding: "14px 16px 4px", overflowY: "auto" }}>
          <div style={sectionGap}>
            <label style={labelStyle}>League name</label>
            <input value={draft.leagueName} onChange={(e) => set("leagueName", e.target.value)} onFocus={onWellFocus} onBlur={onWellBlur} style={inputStyle} placeholder="e.g. SSB" />
          </div>

          <div style={sectionGap}>
            <label style={labelStyle}>StatsPlus URL</label>
            <input value={draft.statsplusUrl} onChange={(e) => set("statsplusUrl", e.target.value)} onFocus={onWellFocus} onBlur={onWellBlur} style={inputStyle} placeholder="https://atl-01.statsplus.net/ssb/" />
            <div style={helpStyle}>Base URL for your league's StatsPlus site (e.g. https://atl-01.statsplus.net/ssb/)</div>
          </div>

          <div style={sectionGap}>
            <label style={labelStyle}>International FA tag</label>
            <input value={draft.iafaTag} onChange={(e) => set("iafaTag", e.target.value)} onFocus={onWellFocus} onBlur={onWellBlur} style={inputStyle} placeholder="IAFA" />
            <div style={helpStyle}>Value in the Manual column that identifies international free agents</div>
          </div>

          <div style={sectionGap}>
            <label style={labelStyle}>Draft demands</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5, color: T.text }}>
                <input type="checkbox" checked={draft.draftDemands} onChange={(e) => set("draftDemands", e.target.checked)} style={{ accentColor: T.accent, margin: 0 }} />
                Enable draft demand tracking
              </label>
            </div>
            {draft.draftDemands && (
              <div style={{ marginTop: 8 }}>
                <label style={labelStyle}>Draft budget ($)</label>
                <input type="number" value={draft.draftBudget} onChange={(e) => set("draftBudget", Math.max(0, parseInt(e.target.value) || 0))} onFocus={onWellFocus} onBlur={onWellBlur} style={{ ...inputStyle, width: 180, textAlign: "right", fontVariantNumeric: "tabular-nums" }} placeholder="0" />
              </div>
            )}
          </div>

          <div style={sectionGap}>
            <label style={labelStyle}>Excluded teams</label>
            <div style={{ ...helpStyle, marginTop: 0, marginBottom: 8 }}>Teams with player counts below 25% of league average are auto-detected. You can override or manually add exclusions.</div>
            {effectiveExcluded.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {effectiveExcluded.map((team) => {
                  const auto = isAutoExcluded(team);
                  const forced = isForceIncluded(team);
                  return (
                    <span key={team} style={{
                      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 4px 2px 7px",
                      borderRadius: T.radius, fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 700, lineHeight: "16px",
                      background: forced ? T.goodBg : T.badBg,
                      border: `1px solid ${forced ? T.good : T.bad}`,
                      color: forced ? T.good : T.badSoft,
                    }}>
                      {team}
                      {auto && <span style={{ fontSize: 10, fontWeight: 500, color: T.text3 }}>(auto)</span>}
                      {auto ? (
                        <button onClick={() => toggleAutoInclude(team)} title={forced ? "Re-exclude" : "Force include"} style={{ ...iconBtn, color: forced ? T.good : T.bad }}>{forced ? "↩" : "✓"}</button>
                      ) : (
                        <button onClick={() => removeManualExclusion(team)} title="Remove exclusion" style={{ ...iconBtn, color: T.bad }}>✕</button>
                      )}
                    </span>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: T.text3, marginBottom: 8 }}>No teams excluded</div>
            )}
            {availableForExclusion.length > 0 && (
              <select onChange={(e) => { if (e.target.value) { addManualExclusion(e.target.value); e.target.value = ""; } }} style={{ ...S.filterSelect, width: "100%" }} defaultValue="">
                <option value="" disabled>+ Add manual exclusion...</option>
                {availableForExclusion.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "10px 16px", borderTop: `1px solid ${T.line2}`, background: T.panel2 }}>
          <button onClick={onClose} style={S.btn}>Cancel</button>
          <button onClick={() => { saveLeagueSettings(draft); onSave(draft); }} style={{ ...S.btn, ...S.btnPrimary }}>Save</button>
        </div>
      </div>
    </div>
  );
}
