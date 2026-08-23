#!/usr/bin/env node
// WCAG 2.x contrast audit of theme.next.js. Prints Markdown tables; anything
// below 4.5:1 is flagged "< 4.5" (AA-large threshold 3.0 shown as "≥3 (large only)").
// Usage: node contrast.mjs   (CHECKS.md pastes this output)
import { TOKENS as T, GRADE, GRADE_WEIGHT, FV_TIER_COLORS, POS, LEVEL, PRONE, zHeat, zToColor, gradeToColor, contrastRatio, mixOklab, levelColor, posColor, intangibleColor, signColor, scoutingRatingColor, devPctColor } from "../../src/theme.js";

const cr = (a, b) => contrastRatio(a, b);
const f = (x) => x.toFixed(2);
const flag = (x) => (x >= 4.5 ? "ok" : x >= 3 ? "**< 4.5** (≥3, large only)" : "**< 3**");
const row = (...cells) => console.log("| " + cells.join(" | ") + " |");
const head = (...cells) => { row(...cells); row(...cells.map(() => "---")); };
let fails = [];
const note = (what, x) => { if (x < 4.5) fails.push(`${what} = ${f(x)}:1`); };

console.log("## 1. Text tokens on the three grounds (panel / zebra / panel2)\n");
head("token", "hex", "on panel " + T.panel, "on zebra " + T.zebra, "on panel2 " + T.panel2, "on panel3 " + T.panel3, "verdict");
for (const k of ["text", "text2", "text3", "textDisabled", "accent", "accentHover", "good", "goodSoft", "bad", "badSoft", "warn", "focus"]) {
  const hx = T[k]; const c = [T.panel, T.zebra, T.panel2, T.panel3].map((g) => cr(hx, g));
  row(k, hx, ...c.map(f), flag(Math.min(...c.slice(0, 3))));
  if (k !== "textDisabled") note(`${k} on panel/zebra/panel2`, Math.min(...c.slice(0, 3)));
}
row("accentText on accent (primary button)", T.accentText, f(cr(T.accentText, T.accent)), "—", "—", "—", flag(cr(T.accentText, T.accent)));
row("accentText on accentHover", T.accentText, f(cr(T.accentText, T.accentHover)), "—", "—", "—", flag(cr(T.accentText, T.accentHover)));
row("accent on accentBg2 (NEED tag on NEED row)", T.accent, f(cr(T.accent, T.accentBg2)), "—", "—", "—", flag(cr(T.accent, T.accentBg2)));
row("text on accentBg (selected row)", T.text, f(cr(T.text, T.accentBg)), "—", "—", "—", flag(cr(T.text, T.accentBg)));
row("badSoft on badBg (errorBox)", T.badSoft, f(cr(T.badSoft, T.badBg)), "—", "—", "—", flag(cr(T.badSoft, T.badBg)));
row("good on goodBg", T.good, f(cr(T.good, T.goodBg)), "—", "—", "—", flag(cr(T.good, T.goodBg)));
row("warn on warnBg", T.warn, f(cr(T.warn, T.warnBg)), "—", "—", "—", flag(cr(T.warn, T.warnBg)));
row("line vs panel (non-text rule)", T.line, f(cr(T.line, T.panel)), "—", "—", "—", "n/a (non-text)");
row("line2 vs panel (non-text rule)", T.line2, f(cr(T.line2, T.panel)), "—", "—", "—", "n/a (non-text)");
note("accentText on accent", cr(T.accentText, T.accent)); note("accent on accentBg2 (NEED tag)", cr(T.accent, T.accentBg2)); note("badSoft on badBg", cr(T.badSoft, T.badBg));

console.log("\n## 2. Grade ramp stops (text) on panel / zebra / panel2 / panel3, plus OKLab midpoints\n");
head("grade", "hex", "weight", "panel", "zebra", "panel2", "panel3 (hover)", "verdict (panel/zebra/panel2)");
for (const g of [20, 25, 30, 35, 40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5, 60, 65, 70, 75, 80]) {
  const hx = gradeToColor(g); const c = [T.panel, T.zebra, T.panel2, T.panel3].map((x) => cr(hx, x));
  row(Number.isInteger(g) && GRADE[g] ? `**${g}**` : `${g} (interp.)`, hx, GRADE[g] ? GRADE_WEIGHT[g] : "—", ...c.map(f), flag(Math.min(...c.slice(0, 3))));
  note(`grade ${g} on panel/zebra/panel2`, Math.min(...c.slice(0, 3)));
}

console.log("\n## 3. FV tier pills — ink on fill\n");
head("tier", "fill", "ink", "contrast", "verdict");
for (const [t, c] of Object.entries(FV_TIER_COLORS)) { const x = cr(c.text, c.bg); row(t, c.bg, c.text, f(x), flag(x)); note(`tier ${t} ink on fill`, x); }

console.log("\n## 4. z-heat — the 9 reference stops (−2.5 … +2.5) and every mockup stop\n");
head("z", "mix %", "fill", "text", "text on fill", "label (zToColor)", "label on fill", "bar on panel", "verdict (text)");
for (const z of [-2.5, -2, -1.8, -1.6, -1.1, -1, -0.8, -0.7, -0.5, -0.4, -0.2, -0.1, 0, 0.1, 0.2, 0.4, 0.5, 0.7, 0.8, 1, 1.1, 1.6, 1.8, 2, 2.5]) {
  const h = zHeat(z), l = zToColor(z); const x = cr(h.text, h.bg), y = cr(l.label, h.bg);
  const ref = [-2.5, -2, -1.8, -1, 0, 1, 1.8, 2, 2.5].includes(z);
  row(ref ? `**${z}**` : z, (Math.abs(z) / 2.5 * 100).toFixed(0), h.bg, h.text, f(x), l.label, f(y), f(cr(h.bar, T.panel)), flag(x));
  note(`z ${z} text on fill`, x);
}

console.log("\n## 5. Level chips — ink on fill; ring vs panel; plain-text fallback on panel\n");
head("level", "fill", "text", "text on fill", "ring", "ring vs panel", "levelColor() plain", "plain on panel", "verdict");
for (const [l, c] of Object.entries(LEVEL)) {
  const fill = c.bg === "transparent" ? T.panel : c.bg; const x = cr(c.text, fill), p = cr(c.plain, T.panel);
  row(l, c.bg, c.text, f(x), c.ring, f(cr(c.ring, T.panel)), c.plain, f(p), flag(Math.min(x, p)));
  note(`level ${l} text on fill`, x); note(`level ${l} plain text on panel`, p);
}

console.log("\n## 6. Position text on panel / zebra and chip (text on its 10% fill)\n");
head("pos", "text", "on panel", "on zebra", "chip fill", "text on chip", "verdict");
for (const [p, c] of Object.entries(POS)) { const a = cr(c.text, T.panel), b = cr(c.text, T.zebra), d = cr(c.text, c.chip); row(p, c.text, f(a), f(b), c.chip, f(d), flag(Math.min(a, b, d))); note(`pos ${p}`, Math.min(a, b, d)); }

console.log("\n## 7. Proneness / dev bands / scouting / intangibles / signability (text on panel & zebra)\n");
head("helper", "value", "hex", "on panel", "on zebra", "verdict");
for (const [p, c] of Object.entries(PRONE)) { const a = cr(c.color, T.panel), b = cr(c.color, T.zebra); row("proneColor", p, c.color, f(a), f(b), flag(Math.min(a, b))); note(`prone ${p}`, Math.min(a, b)); }
for (const v of [0.9, 0.6, 0.5, 0.35, 0.1]) { const hx = devPctColor(v); const a = cr(hx, T.panel), b = cr(hx, T.zebra); row("devPctColor", v, hx, f(a), f(b), flag(Math.min(a, b))); note(`dev ${v}`, Math.min(a, b)); }
for (const v of [70, 60, 50, 40, 30]) { const hx = scoutingRatingColor(v); const a = cr(hx, T.panel), b = cr(hx, T.zebra); row("scoutingRatingColor", v, hx, f(a), f(b), flag(Math.min(a, b))); note(`scout ${v}`, Math.min(a, b)); }
for (const v of ["H", "N", "L"]) { const hx = intangibleColor(v); const a = cr(hx, T.panel), b = cr(hx, T.zebra); row("intangibleColor", v, hx, f(a), f(b), flag(Math.min(a, b))); note(`intangible ${v}`, Math.min(a, b)); }
for (const v of ["Very Easy", "Easy", "Normal", "Hard", "Extremely Hard", "Impossible"]) { const hx = signColor(v); const a = cr(hx, T.panel), b = cr(hx, T.zebra); row("signColor", v, hx, f(a), f(b), flag(Math.min(a, b))); note(`sign ${v}`, Math.min(a, b)); }

console.log("\n## 8. Chart series on panel (lines/points; 3:1 is the graphical-object bar)\n");
head("series", "hex", "on panel", "on tooltipBg", "verdict (3:1 graphics)");
for (const k of ["series1", "series2", "series3", "series4", "series5", "series6", "axis", "refLine"]) { const hx = T.CHART[k]; const a = cr(hx, T.panel); row(k, hx, f(a), f(cr(hx, T.CHART.tooltipBg)), a >= 3 ? "ok" : "**< 3**"); }

console.log("\n## 9. Derivation self-check (literal token === OKLab mix recomputed now)\n");
head("token", "literal", "rule", "recomputed", "match");
const checks = [
  ["zebra", T.zebra, "mix(panel2 55%, panel)", mixOklab(T.panel2, 0.55, T.panel)],
  ["accentBg", T.accentBg, "mix(accent 14%, panel)", mixOklab(T.accent, 0.14, T.panel)],
  ["accentBg2", T.accentBg2, "mix(accent 8%, panel)", mixOklab(T.accent, 0.08, T.panel)],
  ["accentBg2Even", T.accentBg2Even, "mix(accentBg2 80%, panel2)", mixOklab(T.accentBg2, 0.8, T.panel2)],
  ["goodBg", T.goodBg, "mix(good 10%, panel)", mixOklab(T.good, 0.1, T.panel)],
  ["warnBg", T.warnBg, "mix(warn 10%, panel)", mixOklab(T.warn, 0.1, T.panel)],
  ["tier 65", FV_TIER_COLORS["65"].bg, "mix(g70 50%, g60)", mixOklab(GRADE[70], 0.5, GRADE[60])],
  ["tier 40+", FV_TIER_COLORS["40+"].bg, "mix(g40 45%, g30)", mixOklab(GRADE[40], 0.45, GRADE[30])],
  ...Object.entries(POS).map(([p, c]) => [`pos ${p} chip`, c.chip, "mix(pos 10%, panel)", mixOklab(c.text, 0.1, T.panel)]),
  ...Object.entries(T.CHART.bands).flatMap(([s, b]) => [[`${s} band outer`, b.outer, "mix(series 18%, panel)", mixOklab(T.CHART[s], 0.18, T.panel)], [`${s} band inner`, b.inner, "mix(series 35%, panel)", mixOklab(T.CHART[s], 0.35, T.panel)]]),
];
let mism = 0;
for (const [k, lit, rule, rec] of checks) { const ok = lit === rec; if (!ok) mism++; row(k, lit, rule, rec, ok ? "yes" : "**NO**"); }

console.log(`\n## Summary\n\n- Derivation mismatches: ${mism}\n- Text pairs below 4.5:1 (excluding textDisabled, which is decorative by design): ${fails.length}`);
for (const x of fails) console.log(`  - ${x}`);
process.exitCode = mism ? 1 : 0;
