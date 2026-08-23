import { useEffect, useMemo, useState } from "react";
import { TOKENS as T, S, posChip, levelChip, proneColor, gradeToColor, devPctColor, warStyle, mixOklab } from "../../theme.js";
import { fmtAge, fmt, num, parseCSVBoolean, orgLabel } from "../../utils/helpers.js";
import { getMaxWar, getMaxWarP, getSpWar, getRpWar, getSpWarP, getRpWarP, isEligible } from "../../utils/accessors.js";
import { HITTER_POS } from "../../utils/constants.js";
import { TwoWayBadge, PillBtn, TabGroup } from "../../components/shared.jsx";

import FVProjectionChart from "./FVProjectionChart.jsx";
import PercentileHeader from "./PercentileHeader.jsx";
import BattingTab from "./BattingTab.jsx";
import FieldingTab from "./FieldingTab.jsx";
import BaserunningTab from "./BaserunningTab.jsx";
import PitchingTab from "./PitchingTab.jsx";
import ContractTab from "./ContractTab.jsx";
import { buildHitterPeerPools, buildPitcherPeerPools, resolvePosAdj, TILE, TILE_LABEL, chipCss } from "./_shared.js";

const HITTER_TABS = [
  { id: "batting", label: "Batting" },
  { id: "fielding", label: "Fielding" },
  { id: "baserunning", label: "Baserunning" },
  { id: "contract", label: "Contract" },
];
const PITCHER_TABS = [
  { id: "pitching", label: "Pitching" },
  { id: "contract", label: "Contract" },
];

// Header stat tiles — 8px-grid tiles on panel2 / line / r3 (B.8).
const tileBox = { ...TILE, minHeight: 48, justifyContent: "center" };
const tileLabel = TILE_LABEL;
const tileVal = { fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" };

// Outlined status chip with a ~10% fill of its hue over the panel (D.6).
const statusChip = (hue) => ({ ...S.badge, color: hue, border: `1px solid ${hue}`, background: mixOklab(hue, 0.10, T.panel) });

function Tile({ label, value, valueColor, sub, subColor }) {
  return (
    <div style={tileBox}>
      <span style={tileLabel}>{label}</span>
      <span style={{ ...tileVal, color: valueColor || T.text }}>
        {value ?? "—"}
        {sub != null && <span style={{ fontSize: 11, fontWeight: 500, color: subColor || T.text3, marginLeft: 4 }}>{sub}</span>}
      </span>
    </div>
  );
}

function HeaderTiles({ player }) {
  const meta = player.meta || {};
  const ovr = num(meta.ovr ?? player.OVR);
  const pot = num(meta.pot ?? player.POT);
  const fv = player._fv;
  const devPct = !player._ageMatured && player._devPct != null ? player._devPct : null;
  const prone = meta.prone ?? player.Prone;
  const bats = meta.bats ?? player.B ?? "?";
  const throws = meta.throws ?? player.T ?? "?";

  // Top row gives B/T extra width so "L / R" (or "S / R") never wraps.
  // Bottom row mirrors the same template for visual alignment.
  const cols = "1fr 1fr 1.35fr 1fr";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6 }}>
        <Tile label="Age" value={fmtAge(player._age)} />
        <Tile label="Org" value={orgLabel(player) || "—"} valueColor={T.text2} />
        <Tile label="B / T" value={`${bats} / ${throws}`} />
        <Tile label="Prone" value={prone || "—"} valueColor={prone ? proneColor(prone) : undefined} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6 }}>
        <Tile label="OVR" value={ovr ?? "—"} valueColor={ovr != null ? gradeToColor(ovr) : undefined} />
        <Tile label="POT" value={pot ?? "—"} valueColor={pot != null ? gradeToColor(pot) : undefined} />
        <Tile label="FV" value={fv != null ? fmt(fv, 2) : "—"} valueColor={fv != null ? warStyle(fv).color : undefined} />
        <Tile label="Dev%" value={devPct != null ? `${Math.round(devPct * 100)}th` : "—"}
              valueColor={devPct != null ? devPctColor(devPct) : undefined} />
      </div>
    </div>
  );
}

export default function PlayerProfileModal({ player, onClose, data, curveSettings, gameDate, leagueSlug }) {
  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const isHitter = player._type === "hitter";
  const isStarter = !isHitter && (player.starter ?? parseCSVBoolean(player.Starter));
  const isSPEligible = !isHitter && (isStarter || (player.starterP ?? parseCSVBoolean(player["Starter P"])));

  // SP/RP toggle for SP-eligible pitchers; defaults to whichever role currently looks better.
  const [role, setRole] = useState(() => {
    if (isHitter) return "sp";
    if (!isSPEligible) return "rp";
    return player._role === "rp" ? "rp" : "sp";
  });
  const [activeTab, setActiveTab] = useState(() => isHitter ? "batting" : "pitching");

  const tabs = isHitter ? HITTER_TABS : PITCHER_TABS;

  // FV projection chart inputs (kept verbatim from prior implementation).
  const currentWAR = isHitter
    ? getMaxWar(player)
    : (role === "sp" ? getSpWar(player) : getRpWar(player)) ?? (player._sp?.war ?? player._rp?.war);
  const potentialWAR = isHitter
    ? getMaxWarP(player)
    : (role === "sp" ? getSpWarP(player) : getRpWarP(player)) ?? (player._sp?.warP ?? player._rp?.warP);
  const effectivePotWAR = potentialWAR ?? currentWAR;
  const showFVChart = currentWAR != null && player._age != null;

  const devGapCurve = useMemo(() => {
    if (!showFVChart) return new Map();
    const maturityAge = curveSettings?.maxCurrentAge ?? 27;
    const bandwidth   = curveSettings?.bandwidth     ?? 2.0;
    const pool = isHitter ? data.hitters : data.pitchers;

    const gapData = [];
    for (const p of pool) {
      const age = p._age;
      const cur = isHitter
        ? getMaxWar(p)
        : (getSpWar(p) ?? getRpWar(p));
      const pot = isHitter
        ? getMaxWarP(p)
        : (getSpWarP(p) ?? getRpWarP(p));
      if (age != null && cur != null && pot != null)
        gapData.push({ age, gap: Math.max(0, pot - cur) });
    }
    if (gapData.length < 10) return new Map();

    const sorted = [...gapData].sort((a, b) => a.gap - b.gap);

    const wPct = (gaps, ws, totalW, p) => {
      let cumW = 0;
      const target = p * totalW;
      for (let i = 0; i < gaps.length; i++) {
        cumW += ws[i];
        if (cumW >= target) return gaps[i];
      }
      return gaps[gaps.length - 1];
    };

    const result = new Map();
    for (let age = 14; age <= maturityAge; age++) {
      const weighted = sorted
        .map(d => ({ gap: d.gap, w: Math.exp(-0.5 * ((d.age - age) / bandwidth) ** 2) }))
        .filter(d => d.w > 0.001);
      const totalW = weighted.reduce((s, d) => s + d.w, 0);
      if (totalW < 1) continue;
      const gaps = weighted.map(d => d.gap);
      const ws   = weighted.map(d => d.w);
      result.set(age, {
        p10:    wPct(gaps, ws, totalW, 0.1),
        median: wPct(gaps, ws, totalW, 0.5),
        p90:    wPct(gaps, ws, totalW, 0.9),
      });
    }
    return result;
  }, [showFVChart, isHitter, data, curveSettings]);

  const fvChartData = useMemo(() => {
    if (!showFVChart) return [];
    const maturityAge  = curveSettings?.maxCurrentAge ?? 27;
    const playerDevPct = player._devPct ?? 0.5;
    const gap = Math.max(0, (effectivePotWAR ?? currentWAR) - currentWAR);
    const startAge = Math.floor(player._age);
    const endAge   = maturityAge + 6;
    if (startAge > endAge) return [];

    const curveAt = (age) => devGapCurve.get(Math.max(14, Math.min(maturityAge, age)));

    const baseEntry = curveAt(startAge);
    const baseP10  = baseEntry?.p10  ?? null;
    const baseP90  = baseEntry?.p90  ?? null;

    const FLOOR_DEV_CAP = 25;

    const fracRealized = (age, pctKey, base, ageCap = Infinity) => {
      if (startAge >= maturityAge) return 1;
      if (base == null || base <= 0) {
        return Math.max(0, Math.min(1, (age - startAge) / (maturityAge - startAge)));
      }
      const entry = curveAt(Math.min(age, ageCap));
      if (!entry) return age >= maturityAge ? 1 : 0;
      return Math.max(0, Math.min(1, 1 - entry[pctKey] / base));
    };

    const DECLINE_CEILING = 0.30;
    const DECLINE_CENTER  = 0.50;
    const DECLINE_FLOOR   = 0.80;

    let matureCeiling, matureCenter, matureFloor;
    if (startAge >= maturityAge) {
      matureCeiling = matureCenter = matureFloor = currentWAR;
    } else {
      const fcCeil  = fracRealized(maturityAge, 'p10', baseP10);
      const fcFloor = fracRealized(maturityAge, 'p90', baseP90, FLOOR_DEV_CAP);
      matureCeiling = currentWAR + gap * fcCeil;
      matureFloor   = currentWAR + gap * fcFloor;
      matureCenter  = matureFloor + (matureCeiling - matureFloor) * playerDevPct;
    }

    const rows = [];
    for (let age = startAge; age <= endAge; age++) {
      if (age <= maturityAge) {
        const fcCeil   = fracRealized(age, 'p10', baseP10);
        const fcFloor  = fracRealized(age, 'p90', baseP90, FLOOR_DEV_CAP);
        const fcCenter = fcFloor + (fcCeil - fcFloor) * playerDevPct;
        rows.push({
          age,
          ceiling: Math.round((currentWAR + gap * fcCeil)   * 100) / 100,
          center:  Math.round((currentWAR + gap * fcCenter) * 100) / 100,
          floor:   Math.round((currentWAR + gap * fcFloor)  * 100) / 100,
        });
      } else {
        const yp = age - maturityAge;
        rows.push({
          age,
          ceiling: Math.round((matureCeiling - DECLINE_CEILING * yp) * 100) / 100,
          center:  Math.round((matureCenter  - DECLINE_CENTER  * yp) * 100) / 100,
          floor:   Math.round((matureFloor   - DECLINE_FLOOR   * yp) * 100) / 100,
        });
      }
    }
    return rows;
  }, [showFVChart, devGapCurve, player._age, player._devPct, currentWAR, effectivePotWAR, curveSettings]);

  // Peer pools for the percentile header. Recomputed when role changes (pitchers).
  const peerPools = useMemo(() => {
    if (isHitter) return buildHitterPeerPools(data.hitters, resolvePosAdj(data.meta));
    return { ...buildPitcherPeerPools(data.pitchers, role), role };
  }, [isHitter, data, role]);

  const eligiblePositions = isHitter ? HITTER_POS.filter(pos => isEligible(player, pos)) : [];
  const bestRunsPPos = (player._bestPos || "").replace("*", "");

  const isInjured = (player.meta?.inj != null ? player.meta.inj === "Yes" : parseCSVBoolean(player.INJ));
  const badges = [];
  if (player.meta?.on40 ?? parseCSVBoolean(player.ON40)) badges.push({ label: "40-Man", color: T.accent });
  if (player.meta?.r5 ?? parseCSVBoolean(player.R5)) badges.push({ label: "R5", color: T.bad });
  if (isInjured) badges.push({ label: `INJ${player.Left ? " " + player.Left : ""}`, color: T.warn });
  const _modalOrg = player.meta?.org ?? player.ORG;
  const _modalManual = player.meta?.source ?? player.meta?.manual ?? player.Manual;
  if (_modalOrg === "-" && _modalManual) badges.push({ label: _modalManual.toLowerCase().includes("draft") ? "Draft" : _modalManual, color: T.CHART.series5 });

  // Game year for ContractTab. Falls back to current real year if no game date.
  const gameYear = useMemo(() => {
    if (gameDate) {
      const y = parseInt(String(gameDate).slice(0, 4), 10);
      if (!isNaN(y) && y > 1900) return y;
    }
    return new Date().getFullYear();
  }, [gameDate]);

  const headerPos = (player._bestPos || player.meta?.pos || player.POS || "");
  const headerLev = player.meta?.lev ?? player.Lev;

  return (
    <div style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={player.meta?.name ?? player.Name}
           style={{ ...S.box, width: 960, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", fontFamily: "inherit", position: "relative" }}
           onClick={e => e.stopPropagation()}>

        {/* Header strip — name · POS chip · level chip · badges left, ✕ right */}
        <div style={{ ...S.boxHead, padding: "8px 12px 8px 16px", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
            <span style={{ fontFamily: T.fonts.ui, fontSize: 20, fontWeight: 800, color: T.text, lineHeight: 1.1 }}>{player.meta?.name ?? player.Name}</span>
            <span style={{ ...S.badge, ...chipCss(posChip(headerPos.replace("*", ""))) }}>{headerPos || "—"}</span>
            {headerLev && headerLev !== "-" && <span style={{ ...S.badge, ...chipCss(levelChip(headerLev)) }}>{headerLev}</span>}
            <TwoWayBadge player={player} />
            {badges.map((b, i) => (
              <span key={i} style={statusChip(b.color)}>{b.label}</span>
            ))}
          </div>
          <button onClick={onClose} aria-label="Close"
                  style={{ ...S.btn, padding: "3px 9px", fontSize: 14, lineHeight: 1.2, color: T.text2, flexShrink: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.lineInk; e.currentTarget.style.color = T.text; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.line2; e.currentTarget.style.color = T.text2; }}>✕</button>
        </div>

        {/* 2-column header body: stat tiles on the left, percentile pills on the right */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(300px, 1fr) minmax(440px, 1.55fr)",
          gap: 20,
          padding: "12px 16px 14px",
          borderBottom: `1px solid ${T.line2}`,
          background: T.panel,
        }}>
          {/* Left column — tile grid (4 × 2) */}
          <HeaderTiles player={player} />

          {/* Right column — percentile pills + SP/RP toggle */}
          <div>
            <PercentileHeader
              player={player}
              isHitter={isHitter}
              isSPEligible={isSPEligible}
              peerPools={peerPools}
              role={role}
              onRoleChange={setRole}
            />
          </div>
        </div>

        {/* FV projection chart */}
        <FVProjectionChart
          player={player}
          fvChartData={fvChartData}
          showFVChart={showFVChart}
          potentialWAR={potentialWAR}
          curveSettings={curveSettings}
        />

        {/* Tab strip — a panel2 strip carrying the tab pills */}
        <div style={{ borderBottom: `1px solid ${T.line2}`, padding: "6px 16px", background: T.panel2 }}>
          <TabGroup label="Player profile sections" style={{ background: "transparent", border: "none", padding: 0, gap: 6, flexWrap: "wrap" }}>
            {tabs.map((t) => (
              <PillBtn
                key={t.id}
                active={activeTab === t.id}
                onClick={() => setActiveTab(t.id)}
                style={{ padding: "4px 14px" }}
              >
                {t.label}
              </PillBtn>
            ))}
          </TabGroup>
        </div>

        {/* Active tab body */}
        {isHitter && activeTab === "batting" && <BattingTab player={player} />}
        {isHitter && activeTab === "fielding" && (
          <FieldingTab
            player={player}
            eligiblePositions={eligiblePositions}
            bestRunsPPos={bestRunsPPos}
            peerPools={peerPools}
            leagueSlug={leagueSlug}
          />
        )}
        {isHitter && activeTab === "baserunning" && <BaserunningTab player={player} />}
        {!isHitter && activeTab === "pitching" && <PitchingTab player={player} role={role} />}
        {activeTab === "contract" && <ContractTab player={player} gameYear={gameYear} />}
      </div>
    </div>
  );
}
