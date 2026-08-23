// Forced-choice action queues at the top of the planner. All panels are
// collapsible so they don't dominate the page when the list grows long.
// Styling: scorecard box + header strip; the panel title carries the semantic
// colour (warn / bad / accent) instead of a tinted background.
import { useState } from "react";
import { TOKENS as T, S, posColor } from "../../theme.js";
import { fmtSalary } from "../../utils/helpers.js";
import { actionBtn } from "./_shared.js";

function CollapsiblePanel({ title, count, accent, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={S.box}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          ...S.boxHead, width: "100%", justifyContent: "flex-start", gap: 8, cursor: "pointer", textAlign: "left",
          paddingLeft: 14, boxShadow: `inset 3px 0 0 ${accent}`, color: accent,
          borderBottom: open ? `1px solid ${T.line2}` : "none", borderTop: "none", borderLeft: "none", borderRight: "none",
          borderBottomLeftRadius: open ? 0 : 2, borderBottomRightRadius: open ? 0 : 2,
        }}
      >
        <span style={{ color: T.text3, fontSize: 10, width: 12 }}>{open ? "▼" : "▶"}</span>
        <span>{title}</span>
        {count != null && <span style={{ fontWeight: 500, color: T.text3 }}>({count})</span>}
      </button>
      {open && <div style={{ padding: "0 0 2px" }}>{children}</div>}
    </div>
  );
}

function QueueRow({ children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "4px 12px", minHeight: 31,
      borderBottom: `1px solid ${T.line}`, fontSize: 12.5,
    }}>
      {children}
    </div>
  );
}

const posStyle = (pos) => ({ color: posColor(pos), fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 12.5, width: 28 });
const nameStyle = { color: T.text, fontWeight: 600, flex: 1 };
const decidedStyle = (ok) => ({ fontFamily: T.fonts.narrow, fontSize: 12, color: ok ? T.good : T.bad, fontWeight: 700 });

export function OptionDecisionsPanel({ optionDecisions, projection, activePlanYear, moves, applyMove }) {
  if (optionDecisions.length === 0) return null;
  return (
    <CollapsiblePanel
      title={`Team Options Due (${activePlanYear})`}
      count={optionDecisions.length}
      accent={T.warn}
    >
      {optionDecisions.map(ep => {
        const meta = ep.meta || {};
        const optStatus = projection.years[activePlanYear]?.[ep._uid];
        const decision = moves[ep._uid]?.action;
        return (
          <QueueRow key={ep._uid}>
            <span style={posStyle(meta.pos)}>{meta.pos}</span>
            <span style={nameStyle}>{meta.name}</span>
            <span style={{ color: T.warn, fontSize: 12, fontWeight: 600 }}>{optStatus?.label || "Team Opt"}</span>
            {!decision ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => applyMove(ep._uid, "accept_option")} style={actionBtn("good")}>
                  Accept
                </button>
                <button onClick={() => applyMove(ep._uid, "decline_option")} style={actionBtn("bad")}>
                  Decline
                </button>
              </div>
            ) : (
              <span style={decidedStyle(decision === "accept_option")}>
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
      accent={T.bad}
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
            <span style={posStyle(meta.pos)}>{meta.pos}</span>
            <span style={nameStyle}>{meta.name}</span>
            <span style={{ color: demStr ? T.warn : T.textDisabled, fontSize: 12, fontWeight: 600, minWidth: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
              title="OOTP salary demand — approximate AAV for re-signing">
              {demStr ? `${demStr} demand` : "—"}
            </span>
            {!alreadySigned ? (
              <button onClick={() => applyMove(ep._uid, "sign")} style={actionBtn("good")}>
                Re-sign
              </button>
            ) : (
              <span style={decidedStyle(true)}>Re-signed</span>
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
      accent={T.bad}
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
            <span style={posStyle(meta.pos)}>{meta.pos}</span>
            <span style={nameStyle}>{meta.name}</span>
            <span style={{ color: T.badSoft, fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 700 }}>NoOpt</span>
            {!decisionLabel ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => applyMove(ep._uid, "promote")} style={actionBtn("good")}>
                  Promote
                </button>
                <button onClick={() => applyMove(ep._uid, "dfa")} style={actionBtn("bad")}>
                  DFA
                </button>
              </div>
            ) : (
              <span style={decidedStyle(decision === "promote")}>
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
      accent={T.accent}
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
            <span style={posStyle(meta.pos)}>{meta.pos}</span>
            <span style={nameStyle}>{meta.name}</span>
            <span style={{ color: T.accent, fontSize: 12, fontWeight: 600, minWidth: 60 }}>{arbLabel}</span>
            <span style={{ color: salaryLabel ? T.warn : T.textDisabled, fontSize: 12, fontWeight: 600, minWidth: 64, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
              title="Projected non-guaranteed arbitration salary">
              {salaryLabel || "—"}
            </span>
            {!decisionLabel ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => applyMove(ep._uid, "tender")} style={actionBtn("good")}>
                  Sign
                </button>
                <button onClick={() => applyMove(ep._uid, "nonTender")} style={actionBtn("bad")}>
                  Non-Tender
                </button>
              </div>
            ) : (
              <button onClick={() => deleteMove?.(arbKey)}
                title="Click to undo"
                style={actionBtn(decision === "nonTender" ? "bad" : "good")}>
                {decisionLabel} ✕
              </button>
            )}
          </QueueRow>
        );
      })}
    </CollapsiblePanel>
  );
}
