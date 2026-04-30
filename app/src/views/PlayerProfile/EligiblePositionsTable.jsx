import { memo } from "react";
import { S, posColor, waaStyle } from "../../theme.js";
import { fmt } from "../../utils/helpers.js";
import { getWaa, getWaaP, getRunsP } from "../../utils/accessors.js";

function EligiblePositionsTable({ player, eligiblePositions, bestRunsPPos }) {
  if (!eligiblePositions || eligiblePositions.length === 0) return null;
  return (
    <div style={{ padding: "12px 18px" }}>
      <div style={{ fontSize: 9, color: "#475569", marginBottom: 6, letterSpacing: 1 }}>ELIGIBLE POSITIONS</div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr>
            {["Pos", "WAA", "WAA P", "vs LHP", "vs RHP", "RunsP"].map(h => <th key={h} style={{ ...S.th, padding: "4px 8px" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {eligiblePositions.map(pos => {
              const isBest = pos === bestRunsPPos;
              return (
                <tr key={pos} style={{ background: isBest ? "rgba(34,197,94,0.06)" : "transparent" }}>
                  <td style={{ ...S.td, color: posColor(pos), fontWeight: 700 }}>{pos}{isBest ? " ★" : ""}</td>
                  <td style={{ ...S.td, ...waaStyle(getWaa(player, pos)) }}>{fmt(getWaa(player, pos))}</td>
                  <td style={{ ...S.td, ...waaStyle(getWaaP(player, pos)) }}>{fmt(getWaaP(player, pos))}</td>
                  <td style={{ ...S.td, ...waaStyle(getWaa(player, pos, "vL")) }}>{fmt(getWaa(player, pos, "vL"))}</td>
                  <td style={{ ...S.td, ...waaStyle(getWaa(player, pos, "vR")) }}>{fmt(getWaa(player, pos, "vR"))}</td>
                  <td style={{ ...S.td, ...waaStyle(getRunsP(player, pos)) }}>{fmt(getRunsP(player, pos))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default memo(EligiblePositionsTable);
