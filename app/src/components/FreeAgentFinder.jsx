import { useState, useMemo } from "react";
import { S } from "../theme.js";
import { posColor, proneColor, warStyle, devPctColor, zToColor } from "../theme.js";
import { fmt, fmtAge, num, isTrueFA, rankSuffix, searchFilter, paginateRows } from "../utils/helpers.js";
import { getMaxWar, getMaxWarP, genericSort, pickPitcherRole, pickFielderPos, passesPositionFilter, INF_POSITIONS, OF_POSITIONS } from "../utils/accessors.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { Section, SortHeader, PillBtn, PositionFilter, Toggle, TwoWayBadge, Pagination } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";

const FAF_PITCHER_FILTER_KEYS = new Set(["Pitchers", "SP", "RP"]);
const FAF_FIELD_FILTER_KEYS = new Set(["C", "1B", "2B", "3B", "SS", "INF", "LF", "CF", "RF", "OF"]);

export default function FreeAgentFinder({ data, myTeam, strength, curveSettings, leagueSettings, onSelectPlayer }) {
  const [search, setSearch] = useState("");
  const debouncedFASearch = useDebouncedValue(search);
  const [posFilter, setPosFilter] = useState([]);
  const [gapOnly, setGapOnly] = useState(false);
  const [sort, setSort] = useState({ col: "_fv", dir: "desc" });
  const [page, setPage] = useState(0);
  const [strengthMode, setStrengthMode] = useState("now");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [proyMin, setProyMin] = useState("");
  const [proyMax, setProyMax] = useState("");

  const teamZ = strength.zScores[strengthMode]?.[myTeam] || {};
  const teamRanks = strength.ranks[strengthMode]?.[myTeam] || {};
  const totalTeams = data.teams.length;

  const sortedNeeds = useMemo(() => {
    return POT_DISPLAY_POS
      .map((pos) => ({ pos, z: teamZ[pos] ?? 0, rank: teamRanks[pos] }))
      .sort((a, b) => a.z - b.z);
  }, [teamZ, teamRanks]);

  const weakPositions = useMemo(() => new Set(sortedNeeds.filter((n) => n.z < 0).map((n) => n.pos)), [sortedNeeds]);

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
  const faPool = useMemo(() => {
    const hitters = data.hitters.filter((p) => isTrueFA(p, iafaTag)).map((h) => {
      let war, warP, fv;
      if (useFieldOverride) {
        const pv = pickFielderPos(h, fieldSel, devCurves?.hit, curveSettings);
        war = pv?.war ?? null; warP = pv?.warP ?? null; fv = pv?.fv ?? null;
      } else {
        war = getMaxWar(h); warP = getMaxWarP(h); fv = h._fv;
      }
      return { ...h, _war: war, _warP: warP, _fv: fv, _warSort: war, _warPSort: warP };
    });
    const pitchers = data.pitchers.filter((p) => isTrueFA(p, iafaTag)).map((p) => {
      const role = pitcherRoleHint === "best"
        ? { war: p._war, warP: p._warP, fv: p._fv, warSort: p._warSort, warPSort: p._warPSort, role: p._role }
        : pickPitcherRole(p, devCurves, curveSettings, pitcherRoleHint);
      return {
        ...p,
        _war: role.war, _warP: role.warP, _fv: role.fv,
        _warSort: role.warSort ?? role.war ?? null,
        _warPSort: role.warPSort ?? role.warP ?? null,
        _role: role.role,
      };
    });
    return [...hitters, ...pitchers];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, iafaTag, curveSettings, posFilter, devCurves]);

  const filtered = useMemo(() => {
    const mn = ageMin !== "" ? parseFloat(ageMin) : null;
    const mx = ageMax !== "" ? parseFloat(ageMax) : null;
    const pmn = proyMin !== "" ? parseFloat(proyMin) : null;
    const pmx = proyMax !== "" ? parseFloat(proyMax) : null;
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
    genericSort(rows, col, dir, { _war: (p) => p._warSort ?? p._war, _warP: (p) => p._warPSort ?? p._warP, _fv: (p) => p._fv, _devPct: (p) => p._devPct });
    return rows;
  }, [faPool, debouncedFASearch, posFilter, gapOnly, sort, weakPositions, ageMin, ageMax, proyMin, proyMax]);

  const { paged, totalPages } = paginateRows(filtered, page, PER_PAGE);

  const needsCards = useMemo(() => (
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
  ), [sortedNeeds]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="Team Positional Needs" actions={
        <div style={{ display: "flex", gap: 8 }}>
          {["now", "farm"].map((m) => <PillBtn key={m} active={strengthMode === m} onClick={() => setStrengthMode(m)}>{m === "now" ? "Now (MLB)" : "Farm"}</PillBtn>)}
        </div>
      }>
        {needsCards}
        <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
          Sorted weakest to strongest. {weakPositions.size} position{weakPositions.size !== 1 ? "s" : ""} below league average.
        </div>
      </Section>

      <Section title={`Free Agent Board (${filtered.length})`}>
        <div style={{ marginBottom: 12 }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={S.searchInput} />
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>Age
            <input type="number" placeholder="min" value={ageMin} onChange={(e) => { setAgeMin(e.target.value); setPage(0); }} style={{ ...S.searchInput, width: 52, padding: "4px 6px", fontSize: 11 }} />
            <span>–</span>
            <input type="number" placeholder="max" value={ageMax} onChange={(e) => { setAgeMax(e.target.value); setPage(0); }} style={{ ...S.searchInput, width: 52, padding: "4px 6px", fontSize: 11 }} />
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>Pro Yrs
            <input type="number" placeholder="min" value={proyMin} onChange={(e) => { setProyMin(e.target.value); setPage(0); }} style={{ ...S.searchInput, width: 48, padding: "4px 6px", fontSize: 11 }} />
            <span>–</span>
            <input type="number" placeholder="max" value={proyMax} onChange={(e) => { setProyMax(e.target.value); setPage(0); }} style={{ ...S.searchInput, width: 48, padding: "4px 6px", fontSize: 11 }} />
          </span>
          <Toggle label="Gap fills only" description="Only positions below league avg" checked={gapOnly} onChange={setGapOnly} />
        </div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              {[
                { key: "Name", label: "Name", w: 170 },
                { key: "Age", label: "Age", w: 45 },
                { key: "POS", label: "POS", w: 48 },
                { key: "_bestPos", label: "Best", w: 48 },
                { key: "_fv", label: "FV", w: 60 },
                { key: "_war", label: "WAR", w: 65 },
                { key: "_warP", label: "WAR P", w: 65 },
                { key: "_devPct", label: "Dev%", w: 48 },
                { key: "PROY", label: "Pro Yrs", w: 55 },
                { key: "Prone", label: "Prone", w: 65 },
                { key: "Price", label: "Salary", w: 85 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key} onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => {
                const isWeak = weakPositions.has(p.meta?.pos ?? p.POS);
                return (
                  <tr key={p.ID + "-" + i} style={{ background: isWeak ? "rgba(239,68,68,0.04)" : i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                    <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                    <td style={S.td}>{fmtAge(p._age)}</td>
                    <td style={{ ...S.td, color: posColor(p.meta?.pos ?? p.POS) }}>
                      {p.meta?.pos ?? p.POS}
                      {isWeak && <span style={{ color: "#f87171", marginLeft: 4, fontSize: 9 }}>NEED</span>}
                    </td>
                    <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                    <td style={{ ...S.td, ...warStyle(p._fv) }}>{fmt(p._fv)}</td>
                    <td style={{ ...S.td, ...warStyle(p._war) }}>{fmt(p._war)}</td>
                    <td style={{ ...S.td, ...(p._matured ? { color: "#475569" } : warStyle(p._warP)) }}>{p._matured ? "—" : fmt(p._warP)}</td>
                    <td style={{ ...S.td, color: !p._ageMatured && p._devPct != null ? devPctColor(p._devPct) : "#475569", fontWeight: !p._ageMatured && p._devPct != null ? 600 : 400 }}>{!p._ageMatured && p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}</td>
                    <td style={{ ...S.td, color: "#94a3b8" }}>{(p.meta?.proy ?? p.PROY) || "—"}</td>
                    <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                    <td style={{ ...S.td, color: "#94a3b8" }}>{p._price != null ? "$" + p._price.toLocaleString() : "—"}</td>
                  </tr>
                );
              })}
              {paged.length === 0 && <tr><td colSpan={11} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No free agents found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={filtered.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
    </div>
  );
}
