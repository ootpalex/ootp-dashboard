import { useState, useMemo } from "react";
import { S } from "../theme.js";
import { posColor, levelColor, proneColor, warStyle, devPctColor, gradeStyle } from "../theme.js";
import { fmt, fmtAge, num, isTrueFA, parseCSVBoolean, searchFilter, paginateRows } from "../utils/helpers.js";
import { resolveKey, genericSort, getMaxWar, getMaxWarP, pickFielderPos, passesPositionFilter, passesLevelFilter } from "../utils/accessors.js";
import { PER_PAGE_LARGE, PLAYERS_HIT_COLS, PLAYERS_PIT_COLS, PLAYERS_MIXED_COLS } from "../utils/constants.js";
import { SortHeader, PositionFilter, LevelFilter, MultiSelectDropdown, TwoWayBadge, Pagination } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

const PITCHER_FILTER_KEYS = new Set(["Pitchers", "SP", "RP"]);
const FIELD_FILTER_KEYS = new Set(["C", "1B", "2B", "3B", "SS", "INF", "LF", "CF", "RF", "OF"]);

export default function PlayersView({ data, curveSettings, leagueSettings, onSelectPlayer }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [posFilter, setPosFilter] = useState([]);
  const [orgFilter, setOrgFilter] = useState([]);
  const [levelFilter, setLevelFilter] = useState([]);
  const [faOnly, setFaOnly] = useState(false);
  const [proneFilter, setProneFilter] = useState([]);
  const [on40Filter, setOn40Filter] = useState([]);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [sort, setSort] = useState({ col: "_fv", dir: "desc" });
  const [page, setPage] = useState(0);
  // Column set + source derived from position filter selection
  const hasPitcherSel = posFilter.some((s) => PITCHER_FILTER_KEYS.has(s));
  const hasHitterSel = posFilter.some((s) => s === "Hitters" || FIELD_FILTER_KEYS.has(s));
  const playerType = posFilter.length === 0
    ? "all"
    : hasPitcherSel && hasHitterSel ? "all"
    : hasPitcherSel ? "pitchers" : "hitters";
  const source = useMemo(() => {
    if (playerType === "hitters") return data.hitters;
    if (playerType === "pitchers") return data.pitchers;
    return [...data.hitters, ...data.pitchers];
  }, [data, playerType]);
  const proneValues = useMemo(() => [...new Set(source.map((r) => r.meta?.prone ?? r.Prone).filter(Boolean))].sort(), [source]);
  const teamOptions = useMemo(() => [
    ...data.teams.map((t) => ({ value: t, label: t })),
    { value: "FA", label: "Free Agents", dividerBefore: true },
  ], [data.teams]);
  const proneOptions = useMemo(() => proneValues.map((p) => ({ value: p, label: p })), [proneValues]);
  const on40Options = [
    { value: "Yes", label: "On 40-Man" },
    { value: "No", label: "Not on 40-Man" },
  ];

  // Pitcher role hint:
  //   only "SP" selected → 'sp'; only "RP" selected → 'rp'; else best-of-role.
  const pitcherSel = posFilter.filter((s) => PITCHER_FILTER_KEYS.has(s));
  const fvRoleHint = (pitcherSel.length === 1 && pitcherSel[0] === "SP") ? "sp"
    : (pitcherSel.length === 1 && pitcherSel[0] === "RP") ? "rp"
    : null;
  // For hitters: if the selection contains specific field positions/groups (and
  // does NOT contain the broad "Hitters" key), override values to the max across
  // those selected positions. Else use enrichment defaults (best/max).
  const fieldSel = posFilter.filter((s) => FIELD_FILTER_KEYS.has(s));
  const broadHitterSelected = posFilter.includes("Hitters");
  const useFieldOverride = fieldSel.length > 0 && !broadHitterSelected;
  const posValForRow = (r) => {
    if (r._type === "pitcher" || !useFieldOverride) return null;
    return pickFielderPos(r, fieldSel, r._devCurve, curveSettings);
  };
  const fvForRow = (r) => {
    if (r._type === "pitcher") {
      if (fvRoleHint === "sp") return r._sp?.fv ?? null;
      if (fvRoleHint === "rp") return r._rp?.fv ?? null;
      return r._fv;
    }
    return posValForRow(r)?.fv ?? r._fv;
  };

  const filtered = useMemo(() => {
    const _iafaTag = leagueSettings?.iafaTag || "IAFA";
    const mn = ageMin !== "" ? parseFloat(ageMin) : null;
    const mx = ageMax !== "" ? parseFloat(ageMax) : null;
    const hasSearch = debouncedSearch && debouncedSearch.trim();
    let rows = hasSearch ? searchFilter([...source], debouncedSearch) : [...source];
    rows = rows.filter((r) => {
      if (!passesPositionFilter(r, posFilter)) return false;
      if (orgFilter.length > 0) {
        const org = r.meta?.org ?? r.ORG;
        const matches = orgFilter.some((sel) => sel === "FA" ? isTrueFA(r, _iafaTag) : sel === org);
        if (!matches) return false;
      }
      if (!passesLevelFilter(r, levelFilter)) return false;
      if (mn != null && !isNaN(mn) && (r._age == null || r._age < mn)) return false;
      if (mx != null && !isNaN(mx) && (r._age == null || r._age > mx)) return false;
      if (faOnly && !isTrueFA(r, _iafaTag)) return false;
      if (proneFilter.length > 0 && !proneFilter.includes(r.meta?.prone ?? r.Prone)) return false;
      if (on40Filter.length > 0) {
        const is40 = (r.meta?.on40 ?? (r.ON40 === "Yes")) ? "Yes" : "No";
        if (!on40Filter.includes(is40)) return false;
      }
      return true;
    });
    const { col, dir } = sort;
    genericSort(rows, col, dir, {
      _fv: fvForRow,
      "Max WAR wtd": (r) => posValForRow(r)?.war ?? getMaxWar(r),
      "MAX WAR P": (r) => posValForRow(r)?.warP ?? getMaxWarP(r),
    });
    return rows;
  }, [source, debouncedSearch, posFilter, orgFilter, levelFilter, faOnly, proneFilter, on40Filter, ageMin, ageMax, sort, leagueSettings]);

  const { paged, totalPages } = paginateRows(filtered, page, PER_PAGE_LARGE);
  const cols = playerType === "hitters" ? PLAYERS_HIT_COLS : playerType === "pitchers" ? PLAYERS_PIT_COLS : PLAYERS_MIXED_COLS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
        <MultiSelectDropdown options={teamOptions} value={orgFilter} onChange={(v) => { setOrgFilter(v); setPage(0); }} placeholder="All Teams" ariaLabel="Filter by team" />
        <LevelFilter players={source} value={levelFilter} onChange={(v) => { setLevelFilter(v); setPage(0); }} expandRookieTeams={false} />
        <MultiSelectDropdown options={proneOptions} value={proneFilter} onChange={(v) => { setProneFilter(v); setPage(0); }} placeholder="All Prone" ariaLabel="Filter by prone" minWidth={140} popoverMinWidth={160} />
        <MultiSelectDropdown options={on40Options} value={on40Filter} onChange={(v) => { setOn40Filter(v); setPage(0); }} placeholder="All 40-Man" ariaLabel="Filter by 40-man" minWidth={140} popoverMinWidth={180} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#94a3b8", cursor: "pointer" }}><input type="checkbox" checked={faOnly} onChange={(e) => { setFaOnly(e.target.checked); setPage(0); }} />FA Only</label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={S.searchInput} />
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>Age
          <input type="number" placeholder="min" value={ageMin} onChange={(e) => { setAgeMin(e.target.value); setPage(0); }} style={{ ...S.searchInput, width: 52, padding: "4px 6px", fontSize: 11 }} />
          <span>–</span>
          <input type="number" placeholder="max" value={ageMax} onChange={(e) => { setAgeMax(e.target.value); setPage(0); }} style={{ ...S.searchInput, width: 52, padding: "4px 6px", fontSize: 11 }} />
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "#94a3b8", fontWeight: 600 }}>{filtered.length.toLocaleString()} players</span>
        {(posFilter.length > 0 || orgFilter.length > 0 || levelFilter.length > 0 || proneFilter.length > 0 || on40Filter.length > 0 || faOnly || search || ageMin !== "" || ageMax !== "") && (
          <span>Best Pos breakdown: {(() => {
            const counts = {};
            filtered.forEach((r) => { const bp = (r._bestPos || "").replace("*", "") || "?"; counts[bp] = (counts[bp] || 0) + 1; });
            return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([pos, ct]) => (
              <span key={pos} style={{ marginRight: 6 }}><span style={{ color: posColor(pos) }}>{pos}</span>: {ct}</span>
            ));
          })()}</span>
        )}
      </div>
      <div style={S.tableWrap}><table style={S.table}><thead><tr>
        {cols.map(({ key, label, w }) => <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key} onClick={() => { setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" })); setPage(0); }} />)}
      </tr></thead><tbody>
        {paged.map((r, i) => (
          <tr key={(r._uid || r.ID) + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
            {cols.map(({ key }) => {
              let val = resolveKey(r, key), style = { ...S.td };
              // Position-specific override for WAR / WAR P columns when field pos filter active
              const posVal = posValForRow(r);
              if (posVal) {
                if (key === "Max WAR wtd" || key === "Max WAR vR" || key === "Max WAR vL") val = posVal.war;
                else if (key === "MAX WAR P") val = posVal.warP;
              }
              if (key === "Name") { style.fontWeight = 600; style.color = "#e2e8f0"; style.minWidth = 170; style.cursor = "pointer"; return <td key={key} style={style} onClick={() => onSelectPlayer?.(r)}>{val}<TwoWayBadge player={r} /></td>; }
              else if (key === "_fv") { const fvVal = fvForRow(r); Object.assign(style, warStyle(fvVal)); val = fmt(fvVal); }
              else if (key === "_devPct") { const m = r._ageMatured; style.color = !m && r._devPct != null ? devPctColor(r._devPct) : "#475569"; style.fontWeight = !m && r._devPct != null ? 600 : 400; val = !m && r._devPct != null ? Math.round(r._devPct * 100) + "th" : "—"; }
              else if (key === "MAX WAR P" || key === "WARP" || key === "WARP RP") { if (r._matured) { val = "—"; style.color = "#475569"; } else { const n = num(val); Object.assign(style, warStyle(n)); val = fmt(n); } }
              else if (key === "_age") { val = fmtAge(val); style.color = "#94a3b8"; }
              else if (key === "_bestPos") { style.color = posColor((val || "").replace("*", "")); val = val || "—"; }
              else if (key === "POS") style.color = posColor(val);
              else if (key === "Lev") style.color = levelColor(val);
              else if (key === "Prone") style.color = proneColor(val);
              else if (key === "ORG") { const _iTag = leagueSettings?.iafaTag || "IAFA"; if (val === "-") { const m = (r.meta?.source ?? r.meta?.manual ?? r.Manual ?? "").trim(); if (m === _iTag) { val = _iTag; style.color = "#a78bfa"; } else if (m.toLowerCase().includes("draft")) { const yr = m.match(/\d{4}/); val = yr ? yr[0] + " Draft" : "Draft"; style.color = "#fbbf24"; } else { val = "FA"; style.color = "#64748b"; } } else { style.color = "#cbd5e1"; } style.maxWidth = 130; style.overflow = "hidden"; style.textOverflow = "ellipsis"; style.whiteSpace = "nowrap"; }
              else if (key === "_intangibles") { Object.assign(style, gradeStyle(r._intangibles)); val = r._intangibles ?? "—"; }
              else if (key === "Price") { const n = num(val); val = n != null ? "$" + n.toLocaleString() : "—"; style.color = "#94a3b8"; }
              else if (key === "Starter") { val = parseCSVBoolean(val) ? "✓" : ""; }
              else if (key.includes("WAR") || key.includes("WARP")) { const n = num(val); Object.assign(style, warStyle(n)); val = fmt(n); }
              else { const n = num(val); val = n != null ? (key === "STM" || key === "SPE" ? n.toFixed(0) : n.toFixed(3)) : val || "—"; style.color = "#94a3b8"; }
              return <td key={key} style={style}>{val ?? "—"}</td>;
            })}
          </tr>
        ))}
      </tbody></table></div>
      <Pagination page={page} totalPages={totalPages} total={filtered.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
    </div>
  );
}
