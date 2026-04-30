import { memo, useMemo } from "react";
import { S } from "../../theme.js";
import { fmtMLD, fmtSalary } from "../../utils/helpers.js";
import {
  parseContractStatus,
  resolveContractYear,
  calcR5Projection,
  calcMLFA,
  getOptionsInfo,
} from "../../utils/rosterPlanning/index.js";

const sectionLabel = { fontSize: 9, color: "#475569", marginBottom: 6, letterSpacing: 1 };
const tS = { background: "rgba(15,23,42,0.6)", borderRadius: 6, border: "1px solid #1e293b", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 };
const tL = { fontSize: 9, color: "#475569", letterSpacing: 1, textTransform: "uppercase" };
const tV = { fontSize: 13, fontWeight: 700, color: "#e2e8f0" };

const STATUS_STYLE = {
  signed:    { label: "Signed",    color: "#60a5fa" },
  arb:       { label: "Arbitration", color: "#fbbf24" },
  "pre-arb": { label: "Pre-Arb",   color: "#a3e635" },
  fa:        { label: "Free Agent",color: "#94a3b8" },
  minors:    { label: "Minor Lg",  color: "#f472b6" },
};
const OPTION_LABEL = { club: "Team Option", player: "Player Option", vesting: "Vesting Option" };

// Per-year rendering helpers — `_projection.baseline[year]` already encodes
// all of: salary report data, signed contract resolution, arb/pre-arb
// projections, minor-league progression, MiLB FA, and 40-man pre-arb override.
function rowFromBaseline(entry) {
  if (!entry) return null;
  return {
    status: entry.status,
    statusLabel: entry.statusLabel || entry.label || "—",
    salary: entry.salary ?? null,
    optionType: entry.optionType ?? null,
    buyout: entry.buyout ?? 0,
    guaranteed: entry.guaranteed,
  };
}

// Fallback: when _projection isn't available, derive a row from contract +
// parsed status + game year. Less rich (no salary report data) but produces
// a year row.
function rowFromFallback({ player, contract, status, calendarYear, gameYear, isMinors }) {
  const resolved = contract ? resolveContractYear(contract, calendarYear) : null;
  if (resolved && (resolved.salary > 0 || resolved.optionType)) {
    return {
      status: resolved.optionType ? "option" : "signed",
      statusLabel: resolved.optionType ? OPTION_LABEL[resolved.optionType] : "Signed",
      salary: resolved.salary || null,
      optionType: resolved.optionType,
      buyout: resolved.buyout || 0,
    };
  }
  const offset = calendarYear - gameYear;
  const mlbYearsAtSeason = (status.mlbYears ?? 0) + offset;

  if (calendarYear >= status.faYear && status.type !== "minors") {
    return { status: "fa", statusLabel: "Free Agent", salary: null };
  }
  if (status.type === "minors") {
    return { status: "minors", statusLabel: "Minors", salary: null };
  }
  if (status.type === "arb" || (status.type === "pre-arb" && mlbYearsAtSeason >= 3)) {
    const arbNum = Math.max(1, Math.min(3, mlbYearsAtSeason - (status.isSuperTwo ? 1 : 2)));
    return { status: "arb", statusLabel: `Arb-${arbNum} (proj.)`, salary: null };
  }
  if (status.type === "pre-arb") {
    return { status: "pre-arb", statusLabel: "Pre-Arb", salary: null };
  }
  return { status: "signed", statusLabel: "Signed", salary: null };
}

function ContractTab({ player, gameYear }) {
  const proj = player._projection ?? null;
  const status = useMemo(
    () => proj?.contractStatus ?? parseContractStatus(player, gameYear),
    [proj, player, gameYear],
  );
  const r5 = useMemo(
    () => proj?.r5 ?? calcR5Projection(player, gameYear),
    [proj, player, gameYear],
  );
  const mlfa = useMemo(
    () => proj?.mlfa ?? calcMLFA(player, gameYear),
    [proj, player, gameYear],
  );
  const opts = useMemo(
    () => proj?.options ?? getOptionsInfo(player),
    [proj, player],
  );
  const contract = player.contract || null;

  const meta = player.meta ?? {};
  const isMinors = status.type === "minors";

  // Decide year horizon. For minor leaguers, extend to MiLB FA year so the
  // user can see the full control window.
  const horizon = useMemo(() => {
    let lastYear = gameYear;
    if (proj?.baseline) {
      // Pipeline emitted ≥1 year. Use whatever it shipped.
      const baselineYears = Object.keys(proj.baseline).map((y) => parseInt(y, 10));
      if (baselineYears.length > 0) lastYear = Math.max(lastYear, Math.max(...baselineYears));
    }
    if (status.controlEnd) lastYear = Math.max(lastYear, status.controlEnd);
    if (contract?.extension) {
      const extEnd = (contract.seasonYear || gameYear) + (contract.years || 0) + (contract.extension.years || 0) - 1;
      lastYear = Math.max(lastYear, extEnd);
    }
    if (isMinors && mlfa?.mlfaYear) {
      lastYear = Math.max(lastYear, mlfa.mlfaYear);
    }
    // Cap at 14 years out so the table doesn't run forever.
    return Math.min(lastYear, gameYear + 14);
  }, [proj, status, contract, isMinors, mlfa, gameYear]);

  const rows = useMemo(() => {
    const playerAge = player._age != null ? Math.floor(player._age) : null;
    const out = [];
    for (let year = gameYear; year <= horizon; year++) {
      const baselineEntry = proj?.baseline?.[String(year)] ?? proj?.baseline?.[year];
      const r = rowFromBaseline(baselineEntry)
        ?? rowFromFallback({ player, contract, status, calendarYear: year, gameYear, isMinors });

      // R5 markers — apply to every year between r5Year and mlfa year (or the
      // end of our row range), as long as the player isn't on the 40-man.
      const r5Year = r5?.r5Year;
      const r5Eligible = !r5?.isProtected
        && r5Year != null
        && year >= r5Year
        && (mlfa?.mlfaYear == null || year < mlfa.mlfaYear)
        // Once they've signed an MLB deal / cleared 40-man / become FA, the R5
        // gate is moot.
        && (r.status === "minors" || r.status === "fa")
        && r.statusLabel !== "MiLB FA";

      out.push({
        year,
        age: playerAge != null ? playerAge + (year - gameYear) : null,
        ...r,
        r5Eligible,
      });

      // Stop after the player hits MLB free agency. We still want to render
      // the FA row itself — that tells the user when they hit the open market —
      // but no further years past it. Minor-league rows continue all the way
      // to MiLB FA so the user can see the full control window.
      if (r.status === "fa") break;
    }
    return out;
  }, [horizon, proj, player, contract, status, gameYear, isMinors, r5, mlfa]);

  const stStyle = STATUS_STYLE[status.type] ?? STATUS_STYLE.signed;
  const summaryParts = [];
  if (status.type === "signed") {
    summaryParts.push(`Signed through ${status.controlEnd}`);
  } else if (status.type === "arb") {
    summaryParts.push(`Arb ${status.arbYearNum ?? "?"} of 3 — FA ${status.faYear}`);
  } else if (status.type === "pre-arb") {
    summaryParts.push(`Pre-arb — Arb ${status.arbStartYear ?? "?"}, FA ${status.faYear}`);
  } else if (status.type === "minors") {
    const r5Bit = r5?.r5Year != null
      ? (r5.isProtected ? "R5 protected" : `R5 eligible ${r5.r5Year}`)
      : "";
    const mlfaBit = mlfa?.mlfaYear ? `MiLB FA ${mlfa.mlfaYear}` : "";
    summaryParts.push(["Minor leaguer", r5Bit, mlfaBit].filter(Boolean).join(" · "));
  } else if (status.type === "fa") {
    summaryParts.push("Free agent");
  }
  if (status.isSuperTwo) summaryParts.push("Super-Two candidate");

  return (
    <div style={{ padding: "12px 18px" }}>
      {/* Status header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 4,
          background: `${stStyle.color}1f`, color: stStyle.color, letterSpacing: 0.6, textTransform: "uppercase",
        }}>
          {stStyle.label}
        </span>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{summaryParts.join(" · ")}</span>
        {contract?.noTrade && (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#fbbf24",
                         border: "1px solid #fbbf2444", background: "#fbbf2415", padding: "2px 6px", borderRadius: 4 }}>
            NO-TRADE
          </span>
        )}
      </div>

      {/* Quick-facts grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 14 }}>
        <div style={tS}>
          <span style={tL}>MLB Service</span>
          <span style={tV}>{fmtMLD(meta.mld)}</span>
        </div>
        <div style={tS}>
          <span style={tL}>Pro Years</span>
          <span style={tV}>{meta.proy ?? "—"}</span>
        </div>
        <div style={tS}>
          <span style={tL}>Options</span>
          <span style={tV}>
            {opts.used}/3 used
            {opts.outOfOptions && (
              <span style={{ fontSize: 10, color: "#f87171", marginLeft: 6, fontWeight: 700 }}>OUT</span>
            )}
          </span>
        </div>
        <div style={tS}>
          <span style={tL}>{isMinors || (status.type === "pre-arb" || status.type === "arb") ? "FA Year" : "Contract End"}</span>
          <span style={tV}>{status.faYear || "—"}</span>
        </div>
        {(isMinors || r5?.r5Year != null) && (
          <div style={tS}>
            <span style={tL}>R5 Eligible</span>
            <span style={{ ...tV, color: r5?.isProtected ? "#94a3b8" : (r5?.r5Countdown === 0 ? "#f87171" : "#fbbf24") }}>
              {r5?.isProtected ? "Protected (40-Man)" :
                r5?.r5Year == null ? "—" :
                r5.r5Countdown === 0 ? "Now" :
                `${r5.r5Year} (${r5.r5Countdown}y)`}
            </span>
          </div>
        )}
        {isMinors && (
          <div style={tS}>
            <span style={tL}>MiLB FA</span>
            <span style={tV}>{mlfa?.eligible ? "Now" : (mlfa?.mlfaYear ?? "—")}</span>
          </div>
        )}
        {status.isSuperTwo && (
          <div style={tS}>
            <span style={tL}>Super-Two</span>
            <span style={{ ...tV, color: "#fbbf24" }}>Yes</span>
          </div>
        )}
      </div>

      {/* Year-by-year breakdown */}
      <div style={sectionLabel}>YEAR-BY-YEAR</div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr>
            {["Year", "Age", "Status", "Salary", "Notes"].map((h) => (
              <th key={h} style={{ ...S.th, padding: "5px 9px" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const notes = [];
              if (r.optionType) notes.push(OPTION_LABEL[r.optionType]);
              if (r.buyout) notes.push(`Buyout ${fmtSalary(r.buyout) || "—"}`);
              if (r.r5Eligible) notes.push("R5 eligible");
              if (r.guaranteed === false) notes.push("Non-guaranteed");
              if (r.status === "fa" && meta.dem && meta.dem !== "-") notes.push(`Demand: ${meta.dem}`);
              const statusColor = r.status === "fa" ? "#94a3b8"
                : r.status === "minors" ? "#f472b6"
                : r.status === "arb" ? "#fbbf24"
                : r.status === "pre-arb" ? "#a3e635"
                : r.status === "option" ? "#a78bfa"
                : "#cbd5e1";
              return (
                <tr key={r.year} style={r.r5Eligible ? { background: "rgba(251,191,36,0.05)" } : undefined}>
                  <td style={{ ...S.td, fontWeight: 700, color: "#e2e8f0" }}>{r.year}</td>
                  <td style={S.td}>{r.age ?? "—"}</td>
                  <td style={{ ...S.td, color: statusColor }}>{r.statusLabel}</td>
                  <td style={S.td}>{fmtSalary(r.salary) || "—"}</td>
                  <td style={{ ...S.td, color: "#64748b" }}>{notes.join(" · ") || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {contract?.extension && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
          Extension begins {contract.seasonYear + contract.years} ({contract.extension.years} year{contract.extension.years === 1 ? "" : "s"})
        </div>
      )}
      {meta.dfa && meta.dfa !== "-" && (
        <div style={{ marginTop: 4, fontSize: 11, color: "#fbbf24" }}>
          DFA status: {meta.dfa}
        </div>
      )}
    </div>
  );
}

export default memo(ContractTab);
