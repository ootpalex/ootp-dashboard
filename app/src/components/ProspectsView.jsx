import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { S, TOKENS as T, FV_TIER_COLORS } from "../theme.js";
import { posColor, levelChip, tierChip, warStyle, devPctStyle, scoutingRatingColor } from "../theme.js";
import { fmt, fmtAge, num, paginateRows, searchFilter, orgLabel, rankSuffix } from "../utils/helpers.js";
import { genericSort, getMaxWar, getSpWar, getRpWar, passesPositionFilter, passesLevelFilter } from "../utils/accessors.js";
import { FV_TIERS, PER_PAGE, PROSPECT_SUB_TABS } from "../utils/constants.js";
import { loadProspectSettings, saveProspectSettings } from "../utils/settings.js";
import { buildProspectPool, suggestThresholds, assignFVTier, getDollarValue, calcFarmRankings } from "../utils/prospects.js";
import { Section, SortHeader, PillBtn, PositionFilter, LevelFilter, MultiSelectDropdown, TabGroup, TwoWayBadge, Pagination, NumInput, SearchInput, colRule } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

// Night Scorecard encodings (theme.js helpers return { bg, text, border } — map them to CSS here).
const tierPill = (id) => { const c = tierChip(id); return { ...S.tierPill, background: c.bg, color: c.text }; };
const levelBadge = (lev) => { const c = levelChip(lev); return { ...S.badge, background: c.bg, color: c.text, borderColor: c.border, ...(c.borderStyle ? { borderStyle: c.borderStyle } : {}) }; };
const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" };
const posCell = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 13 };
// Per-column cell style: the column-group rule + the 12px box padding on the first / last cell.
const cellStyles = (cols) => {
  const m = {};
  cols.forEach((c, i) => {
    m[c.key] = { ...(colRule(cols, i) || {}), ...(i === 0 ? { paddingLeft: 12 } : {}), ...(i === cols.length - 1 ? { paddingRight: 12 } : {}) };
  });
  return m;
};
// Tables run edge-to-edge inside the box body; the pager is the foot strip.
const edgeWrap = { ...S.tableWrap, margin: -12, border: "none", borderRadius: 0 };
const footWrap = { margin: "0 -12px -12px" };

function ProspectsView({ data, curveSettings, leagueSettings, onSelectPlayer }) {
  const [subTab, setSubTab] = useState("board");

  const iafaTag = leagueSettings?.iafaTag || "IAFA";
  const prospectPool = useMemo(() => buildProspectPool(data, iafaTag, curveSettings), [data, iafaTag, curveSettings]);

  // Initialize thresholds on first load
  const [thresholds, setThresholds] = useState(() => {
    const saved = loadProspectSettings();
    return saved?.thresholds || {};
  });
  const [dollarValues, setDollarValues] = useState(() => {
    const saved = loadProspectSettings();
    if (saved?.dollarValues) return saved.dollarValues;
    const dv = {};
    FV_TIERS.forEach((t) => { dv[t.id] = { bat: t.defaultBat, pit: t.defaultPit }; });
    return dv;
  });

  // Board filter state lifted here so FarmRankings can navigate into Board with filters.
  // Both are arrays for the new MultiSelectDropdown style.
  const [boardOrgFilter, setBoardOrgFilter] = useState([]);
  const [boardTierFilter, setBoardTierFilter] = useState([]);

  const navigateToBoard = useCallback((team, tierId) => {
    setBoardOrgFilter(team ? [team] : []);
    setBoardTierFilter(tierId ? [tierId] : []);
    setSubTab("board");
  }, []);

  // Auto-suggest thresholds on first load if none saved
  const hasAutoSuggested = useRef(false);
  useEffect(() => {
    if (hasAutoSuggested.current) return;
    if (Object.keys(thresholds).length === 0 && prospectPool.length > 0) {
      const suggested = suggestThresholds(prospectPool, data.teams.length);
      setThresholds(suggested);
      hasAutoSuggested.current = true;
    }
  }, [prospectPool, data.teams.length, thresholds]);

  // Persist settings on change
  useEffect(() => {
    if (Object.keys(thresholds).length > 0) {
      saveProspectSettings({ thresholds, dollarValues });
    }
  }, [thresholds, dollarValues]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <TabGroup label="Prospect sections" style={{ display: "flex", gap: 8 }}>
        {PROSPECT_SUB_TABS.map((tab) => (
          <PillBtn key={tab.id} active={subTab === tab.id} onClick={() => {
            if (tab.id === "farm") { setBoardOrgFilter([]); setBoardTierFilter([]); }
            setSubTab(tab.id);
          }}>
            {tab.label}
          </PillBtn>
        ))}
      </TabGroup>
      {subTab === "board" && (
        <ProspectBoard data={data} prospectPool={prospectPool} thresholds={thresholds}
          setThresholds={setThresholds} dollarValues={dollarValues} setDollarValues={setDollarValues}
          curveSettings={curveSettings} orgFilter={boardOrgFilter} setOrgFilter={setBoardOrgFilter}
          tierFilter={boardTierFilter} setTierFilter={setBoardTierFilter} onSelectPlayer={onSelectPlayer} />
      )}
      {subTab === "farm" && (
        <FarmRankings data={data} prospectPool={prospectPool} thresholds={thresholds} dollarValues={dollarValues}
          onNavigate={navigateToBoard} />
      )}
    </div>
  );
}

function ProspectBoard({ data, prospectPool, thresholds, setThresholds, dollarValues, setDollarValues, curveSettings, orgFilter, setOrgFilter, tierFilter, setTierFilter, onSelectPlayer }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [posFilter, setPosFilter] = useState([]);
  const [levelFilter, setLevelFilter] = useState([]);
  const [sort, setSort] = useState({ col: "_fv", dir: "desc" });
  const [page, setPage] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);

  // MLB WAR distribution for per-tier rarity counts (Option B in tier table).
  // Filter: lev === "MLB" AND on the 40-man roster. The on40 check excludes
  // DFA'd / limbo players (still tagged MLB-level but not on the big-league
  // squad) while keeping IL players who are officially on the roster.
  const mlbWAR = useMemo(() => {
    const isOnBigLeagueSquad = (p) => (p.meta?.lev ?? p.Lev) === "MLB" && p.meta?.on40 === true;
    const mlbH = data.hitters.filter(isOnBigLeagueSquad);
    const mlbP = data.pitchers.filter(isOnBigLeagueSquad);
    const hWAR = mlbH.map((h) => getMaxWar(h)).filter((v) => v != null);
    const pWAR = mlbP.map((p) => getSpWar(p) ?? getRpWar(p)).filter((v) => v != null);
    return [...hWAR, ...pWAR].sort((a, b) => b - a);
  }, [data]);
  const countMlbAtOrAbove = useCallback((threshold) => {
    if (threshold == null) return null;
    // Binary search for first index where WAR < threshold (array is desc)
    let lo = 0, hi = mlbWAR.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (mlbWAR[mid] >= threshold) lo = mid + 1; else hi = mid;
    }
    return lo;
  }, [mlbWAR]);

  // Tier distribution stats for config table
  const tierStats = useMemo(() => {
    const sorted = [...prospectPool].sort((a, b) => (b._fv ?? b._baseVal ?? 0) - (a._fv ?? a._baseVal ?? 0));
    const stats = {};
    let cumulative = 0;
    FV_TIERS.forEach((tier) => {
      const inTier = sorted.filter((p) => assignFVTier(p._fv ?? p._baseVal ?? 0, thresholds) === tier.id);
      cumulative += inTier.length;
      const fvs = inTier.map((p) => p._fv ?? p._baseVal ?? 0);
      const hit = inTier.filter((p) => p._poolType === "hitter").length;
      const pit = inTier.filter((p) => p._poolType === "pitcher").length;
      stats[tier.id] = {
        count: inTier.length, cumulative, hit, pit,
        minFV: fvs.length > 0 ? Math.min(...fvs) : null,
        maxFV: fvs.length > 0 ? Math.max(...fvs) : null,
      };
    });
    return stats;
  }, [prospectPool, thresholds]);

  // Pre-compute stable ranks (overall + per-org) sorted by FV desc, independent of filters
  const rankedPool = useMemo(() => {
    // Assign tiers to full pool, exclude below 35+
    const withTiers = prospectPool.map((p) => {
      const fv = p._fv ?? p._baseVal ?? 0;
      const tierId = assignFVTier(fv, thresholds);
      const dollarVal = tierId ? getDollarValue(tierId, p._poolType, dollarValues) : 0;
      return { ...p, _tierId: tierId, _dollarVal: dollarVal };
    }).filter((p) => p._tierId != null);

    // Sort by FV desc for ranking
    withTiers.sort((a, b) => (b._fv ?? b._baseVal ?? 0) - (a._fv ?? a._baseVal ?? 0));

    // Assign overall rank
    withTiers.forEach((p, i) => { p._overallRank = i + 1; });

    // Assign org rank
    const orgCounters = {};
    withTiers.forEach((p) => {
      const org = p.meta?.org ?? p.ORG ?? "-";
      orgCounters[org] = (orgCounters[org] || 0) + 1;
      p._orgRank = orgCounters[org];
    });

    return withTiers;
  }, [prospectPool, thresholds, dollarValues]);

  const displayPool = useMemo(() => {
    let rows = [...rankedPool];
    rows = searchFilter(rows, debouncedSearch);
    if (posFilter.length > 0) rows = rows.filter((r) => passesPositionFilter(r, posFilter));
    if (orgFilter.length > 0) rows = rows.filter((r) => orgFilter.includes(r.meta?.org ?? r.ORG));
    if (levelFilter.length > 0) rows = rows.filter((r) => passesLevelFilter(r, levelFilter));
    if (tierFilter.length > 0) rows = rows.filter((r) => tierFilter.includes(r._tierId));

    const { col, dir } = sort;
    genericSort(rows, col, dir, {
      _fv: (p) => p._fv ?? p._baseVal,
      _dollarVal: (p) => p._dollarVal,
      _devPct: (p) => p._devPct,
      _overallRank: (p) => p._overallRank,
      _orgRank: (p) => p._orgRank,
      _tierId: (p) => FV_TIERS.findIndex((t) => t.id === p._tierId),
    });
    return rows;
  }, [rankedPool, debouncedSearch, posFilter, orgFilter, levelFilter, tierFilter, sort]);

  const { paged, totalPages } = paginateRows(displayPool, page, PER_PAGE);

  const cfgInputStyle = { ...S.searchInput, width: 65, height: 24, padding: "3px 4px", fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  // Config table columns — groups: tier | thresholds | $ | counts | ranges (§B.3 item 8).
  const cfgCols = [
    { key: "tier", label: "Tier", w: 50, group: "tier" },
    { key: "thresh", label: "FV ≥ Threshold", w: 80, group: "thresholds", align: "center" },
    { key: "bat", label: "Bat $M", w: 65, group: "money", align: "center" },
    { key: "pit", label: "Pit $M", w: 65, group: "money", align: "center" },
    { key: "count", label: "Count", w: 45, group: "counts", align: "right" },
    { key: "hit", label: "H", w: 35, group: "counts", align: "right" },
    { key: "pitc", label: "P", w: 35, group: "counts", align: "right" },
    { key: "cum", label: "Cum.", w: 45, group: "counts", align: "right" },
    { key: "range", label: "FV Range", w: 100, group: "ranges" },
    { key: "mlb", label: "MLB Players ≥ FV", w: 140, group: "ranges", align: "right", title: "Current-season MLB players whose WAR is at or above this tier's FV threshold" },
  ];
  const cfgCell = cellStyles(cfgCols);

  // Board columns — groups: Rank Org Tier | Name Age | Dev% | POS Best Team Lvl | FV WAR WAR P | $ Val (§B.3 item 8).
  const cols = [
    { key: "_overallRank", label: "Rank", w: 45, group: "rank", align: "right" },
    { key: "_orgRank", label: "Org", w: 40, group: "rank", align: "right" },
    { key: "_tierId", label: "FV Tier", w: 65, group: "rank" },
    { key: "Name", label: "Name", w: 170, group: "identity" },
    { key: "Age", label: "Age", w: 45, group: "identity", align: "right" },
    { key: "_devPct", label: "Dev%", w: 48, group: "development", align: "right" },
    { key: "POS", label: "POS", w: 48, group: "position" },
    { key: "_bestPos", label: "Best", w: 48, group: "position" },
    { key: "ORG", label: "Team", w: 130, group: "position" },
    { key: "Lev", label: "Lvl", w: 45, group: "position" },
    { key: "_fv", label: "FV", w: 60, group: "value", align: "right" },
    { key: "_currentVal", label: "WAR", w: 65, group: "value", align: "right" },
    { key: "_baseVal", label: "WAR P", w: 65, group: "value", align: "right" },
    { key: "_dollarVal", label: "$ Val", w: 55, group: "contract", align: "right" },
  ];
  const cell = cellStyles(cols);
  const sortedLabel = cols.find((c) => c.key === sort.col)?.label;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Config Section */}
      <Section title="Prospect Board Configuration"
        state={`${FV_TIERS.length} tiers · ${prospectPool.length.toLocaleString()} prospects`}
        actions={
          <>
            <button onClick={() => setConfigOpen(!configOpen)} style={S.btn} aria-expanded={configOpen}>
              {configOpen ? "Hide Config" : "Show Config"}
            </button>
            <button onClick={() => {
              const suggested = suggestThresholds(prospectPool, data.teams.length);
              setThresholds(suggested);
            }} style={{ ...S.btn, ...S.btnPrimary }}>
              Suggest Thresholds
            </button>
            <button onClick={() => {
              const dv = {};
              FV_TIERS.forEach((t) => { dv[t.id] = { bat: t.defaultBat, pit: t.defaultPit }; });
              setDollarValues(dv);
            }} style={S.btn}>
              Reset $ Defaults
            </button>
          </>
        }
        footer={configOpen ? `${prospectPool.length} total prospects across ${data.teams.length} teams` : null}>
        {configOpen ? (
          <div style={edgeWrap}>
            <table style={S.table}>
              <thead><tr>
                {cfgCols.map((c) => (
                  <th key={c.key} style={{ ...S.th, ...cfgCell[c.key], width: c.w, ...(c.align ? { textAlign: c.align } : {}) }} title={c.title}>{c.label}</th>
                ))}
              </tr></thead>
              <tbody>
                {FV_TIERS.map((tier, ti) => {
                  const ts = tierStats[tier.id];
                  const thresh = thresholds[tier.id];
                  const mlbCount = countMlbAtOrAbove(thresh);
                  return (
                    <tr key={tier.id} style={ti % 2 === 1 ? S.zebraRow : undefined}>
                      <td style={{ ...S.td, ...cfgCell.tier }}>
                        <span style={tierPill(tier.id)}>{tier.label}</span>
                      </td>
                      <td style={{ ...S.td, ...cfgCell.thresh, textAlign: "center" }}>
                        <input type="number" step="0.1" value={thresh ?? ""} onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) setThresholds((prev) => ({ ...prev, [tier.id]: v }));
                        }} style={cfgInputStyle} aria-label={`FV threshold for tier ${tier.label}`} />
                      </td>
                      <td style={{ ...S.td, ...cfgCell.bat, textAlign: "center" }}>
                        <input type="number" step="0.5" value={dollarValues[tier.id]?.bat ?? 0} onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) setDollarValues((prev) => ({ ...prev, [tier.id]: { ...prev[tier.id], bat: v } }));
                        }} style={cfgInputStyle} aria-label={`Batter dollar value for tier ${tier.label}`} />
                      </td>
                      <td style={{ ...S.td, ...cfgCell.pit, textAlign: "center" }}>
                        <input type="number" step="0.5" value={dollarValues[tier.id]?.pit ?? 0} onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) setDollarValues((prev) => ({ ...prev, [tier.id]: { ...prev[tier.id], pit: v } }));
                        }} style={cfgInputStyle} aria-label={`Pitcher dollar value for tier ${tier.label}`} />
                      </td>
                      <td style={{ ...S.td, ...cfgCell.count, ...numCell, fontWeight: 600, color: ts.count > 0 ? T.text : T.textDisabled }}>{ts.count}</td>
                      <td style={{ ...S.td, ...cfgCell.hit, ...numCell, color: ts.hit > 0 ? T.CHART.series1 : T.textDisabled }}>{ts.hit}</td>
                      <td style={{ ...S.td, ...cfgCell.pitc, ...numCell, color: ts.pit > 0 ? T.CHART.series3 : T.textDisabled }}>{ts.pit}</td>
                      <td style={{ ...S.td, ...cfgCell.cum, ...numCell, color: T.text3 }}>{ts.cumulative}</td>
                      <td style={{ ...S.td, ...cfgCell.range, color: ts.count > 0 ? T.text3 : T.textDisabled, fontSize: 12 }}>
                        {ts.count > 0 ? `${fmt(ts.minFV)}–${fmt(ts.maxFV)}` : "—"}
                      </td>
                      <td style={{ ...S.td, ...cfgCell.mlb, ...numCell, color: mlbCount == null ? T.textDisabled : T.text2, fontSize: 12 }}>
                        {mlbCount == null ? "—" : `${mlbCount} of ${mlbWAR.length}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: T.text2 }}>
            Tier thresholds and per-tier $ values are hidden — <span style={{ color: T.text3 }}>Show Config to edit.</span>
          </div>
        )}
      </Section>

      {/* Filter Bar + Table */}
      <Section title="The Board" count={`(${displayPool.length.toLocaleString()})`}
        state={sortedLabel ? `Sorted by ${sortedLabel}, ${sort.dir === "asc" ? "ascending" : "descending"}` : null}
        toolbar={
          <>
            <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
            <MultiSelectDropdown
              options={data.teams.map((t) => ({ value: t, label: t }))}
              value={orgFilter} onChange={(v) => { setOrgFilter(v); setPage(0); }}
              placeholder="All Teams" ariaLabel="Filter by team"
            />
            <LevelFilter players={prospectPool} value={levelFilter} onChange={(v) => { setLevelFilter(v); setPage(0); }} expandRookieTeams={false} />
            <MultiSelectDropdown
              options={FV_TIERS.map((t) => ({ value: t.id, label: t.label }))}
              value={tierFilter} onChange={(v) => { setTierFilter(v); setPage(0); }}
              placeholder="All Tiers" ariaLabel="Filter by tier"
            />
            <SearchInput type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} aria-label="Search prospects by name" />
          </>
        }>
        <div style={edgeWrap}>
          <table style={S.table}>
            <thead><tr>
              {cols.map((c) => (
                <SortHeader key={c.key} label={c.label} width={c.w} sortCol={sort.col} sortDir={sort.dir} colKey={c.key} rule={cell[c.key]} align={c.align}
                  onClick={() => setSort((prev) => ({ col: c.key, dir: prev.col === c.key && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => (
                  <tr key={p._uid || (p.ID + "-" + i)} style={i % 2 === 1 ? S.zebraRow : undefined}>
                    <td style={{ ...S.td, ...cell._overallRank, ...numCell, color: T.text, fontWeight: 700 }}>{p._overallRank}</td>
                    <td style={{ ...S.td, ...cell._orgRank, ...numCell, color: T.text3 }}>{p._orgRank}</td>
                    <td style={{ ...S.td, ...cell._tierId }}>
                      <span style={tierPill(p._tierId)}>{p._tierId}</span>
                    </td>
                    <td style={{ ...S.td, ...S.tdName, ...cell.Name, minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                    <td style={{ ...S.td, ...cell.Age, ...numCell }}>{fmtAge(p._age)}</td>
                    <td style={{ ...S.td, ...cell._devPct, ...numCell, ...(p._devPct != null ? devPctStyle(p._devPct) : { color: T.textDisabled }) }}>
                      {p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}
                    </td>
                    <td style={{ ...S.td, ...cell.POS, ...posCell, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                    <td style={{ ...S.td, ...cell._bestPos, ...posCell, color: p._bestPos ? posColor(p._bestPos?.replace("*", "")) : T.textDisabled }}>{p._bestPos || "—"}</td>
                    <td style={{ ...S.td, ...cell.ORG }}>{orgLabel(p)}</td>
                    <td style={{ ...S.td, ...cell.Lev }}>{(p.meta?.lev ?? p.Lev) ? <span style={levelBadge(p.meta?.lev ?? p.Lev)}>{p.meta?.lev ?? p.Lev}</span> : <span style={{ color: T.textDisabled }}>—</span>}</td>
                    <td style={{ ...S.td, ...cell._fv, ...numCell, ...warStyle(p._fv ?? p._baseVal) }}>{fmt(p._fv ?? p._baseVal)}</td>
                    <td style={{ ...S.td, ...cell._currentVal, ...numCell, ...warStyle(p._currentVal) }}>{fmt(p._currentValDisplay ?? p._currentVal)}</td>
                    <td style={{ ...S.td, ...cell._baseVal, ...numCell, ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>
                    <td style={{ ...S.td, ...cell._dollarVal, ...numCell, color: p._dollarVal > 0 ? T.warn : T.textDisabled, fontWeight: 600 }}>{p._dollarVal > 0 ? `$${fmt(p._dollarVal, 1)}M` : "—"}</td>
                  </tr>
              ))}
              {paged.length === 0 && <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: "center", color: T.text3 }}>No prospects found</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={footWrap}>
          <Pagination page={page} totalPages={totalPages} total={displayPool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
        </div>
      </Section>
    </div>
  );
}

function FarmStackedTooltip({ active, payload, label, playersByTeamTier, hoveredTier }) {
  if (!active || !payload || !payload.length || !hoveredTier) return null;
  const tierId = hoveredTier;
  const players = playersByTeamTier?.[label]?.[tierId] || [];
  const tierEntry = payload.find((p) => p.dataKey === `tier_${tierId}`);
  const tierValue = tierEntry?.value ?? 0;
  if (tierValue === 0 && players.length === 0) return null;
  return (
    <div style={{ background: T.CHART.tooltipBg, border: `1px solid ${T.CHART.tooltipBorder}`, borderRadius: T.radius, padding: "10px 14px", fontSize: 12, color: T.CHART.tooltipText, maxWidth: 280 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2, fontFamily: T.fonts.narrow }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={tierPill(tierId)}>FV {tierId}</span>
        <span style={{ color: T.warn, fontWeight: 600 }}>${fmt(tierValue, 1)}M</span>
        <span style={{ color: T.text3 }}>{players.length} player{players.length !== 1 ? "s" : ""}</span>
      </div>
      {players.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6, color: T.text2, paddingLeft: 4 }}>
          <span style={{ color: T.text, fontWeight: 500, minWidth: 110 }}>{p.name}</span>
          <span style={{ color: posColor(p.pos), minWidth: 24, fontFamily: T.fonts.narrow, fontWeight: 600 }}>{p.pos}</span>
          <span style={{ color: T.text3, fontVariantNumeric: "tabular-nums" }}>{fmt(p.fv)}</span>
        </div>
      ))}
    </div>
  );
}

function FarmRankings({ data, prospectPool, thresholds, dollarValues, onNavigate }) {
  const [sort, setSort] = useState({ col: "totalValue", dir: "desc" });
  const [hoveredTier, setHoveredTier] = useState(null);

  const rankings = useMemo(() => {
    return calcFarmRankings(prospectPool, thresholds, dollarValues, data.teams);
  }, [prospectPool, thresholds, dollarValues, data.teams]);

  // Build player lists by team+tier and stacked chart data
  const { chartData, playersByTeamTier } = useMemo(() => {
    // Build lookup: team -> tier -> player list
    const lookup = {};
    data.teams.forEach((t) => { lookup[t] = {}; FV_TIERS.forEach((tier) => { lookup[t][tier.id] = []; }); });
    prospectPool.forEach((p) => {
      const org = p.meta?.org ?? p.ORG;
      if (!org || org === "-" || org === "0" || !lookup[org]) return;
      const fv = p._fv ?? p._baseVal ?? 0;
      const tierId = assignFVTier(fv, thresholds);
      if (!tierId) return;
      lookup[org][tierId].push({ name: p.meta?.name ?? p.Name, pos: p._bestPos || p.meta?.pos || p.POS, fv, type: p._poolType });
    });
    // Sort players within each tier by FV desc
    Object.values(lookup).forEach((tiers) => {
      Object.values(tiers).forEach((arr) => arr.sort((a, b) => b.fv - a.fv));
    });

    // Build chart data sorted by total value desc
    const sorted = [...rankings].sort((a, b) => b.totalValue - a.totalValue);
    const cd = sorted.map((r) => {
      const row = { team: r.team };
      FV_TIERS.forEach((t) => {
        // Sum dollar values for this team+tier
        const players = lookup[r.team]?.[t.id] || [];
        let tierVal = 0;
        players.forEach((p) => {
          tierVal += getDollarValue(t.id, p.type, dollarValues);
        });
        row[`tier_${t.id}`] = Math.round(tierVal * 10) / 10;
      });
      return row;
    });
    return { chartData: cd, playersByTeamTier: lookup };
  }, [rankings, prospectPool, thresholds, dollarValues, data.teams]);

  const sortedRankings = useMemo(() => {
    const rows = [...rankings];
    const { col, dir } = sort;
    rows.sort((a, b) => {
      let va, vb;
      if (col === "team") { va = a.team; vb = b.team; }
      else if (col.startsWith("tier_")) {
        const tid = col.replace("tier_", "");
        va = a.tierCounts[tid] || 0; vb = b.tierCounts[tid] || 0;
      }
      else { va = a[col]; vb = b[col]; }
      if (typeof va === "string") return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return dir === "asc" ? (va ?? 0) - (vb ?? 0) : (vb ?? 0) - (va ?? 0);
    });
    return rows;
  }, [rankings, sort]);

  const doSort = (col) => setSort((prev) => ({ col, dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc" }));
  const clickStyle = { cursor: "pointer", textDecoration: "none", borderBottom: "1px dashed currentColor" };

  // Farm columns — groups: # Team | Value #P Avg | tier counts | Ceil Floor Bat Pit | Report (§B.3 item 8).
  const cols = [
    { key: "rank", label: "#", w: 35, group: "identity", align: "right" },
    { key: "team", label: "Team", w: 110, group: "identity" },
    { key: "totalValue", label: "Value", w: 65, group: "value", align: "right" },
    { key: "count", label: "#P", w: 35, group: "value", align: "right" },
    { key: "avgValue", label: "Avg", w: 50, group: "value", align: "right" },
    ...FV_TIERS.map((t) => ({ key: `tier_${t.id}`, label: t.label, w: 35, group: "tiers", align: "right" })),
    { key: "ceiling", label: "Ceil", w: 40, group: "scouting", align: "right" },
    { key: "floor", label: "Floor", w: 42, group: "scouting", align: "right" },
    { key: "batting", label: "Bat", w: 38, group: "scouting", align: "right" },
    { key: "pitching", label: "Pit", w: 38, group: "scouting", align: "right" },
    { key: "report", label: "Scouting Report", w: 260, group: "report" },
  ];
  const cell = cellStyles(cols);
  const sortedLabel = cols.find((c) => c.key === sort.col)?.label;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Rankings Table */}
      <Section title="Farm System Rankings" count={`(${sortedRankings.length})`}
        state={sortedLabel ? `Sorted by ${sortedLabel}, ${sort.dir === "asc" ? "ascending" : "descending"}` : null}
        footer="Click a team or a tier count to open it on the Board.">
        <div style={edgeWrap}>
          <table style={S.table}>
            <thead><tr>
              {cols.map((c) => (
                <SortHeader key={c.key} label={c.label} width={c.w} sortCol={sort.col} sortDir={sort.dir} colKey={c.key} rule={cell[c.key]} align={c.align}
                  onClick={() => doSort(c.key)} />
              ))}
            </tr></thead>
            <tbody>
              {sortedRankings.map((r, i) => (
                <tr key={r.team} style={i % 2 === 1 ? S.zebraRow : undefined}>
                  <td style={{ ...S.td, ...cell.rank, ...numCell, color: T.text3, fontWeight: 600 }}>{r.rank}</td>
                  <td style={{ ...S.td, ...cell.team, fontWeight: 600, color: T.accent }}>
                    <span style={clickStyle} onClick={() => onNavigate(r.team, null)}>{r.team}</span>
                  </td>
                  <td style={{ ...S.td, ...cell.totalValue, ...numCell, color: T.warn, fontWeight: 700 }}>${fmt(r.totalValue, 1)}M</td>
                  <td style={{ ...S.td, ...cell.count, ...numCell }}>{r.count}</td>
                  <td style={{ ...S.td, ...cell.avgValue, ...numCell, color: T.text2 }}>${fmt(r.avgValue, 1)}</td>
                  {FV_TIERS.map((t) => {
                    const cnt = r.tierCounts[t.id] || 0;
                    return (
                      <td key={t.id} style={{ ...S.td, ...cell[`tier_${t.id}`], ...numCell, color: cnt > 0 ? FV_TIER_COLORS[t.id].bg : T.textDisabled, fontWeight: cnt > 0 ? 600 : 400 }}>
                        {cnt > 0 ? (
                          <span style={clickStyle} onClick={() => onNavigate(r.team, t.id)}>{cnt}</span>
                        ) : 0}
                      </td>
                    );
                  })}
                  <td style={{ ...S.td, ...cell.ceiling, ...numCell, color: scoutingRatingColor(r.ceiling), fontWeight: 600 }}>{r.ceiling}</td>
                  <td style={{ ...S.td, ...cell.floor, ...numCell, color: scoutingRatingColor(r.floor), fontWeight: 600 }}>{r.floor}</td>
                  <td style={{ ...S.td, ...cell.batting, ...numCell, color: scoutingRatingColor(r.batting), fontWeight: 600 }}>{r.batting}</td>
                  <td style={{ ...S.td, ...cell.pitching, ...numCell, color: scoutingRatingColor(r.pitching), fontWeight: 600 }}>{r.pitching}</td>
                  <td style={{ ...S.td, ...cell.report, fontSize: 12, color: T.text2, whiteSpace: "normal", maxWidth: 260, height: "auto", padding: "5px 12px 5px 6px", lineHeight: 1.35 }}>{r.report}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Stacked Bar Chart */}
      <Section title="Farm System Values" state="System value ($M) by FV tier"
        footer={
          <span style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {FV_TIERS.map((t) => (
              <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: T.radius, background: FV_TIER_COLORS[t.id].bg, display: "inline-block" }} />
                <span style={{ color: T.text2 }}>{t.label}</span>
              </span>
            ))}
          </span>
        }>
        <div style={{ width: "100%", height: 420, overflowX: "auto" }}>
          <div style={{ width: Math.max(chartData.length * 50, 600), height: 400 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.CHART.grid} vertical={false} />
                <XAxis dataKey="team" tick={{ fill: T.CHART.axis, fontSize: 10 }} angle={-45} textAnchor="end" interval={0} height={60} />
                <YAxis tick={{ fill: T.CHART.axis, fontSize: 11 }} label={{ value: "System Value ($M)", angle: -90, position: "insideLeft", fill: T.CHART.axis, fontSize: 11 }} />
                <Tooltip content={<FarmStackedTooltip playersByTeamTier={playersByTeamTier} hoveredTier={hoveredTier} />} cursor={{ fill: T.panel3 }} />
                {[...FV_TIERS].reverse().map((t) => (
                  <Bar key={t.id} dataKey={`tier_${t.id}`} stackId="value" fill={FV_TIER_COLORS[t.id].bg} name={`FV ${t.label}`}
                    onMouseEnter={() => setHoveredTier(t.id)} onMouseLeave={() => setHoveredTier(null)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Section>
    </div>
  );
}

export default ProspectsView;
