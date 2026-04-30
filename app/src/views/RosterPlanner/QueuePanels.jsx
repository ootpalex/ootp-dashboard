// Forced-choice action queues at the top of the planner. All panels are
// collapsible so they don't dominate the page when the list grows long.
import { useState } from "react";
import { S, posColor } from "../../theme.js";
import { fmtSalary } from "../../utils/helpers.js";

function CollapsiblePanel({ title, count, accent, headerBg, headerColor, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: `${accent}0d`, border: `1px solid ${accent}`,
      borderRadius: 8, padding: 0, marginBottom: 12,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          padding: "10px 14px", borderBottom: open ? `1px solid ${accent}` : "none",
          background: headerBg || `${accent}14`, borderRadius: open ? "8px 8px 0 0" : 8,
          border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ color: headerColor, fontSize: 11, fontWeight: 700, width: 12 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: headerColor }}>
          {title}{count != null ? ` (${count})` : ""}
        </span>
      </button>
      {open && <div style={{ padding: "4px 8px" }}>{children}</div>}
    </div>
  );
}

function QueueRow({ children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "6px 8px",
      borderBottom: "1px solid #1e293b",
    }}>
      {children}
    </div>
  );
}

export function OptionDecisionsPanel({ optionDecisions, projection, activePlanYear, moves, applyMove }) {
  if (optionDecisions.length === 0) return null;
  return (
    <CollapsiblePanel
      title={`Team Options Due (${activePlanYear})`}
      count={optionDecisions.length}
      accent="#78350f"
      headerBg="rgba(251,191,36,0.08)"
      headerColor="#fde047"
    >
      {optionDecisions.map(ep => {
        const meta = ep.meta || {};
        const optStatus = projection.years[activePlanYear]?.[ep._uid];
        const decision = moves[ep._uid]?.action;
        return (
          <QueueRow key={ep._uid}>
            <span style={{ color: posColor(meta.pos), fontWeight: 700, fontSize: 11, width: 28 }}>{meta.pos}</span>
            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, flex: 1 }}>{meta.name}</span>
            <span style={{ color: "#fde047", fontSize: 11 }}>{optStatus?.label || "Team Opt"}</span>
            {!decision ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => applyMove(ep._uid, "accept_option")}
                  style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#4ade80", fontSize: 10, padding: "3px 10px" }}>
                  Accept
                </button>
                <button onClick={() => applyMove(ep._uid, "decline_option")}
                  style={{ ...S.pillBtn, borderColor: "#ef4444", color: "#fca5a5", fontSize: 10, padding: "3px 10px" }}>
                  Decline
                </button>
              </div>
            ) : (
              <span style={{ fontSize: 10, color: decision === "accept_option" ? "#4ade80" : "#fca5a5", fontWeight: 600 }}>
                {decision === "accept_option" ? "Accepted" : "Declined"}
              </span>
            )}
          </QueueRow>
        );
      })}
    </CollapsiblePanel>
  );
}

export function ExpiringContractsPanel({ expiringPlayers, projection, gameYear, moves, applyMove }) {
  if (expiringPlayers.length === 0) return null;
  return (
    <CollapsiblePanel
      title="Expiring Contracts"
      count={expiringPlayers.length}
      accent="#7f1d1d"
      headerBg="rgba(239,68,68,0.08)"
      headerColor="#fca5a5"
    >
      {expiringPlayers.map(ep => {
        const meta = ep.meta || {};
        // OOTP's DEM column is a per-player salary demand string. It works out
        // to roughly the player's expected average annual value on the open
        // market, so it's a useful ballpark for projected re-sign cost.
        const demRaw = meta.dem ?? ep.DEM;
        const demStr = (demRaw != null && demRaw !== "" && demRaw !== "-") ? String(demRaw) : null;
        const alreadySigned = moves[ep._uid]?.action === "sign";
        return (
          <QueueRow key={ep._uid}>
            <span style={{ color: posColor(meta.pos), fontWeight: 700, fontSize: 11, width: 28 }}>{meta.pos}</span>
            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, flex: 1 }}>{meta.name}</span>
            <span style={{ color: demStr ? "#fbbf24" : "#475569", fontSize: 11, fontWeight: 600, minWidth: 80, textAlign: "right" }}
              title="OOTP salary demand — approximate AAV for re-signing">
              {demStr ? `${demStr} demand` : "—"}
            </span>
            {!alreadySigned ? (
              <button onClick={() => applyMove(ep._uid, "sign")}
                style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#4ade80", fontSize: 10, padding: "3px 10px" }}>
                Re-sign
              </button>
            ) : (
              <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 600 }}>Re-signed</span>
            )}
          </QueueRow>
        );
      })}
    </CollapsiblePanel>
  );
}

export function OutOfOptionsDecisionsPanel({ players, activePlanYear, moves, applyMove }) {
  if (players.length === 0) return null;
  return (
    <CollapsiblePanel
      title={`Out of Options (${activePlanYear}) — must promote or DFA`}
      count={players.length}
      accent="#7f1d1d"
      headerBg="rgba(239,68,68,0.10)"
      headerColor="#fca5a5"
    >
      {players.map(ep => {
        const meta = ep.meta || {};
        const decision = moves[ep._uid]?.action;
        const decisionLabel =
          decision === "promote" ? "Promoted" :
          decision === "dfa" ? "DFA" :
          decision === "trade" ? "Traded" : null;
        return (
          <QueueRow key={ep._uid}>
            <span style={{ color: posColor(meta.pos), fontWeight: 700, fontSize: 11, width: 28 }}>{meta.pos}</span>
            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, flex: 1 }}>{meta.name}</span>
            <span style={{ color: "#fca5a5", fontSize: 10, fontWeight: 700 }}>NoOpt</span>
            {!decisionLabel ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => applyMove(ep._uid, "promote")}
                  style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#4ade80", fontSize: 10, padding: "3px 10px" }}>
                  Promote
                </button>
                <button onClick={() => applyMove(ep._uid, "dfa")}
                  style={{ ...S.pillBtn, borderColor: "#ef4444", color: "#fca5a5", fontSize: 10, padding: "3px 10px" }}>
                  DFA
                </button>
              </div>
            ) : (
              <span style={{ fontSize: 10, color: decision === "promote" ? "#4ade80" : "#fca5a5", fontWeight: 600 }}>
                {decisionLabel}
              </span>
            )}
          </QueueRow>
        );
      })}
    </CollapsiblePanel>
  );
}

export function ArbitrationDecisionsPanel({ players, activePlanYear, moves, applyMove, deleteMove }) {
  if (players.length === 0) return null;
  return (
    <CollapsiblePanel
      title={`Arbitration Eligible (${activePlanYear}) — tender or non-tender`}
      count={players.length}
      accent="#1e3a8a"
      headerBg="rgba(96,165,250,0.10)"
      headerColor="#93c5fd"
    >
      {players.map(ep => {
        const meta = ep.meta || {};
        const yearStatus = ep._yearStatus;
        const salaryLabel = fmtSalary(yearStatus?.salary);
        const arbLabel = yearStatus?.statusLabel || "Arb";
        const arbKey = `t:${ep._uid}:${activePlanYear}`;
        const decision = moves[arbKey]?.action;
        const decisionLabel =
          decision === "tender" ? "Signed" :
          decision === "nonTender" ? "Non-Tendered" : null;
        return (
          <QueueRow key={ep._uid}>
            <span style={{ color: posColor(meta.pos), fontWeight: 700, fontSize: 11, width: 28 }}>{meta.pos}</span>
            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, flex: 1 }}>{meta.name}</span>
            <span style={{ color: "#93c5fd", fontSize: 11, fontWeight: 600, minWidth: 60 }}>{arbLabel}</span>
            <span style={{ color: salaryLabel ? "#fbbf24" : "#475569", fontSize: 11, fontWeight: 600, minWidth: 64, textAlign: "right" }}
              title="Projected non-guaranteed arbitration salary">
              {salaryLabel || "—"}
            </span>
            {!decisionLabel ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => applyMove(ep._uid, "tender")}
                  style={{ ...S.pillBtn, borderColor: "#22c55e", color: "#4ade80", fontSize: 10, padding: "3px 10px" }}>
                  Sign
                </button>
                <button onClick={() => applyMove(ep._uid, "nonTender")}
                  style={{ ...S.pillBtn, borderColor: "#ef4444", color: "#fca5a5", fontSize: 10, padding: "3px 10px" }}>
                  Non-Tender
                </button>
              </div>
            ) : (
              <button onClick={() => deleteMove?.(arbKey)}
                title="Click to undo"
                style={{ ...S.pillBtn, fontSize: 10, padding: "3px 10px",
                  borderColor: decision === "nonTender" ? "#ef4444" : "#22c55e",
                  color: decision === "nonTender" ? "#fca5a5" : "#4ade80", fontWeight: 600 }}>
                {decisionLabel} ✕
              </button>
            )}
          </QueueRow>
        );
      })}
    </CollapsiblePanel>
  );
}
