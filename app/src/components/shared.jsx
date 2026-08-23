// ============================================================================
// SHARED UI COMPONENTS — Reusable primitives and hooks
// Styling: Night Scorecard (graphite) — every colour comes from TOKENS / S in
// ../theme.js (batch 1 of app/docs/redesign/MIGRATION_PLAN.md).
// ============================================================================
import { useState, useRef, useEffect, useMemo, memo } from "react";
import * as Papa from "papaparse";
import { TOKENS as T, S } from "../theme.js";
import { categorizeLevel, LEVEL_CATEGORY_ORDER } from "../utils/accessors.js";

const R = T.radius;
// The one allowed non-inset shadow: the keyboard focus ring.
const FOCUS_RING = `0 0 0 2px ${T.focusRing}`;
const focusStyle = { border: `1px solid ${T.focus}`, boxShadow: FOCUS_RING };

// Focus-visible tracking for inline-styled controls (inline styles have no
// :focus-visible). Mouse focus does not light the ring; keyboard focus does.
function useFocusRing() {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    onFocus: (e) => { try { setFocused(e.currentTarget.matches(":focus-visible")); } catch { setFocused(true); } },
    onBlur: () => setFocused(false),
  };
}

// Sunken text/number input ("well"): bg fill, line2 rule, focus → focus border + ring.
function WellInput({ style, ...props }) {
  const ring = useFocusRing();
  return (
    <input
      {...props}
      onFocus={(e) => { ring.onFocus(e); props.onFocus?.(e); }}
      onBlur={(e) => { ring.onBlur(e); props.onBlur?.(e); }}
      style={{ ...S.searchInput, ...style, ...(ring.focused ? focusStyle : {}) }}
    />
  );
}

// Inline magnifier for search wells (mockup `.toolbar .search`), drawn in text3.
const SEARCH_ICON = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(T.text3)}' stroke-width='2.2' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/></svg>")`;
export const searchWellStyle = { ...S.searchInput, paddingLeft: 26, backgroundImage: SEARCH_ICON, backgroundRepeat: "no-repeat", backgroundSize: 13, backgroundPosition: "8px center" };

// Search well with the inline magnifier (first consumers: the board toolbars in batch 2).
export function SearchInput({ style, ...props }) {
  return <WellInput {...props} style={{ ...searchWellStyle, ...style }} />;
}

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

// Scorecard box: panel + line2 rule + header strip. `count` / `state` /
// `toolbar` / `footer` are additive (batch 1); `title`, `children`, `actions`
// keep their meaning.
export function Section({ title, children, actions, count, state, toolbar, footer }) {
  return (
    <div style={S.box}>
      <div style={S.boxHead}>
        <h2 style={{ ...S.sectionTitle, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span>{title}</span>
          {count != null && count !== "" && <span style={{ fontWeight: 500, color: T.text3 }}>{count}</span>}
        </h2>
        {(state != null || actions) && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {state != null && <span style={S.boxHeadRight}>{state}</span>}
            {actions}
          </div>
        )}
      </div>
      {toolbar && <div style={S.toolbar}>{toolbar}</div>}
      <div style={{ padding: 12 }}>{children}</div>
      {footer && <div style={S.boxFoot}>{footer}</div>}
    </div>
  );
}

export function SortHeader({ label, width, sortCol, sortDir, colKey, onClick }) {
  const active = sortCol === colKey;
  const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }} tabIndex={0} role="columnheader" aria-sort={ariaSort} aria-label={`Sort by ${label}${active ? (sortDir === "asc" ? ", ascending" : ", descending") : ""}`}
      onMouseEnter={(e) => { e.currentTarget.style.color = T.text; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = active ? T.text : T.text2; }}
      style={{ ...S.th, ...(active ? S.thSorted : {}), width, minWidth: width, cursor: "pointer", userSelect: "none" }}>
      <span>{label}</span>{active && <span style={{ marginLeft: 3, fontSize: 10 }} aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

export function PillBtn({ active, onClick, children, style: extraStyle, role: roleProp, ariaLabel }) {
  return (
    <button onClick={onClick} role={roleProp || "tab"} aria-selected={active} aria-label={ariaLabel}
      style={{ ...S.pillBtn, fontSize: 13, ...(active ? { background: T.accentBg, color: T.accent, borderColor: T.accent } : { background: T.panel, color: T.text2, borderColor: T.line2 }), ...extraStyle }}>
      {children}
    </button>
  );
}

// Raised select-style trigger shared by MultiSelectDropdown / NumericRangeFilter.
const triggerStyle = ({ open, active, focused, minWidth }) => ({
  ...S.filterSelect,
  padding: "5px 8px 5px 10px",
  border: `1px solid ${open || focused ? T.focus : T.line2}`,
  color: active ? T.accent : T.text,
  minWidth,
  textAlign: "left",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  boxShadow: focused ? FOCUS_RING : "none",
  transition: "border-color 0.12s",
});
const caretStyle = (open) => ({ fontSize: 9, color: T.text3, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s" });
// Opaque popover: panel + line2 + r3, no shadow.
const popoverStyle = { position: "absolute", top: "calc(100% + 4px)", left: 0, background: T.panel, border: `1px solid ${T.line2}`, borderRadius: R, zIndex: 1000 };
const popoverHeadStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 600, color: T.text2 };
const clearLinkStyle = { background: "none", border: "none", color: T.accent, fontFamily: T.fonts.narrow, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 };

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
  const ring = useFocusRing();
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
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={triggerStyle({ open, active: sel.length > 0, focused: ring.focused, minWidth })}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
          {sel.length > 1 && (
            <span style={{ padding: "0 5px", borderRadius: R, background: T.accentBg, border: `1px solid ${T.accent}`, fontSize: 10.5, lineHeight: "14px", color: T.accent, fontWeight: 700 }}>{sel.length}</span>
          )}
        </span>
        <span style={caretStyle(open)} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" style={{ ...popoverStyle, minWidth: popoverMinWidth, maxHeight: 380, overflowY: "auto", padding: 4 }}>
          <div style={{ ...popoverHeadStyle, padding: "5px 8px 6px", borderBottom: `1px solid ${T.line}`, marginBottom: 3 }}>
            <span>{ariaLabel}</span>
            {sel.length > 0 && (
              <button type="button" onClick={clear} style={clearLinkStyle}>Clear all</button>
            )}
          </div>
          {options.flatMap((opt) => {
            const checked = sel.includes(opt.value);
            const items = [];
            if (opt.dividerBefore) {
              items.push(<div key={opt.value + "-div"} style={{ height: 1, background: T.line, margin: "3px 6px" }} />);
            }
            if (opt.header) {
              items.push(
                <div key={opt.value} style={{ padding: "5px 8px 2px", fontFamily: T.fonts.narrow, fontSize: 12, color: T.text3, fontWeight: 600 }}>{opt.label}</div>
              );
              return items;
            }
            items.push(
              <label key={opt.value} style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "5px 8px",
                paddingLeft: opt.indent ? 22 : 8,
                borderRadius: R,
                cursor: "pointer",
                background: checked ? T.accentBg : "transparent",
                color: checked ? T.text : T.text2,
                fontSize: 12.5,
                fontWeight: checked ? 600 : 500,
                userSelect: "none",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = T.panel3; }}
              onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = "transparent"; }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(opt.value)} style={{ accentColor: T.accent, margin: 0, cursor: "pointer" }} />
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
  const ring = useFocusRing();
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

  const inputStyle = { width: "100%", boxSizing: "border-box", textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter by ${label}`}
        style={triggerStyle({ open, active, focused: ring.focused, minWidth })}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span style={caretStyle(open)} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div role="dialog" aria-label={`${label} range`} style={{ ...popoverStyle, minWidth: 220, padding: 10 }}>
          <div style={{ ...popoverHeadStyle, marginBottom: 8 }}>
            <span>{label} range</span>
            {active && (
              <button type="button" onClick={clear} style={clearLinkStyle}>Clear</button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, alignItems: "center" }}>
            <WellInput type="number" placeholder="Min" step={step} value={min} onChange={(e) => setMin(e.target.value)} style={inputStyle} aria-label={`Minimum ${label}`} />
            <span style={{ color: T.text3, fontSize: 11 }}>–</span>
            <WellInput type="number" placeholder="Max" step={step} value={max} onChange={(e) => setMax(e.target.value)} style={inputStyle} aria-label={`Maximum ${label}`} />
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: T.text3, lineHeight: 1.4 }}>
            Leave a side blank for an open-ended filter.
          </div>
        </div>
      )}
    </div>
  );
}

// Pills laid out in a panel2 strip; callers' `style` still wins.
export function TabGroup({ children, label, style: extraStyle }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: 3, background: T.panel2, border: `1px solid ${T.line2}`, borderRadius: R, ...extraStyle }}>
      {children}
    </div>
  );
}

// Outlined warn chip (D.6).
export const TwoWayBadge = memo(({ player }) => player._twoWay ? (
  <span style={{ display: "inline-block", fontFamily: T.fonts.narrow, fontWeight: 700, fontSize: 10, lineHeight: "14px", padding: "0 4px", borderRadius: R,
    background: "transparent", border: `1px solid ${T.warn}`, color: T.warn, marginLeft: 4, verticalAlign: 1 }}>
    2-WAY {player._type === "hitter" ? "(H)" : "(P)"}
  </span>
) : null);

// Toggle — `variant="inline"` (default: toolbars, stacked lists as today) or
// `variant="row"` (ruled row: 8/12 padding, line rule above, hover panel2).
// The switch is a 30×17 well (off) or the red pencil (on); it is keyboard
// focusable (role=switch, Space/Enter) and shows the focus ring.
export function Toggle({ label, checked, onChange, description, disabled = false, variant = "inline" }) {
  const row = variant === "row";
  const ring = useFocusRing();
  const handleClick = (e) => {
    e.preventDefault();
    if (disabled) return;
    onChange(!checked);
  };
  const labelColor = disabled ? T.textDisabled : (checked ? T.text : T.text2);
  return (
    <label
      style={{ display: "flex", alignItems: row ? "flex-start" : "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer", padding: row ? "8px 12px" : "4px 0", opacity: disabled ? 0.55 : 1, ...(row ? { borderTop: `1px solid ${T.line}` } : {}) }}
      title={disabled ? description : undefined}
      onMouseEnter={row && !disabled ? (e) => { e.currentTarget.style.background = T.panel2; } : undefined}
      onMouseLeave={row && !disabled ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}>
      <div onClick={handleClick}
        role="switch" aria-checked={checked} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") handleClick(e); }}
        onFocus={ring.onFocus} onBlur={ring.onBlur}
        style={{ width: 30, height: 17, boxSizing: "border-box", borderRadius: 9, background: checked ? T.accent : T.bg, border: `1px solid ${checked ? T.accent : T.line2}`, position: "relative", cursor: disabled ? "not-allowed" : "pointer", transition: "background 0.12s, border-color 0.12s", flexShrink: 0, marginTop: row ? 2 : 0, outline: "none", boxShadow: ring.focused ? FOCUS_RING : "none" }}>
        <div style={{ width: 11, height: 11, borderRadius: "50%", background: checked ? T.accentText : T.text3, position: "absolute", top: 2, left: checked ? 15 : 2, transition: "left 0.12s ease" }} />
      </div>
      <div>
        <div style={{ fontSize: row ? 13 : 12.5, color: labelColor, fontWeight: 600 }}>{label}</div>
        {description && <div style={{ fontSize: row ? 12 : 11, color: T.text3, marginTop: row ? 1 : 0 }}>{description}</div>}
      </div>
    </label>
  );
}

export function FileDropZone({ label, fileName, onFile, ready }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      style={{ ...S.dropZone, borderColor: ready ? T.good : dragOver ? T.accent : T.line2, background: ready ? T.goodBg : dragOver ? T.accentBg2 : T.bg }}>
      <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
      <span style={{ color: ready ? T.good : T.text2, fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ color: ready ? T.goodSoft : T.text3, fontSize: 12, marginTop: 4 }}>{ready ? `✓ ${fileName}` : "Click or drag CSV"}</span>
    </div>
  );
}

// Foot strip: panel2 + line2 top rule, Archivo Narrow 12.5 text2; count left, pager right.
export function Pagination({ page, totalPages, total, onPrev, onNext }) {
  const prevOff = page === 0;
  const nextOff = page >= totalPages - 1;
  const btn = (off) => ({ ...S.pageBtn, ...(off ? { color: T.textDisabled, borderColor: T.line, cursor: "default" } : {}) });
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 12px", background: T.panel2, borderTop: `1px solid ${T.line2}`, fontFamily: T.fonts.narrow, fontSize: 12.5, color: T.text2 }}>
      <span>{total.toLocaleString()} items</span>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={onPrev} disabled={prevOff} style={btn(prevOff)}>‹ Prev</button>
        <span>Page {page + 1} of {Math.max(1, totalPages)}</span>
        <button onClick={onNext} disabled={nextOff} style={btn(nextOff)}>Next ›</button>
      </div>
    </div>
  );
}

export function DataLoader({ onDataLoaded, initSettings, autoLoadError }) {
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
          <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.04em", color: T.text, lineHeight: 1 }}>{leagueName}</span>
          <span style={{ fontSize: 13, color: T.text3, marginTop: 6, fontFamily: T.fonts.narrow, fontWeight: 500 }}>GM Dashboard</span>
        </div>
        {autoLoadError && <div style={S.errorBox}>Auto-load failed: {autoLoadError}</div>}
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
