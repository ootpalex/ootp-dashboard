import { useState, useMemo } from "react";
import { TOKENS as T, S } from "../theme.js";
import { posColor, levelChip, proneColor, PRONE, warStyle, devPctStyle } from "../theme.js";
import { fmt, fmtAge, paginateRows, rankSuffix } from "../utils/helpers.js";
import { POT_DISPLAY_POS, PER_PAGE } from "../utils/constants.js";
import { calcOrgNeed } from "../utils/strength.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, SearchInput, PositionFilter, Toggle, TwoWayBadge, Pagination, colRule } from "./shared.jsx";
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

// Scorecard board grammar (mockup `.board`): column-group left rules via colRule, numeric
// columns right-aligned, first/last cells carry the 12px box padding.
// Edge padding is written as the full `padding` shorthand (S.th / S.td also use the shorthand) so a
// column that moves from first to second place (e.g. when the Smart column appears) never mixes
// shorthand and longhand across renders — React 18 warns on that.
const edgePad = (cols, i, v) => (i === 0 ? { padding: `${v} 6px ${v} 12px` } : i === cols.length - 1 ? { padding: `${v} 12px ${v} 6px` } : {});
const thStyle = (cols, i) => ({ ...(colRule(cols, i) || {}), ...edgePad(cols, i, "6px") });
const tdStyle = (cols, i) => ({ ...S.td, ...(colRule(cols, i) || {}), ...(cols[i].align ? { textAlign: cols[i].align } : {}), ...edgePad(cols, i, "0") });
// Level ladder chip: levelChip() returns { bg, text, border, borderStyle? } (theme keys, not CSS), so map
// them onto S.badge explicitly (full `border` shorthand — no shorthand/longhand mixing).
const levelBadge = (lev) => { const c = levelChip(lev); return { ...S.badge, background: c.bg, color: c.text, border: `1px ${c.borderStyle || "solid"} ${c.border}` }; };
const posCell = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 13 };
const rowStyle = (i, isWeak) => (isWeak ? (i % 2 === 1 ? { background: T.accentBg2Even } : S.needRow) : (i % 2 === 1 ? S.zebraRow : undefined));
// "YOURS" — outlined line2/text2 chip (inventory D.1).
const yoursChip = { ...S.badge, fontSize: 10, lineHeight: "14px", padding: "0 4px", minWidth: 0, background: "transparent", border: `1px solid ${T.line2}`, color: T.text2, marginLeft: 4, verticalAlign: 1 };
// Claim-clock ladder (D.1): null → textDisabled, 0 "cleared" → text3, ≤ 1 day → bad 700, else text.
const clockStyle = (d) => (d == null ? { color: T.textDisabled } : d === 0 ? { color: T.text3 } : d <= 1 ? { color: T.bad, fontWeight: 700 } : { color: T.text });
const mono = { color: T.text, fontWeight: 600 };

function WaiverTable({ rows, sort, setSort, onSelectPlayer, weakPositions, myTeam, anyToggle, showClock, emptyText }) {
  // B.3 groups: Smart/WAR P | Name Age POS Best From Lvl | Left | FV WAR WAR P | Dev% | Salary Yrs Opt | Prone.
  const cols = [
    { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70, group: "rank", align: "right" },
    { key: "Name", label: "Name", w: 170, group: "identity" },
    { key: "Age", label: "Age", w: 45, group: "identity", align: "right" },
    { key: "POS", label: "POS", w: 55, group: "identity" },
    { key: "_bestPos", label: "Best", w: 48, group: "identity" },
    { key: "ORG", label: "From", w: 130, group: "identity" },
    { key: "Lev", label: "Lvl", w: 45, group: "identity" },
    ...(showClock ? [{ key: "_waiverDaysLeft", label: "Left", w: 45, group: "clock", align: "right" }] : []),
    { key: "_fv", label: "FV", w: 60, group: "value", align: "right" },
    { key: "_currentVal", label: "WAR", w: 65, group: "value", align: "right" },
    { key: "_baseVal", label: "WAR P", w: 65, group: "value", align: "right" },
    { key: "_devPct", label: "Dev%", w: 48, group: "development", align: "right" },
    { key: "Price", label: "Salary", w: 85, group: "contract", align: "right" },
    { key: "_yl", label: "Yrs", w: 80, group: "contract" },
    { key: "_opt", label: "Opt", w: 40, group: "contract", align: "right" },
    { key: "Prone", label: "Prone", w: 65, group: "health" },
  ];
  const ci = Object.fromEntries(cols.map((c, i) => [c.key, i]));
  const td = (key) => tdStyle(cols, ci[key]);

  return (
    <div style={{ ...S.tableWrap, border: "none", borderRadius: 0 }}>
      <table style={S.table}>
        <thead><tr>
          {cols.map(({ key, label, w, align }, i) => (
            <SortHeader key={key} label={label} width={w} align={align} rule={thStyle(cols, i)} sortCol={sort.col} sortDir={sort.dir} colKey={key}
              onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
          ))}
        </tr></thead>
        <tbody>
          {rows.map((p, i) => {
            const pos = p.meta?.pos ?? p.POS;
            const isWeak = weakPositions.has(pos);
            const isMine = (p.meta?.org ?? p.ORG) === myTeam;
            const lev = p.meta?.lev ?? p.Lev;
            const prone = p.meta?.prone ?? p.Prone;
            return (
              <tr key={(p.id ?? p._uid ?? p.meta?.name) + "-" + i} style={rowStyle(i, isWeak)}>
                <td style={{ ...td("_rank"), ...warStyle(p._rank), fontWeight: 700 }}>{fmt(p._rank)}</td>
                <td style={{ ...td("Name"), ...S.tdName, minWidth: 170, cursor: "pointer" }}
                    onClick={() => onSelectPlayer?.(p)}>
                  {p.meta?.name ?? p.Name}
                  <TwoWayBadge player={p} />
                  {isMine && (
                    <span title="Your own player — you can't claim him, but he can be claimed away" style={yoursChip}>YOURS</span>
                  )}
                </td>
                <td style={td("Age")}>{fmtAge(p._age)}</td>
                <td style={{ ...td("POS"), ...posCell, color: posColor(pos) }}>
                  {pos}
                  {isWeak && !isMine && <i style={S.needTag}>NEED</i>}
                </td>
                <td style={{ ...td("_bestPos"), ...posCell, color: p._bestPos ? posColor(p._bestPos?.replace("*", "")) : T.textDisabled }}>{p._bestPos || "—"}</td>
                <td style={{ ...td("ORG"), color: T.text, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>{p.meta?.org ?? p.ORG}</td>
                <td style={td("Lev")}>{lev ? <span style={levelBadge(lev)}>{lev}</span> : <span style={{ color: T.textDisabled }}>—</span>}</td>
                {showClock && (
                  <td style={{ ...td("_waiverDaysLeft"), fontWeight: 600, ...clockStyle(p._waiverDaysLeft) }}
                      title={p._waiverDaysLeft === 0
                        ? "Cleared waivers — can no longer be claimed"
                        : "In-game days left on the claim clock, per StatsPlus"}>
                    {p._waiverDaysLeft == null ? "—" : p._waiverDaysLeft === 0 ? "cleared" : `${p._waiverDaysLeft}d`}
                  </td>
                )}
                <td style={{ ...td("_fv"), ...warStyle(p._fv) }}>{fmt(p._fv)}</td>
                <td style={{ ...td("_currentVal"), ...warStyle(p._currentVal) }}>{fmt(p._currentValDisplay ?? p._currentVal)}</td>
                <td style={{ ...td("_baseVal"), ...(p._matured ? { color: T.textDisabled } : warStyle(p._baseVal)) }}>{p._matured ? "—" : fmt(p._baseValDisplay ?? p._baseVal)}</td>
                <td style={{ ...td("_devPct"), ...(p._devPct != null ? devPctStyle(p._devPct) : { color: T.textDisabled }) }}>{p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}</td>
                <td style={{ ...td("Price"), color: p._price != null ? T.text2 : T.textDisabled }}>{p._price != null ? "$" + p._price.toLocaleString() : "—"}</td>
                <td style={{ ...td("_yl"), color: p.meta?.yl ? T.text2 : T.textDisabled }}>{p.meta?.yl || "—"}</td>
                <td style={{ ...td("_opt"), color: p.meta?.opt != null ? T.text2 : T.textDisabled }}>{p.meta?.opt ?? "—"}</td>
                <td style={{ ...td("Prone"), color: proneColor(prone), fontWeight: PRONE[prone]?.weight ?? 400 }}>{prone ?? "—"}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: "center", color: T.text3, padding: "16px 12px" }}>{emptyText}</td></tr>
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
  const togglesOn = [toggles.devAdj, toggles.orgNeed, toggles.injury, toggles.intangibles].filter(Boolean).length;

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
  const boardTitle = liveAvailable ? "Claimable Now" : "On Waivers — last CSV export";
  const boardCount = liveAvailable ? liveRows.length : staleRows.length;

  // Freshness (D.1) — waivers clear in ~3 in-game days, which makes this the most
  // perishable data in the dashboard. The feed status + as-of ride in the claim
  // board's header `state`; the 40-man occupancy sits on the Needs box header.
  const feedState = liveAvailable
    ? <>
        <span style={{ color: T.good, fontWeight: 700 }}>StatsPlus live</span>
        {` · fetched ${fetchedAt || "—"}`}{gameDate ? ` · league date ${gameDate}` : ""}
        {fillsNeed > 0 && <> · <span style={{ color: T.bad, fontWeight: 700 }}>{fillsNeed}</span> at a position you're below average in</>}
      </>
    : <><span style={{ color: T.warn, fontWeight: 700 }}>CSV export only</span> · as of your last org.csv export</>;
  const fortyManState = (
    <span title="A claim costs a 40-man spot">
      40-man: <span style={{ color: spots.open === 0 ? T.bad : T.text, fontWeight: 700 }}>{spots.used}/{spots.limit}</span>
      {spots.open > 0 ? ` — ${spots.open} open` : " — full"}
    </span>
  );

  const toolbar = <>
    <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); setClearedPage(0); setStalePage(0); }} />
    <SearchInput type="text" placeholder="Search name..." value={search}
      onChange={(e) => { setSearch(e.target.value); setPage(0); setClearedPage(0); setStalePage(0); }} />
  </>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "stretch" }}>
        <Section title="My Positional Needs" state={fortyManState}
          footer="Sorted weakest to strongest. Rows on the wire at a below-average position are flagged NEED.">
          <PositionalStrengthTable team={myTeam} strength={strength} mode={STRENGTH_MODE} sort="weakest" dense />
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

      {/* Toolbar lives on the first box only (B.4); the filters apply to all three tables. */}
      <Section title={boardTitle} count={`(${boardCount.toLocaleString()})`} state={feedState} toolbar={toolbar}
        footer={liveAvailable ? undefined : <>No StatsPlus URL configured — waiver status is as of your last <span style={mono}>org.csv</span> export.</>}>
        <div style={{ margin: -12 }}>
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
        </div>
      </Section>

      {/* Still flagged on waivers by StatsPlus, but the clock has run out — the
          player cleared and can no longer be claimed. Kept visible because his
          org's next move (outright / release) is worth watching. */}
      {liveAvailable && clearedRows.length > 0 && (
        <Section title="Cleared Waivers — no longer claimable" count={`(${clearedRows.length.toLocaleString()})`}>
          <div style={{ margin: -12 }}>
            <div style={{ ...S.boxSub, paddingBottom: 10, lineHeight: 1.5 }}>
              Zero days left on the clock: these players went unclaimed and cleared. Their org can now outright or release them.
            </div>
            <WaiverTable rows={clearedPaged} sort={sort} setSort={setSort} onSelectPlayer={onSelectPlayer}
              weakPositions={weakPositions} myTeam={myTeam} anyToggle={anyToggle} showClock
              emptyText="None." />
            <Pagination page={clearedPage} totalPages={clearedTotalPages} total={clearedRows.length}
              onPrev={() => setClearedPage(Math.max(0, clearedPage - 1))} onNext={() => setClearedPage(Math.min(clearedTotalPages - 1, clearedPage + 1))} />
          </div>
        </Section>
      )}

      {/* Rows the CSV still calls waived but StatsPlus doesn't. Almost always
          players whose waiver stint resolved after the export was taken. */}
      {liveAvailable && staleRows.length > 0 && (
        <Section title="From Your Last CSV Export — may be stale" count={`(${staleRows.length.toLocaleString()})`}>
          <div style={{ margin: -12 }}>
            <div style={{ ...S.boxSub, paddingBottom: 10, lineHeight: 1.5 }}>
              Flagged <span style={mono}>WAIV</span> in <span style={mono}>org.csv</span> but
              not on waivers per StatsPlus. Waivers clear in ~3 in-game days, so these have most likely already been claimed or
              cleared. Re-export <span style={mono}>org.csv</span> and rerun the pipeline to refresh.
            </div>
            <WaiverTable rows={stalePaged} sort={sort} setSort={setSort} onSelectPlayer={onSelectPlayer}
              weakPositions={weakPositions} myTeam={myTeam} anyToggle={anyToggle} showClock={false}
              emptyText="None." />
            <Pagination page={stalePage} totalPages={staleTotalPages} total={staleRows.length}
              onPrev={() => setStalePage(Math.max(0, stalePage - 1))} onNext={() => setStalePage(Math.min(staleTotalPages - 1, stalePage + 1))} />
          </div>
        </Section>
      )}
    </div>
  );
}
