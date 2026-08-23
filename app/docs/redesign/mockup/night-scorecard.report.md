# Direction 6 — Night Scorecard (delta report vs Direction 2)

Scorecard rebuilt as a single dark-native theme. The document grammar of dir-2 is unchanged — bordered
scorecard boxes with titled header strips, column-group rules, very light zebra, sticky 12px Archivo Narrow
headers, the red-pencil sort underline, NEED rows + 11px NEED tag, pagination strip, the 200px paper-panel
sidebar with the red ✓, h1 + context deck + 2px rule, Export CSV / Save view — and all skeleton content,
order, labels and values are byte-identical to dir-2 (the `<div class="app">…</main></div>` block was
carried over verbatim). What changed is the ground and every colour stop on it. Two ground candidates are
switchable in the file via `data-ground="graphite" | "warm"` on `<html>` (default graphite), controlled by
the small dashed "Ground: Graphite · Warm" mockup control fixed top-right. Nothing is persisted. No
`[data-theme]` rules, no Day/Night toggle, no light theme remain.

## (a) Tokens — both grounds

| token | graphite (default) | warm ("night paper") | note |
|---|---|---|---|
| Mode | dark-native, one theme | dark-native, one theme | ground chosen by `data-ground`; all tokens are CSS custom properties redefined per ground |
| bg / bg-2 | #141516 / #111213 | #181716 / #141312 | the desk; zero blue cast on both |
| panel / panel-2 / panel-3 | #1b1c1e / #212225 / #27292c | #201e1c / #272421 / #2d2a26 | card stock / header strips & toolbars / hover-pressed |
| zebra stripe (derived) | #1e1f22 | #24211f | `color-mix(panel-2 55%, panel)` — a ~3% luminance lift |
| text / secondary / muted / disabled | #ebe6da / #b6b1a5 / #8c887f / #67635b | #ece7db / #b9b3a6 / #918c83 / #69655d | cream ink |
| line / line-2 / line-ink | #303236 / #44474c / #ebe6da | #373430 / #4c4843 / #ece7db | hairline / box rule / the h1 rule + hover border (= text) |
| accent / accent-hover | #e6655a / #ee7b70 | #e6655a / #ee7b70 | one red pencil |
| accent-text | #141516 (= bg) | #181716 (= bg) | ink on the pencil |
| accent-bg / accent-bg-2 | #352727 / #2a2223 | #392824 / #2e2421 | NEED row hover (pencil 14% over panel) / NEED row tint (8%) — low-chroma red-brown |
| good / bad / warn | #47a46e / #e6655a / #c9a23a | same | good = the 50 stop |
| focus | #82a7e0 | #82a7e0 | desaturated blue ring, 6.9:1 on panel |
| radius / spacing / elevation | 3px (tier pills 10px) / 8px base / none — hairlines only, no shadow, no blur, no gradient | same | |
| fonts | Archivo (body + numerals, tabular-nums) · Archivo Narrow (headers, chips, nav, buttons, pagination, the ground control) · no monospace | same | URL unchanged from dir-2: `https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Archivo+Narrow:wght@400;500;600;700&display=swap` |

Text contrast on panel: graphite text 13.7:1 · secondary 8.0:1 · muted 4.8:1 (4.5:1 on the panel-2 strips) ·
disabled 2.9:1 (decorative/disabled only); warm 13.5 · 8.0 · 5.0 (4.6 on strips) · 2.9. Ink on the pencil
(primary button, on-switch knob, tier-pill style) 5.6:1 graphite / 5.4:1 warm; ink on pencil-hover 6.7 / 6.6.
The pencil itself on panel: 5.2 / 5.0; the 11px NEED tag (pencil on the 8% tint) 4.7 / 4.6.

## (b) Encoding stops per ground (hex · contrast on panel / on zebra)

The ramp hexes are shared by both grounds — every stop was checked on both panels and both zebra stripes
and clears 4.5:1 on all four; only the greys (DH, level ladder, muted) are warmed for the warm ground.

**20–80 grade ramp (stat text)** — ordered by luminance AND weight: the ends are brightest, 80 is the
brightest of all, 45 is the dimmest. Weight rule unchanged: 20/30 = 700, 40–55 = 500, 60 = 600, 70 = 700, 80 = 800.

| stop | hex | graphite panel / zebra | warm panel / zebra | ink on fill (tier pill) g / w |
|---|---|---|---|---|
| 20 | #f98b80 | 7.34 / 7.09 | 7.15 / 6.88 | 7.86 / 7.70 |
| 30 | #e08e52 | 6.63 / 6.40 | 6.46 / 6.22 | 7.10 / 6.96 |
| 40 | #b38f34 | 5.60 / 5.41 | 5.46 / 5.25 | 6.00 / 5.88 |
| 45 | #8d953e | **5.28 / 5.10** | **5.14 / 4.95** | 5.66 / 5.54 |
| 50 | #47a46e | 5.52 / 5.34 | 5.38 / 5.18 | 5.92 / 5.80 |
| 55 | #3ea891 | 5.86 / 5.66 | 5.71 / 5.50 | 6.28 / 6.15 |
| 60 | #49aac4 | 6.36 / 6.14 | 6.20 / 5.97 | 6.82 / 6.68 |
| 70 | #80acf0 | 7.37 / 7.12 | 7.18 / 6.92 | 7.90 / 7.74 |
| 80 | #bccdff | 10.81 / 10.45 | 10.53 / 10.15 | 11.59 / 11.35 |

**FV tier pills** (filled, 10px radius, ink text = the ground bg): 80 #bccdff · 70 #80acf0 · 65 mix(70,60) = #67abda ·
60 #49aac4 · 55 #3ea891 · 50 #47a46e · 45+ #8d953e · 45 #b38f34 · 40+ mix(40 45%,30) = #cc8f45 · 40 #e08e52 ·
35+ #f98b80. Ink-on-fill ≥ 5.5:1 on every pill, both grounds (65: 7.3/7.2, 40+: 6.6/6.5).

**Positions** (bold Archivo Narrow text in dense cells; bordered chips with a 10% fill in badge contexts), contrast on
graphite / warm panel: C #b8a2f2 7.7/7.5 · 1B #f09485 7.5/7.3 · 2B #dfb04c 8.5/8.3 · 3B #b9c45c 9.0/8.8 ·
SS #6ecf95 9.0/8.7 · LF #5fcbc1 8.8/8.5 · CF #6fb6f0 7.8/7.6 · RF #98abf5 7.7/7.5 · DH #a9a59c (warm #aba69b) 6.9/6.9 ·
SP = text #ebe6da / #ece7db 13.7/13.5 · RP #cfae92 8.2/8.0.

**Level ladder** (filled, luminance ladder MLB brightest → R darkest, every chip ringed line-2 so R stays visible;
INT = dashed outline #dfb04c 8.5/8.3):

| level | graphite fill · text · text contrast | warm fill · text · text contrast |
|---|---|---|
| MLB | #ebe6da · ink · 14.7 | #ece7db · ink · 14.5 |
| AAA | #bdb8ad · ink · 9.3 | #bfb9ad · ink · 9.2 |
| AA | #8d8a82 · ink · 5.3 | #8f8a80 · ink · 5.2 |
| A+ | #5f5d57 · cream · 5.3 | #615d56 · cream · 5.3 |
| A | #45443f · cream · 7.8 | #47443f · cream · 7.9 |
| R | #323130 · cream · 10.4 (ring 1.8:1 vs panel) | #343230 · cream · 10.4 |

**z-heat** — fill = `color-mix(in oklab, Z |z|/2.5·100%, panel)` from the PANEL of the active ground, Z = #e86c5f
(negative, weak) or #6193de (positive, strong); the same two hexes draw the centre-zero bars (5.5:1 / 5.3:1 vs panel).
Stops and the resulting fills (graphite → warm), text = cream up to 72%, ink (= bg) at ≥80%:

| |z| | mix | neg fill g / w | pos fill g / w | text contrast g / w |
|---|---|---|---|---|
| 0.1 | 5% | #242021 / #29221f | #1e2126 / #232324 | 12.9 / 12.7 |
| 0.2 | 8% | #2a2223 / #2e2421 | #20242b / #252629 | 12.5 / 12.2 |
| 0.4 | 16% | #382928 / #3d2a26 | #262d39 / #2a2f37 | 11.1 / 10.9 |
| 0.5 | 20% | #402c2b / #442e29 | #283240 / #2d343e | 10.4 / 10.2 |
| 0.7 | 28% | #4f3230 / #53342e | #2e3b4e / #323c4d | 9.2 / 9.0 |
| 0.8 | 32% | #573633 / #5b3731 | #313f55 / #354154 | 8.5 / 8.4 |
| 1.0 | 40% | #673c38 / #6a3d36 | #364864 / #3a4a63 | 7.4 / 7.3 |
| 1.1 | 44% | #6f3f3a / #724039 | #394d6c / #3c4f6b | 6.9 / 6.8 |
| 1.6 | 64% | — | #476593 / #496692 | 4.75 / 4.73 (cream) |
| 1.8 | 72% | #aa564d / #ab564c | #4d6fa3 / #4f70a2 | **4.07 / 4.08** (cream) |
| 2.0 | 80% | #bb5c52 / #bc5c51 | #5279b3 / #547ab3 | **4.15 / 4.08** (ink) |
| 2.5 | 100% | #e86c5f | #6193de | 5.87 / 5.74 (ink) |

**Injury proneness:** Iron Man = 80 stop #bccdff 700 · Durable = 55 #3ea891 600 · Normal = secondary text 400 ·
Fragile = 30 #e08e52 600 · Wrecked = 20 #f98b80 700 (ends bold, as in dir-2). **Dev%:** ≥70 → 70 #80acf0 700;
55–69 → 55 #3ea891 600; 45–54 → secondary; 30–44 → 40 #b38f34 500; <30 → 30 #e08e52 700.

CVD: unchanged logic — the grade ramp is ordered by luminance (U-shaped, 80 brightest) and weight, not hue;
z-heat is red vs blue plus bar side; the level ladder is pure luminance; proneness repeats the weight rule;
position chips carry their label.

## (c) What changed vs dir-2, and why

- **Ground moved off slate.** dir-2's night twin (#0f151d / #18212c) was blue-cast ink navy — the one render in
  the set that drifted toward the slate-900 tell. Both new grounds are neutral: graphite has zero chroma
  (R≈G≈B), warm has R>G>B by 1–3 units per channel so it reads as warm grey under cream type, not brown.
- **Light theme removed entirely**, with the Day/Night toggle, `[data-theme]` rules, `color-scheme:light`
  and the localStorage persistence. Replaced by the `data-ground` switch and a review-styled control
  (11px Archivo Narrow, dashed line-2 border, desk-coloured, 85% opacity, "Ground:" label in muted).
- **Grade ramp re-derived on dark.** dir-2's dark ramp had the *middle* brightest (40/45 at 8.6:1, 20 dimmest at
  5.9:1), inverting the paper ordering. The new ramp restores the paper shape on dark: ends brightest
  (20 = 7.3, 80 = 10.8), 45 dimmest (5.3 / 5.1), every stop ≥4.95:1 on both zebras. The 40/45 ochre-olive
  stops were darkened (#b38f34 / #8d953e) to recede, exactly as they do on paper.
- **Tier pills** keep the ramp fills and get ink text = the ground bg (5.5–11.6:1); the 65 and 40+ mixes are computed
  from the new stops.
- **Level ladder** is now one unconditional rule set (no dark-only override): MLB/AAA/AA ink text, A+/A/R cream
  text, line-2 ring on every chip; the ladder greys are neutral on graphite and warmed on warm.
- **z-heat**: endpoints re-tuned (#e86c5f / #6193de — slightly brighter than the pencil so ink text clears the 100%
  cell at 5.9:1, blue desaturated away from slate); the mix now starts from the active ground's panel; the text
  flip moved from ≥64% to **≥80%** — see the honesty note below.
- **NEED tint** is a low-chroma red-brown at 8% (row) / 14% (hover) over panel so twelve tinted rows sit quietly
  (#2a2223 vs panel #1b1c1e); the even-row variant mixes 80% with panel-2.
- **Dark-native field and switch treatment**: text inputs are sunken wells in the desk colour (bg) on the panel-2
  toolbar strip with a line-2 border and a secondary-text hover border; the "All Positions" select stays a raised
  panel-coloured control; the off-switch track is a bg well with a muted knob, the on-switch is the pencil with an ink
  knob; the search magnifier glyph is recoloured to the dark muted.
- Borders/rules became light hairlines (line 1.33:1 / line-2 1.83:1 vs panel); the h1 rule and hover borders are the
  cream text colour; hover rows are panel-3 (≈4% lift); zebra is a ~3% lift.
- `.head-actions` no longer reserves 108px for a theme toggle (the ground control sits above the action row, not
  beside it: control y 8–32px, buttons y 46–76px).
- Honesty note on z-heat text: on a dark ground a linear mix toward any saturated endpoint passes through a
  mid-luminance band (fill L≈0.14–0.21) where neither cream nor ink text reaches 4.5:1 — I scanned endpoint
  brightness for flip thresholds 64/72/80% and the best achievable worst case is ≈4.1:1 (the only ≥4.5 solution is
  pastel endpoints like #ffb4aa / #aec9f7, whose 44% mixes turn into rose-taupe and slate-grey — the tell — and lose
  the hue). I kept saturated endpoints and moved the flip to 80%: the 1.6 cell is 4.75:1 cream, the ±1.8 and ±2.0
  cells sit at 4.07–4.15:1, everything else ≥5.7:1. This is AA-large, not AA-normal, on those four stops and is
  reported as such rather than hidden.

## (d) Recommendation

**Graphite.** With cream type and the red pencil the warm ground's extra red channel is nearly invisible at the
panel level (panel #201e1c vs #1b1c1e) but it shows up where it hurts — in the z-heat blue mixes and the level
ladder greys, which pick up a faint brown cast; graphite keeps every encoding's hue exactly as specified and is the
one that can never be read as slate or sepia. Warm is the pick only if the user finds graphite clinical beside OOTP's
own UI.

## (e) Self-check

- Horizontal scroll at 1440: **no** for both grounds — Claude browser pane at 1440×1000:
  `document.documentElement.scrollWidth` = 1440 and `body.scrollWidth` = 1440 with `data-ground="graphite"` and
  with `data-ground="warm"`; widest tables 1190px (board / specimen / dense), needs 390px. Headless-Chrome full-page
  renders of both grounds (1440×1000 and 1440×2400) were eyeballed end to end; the switch was exercised in the pane.
- Smallest font: **11px** (sidebar field labels, NEED tag, the "Only positions below league avg" caption, the ground
  control); table body 12–12.5px, headers 12px.
- Body text on panel: graphite #ebe6da on #1b1c1e = **13.7:1**; warm #ece7db on #201e1c = **13.5:1**.
- Dimmest grade stop: 45 #8d953e — graphite **5.28:1** on panel (5.10 on zebra, 4.81 on panel-3 hover); warm
  **5.14:1** on panel (4.95 on zebra, 4.70 on hover).
- Known sub-4.5 stops: disabled text (by design), the line hairlines (non-text), and the four z-heat stops at
  72–80% (4.07–4.15:1) discussed above.
