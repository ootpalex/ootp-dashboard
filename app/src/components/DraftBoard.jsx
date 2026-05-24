import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import * as Papa from "papaparse";
import { S } from "../theme.js";
import { posColor, proneColor, warStyle, intangibleColor, devPctColor, gradeStyle, zToColor, signColor, signShort } from "../theme.js";
import { fmt, fmtAge, num, paginateRows, rankSuffix } from "../utils/helpers.js";
import { PER_PAGE, CAP_TREE_WALK, POS_TO_LEAF, LEAF_CHAINS, SMART_RANK_TUNING } from "../utils/constants.js";
import { getStatsplusBase } from "../utils/settings.js";
import { calcOrgNeed } from "../utils/strength.js";
import { effectiveDemand, computeCoverageFloorContext } from "../utils/futureValue.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, PillBtn, PositionFilter, Toggle, TwoWayBadge, Pagination } from "./shared.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { useScopedLocalStorage } from "../hooks/useLocalStorage.js";

// JSON serialize/deserialize options for useScopedLocalStorage. Handles any
// JSON-safe value (objects, arrays, numbers, booleans, null).
const JSON_OPTS = { serialize: JSON.stringify, deserialize: JSON.parse };

// Default toggle state for a fresh league.
const DEFAULT_TOGGLES = {
  orgNeed: false,
  devAdj: false,
  posCaps: false,
  signability: false,
  injury: false,
  intangibles: false,
  coverage: true,
};
const DEFAULT_TOTAL_PICKS = 25;
// Caps for every node: { soft, hard } from roster shares (ceil(pct × picks)),
// or "open" for no-max nodes (SP/MI/CF — bounded only by their parent's cap).
const defaultCaps = (totalPicks) => {
  const c = {};
  CAP_TREE_WALK.forEach((n) => {
    c[n.id] = n.noMax ? "open" : {
      soft: Math.max(1, Math.ceil((n.softPct ?? 0) * totalPicks)),
      hard: Math.max(1, Math.ceil((n.hardPct ?? 0) * totalPicks)),
    };
  });
  return c;
};
// True when a stored caps blob predates the soft/hard tree (missing nodes, or
// the old single-number / "open"-only shape).
const capsNeedMigration = (caps) =>
  !caps || typeof caps !== "object" ||
  CAP_TREE_WALK.some((n) => {
    const v = caps[n.id];
    if (n.noMax) return v !== "open";
    return !v || typeof v !== "object" || v.soft == null || v.hard == null;
  });

// Shared stepper-button style (used by Total Picks + the position-cap +/−).
const STEP_BTN = {
  background: "rgba(51,65,85,0.5)",
  border: "1px solid #334155",
  color: "#cbd5e1",
  width: 18,
  height: 18,
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

// A draft-order row is "filled" once a player has actually been taken in it.
// With ?all=1 the order also includes not-yet-made slots (blank or "0" ID).
const isFilledRow = (d) => {
  const id = String(d?.ID ?? d?.id ?? "").trim();
  return id !== "" && id !== "0";
};

async function fetchDraftData(statsplusBase) {
  try {
    const base = statsplusBase || getStatsplusBase();
    // ?all=1 returns the full draft order (every owned pick slot), not just
    // picks already made — lets us pre-load a team's whole draft class.
    const resp = await fetch(`${base}/draftv2/?all=1`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    return { data: parsed.data, error: null };
  } catch (e) {
    return { data: null, error: `Failed to fetch: ${e.message}. If CORS blocked, use the manual paste option.` };
  }
}

function DraftBoard({ data, myTeam, strength, curveSettings, leagueSettings, onUpdateLeagueSettings, onSelectPlayer }) {
  // --- Persisted, per-league state ----------------------------------------
  // The user expects everything they tune on this page (toggles, caps, total
  // picks, the most-recent API pull, manual picks, the draft class) to stick
  // across reloads and league switches.
  const [draftedPlayers, setDraftedPlayers] = useScopedLocalStorage("ssb_draft_drafted", [], JSON_OPTS);
  const [lastFetch, setLastFetch] = useScopedLocalStorage("ssb_draft_last_fetch", null, JSON_OPTS);
  const [toggles, setToggles] = useScopedLocalStorage("ssb_draft_toggles", DEFAULT_TOGGLES, JSON_OPTS);
  const [totalPicks, setTotalPicks] = useScopedLocalStorage("ssb_draft_total_picks", DEFAULT_TOTAL_PICKS, JSON_OPTS);
  const [caps, setCaps] = useScopedLocalStorage("ssb_draft_caps", defaultCaps(DEFAULT_TOTAL_PICKS), JSON_OPTS);
  // Per-pick WAR penalty steps (over soft / over hard). Defaults to the
  // calibrated SMART_RANK_TUNING magnitudes; editable behind the ✎ pencil.
  const [capPenalty, setCapPenalty] = useScopedLocalStorage("ssb_draft_cap_penalty",
    { soft: SMART_RANK_TUNING.CAP_SOFT_STEP, hard: SMART_RANK_TUNING.CAP_HARD_STEP }, JSON_OPTS);
  // Per-position minimum-coverage targets (the floor MIN-puller). Defaults to the
  // calibrated SMART_RANK_TUNING.FLOOR_MINS (C/MI/CF = 1); editable per-row behind
  // the ✎ pencil. 0 = no floor at that position.
  const [floorMins, setFloorMins] = useScopedLocalStorage("ssb_draft_floor_mins",
    { ...SMART_RANK_TUNING.FLOOR_MINS }, JSON_OPTS);
  // When the min-coverage nudge starts engaging: by position scarcity (≤ N quality
  // players left at the spot) and/or by draft urgency (≤ N of your picks left).
  // Defaults to the calibrated SMART_RANK_TUNING values; editable behind the ✎ pencil.
  const [floorTuning, setFloorTuning] = useScopedLocalStorage("ssb_draft_floor_tuning",
    { cushionS: SMART_RANK_TUNING.FLOOR_CUSHION_S, picksStart: SMART_RANK_TUNING.FLOOR_PICKS_START }, JSON_OPTS);
  const [myManualPicks, setMyManualPicks] = useScopedLocalStorage("ssb_draft_my_picks", [], JSON_OPTS);
  const [posFilter, setPosFilter] = useScopedLocalStorage("ssb_draft_pos_filter", [], JSON_OPTS);
  const [sort, setSort] = useScopedLocalStorage("ssb_draft_sort", { col: "_rank", dir: "desc" }, JSON_OPTS);

  // --- Transient UI state (does not persist) ------------------------------
  const [apiError, setApiError] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [manualCSV, setManualCSV] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editCaps, setEditCaps] = useState(false);  // pencil toggle: show cap steppers

  const setToggle = (key) => setToggles((t) => ({ ...t, [key]: !t[key] }));

  // Recompute caps from the cap-tree proportions whenever totalPicks changes —
  // but skip the very first render so persisted user-tuned caps aren't
  // clobbered on mount.
  const isFirstTotalPicksRender = useRef(true);
  useEffect(() => {
    if (isFirstTotalPicksRender.current) {
      isFirstTotalPicksRender.current = false;
      return;
    }
    setCaps(defaultCaps(totalPicks));
  }, [totalPicks, setCaps]);
  const resetCapsToProportions = () => setCaps(defaultCaps(totalPicks));
  // Penalty-step editing (over soft / over hard), clamped ≥ 0.
  const adjPen = (key, delta) => setCapPenalty((p) => ({
    ...p, [key]: Math.max(0, Math.round((p[key] + delta) * 100) / 100),
  }));
  const resetCapPenalty = () => setCapPenalty({ soft: SMART_RANK_TUNING.CAP_SOFT_STEP, hard: SMART_RANK_TUNING.CAP_HARD_STEP });
  // Per-position minimum editing, clamped ≥ 0.
  const adjMin = (leafId, delta) => setFloorMins((m) => ({ ...m, [leafId]: Math.max(0, (m[leafId] ?? 0) + delta) }));
  const resetFloorMins = () => setFloorMins({ ...SMART_RANK_TUNING.FLOOR_MINS });
  // Min-coverage trigger editing (clamped ≥ 1).
  const adjFloorTuning = (key, delta) => setFloorTuning((t) => ({ ...t, [key]: Math.max(1, (t[key] ?? 0) + delta) }));
  const resetFloorTuning = () => setFloorTuning({ cushionS: SMART_RANK_TUNING.FLOOR_CUSHION_S, picksStart: SMART_RANK_TUNING.FLOOR_PICKS_START });

  // Backfill any DEFAULT_TOGGLES key missing from a persisted toggles blob (so
  // toggles added later — e.g. `coverage` — default ON for existing leagues).
  useEffect(() => {
    setToggles((t) => {
      let changed = false;
      const merged = { ...t };
      Object.keys(DEFAULT_TOGGLES).forEach((k) => {
        if (!(k in merged)) { merged[k] = DEFAULT_TOGGLES[k]; changed = true; }
      });
      return changed ? merged : t;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time migration: a caps blob saved before the hierarchical tree lacks the
  // parent nodes (and used different leaf ids). Reinitialize from defaults.
  useEffect(() => {
    if (capsNeedMigration(caps)) setCaps(defaultCaps(totalPicks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draft demands (page-level controls mirror leagueSettings — already
  // per-league via the league_settings localStorage key).
  const demandsOn = leagueSettings?.draftDemands || false;
  const budget = leagueSettings?.draftBudget || 0;
  const [showDraftSettings, setShowDraftSettings] = useScopedLocalStorage(
    "ssb_draft_settings_open",
    demandsOn,
    JSON_OPTS,
  );
  const updateLeagueField = (key, value) => {
    if (typeof onUpdateLeagueSettings === "function") onUpdateLeagueSettings({ [key]: value });
  };

  // Manual "I Drafted" helpers
  const addManualPick = (player) => setMyManualPicks((prev) => [...prev, player]);
  const removeManualPick = (id) => setMyManualPicks((prev) => prev.filter((p) => p.ID !== id));

  // Detect available draft classes from Manual column
  const draftClasses = useMemo(() => {
    const classes = new Set();
    [...data.hitters, ...data.pitchers].forEach((p) => {
      const m = (p.meta?.source ?? p.meta?.manual ?? p.Manual ?? "").trim();
      if (m && m.toLowerCase().includes("draft")) {
        classes.add(m);
      }
    });
    return [...classes].sort();
  }, [data]);

  // Persist the active draft class. On mount we may have a remembered class
  // that no longer exists in the current data (e.g. league advanced a year);
  // fall back to draftClasses[0] in that case.
  const [selectedClass, setSelectedClass] = useScopedLocalStorage("ssb_draft_class", "", { serialize: (v) => v ?? "", deserialize: (s) => s ?? "" });
  useEffect(() => {
    if (draftClasses.length === 0) return;
    if (selectedClass === "__ALL__") return;
    if (!selectedClass || !draftClasses.includes(selectedClass)) {
      setSelectedClass(draftClasses[0]);
    }
  }, [draftClasses, selectedClass, setSelectedClass]);

  const fetchDraft = useCallback(async () => {
    setApiLoading(true); setApiError(null);
    const { data: d, error } = await fetchDraftData(getStatsplusBase(leagueSettings));
    if (error) {
      setApiError(error);
    } else if (d) {
      setDraftedPlayers(d);
      setLastFetch(new Date().toISOString());
    }
    setApiLoading(false);
  }, [leagueSettings, setDraftedPlayers, setLastFetch]);

  const handleManualPaste = () => {
    try {
      const parsed = Papa.parse(manualCSV.trim(), { header: true, skipEmptyLines: true });
      if (parsed.data.length === 0) { setApiError("No data rows found in pasted CSV"); return; }
      const hasId = parsed.data[0].ID != null || parsed.data[0].id != null;
      if (!hasId) { setApiError("CSV must have an ID column to match players"); return; }
      setDraftedPlayers(parsed.data); setLastFetch(new Date().toISOString()); setApiError(null); setShowManual(false);
    } catch { setApiError("Failed to parse pasted data"); }
  };

  // Clear the loaded StatsPlus draft (API or pasted) so every player is
  // available again. Leaves manual "I Drafted" picks untouched.
  const clearDraft = () => {
    if (draftedRows.length > 0 && !window.confirm(`Clear the loaded draft (${draftedRows.length} players)? This resets the board to zero drafted players.`)) return;
    setDraftedPlayers([]);
    setLastFetch(null);
    setApiError(null);
  };

  // With ?all=1, draftedPlayers holds the full draft order (filled + not-yet-
  // made slots). draftedRows is just the filled rows — what "drafted" means for
  // the available-pool filter and the Drafted counter.
  const draftedRows = useMemo(() => draftedPlayers.filter(isFilledRow), [draftedPlayers]);
  const draftedIds = useMemo(() => new Set(draftedRows.map((d) => String(d.ID || d.id))), [draftedRows]);
  const manualPickIds = useMemo(() => new Set(myManualPicks.map((p) => String(p.ID))), [myManualPicks]);

  const orgNeed = useMemo(() => myTeam ? calcOrgNeed(myTeam, strength) : null, [myTeam, strength]);

  // Build draft pool from selected draft class
  const fullPool = useMemo(() => {
    const matchesDraft = (p) => {
      const m = (p.meta?.source ?? p.meta?.manual ?? p.Manual ?? "").trim();
      if (selectedClass === "__ALL__") return m.toLowerCase().includes("draft");
      if (selectedClass) return m === selectedClass;
      return m.toLowerCase().includes("draft");
    };
    const demFields = (p) => ({ _demSort: p.meta?.demSort ?? num(p["DEM Sort"]) });
    return buildBoardPool(data, matchesDraft, matchesDraft, demFields);
  }, [data, selectedClass]);

  // Available pool (not yet drafted)
  const availablePool = useMemo(() => fullPool.filter((p) => !draftedIds.has(String(p.ID))), [fullPool, draftedIds]);

  // ID → local player lookup so we can enrich API draft rows (which only carry
  // raw CSV fields like Round/Pick/Team) with the rich local fields (meta.dem,
  // _age, _baseVal, _bestPos, etc.) needed for demand, caps, and the picks UI.
  // Prefer fullPool entries (they have _baseVal from buildBoardPool); fall back
  // to raw data for players outside the active draft class.
  const playerLookup = useMemo(() => {
    const map = new Map();
    [...data.hitters, ...data.pitchers].forEach((p) => {
      if (p.ID != null) map.set(String(p.ID), p);
    });
    fullPool.forEach((p) => {
      if (p.ID != null) map.set(String(p.ID), p);
    });
    return map;
  }, [data, fullPool]);

  // Every slot my team owns in the full draft order (filled + not-yet-made),
  // sorted by overall pick number. Filled slots are hydrated with the rich
  // local player object; empty slots are placeholders carrying only the pick
  // coordinates so they can render as "upcoming" cards. The StatsPlus-only
  // pick metadata (Round, Pick In Round, Supp, Overall, Team) rides on top.
  const myDraftSlots = useMemo(() => {
    if (!myTeam || draftedPlayers.length === 0) return [];
    return draftedPlayers
      .filter((d) => {
        const t = d.Team || d.team || "";
        return t === myTeam || t.includes(myTeam);
      })
      .sort((a, b) => (num(a.Overall) ?? 0) - (num(b.Overall) ?? 0))
      .map((d) => {
        const pick = {
          Round: d.Round,
          "Pick In Round": d["Pick In Round"],
          Supp: d.Supp,
          Overall: d.Overall,
          Team: d.Team || d.team,
        };
        if (!isFilledRow(d)) return { ...pick, _empty: true };
        const local = playerLookup.get(String(d.ID || d.id));
        return local ? { ...local, ...pick } : { ...d, ...pick };
      });
  }, [draftedPlayers, myTeam, playerLookup]);

  // Player-bearing picks (filled slots + manual "I Drafted" picks), deduped by
  // ID. Drives caps + budget; empty slots carry no player so they don't count.
  const allMyPicks = useMemo(() => {
    const out = [];
    const seen = new Set();
    const push = (p) => {
      const id = String(p.ID ?? "");
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      out.push(p);
    };
    myDraftSlots.forEach((p) => { if (!p._empty) push(p); });
    myManualPicks.forEach(push);
    return out;
  }, [myDraftSlots, myManualPicks]);

  // Render order for "My Draft Class": owned slots in overall order, then any
  // manual picks not already represented by a filled slot.
  const myDraftCards = useMemo(() => {
    const filledIds = new Set(myDraftSlots.filter((p) => !p._empty && p.ID != null).map((p) => String(p.ID)));
    const extraManual = myManualPicks.filter((p) => !filledIds.has(String(p.ID)));
    return [...myDraftSlots, ...extraManual];
  }, [myDraftSlots, myManualPicks]);

  // Auto-detect a team's true pick count (incl. compensation/supplemental
  // picks) from the draft order and set Total Picks. Tracked via a ref so the
  // value stays manually editable between fetches — only a *changed* detected
  // count re-applies.
  const lastDetectedCount = useRef(null);
  useEffect(() => {
    const detected = myDraftSlots.length;
    if (detected > 0 && detected !== lastDetectedCount.current) {
      lastDetectedCount.current = detected;
      setTotalPicks(detected);
    }
  }, [myDraftSlots, setTotalPicks]);

  // Draft demand spending — sum each pick's signability-adjusted expected cost
  // (demand × Sign-category fraction; Impossible estimated at SIG_IMPOSSIBLE_DEMAND).
  // Enriched API picks expose meta.demSort/meta.sign so auto-imported picks count.
  const spent = useMemo(() => {
    if (!demandsOn) return 0;
    return allMyPicks.reduce((sum, p) => sum + effectiveDemand(p), 0);
  }, [allMyPicks, demandsOn]);
  const remaining = budget - spent;

  // Cap status from allMyPicks — per cap-tree NODE. Each pick increments its
  // leaf AND every ancestor (subtree counts), so parents (Pitchers/Hitters/
  // INF/OF) carry the running total of their descendants. `cap` is 0 for no-max
  // ("open") nodes so capGroupPenalty treats them as unpenalized.
  const capStatus = useMemo(() => {
    const counts = {};
    allMyPicks.forEach((d) => {
      // Charge each pick at the cap leaf the board stamped on it (_primaryLeaf =
      // hardest-tier eligible position), incrementing that leaf and all its
      // ancestors. Fall back to the listed position for un-enriched API picks.
      const leaf = d._primaryLeaf || POS_TO_LEAF[String(d.meta?.pos || d.POS || d.Position || "").replace("*", "")];
      if (!leaf) return;
      (LEAF_CHAINS[leaf] || [leaf]).forEach((nodeId) => { counts[nodeId] = (counts[nodeId] || 0) + 1; });
    });
    const status = {};
    CAP_TREE_WALK.forEach((n) => {
      const raw = caps[n.id];
      const open = raw === "open" || raw == null;
      const soft = open ? 0 : (raw.soft || 0);
      const hard = open ? 0 : (raw.hard || soft);
      const picked = counts[n.id] || 0;
      status[n.id] = { picked, soft, hard, open };
    });
    return status;
  }, [allMyPicks, caps]);

  // Remaining picks (the floor's picks-net) — total picks minus those already made.
  const picksLeft = useMemo(() => Math.max(0, totalPicks - allMyPicks.length), [totalPicks, allMyPicks]);
  // Coverage-floor context: per-leaf min-coverage bonus, precomputed once over the
  // available pool (signability-weighted supply). Null when Min Coverage is off.
  const floorCtx = useMemo(() => (
    toggles.coverage !== false
      ? computeCoverageFloorContext(availablePool, {
          capStatus, picksLeft, floorMins,
          cushionS: floorTuning.cushionS, picksStart: floorTuning.picksStart,
          demandsOn, budget, spent,
        })
      : null
  ), [toggles.coverage, availablePool, capStatus, picksLeft, floorMins, floorTuning, demandsOn, budget, spent]);

  // draftContext: surface what applySmartRank's cap + signability + floor helpers need.
  const draftContext = useMemo(() => ({ capStatus, capPenalty, budget, spent, demandsOn, floorCtx }), [capStatus, capPenalty, budget, spent, demandsOn, floorCtx]);

  // Custom sort for the demand-related columns:
  // - DEM (_demSort): Impossible has no numeric demand but should sort as the
  //   "highest" (most expensive) value rather than dropping to the bottom as null.
  // - Sign: ordered easiest → hardest so descending puts Impossible on top.
  const demandSortCols = useMemo(() => ({
    _demSort: (p) => {
      const sign = p.meta?.sign ?? p.Sign;
      if (sign === "Impossible") return Number.POSITIVE_INFINITY;
      return p._demSort ?? p.meta?.demSort ?? null;
    },
    sign: (p) => {
      const order = { "Very Easy": 0, Easy: 1, Normal: 2, Hard: 3, "Extremely Hard": 4, Impossible: 5 };
      return order[p.meta?.sign ?? p.Sign] ?? null;
    },
  }), []);

  // Apply rankings + sort
  const debouncedSearch = useDebouncedValue(search);
  const displayPool = useMemo(() =>
    buildDisplayPool(availablePool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings, draftContext, demandSortCols),
    [availablePool, debouncedSearch, posFilter, sort, toggles, orgNeed, curveSettings, draftContext, demandSortCols]);

  const { paged, totalPages } = paginateRows(displayPool, page, PER_PAGE);
  const anyToggle = toggles.orgNeed || toggles.devAdj || toggles.posCaps || toggles.signability || toggles.injury || toggles.intangibles || toggles.coverage !== false;
  const signabilityAvailable = demandsOn && budget > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Draft Class Selector */}
      <Section title="Draft Class">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {draftClasses.map((dc) => (
            <PillBtn key={dc} active={selectedClass === dc} onClick={() => { setSelectedClass(dc); setPage(0); setMyManualPicks([]); }}>
              {dc}
            </PillBtn>
          ))}
          <PillBtn active={selectedClass === "__ALL__"} onClick={() => { setSelectedClass("__ALL__"); setPage(0); setMyManualPicks([]); }}>
            All Draft Eligible
          </PillBtn>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          {fullPool.length} players in {selectedClass === "__ALL__" ? "full draft pool" : `"${selectedClass}"`}
        </div>
      </Section>

      {/* API Status */}
      <Section title="StatsPlus Draft Feed" actions={
        <>
          <button onClick={fetchDraft} disabled={apiLoading} style={{ ...S.pillBtn, borderColor: "#3b82f6", color: "#93c5fd", background: "rgba(59,130,246,0.15)" }}>
            {apiLoading ? "Fetching..." : "🔄 Refresh"}
          </button>
          <button onClick={() => setShowManual(!showManual)} style={{ ...S.pillBtn, borderColor: "#334155", color: "#64748b" }}>
            📋 Paste CSV
          </button>
          {draftedPlayers.length > 0 && (
            <button onClick={clearDraft} title="Clear the loaded draft and reset to zero drafted players" style={{ ...S.pillBtn, borderColor: "#7f1d1d", color: "#f87171", background: "rgba(239,68,68,0.10)" }}>
              🗑 Clear
            </button>
          )}
        </>
      }>
        {apiError && <div style={{ ...S.errorBox, marginBottom: 12 }}>{apiError}</div>}
        {showManual && (
          <div style={{ marginBottom: 12 }}>
            <textarea value={manualCSV} onChange={(e) => setManualCSV(e.target.value)} placeholder="Paste /draftv2/?all=1 CSV here..." style={{ width: "100%", height: 80, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: 8, fontSize: 11, fontFamily: "inherit", resize: "vertical" }} />
            <button onClick={handleManualPaste} style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#86efac", marginTop: 6 }}>Parse</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#94a3b8" }}>
          <span>Drafted: <strong style={{ color: "#e2e8f0" }}>{draftedRows.length}</strong></span>
          <span>Available: <strong style={{ color: "#e2e8f0" }}>{availablePool.length}</strong></span>
          <span>My picks: <strong style={{ color: "#e2e8f0" }}>{myDraftCards.length}</strong></span>
          {lastFetch && <span>Updated: {new Date(lastFetch).toLocaleString()}</span>}
        </div>
      </Section>

      {/* Draft Settings — page-level controls mirrored to leagueSettings */}
      <Section title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }} onClick={() => setShowDraftSettings((s) => !s)}>
          <span style={{ fontSize: 11, color: "#64748b" }}>{showDraftSettings ? "▼" : "▶"}</span>
          Draft Settings
        </span>
      }>
        {showDraftSettings ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#cbd5e1", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={demandsOn}
                  onChange={(e) => updateLeagueField("draftDemands", e.target.checked)}
                />
                Enable Draft Demands tracking
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Budget</span>
                <span style={{ color: "#64748b" }}>$</span>
                <input
                  type="number"
                  min={0}
                  value={budget}
                  onChange={(e) => updateLeagueField("draftBudget", Math.max(0, parseInt(e.target.value) || 0))}
                  disabled={!demandsOn}
                  style={{ ...S.searchInput, width: 140, opacity: demandsOn ? 1 : 0.4 }}
                  placeholder="0"
                />
              </div>
            </div>
            {demandsOn && budget > 0 && (() => {
              const pct = budget > 0 ? Math.max(0, remaining / budget) : 1;
              const barColor = pct > 0.5 ? "#22c55e" : pct > 0.2 ? "#eab308" : "#ef4444";
              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: "#94a3b8" }}>Budget: <strong style={{ color: barColor }}>${remaining.toLocaleString()}</strong> remaining</span>
                    <span style={{ color: "#64748b" }}>${spent.toLocaleString()} / ${budget.toLocaleString()}</span>
                  </div>
                  <div style={{ height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct * 100}%`, background: barColor, borderRadius: 4, transition: "width 0.3s" }} />
                  </div>
                </div>
              );
            })()}
            <div style={{ fontSize: 10, color: "#64748b" }}>
              These controls mirror the league-wide settings modal — changes here update both places.
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "#64748b" }}>
            Demands {demandsOn ? "ON" : "OFF"}{demandsOn && budget > 0 ? ` · $${remaining.toLocaleString()} of $${budget.toLocaleString()} remaining` : ""}
          </div>
        )}
      </Section>

      {/* My Draft Class */}
      {myDraftCards.length > 0 && (
        <Section title={`My Draft Class (${myDraftCards.length} picks)`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
            {myDraftCards.map((p, i) => {
              const roundLabel = p.Round
                ? `R${p.Round}${String(p.Supp) === "1" ? "s" : ""}.${p["Pick In Round"] || "?"}`
                : null;
              const overallLabel = p.Overall ? `#${p.Overall}` : null;

              // Not-yet-made slot from the full draft order → muted placeholder.
              if (p._empty) {
                return (
                  <div key={i} style={{
                    background: "rgba(15,23,42,0.3)",
                    border: "1px dashed #334155",
                    borderRadius: 8,
                    padding: "8px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 11,
                    minWidth: 0,
                    opacity: 0.7,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#64748b", fontWeight: 700, fontSize: 11 }}>{roundLabel || "—"}</span>
                      {overallLabel && <span style={{ color: "#475569", fontSize: 10 }}>{overallLabel}</span>}
                    </div>
                    <div style={{ color: "#64748b", fontStyle: "italic", fontSize: 12 }}>upcoming pick</div>
                  </div>
                );
              }

              const isManual = manualPickIds.has(String(p.ID));
              const name = p.meta?.name ?? p.Name ?? p["Player Name"] ?? "—";
              const pos = p.meta?.pos ?? p.POS ?? p.Position ?? "";
              const best = p._bestPos;
              const age = p._age;
              const baseVal = p._baseValDisplay ?? p._baseVal;
              const prone = p.meta?.prone ?? p.Prone;
              const demRaw = p.meta?.dem ?? p.DEM;
              const dem = demRaw && demRaw !== "-" ? demRaw : null;
              const sign = p.meta?.sign ?? p.Sign;
              return (
                <div key={i} style={{
                  background: isManual ? "rgba(59,130,246,0.10)" : "rgba(15,23,42,0.5)",
                  border: `1px solid ${isManual ? "#1e3a5f" : "#1e293b"}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 11,
                  position: "relative",
                  minWidth: 0,
                }}>
                  {isManual && (
                    <button
                      onClick={() => removeManualPick(p.ID)}
                      title="Remove manual pick"
                      style={{ position: "absolute", top: 2, right: 4, background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 2 }}
                    >✕</button>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ color: posColor(pos), fontWeight: 700, fontSize: 12 }}>{pos || "—"}</span>
                    {roundLabel && <span style={{ color: "#64748b", fontSize: 10, paddingRight: isManual ? 14 : 0 }}>{roundLabel}{overallLabel ? ` ${overallLabel}` : ""}</span>}
                  </div>
                  <div
                    onClick={() => onSelectPlayer?.(p)}
                    style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: onSelectPlayer ? "pointer" : "default" }}
                    title={name}
                  >
                    {name}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 8, rowGap: 2, fontSize: 10, color: "#64748b" }}>
                    <span>Age <span style={{ color: "#cbd5e1" }}>{fmtAge(age)}</span></span>
                    {best && <span>Best <span style={{ color: posColor(best.replace("*", "")) }}>{best}</span></span>}
                    {baseVal != null && <span>WAR <span style={{ color: "#cbd5e1", ...warStyle(baseVal) }}>{fmt(baseVal)}</span></span>}
                    {prone && prone !== "-" && <span>Prone <span style={{ color: proneColor(prone) }}>{prone}</span></span>}
                    {demandsOn && (
                      <span style={{ gridColumn: "1 / 2" }}>Demand <span style={{ color: dem ? "#facc15" : "#475569", fontWeight: dem ? 600 : 400 }}>{dem || "—"}</span></span>
                    )}
                    {demandsOn && sign && sign !== "-" && (
                      <span style={{ gridColumn: "2 / 3" }} title={sign}>Sign <span style={{ color: signColor(sign), fontWeight: 600 }}>{signShort(sign)}</span></span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Position Caps + Smart Rank side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Section title="Position Caps" actions={
          <>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Total picks</span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setTotalPicks((n) => Math.max(1, n - 1))} style={STEP_BTN} title="Decrease total picks" aria-label="Decrease total picks">−</button>
              <span style={{ minWidth: 22, textAlign: "center", fontWeight: 700, color: "#e2e8f0", fontSize: 13 }}>{totalPicks}</span>
              <button onClick={() => setTotalPicks((n) => Math.max(1, n + 1))} style={STEP_BTN} title="Increase total picks" aria-label="Increase total picks">+</button>
            </div>
            <button onClick={() => { resetCapsToProportions(); resetFloorMins(); }} style={{ ...S.pillBtn, borderColor: "#334155", color: "#94a3b8" }}>Reset</button>
            <button onClick={() => setEditCaps((v) => !v)}
              style={{ ...S.pillBtn, borderColor: editCaps ? "#3b82f6" : "#334155", color: editCaps ? "#93c5fd" : "#94a3b8", background: editCaps ? "rgba(59,130,246,0.12)" : "transparent" }}
              title={editCaps ? "Done editing caps" : "Edit soft / hard caps"} aria-label="Edit caps" aria-pressed={editCaps}>
              {editCaps ? "✓ Done" : "✎ Edit"}
            </button>
          </>
        }>
          {myDraftSlots.length > 0 && (
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>
              Auto-detected <strong style={{ color: "#94a3b8" }}>{myDraftSlots.length}</strong> picks for {myTeam} from the draft order.
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px 4px", fontSize: 9, color: "#475569" }}>
            <span style={{ width: 104 }} />
            <span style={{ width: 18, textAlign: "center" }}>#</span>
            <span style={{ width: 46, textAlign: "center", color: "#60a5fa" }}>min</span>
            <span style={{ flex: 1 }}>fill (green ≤ soft · amber overage · red over)</span>
            <span style={{ width: 46, textAlign: "center" }}>soft</span>
            <span style={{ width: 46, textAlign: "center", fontWeight: 700, color: "#94a3b8" }}>hard</span>
            <span style={{ width: 20 }} />
          </div>
          {editCaps && (() => {
            const penStepper = (val, dec, inc, color, lbl, weight = 700) => (
              <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
                <button onClick={dec} style={STEP_BTN} title={`Decrease over-${lbl} penalty`} aria-label={`Decrease over-${lbl} penalty`}>−</button>
                <span style={{ minWidth: 30, textAlign: "center", fontSize: 11, fontWeight: weight, color }}>{fmt(val, 2)}</span>
                <button onClick={inc} style={STEP_BTN} title={`Increase over-${lbl} penalty`} aria-label={`Increase over-${lbl} penalty`}>+</button>
              </div>
            );
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", margin: "0 0 6px", background: "rgba(59,130,246,0.07)", border: "1px solid #1e3a5f", borderRadius: 4, fontSize: 10, color: "#94a3b8" }}>
                <span style={{ fontWeight: 600 }}>WAR penalty / pick over —</span>
                <span>soft</span>
                {penStepper(capPenalty.soft, () => adjPen("soft", -0.25), () => adjPen("soft", 0.25), "#cbd5e1", "soft", 500)}
                <span style={{ marginLeft: 4, fontWeight: 700, color: "#cbd5e1" }}>hard</span>
                {penStepper(capPenalty.hard, () => adjPen("hard", -0.5), () => adjPen("hard", 0.5), "#e2e8f0", "hard", 800)}
                <button onClick={resetCapPenalty} style={{ ...S.pillBtn, marginLeft: "auto", padding: "1px 8px", fontSize: 10, borderColor: "#334155", color: "#94a3b8" }}>Reset</button>
              </div>
            );
          })()}
          {editCaps && (() => {
            const tuneStepper = (val, dec, inc, lbl) => (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                <button onClick={dec} style={STEP_BTN} title={`Decrease ${lbl}`} aria-label={`Decrease ${lbl}`}>−</button>
                <span style={{ minWidth: 16, textAlign: "center", fontSize: 11, fontWeight: 700, color: "#93c5fd" }}>{val}</span>
                <button onClick={inc} style={STEP_BTN} title={`Increase ${lbl}`} aria-label={`Increase ${lbl}`}>+</button>
              </span>
            );
            return (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, padding: "5px 8px", margin: "0 0 6px", background: "rgba(59,130,246,0.07)", border: "1px solid #1e3a5f", borderRadius: 4, fontSize: 10, color: "#94a3b8" }}>
                <span style={{ fontWeight: 600, color: "#60a5fa" }}>Min coverage — start nudging when</span>
                <span>a position has ≤</span>
                {tuneStepper(floorTuning.cushionS, () => adjFloorTuning("cushionS", -1), () => adjFloorTuning("cushionS", 1), "players-left trigger")}
                <span>quality players left, or you have ≤</span>
                {tuneStepper(floorTuning.picksStart, () => adjFloorTuning("picksStart", -1), () => adjFloorTuning("picksStart", 1), "picks-left trigger")}
                <span>of your picks left</span>
                <button onClick={resetFloorTuning} style={{ ...S.pillBtn, marginLeft: "auto", padding: "1px 8px", fontSize: 10, borderColor: "#334155", color: "#94a3b8" }}>Reset</button>
              </div>
            );
          })()}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {CAP_TREE_WALK.map((n) => {
              const s = capStatus[n.id] || { picked: 0, soft: 0, hard: 0, open: true };
              const isOpen = s.open;
              const over = !isOpen && s.picked > s.hard;
              const inOverage = !isOpen && !over && s.picked > s.soft;
              // Min-coverage target for this leaf (0 = no floor). When the floor is
              // active and the minimum isn't met yet, the count reads RED (urgency).
              const minVal = floorMins[n.id] ?? 0;
              const unmetFloor = toggles.coverage !== false && minVal > 0 && s.picked < minVal;
              // Red if the floor is unmet; else neutral until you've drafted one; no-max
              // rows are always green; otherwise green ≤ soft, amber overage, red over hard.
              const valueColor = unmetFloor ? "#f87171"
                : s.picked === 0 ? "#64748b"
                : isOpen ? "#86efac"
                : over ? "#f87171" : inOverage ? "#fbbf24" : "#86efac";
              const hard = s.hard || 1;
              const adjustSoft = (delta) => setCaps((c) => {
                const v = c[n.id]; if (v === "open" || !v) return c;
                const soft = Math.max(1, Math.min(v.hard, v.soft + delta));
                return { ...c, [n.id]: { soft, hard: Math.max(soft, v.hard) } };
              });
              const adjustHard = (delta) => setCaps((c) => {
                const v = c[n.id]; if (v === "open" || !v) return c;
                return { ...c, [n.id]: { ...v, hard: Math.max(v.soft, v.hard + delta) } };
              });
              const toggleOpen = () => setCaps((c) => c[n.id] === "open"
                ? { ...c, [n.id]: { soft: Math.max(1, Math.ceil((n.softPct ?? 0.10) * totalPicks)),
                                    hard: Math.max(1, Math.ceil((n.hardPct ?? 0.12) * totalPicks)) } }
                : { ...c, [n.id]: "open" });
              const stepper = (val, dec, inc, color, lbl, weight = 700) => (
                <div style={{ width: 46, display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
                  <button onClick={dec} style={STEP_BTN} title={`Decrease ${n.label} ${lbl} cap`} aria-label={`Decrease ${n.label} ${lbl} cap`}>−</button>
                  <span style={{ minWidth: 12, textAlign: "center", fontSize: 11, fontWeight: weight, color }}>{val}</span>
                  <button onClick={inc} style={STEP_BTN} title={`Increase ${n.label} ${lbl} cap`} aria-label={`Increase ${n.label} ${lbl} cap`}>+</button>
                </div>
              );
              return (
                <div key={n.id} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 6px", borderRadius: 4,
                  background: n.isLeaf ? "transparent" : "rgba(30,41,59,0.45)",
                }}>
                  <span style={{ width: 104, paddingLeft: n.depth * 14, boxSizing: "border-box", fontSize: 11, fontWeight: n.isLeaf ? 600 : 700, color: n.isLeaf ? "#cbd5e1" : "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
                  <span style={{ width: 18, textAlign: "center", fontSize: 11, fontWeight: 700, color: valueColor }}>{s.picked}</span>
                  {/* minimum-coverage target (left of the bar): the floor MIN-puller, edited
                      like soft/hard. Leaves only; 0 shows as "—". */}
                  {!n.isLeaf ? (
                    <span style={{ width: 46 }} />
                  ) : editCaps ? (
                    <div style={{ width: 46, display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
                      <button onClick={() => adjMin(n.id, -1)} style={STEP_BTN} title={`Decrease ${n.label} minimum`} aria-label={`Decrease ${n.label} minimum`}>−</button>
                      <span style={{ minWidth: 12, textAlign: "center", fontSize: 11, fontWeight: 600, color: minVal > 0 ? "#93c5fd" : "#475569" }}>{minVal}</span>
                      <button onClick={() => adjMin(n.id, 1)} style={STEP_BTN} title={`Increase ${n.label} minimum`} aria-label={`Increase ${n.label} minimum`}>+</button>
                    </div>
                  ) : (
                    <span style={{ width: 46, textAlign: "center", fontSize: 11, fontWeight: 600, color: minVal > 0 ? "#93c5fd" : "#475569" }}>{minVal > 0 ? minVal : "—"}</span>
                  )}
                  {/* zoned fill bar (green ≤ soft, amber overage, red over hard) with a soft-cap tick */}
                  <div style={{ flex: 1, minWidth: 30 }}>
                    {isOpen ? (
                      <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 1.5 }}>NO MAX</div>
                    ) : (
                      <div style={{ position: "relative", height: 6, background: "#0f172a", borderRadius: 2, overflow: "hidden" }}>
                        {/* whole fill tracks the status zone (matches the # color):
                            green ≤ soft, amber soft→hard, red over hard; width fills
                            to the hard cap (clamped) so it reads as a status meter. */}
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                          width: `${Math.min(s.picked, hard) / hard * 100}%`,
                          background: over ? "#ef4444" : inOverage ? "#f59e0b" : "#22c55e",
                          transition: "width 120ms ease, background 120ms ease" }} />
                        {/* soft-cap reference tick */}
                        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${s.soft / hard * 100}%`, width: 1, background: "#94a3b8" }} />
                      </div>
                    )}
                  </div>
                  {/* caps: read-only (view) or steppers + no-max toggle (edit mode via the ✎ pencil) */}
                  {editCaps ? (
                    <>
                      {isOpen
                        ? <span style={{ width: 92 }} />
                        : <>
                            {stepper(s.soft, () => adjustSoft(-1), () => adjustSoft(1), "#cbd5e1", "soft", 500)}
                            {stepper(s.hard, () => adjustHard(-1), () => adjustHard(1), "#e2e8f0", "hard", 800)}
                          </>}
                      <button onClick={toggleOpen} style={{ ...STEP_BTN, color: isOpen ? "#38bdf8" : "#64748b" }}
                        title={isOpen ? `Set caps for ${n.label}` : `Remove caps (no max) for ${n.label}`}
                        aria-label={isOpen ? `Set caps for ${n.label}` : `Remove caps for ${n.label}`}>{isOpen ? "＋" : "∞"}</button>
                    </>
                  ) : isOpen ? (
                    <>
                      <span style={{ width: 46, textAlign: "center", fontSize: 11, color: "#475569" }}>—</span>
                      <span style={{ width: 46, textAlign: "center", fontSize: 11, color: "#475569" }}>—</span>
                      <span style={{ width: 20 }} />
                    </>
                  ) : (
                    <>
                      <span style={{ width: 46, textAlign: "center", fontSize: 11, fontWeight: 500, color: "#cbd5e1" }}>{s.soft}</span>
                      <span style={{ width: 46, textAlign: "center", fontSize: 11, fontWeight: 800, color: "#e2e8f0" }}>{s.hard}</span>
                      <span style={{ width: 20 }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Smart Rank Adjustments">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Toggle label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
            <Toggle label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
            <Toggle label="Position Caps" description="Penalize players whose eligible positions are filling up — falls off as they have alternative landing spots" checked={toggles.posCaps} onChange={() => setToggle("posCaps")} />
            <Toggle label="Min Coverage" description="Nudge toward securing at least one at scarce premium spots (C / MI / CF). Fires as the position thins out or your picks run low — stays off the top of the draft." checked={toggles.coverage !== false} onChange={() => setToggle("coverage")} />
            <Toggle
              label="Signability"
              description={signabilityAvailable
                ? "Penalize players whose demand eats your budget — scales harder as you spend down"
                : "Requires Draft Demands enabled and a budget set"}
              checked={toggles.signability && signabilityAvailable}
              onChange={() => signabilityAvailable && setToggle("signability")}
              disabled={!signabilityAvailable}
            />
            <Toggle label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
            <Toggle label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
          </div>
        </Section>
      </div>

      {/* Draft Board Table */}
      <Section title="Draft Board">
        <div style={{ marginBottom: 12 }}>
          <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={S.searchInput} />
          <button onClick={() => {
            const seen = new Set();
            const top500 = [];
            for (const p of displayPool) {
              if (!seen.has(p.ID)) { seen.add(p.ID); top500.push(p); }
              if (top500.length >= 500) break;
            }
            const csv = "ID\n" + top500.map(p => p.ID).join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = "draft_list.csv"; a.click();
            URL.revokeObjectURL(url);
          }} style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#86efac", background: "rgba(34,197,94,0.10)" }}>Export Top 500</button>
        </div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              <th style={{ ...S.th, width: 40 }}></th>
              {[
                { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70 },
                { key: "Name", label: "Name", w: 170 },
                { key: "Age", label: "Age", w: 45 },
                { key: "_devPct", label: "Dev%", w: 48 },
                { key: "POS", label: "POS", w: 48 },
                { key: "_bestPos", label: "Best", w: 48 },
                ...(anyToggle ? [{ key: "_baseVal", label: "Raw", w: 60 }] : []),
                ...(demandsOn ? [{ key: "_demSort", label: "DEM", w: 75 }, { key: "sign", label: "Sign", w: 72 }] : []),
                { key: "Prone", label: "Prone", w: 65 },
                { key: "_intangibles", label: "INTS", w: 45 },
                { key: "INT", label: "INT", w: 32 },
                { key: "WE", label: "WE", w: 32 },
                { key: "LEA", label: "LEA", w: 32 },
              ].map(({ key, label, w }) => (
                <SortHeader key={key} label={label} width={w} sortCol={sort.col} sortDir={sort.dir} colKey={key} onClick={() => setSort((prev) => ({ col: key, dir: prev.col === key && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => {
                const isManualPick = manualPickIds.has(String(p.ID));
                const dpct = p._devPct;
                const showDevPct = p._age != null && p._age < curveSettings.maxCurrentAge;
                return (
                  <tr key={p.ID + "-" + i} style={{ background: isManualPick ? "rgba(59,130,246,0.08)" : i % 2 === 0 ? "transparent" : "rgba(15,23,42,0.3)" }}>
                    <td style={S.td}>
                      {!isManualPick ? (
                        <button onClick={() => addManualPick(p)} title="I Drafted This Player" style={{ background: "none", border: "1px solid #334155", borderRadius: 4, color: "#64748b", cursor: "pointer", fontSize: 10, padding: "2px 4px", lineHeight: 1 }}>+</button>
                      ) : (
                        <span style={{ color: "#3b82f6", fontSize: 12 }}>★</span>
                      )}
                    </td>
                    <td style={{ ...S.td, ...warStyle(p._rank), fontWeight: 700 }}>{fmt(anyToggle ? p._rank : (p._baseValDisplay ?? p._baseVal))}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: "#e2e8f0", minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>
                      {p.meta?.name ?? p.Name}<TwoWayBadge player={p} />
                      {isManualPick && <span style={{ color: "#3b82f6", marginLeft: 6, fontSize: 9 }}>DRAFTED</span>}
                    </td>
                    <td style={S.td}>{fmtAge(p._age)}</td>
                    <td style={{ ...S.td, color: showDevPct && dpct != null ? devPctColor(dpct) : "#475569", fontWeight: showDevPct && dpct != null ? 600 : 400 }}>{showDevPct && dpct != null ? rankSuffix(Math.round(dpct * 100)) : "—"}</td>
                    <td style={{ ...S.td, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                    <td style={{ ...S.td, color: posColor(p._bestPos?.replace("*", "")) }}>{p._bestPos || "—"}</td>
                    {anyToggle && <td style={{ ...S.td, ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>}
                    {demandsOn && <td style={{ ...S.td, color: "#94a3b8" }}>{(p.meta?.dem ?? p.DEM) && (p.meta?.dem ?? p.DEM) !== "-" ? (p.meta?.dem ?? p.DEM) : "—"}</td>}
                    {demandsOn && <td style={{ ...S.td, color: signColor(p.meta?.sign ?? p.Sign), fontWeight: 600 }} title={p.meta?.sign ?? p.Sign ?? ""}>{(p.meta?.sign ?? p.Sign) ? signShort(p.meta?.sign ?? p.Sign) : "—"}</td>}
                    <td style={{ ...S.td, color: proneColor(p.meta?.prone ?? p.Prone) }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                    <td style={{ ...S.td, ...gradeStyle(p._intangibles), fontWeight: 700 }}>{p._intangibles ?? "—"}</td>
                    <td style={{ ...S.td, color: intangibleColor(p.meta?.int ?? p.INT) }}>{(p.meta?.int ?? p.INT) || "—"}</td>
                    <td style={{ ...S.td, color: intangibleColor(p.meta?.we ?? p.WE) }}>{(p.meta?.we ?? p.WE) || "—"}</td>
                    <td style={{ ...S.td, color: intangibleColor(p.meta?.lea ?? p.LEA) }}>{(p.meta?.lea ?? p.LEA) || "—"}</td>
                  </tr>
                );
              })}
              {paged.length === 0 && <tr><td colSpan={12 + (anyToggle ? 1 : 0) + (demandsOn ? 2 : 0)} style={{ ...S.td, textAlign: "center", color: "#475569" }}>No players found</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={displayPool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
      </Section>
    </div>
  );
}

export { fetchDraftData };
export default DraftBoard;
