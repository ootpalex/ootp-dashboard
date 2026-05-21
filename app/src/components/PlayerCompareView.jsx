import { useState, useMemo, useRef } from "react";
import { S } from "../theme.js";
import { posColor, levelColor, proneColor, warStyle, intangibleColor, devPctColor, gradeStyle } from "../theme.js";
import { fmt, fmtAge, fmtMLD, num, orgLabel, rankSuffix } from "../utils/helpers.js";
import { resolveKey, getMaxWarP, getSpWarP, getRpWarP, getRunsP, isEligible } from "../utils/accessors.js";
import { HITTER_POS } from "../utils/constants.js";
import { Section, PillBtn, TwoWayBadge } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

export default function PlayerCompareView({ data, curveSettings }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [selected, setSelected] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef(null);

  const allPlayers = useMemo(() => [...data.hitters, ...data.pitchers], [data]);

  const searchResults = useMemo(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) return [];
    const s = debouncedSearch.toLowerCase();
    const selectedUids = new Set(selected.map((p) => p._uid));
    return allPlayers
      .filter((p) => (p.meta?.name ?? p.Name)?.toLowerCase().includes(s) && !selectedUids.has(p._uid))
      .slice(0, 8);
  }, [debouncedSearch, allPlayers, selected]);

  const addPlayer = (player) => {
    if (selected.length >= 5) return;
    setSelected((prev) => [...prev, player]);
    setSearch("");
    setDropdownOpen(false);
  };
  const removePlayer = (uid) => setSelected((prev) => prev.filter((p) => p._uid !== uid));
  const clearAll = () => setSelected([]);

  const COMPARE_STATS = useMemo(() => [
    { group: "Profile", stats: [
      { key: "_bestPos", label: "Best Pos", fmt: (p) => p._bestPos || "—", color: (p) => posColor((p._bestPos || "").replace("*", "")) },
      { key: "Lev", label: "Level", fmt: (p) => p.meta?.lev ?? p.Lev ?? "—", color: (p) => levelColor(p.meta?.lev ?? p.Lev) },
      { key: "bt", label: "B/T", fmt: (p) => `${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}` },
      { key: "Prone", label: "Prone", fmt: (p) => p.meta?.prone ?? p.Prone ?? "—", color: (p) => proneColor(p.meta?.prone ?? p.Prone) },
      { key: "OVR", label: "Overall", fmt: (p) => p.meta?.ovr ?? p.OVR ?? "—", numeric: true },
      { key: "POT", label: "Potential", fmt: (p) => p.meta?.pot ?? p.POT ?? "—", numeric: true },
    ]},
    { group: "Value (Hitters)", appliesTo: "hitter", stats: [
      { key: "_fv", label: "Future Value", numeric: true, war: true, fmt: (p) => fmt(p._fv) },
      { key: "Max WAR wtd", label: "WAR", numeric: true, war: true },
      { key: "MAX WAR P", label: "WAR Potential", numeric: true, war: true, fmt: (p) => p._matured ? "—" : fmt(getMaxWarP(p)), color: (p) => p._matured ? "#475569" : undefined },
      { key: "_devPct", label: "Dev%", fmt: (p) => !p._ageMatured && p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—", color: (p) => !p._ageMatured && p._devPct != null ? devPctColor(p._devPct) : "#475569" },
    ]},
    { group: "Value (Pitchers)", appliesTo: "pitcher", stats: [
      { key: "_fv", label: "Future Value", numeric: true, war: true, fmt: (p) => fmt(p._fv) },
      { key: "WAR wtd", label: "SP WAR", numeric: true, war: true, fmt: (p) => (p.starter || p.starterP) ? fmt(resolveKey(p, "WAR wtd")) : "—", color: (p) => (p.starter || p.starterP) ? undefined : "#475569" },
      { key: "WAR wtd RP", label: "RP WAR", numeric: true, war: true },
      { key: "WARP", label: "SP Potential", numeric: true, war: true, fmt: (p) => (!p.starter && !p.starterP) || p._matured ? "—" : fmt(getSpWarP(p)), color: (p) => (!p.starter && !p.starterP) || p._matured ? "#475569" : undefined },
      { key: "WARP RP", label: "RP Potential", numeric: true, war: true, fmt: (p) => p._matured ? "—" : fmt(getRpWarP(p)), color: (p) => p._matured ? "#475569" : undefined },
      { key: "_devPct", label: "Dev%", fmt: (p) => !p._ageMatured && p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—", color: (p) => !p._ageMatured && p._devPct != null ? devPctColor(p._devPct) : "#475569" },
      { key: "STM", label: "Stamina", numeric: true },
      { key: "VELO", label: "Velocity", numeric: true },
    ]},
    { group: "Defense (Hitters)", appliesTo: "hitter", stats:
      HITTER_POS.filter(pos => pos !== "DH").map(pos => ({
        key: `${pos} RunsP`,
        label: `${pos} RunsP`,
        numeric: true,
        precision: 1,
        fmt: (p) => {
          const eligible = isEligible(p, pos);
          const val = getRunsP(p, pos);
          return eligible && val != null ? val.toFixed(1) : "—";
        },
        color: (p) => isEligible(p, pos) ? undefined : "#334155",
      }))
    },
    { group: "Splits (Hitters)", appliesTo: "hitter", stats: [
      { key: "OBP vR", label: "OBP vs R", numeric: true, precision: 3 },
      { key: "OBP vL", label: "OBP vs L", numeric: true, precision: 3 },
      { key: "wOBA vR", label: "wOBA vs R", numeric: true, precision: 3 },
      { key: "wOBA vL", label: "wOBA vs L", numeric: true, precision: 3 },
    ]},
    { group: "Intangibles", stats: [
      { key: "_intangibles", label: "Intangibles", fmt: (p) => p._intangibles ?? "—", color: (p) => gradeStyle(p._intangibles).color },
      { key: "INT", label: "Intelligence", fmt: (p) => p.meta?.int ?? p.INT ?? "—", color: (p) => intangibleColor(p.meta?.int ?? p.INT) },
      { key: "WE", label: "Work Ethic", fmt: (p) => p.meta?.we ?? p.WE ?? "—", color: (p) => intangibleColor(p.meta?.we ?? p.WE) },
      { key: "LEA", label: "Leadership", fmt: (p) => p.meta?.lea ?? p.LEA ?? "—", color: (p) => intangibleColor(p.meta?.lea ?? p.LEA) },
      { key: "AD", label: "Adaptability", fmt: (p) => p.meta?.ad ?? p.AD ?? "—", color: (p) => intangibleColor(p.meta?.ad ?? p.AD) },
      { key: "LOY", label: "Loyalty", fmt: (p) => p.meta?.loy ?? p.LOY ?? "—", color: (p) => intangibleColor(p.meta?.loy ?? p.LOY) },
      { key: "FIN", label: "Greed", fmt: (p) => p.meta?.fin ?? p.FIN ?? "—", color: (p) => intangibleColor(p.meta?.fin ?? p.FIN) },
    ]},
    { group: "Contract", stats: [
      { key: "Price", label: "Salary", fmt: (p) => { const n = num(p.meta?.price ?? p.Price); return n != null ? "$" + n.toLocaleString() : "—"; } },
      { key: "MLD", label: "ML Service Time", fmt: (p) => fmtMLD(p.meta?.mld ?? p.MLD) },
      { key: "OY", label: "Option Years", fmt: (p) => (p.meta?.oy ?? p.OY) || "—" },
    ]},
  ], []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="Player Compare">
        <div style={{ position: "relative", maxWidth: 400 }}>
          <input
            ref={searchRef}
            type="text"
            placeholder={selected.length >= 5 ? "Max 5 players" : "Search player name..."}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            disabled={selected.length >= 5}
            style={{ ...S.searchInput, width: "100%" }}
          />
          {dropdownOpen && searchResults.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1e293b", border: "1px solid #334155", borderRadius: "0 0 6px 6px", zIndex: 100, maxHeight: 300, overflowY: "auto" }}>
              {searchResults.map((p) => (
                <div key={p._uid} onClick={() => addPlayer(p)} style={{ padding: "6px 10px", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #0f172a", fontSize: 12 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(96,165,250,0.1)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontWeight: 600, color: "#e2e8f0", flex: 1 }}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></span>
                  <span style={{ color: posColor(p.meta?.pos ?? p.POS), fontWeight: 600 }}>{p.meta?.pos ?? p.POS}</span>
                  <span style={{ color: "#64748b", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{orgLabel(p)}</span>
                  <span style={{ color: "#475569" }}>{fmtAge(p._age)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            {selected.map((p) => (
              <div key={p._uid} style={{ background: "rgba(59,130,246,0.1)", border: "1px solid #1e3a5f", borderRadius: 6, padding: "4px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: posColor(p.meta?.pos ?? p.POS), fontWeight: 600 }}>{p.meta?.pos ?? p.POS}</span>
                <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></span>
                <span style={{ color: "#475569" }}>{orgLabel(p)}</span>
                <button onClick={() => removePlayer(p._uid)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>✕</button>
              </div>
            ))}
            {selected.length >= 2 && (
              <button onClick={clearAll} style={{ ...S.pillBtn, borderColor: "#334155", color: "#64748b", fontSize: 10, padding: "3px 8px" }}>Clear All</button>
            )}
          </div>
        )}
      </Section>

      {selected.length > 0 && (
        <Section title="Comparison">
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={{ ...S.th, width: 120 }}>Stat</th>
                  {selected.map((p) => (
                    <th key={p._uid} style={{ ...S.th, minWidth: 120, textAlign: "center" }}>
                      <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></div>
                      <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 2 }}>
                        <span style={{ color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</span>
                        <span style={{ color: "#475569" }}>|</span>
                        <span style={{ color: "#64748b" }}>{orgLabel(p)}</span>
                        <span style={{ color: "#475569" }}>|</span>
                        <span style={{ color: "#94a3b8" }}>{fmtAge(p._age)}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_STATS.map((group) => {
                  if (group.appliesTo && !selected.some((p) => p._type === group.appliesTo)) return null;
                  return [
                    <tr key={`gh-${group.group}`}>
                      <td colSpan={selected.length + 1} style={{ ...S.td, background: "rgba(15,23,42,0.6)", color: "#64748b", fontWeight: 700, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", padding: "6px 8px" }}>
                        {group.group}
                      </td>
                    </tr>,
                    ...group.stats.map((stat) => {
                      let bestIdx = -1, worstIdx = -1;
                      if (stat.numeric && !stat.fmt) {
                        let bestVal = -Infinity, worstVal = Infinity, validCount = 0;
                        for (let i = 0; i < selected.length; i++) {
                          if (group.appliesTo && selected[i]._type !== group.appliesTo) continue;
                          const v = num(resolveKey(selected[i], stat.key));
                          if (v == null) continue;
                          validCount++;
                          if (v > bestVal) { bestVal = v; bestIdx = i; }
                          if (v < worstVal) { worstVal = v; worstIdx = i; }
                        }
                        if (validCount < 2) { bestIdx = -1; worstIdx = -1; }
                      }
                      return (
                        <tr key={stat.key}>
                          <td style={{ ...S.td, fontWeight: 600, color: "#94a3b8", fontSize: 11 }}>{stat.label}</td>
                          {selected.map((p, i) => {
                            if (group.appliesTo && p._type !== group.appliesTo) {
                              return <td key={p._uid} style={{ ...S.td, textAlign: "center", color: "#334155" }}>—</td>;
                            }
                            if (stat.fmt) {
                              const val = stat.fmt(p);
                              const color = stat.color ? stat.color(p) : "#94a3b8";
                              return <td key={p._uid} style={{ ...S.td, textAlign: "center", color }}>{val}</td>;
                            }
                            const v = num(resolveKey(p, stat.key));
                            const precision = stat.precision ?? 2;
                            let style = { ...S.td, textAlign: "center" };
                            if (stat.war) Object.assign(style, warStyle(v));
                            else if (i === bestIdx) style.color = "#4ade80";
                            else if (i === worstIdx) style.color = "#f87171";
                            else style.color = "#94a3b8";
                            if (i === bestIdx) style.fontWeight = 700;
                            return <td key={p._uid} style={style}>{v != null ? v.toFixed(precision) : "—"}</td>;
                          })}
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {selected.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#475569", fontSize: 13 }}>
          Search and select players above to compare them side-by-side.
        </div>
      )}
    </div>
  );
}
