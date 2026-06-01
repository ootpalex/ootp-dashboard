// ============================================================================
// SHARED UI COMPONENTS — Reusable primitives and hooks
// ============================================================================
import { useState, useRef, useEffect, useMemo, memo } from "react";
import * as Papa from "papaparse";
import { S } from "../theme.js";
import { categorizeLevel, LEVEL_CATEGORY_ORDER } from "../utils/accessors.js";

export function NumInput({ value, onChange, min, max, step, style }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft !== null ? draft : value}
      onChange={(e) => {
        const raw = e.target.value;
        const v = parseFloat(raw);
        if (raw !== "" && !isNaN(v)) {
          onChange(Math.max(min, Math.min(max, v)));
          setDraft(raw);
        } else {
          setDraft(raw);
        }
      }}
      onFocus={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) {
          const v = parseFloat(draft);
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
          setDraft(null);
        }
      }}
      style={style}
    />
  );
}

export function Section({ title, children, actions }) {
  return (
    <div style={S.section}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={S.sectionTitle}>{title}</h2>
        {actions && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function SortHeader({ label, width, sortCol, sortDir, colKey, onClick }) {
  const active = sortCol === colKey;
  const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }} tabIndex={0} role="columnheader" aria-sort={ariaSort} aria-label={`Sort by ${label}${active ? (sortDir === "asc" ? ", ascending" : ", descending") : ""}`} style={{ ...S.th, width, minWidth: width, cursor: "pointer", userSelect: "none" }}>
      <span>{label}</span>{active && <span style={{ marginLeft: 3, fontSize: 10 }} aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

export function PillBtn({ active, onClick, children, style: extraStyle, role: roleProp, ariaLabel }) {
  return (
    <button onClick={onClick} role={roleProp || "tab"} aria-selected={active} aria-label={ariaLabel} style={{ ...S.pillBtn, background: active ? "rgba(96,165,250,0.2)" : "transparent", color: active ? "#93c5fd" : "#64748b", borderColor: active ? "#3b82f6" : "#1e293b", ...extraStyle }}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// MultiSelectDropdown — generic checkbox dropdown used by every
// styled multi-select filter on the dashboard. value is an array;
// empty array = no filter. Each option:
//   { value: string, label: string,
//     dividerBefore?: bool, indent?: bool, header?: bool }
// `header: true` rows are non-selectable group headings.
// ─────────────────────────────────────────────────────────────
export function MultiSelectDropdown({ options, value, onChange, placeholder = "All", ariaLabel = "Filter", minWidth = 200, popoverMinWidth = 220, summaryFormat }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const sel = Array.isArray(value) ? value : [];
  const toggle = (opt) => onChange(sel.includes(opt) ? sel.filter((o) => o !== opt) : [...sel, opt]);
  const clear = () => onChange([]);

  // Build label text: pull each selected value's label from options for nicer text.
  const labelFor = (val) => options.find((o) => o.value === val)?.label ?? val;
  let label;
  if (typeof summaryFormat === "function") label = summaryFormat(sel);
  else if (sel.length === 0) label = placeholder;
  else if (sel.length === 1) label = labelFor(sel[0]);
  else if (sel.length <= 3) label = sel.map(labelFor).join(", ");
  else label = `${sel.slice(0, 2).map(labelFor).join(", ")} +${sel.length - 2}`;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={{
          padding: "6px 10px 6px 12px",
          background: "linear-gradient(#0f172a, #0a0f1c)",
          border: "1px solid",
          borderColor: open ? "#3b82f6" : sel.length ? "#475569" : "#334155",
          borderRadius: 8,
          color: sel.length ? "#93c5fd" : "#94a3b8",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
          minWidth,
          textAlign: "left",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          boxShadow: open ? "0 0 0 3px rgba(59,130,246,0.18)" : "0 1px 2px rgba(0,0,0,0.2)",
          transition: "all 0.15s",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
          {sel.length > 1 && (
            <span style={{ padding: "1px 6px", borderRadius: 8, background: "rgba(59,130,246,0.25)", fontSize: 10, color: "#bfdbfe", fontWeight: 700 }}>{sel.length}</span>
          )}
        </span>
        <span style={{ fontSize: 9, color: "#64748b", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          minWidth: popoverMinWidth,
          maxHeight: 380,
          overflowY: "auto",
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 8,
          boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
          zIndex: 1000,
          padding: 6,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px 6px", fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
            <span>{ariaLabel}</span>
            {sel.length > 0 && (
              <button type="button" onClick={clear} style={{ background: "none", border: "none", color: "#60a5fa", fontSize: 10, cursor: "pointer", padding: 0, fontFamily: "inherit", fontWeight: 700, letterSpacing: 0.5 }}>
                CLEAR ALL
              </button>
            )}
          </div>
          {options.flatMap((opt) => {
            const checked = sel.includes(opt.value);
            const items = [];
            if (opt.dividerBefore) {
              items.push(<div key={opt.value + "-div"} style={{ height: 1, background: "#1e293b", margin: "4px 6px" }} />);
            }
            if (opt.header) {
              items.push(
                <div key={opt.value} style={{ padding: "6px 8px 2px", fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>{opt.label}</div>
              );
              return items;
            }
            items.push(
              <label key={opt.value} style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 8px",
                paddingLeft: opt.indent ? 22 : 8,
                borderRadius: 4,
                cursor: "pointer",
                background: checked ? "rgba(59,130,246,0.15)" : "transparent",
                color: checked ? "#bfdbfe" : "#cbd5e1",
                fontSize: 12,
                fontWeight: checked ? 600 : 500,
                userSelect: "none",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = "rgba(96,165,250,0.07)"; }}
              onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = "transparent"; }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(opt.value)} style={{ accentColor: "#3b82f6", margin: 0, cursor: "pointer" }} />
                <span>{opt.label}</span>
              </label>
            );
            return items;
          })}
        </div>
      )}
    </div>
  );
}

// Standardized position filter — same options and order on every page.
// value is an array of selected entries (empty = no filter).
export const POSITION_FILTER_ORDER = ["Hitters", "Pitchers", "SP", "RP", "C", "1B", "2B", "3B", "SS", "INF", "LF", "CF", "RF", "OF"];
const POSITION_FILTER_DIVIDERS = new Set(["SP", "C"]);
const POSITION_FILTER_OPTIONS = POSITION_FILTER_ORDER.map((p) => ({
  value: p,
  label: p,
  dividerBefore: POSITION_FILTER_DIVIDERS.has(p),
}));

export function PositionFilter({ value, onChange }) {
  return (
    <MultiSelectDropdown
      options={POSITION_FILTER_OPTIONS}
      value={value}
      onChange={onChange}
      placeholder="All Positions"
      ariaLabel="Filter by position"
    />
  );
}

// LevelFilter — auto-detects categories from `players` and (optionally) expands
// the Rookie category into per-team rows when it contains 2+ unique teams.
export function LevelFilter({ players, value, onChange, expandRookieTeams = true, placeholder = "All Levels" }) {
  const options = useMemo(() => {
    if (!players || players.length === 0) return [];
    const catSet = new Set();
    // Rookie team aggregation: keyed by team_id (preferred) or tm string (fallback).
    // Also tracks whether tm strings collide so we can disambiguate labels.
    const rookieByKey = new Map();
    const rookieTmCounts = new Map();
    for (const p of players) {
      const lev = p.meta?.lev ?? p.Lev;
      const cat = categorizeLevel(lev);
      if (!cat) continue;
      catSet.add(cat);
      if (cat === "Rookie" && expandRookieTeams) {
        const tid = p.meta?.team_id;
        const tm = p.meta?.tm;
        const key = tid != null ? "team:" + String(tid) : tm ? "tm:" + tm : null;
        if (key && !rookieByKey.has(key)) {
          rookieByKey.set(key, { key, tm: tm || "(no tm)", lev });
        }
        if (tm) rookieTmCounts.set(tm, (rookieTmCounts.get(tm) ?? 0) + (rookieByKey.has(key) ? 0 : 1));
      }
    }
    const opts = [];
    let firstAfterStandard = true;
    for (const cat of LEVEL_CATEGORY_ORDER) {
      if (!catSet.has(cat)) continue;
      if (cat === "Rookie" && expandRookieTeams && rookieByKey.size >= 2) {
        opts.push({ value: "__rookie_header", label: "Rookie", header: true, dividerBefore: !firstAfterStandard });
        const sorted = [...rookieByKey.values()].sort((a, b) => a.tm.localeCompare(b.tm));
        for (const t of sorted) {
          // If two rookie teams share the same tm string, label includes the raw lev for distinction.
          const dupe = rookieTmCounts.get(t.tm) > 1;
          const label = dupe ? `${t.tm} (${t.lev})` : t.tm;
          opts.push({ value: t.key, label, indent: true });
        }
      } else {
        opts.push({ value: cat, label: cat, dividerBefore: !firstAfterStandard });
      }
      firstAfterStandard = false;
    }
    return opts;
  }, [players, expandRookieTeams]);

  return (
    <MultiSelectDropdown
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      ariaLabel="Filter by level"
    />
  );
}

// ─────────────────────────────────────────────────────────────
// NumericRangeFilter — styled-button + popover filter for numeric
// ranges (Age, Pro Yrs, etc.) matching the MultiSelectDropdown look.
// Either side of the range can be left blank → open-ended filter.
//
// value: { min: string|number|"", max: string|number|"" }
// onChange: ({ min, max }) => void — both values are echoed back even
// when only one changes, so callers can manage a single piece of state.
// ─────────────────────────────────────────────────────────────
export function NumericRangeFilter({ label = "Range", value, onChange, step = 1, minWidth = 130 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const min = value?.min ?? "";
  const max = value?.max ?? "";
  const hasMin = min !== "" && min != null;
  const hasMax = max !== "" && max != null;
  const active = hasMin || hasMax;

  let summary;
  if (!active) summary = label;
  else if (hasMin && hasMax) summary = `${min} ≤ ${label} ≤ ${max}`;
  else if (hasMin) summary = `${label} ≥ ${min}`;
  else summary = `${label} ≤ ${max}`;

  const setMin = (v) => onChange({ min: v, max });
  const setMax = (v) => onChange({ min, max: v });
  const clear = () => onChange({ min: "", max: "" });

  const inputStyle = {
    background: "#0a0f1c",
    border: "1px solid #334155",
    borderRadius: 6,
    color: "#cbd5e1",
    padding: "6px 8px",
    fontSize: 12,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter by ${label}`}
        style={{
          padding: "6px 10px 6px 12px",
          background: "linear-gradient(#0f172a, #0a0f1c)",
          border: "1px solid",
          borderColor: open ? "#3b82f6" : active ? "#475569" : "#334155",
          borderRadius: 8,
          color: active ? "#93c5fd" : "#94a3b8",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
          minWidth,
          textAlign: "left",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          boxShadow: open ? "0 0 0 3px rgba(59,130,246,0.18)" : "0 1px 2px rgba(0,0,0,0.2)",
          transition: "all 0.15s",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span style={{ fontSize: 9, color: "#64748b", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
      </button>
      {open && (
        <div role="dialog" aria-label={`${label} range`} style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          minWidth: 220,
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 8,
          boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
          zIndex: 1000,
          padding: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
            <span>{label} range</span>
            {active && (
              <button type="button" onClick={clear} style={{ background: "none", border: "none", color: "#60a5fa", fontSize: 10, cursor: "pointer", padding: 0, fontFamily: "inherit", fontWeight: 700, letterSpacing: 0.5 }}>
                CLEAR
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, alignItems: "center" }}>
            <input type="number" placeholder="Min" step={step} value={min} onChange={(e) => setMin(e.target.value)} style={inputStyle} aria-label={`Minimum ${label}`} />
            <span style={{ color: "#64748b", fontSize: 11 }}>—</span>
            <input type="number" placeholder="Max" step={step} value={max} onChange={(e) => setMax(e.target.value)} style={inputStyle} aria-label={`Maximum ${label}`} />
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#475569", lineHeight: 1.4 }}>
            Leave a side blank for an open-ended filter.
          </div>
        </div>
      )}
    </div>
  );
}

export function TabGroup({ children, label, style: extraStyle }) {
  return (
    <div role="tablist" aria-label={label} style={extraStyle}>
      {children}
    </div>
  );
}

export const TwoWayBadge = memo(({ player }) => player._twoWay ? (
  <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3,
    background: "rgba(251,191,36,0.2)", color: "#fbbf24", marginLeft: 4, fontWeight: 600 }}>
    2-WAY {player._type === "hitter" ? "(H)" : "(P)"}
  </span>
) : null);

export function Toggle({ label, checked, onChange, description, disabled = false }) {
  const handleClick = (e) => {
    e.preventDefault();
    if (disabled) return;
    onChange(!checked);
  };
  const labelColor = disabled ? "#475569" : (checked ? "#e2e8f0" : "#94a3b8");
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", padding: "4px 0", opacity: disabled ? 0.55 : 1 }} title={disabled ? description : undefined}>
      <div onClick={handleClick} style={{ width: 36, height: 20, borderRadius: 10, background: checked ? "#3b82f6" : "#334155", position: "relative", cursor: disabled ? "not-allowed" : "pointer", transition: "background 0.2s", flexShrink: 0 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: "#e2e8f0", position: "absolute", top: 2, left: checked ? 18 : 2, transition: "left 0.2s" }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: labelColor, fontWeight: 600 }}>{label}</div>
        {description && <div style={{ fontSize: 10, color: "#475569", marginTop: 1 }}>{description}</div>}
      </div>
    </label>
  );
}

export function FileDropZone({ label, fileName, onFile, ready }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      style={{ ...S.dropZone, borderColor: ready ? "#22c55e" : dragOver ? "#60a5fa" : "#334155", background: ready ? "rgba(34,197,94,0.06)" : dragOver ? "rgba(96,165,250,0.06)" : "rgba(15,23,42,0.5)" }}>
      <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
      <span style={{ color: ready ? "#86efac" : "#94a3b8", fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ color: ready ? "#4ade80" : "#475569", fontSize: 12, marginTop: 4 }}>{ready ? `✓ ${fileName}` : "Click or drag CSV"}</span>
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPrev, onNext }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
      <span style={{ fontSize: 12, color: "#64748b" }}>{total.toLocaleString()} items</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button onClick={onPrev} disabled={page === 0} style={S.pageBtn}>← Prev</button>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Page {page + 1} of {Math.max(1, totalPages)}</span>
        <button onClick={onNext} disabled={page >= totalPages - 1} style={S.pageBtn}>Next →</button>
      </div>
    </div>
  );
}

export function DataLoader({ onDataLoaded, initSettings }) {
  const [hittersFile, setHittersFile] = useState(null);
  const [pitchersFile, setPitchersFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hReady, setHReady] = useState(false);
  const [pReady, setPReady] = useState(false);
  const hData = useRef(null), pData = useRef(null);
  const parseFile = (file) => new Promise((res, rej) => Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => res(r.data), error: rej }));
  const handleFile = async (file, type) => {
    if (type === "h") { setHittersFile(file.name); hData.current = await parseFile(file); setHReady(true); }
    else { setPitchersFile(file.name); pData.current = await parseFile(file); setPReady(true); }
  };
  const leagueName = initSettings?.leagueName || "SSB";
  return (
    <div style={S.loaderContainer}>
      <div style={S.loaderCard}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: -2, color: "#e2e8f0" }}>{leagueName}</span>
          <span style={{ fontSize: 14, color: "#64748b", marginTop: 4, letterSpacing: 3, textTransform: "uppercase" }}>GM Dashboard</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
          <FileDropZone label="Hitters CSV" fileName={hittersFile} onFile={(f) => handleFile(f, "h")} ready={hReady} />
          <FileDropZone label="Pitchers CSV" fileName={pitchersFile} onFile={(f) => handleFile(f, "p")} ready={pReady} />
        </div>
        {error && <div style={S.errorBox}>{error}</div>}
        <button onClick={async () => { setLoading(true); setError(null); try { onDataLoaded(hData.current, pData.current); } catch (e) { setError(e.message); } setLoading(false); }}
          disabled={!hReady || !pReady || loading} style={{ ...S.loadBtn, opacity: (!hReady || !pReady || loading) ? 0.4 : 1, cursor: (!hReady || !pReady || loading) ? "not-allowed" : "pointer" }}>
          {loading ? "Processing..." : "Load Dashboard"}
        </button>
      </div>
    </div>
  );
}

