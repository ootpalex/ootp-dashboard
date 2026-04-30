// ============================================================================
// ROSTER PLANNER — Coordinator: state, memos, DnD orchestration.
// Sub-panels live as siblings in this directory.
// ============================================================================
import { useState, useMemo, useCallback, useEffect } from "react";
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, KeyboardSensor, TouchSensor } from "@dnd-kit/core";
import { S } from "../../theme.js";
import { Section, PillBtn, TabGroup } from "../../components/shared.jsx";
import { getBatR, getSpWaa, getRpWaa } from "../../utils/accessors.js";
import { computeDevPercentile, calcFutureValue } from "../../utils/futureValue.js";
import { isMatured } from "../../utils/dataProcessing.js";
import {
  buildRosterProjection, analyzeCrunch, suggestActions,
  detectGameDate,
  buildDepthChart, filterR5Protect, R5_DEFAULT_THRESHOLD,
} from "../../utils/rosterPlanning/index.js";
import { fetchDraftDates } from "../../utils/salaryReport.js";
import { getStatsplusPageBase } from "../../utils/settings.js";
import { useScopedLocalStorage } from "../../hooks/useLocalStorage.js";

import {
  R5_THRESHOLD_KEY, YEAR_COUNT, SEVERITY_STYLES, isSpRole, loadMoves, saveMoves,
  loadMoveOrder, saveMoveOrder,
} from "./_shared.js";
import { SummaryCard, DragOverlayRow, DroppablePanel } from "./Panels.jsx";
import { ActiveDepthPanel, InactiveDepthPanel } from "./DepthChartPanels.jsx";
import { Rule5RiskPanel } from "./Rule5RiskPanel.jsx";
import { OptionDecisionsPanel, ExpiringContractsPanel, OutOfOptionsDecisionsPanel, ArbitrationDecisionsPanel } from "./QueuePanels.jsx";
import { MlfaSection } from "./MlfaSection.jsx";
import { SuggestionsPanel } from "./SuggestionsPanel.jsx";
import { MovesLogPanel, MOVE_LABELS } from "./MovesLogPanel.jsx";
import { SuperTwoDetailModal } from "./SuperTwoDetailModal.jsx";
import { BUCKET_CONFIG } from "./_shared.js";

function superTwoSubtitle(info, gameYear) {
  const { count, seasonDay, limbo, algoOffset } = info;
  const arbYear = gameYear + algoOffset + 1;
  if (seasonDay > 0) {
    return `${count} projected for ${arbYear} (day ${seasonDay} of ${gameYear})`;
  }
  if (limbo) {
    return `${count} projected for ${arbYear} (offseason, ${gameYear} complete)`;
  }
  return `${count} projected for ${arbYear} (pre-season ${gameYear})`;
}

// Hide the cutoff for any class whose arb salaries are already determined:
// (1) algoOffset < 0 — the tab is the current year, whose cutoff was set last
// offseason. (2) Limbo with arbSigned at algoOffset === 0 — the upcoming
// class's salaries were just signed this offseason, so projection is moot.
function shouldShowSuperTwo(info) {
  if (!info) return false;
  if (info.algoOffset < 0) return false;
  if (info.limbo && info.arbSigned && info.algoOffset === 0) return false;
  return true;
}

export default function RosterPlanner({ data, myTeam, curveSettings, leagueSettings, dashMeta, onSelectPlayer }) {
  // State
  const [moves, setMoves] = useState(loadMoves);
  const [moveOrder, setMoveOrder] = useState(loadMoveOrder);
  const [moveHistory, setMoveHistory] = useState([]);
  const [activeDragId, setActiveDragId] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showMlfaSection, setShowMlfaSection] = useState(false);
  const [s2ModalOpen, setS2ModalOpen] = useState(false);
  const [planYearOffset, setPlanYearOffset] = useState(0);
  const [r5Threshold, setR5Threshold] = useScopedLocalStorage(R5_THRESHOLD_KEY, R5_DEFAULT_THRESHOLD, {
    deserialize: (s) => { const v = parseFloat(s); return isFinite(v) ? v : R5_DEFAULT_THRESHOLD; },
  });
  const [showOtherR5, setShowOtherR5] = useState(false);
  const [hoveredActivePos, setHoveredActivePos] = useState(null);
  const [hoveredInactivePos, setHoveredInactivePos] = useState(null);
  const [draftDateMap, setDraftDateMap] = useState(null);

  // All league players (for super-two projection and game date detection)
  const allPlayers = useMemo(() => [...data.hitters, ...data.pitchers], [data]);

  // Build contracts map from each player's embedded sp_contract (no network fetch).
  const contractsMap = useMemo(() => {
    const m = new Map();
    for (const p of allPlayers) {
      if (p.contract) {
        const pid = String(p.id || p.ID);
        m.set(pid, p.contract);
      }
    }
    return m;
  }, [allPlayers]);

  // Build salary report map from each player's embedded _projection.baseline.
  // Used by the move-aware fallback in buildRosterProjection. When userMoves is
  // empty the fast-path bypasses this entirely and uses _projection.baseline directly.
  const salaryReportMap = useMemo(() => {
    const m = new Map();
    for (const p of allPlayers) {
      const baseline = p._projection?.baseline;
      if (baseline && Object.keys(baseline).length > 0) {
        const pid = String(p.id || p.ID);
        const years = {};
        for (const [yr, st] of Object.entries(baseline)) {
          years[Number(yr)] = st;
        }
        m.set(pid, { years });
      }
    }
    return m;
  }, [allPlayers]);

  // Derive game year. Priority: meta_projection > DOB/age crossover > dashMeta.gameDate > fallback.
  const gameYear = useMemo(() => {
    if (dashMeta?.metaProjection?.gameYear) return dashMeta.metaProjection.gameYear;
    if (allPlayers.length > 0) {
      const detected = detectGameDate(allPlayers);
      if (detected) return detected.getFullYear();
    }
    const gd = dashMeta?.gameDate;
    if (gd) {
      const yr = parseInt(gd.split("-")[0], 10);
      if (!isNaN(yr)) return yr;
    }
    return new Date().getFullYear();
  }, [dashMeta, allPlayers]);

  const teamPlayers = useMemo(() => {
    return allPlayers.filter(p => (p.meta?.org ?? p.ORG) === myTeam);
  }, [allPlayers, myTeam]);

  const activePlanYear = gameYear + planYearOffset;

  const projection = useMemo(
    () => buildRosterProjection(teamPlayers, gameYear, moves, allPlayers, contractsMap, activePlanYear, 3, salaryReportMap, draftDateMap),
    [teamPlayers, gameYear, moves, allPlayers, contractsMap, activePlanYear, salaryReportMap, draftDateMap]
  );

  // Expiring 40-man/MLB contracts for the active planning year — only the FIRST year a player becomes FA
  const expiringPlayers = useMemo(() => {
    if (planYearOffset === 0) return [];
    const yd = projection.years[activePlanYear];
    const prevYd = projection.years[activePlanYear - 1];
    if (!yd) return [];
    return projection.enriched.filter(ep => {
      const status = yd[ep._uid];
      const prevStatus = prevYd?.[ep._uid];
      return status?.status === "fa"
        && ep._contract?.type !== "fa"
        && ep._contract?.type !== "minors"
        && ep._contract?.type !== "signed_minors"
        && ep.meta?.on40 === true
        && prevStatus?.status !== "fa";
    });
  }, [projection, activePlanYear, planYearOffset]);

  // Players with team options due in the active planning year (decision needed)
  const optionDecisions = useMemo(() => {
    if (planYearOffset === 0) return [];
    const yd = projection.years[activePlanYear];
    if (!yd) return [];
    return projection.enriched.filter(ep => {
      const status = yd[ep._uid];
      return status?.status === "option" && status?.optionType === "club" && ep.meta?.on40 === true;
    });
  }, [projection, activePlanYear, planYearOffset]);

  // Moves log: all recorded moves grouped by startYear, with player info for display.
  // Falls back to teamPlayers/allPlayers when the projection has dropped a player
  // (e.g., non-tender / dfa / trade marks them _removed for the displayed year).
  const movesLog = useMemo(() => {
    const byUid = new Map();
    for (const p of teamPlayers) byUid.set(p._uid, p);
    for (const p of allPlayers) if (!byUid.has(p._uid)) byUid.set(p._uid, p);

    const orderIdx = new Map();
    moveOrder.forEach((key, i) => orderIdx.set(key, i));
    const fallbackBase = moveOrder.length;
    const entries = Object.entries(moves).map(([key, move], i) => {
      const playerUid = move.uid || key;
      const player = projection.enriched.find(p => p._uid === playerUid) || byUid.get(playerUid);
      const sortIdx = orderIdx.has(key) ? orderIdx.get(key) : (fallbackBase + i);
      return { uid: key, move, player, label: MOVE_LABELS[move.action] || move.action, _sortIdx: sortIdx };
    });
    const byYear = {};
    entries.forEach(e => {
      const yr = e.move.startYear || gameYear + 1;
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(e);
    });
    Object.values(byYear).forEach(items => items.sort((a, b) => a._sortIdx - b._sortIdx));
    return Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([yr, items]) => ({ year: Number(yr), items }));
  }, [moves, moveOrder, projection.enriched, teamPlayers, allPlayers, gameYear]);

  // MiLB FAs for the active planning year — sorted by FV descending
  const mlfaPlayers = useMemo(() => {
    if (planYearOffset === 0) return [];
    const yd = projection.years[activePlanYear];
    if (!yd) return [];
    return projection.enriched
      .filter(ep => {
        const status = yd[ep._uid];
        return status?.status === "fa" && ep._contract?.type === "minors";
      })
      .sort((a, b) => (b._fv ?? b._waaP ?? -999) - (a._fv ?? a._waaP ?? -999));
  }, [projection, activePlanYear, planYearOffset]);

  // League-wide age peers for dev percentile computation. Split pitchers by
  // SP vs RP role (starter flag), not meta.pos — an RP-only pitcher listed
  // as SP would otherwise get a null SP WAA and fall out of the pool.
  const peers = useMemo(() => {
    const hitPeers = data.hitters.map(p => ({ age: p._age, currentWAA: getBatR(p) }));
    const spPeers = data.pitchers.filter(isSpRole).map(p => ({ age: p._age, currentWAA: getSpWaa(p) }));
    const rpPeers = data.pitchers.filter(p => !isSpRole(p)).map(p => ({ age: p._age, currentWAA: getRpWaa(p) }));
    return { hitPeers, spPeers, rpPeers };
  }, [data]);

  const enrichedWithFV = useMemo(() => {
    const cs = curveSettings || {};
    const yearMap = projection.years[activePlanYear] || {};
    return projection.enriched.map(ep => {
      const isPit = ep._type === "pitcher" || ep.meta?.isPitcher;
      const sp = isPit && isSpRole(ep);
      const peerPool = isPit ? (sp ? peers.spPeers : peers.rpPeers) : peers.hitPeers;
      const devVal = isPit
        ? (sp ? getSpWaa(ep) : getRpWaa(ep))
        : getBatR(ep);
      const matured = isMatured(ep, cs);
      const devPct = matured ? null : computeDevPercentile(devVal, ep._age, peerPool);
      const fv = calcFutureValue(ep._waa, ep._waaP, ep._age, devPct, cs);
      const yearStatus = yearMap[ep._uid] || null;
      return { ...ep, _devPct: devPct, _fv: fv, _yearStatus: yearStatus };
    });
  }, [projection, peers, curveSettings, activePlanYear]);

  // For future year views, exclude FA players from depth chart so they don't occupy active/40-man slots
  const depthPlayers = useMemo(() => {
    if (planYearOffset === 0) return enrichedWithFV;
    const yd = projection.years[activePlanYear] || {};
    return enrichedWithFV.filter(ep => yd[ep._uid]?.status !== "fa");
  }, [enrichedWithFV, projection, activePlanYear, planYearOffset]);

  const depth = useMemo(() => buildDepthChart(depthPlayers), [depthPlayers]);

  const r5 = useMemo(() => filterR5Protect(enrichedWithFV, r5Threshold, activePlanYear), [enrichedWithFV, r5Threshold, activePlanYear]);

  // Players who are out of options (and not currently rostered active) — they
  // require a forced choice: promote to active or DFA / waive.
  const outOfOptionsDecisions = useMemo(() => {
    return enrichedWithFV.filter(ep =>
      ep._options?.outOfOptions &&
      !ep._options?.isLastOptionYear &&
      ep.meta?.act !== true
    );
  }, [enrichedWithFV]);

  // Arb-eligible players in the active plan year — tender or non-tender.
  const arbDecisions = useMemo(() => {
    return enrichedWithFV.filter(ep => ep._yearStatus?.status === "arb");
  }, [enrichedWithFV]);

  // Crunch warnings (combined from analyzeCrunch + depth coverage).
  // Replace the generic R5 warning (which counts every R5-exposed player) with
  // one tied to the threshold-filtered shortlist.
  const warnings = useMemo(() => {
    const base = analyzeCrunch(projection, gameYear).filter(w => w.type !== "r5" && w.type !== "crunch");
    const r5Count = r5.shortlist.length;
    if (planYearOffset > 0 && r5Count > 0) {
      base.push({
        type: "r5", severity: "warning",
        message: `${r5Count} R5-exposed prospect${r5Count > 1 ? "s" : ""} above FV ${r5Threshold.toFixed(1)} — drag into 40-Man to protect.`,
      });
      const openSlots = 40 - projection.fortyManCount;
      if (r5Count > openSlots && openSlots >= 0) {
        base.push({
          type: "crunch", severity: "error",
          message: `Need ${r5Count} slots for R5 protection but only ${openSlots} open — must clear ${r5Count - openSlots} spot${r5Count - openSlots > 1 ? "s" : ""}.`,
        });
      }
    }
    return [...base, ...depth.warnings];
  }, [projection, gameYear, depth, r5, r5Threshold, planYearOffset]);

  // Fetch exact draft dates for all draft years represented in this team's players.
  useEffect(() => {
    const pageBase = getStatsplusPageBase(leagueSettings);
    if (!pageBase || !teamPlayers.length) return;
    fetchDraftDates(teamPlayers, pageBase).then(setDraftDateMap).catch(() => {});
  }, [teamPlayers, leagueSettings]);

  // Suggestions — non-protect come from suggestActions; protect entries
  // come from the slot-aware tiers so Must Protect reflects who actually
  // beats the realistic 40-man displacement floor (not just a raw FV cut).
  const suggestions = useMemo(() => {
    const base = suggestActions(projection, curveSettings).filter(s => s.type !== "protect");
    if (planYearOffset === 0) return base;
    const fmtReason = (entry, type) => {
      const ep = entry.player;
      const cd = ep._r5?.r5Countdown;
      const r5Tag = `R5${cd === 0 ? " now" : ` in ${cd}y`}`;
      const fvTag = `FV ${entry.score != null ? entry.score.toFixed(1) : "N/A"}`;
      if (entry.reason === "openSlot") {
        return `${r5Tag}, ${fvTag} — fills open 40-man slot`;
      }
      const dName = entry.displacedPlayer?.meta?.name || "weakest 40-man";
      const dFv = entry.displacedScore != null ? entry.displacedScore.toFixed(1) : "N/A";
      const verb = type === "protect" ? "displaces" : "edges";
      return `${r5Tag}, ${fvTag} — ${verb} ${dName} (FV ${dFv})`;
    };
    const protects = r5.mustProtect.map(entry => ({
      type: "protect", playerId: entry.player._uid, player: entry.player,
      reason: fmtReason(entry, "protect"), action: "protect",
    }));
    const considers = r5.considerProtecting.map(entry => ({
      type: "considerProtect", playerId: entry.player._uid, player: entry.player,
      reason: fmtReason(entry, "considerProtect"), action: "protect",
    }));
    return [...protects, ...considers, ...base];
  }, [projection, curveSettings, r5, planYearOffset]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // Apply a move — startYear determines when the move kicks in (cascades forward).
  // Arb decisions (tender / nonTender) use a composite year-scoped key so the
  // same player can sign in one year and non-tender in another independently.
  const applyMove = useCallback((playerId, action, extra = {}) => {
    const isArb = action === "tender" || action === "nonTender";
    const moveKey = isArb ? `t:${playerId}:${activePlanYear}` : playerId;
    const moveValue = isArb
      ? { action, startYear: activePlanYear, uid: playerId, ...extra }
      : { action, startYear: activePlanYear, ...extra };
    setMoves(prev => {
      const next = { ...prev, [moveKey]: moveValue };
      saveMoves(next);
      return next;
    });
    setMoveOrder(prev => {
      if (prev.includes(moveKey)) return prev;
      const next = [...prev, moveKey];
      saveMoveOrder(next);
      return next;
    });
    setMoveHistory(prev => [...prev, moveKey]);
  }, [activePlanYear]);

  const deleteMove = useCallback((playerId) => {
    setMoves(prev => {
      const next = { ...prev };
      delete next[playerId];
      saveMoves(next);
      return next;
    });
    setMoveOrder(prev => {
      const next = prev.filter(id => id !== playerId);
      saveMoveOrder(next);
      return next;
    });
    setMoveHistory(prev => prev.filter(id => id !== playerId));
  }, []);

  const reorderMoves = useCallback((year, fromUid, toUid) => {
    setMoveOrder(prev => {
      // Build the current effective order: existing entries first, then any
      // historic moves that pre-date the order tracking.
      const seen = new Set(prev);
      const allUids = [...prev];
      Object.keys(moves).forEach(uid => { if (!seen.has(uid)) allUids.push(uid); });

      // Within-year move: extract this year's uids, reorder, then splice back.
      const yearUids = allUids.filter(uid => (moves[uid]?.startYear ?? null) === year);
      const fromIdx = yearUids.indexOf(fromUid);
      const toIdx = yearUids.indexOf(toUid);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const reordered = [...yearUids];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);

      let cursor = 0;
      const next = allUids.map(uid =>
        (moves[uid]?.startYear ?? null) === year ? reordered[cursor++] : uid
      );
      saveMoveOrder(next);
      return next;
    });
  }, [moves]);

  const undoLast = useCallback(() => {
    setMoveHistory(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setMoves(m => {
        const next = { ...m };
        delete next[last];
        saveMoves(next);
        return next;
      });
      return prev.slice(0, -1);
    });
  }, []);

  const resetPlan = useCallback(() => {
    setMoves({});
    setMoveHistory([]);
    saveMoves({});
  }, []);

  const handleDragStart = useCallback((event) => {
    setActiveDragId(event.active.id);
  }, []);

  const handleDragEnd = useCallback((event) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || !active) return;

    const playerId = active.id;
    const targetBucket = over.id;

    const player = projection.enriched.find(p => p._uid === playerId);
    if (!player) return;

    const sourceBucket = Object.entries(projection.buckets).find(([, players]) =>
      players.some(p => p._uid === playerId)
    )?.[0];

    if (sourceBucket === targetBucket) return;

    if (targetBucket === "ilShort") {
      applyMove(playerId, "ilShort");
    } else if (targetBucket === "ilLong") {
      applyMove(playerId, "ilLong");
    } else if (targetBucket === "active") {
      applyMove(playerId, "promote");
    } else if (targetBucket === "fortyMan" && sourceBucket === "departing") {
      applyMove(playerId, "sign");
    } else if (targetBucket === "fortyMan" && (sourceBucket === "prospects" || sourceBucket === "r5Risk")) {
      applyMove(playerId, "protect");
    } else if (targetBucket === "fortyMan" && sourceBucket === "active") {
      // Strict option mechanics: a player with no remaining options cannot be
      // demoted to the inactive 40-man — they must clear waivers (DFA) instead.
      if (player._options?.outOfOptions) {
        // eslint-disable-next-line no-console
        console.info(`[RosterPlanner] Demote blocked for ${player.meta?.name}: out of options. Use DFA / Departing instead.`);
        return;
      }
      applyMove(playerId, "demote");
    } else if (targetBucket === "departing") {
      applyMove(playerId, "dfa");
    } else if (targetBucket === "prospects" || targetBucket === "r5Risk") {
      setMoves(prev => {
        const next = { ...prev };
        delete next[playerId];
        saveMoves(next);
        return next;
      });
    }
  }, [projection, applyMove]);

  const draggedPlayer = activeDragId ? projection.enriched.find(p => p._uid === activeDragId) : null;
  const openSlots = 40 - projection.fortyManCount;
  const seasonMoveCount = useMemo(
    () => Object.values(moves).filter(m => (m.startYear || gameYear + 1) === activePlanYear).length,
    [moves, activePlanYear, gameYear]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Section title="Roster Planner" actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <TabGroup label="Planning year">
            {Array.from({ length: YEAR_COUNT }, (_, i) => {
              const yr = gameYear + i;
              const offset = i;
              return (
                <PillBtn key={yr} active={planYearOffset === offset} onClick={() => setPlanYearOffset(offset)}>
                  {yr}
                </PillBtn>
              );
            })}
          </TabGroup>
          <button onClick={undoLast} disabled={moveHistory.length === 0}
            style={{ ...S.pillBtn, borderColor: moveHistory.length > 0 ? "#64748b" : "#334155", color: moveHistory.length > 0 ? "#94a3b8" : "#334155" }}>
            Undo
          </button>
          <button onClick={resetPlan} disabled={Object.keys(moves).length === 0}
            style={{ ...S.pillBtn, borderColor: Object.keys(moves).length > 0 ? "#dc2626" : "#334155", color: Object.keys(moves).length > 0 ? "#fca5a5" : "#334155" }}>
            Reset
          </button>
        </div>
      }>
        <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#64748b", marginBottom: 12 }}>
          <span><span style={{ borderBottom: "1px dashed #22c55e", paddingBottom: 1 }}>Dashed</span> = Club Option</span>
          <span><span style={{ borderBottom: "1px dotted #22c55e", paddingBottom: 1 }}>Dotted</span> = Vesting Option</span>
          <span><em style={{ color: "#4ade80" }}>Italic</em> = Player Option</span>
          <span>Drag players between sections to model roster moves</span>
        </div>
      </Section>

      {/* Summary Cards */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <SummaryCard label="40-Man" value={`${projection.fortyManCount}/40`}
          color={projection.fortyManCount > 40 ? "#fca5a5" : "#4ade80"}
          alert={projection.fortyManCount > 40} />
        <SummaryCard label="Active" value={`${projection.activeCount}/26`}
          color={projection.activeCount > 26 ? "#fca5a5" : "#93c5fd"} />
        {planYearOffset > 0 && (
          <SummaryCard label="R5 Protect" value={r5.shortlist.length}
            subtitle={`FV ≥ ${r5Threshold.toFixed(1)}`}
            color={r5.shortlist.length > 0 ? "#fb923c" : "#4ade80"} />
        )}
        <SummaryCard label="Out of Options" value={projection.outOfOptions}
          color={projection.outOfOptions > 0 ? "#fde047" : "#94a3b8"} />
        <SummaryCard label="Open Slots" value={openSlots}
          color={openSlots <= 0 ? "#fca5a5" : openSlots <= 2 ? "#fde047" : "#4ade80"}
          alert={openSlots < 0} />
        {shouldShowSuperTwo(projection.superTwoInfo) && (
          <SummaryCard label="Super-Two Cutoff"
            value={projection.superTwoInfo.cutoffLabel}
            subtitle={superTwoSubtitle(projection.superTwoInfo, gameYear)}
            color="#a78bfa"
            onClick={() => setS2ModalOpen(true)} />
        )}
        {seasonMoveCount > 0 && (
          <SummaryCard label="Planned Moves" value={seasonMoveCount} color="#a78bfa" />
        )}
      </div>

      {/* Crunch Warnings */}
      {warnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {warnings.map((w, i) => {
            const ss = SEVERITY_STYLES[w.severity];
            return (
              <div key={i} style={{
                padding: "8px 14px", borderRadius: 6,
                background: ss.bg, border: `1px solid ${ss.border}`, color: ss.color,
                fontSize: 12, fontWeight: 600,
              }}>
                {w.message}
              </div>
            );
          })}
        </div>
      )}

      <OutOfOptionsDecisionsPanel players={outOfOptionsDecisions}
        activePlanYear={activePlanYear} moves={moves} applyMove={applyMove} />

      <ArbitrationDecisionsPanel players={arbDecisions}
        activePlanYear={activePlanYear} moves={moves} applyMove={applyMove} deleteMove={deleteMove} />

      <OptionDecisionsPanel optionDecisions={optionDecisions} projection={projection}
        activePlanYear={activePlanYear} moves={moves} applyMove={applyMove} />

      <ExpiringContractsPanel expiringPlayers={expiringPlayers} projection={projection}
        gameYear={gameYear} moves={moves} applyMove={applyMove} />

      {/* Depth Chart panels with DnD */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <ActiveDepthPanel depth={depth} onSelectPlayer={onSelectPlayer}
          hoveredPos={hoveredActivePos} setHoveredPos={setHoveredActivePos} />

        <InactiveDepthPanel depth={depth} onSelectPlayer={onSelectPlayer}
          hoveredPos={hoveredInactivePos} setHoveredPos={setHoveredInactivePos} />

        {planYearOffset > 0 && (
          <Rule5RiskPanel r5={r5} r5Threshold={r5Threshold} setR5Threshold={setR5Threshold}
            showOtherR5={showOtherR5} setShowOtherR5={setShowOtherR5} onSelectPlayer={onSelectPlayer} />
        )}

        <MlfaSection mlfaPlayers={mlfaPlayers} activePlanYear={activePlanYear}
          showMlfa={showMlfaSection} setShowMlfa={setShowMlfaSection}
          moves={moves} applyMove={applyMove} onSelectPlayer={onSelectPlayer} />

        <DroppablePanel
          bucketId="departing"
          title="Drop here to DFA / Release"
          subtitle="Drag any player into this zone to mark them as removed from the roster plan"
          accent={BUCKET_CONFIG.departing.color}
        >
          <div style={{ padding: "10px 12px", color: "#64748b", fontSize: 11, fontStyle: "italic" }}>
            {projection.buckets.departing.length > 0
              ? `${projection.buckets.departing.length} player${projection.buckets.departing.length === 1 ? "" : "s"} flagged as departing.`
              : "Empty — drag players here to remove them from the roster plan."}
          </div>
        </DroppablePanel>

        <DragOverlay>
          {draggedPlayer && <DragOverlayRow player={draggedPlayer} />}
        </DragOverlay>
      </DndContext>

      <SuggestionsPanel suggestions={suggestions}
        showSuggestions={showSuggestions} setShowSuggestions={setShowSuggestions}
        moves={moves} applyMove={applyMove} />

      <MovesLogPanel movesLog={movesLog} totalMoves={Object.keys(moves).length} deleteMove={deleteMove} reorderMoves={reorderMoves} />

      <SuperTwoDetailModal open={s2ModalOpen} info={projection.superTwoInfo}
        gameYear={gameYear} onClose={() => setS2ModalOpen(false)} />
    </div>
  );
}
