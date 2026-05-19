import { useState, useMemo, useCallback } from "react";
import { S } from "../theme.js";
import { posColor, levelColor, proneColor, warStyle, intangibleColor, devPctColor, zToColor } from "../theme.js";
import { fmt, fmtAge, num, parseCSVBoolean, paginateRows, toRosterRow, sortRosterRows, rankSuffix } from "../utils/helpers.js";
import { getMaxWar, getMaxWarP, getSpWar, getRpWar, getSpWarP, getRpWarP, isEligible, resolveKey, genericSort } from "../utils/accessors.js";
import { ALL_DISPLAY_POS, HITTER_POS, PER_PAGE } from "../utils/constants.js";
import { calcOrgNeed } from "../utils/strength.js";
import { isMatured } from "../utils/dataProcessing.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, PillBtn, PositionFilter, Toggle, TwoWayBadge, Pagination } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

const R5_TABS = [
  { id: "board", label: "R5 Board" },
  { id: "planner", label: "40-Man Planner" },
];

const FORTY_MAN_POS_MINS = { C: 2, "1B": 2, "2B": 2, "3B": 2, SS: 2, LF: 2, CF: 2, RF: 2, SP: 5, RP: 4 };

function Rule5Board({ data, myTeam, strength, curveSettings, onSelectPlayer }) {
  const [r5Tab, setR5Tab] = useState("board");
  const [toggles, setToggles] = useState({ orgNeed: false, devAdj: false, injury: false, intangibles: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState([]);
  const [sort, setSort] = useState({ col: "_rank", dir: "desc" });
  const [page, setPage] = useState(0);

  const orgNeed = useMemo(() => myTeam ? calcOrgNeed(myTeam, strength) : null, [myTeam, strength]);
  const teamZ = strength.zScores["current"]?.[myTeam] || {};
  const teamRanks = strength.ranks["current"]?.[myTeam] || {};

  // Positions sorted weakest to strongest
  const sortedNeeds = useMemo(() => {
    return ALL_DISPLAY_POS
      .map((pos) => ({ pos, z: teamZ[pos] ?? 0, rank: teamRanks[pos] }))
      .sort((a, b) => a.z - b.z);
  }, [teamZ, teamRanks]);

  const isR5 = (p) => (p.meta?.r5 ?? parseCSVBoolean(p.R5)) && (p.meta?.org ?? p.ORG) !== myTeam;
  const pool = useMemo(() => buildBoardPool(data, isR5, isR5), [data, myTeam]);

  const debouncedSearch = useDebouncedValue(search);
  const displayPool = useMemo(() =>
    buildDisplayPool(pool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings, null, { _fv: (p) => p._fv }),
    [pool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings]);

  const { paged, totalPages } = paginateRows(displayPool, page, PER_PAGE);
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.injury || toggles.intangibles;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid #1e293b", paddingBottom: 12 }}>
        {R5_TABS.map((tab) => (
          <PillBtn key={tab.id} active={r5Tab === tab.id} onClick={() => setR5Tab(tab.id)}>
            {tab.label}
          </PillBtn>
        ))}
      </div>

      {r5Tab === "planner" && <ProtectionPlanner data={data} myTeam={myTeam} strength={strength} curveSettings={curveSettings} onSelectPlayer={onSelectPlayer} />}

      {r5Tab === "board" && <>
      <Section title="My Positional Needs">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 6 }}>
          {sortedNeeds.map(({ pos, z, rank }) => {
            const colors = zToColor(z);
            return (
              <div key={pos} style={{ ...S.strengthCard, background: colors.bg, borderColor: colors.border, padding: "8px 6px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: posColor(pos), letterSpacing: 1 }}>{pos}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: colors.value, marginTop: 1 }}>{rankSuffix(rank)}</div>
                <div style={{ fontSize: 9, color: colors.label }}>z: {fmt(z, 2)}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
          Sorted weakest to strongest. Target R5 picks at your weakest positions.
        </div>
      </Section>

      <Section title="Smart Rank Adjustments">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Toggle label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
          <Toggle label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
          <Toggle label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
          <Toggle label="Intangibles" description="Bonus for elite intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
        </div>
      </Section>

      <Section title={`Rule 5 Board (${pool.length} eligible players)`}>
        <div style={{ marginBottom: 12 }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={S.searchInput} />
        </div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              {[
                { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70 },
                { key: "Name", label: "Name", w: 170 },
                { key: "Age", label: "Age", w: 45 },
                { key: "_devPct", label: "Dev%", w: 48 },
                { key: "POS", label: "POS", w: 48 },
                { key: "_bestPos", label: "Best", w: 48 },
                { key: "ORG", label: "ORG", w: 130 },
                { key: "Lev", label: "Level", w: 50 },
                { key: "_fv", label: "FV", w: 60 },
                { key: "_currentVal", label: "WAR", w: 65 },
                { key: "_baseVal", label: "WAR P", w: 65 },
                { key: "Prone", label: "Prone", w: 65 },
                ...(anyToggle ? [{ key: "_baseVal_raw", label: "Raw", w: 60 }] : []),
                { key: "B", label: "B/T", w: 50 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key === "_baseVal_raw" ? "_baseVal" : key} onClick={() => setSort((prev) => ({ col: key === "_baseVal_raw" ? "_baseVal" : key, dir: prev.col === (key === "_baseVal_raw" ? "_baseVal" : key) && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => (
                <tr key={p.ID + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                  <td style={{ ...S.td, ...warStyle(p._rank), fontWeight: 700 }}>{fmt(p._rank)}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                      onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                  <td style={S.td}>{fmtAge(p._age)}</td>
                  <td style={{ ...S.td, color: p._devPct != null ? devPctColor(p._devPct) : "#475569", fontWeight: p._devPct != null ? 600 : 400 }}>{p._devPct != null ? Math.round(p._devPct * 100) + "th" : "—"}</td>
                  <td style={{ ...S.td, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                  <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                  <td style={{ ...S.td, color: "#cbd5e1", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.meta?.org ?? p.ORG}</td>
                  <td style={{ ...S.td, color: levelColor(p.meta?.lev ?? p.Lev) }}>{p.meta?.lev ?? p.Lev}</td>
                  <td style={{ ...S.td, ...warStyle(p._fv) }}>{fmt(p._fv)}</td>
                  <td style={{ ...S.td, ...warStyle(p._currentVal) }}>{fmt(p._currentValDisplay ?? p._currentVal)}</td>
                  <td style={{ ...S.td, ...(p._matured ? { color: "#475569" } : warStyle(p._baseVal)) }}>{p._matured ? "—" : fmt(p._baseValDisplay ?? p._baseVal)}</td>
                  <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                  {anyToggle && <td style={{ ...S.td, ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>}
                  <td style={S.td}>{`${p.meta?.bats ?? p.B ?? ""}/${p.meta?.throws ?? p.T ?? ""}`}</td>
                </tr>
              ))}
              {paged.length === 0 && <tr><td colSpan={anyToggle ? 14 : 13} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No R5-eligible players found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={displayPool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
      </>}
    </div>
  );
}

function ProtectionPlanner({ data, myTeam, strength, curveSettings, onSelectPlayer }) {
  const [protectSet, setProtectSet] = useState(new Set());
  const [removeSet, setRemoveSet] = useState(new Set());
  const [protectSort, setProtectSort] = useState({ col: "fv", dir: "desc" });
  const [removeSort, setRemoveSort] = useState({ col: "fv", dir: "asc" });
  const [protectTypeFilter, setProtectTypeFilter] = useState("all");
  const [removeTypeFilter, setRemoveTypeFilter] = useState("all");
  const [showFullRoster, setShowFullRoster] = useState(false);

  const teamHitters = useMemo(() => data.hitters.filter((h) => (h.meta?.org ?? h.ORG) === myTeam), [data.hitters, myTeam]);
  const teamPitchers = useMemo(() => data.pitchers.filter((p) => (p.meta?.org ?? p.ORG) === myTeam), [data.pitchers, myTeam]);

  const MAX_OPTIONS = 3;

  // 40-man roster — include opt/oy from extra dict
  const fortyMan = useMemo(() => {
    const buildRow = (p, type) => {
      const opt = num(p.extra?.OPT) ?? num(p.meta?.opt);
      const oy = num(p.extra?.OY) ?? num(p.meta?.oy);
      const outOfOptions = opt != null && opt >= MAX_OPTIONS;
      return toRosterRow(p, type, { price: p._price, opt, oy, outOfOptions });
    };
    const hitters = teamHitters.filter((h) => (h.meta?.on40 ?? (h.ON40 === "Yes"))).map((h) => buildRow(h, "hitter"));
    const pitchers = teamPitchers.filter((p) => (p.meta?.on40 ?? (p.ON40 === "Yes"))).map((p) => buildRow(p, "pitcher"));
    return { hitters, pitchers, all: [...hitters, ...pitchers] };
  }, [teamHitters, teamPitchers]);

  // Per-player devPct (cur-WAR-pct within age cohort) for protect candidates.
  // Pulls already-computed _devPct from Dashboard.jsx enrichment.
  const devPercentiles = useMemo(() => {
    const m = new Map();
    [...teamHitters, ...teamPitchers].forEach((p) => {
      m.set(String(p._uid), p._devPct ?? null);
    });
    return m;
  }, [teamHitters, teamPitchers]);

  // Protection candidates: R5-eligible, NOT on 40-man
  const protectCandidates = useMemo(() => {
    const build = (players, type) => players
      .filter((p) => (p.meta?.r5 ?? parseCSVBoolean(p.R5)) && !(p.meta?.on40 ?? (p.ON40 === "Yes")))
      .map((p) => {
        const devPct = (p._age != null && !p._ageMatured) ? (devPercentiles.get(String(p._uid)) ?? null) : null;
        return toRosterRow(p, type, { devPct });
      });
    let all = [...build(teamHitters, "hitter"), ...build(teamPitchers, "pitcher")];
    if (protectTypeFilter === "hitters") all = all.filter((p) => p.type === "hitter");
    if (protectTypeFilter === "pitchers") all = all.filter((p) => p.type === "pitcher");
    const { col, dir } = protectSort;
    all.sort((a, b) => { let va = a[col], vb = b[col]; if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va); return dir === "asc" ? va - vb : vb - va; });
    return all;
  }, [teamHitters, teamPitchers, protectSort, protectTypeFilter, devPercentiles]);

  // Positional coverage analysis
  const posCoverage = useMemo(() => {
    const coverage = {};
    const hitPositions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
    hitPositions.forEach((pos) => {
      const count = fortyMan.hitters.filter((h) => isEligible(h._original, pos)).length;
      const min = FORTY_MAN_POS_MINS[pos] || 2;
      coverage[pos] = { count, min, status: count <= 1 ? "thin" : count < min ? "short" : "ok" };
    });
    // SP/RP coverage
    const spCount = fortyMan.pitchers.filter((p) => {
      const starter = p._original?.starter ?? p._original?.Starter;
      return starter === true || starter === "Yes" || parseCSVBoolean(starter);
    }).length;
    const rpCount = fortyMan.pitchers.length - spCount;
    coverage["SP"] = { count: spCount, min: FORTY_MAN_POS_MINS.SP, status: spCount <= 1 ? "thin" : spCount < FORTY_MAN_POS_MINS.SP ? "short" : "ok" };
    coverage["RP"] = { count: rpCount, min: FORTY_MAN_POS_MINS.RP, status: rpCount <= 1 ? "thin" : rpCount < FORTY_MAN_POS_MINS.RP ? "short" : "ok" };
    return coverage;
  }, [fortyMan]);

  // Check if protecting a candidate fills a thin/short position
  const fillsGap = useCallback((player) => {
    if (player.type === "pitcher") {
      const pos = player.pos === "SP" ? "SP" : "RP";
      return posCoverage[pos]?.status !== "ok" ? pos : null;
    }
    const hitPositions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
    for (const pos of hitPositions) {
      if (isEligible(player._original, pos) && posCoverage[pos]?.status !== "ok") return pos;
    }
    return null;
  }, [posCoverage]);

  // Check if a 40-man player is shielded (removing drops a position below minimum)
  const isShielded = useCallback((player) => {
    if (player.type === "pitcher") {
      const pos = player.pos === "SP" ? "SP" : "RP";
      return posCoverage[pos] && posCoverage[pos].count <= posCoverage[pos].min;
    }
    const hitPositions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
    for (const pos of hitPositions) {
      if (isEligible(player._original, pos) && posCoverage[pos] && posCoverage[pos].count <= posCoverage[pos].min) return true;
    }
    return false;
  }, [posCoverage]);

  // Summary stats
  const summary = useMemo(() => {
    const total40 = fortyMan.all.length;
    const openSlots = Math.max(0, 40 - total40);
    const hitterCount = fortyMan.hitters.length;
    const pitcherCount = fortyMan.pitchers.length;
    const protectCount = protectSet.size;
    const spotsNeeded = Math.max(0, protectCount - openSlots);
    const removeCount = removeSet.size;
    const netDelta = removeCount - spotsNeeded;
    const outOfOptionsCount = fortyMan.all.filter((p) => p.outOfOptions).length;
    return { total40, openSlots, hitterCount, pitcherCount, protectCount, spotsNeeded, removeCount, netDelta, outOfOptionsCount };
  }, [fortyMan, protectSet, removeSet]);

  // Smart suggestion algorithm — out-of-options players sort first (most expendable)
  const suggestions = useMemo(() => {
    if (summary.spotsNeeded <= 0) return new Set();
    const hitterPct = fortyMan.all.length > 0 ? fortyMan.hitters.length / fortyMan.all.length : 0.5;
    const pitcherPct = 1 - hitterPct;
    const maxRemoveHitters = Math.floor(fortyMan.hitters.length - fortyMan.all.length * Math.max(0.30, hitterPct - 0.10));
    const maxRemovePitchers = Math.floor(fortyMan.pitchers.length - fortyMan.all.length * Math.max(0.30, pitcherPct - 0.10));

    // Sort: out-of-options first, then FV ascending (most expendable first)
    const candidates = [...fortyMan.all].sort((a, b) => {
      if (a.outOfOptions !== b.outOfOptions) return a.outOfOptions ? -1 : 1;
      return (a.fv ?? 0) - (b.fv ?? 0);
    });
    const result = new Set();
    let removedHitters = 0, removedPitchers = 0;

    // First pass: respect guards
    for (const p of candidates) {
      if (result.size >= summary.spotsNeeded) break;
      if (removeSet.has(p.id)) continue;
      if (p.type === "hitter" && removedHitters >= maxRemoveHitters) continue;
      if (p.type === "pitcher" && removedPitchers >= maxRemovePitchers) continue;
      if (isShielded(p)) continue;
      result.add(p.id);
      if (p.type === "hitter") removedHitters++;
      else removedPitchers++;
    }

    // Second pass: ignore shields if still need more
    if (result.size + removeSet.size < summary.spotsNeeded) {
      for (const p of candidates) {
        if (result.size + removeSet.size >= summary.spotsNeeded) break;
        if (removeSet.has(p.id) || result.has(p.id)) continue;
        if (p.type === "hitter" && removedHitters >= maxRemoveHitters) continue;
        if (p.type === "pitcher" && removedPitchers >= maxRemovePitchers) continue;
        result.add(p.id);
        if (p.type === "hitter") removedHitters++;
        else removedPitchers++;
      }
    }

    return result;
  }, [fortyMan, summary.spotsNeeded, removeSet, isShielded]);

  // Removal candidates: show only waive-worthy players by default (bottom by FV),
  // plus any manually marked or suggested. Expand to show full roster.
  const WAIVE_SHOW_COUNT = 15;
  const removalCandidates = useMemo(() => {
    let all = [...fortyMan.all];
    if (removeTypeFilter === "hitters") all = all.filter((p) => p.type === "hitter");
    if (removeTypeFilter === "pitchers") all = all.filter((p) => p.type === "pitcher");
    const { col, dir } = removeSort;
    all.sort((a, b) => { let va = a[col], vb = b[col]; if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va); return dir === "asc" ? va - vb : vb - va; });
    return all;
  }, [fortyMan, removeSort, removeTypeFilter]);

  // Filtered view: show bottom N + any marked/suggested/out-of-options
  const visibleRemovalCandidates = useMemo(() => {
    if (showFullRoster) return removalCandidates;
    // Build a set of IDs that should always be visible
    const alwaysShow = new Set();
    removeSet.forEach((id) => alwaysShow.add(id));
    suggestions.forEach((id) => alwaysShow.add(id));
    // Always show the bottom N by FV (sorted ascending)
    const byFv = [...removalCandidates].sort((a, b) => (a.fv ?? 0) - (b.fv ?? 0));
    byFv.slice(0, WAIVE_SHOW_COUNT).forEach((p) => alwaysShow.add(p.id));
    // Also always show out-of-options players
    removalCandidates.filter((p) => p.outOfOptions).forEach((p) => alwaysShow.add(p.id));
    // Return in the user's current sort order, filtered to visible
    return removalCandidates.filter((p) => alwaysShow.has(p.id));
  }, [removalCandidates, showFullRoster, removeSet, suggestions]);

  const toggleProtect = (uid) => setProtectSet((prev) => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const toggleRemove = (uid) => setRemoveSet((prev) => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const toggleProtectSort = (col) => setProtectSort((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" }));
  const toggleRemoveSort = (col) => setRemoveSort((prev) => ({ col, dir: prev.col === col && prev.dir === "asc" ? "desc" : "asc" }));

  const coverageColor = (status) => status === "thin" ? "#ef4444" : status === "short" ? "#fbbf24" : "#22c55e";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Section 1: Summary + Positional Coverage */}
      <Section title="40-Man Summary">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, marginBottom: 16 }}>
          {[
            { label: "40-Man Used", value: `${summary.total40}/40`, color: summary.total40 >= 40 ? "#ef4444" : "#e2e8f0" },
            { label: "Open Slots", value: summary.openSlots, color: summary.openSlots === 0 ? "#ef4444" : "#22c55e" },
            { label: "Hitters", value: summary.hitterCount, color: "#60a5fa" },
            { label: "Pitchers", value: summary.pitcherCount, color: "#f472b6" },
            { label: "To Protect", value: summary.protectCount, color: summary.protectCount > 0 ? "#fbbf24" : "#94a3b8" },
            { label: "Spots Needed", value: summary.spotsNeeded, color: summary.spotsNeeded > 0 ? "#ef4444" : "#22c55e" },
            { label: "To Remove", value: summary.removeCount, color: summary.removeCount > 0 ? "#fb923c" : "#94a3b8" },
            { label: "Net Balance", value: summary.netDelta >= 0 ? `+${summary.netDelta}` : summary.netDelta, color: summary.netDelta >= 0 ? "#22c55e" : "#ef4444" },
          ].map((s) => (
            <div key={s.label} style={{ ...S.strengthCard, background: "rgba(15,23,42,0.6)", borderColor: "#1e293b", padding: "10px 8px" }}>
              <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {summary.netDelta < 0 && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid #dc2626", borderRadius: 6, padding: "8px 12px", color: "#fca5a5", fontSize: 12, marginBottom: 12 }}>
            You need to remove {Math.abs(summary.netDelta)} more player{Math.abs(summary.netDelta) !== 1 ? "s" : ""} to make room for all protections.
          </div>
        )}

        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8 }}>Positional Coverage (40-Man)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ALL_DISPLAY_POS.filter((p) => p !== "DH").map((pos) => {
              const cov = posCoverage[pos];
              if (!cov) return null;
              return (
                <div key={pos} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(15,23,42,0.8)", border: `1px solid ${coverageColor(cov.status)}40`, borderRadius: 6, padding: "4px 8px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: posColor(pos) }}>{pos}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: coverageColor(cov.status) }}>{cov.count}</span>
                  <span style={{ fontSize: 9, color: "#475569" }}>/{cov.min}</span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>
            <span style={{ color: "#ef4444" }}>Red</span> = thin (at risk), <span style={{ color: "#fbbf24" }}>Yellow</span> = short, <span style={{ color: "#22c55e" }}>Green</span> = adequate
          </div>
        </div>
      </Section>

      {/* Section 2: Protection Candidates */}
      <Section title={`Protection Candidates (${protectCandidates.length} R5-eligible)`}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          R5-eligible players NOT on your 40-man. Check players you want to protect.
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {["all", "hitters", "pitchers"].map((f) => (
            <PillBtn key={f} active={protectTypeFilter === f} onClick={() => setProtectTypeFilter(f)}>
              {f === "all" ? "All" : f === "hitters" ? "Hitters" : "Pitchers"}
            </PillBtn>
          ))}
        </div>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              <th style={{ ...S.th, width: 36, minWidth: 36 }}></th>
              {[
                { key: "name", label: "Name", w: 170 }, { key: "age", label: "Age", w: 45 },
                { key: "devPct", label: "Dev%", w: 48 }, { key: "pos", label: "POS", w: 48 },
                { key: "bestPos", label: "Best", w: 48 }, { key: "level", label: "Level", w: 50 },
                { key: "fv", label: "FV", w: 60 }, { key: "war", label: "WAR", w: 65 },
                { key: "warP", label: "WAR P", w: 65 }, { key: "prone", label: "Prone", w: 65 },
                { key: "bt", label: "B/T", w: 50 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={protectSort.col} sortDir={protectSort.dir} colKey={key} onClick={() => toggleProtectSort(key)} />
              ))}
              <th style={{ ...S.th, width: 50, minWidth: 50 }}>Gap</th>
            </tr></thead>
            <tbody>
              {protectCandidates.map((p, i) => {
                const checked = protectSet.has(p.id);
                const gap = fillsGap(p);
                return (
                  <tr key={p.id + "-" + i} style={{ background: checked ? "rgba(250,204,21,0.08)" : i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                    <td style={S.td}>
                      <input type="checkbox" checked={checked} onChange={() => toggleProtect(p.id)} style={{ cursor: "pointer", accentColor: "#fbbf24" }} />
                    </td>
                    <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p._original || p)}>{p.name}<TwoWayBadge player={p} /></td>
                    <td style={S.td}>{fmtAge(p.age)}</td>
                    <td style={{ ...S.td, color: !p.matured && p.devPct != null ? devPctColor(p.devPct) : "#475569", fontWeight: !p.matured && p.devPct != null ? 600 : 400 }}>{!p.matured && p.devPct != null ? Math.round(p.devPct * 100) + "th" : "—"}</td>
                    <td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
                    <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
                    <td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
                    <td style={{ ...S.td, ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
                    <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
                    <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
                    <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone}</td>
                    <td style={S.td}>{p.bt}</td>
                    <td style={{ ...S.td, fontSize: 10, fontWeight: 700, color: gap ? coverageColor(posCoverage[gap]?.status) : "#475569" }}>
                      {gap ? `+${gap}` : "—"}
                    </td>
                  </tr>
                );
              })}
              {protectCandidates.length === 0 && <tr><td colSpan={13} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No R5-eligible players to protect</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 3: Removal Candidates */}
      <Section title={`Removal Candidates (${fortyMan.all.length} on 40-man)`}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          {showFullRoster ? "Full 40-man roster." : `Showing bottom ${WAIVE_SHOW_COUNT} by FV, out-of-options players, and any marked/suggested.`}
          {suggestions.size > 0 ? ` ${suggestions.size} suggestion${suggestions.size !== 1 ? "s" : ""}.` : ""}
          {summary.outOfOptionsCount > 0 ? ` ${summary.outOfOptionsCount} out of options.` : ""}
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
          {["all", "hitters", "pitchers"].map((f) => (
            <PillBtn key={f} active={removeTypeFilter === f} onClick={() => setRemoveTypeFilter(f)}>
              {f === "all" ? "All" : f === "hitters" ? "Hitters" : "Pitchers"}
            </PillBtn>
          ))}
          <div style={{ marginLeft: "auto" }}>
            <PillBtn active={showFullRoster} onClick={() => setShowFullRoster((v) => !v)}>
              {showFullRoster ? "Show Waive Candidates" : "Show Full Roster"}
            </PillBtn>
          </div>
        </div>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              <th style={{ ...S.th, width: 36, minWidth: 36 }}></th>
              {[
                { key: "name", label: "Name", w: 170 }, { key: "age", label: "Age", w: 45 },
                { key: "pos", label: "POS", w: 48 }, { key: "bestPos", label: "Best", w: 48 },
                { key: "level", label: "Level", w: 50 }, { key: "fv", label: "FV", w: 60 },
                { key: "war", label: "WAR", w: 65 }, { key: "warP", label: "WAR P", w: 65 },
                { key: "prone", label: "Prone", w: 65 }, { key: "opt", label: "OPT", w: 45 },
                { key: "price", label: "Salary", w: 80 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={removeSort.col} sortDir={removeSort.dir} colKey={key} onClick={() => toggleRemoveSort(key)} />
              ))}
            </tr></thead>
            <tbody>
              {visibleRemovalCandidates.map((p, i) => {
                const manualRemove = removeSet.has(p.id);
                const suggested = suggestions.has(p.id);
                const shielded = isShielded(p);
                let bg = i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)";
                if (manualRemove) bg = "rgba(251,146,60,0.12)";
                else if (suggested) bg = "rgba(239,68,68,0.08)";
                return (
                  <tr key={p.id + "-" + i} style={{ background: bg }}>
                    <td style={S.td}>
                      <input type="checkbox" checked={manualRemove} onChange={() => toggleRemove(p.id)} style={{ cursor: "pointer", accentColor: "#fb923c" }} />
                    </td>
                    <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p._original || p)}>
                      {p.name}<TwoWayBadge player={p} />
                      {shielded && <span title="Critical positional coverage" style={{ marginLeft: 4, fontSize: 10 }}>🛡</span>}
                    </td>
                    <td style={S.td}>{fmtAge(p.age)}</td>
                    <td style={{ ...S.td, color: posColor(p.pos) }}>{p.pos}</td>
                    <td style={{ ...S.td, color: posColor((p.bestPos || "").replace("*", "")) }}>{p.bestPos || "—"}</td>
                    <td style={{ ...S.td, color: levelColor(p.level) }}>{p.level}</td>
                    <td style={{ ...S.td, ...warStyle(p.fv) }}>{fmt(p.fv)}</td>
                    <td style={{ ...S.td, ...warStyle(p.war) }}>{fmt(p.war)}</td>
                    <td style={{ ...S.td, ...(p.matured ? { color: "#475569" } : warStyle(p.warP)) }}>{p.matured ? "—" : fmt(p.warP)}</td>
                    <td style={{ ...S.td, color: proneColor(p.prone) }}>{p.prone}</td>
                    <td style={{ ...S.td, color: p.outOfOptions ? "#ef4444" : p.opt != null ? "#94a3b8" : "#475569", fontWeight: p.outOfOptions ? 700 : 400 }}>
                      {p.opt != null ? `${p.opt}/${MAX_OPTIONS}` : "—"}
                      {p.outOfOptions && <span title="Out of options — must be on active roster or waived" style={{ marginLeft: 2, fontSize: 9 }}>!</span>}
                    </td>
                    <td style={{ ...S.td, color: "#94a3b8" }}>{p.price != null ? "$" + p.price.toLocaleString() : "—"}</td>
                  </tr>
                );
              })}
              {visibleRemovalCandidates.length === 0 && <tr><td colSpan={12} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No 40-man players found</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
          {!showFullRoster && visibleRemovalCandidates.length < removalCandidates.length && (
            <span>Showing {visibleRemovalCandidates.length} of {removalCandidates.length} players. </span>
          )}
          40-Man: {fortyMan.hitters.length} hitters, {fortyMan.pitchers.length} pitchers
        </div>
      </Section>
    </div>
  );
}

export default Rule5Board;
