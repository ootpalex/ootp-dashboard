import { useState, useMemo } from "react";
import { S } from "../theme.js";
import { posColor, proneColor, warStyle, intangibleColor, devPctColor, gradeStyle } from "../theme.js";
import { fmt, fmtAge, num, paginateRows, rankSuffix } from "../utils/helpers.js";
import { PER_PAGE } from "../utils/constants.js";
import { calcOrgNeed } from "../utils/strength.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, PillBtn, PositionFilter, Toggle, TwoWayBadge, Pagination } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { readScoped, writeScoped } from "../hooks/useLocalStorage.js";

const SIGNED_KEY = "ssb_iafa_signed";

function loadSignedIds() {
  try {
    const raw = readScoped(SIGNED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSignedIds(set) {
  writeScoped(SIGNED_KEY, JSON.stringify([...set]));
}

export default function IAFABoard({ data, myTeam, strength, curveSettings, leagueSettings, onSelectPlayer }) {
  const [toggles, setToggles] = useState({ orgNeed: false, devAdj: false, injury: false, intangibles: false });
  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState([]);
  const [sort, setSort] = useState({ col: "_rank", dir: "desc" });
  const [page, setPage] = useState(0);
  const [signedIds, setSignedIds] = useState(loadSignedIds);
  const [hideSigned, setHideSigned] = useState(false);

  const toggleSigned = (id) => {
    setSignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveSignedIds(next);
      return next;
    });
  };
  const clearSigned = () => {
    setSignedIds(() => {
      const next = new Set();
      saveSignedIds(next);
      return next;
    });
  };

  const orgNeed = useMemo(() => myTeam ? calcOrgNeed(myTeam, strength) : null, [myTeam, strength]);

  const iafaTag = leagueSettings?.iafaTag || "IAFA";
  const isIafa = (p) => (p.meta?.source ?? p.meta?.manual ?? p.Manual) === iafaTag;
  const demFields = (p) => ({ _demSort: p.meta?.demSort ?? num(p["DEM Sort"]) });
  const pool = useMemo(() => buildBoardPool(data, isIafa, isIafa, demFields), [data, iafaTag]);

  const debouncedSearch = useDebouncedValue(search);
  const displayPool = useMemo(() =>
    buildDisplayPool(pool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings),
    [pool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings]);

  const visiblePool = useMemo(() =>
    hideSigned ? displayPool.filter((p) => !signedIds.has(p.ID)) : displayPool,
    [displayPool, hideSigned, signedIds]);

  const { paged, totalPages } = paginateRows(visiblePool, page, PER_PAGE);
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.injury || toggles.intangibles;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="Smart Rank Adjustments">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Toggle label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
          <Toggle label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
          <Toggle label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
          <Toggle label="Intangibles" description="Bonus for elite intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
        </div>
      </Section>

      <Section title={`IAFA Board (${pool.length} players)`}>
        <div style={{ marginBottom: 12 }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={S.searchInput} />
          <PillBtn active={hideSigned} onClick={() => { setHideSigned((v) => !v); setPage(0); }}>
            {hideSigned ? "Showing unsigned" : "Hide signed"}
          </PillBtn>
          {signedIds.size > 0 && (
            <button onClick={clearSigned} style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
              Clear signed ({signedIds.size})
            </button>
          )}
        </div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              <th style={{ ...S.th, width: 50, textAlign: "center" }}>Signed</th>
              {[
                { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70 },
                { key: "Name", label: "Name", w: 140 },
                { key: "Age", label: "Age", w: 45 },
                { key: "_devPct", label: "Dev%", w: 48 },
                { key: "POS", label: "POS", w: 48 },
                { key: "_bestPos", label: "Best", w: 48 },
                ...(anyToggle ? [{ key: "_baseVal", label: "Raw", w: 60 }] : []),
                { key: "Prone", label: "Prone", w: 65 },
                { key: "_intangibles", label: "INTG", w: 45 },
                { key: "WE", label: "WE", w: 32 },
                { key: "INT", label: "INT", w: 32 },
                { key: "_demSort", label: "DEM", w: 75 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key} onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => {
                const isSigned = signedIds.has(p.ID);
                return (
                <tr key={p.ID + "-" + i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)", opacity: isSigned ? 0.5 : 1 }}>
                  <td style={{ ...S.td, textAlign: "center" }}>
                    <input type="checkbox" checked={isSigned} onChange={() => toggleSigned(p.ID)} style={{ cursor: "pointer" }} />
                  </td>
                  <td style={{ ...S.td, ...warStyle(p._rank), fontWeight: 700 }}>{fmt(anyToggle ? p._rank : (p._baseValDisplay ?? p._baseVal))}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 140, cursor: "pointer" }}
                      onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></td>
                  <td style={S.td}>{fmtAge(p._age)}</td>
                  <td style={{ ...S.td, color: p._devPct != null ? devPctColor(p._devPct) : "#475569", fontWeight: p._devPct != null ? 600 : 400 }}>{p._devPct != null ? rankSuffix(Math.round(p._devPct * 100)) : "—"}</td>
                  <td style={{ ...S.td, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                  <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                  {anyToggle && <td style={{ ...S.td, ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>}
                  <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                  <td style={{ ...S.td, ...gradeStyle(p._intangibles), fontWeight: 700 }}>{p._intangibles ?? "—"}</td>
                  <td style={{ ...S.td, color: intangibleColor(p.meta?.we ?? p.WE) }}>{(p.meta?.we ?? p.WE) || "—"}</td>
                  <td style={{ ...S.td, color: intangibleColor(p.meta?.int ?? p.INT) }}>{(p.meta?.int ?? p.INT) || "—"}</td>
                  <td style={{ ...S.td, color: "#94a3b8" }}>{(p.meta?.dem ?? p.DEM) && (p.meta?.dem ?? p.DEM) !== "-" ? (p.meta?.dem ?? p.DEM) : "—"}</td>
                </tr>
                );
              })}
              {paged.length === 0 && <tr><td colSpan={anyToggle ? 13 : 12} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No IAFA players found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={visiblePool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
    </div>
  );
}
