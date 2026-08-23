import { useState, useMemo } from "react";
import { TOKENS as T, S } from "../theme.js";
import { posColor, proneColor, PRONE, warStyle, devPctStyle } from "../theme.js";
import { fmt, fmtAge, num, isTrueFA, rankSuffix, searchFilter, paginateRows } from "../utils/helpers.js";
import { getMaxWar, getMaxWarP, genericSort, pickPitcherRole, pickFielderPos, passesPositionFilter, INF_POSITIONS, OF_POSITIONS } from "../utils/accessors.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { Section, SortHeader, SearchInput, PositionFilter, NumericRangeFilter, Toggle, TwoWayBadge, Pagination, colRule } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import PositionalStrengthTable from "../views/Org/PositionalStrengthTable.jsx";
import { buildBoardPool } from "./boardUtils.js";
import { applySmartRank } from "../utils/futureValue.js";
import { calcOrgNeed } from "../utils/strength.js";

const FAF_PITCHER_FILTER_KEYS = new Set(["Pitchers", "SP", "RP"]);
const FAF_FIELD_FILTER_KEYS = new Set(["C", "1B", "2B", "3B", "SS", "INF", "LF", "CF", "RF", "OF"]);

// Scorecard board grammar (mockup `.board`): column-group left rules via colRule, numeric
// columns right-aligned, first/last cells carry the 12px box padding. `cols[i].group` drives
// the rules; `cols[i].align` the text alignment.
// Edge padding is written as the full `padding` shorthand (S.th / S.td also use the shorthand) so a
// column that moves from first to second place (e.g. when the Smart column appears) never mixes
// shorthand and longhand across renders — React 18 warns on that.
const edgePad = (cols, i, v) => (i === 0 ? { padding: `${v} 6px ${v} 12px` } : i === cols.length - 1 ? { padding: `${v} 12px ${v} 6px` } : {});
const thStyle = (cols, i) => ({ ...(colRule(cols, i) || {}), ...edgePad(cols, i, "6px") });
const tdStyle = (cols, i) => ({ ...S.td, ...(colRule(cols, i) || {}), ...(cols[i].align ? { textAlign: cols[i].align } : {}), ...edgePad(cols, i, "0") });
const posCell = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 13 };
const rowStyle = (i, isWeak) => (isWeak ? (i % 2 === 1 ? { background: T.accentBg2Even } : S.needRow) : (i % 2 === 1 ? S.zebraRow : undefined));

export default function FreeAgentFinder({ data, myTeam, strength, curveSettings, leagueSettings, onSelectPlayer }) {
  const [search, setSearch] = useState("");
  const debouncedFASearch = useDebouncedValue(search);
  const [posFilter, setPosFilter] = useState([]);
  const [gapOnly, setGapOnly] = useState(false);
  const [sort, setSort] = useState({ col: "_fv", dir: "desc" });
  const [page, setPage] = useState(0);
  const [ageRange, setAgeRange] = useState({ min: "", max: "" });
  const [proyRange, setProyRange] = useState({ min: "", max: "" });
  const [toggles, setToggles] = useState({ orgNeed: false, devAdj: false, injury: false, intangibles: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.injury || toggles.intangibles;
  const togglesOn = [toggles.devAdj, toggles.orgNeed, toggles.injury, toggles.intangibles].filter(Boolean).length;

  // FAs target the MLB roster, so positional needs are read off the "Now" pool only.
  const teamZ = strength.zScores.now?.[myTeam] || {};
  const orgNeed = useMemo(() => myTeam ? calcOrgNeed(myTeam, strength, "now") : null, [myTeam, strength]);

  const weakPositions = useMemo(
    () => new Set(POT_DISPLAY_POS.filter((pos) => (teamZ[pos] ?? 0) < 0)),
    [teamZ],
  );

  const iafaTag = leagueSettings?.iafaTag || "IAFA";
  // Smart value display: when the selection narrows to specific field positions
  // (excluding the broad "Hitters"), use max-across-selected; else best/max.
  // Pitcher role hint: only "SP" → 'sp'; only "RP" → 'rp'; else best-of-role.
  const fieldSel = posFilter.filter((s) => FAF_FIELD_FILTER_KEYS.has(s));
  const broadHitterSelected = posFilter.includes("Hitters");
  const useFieldOverride = fieldSel.length > 0 && !broadHitterSelected;
  const pitcherSel = posFilter.filter((s) => FAF_PITCHER_FILTER_KEYS.has(s));
  const pitcherRoleHint = (pitcherSel.length === 1 && pitcherSel[0] === "SP") ? "sp"
    : (pitcherSel.length === 1 && pitcherSel[0] === "RP") ? "rp"
    : "best";
  const devCurves = data.meta?.devCurve ?? null;

  // Enriched base pool via buildBoardPool so each player has _baseVal /
  // _currentVal / _eligiblePositions / _groupFvInputs / _primaryLeaf — the
  // fields applySmartRank needs.
  const enrichedFAPool = useMemo(() => {
    const filter = (p) => isTrueFA(p, iafaTag);
    return buildBoardPool(data, filter, filter);
  }, [data, iafaTag]);

  const faPool = useMemo(() => {
    return enrichedFAPool.map((p) => {
      let war, warP, fv;
      if (p._poolType === "hitter") {
        if (useFieldOverride) {
          const pv = pickFielderPos(p, fieldSel, devCurves?.hit, curveSettings);
          war = pv?.war ?? null; warP = pv?.warP ?? null; fv = pv?.fv ?? null;
        } else {
          war = getMaxWar(p); warP = getMaxWarP(p); fv = p._fv;
        }
      } else {
        const role = pitcherRoleHint === "best"
          ? { war: p._war, warP: p._warP, fv: p._fv, warSort: p._warSort, warPSort: p._warPSort, role: p._role }
          : pickPitcherRole(p, devCurves, curveSettings, pitcherRoleHint);
        war = role.war; warP = role.warP; fv = role.fv;
      }
      // Re-key _baseVal / _currentVal to the (possibly position-overridden)
      // values so the smart-rank formula reflects what the user is filtering for.
      const baseVal = warP ?? 0;
      const currentVal = war ?? 0;
      const rank = anyToggle
        ? applySmartRank({ ...p, _baseVal: baseVal, _currentVal: currentVal }, toggles, orgNeed, curveSettings, null)
        : baseVal;
      return {
        ...p,
        _war: war, _warP: warP, _fv: fv,
        _baseVal: baseVal, _currentVal: currentVal,
        _warSort: war, _warPSort: warP,
        _rank: rank,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichedFAPool, posFilter, curveSettings, devCurves, anyToggle, toggles, orgNeed]);

  const filtered = useMemo(() => {
    const mn = ageRange.min !== "" ? parseFloat(ageRange.min) : null;
    const mx = ageRange.max !== "" ? parseFloat(ageRange.max) : null;
    const pmn = proyRange.min !== "" ? parseFloat(proyRange.min) : null;
    const pmx = proyRange.max !== "" ? parseFloat(proyRange.max) : null;
    const hasSearch = debouncedFASearch && debouncedFASearch.trim();
    let rows = hasSearch ? searchFilter([...faPool], debouncedFASearch) : [...faPool];
    rows = rows.filter((r) => {
      if (!passesPositionFilter(r, posFilter)) return false;
      if (gapOnly) {
        // When the user has narrowed to specific field positions / SP / RP,
        // weak-position check uses those; else falls back to the player's primary pos.
        let isWeak;
        if (fieldSel.length > 0 || pitcherSel.some((s) => s === "SP" || s === "RP")) {
          const expandedWeak = new Set();
          for (const s of fieldSel) {
            if (s === "INF") INF_POSITIONS.forEach((x) => expandedWeak.add(x));
            else if (s === "OF") OF_POSITIONS.forEach((x) => expandedWeak.add(x));
            else expandedWeak.add(s);
          }
          for (const s of pitcherSel) if (s === "SP" || s === "RP") expandedWeak.add(s);
          isWeak = [...expandedWeak].some((p) => weakPositions.has(p));
        } else {
          isWeak = weakPositions.has(r.meta?.pos ?? r.POS);
        }
        if (!isWeak) return false;
      }
      if (mn != null && !isNaN(mn) && (r._age == null || r._age < mn)) return false;
      if (mx != null && !isNaN(mx) && (r._age == null || r._age > mx)) return false;
      if (pmn != null && !isNaN(pmn)) { const v = num(r.meta?.proy ?? r.PROY); if (v == null || v < pmn) return false; }
      if (pmx != null && !isNaN(pmx)) { const v = num(r.meta?.proy ?? r.PROY); if (v == null || v > pmx) return false; }
      return true;
    });
    const { col, dir } = sort;
    genericSort(rows, col, dir, { _war: (p) => p._warSort ?? p._war, _warP: (p) => p._warPSort ?? p._warP, _fv: (p) => p._fv, _devPct: (p) => p._devPct, _rank: (p) => p._rank });
    return rows;
  }, [faPool, debouncedFASearch, posFilter, gapOnly, sort, weakPositions, ageRange, proyRange]);

  const { paged, totalPages } = paginateRows(filtered, page, PER_PAGE);

  // Board columns (B.3 groups: [Smart] | Name Age POS Best | FV WAR WAR P | Dev% Pro Yrs | Prone | Salary).
  const cols = [
    ...(anyToggle ? [{ key: "_rank", label: "Smart", w: 70, group: "rank", align: "right" }] : []),
    { key: "Name", label: "Name", w: 170, group: "identity" },
    { key: "Age", label: "Age", w: 45, group: "identity", align: "right" },
    { key: "POS", label: "POS", w: 48, group: "identity" },
    { key: "_bestPos", label: "Best", w: 48, group: "identity" },
    { key: "_fv", label: "FV", w: 60, group: "value", align: "right" },
    { key: "_war", label: "WAR", w: 65, group: "value", align: "right" },
    { key: "_warP", label: "WAR P", w: 65, group: "value", align: "right" },
    { key: "_devPct", label: "Dev%", w: 48, group: "development", align: "right" },
    { key: "PROY", label: "Pro Yrs", w: 55, group: "development", align: "right" },
    { key: "Prone", label: "Prone", w: 65, group: "health" },
    { key: "Price", label: "Salary", w: 85, group: "contract", align: "right" },
  ];
  const ci = Object.fromEntries(cols.map((c, i) => [c.key, i]));
  const td = (key) => tdStyle(cols, ci[key]);
  const sortedLabel = cols.find((c) => c.key === sort.col)?.label;
  const sortState = sortedLabel ? `Sorted by ${sortedLabel}, ${sort.dir === "desc" ? "descending" : "ascending"}` : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "stretch" }}>
        <Section title="Team Positional Needs" state="z vs league · now"
          footer={<>Sorted weakest to strongest. {weakPositions.size} position{weakPositions.size !== 1 ? "s" : ""} below league average.</>}>
          <PositionalStrengthTable
            team={myTeam}
            strength={strength}
            mode="now"
            sort="weakest"
            dense
          />
        </Section>

        <Section title="Smart Rank Adjustments" state={`${togglesOn} of 4 on`}>
          {/* Ruled toggle rows fill the box edge to edge; the first row's top rule sits on the header rule. */}
          <div style={{ margin: "-13px -12px -12px" }}>
            <Toggle variant="row" label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
            <Toggle variant="row" label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
            <Toggle variant="row" label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
            <Toggle variant="row" label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
          </div>
        </Section>
      </div>

      <Section title="Free Agent Board" count={`(${filtered.length.toLocaleString()})`} state={sortState}
        toolbar={<>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
          <SearchInput type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          <NumericRangeFilter label="Age" value={ageRange} onChange={(v) => { setAgeRange(v); setPage(0); }} step={1} />
          <NumericRangeFilter label="Pro Yrs" value={proyRange} onChange={(v) => { setProyRange(v); setPage(0); }} step={1} />
          <div style={{ marginLeft: "auto" }}>
            <Toggle label="Gap fills only" description="Only positions below league avg" checked={gapOnly} onChange={setGapOnly} />
          </div>
        </>}>
        {/* Table + foot strip run edge to edge inside the box body (the box border is the rule). */}
        <div style={{ margin: -12 }}>
          <div style={{ ...S.tableWrap, border: "none", borderRadius: 0 }}>
            <table style={S.table}>
              <thead><tr>
                {cols.map(({ key, label, w, align }, i) => (
                  <SortHeader key={key} label={label} width={w} align={align} rule={thStyle(cols, i)} sortCol={sort.col} sortDir={sort.dir} colKey={key} onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
                ))}
              </tr></thead>
              <tbody>
                {paged.map((p, i) => {
                  const isWeak = weakPositions.has(p.meta?.pos ?? p.POS);
                  return (
                    <tr key={p.ID + "-" + i} style={rowStyle(i, isWeak)}>
                      {anyToggle && <td style={{ ...td("_rank"), ...warStyle(p._rank), fontWeight: 700 }}>{fmt(p._rank)}</td>}
                      <td style={{ ...td("Name"), ...S.tdName, minWidth: 170, cursor: "pointer" }}
                          onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                      <td style={td("Age")}>{fmtAge(p._age)}</td>
                      <td style={{ ...td("POS"), ...posCell, color: posColor(p.meta?.pos ?? p.POS) }}>
                        {p.meta?.pos ?? p.POS}
                        {isWeak && <i style={S.needTag}>NEED</i>}
                      </td>
                      <td style={{ ...td("_bestPos"), ...posCell, color: p._bestPos ? posColor(p._bestPos?.replace("*", "")) : T.textDisabled }}>{p._bestPos || "—"}</td>
                      <td style={{ ...td("_fv"), ...warStyle(p._fv) }}>{fmt(p._fv)}</td>
                      <td style={{ ...td("_war"), ...warStyle(p._war) }}>{fmt(p._war)}</td>
                      <td style={{ ...td("_warP"), ...(p._matured ? { color: T.textDisabled } : warStyle(p._warP)) }}>{p._matured ? "—" : fmt(p._warP)}</td>
                      <td style={{ ...td("_devPct"), ...(!p._ageMatured && p._devPct != null ? devPctStyle(p._devPct) : { color: T.textDisabled }) }}>{!p._ageMatured && p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}</td>
                      <td style={{ ...td("PROY"), color: (p.meta?.proy ?? p.PROY) ? T.text2 : T.textDisabled }}>{(p.meta?.proy ?? p.PROY) || "—"}</td>
                      <td style={{ ...td("Prone"), color: proneColor(p.meta?.prone ?? p.Prone), fontWeight: PRONE[p.meta?.prone ?? p.Prone]?.weight ?? 400 }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                      <td style={{ ...td("Price"), color: p._price != null ? T.text2 : T.textDisabled }}>{p._price != null ? "$" + p._price.toLocaleString() : "—"}</td>
                    </tr>
                  );
                })}
                {paged.length === 0 && <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: "center", color: T.text3, padding: "16px 12px" }}>No free agents found</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={filtered.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
        </div>
      </Section>
    </div>
  );
}
