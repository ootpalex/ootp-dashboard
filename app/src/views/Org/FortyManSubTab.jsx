import { useMemo } from "react";
import { S, posColor, levelColor, warStyle, zToColor } from "../../theme.js";
import { fmt, fmtAge, parseCSVBoolean, rankSuffix } from "../../utils/helpers.js";
import { getWar, getSpWar, getRpWar } from "../../utils/accessors.js";
import { ALL_DISPLAY_POS, DEF_SPECTRUM, ACTIVE_ROSTER_DEPTH } from "../../utils/constants.js";
import { optimizeDefensivePositions, assignPlayersToPositions } from "../../utils/positioning.js";
import { Section, TwoWayBadge } from "../../components/shared.jsx";

export default function FortyManSubTab({ data, team, strength, strengthMode, onSelectPlayer }) {
  const allTeamHitters = useMemo(() => data.hitters.filter((h) => (h.meta?.org ?? h.ORG) === team), [data.hitters, team]);
  const allTeamPitchers = useMemo(() => data.pitchers.filter((p) => (p.meta?.org ?? p.ORG) === team), [data.pitchers, team]);
  const fortyManHitters = useMemo(() => allTeamHitters.filter((h) => (h.meta?.on40 ?? (h.ON40 === "Yes"))), [allTeamHitters]);
  const fortyManPitchers = useMemo(() => allTeamPitchers.filter((p) => (p.meta?.on40 ?? (p.ON40 === "Yes"))), [allTeamPitchers]);

  const mlbHitters = useMemo(() => allTeamHitters.filter((h) =>
    ((h.meta?.lev ?? h.Lev) === "MLB" && (h.meta?.on40 ?? (h.ON40 === "Yes"))) || ((h.meta?.lev ?? h.Lev) === "MLB" && ((h.meta?.inj != null ? h.meta.inj === "Yes" : parseCSVBoolean(h.INJ))))
  ), [allTeamHitters]);
  const mlbPitchers = useMemo(() => allTeamPitchers.filter((p) =>
    ((p.meta?.lev ?? p.Lev) === "MLB" && (p.meta?.on40 ?? (p.ON40 === "Yes"))) || ((p.meta?.lev ?? p.Lev) === "MLB" && ((p.meta?.inj != null ? p.meta.inj === "Yes" : parseCSVBoolean(p.INJ))))
  ), [allTeamPitchers]);

  const depthChart = useMemo(() => {
    const { assigned: starters } = assignPlayersToPositions(mlbHitters, mlbPitchers, ACTIVE_ROSTER_DEPTH, "current");

    const hitterPositions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
    const rawStarters = [];
    hitterPositions.forEach((pos) => {
      if (starters[pos] && starters[pos].length > 0) rawStarters.push(starters[pos][0]);
    });
    if (rawStarters.length > 0) {
      const optimized = optimizeDefensivePositions(rawStarters, hitterPositions);
      hitterPositions.forEach((pos) => { starters[pos] = []; });
      optimized.forEach((p) => { starters[p._assignedPos] = [p]; });
    }

    const starterUids = new Set();
    Object.values(starters).forEach((players) => players.forEach((p) => starterUids.add(p._uid || p.ID)));

    const chart = {};
    ALL_DISPLAY_POS.forEach((pos) => { chart[pos] = [...(starters[pos] || [])]; });

    const usedIds = new Set(starterUids);
    const remainingHitters = fortyManHitters.filter((h) => !usedIds.has(h._uid || h.ID));
    let unplaced = [...remainingHitters];
    while (unplaced.length > 0) {
      let placedThisPass = false;
      DEF_SPECTRUM.forEach((pos) => {
        const stillUnplaced = unplaced.filter((h) => !usedIds.has(h._uid || h.ID));
        const cands = stillUnplaced
          .map((h) => ({ player: h, val: getWar(h, pos) }))
          .filter((c) => c.val !== null)
          .sort((a, b) => b.val - a.val);
        cands.forEach((c) => {
          if (usedIds.has(c.player._uid || c.player.ID)) return;
          let bestPos = pos, bestVal = c.val;
          DEF_SPECTRUM.forEach((otherPos) => {
            const v = getWar(c.player, otherPos);
            if (v !== null && v > bestVal) { bestVal = v; bestPos = otherPos; }
          });
          if (bestPos === pos) {
            chart[pos].push({ ...c.player, _assignedPos: pos, _assignedVal: c.val });
            usedIds.add(c.player._uid || c.player.ID);
            placedThisPass = true;
          }
        });
      });
      if (!placedThisPass) {
        unplaced.filter((h) => !usedIds.has(h._uid || h.ID)).forEach((h) => {
          let bestPos = "DH", bestVal = -Infinity;
          DEF_SPECTRUM.forEach((pos) => {
            const v = getWar(h, pos);
            if (v !== null && v > bestVal) { bestVal = v; bestPos = pos; }
          });
          chart[bestPos].push({ ...h, _assignedPos: bestPos, _assignedVal: bestVal === -Infinity ? null : bestVal });
          usedIds.add(h._uid || h.ID);
        });
      }
      unplaced = remainingHitters.filter((h) => !usedIds.has(h._uid || h.ID));
    }

    const remainPitchers = fortyManPitchers.filter((p) => !starterUids.has(p._uid || p.ID));
    remainPitchers.forEach((p) => {
      const isSP = (p.starter ?? parseCSVBoolean(p.Starter)) || (p.meta?.pos ?? p.POS) === "SP";
      if (isSP) {
        chart.SP.push({ ...p, _assignedPos: "SP", _assignedVal: getSpWar(p) });
      } else {
        chart.RP.push({ ...p, _assignedPos: "RP", _assignedVal: getRpWar(p) });
      }
    });

    ALL_DISPLAY_POS.forEach((pos) => {
      const starterGroup = chart[pos].filter((p) => starterUids.has(p._uid || p.ID));
      const depthGroup = chart[pos].filter((p) => !starterUids.has(p._uid || p.ID));
      depthGroup.sort((a, b) => (b._assignedVal ?? -999) - (a._assignedVal ?? -999));
      chart[pos] = [...starterGroup, ...depthGroup];
    });

    return { chart, starterUids };
  }, [mlbHitters, mlbPitchers, fortyManHitters, fortyManPitchers]);

  const teamZ = strength.zScores[strengthMode]?.[team] || {};
  const teamRanks = strength.ranks[strengthMode]?.[team] || {};
  const totalTeams = data.teams.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="40-Man Depth Chart">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
          {ALL_DISPLAY_POS.map((pos) => {
            const players = depthChart.chart[pos] || [];
            const z = teamZ[pos];
            const rank = teamRanks[pos];
            const colors = zToColor(z);
            return (
              <div key={pos} style={{ background: "rgba(15,23,42,0.4)", border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ background: colors.bg, borderBottom: `1px solid ${colors.border}`, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: posColor(pos) }}>{pos}</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: colors.value }}>
                      {rankSuffix(rank)}<span style={{ color: "#475569", fontWeight: 400 }}>/{totalTeams}</span>
                    </div>
                    <div style={{ fontSize: 9, color: colors.label }}>z: {fmt(z, 2)}</div>
                  </div>
                </div>
                <div style={{ padding: "4px 0" }}>
                  {players.length === 0 && (
                    <div style={{ padding: "8px 10px", color: "#334155", fontSize: 11, fontStyle: "italic" }}>No players</div>
                  )}
                  {players.map((p, i) => {
                    const war = p._assignedVal;
                    const isStarter = depthChart.starterUids.has(p._uid || p.ID);
                    return (
                      <div key={p.ID} style={{ padding: "4px 10px", borderBottom: i < players.length - 1 ? "1px solid #0f172a" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", background: isStarter ? "rgba(59,130,246,0.06)" : "transparent" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "#475569", fontWeight: 700, width: 16 }}>{i + 1}.</span>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: isStarter ? 700 : 500, color: isStarter ? "#e2e8f0" : "#94a3b8", cursor: "pointer" }} onClick={() => onSelectPlayer?.(p)}>{p.meta?.name ?? p.Name}<TwoWayBadge player={p} /></div>
                            <div style={{ fontSize: 10, color: "#475569", display: "flex", gap: 6 }}>
                              <span style={{ color: levelColor(p.meta?.lev ?? p.Lev) }}>{p.meta?.lev ?? p.Lev}</span>
                              <span>Age {fmtAge(p._age)}</span>
                              {p._bestPos && <span style={{ color: posColor(p._bestPos.replace("*", "")) }}>Best: {p._bestPos}</span>}
                            </div>
                          </div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, ...warStyle(war) }}>{fmt(war)}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ background: "rgba(15,23,42,0.6)", padding: "2px 10px", fontSize: 10, color: "#334155", textAlign: "center" }}>
                  {players.length} player{players.length !== 1 ? "s" : ""}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <div style={{ fontSize: 12, color: "#475569" }}>
        Total 40-man: {fortyManHitters.length + fortyManPitchers.length} players ({fortyManHitters.length} position, {fortyManPitchers.length} pitchers)
      </div>
    </div>
  );
}
