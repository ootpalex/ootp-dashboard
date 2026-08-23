import { useState, useMemo, useRef } from "react";
import { S, TOKENS as T } from "../theme.js";
import { posColor, levelChip, proneColor, warStyle, intangibleColor, devPctColor, gradeStyle } from "../theme.js";
import { fmt, fmtAge, fmtMLD, num, orgLabel, rankSuffix } from "../utils/helpers.js";
import { resolveKey, getMaxWarP, getSpWarP, getRpWarP, getRunsP, isEligible } from "../utils/accessors.js";
import { HITTER_POS } from "../utils/constants.js";
import { Section, SearchInput, TwoWayBadge, colRule } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

// levelChip() returns { bg, text, border[, borderStyle] } — map it onto the S.badge CSS keys.
const chipCss = (c) => ({ background: c.bg, color: c.text, borderColor: c.border, ...(c.borderStyle ? { borderStyle: c.borderStyle } : {}) });
export default function PlayerCompareView({ data, curveSettings }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [selected, setSelected] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef(null); // kept (unused): SearchInput does not forward refs

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
      { key: "_bestPos", label: "Best Pos", fmt: (p) => p._bestPos || "—", color: (p) => posColor((p._bestPos || "").replace("*", "")), pos: true },
      { key: "Lev", label: "Level", fmt: (p) => p.meta?.lev ?? p.Lev ?? "—", chip: (p) => levelChip(p.meta?.lev ?? p.Lev) },
      { key: "bt", label: "B/T", fmt: (p) => `${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}` },
      { key: "Prone", label: "Prone", fmt: (p) => p.meta?.prone ?? p.Prone ?? "—", color: (p) => proneColor(p.meta?.prone ?? p.Prone) },
      { key: "OVR", label: "Overall", fmt: (p) => p.meta?.ovr ?? p.OVR ?? "—", numeric: true },
      { key: "POT", label: "Potential", fmt: (p) => p.meta?.pot ?? p.POT ?? "—", numeric: true },
    ]},
    { group: "Value (Hitters)", appliesTo: "hitter", stats: [
      { key: "_fv", label: "Future Value", numeric: true, war: true, fmt: (p) => fmt(p._fv) },
      { key: "Max WAR wtd", label: "WAR", numeric: true, war: true },
      { key: "MAX WAR P", label: "WAR Potential", numeric: true, war: true, fmt: (p) => p._matured ? "—" : fmt(getMaxWarP(p)), color: (p) => p._matured ? T.textDisabled : undefined },
      { key: "_devPct", label: "Dev%", fmt: (p) => !p._ageMatured && p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—", color: (p) => !p._ageMatured && p._devPct != null ? devPctColor(p._devPct) : T.textDisabled },
    ]},
    { group: "Value (Pitchers)", appliesTo: "pitcher", stats: [
      { key: "_fv", label: "Future Value", numeric: true, war: true, fmt: (p) => fmt(p._fv) },
      { key: "WAR wtd", label: "SP WAR", numeric: true, war: true, fmt: (p) => (p.starter || p.starterP) ? fmt(resolveKey(p, "WAR wtd")) : "—", color: (p) => (p.starter || p.starterP) ? undefined : T.textDisabled },
      { key: "WAR wtd RP", label: "RP WAR", numeric: true, war: true },
      { key: "WARP", label: "SP Potential", numeric: true, war: true, fmt: (p) => (!p.starter && !p.starterP) || p._matured ? "—" : fmt(getSpWarP(p)), color: (p) => (!p.starter && !p.starterP) || p._matured ? T.textDisabled : undefined },
      { key: "WARP RP", label: "RP Potential", numeric: true, war: true, fmt: (p) => p._matured ? "—" : fmt(getRpWarP(p)), color: (p) => p._matured ? T.textDisabled : undefined },
      { key: "_devPct", label: "Dev%", fmt: (p) => !p._ageMatured && p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—", color: (p) => !p._ageMatured && p._devPct != null ? devPctColor(p._devPct) : T.textDisabled },
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
        color: (p) => isEligible(p, pos) ? undefined : T.textDisabled,
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
      { key: "INT", label: "Intelligence", fmt: (p) => p.meta?.int ?? p.INT ?? "—", color: (p) => intangibleColor(p.meta?.int ?? p.INT), weight: 600 },
      { key: "WE", label: "Work Ethic", fmt: (p) => p.meta?.we ?? p.WE ?? "—", color: (p) => intangibleColor(p.meta?.we ?? p.WE), weight: 600 },
      { key: "LEA", label: "Leadership", fmt: (p) => p.meta?.lea ?? p.LEA ?? "—", color: (p) => intangibleColor(p.meta?.lea ?? p.LEA), weight: 600 },
      { key: "AD", label: "Adaptability", fmt: (p) => p.meta?.ad ?? p.AD ?? "—", color: (p) => intangibleColor(p.meta?.ad ?? p.AD), weight: 600 },
      { key: "LOY", label: "Loyalty", fmt: (p) => p.meta?.loy ?? p.LOY ?? "—", color: (p) => intangibleColor(p.meta?.loy ?? p.LOY), weight: 600 },
      { key: "FIN", label: "Greed", fmt: (p) => p.meta?.fin ?? p.FIN ?? "—", color: (p) => intangibleColor(p.meta?.fin ?? p.FIN), weight: 600 },
    ]},
    { group: "Contract", stats: [
      { key: "Price", label: "Salary", fmt: (p) => { const n = num(p.meta?.price ?? p.Price); return n != null ? "$" + n.toLocaleString() : "—"; } },
      { key: "MLD", label: "ML Service Time", fmt: (p) => fmtMLD(p.meta?.mld ?? p.MLD) },
      { key: "OY", label: "Option Years", fmt: (p) => (p.meta?.oy ?? p.OY) || "—" },
    ]},
  ], []);

  // Column-group rule (§B.3 item 9): one rule between the stat-label column and the first player.
  const cmpCols = useMemo(() => [{ key: "label", group: "label" }, ...selected.map((p) => ({ key: p._uid, group: "players" }))], [selected]);
  const cellRule = (ci) => colRule(cmpCols, ci) || {};
  const posText = { fontFamily: T.fonts.narrow, fontWeight: 600 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Player Compare" count={`(${selected.length}/5)`} state={selected.length === 0 ? "Search and add up to 5 players" : undefined}
        actions={selected.length >= 2 ? <button onClick={clearAll} style={S.btn}>Clear all</button> : undefined}>
        {/* The results list is in-flow (not an absolute popover): S.box clips overflow, so a
            floated list would be cut off at the box edge. The box grows while results are shown. */}
        <div style={{ maxWidth: 400 }}>
          <SearchInput
            type="text"
            placeholder={selected.length >= 5 ? "Max 5 players" : "Search player name..."}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            disabled={selected.length >= 5}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          {dropdownOpen && searchResults.length > 0 && (
            <div role="listbox" aria-label="Search results" style={{ marginTop: 4, background: T.panel, border: `1px solid ${T.line2}`, borderRadius: T.radius, maxHeight: 300, overflowY: "auto" }}>
              {searchResults.map((p) => (
                <div key={p._uid} role="option" aria-selected="false" onClick={() => addPlayer(p)} style={{ padding: "6px 10px", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${T.line}`, fontSize: 12.5 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = T.panel3}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontWeight: 600, color: T.text, flex: 1 }}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></span>
                  <span style={{ ...posText, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</span>
                  <span style={{ color: T.text3, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{orgLabel(p)}</span>
                  <span style={{ color: T.text3, fontVariantNumeric: "tabular-nums" }}>{fmtAge(p._age)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            {selected.map((p) => (
              <div key={p._uid} style={{ background: T.accentBg2, border: `1px solid ${T.line2}`, borderRadius: T.radius, padding: "3px 8px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ ...posText, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</span>
                <span style={{ color: T.text, fontWeight: 600 }}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></span>
                <span style={{ color: T.text3 }}>{orgLabel(p)}</span>
                <button onClick={() => removePlayer(p._uid)} aria-label={`Remove ${p.meta?.name ?? p.Name}`} style={{ background: "none", border: "none", color: T.bad, cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {selected.length > 0 && (
        <Section title="Comparison" count={`(${selected.length})`}>
          <div style={{ margin: -12 }}>
          <div style={{ ...S.tableWrap, border: "none", borderRadius: 0 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={{ ...S.th, width: 120 }}>Stat</th>
                  {selected.map((p, i) => (
                    <th key={p._uid} style={{ ...S.th, ...cellRule(i + 1), minWidth: 120, textAlign: "center" }}>
                      <div style={{ color: T.text, fontWeight: 700, fontSize: 12.5 }}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></div>
                      <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 2, fontWeight: 500 }}>
                        <span style={{ ...posText, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</span>
                        <span style={{ color: T.textDisabled }}>|</span>
                        <span style={{ color: T.text3 }}>{orgLabel(p)}</span>
                        <span style={{ color: T.textDisabled }}>|</span>
                        <span style={{ color: T.text2, fontVariantNumeric: "tabular-nums" }}>{fmtAge(p._age)}</span>
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
                      <td colSpan={selected.length + 1} style={{ ...S.td, height: 26, background: T.panel2, color: T.text3, fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 12, padding: "0 8px" }}>
                        {group.group}
                      </td>
                    </tr>,
                    ...group.stats.map((stat, si) => {
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
                      const zebra = si % 2 === 1 ? S.zebraRow : undefined;
                      return (
                        <tr key={stat.key} style={zebra}>
                          <td style={{ ...S.td, fontWeight: 600, color: T.text2, fontSize: 12 }}>{stat.label}</td>
                          {selected.map((p, i) => {
                            const base = { ...S.td, ...cellRule(i + 1), textAlign: "center" };
                            if (group.appliesTo && p._type !== group.appliesTo) {
                              return <td key={p._uid} style={{ ...base, color: T.textDisabled }}>—</td>;
                            }
                            if (stat.fmt) {
                              const val = stat.fmt(p);
                              if (stat.chip && val !== "—" && val !== "-") {
                                return <td key={p._uid} style={base}><span style={{ ...S.badge, ...chipCss(stat.chip(p)) }}>{val}</span></td>;
                              }
                              const color = (stat.color ? stat.color(p) : undefined) ?? (val === "—" ? T.textDisabled : T.text2);
                              return <td key={p._uid} style={{ ...base, color, ...(stat.pos ? posText : {}), ...(stat.weight && val !== "—" ? { fontWeight: stat.weight } : {}) }}>{val}</td>;
                            }
                            const v = num(resolveKey(p, stat.key));
                            const precision = stat.precision ?? 2;
                            let style = { ...base };
                            if (stat.war) Object.assign(style, warStyle(v));
                            else if (v == null) style.color = T.textDisabled;
                            else if (i === bestIdx) style.color = T.good;
                            else if (i === worstIdx) style.color = T.bad;
                            else style.color = T.text2;
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
          </div>
        </Section>
      )}

      {selected.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: T.text3, fontSize: 13 }}>
          Search and select players above to compare them side-by-side.
        </div>
      )}
    </div>
  );
}
