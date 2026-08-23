import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import * as Papa from "papaparse";
import { S, TOKENS as T } from "../theme.js";
import { posColor, proneColor, warStyle, intangibleColor, devPctStyle, gradeStyle, signColor, signShort } from "../theme.js";
import { fmt, fmtAge, num, paginateRows, rankSuffix } from "../utils/helpers.js";
import { PER_PAGE, CAP_TREE_WALK, POS_TO_LEAF, LEAF_CHAINS, SMART_RANK_TUNING } from "../utils/constants.js";
import { getStatsplusBase } from "../utils/settings.js";
import { calcOrgNeed } from "../utils/strength.js";
import { effectiveDemand, computeCoverageFloorContext } from "../utils/futureValue.js";
import { buildBoardPool, buildDisplayPool } from "./boardUtils.js";
import { Section, SortHeader, PillBtn, PositionFilter, SearchInput, Toggle, TwoWayBadge, Pagination, colRule } from "./shared.jsx";
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
  background: T.panel3,
  border: `1px solid ${T.line2}`,
  color: T.text,
  width: 18,
  height: 18,
  borderRadius: T.radius,
  fontFamily: T.fonts.narrow,
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
  const base = statsplusBase || getStatsplusBase();
  if (!base) {
    return { data: null, error: "No StatsPlus URL configured for this league — set it in League Settings (gear icon in the sidebar), or use the manual paste option." };
  }
  try {
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

  // Board columns (lifted from the inline header map so the column-group rules
  // can be spread into every <td>). Groups per MIGRATION_INVENTORY §B.3 item 4:
  // [pick] Smart/WAR P | Name Age | Dev% | POS Best | [Raw] | [DEM Sign] | Prone INTG INT WE LEA.
  const cols = [
    { key: "_pick", label: "", w: 40, group: "pick", sortable: false },
    { key: "_rank", label: anyToggle ? "Smart" : "WAR P", w: 70, group: "pick", align: "right" },
    { key: "Name", label: "Name", w: 170, group: "identity" },
    { key: "Age", label: "Age", w: 45, group: "identity", align: "right" },
    { key: "_devPct", label: "Dev%", w: 48, group: "development", align: "right" },
    { key: "POS", label: "POS", w: 48, group: "position" },
    { key: "_bestPos", label: "Best", w: 48, group: "position" },
    ...(anyToggle ? [{ key: "_baseVal", label: "Raw", w: 60, group: "raw", align: "right" }] : []),
    ...(demandsOn ? [{ key: "_demSort", label: "DEM", w: 75, group: "contract", align: "right" }, { key: "sign", label: "Sign", w: 72, group: "contract" }] : []),
    { key: "Prone", label: "Prone", w: 65, group: "health" },
    { key: "_intangibles", label: "INTG", w: 45, group: "health", align: "right" },
    { key: "INT", label: "INT", w: 32, group: "health" },
    { key: "WE", label: "WE", w: 32, group: "health" },
    { key: "LEA", label: "LEA", w: 32, group: "health" },
  ];
  // Per-column cell style: group rule + the 12px box padding on the first / last cell.
  const cell = {};
  cols.forEach((c, i) => {
    cell[c.key] = { ...(colRule(cols, i) || {}), ...(i === 0 ? { paddingLeft: 12 } : {}), ...(i === cols.length - 1 ? { paddingRight: 12 } : {}) };
  });
  const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const posCell = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 13 };
  const sortedLabel = cols.find((c) => c.key === sort.col)?.label;
  const smartOn = [toggles.devAdj, toggles.orgNeed, toggles.posCaps, toggles.coverage !== false, toggles.signability && signabilityAvailable, toggles.injury, toggles.intangibles].filter(Boolean).length;
  const capLegend = { fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 11, color: T.text3 };
  const editPanel = { display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", margin: "0 0 6px", background: T.accentBg2, border: `1px solid ${T.line2}`, borderRadius: T.radius, fontSize: 11, color: T.text2 };
  const smallBtn = { ...S.btn, padding: "2px 8px", fontSize: 11 };
  const meterColor = (over, inOverage) => (over ? T.bad : inOverage ? T.warn : T.good);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Draft Class Selector */}
      <Section title="Draft Class"
        footer={<>{fullPool.length} players in {selectedClass === "__ALL__" ? "full draft pool" : `"${selectedClass}"`}</>}>
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
      </Section>

      {/* API Status */}
      <Section title="StatsPlus Draft Feed"
        state={lastFetch ? `Updated ${new Date(lastFetch).toLocaleString()}` : null}
        actions={
          <>
            <button onClick={fetchDraft} disabled={apiLoading} style={{ ...S.btn, ...S.btnPrimary, opacity: apiLoading ? 0.6 : 1 }}>
              {apiLoading ? "Fetching..." : "Refresh"}
            </button>
            <button onClick={() => setShowManual(!showManual)} style={S.btn}>
              Paste CSV
            </button>
            {draftedPlayers.length > 0 && (
              <button onClick={clearDraft} title="Clear the loaded draft and reset to zero drafted players" style={{ ...S.btn, color: T.bad, borderColor: T.bad }}>
                Clear
              </button>
            )}
          </>
        }
        footer={
          <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span>Drafted <strong style={{ color: T.text }}>{draftedRows.length}</strong></span>
            <span>Available <strong style={{ color: T.text }}>{availablePool.length}</strong></span>
            <span>My picks <strong style={{ color: T.text }}>{myDraftCards.length}</strong></span>
          </span>
        }>
        {apiError && <div style={{ ...S.errorBox, marginBottom: 12 }}>{apiError}</div>}
        {showManual ? (
          <div>
            <textarea value={manualCSV} onChange={(e) => setManualCSV(e.target.value)} placeholder="Paste /draftv2/?all=1 CSV here..." style={{ width: "100%", boxSizing: "border-box", height: 80, background: T.bg, border: `1px solid ${T.line2}`, borderRadius: T.radius, color: T.text, padding: 8, fontSize: 11, fontFamily: "inherit", resize: "vertical" }} />
            <button onClick={handleManualPaste} style={{ ...S.btn, marginTop: 6 }}>Parse</button>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: T.text2 }}>
            Pull the live draft order from StatsPlus (Refresh) or paste the <span style={{ color: T.text, fontWeight: 600 }}>/draftv2/?all=1</span> CSV.
          </div>
        )}
      </Section>

      {/* Draft Settings — page-level controls mirrored to leagueSettings */}
      <Section title="Draft Settings"
        state={`Demands ${demandsOn ? "on" : "off"}${demandsOn && budget > 0 ? ` · $${remaining.toLocaleString()} of $${budget.toLocaleString()} remaining` : ""}`}
        actions={
          <button onClick={() => setShowDraftSettings((s) => !s)} style={S.btn} aria-expanded={showDraftSettings}>
            {showDraftSettings ? "Hide ▴" : "Show ▾"}
          </button>
        }
        footer={showDraftSettings ? "These controls mirror the league-wide settings modal — changes here update both places." : null}>
        {showDraftSettings ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.text, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={demandsOn}
                  onChange={(e) => updateLeagueField("draftDemands", e.target.checked)}
                  style={{ accentColor: T.accent, margin: 0 }}
                />
                Enable Draft Demands tracking
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 12.5, color: T.text2 }}>Budget</span>
                <span style={{ color: T.warn }}>$</span>
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
              const barColor = pct > 0.5 ? T.good : pct > 0.2 ? T.warn : T.bad;
              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: T.text2 }}>Budget: <strong style={{ color: barColor }}>${remaining.toLocaleString()}</strong> remaining</span>
                    <span style={{ color: T.text3 }}>${spent.toLocaleString()} / ${budget.toLocaleString()}</span>
                  </div>
                  <div style={{ height: 8, background: T.panel3, borderRadius: T.radius, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct * 100}%`, background: barColor, transition: "width 0.3s" }} />
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: T.text2 }}>
            Draft demands tracking and the budget live here — <span style={{ color: T.text3 }}>open to edit.</span>
          </div>
        )}
      </Section>

      {/* My Draft Class */}
      {myDraftCards.length > 0 && (
        <Section title="My Draft Class" count={`(${myDraftCards.length} picks)`}>
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
                    background: T.panel,
                    border: `1px dashed ${T.line2}`,
                    borderRadius: T.radius,
                    padding: "8px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 11,
                    minWidth: 0,
                    opacity: 0.7,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <span style={{ color: T.text3, fontWeight: 700, fontSize: 11, fontFamily: T.fonts.narrow }}>{roundLabel || "—"}</span>
                      {overallLabel && <span style={{ color: T.textDisabled, fontSize: 11 }}>{overallLabel}</span>}
                    </div>
                    <div style={{ color: T.text3, fontStyle: "italic", fontSize: 12 }}>upcoming pick</div>
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
                  background: isManual ? T.accentBg2 : T.panel2,
                  border: `1px solid ${isManual ? T.line2 : T.line}`,
                  borderRadius: T.radius,
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
                      style={{ position: "absolute", top: 2, right: 4, background: "none", border: "none", color: T.bad, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 2 }}
                    >✕</button>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ color: posColor(pos), fontWeight: 700, fontSize: 13, fontFamily: T.fonts.narrow }}>{pos || "—"}</span>
                    {roundLabel && <span style={{ color: T.text3, fontSize: 11, fontFamily: T.fonts.narrow, paddingRight: isManual ? 14 : 0 }}>{roundLabel}{overallLabel ? ` ${overallLabel}` : ""}</span>}
                  </div>
                  <div
                    onClick={() => onSelectPlayer?.(p)}
                    style={{ color: T.text, fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: onSelectPlayer ? "pointer" : "default" }}
                    title={name}
                  >
                    {name}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 8, rowGap: 2, fontSize: 11, color: T.text3 }}>
                    <span>Age <span style={{ color: T.text }}>{fmtAge(age)}</span></span>
                    {best && <span>Best <span style={{ color: posColor(best.replace("*", "")), fontWeight: 600 }}>{best}</span></span>}
                    {baseVal != null && <span>WAR <span style={{ color: T.text, ...warStyle(baseVal) }}>{fmt(baseVal)}</span></span>}
                    {prone && prone !== "-" && <span>Prone <span style={{ color: proneColor(prone) }}>{prone}</span></span>}
                    {demandsOn && (
                      <span style={{ gridColumn: "1 / 2" }}>Demand <span style={{ color: dem ? T.warn : T.textDisabled, fontWeight: dem ? 600 : 400 }}>{dem || "—"}</span></span>
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
            <span style={{ fontFamily: T.fonts.narrow, fontWeight: 600, fontSize: 12, color: T.text2 }}>Total picks</span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setTotalPicks((n) => Math.max(1, n - 1))} style={STEP_BTN} title="Decrease total picks" aria-label="Decrease total picks">−</button>
              <span style={{ minWidth: 22, textAlign: "center", fontWeight: 700, color: T.text, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{totalPicks}</span>
              <button onClick={() => setTotalPicks((n) => Math.max(1, n + 1))} style={STEP_BTN} title="Increase total picks" aria-label="Increase total picks">+</button>
            </div>
            <button onClick={() => { resetCapsToProportions(); resetFloorMins(); }} style={S.btn}>Reset</button>
            <button onClick={() => setEditCaps((v) => !v)}
              style={{ ...S.btn, ...(editCaps ? S.pillBtnActive : {}) }}
              title={editCaps ? "Done editing caps" : "Edit soft / hard caps"} aria-label="Edit caps" aria-pressed={editCaps}>
              {editCaps ? "✓ Done" : "✎ Edit"}
            </button>
          </>
        }
        footer={myDraftSlots.length > 0 ? <>Auto-detected <strong style={{ color: T.text }}>{myDraftSlots.length}</strong> picks for {myTeam} from the draft order.</> : null}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px 4px", ...capLegend }}>
            <span style={{ width: 104 }} />
            <span style={{ width: 18, textAlign: "center" }}>#</span>
            <span style={{ width: 46, textAlign: "center", color: T.accent }}>min</span>
            <span style={{ flex: 1 }}>fill (green ≤ soft · amber overage · red over)</span>
            <span style={{ width: 46, textAlign: "center" }}>soft</span>
            <span style={{ width: 46, textAlign: "center", fontWeight: 700, color: T.text2 }}>hard</span>
            <span style={{ width: 20 }} />
          </div>
          {editCaps && (() => {
            const penStepper = (val, dec, inc, color, lbl, weight = 700) => (
              <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
                <button onClick={dec} style={STEP_BTN} title={`Decrease over-${lbl} penalty`} aria-label={`Decrease over-${lbl} penalty`}>−</button>
                <span style={{ minWidth: 30, textAlign: "center", fontSize: 11, fontWeight: weight, color, fontVariantNumeric: "tabular-nums" }}>{fmt(val, 2)}</span>
                <button onClick={inc} style={STEP_BTN} title={`Increase over-${lbl} penalty`} aria-label={`Increase over-${lbl} penalty`}>+</button>
              </div>
            );
            return (
              <div style={editPanel}>
                <span style={{ fontWeight: 600 }}>WAR penalty / pick over —</span>
                <span>soft</span>
                {penStepper(capPenalty.soft, () => adjPen("soft", -0.25), () => adjPen("soft", 0.25), T.text, "soft", 500)}
                <span style={{ marginLeft: 4, fontWeight: 700, color: T.text }}>hard</span>
                {penStepper(capPenalty.hard, () => adjPen("hard", -0.5), () => adjPen("hard", 0.5), T.text, "hard", 800)}
                <button onClick={resetCapPenalty} style={{ ...smallBtn, marginLeft: "auto" }}>Reset</button>
              </div>
            );
          })()}
          {editCaps && (() => {
            const tuneStepper = (val, dec, inc, lbl) => (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                <button onClick={dec} style={STEP_BTN} title={`Decrease ${lbl}`} aria-label={`Decrease ${lbl}`}>−</button>
                <span style={{ minWidth: 16, textAlign: "center", fontSize: 11, fontWeight: 700, color: T.accent, fontVariantNumeric: "tabular-nums" }}>{val}</span>
                <button onClick={inc} style={STEP_BTN} title={`Increase ${lbl}`} aria-label={`Increase ${lbl}`}>+</button>
              </span>
            );
            return (
              <div style={{ ...editPanel, flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontWeight: 600, color: T.accent }}>Min coverage — start nudging when</span>
                <span>a position has ≤</span>
                {tuneStepper(floorTuning.cushionS, () => adjFloorTuning("cushionS", -1), () => adjFloorTuning("cushionS", 1), "players-left trigger")}
                <span>quality players left, or you have ≤</span>
                {tuneStepper(floorTuning.picksStart, () => adjFloorTuning("picksStart", -1), () => adjFloorTuning("picksStart", 1), "picks-left trigger")}
                <span>of your picks left</span>
                <button onClick={resetFloorTuning} style={{ ...smallBtn, marginLeft: "auto" }}>Reset</button>
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
              const valueColor = unmetFloor ? T.bad
                : s.picked === 0 ? T.text3
                : isOpen ? T.good
                : over ? T.bad : inOverage ? T.warn : T.good;
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
                  <span style={{ minWidth: 12, textAlign: "center", fontSize: 11, fontWeight: weight, color, fontVariantNumeric: "tabular-nums" }}>{val}</span>
                  <button onClick={inc} style={STEP_BTN} title={`Increase ${n.label} ${lbl} cap`} aria-label={`Increase ${n.label} ${lbl} cap`}>+</button>
                </div>
              );
              return (
                <div key={n.id} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 6px", borderRadius: T.radius,
                  background: n.isLeaf ? "transparent" : T.panel3,
                }}>
                  <span style={{ width: 104, paddingLeft: n.depth * 14, boxSizing: "border-box", fontSize: 12, fontFamily: T.fonts.narrow, fontWeight: n.isLeaf ? 600 : 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
                  <span style={{ width: 18, textAlign: "center", fontSize: 11, fontWeight: 700, color: valueColor, fontVariantNumeric: "tabular-nums" }}>{s.picked}</span>
                  {/* minimum-coverage target (left of the bar): the floor MIN-puller, edited
                      like soft/hard. Leaves only; 0 shows as "—". */}
                  {!n.isLeaf ? (
                    <span style={{ width: 46 }} />
                  ) : editCaps ? (
                    <div style={{ width: 46, display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
                      <button onClick={() => adjMin(n.id, -1)} style={STEP_BTN} title={`Decrease ${n.label} minimum`} aria-label={`Decrease ${n.label} minimum`}>−</button>
                      <span style={{ minWidth: 12, textAlign: "center", fontSize: 11, fontWeight: 600, color: minVal > 0 ? T.accent : T.textDisabled, fontVariantNumeric: "tabular-nums" }}>{minVal}</span>
                      <button onClick={() => adjMin(n.id, 1)} style={STEP_BTN} title={`Increase ${n.label} minimum`} aria-label={`Increase ${n.label} minimum`}>+</button>
                    </div>
                  ) : (
                    <span style={{ width: 46, textAlign: "center", fontSize: 11, fontWeight: 600, color: minVal > 0 ? T.accent : T.textDisabled, fontVariantNumeric: "tabular-nums" }}>{minVal > 0 ? minVal : "—"}</span>
                  )}
                  {/* zoned fill bar (green ≤ soft, amber overage, red over hard) with a soft-cap tick */}
                  <div style={{ flex: 1, minWidth: 30 }}>
                    {isOpen ? (
                      <div style={{ textAlign: "center", fontSize: 11, fontWeight: 600, fontFamily: T.fonts.narrow, color: T.text2 }}>No max</div>
                    ) : (
                      <div style={{ position: "relative", height: 6, background: T.panel3, borderRadius: T.radius, overflow: "hidden" }}>
                        {/* whole fill tracks the status zone (matches the # color):
                            green ≤ soft, amber soft→hard, red over hard; width fills
                            to the hard cap (clamped) so it reads as a status meter. */}
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                          width: `${Math.min(s.picked, hard) / hard * 100}%`,
                          background: meterColor(over, inOverage),
                          transition: "width 120ms ease, background 120ms ease" }} />
                        {/* soft-cap reference tick */}
                        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${s.soft / hard * 100}%`, width: 1, background: T.text2 }} />
                      </div>
                    )}
                  </div>
                  {/* caps: read-only (view) or steppers + no-max toggle (edit mode via the ✎ pencil) */}
                  {editCaps ? (
                    <>
                      {isOpen
                        ? <span style={{ width: 92 }} />
                        : <>
                            {stepper(s.soft, () => adjustSoft(-1), () => adjustSoft(1), T.text, "soft", 500)}
                            {stepper(s.hard, () => adjustHard(-1), () => adjustHard(1), T.text, "hard", 800)}
                          </>}
                      <button onClick={toggleOpen} style={{ ...STEP_BTN, color: isOpen ? T.accent : T.text3 }}
                        title={isOpen ? `Set caps for ${n.label}` : `Remove caps (no max) for ${n.label}`}
                        aria-label={isOpen ? `Set caps for ${n.label}` : `Remove caps for ${n.label}`}>{isOpen ? "＋" : "∞"}</button>
                    </>
                  ) : isOpen ? (
                    <>
                      <span style={{ width: 46, textAlign: "center", fontSize: 11, color: T.textDisabled }}>—</span>
                      <span style={{ width: 46, textAlign: "center", fontSize: 11, color: T.textDisabled }}>—</span>
                      <span style={{ width: 20 }} />
                    </>
                  ) : (
                    <>
                      <span style={{ width: 46, textAlign: "center", fontSize: 11, fontWeight: 500, color: T.text, fontVariantNumeric: "tabular-nums" }}>{s.soft}</span>
                      <span style={{ width: 46, textAlign: "center", fontSize: 11, fontWeight: 800, color: T.text, fontVariantNumeric: "tabular-nums" }}>{s.hard}</span>
                      <span style={{ width: 20 }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Smart Rank Adjustments" state={`${smartOn} of 7 on`}>
          <div style={{ display: "flex", flexDirection: "column", margin: "-13px -12px -12px" }}>
            <Toggle variant="row" label="Future Value" description="Use FV (cur + age-weighted gap) instead of raw potential" checked={toggles.devAdj} onChange={() => setToggle("devAdj")} />
            <Toggle variant="row" label="Org Positional Need" description="Boost players at your org's weak positions" checked={toggles.orgNeed} onChange={() => setToggle("orgNeed")} />
            <Toggle variant="row" label="Position Caps" description="Penalize players whose eligible positions are filling up — falls off as they have alternative landing spots" checked={toggles.posCaps} onChange={() => setToggle("posCaps")} />
            <Toggle variant="row" label="Min Coverage" description="Nudge toward securing at least one at scarce premium spots (C / MI / CF). Fires as the position thins out or your picks run low — stays off the top of the draft." checked={toggles.coverage !== false} onChange={() => setToggle("coverage")} />
            <Toggle
              variant="row"
              label="Signability"
              description={signabilityAvailable
                ? "Penalize players whose demand eats your budget — scales harder as you spend down"
                : "Requires Draft Demands enabled and a budget set"}
              checked={toggles.signability && signabilityAvailable}
              onChange={() => signabilityAvailable && setToggle("signability")}
              disabled={!signabilityAvailable}
            />
            <Toggle variant="row" label="Injury Proneness" description="Bonus for Iron Man / Durable, penalty for Fragile / Wrecked" checked={toggles.injury} onChange={() => setToggle("injury")} />
            <Toggle variant="row" label="Intangibles" description="Bonus for elite 20-80 intangible grades, penalty for poor ones" checked={toggles.intangibles} onChange={() => setToggle("intangibles")} />
          </div>
        </Section>
      </div>

      {/* Draft Board Table */}
      <Section title="Draft Board" count={`(${displayPool.length.toLocaleString()})`}
        state={sortedLabel ? `Sorted by ${sortedLabel}, ${sort.dir === "asc" ? "ascending" : "descending"}` : null}
        actions={
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
          }} style={S.btn}>Export Top 500</button>
        }
        toolbar={
          <>
            <PositionFilter value={posFilter} onChange={(v) => { setPosFilter(v); setPage(0); }} />
            <SearchInput type="text" placeholder="Search name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} aria-label="Search draft pool by name" />
          </>
        }>
        <div style={{ ...S.tableWrap, margin: -12, border: "none", borderRadius: 0 }}>
          <table style={S.table}>
            <thead><tr>
              {cols.map((c, i) => c.sortable === false ? (
                <th key={c.key} style={{ ...S.th, ...cell[c.key], width: c.w, minWidth: c.w }} aria-label="Mark as drafted" />
              ) : (
                <SortHeader key={c.key} label={c.label} width={c.w} sortCol={sort.col} sortDir={sort.dir} colKey={c.key} rule={cell[c.key]} align={c.align}
                  onClick={() => setSort((prev) => ({ col: c.key, dir: prev.col === c.key && prev.dir === "desc" ? "asc" : "desc" }))} />
              ))}
            </tr></thead>
            <tbody>
              {paged.map((p, i) => {
                const isManualPick = manualPickIds.has(String(p.ID));
                const dpct = p._devPct;
                const showDevPct = p._age != null && p._age < curveSettings.maxCurrentAge;
                const dem = (p.meta?.dem ?? p.DEM) && (p.meta?.dem ?? p.DEM) !== "-" ? (p.meta?.dem ?? p.DEM) : null;
                return (
                  <tr key={p.ID + "-" + i} style={{ ...(i % 2 === 1 ? S.zebraRow : {}), ...(isManualPick ? { background: T.accentBg2 } : {}) }}>
                    <td style={{ ...S.td, ...cell._pick }}>
                      {!isManualPick ? (
                        <button onClick={() => addManualPick(p)} title="I Drafted This Player" style={{ ...S.badge, background: "transparent", borderColor: T.line2, color: T.text3, cursor: "pointer", minWidth: 0, padding: "0 5px", lineHeight: "15px" }}>+</button>
                      ) : (
                        <span style={{ color: T.accent, fontSize: 12 }} title="Drafted by you">★</span>
                      )}
                    </td>
                    <td style={{ ...S.td, ...cell._rank, ...numCell, ...warStyle(p._rank), fontWeight: 700 }}>{fmt(anyToggle ? p._rank : (p._baseValDisplay ?? p._baseVal))}</td>
                    <td style={{ ...S.td, ...S.tdName, ...cell.Name, minWidth: 170, cursor: "pointer" }}
                        onClick={() => onSelectPlayer?.(p)}>
                      {p.meta?.name ?? p.Name}<TwoWayBadge player={p} />
                      {isManualPick && <span style={{ ...S.badge, fontSize: 10, lineHeight: "14px", minWidth: 0, padding: "0 4px", background: "transparent", borderColor: T.accent, color: T.accent, marginLeft: 6, verticalAlign: 1 }}>DRAFTED</span>}
                    </td>
                    <td style={{ ...S.td, ...cell.Age, ...numCell }}>{fmtAge(p._age)}</td>
                    <td style={{ ...S.td, ...cell._devPct, ...numCell, ...(showDevPct && dpct != null ? devPctStyle(dpct) : { color: T.textDisabled }) }}>{showDevPct && dpct != null ? rankSuffix(Math.round(dpct * 100)) : "—"}</td>
                    <td style={{ ...S.td, ...cell.POS, ...posCell, color: posColor(p.meta?.pos ?? p.POS) }}>{p.meta?.pos ?? p.POS}</td>
                    <td style={{ ...S.td, ...cell._bestPos, ...posCell, color: p._bestPos ? posColor(p._bestPos?.replace("*", "")) : T.textDisabled }}>{p._bestPos || "—"}</td>
                    {anyToggle && <td style={{ ...S.td, ...cell._baseVal, ...numCell, ...warStyle(p._baseVal) }}>{fmt(p._baseValDisplay ?? p._baseVal)}</td>}
                    {demandsOn && <td style={{ ...S.td, ...cell._demSort, ...numCell, color: dem ? T.warn : T.textDisabled, fontWeight: dem ? 600 : 400 }}>{dem || "—"}</td>}
                    {demandsOn && <td style={{ ...S.td, ...cell.sign, color: (p.meta?.sign ?? p.Sign) ? signColor(p.meta?.sign ?? p.Sign) : T.textDisabled, fontWeight: 600 }} title={p.meta?.sign ?? p.Sign ?? ""}>{(p.meta?.sign ?? p.Sign) ? signShort(p.meta?.sign ?? p.Sign) : "—"}</td>}
                    <td style={{ ...S.td, ...cell.Prone, color: (p.meta?.prone ?? p.Prone) ? proneColor(p.meta?.prone ?? p.Prone) : T.textDisabled }}>{p.meta?.prone ?? p.Prone ?? "—"}</td>
                    <td style={{ ...S.td, ...cell._intangibles, ...numCell, ...gradeStyle(p._intangibles), fontWeight: 700 }}>{p._intangibles ?? "—"}</td>
                    <td style={{ ...S.td, ...cell.INT, color: (p.meta?.int ?? p.INT) ? intangibleColor(p.meta?.int ?? p.INT) : T.textDisabled, fontWeight: 600 }}>{(p.meta?.int ?? p.INT) || "—"}</td>
                    <td style={{ ...S.td, ...cell.WE, color: (p.meta?.we ?? p.WE) ? intangibleColor(p.meta?.we ?? p.WE) : T.textDisabled, fontWeight: 600 }}>{(p.meta?.we ?? p.WE) || "—"}</td>
                    <td style={{ ...S.td, ...cell.LEA, color: (p.meta?.lea ?? p.LEA) ? intangibleColor(p.meta?.lea ?? p.LEA) : T.textDisabled, fontWeight: 600 }}>{(p.meta?.lea ?? p.LEA) || "—"}</td>
                  </tr>
                );
              })}
              {paged.length === 0 && <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: "center", color: T.text3 }}>No players found</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ margin: "0 -12px -12px" }}>
          <Pagination page={page} totalPages={totalPages} total={displayPool.length} onPrev={() => setPage(Math.max(0, page - 1))} onNext={() => setPage(Math.min(totalPages - 1, page + 1))} />
        </div>
      </Section>
    </div>
  );
}

export { fetchDraftData };
export default DraftBoard;
