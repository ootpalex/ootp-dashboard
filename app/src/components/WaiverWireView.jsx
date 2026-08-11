import { useState, useMemo } from "react";
import { S } from "../theme.js";
import { posColor, levelColor, proneColor, warStyle, devPctColor } from "../theme.js";
import { fmt, fmtAge, paginateRows, rankSuffix } from "../utils/helpers.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { calcOrgNeed } from "../utils/strength.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, PositionFilter, Toggle, TwoWayBadge, Pagination } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import PositionalStrengthTable from "../views/Org/PositionalStrengthTable.jsx";
import {
  hasLiveWaiverSource,
  waiverSource,
  waiverFields,
  isClaimable,
  fortyManSpots,
  WAIVER_LIVE,
  WAIVER_EXPORT,
} from "../utils/waivers.js";

// Claims are decided on the MLB roster, so needs are read off the "Now" pool —
// same convention as the Free Agent Finder.
const STRENGTH_MODE = "now";

const SORT_COLS = {
  _fv: (p) => p._fv,
  _waiverDaysLeft: (p) => p._waiverDaysLeft,
  _opt: (p) => p.meta?.opt ?? null,
  _yl: (p) => p.meta?.yl ?? null,
};

const fmtStamp = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

function WaiverTable({ rows, sort, setSort, onSelectPlayer, weakPositions, myTeam, anyToggle, showClock, emptyText }) {
  const cols = [
    { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70 },
    { key: "Name", label: "Name", w: 170 },
    { key: "Age", label: "Age", w: 45 },
    { key: "POS", label: "POS", w: 55 },
    { key: "_bestPos", label: "Best", w: 48 },
    { key: "ORG", label: "From", w: 130 },
    { key: "Lev", label: "Lvl", w: 45 },
    ...(showClock ? [{ key: "_waiverDaysLeft", label: "Left", w: 45 }] : []),
    { key: "_fv", label: "FV", w: 60 },
    { key: "_currentVal", label: "WAR", w: 65 },
    { key: "_baseVal", label: "WAR P", w: 65 },
    { key: "_devPct", label: "Dev%", w: 48 },
    { key: "Price", label: "Salary", w: 85 },
    { key: "_yl", label: "Yrs", w: 80 },
    { key: "_opt", label: "Opt", w: 40 },
    { key: "Prone", label: "Prone", w: 65 },
  ];

  return (
    <div style={S.tableWrap}>
      <table style={S.table}>
        <thead><tr>
          {cols.map(({ key, label, w }) => (
            <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key}
              onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
          ))}
        </tr></thead>
        <tbody>
          {rows.map((p, i) => {
            const pos = p.meta?.pos ?? p.POS;
            const isWeak = weakPositions.has(pos);
            const isMine = (p.meta?.org ?? p.ORG) === myTeam;
            return (
              <tr key={(p.id ?? p._uid ?? p.meta?.name) + "-" + i}
                  style={{ background: isWeak ? "rgba(239,68,68,0.04)" : i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                <td style={{ ...S.td, ...warStyle(p._rank), fontWeight: 700 }}>{fmt(p._rank)}</td>
                <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                    onClick={() => onSelectPlayer?.(p)}>
                  {p.meta?.name ?? p.Name}
                  <TwoWayBadge player={p} />
                  {isMine && (
                    <span title="Your own player — you can't claim him, but he can be claimed away"
                      style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, marginLeft: 4, fontWeight: 700,
                        background: "rgba(148,163,184,0.15)", color: "#94a3b8" }}>YOURS</span>
                  )}
                </td>
                <td style={S.td}>{fmtAge(p._age)}</td>
                <td style={{ ...S.td, color: posColor(pos) }}>
                  {pos}
                  {isWeak && !isMine && <span style={{ color: "#f87171", marginLeft: 4, fontSize: 9 }}>NEED</span>}
                </td>
                <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                <td style={{ ...S.td, color: "#cbd5e1", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>{p.meta?.org ?? p.ORG}</td>
                <td style={{ ...S.td, color: levelColor(p.meta?.lev ?? p.Lev) }}>{p.meta?.lev ?? p.Lev}</td>
                {showClock && (
                  <td style={{ ...S.td, fontWeight: 600,
                    color: p._waiverDaysLeft == null ? "#475569" : p._waiverDaysLeft === 0 ? "#64748b" : p._waiverDaysLeft <= 1 ? "#f87171" : "#e2e8f0" }}
                      title={p._waiverDaysLeft === 0
                        ? "Cleared waivers — can no longer be claimed"
                        : "In-game days left on the claim clock, per StatsPlus"}>
                    {p._waiverDaysLeft == null ? "—" : p._waiverDaysLeft === 0 ? "cleared" : `${p._waiverDaysLeft}d`}
                  </td>
                )}
                <td style={{ ...S.td, ...warStyle(p._fv) }}>{fmt(p._fv)}</td>
                <td style={{ ...S.td, ...warStyle(p._currentVal) }}>{fmt(p._currentValDisplay ?? p._currentVal)}</td>
                <td style={{ ...S.td, ...(p._matured ? { color: "#475569" } : warStyle(p._baseVal)) }}>{p._matured ? "—" : fmt(p._baseValDisplay ?? p._baseVal)}</td>
                <td style={{ ...S.td, color: p._devPct != null ? devPctColor(p._devPct) : "#475569", fontWeight: p._devPct != null ? 600 : 400 }}>{p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}</td>
                <td style={{ ...S.td, color: "#94a3b8" }}>{p._price != null ? "$" + p._price.toLocaleString() : "—"}</td>
                <td style={{ ...S.td, color: "#94a3b8" }}>{p.meta?.yl || "—"}</td>
                <td style={{ ...S.td, color: "#94a3b8" }}>{p.meta?.opt ?? "—"}</td>
                <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: "center", color: "#475569", padding: "16px 8px" }}>{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function WaiverWireView({ data, myTeam, strength, curveSettings, dashMeta, onSelectPlayer }) {
  const [toggles, setToggles] = useState({ orgNeed: false, devAdj: false, injury: false, intangibles: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState([]);
  const [sort, setSort] = useState({ col: "_fv", dir: "desc" });
  const [page, setPage] = useState(0);
  const [clearedPage, setClearedPage] = useState(0);
  const [stalePage, setStalePage] = useState(0);

  const debouncedSearch = useDebouncedValue(search);
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.injury || toggles.intangibles;

  const liveAvailable = useMemo(() => hasLiveWaiverSource(data), [data]);
  const extras = useMemo(() => waiverFields(liveAvailable), [liveAvailable]);

  // A player with 0 days left has CLEARED — still flagged on waivers by
  // StatsPlus, but no longer claimable, so he's split off the claim board.
  const livePool = useMemo(() => {
    const f = (p) => waiverSource(p, liveAvailable) === WAIVER_LIVE && isClaimable(p);
    return buildBoardPool(data, f, f, extras);
  }, [data, liveAvailable, extras]);

  const clearedPool = useMemo(() => {
    const f = (p) => waiverSource(p, liveAvailable) === WAIVER_LIVE && !isClaimable(p);
    return buildBoardPool(data, f, f, extras);
  }, [data, liveAvailable, extras]);

  const stalePool = useMemo(() => {
    const f = (p) => waiverSource(p, liveAvailable) === WAIVER_EXPORT;
    return buildBoardPool(data, f, f, extras);
  }, [data, liveAvailable, extras]);

  const orgNeed = useMemo(() => myTeam ? calcOrgNeed(myTeam, strength, STRENGTH_MODE) : null, [myTeam, strength]);
  const teamZ = strength.zScores?.[STRENGTH_MODE]?.[myTeam] || {};
  const weakPositions = useMemo(
    () => new Set(POT_DISPLAY_POS.filter((pos) => (teamZ[pos] ?? 0) < 0)),
    [teamZ],
  );

  const liveRows = useMemo(() =>
    buildDisplayPool(livePool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings, null, SORT_COLS),
    [livePool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings]);
  const clearedRows = useMemo(() =>
    buildDisplayPool(clearedPool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings, null, SORT_COLS),
    [clearedPool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings]);
  const staleRows = useMemo(() =>
    buildDisplayPool(stalePool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings, null, SORT_COLS),
    [stalePool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings]);

  const { paged, totalPages } = paginateRows(liveRows, page, PER_PAGE);
  const { paged: clearedPaged, totalPages: clearedTotalPages } = paginateRows(clearedRows, clearedPage, PER_PAGE);
  const { paged: stalePaged, totalPages: staleTotalPages } = paginateRows(staleRows, stalePage, PER_PAGE);

  const spots = useMemo(() => fortyManSpots(data, myTeam), [data, myTeam]);
  const fetchedAt = fmtStamp(dashMeta?.generatedAt);
  const gameDate = dashMeta?.gameDate;
  const fillsNeed = liveRows.filter((p) => weakPositions.has(p.meta?.pos ?? p.POS) && (p.meta?.org ?? p.ORG) !== myTeam).length;

  // Live board title/subtext depend on whether StatsPlus ran for this league.
  // With no live source, the CSV column is all there is — say so plainly rather
  // than implying a freshness the data doesn't have.
  const boardTitle = liveAvailable ? `Claimable Now (${liveRows.length})` : `On Waivers — last CSV export (${staleRows.length})`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Freshness strip — waivers clear in ~3 in-game days, which makes this
          the most perishable data in the dashboard. Always show the as-of. */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
        background: "rgba(15,23,42,0.4)", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 16px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
          <span style={{ color: liveAvailable ? "#34d399" : "#fbbf24", fontWeight: 700 }}>
            {liveAvailable ? "STATSPLUS LIVE" : "CSV EXPORT ONLY"}
          </span>
          <span style={{ color: "#475569" }}> · </span>
          {liveAvailable
            ? <>fetched {fetchedAt || "—"}{gameDate ? ` · league date ${gameDate}` : ""}</>
            : <>no StatsPlus URL configured — waiver status is as of your last <code style={{ color: "#cbd5e1" }}>org.csv</code> export</>}
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#94a3b8" }}>
          {fillsNeed > 0 && (
            <span><span style={{ color: "#f87171", fontWeight: 700 }}>{fillsNeed}</span> at a position you're below average in</span>
          )}
          <span title="A claim costs a 40-man spot">
            40-man: <span style={{ color: spots.open === 0 ? "#f87171" : "#e2e8f0", fontWeight: 700 }}>{spots.used}/{spots.limit}</span>
            {spots.open > 0 ? ` — ${spots.open} open` : " — full"}
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "stretch" }}>
        <Section title="My Positional Needs">
          <PositionalStrengthTable team={myTeam} strength={strength} mode={STRENGTH_MODE} sort="weakest" dense />
          <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
            Sorted weakest to strongest. Rows on the wire at a below-average position are flagged NEED.
          </div>
        </Section>

        <Section title="Smart Rank Adjustments">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Toggle label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
            <Toggle label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
            <Toggle label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
            <Toggle label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
          </div>
        </Section>
      </div>

      <Section title={boardTitle}>
        <div style={{ marginBottom: 12 }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); setClearedPage(0); setStalePage(0); }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="text" placeholder="Search name..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); setClearedPage(0); setStalePage(0); }} style={S.searchInput} />
        </div>

        {liveAvailable ? (
          <>
            <WaiverTable rows={paged} sort={sort} setSort={setSort} onSelectPlayer={onSelectPlayer}
              weakPositions={weakPositions} myTeam={myTeam} anyToggle={anyToggle} showClock
              emptyText={`Nobody claimable as of ${gameDate || "the last pipeline run"}.`} />
            <Pagination page={page} totalPages={totalPages} total={liveRows.length}
              onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
          </>
        ) : (
          <>
            <WaiverTable rows={stalePaged} sort={sort} setSort={setSort} onSelectPlayer={onSelectPlayer}
              weakPositions={weakPositions} myTeam={myTeam} anyToggle={anyToggle} showClock={false}
              emptyText="Nobody was on waivers in your last org.csv export." />
            <Pagination page={stalePage} totalPages={staleTotalPages} total={staleRows.length}
              onPrev={() => setStalePage(Math.max(0, stalePage - 1))} onNext={() => setStalePage(Math.min(staleTotalPages - 1, stalePage + 1))} />
          </>
        )}
      </Section>

      {/* Still flagged on waivers by StatsPlus, but the clock has run out — the
          player cleared and can no longer be claimed. Kept visible because his
          org's next move (outright / release) is worth watching. */}
      {liveAvailable && clearedRows.length > 0 && (
        <Section title={`Cleared Waivers — no longer claimable (${clearedRows.length})`}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, lineHeight: 1.6 }}>
            Zero days left on the clock: these players went unclaimed and cleared. Their org can now outright or release them.
          </div>
          <WaiverTable rows={clearedPaged} sort={sort} setSort={setSort} onSelectPlayer={onSelectPlayer}
            weakPositions={weakPositions} myTeam={myTeam} anyToggle={anyToggle} showClock
            emptyText="None." />
          <Pagination page={clearedPage} totalPages={clearedTotalPages} total={clearedRows.length}
            onPrev={() => setClearedPage(Math.max(0, clearedPage - 1))} onNext={() => setClearedPage(Math.min(clearedTotalPages - 1, clearedPage + 1))} />
        </Section>
      )}

      {/* Rows the CSV still calls waived but StatsPlus doesn't. Almost always
          players whose waiver stint resolved after the export was taken. */}
      {liveAvailable && staleRows.length > 0 && (
        <Section title={`From Your Last CSV Export — may be stale (${staleRows.length})`}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, lineHeight: 1.6 }}>
            Flagged <code style={{ color: "#cbd5e1" }}>WAIV</code> in <code style={{ color: "#cbd5e1" }}>org.csv</code> but
            not on waivers per StatsPlus. Waivers clear in ~3 in-game days, so these have most likely already been claimed or
            cleared. Re-export <code style={{ color: "#cbd5e1" }}>org.csv</code> and rerun the pipeline to refresh.
          </div>
          <WaiverTable rows={stalePaged} sort={sort} setSort={setSort} onSelectPlayer={onSelectPlayer}
            weakPositions={weakPositions} myTeam={myTeam} anyToggle={anyToggle} showClock={false}
            emptyText="None." />
          <Pagination page={stalePage} totalPages={staleTotalPages} total={staleRows.length}
            onPrev={() => setStalePage(Math.max(0, stalePage - 1))} onNext={() => setStalePage(Math.min(staleTotalPages - 1, stalePage + 1))} />
        </Section>
      )}
    </div>
  );
}
