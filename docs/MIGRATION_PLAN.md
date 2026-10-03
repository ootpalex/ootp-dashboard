# Migration plan: ootp-dashboard → perfektprojections (macOS, WAR)

*Drafted 2026-10-02 from a read of both repos at these heads: perfektprojections `e9aca96`
(2026-10-01), ootp-dashboard `218dd86` (0.3.0). File:line references are to those heads.
Effort figures are estimates for one person working part-time, not measurements.*

---

## 0. The decision and the rules

**Base = a fork of `perfektoa/perfektprojections`. Our repo contributes, it does not survive.**
His engine (sim-calibrated curves, live-population level transport, measured role-stuff shift,
split-aware potentials, fitted currency), his development stack (ratings archive, DEV league, ML
odds) and his operations layer (task registry, Control page, token handling, honest pull report)
are the bulk of the merged project and have no equivalent on our side. What we bring is narrower
but real: a handful of model corrections he lacks, a real-outcome fielding referee, StatsPlus
draft-pool ingestion, and the roster-management tooling (Roster Planner, Waiver Wire, Scout View,
Prospects) that his `serviceTime.js` explicitly says it does not model.

Four rules for the whole migration:

1. **Stay mergeable with his `main`.** He lands ~80k-line drops monthly. Every change we make is
   either (a) additive (new fields, new modules, new pages), (b) behind `sys.platform` /
   settings, or (c) a fix worth sending back to him. We never rewrite his engine internals; WAR is
   an added layer, not a replacement (see §2).
2. **Audit before changing any calculation** — our `CLAUDE.md` rule carries over verbatim. Every
   constant in the merged engine is tagged 🟢 computed from our data / 🟡 borrowed (provenance
   noted) / 🔵 explicit assumption, and no 🟡 ships without a check against our leagues.
3. **The M1 Air (8 GB) is a client.** It runs the app, the StatsPlus pulls, the engine and ML
   *scoring*. Retraining is a remote or overnight batch job (§6), never part of the daily loop.
4. **One currency.** WAR, market-replacement basis, measured per league. No page adds its own
   offset; no dual display/internal tracks.

### League mapping

| Ours today | In the merged project |
|---|---|
| BLM-ATL, BLM-NYM | **Retired.** These existed to run GM-less teams' drafts as BLM commissioner. BLM stays configured but **off** in the fork: his BLM-basis models and metadata are the yardstick for the SSB ML questions below. |
| SSB (OOTP 27 since season 2043) | **The league.** League `SSB`. **No sims needed.** His curves are calibrated per OOTP *version* on clones of a generic league (the `Baseline.lg` shipped with "The Sheet"; both leagues' copies are byte-identical and share ~1 name with the real TGS pull), then transported to each online league's level from its real StatsPlus rates. SSB reuses the OOTP 27 curves and gets its **own metadata** (league rates, anchors, posAdj, parks) via his `metadata_inputs.py` — cheap, no commissioner access involved. Gate the transport with `scurve_fit.live_gate` against SSB's real season. Open question: whether DEV priced with SSB's metadata differs enough from BLM's to justify an SSB ML model set (§6). |
| `default` (bundled SSB fixtures) | Drop. |
| — | His TGS and RG entries stay in the fork's committed data (harmless) but are switched off in `settings.local.json`. |

---

## 1. Phase 0 — Fork and macOS baseline (≈ 1–2 days + 1–2 days for jobs)

Source: the portability inventory. The engine, ingest, backtest and ML code is already
platform-neutral (stdlib/numpy/openpyxl/pandas/sklearn, `os.path.join`, explicit UTF-8). The
Windows coupling is concentrated in the task runner, the registry's path strings, defaults, and
`winsim.py`.

### 1a. Must fix to run the app, pulls, engine and ML scoring

| Where | Problem | Fix | Effort |
|---|---|---|---|
| `requirements.txt:7` `pywin32` | no macOS wheel; `pip install -r` fails | environment markers: `pywin32; sys_platform=="win32"`, `pyobjc-framework-Quartz; sys_platform=="darwin"` (only needed for §7) | S |
| `tools/settings.defaults.json:3` `"main":["python"], "ml":["py","-3.14"]`; fallbacks `control/paths.js:70,89`, `run_task.py:1505`, `doctor.py:162,190` | macOS has neither `python` nor `py` | default `["python3"]`; one `.venv` (3.13) with both requirement files; `settings.local.json` points `python.main` and `python.ml` at `<repo>/.venv/bin/python`. The two-interpreter split is a settings value (`settings.py:319-322`), so unifying needs no code | S |
| `tools/tasks.py` — 49 raw backslash paths (e.g. `:1033 WINSIM=r"ootp\winsim.py"`, `:1158`, `:1520`, `:1541-1543`, `:2218`) + `run_task.py:1364` | `argv()` (`run_task.py:525-537`) passes them verbatim to `Popen`; POSIX treats `\` literally → every task step dies "can't open file" | normalise separators in `argv()` and `conditions.py:53-56` (one place) rather than editing 49 strings; Windows accepts `/` | S–M |
| `run_task.py:947,1197` `subprocess.call("pause", shell=True)` | `pause` is a cmd.exe builtin; gates fall through | `input()` when not Windows | S |
| `doctor.py:239-251` checks `node_modules/.bin/vite.cmd`; `:166` expects `win32gui`; `:190` probes `py -3` | Check Setup fails on a healthy Mac | check `.bin/vite`; platform-conditional module list | S |
| 13 root `.bat` + 5 `ootp/*.bat` | identical 15-line template → `run_task.py <task>` | one `bin/task.command` template (`cd "$(dirname "$0")"; "${TGS_PY:-python3}" tgs-viz/tools/run_task.py <task> "$@"; read -rp "Press Enter"`), exec bit via `git update-index --chmod=+x`; keep `.gitattributes` `*.bat eol=crlf` | S |
| Stored Windows paths in `vintages/*/_pulls.csv`, `league_scale_DEV.json`, manifests | all readers already normalise or use them as provenance strings | nothing | — |

Then: `npm install` in `tgs-viz/`, `python tgs-viz/backtest/vintage_backup.py --restore`, paste
our BLM token into `StatsPlus Tokens.txt`, `run_task.py get_ratings` from a console. The app serves
all committed leagues with zero Python.

### 1b. Must fix for Control-page jobs (concurrency, kill, locks)

| Where | Problem | Fix | Effort |
|---|---|---|---|
| `tools/joblock.py:174-175,206-211` reads `/proc/<pid>/stat` for process start time | no `/proc` on macOS → every job's identity is `None` → `alive()` false → active jobs reaped as "lost", locks void | darwin branch: `libproc.proc_pidinfo` via ctypes, or `ps -o lstart= -p` | M |
| `joblock.py:296-299 take_lock` relies on `os.rename` raising `FileExistsError` | POSIX rename overwrites silently → two takers both win | `os.open(O_CREAT\|O_EXCL)` or `os.link` | S |
| `run_task.py:869-874,1920-1926 kill_tree` uses `taskkill` | Kill does nothing | `start_new_session=True` on spawn + `os.killpg(SIGTERM→SIGKILL)` | M |
| `control/test/mock_tools/run_task.py:45-62,499-505,564` | unguarded `ctypes.WinDLL`/`taskkill` → the three Node smoke tests crash | mirror joblock's platform branch | S |
| `settings.defaults.json:7-8` OOTP paths; `settings.py:367-375 expand_path`; discovery in `dump_source.py:149-152`, `export_league.py:92-94` | `%USERPROFILE%` literal; Mac OOTP saves live in `~/Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games` | darwin default + discovery path | S |

Until 1b is done, console mode works for one run at a time; the Control page's concurrency guards
are void. **Send 1a and the portable half of 1b upstream to him** — they are pure wins for his repo
and shrink our diff permanently.

### 1c. Tests on macOS

Portable now: `test_catalog.py`, `test_doctor.py`, `test_new_league.py`,
`test_settings_defaults.py` (fix the `python`/`py` assertions at `:54-58,174-177,185-186`),
`control/test/{fileMap,guards,pythonMain}.test.mjs`, `tests/client/*.test.mjs`. Windows-bound and
to be gated on `os.name == "nt"`: `test_bat_equivalence.py` (`cmd /c`, `taskkill`, CRLF checks),
`test_run_task.py` (`creationflags`, Toolhelp). Port `test_run_task.py` after 1b.

### 1d. CI from day one

Our `.github/workflows/ci.yml` is the template (he has no CI): matrix `macos-latest` +
`ubuntu-latest`; `pytest` (collects his `unittest` suites unchanged) + `node --test` + `vite build`.
Add our `.editorconfig`.

---

## 2. Phase 1 — WAR as the single currency (≈ 1–2 weeks)

### 2a. What his WAA is, exactly

His WAA is a **rate at fixed playing time**, vs the *role's* league average:

- Hitters: `(RunsP + BSR + BatR + PosAdj_pos) / RPW` at **600 PA** (`engine/hitters.py:168`
  `PA = g("H31")`); catcher batting at **500 PA** (`H32`), with BSR correctly scaled
  `BSR·(H32/PA)` (his B8 fix).
- SP: `((lgRA9_SP − RA9)·IP/9)/RPW` at **800 BF ≈ 186–189 IP**; RP at **300 BF ≈ 70 IP** vs the
  **RP** league RA/9 (`pitchers.py:474-535`). Note the RP baseline is the RP average, ~0.2 R/9
  better than the SP average.
- RPW is **fitted** from team-season W-on-RD regressions (`currency_fit.py:261-314`): 10.036 BLM
  vs the workbook tangent 9.464 — a 6% difference on every win figure. Ours still uses the
  borrowed `lg_RA/9·1.5 + 3` (`aggregators/_shared.py:17-27`). His is 🟢; adopt it.
- Nothing is scaled by projected playing time, so **WAR − WAA is a per-role constant**:
  hitter credit (runs/600 PA ÷ RPW), catcher ×500/600, SP credit at H33 IP, RP credit at H34 IP.

He already has two *measured* replacement levels in `src/lib/leagueCalib.js:48-159`
(`WAR = WAA + offset(role)`): **market** (freely-available talent; BLM hitter 1.91 / SP 2.5 /
RP 0.31 — budget identity on banked actuals + delivered-WAR regression + market pin, shipped as
the median) and **org** ("next man up"; BLM 0.64 / 0.28 / 0.01). The app applies them
inconsistently: market in `marketValue.js`, org in `waivers.js` and `positionalStrength.js`, none in
`columns.js`, and `futureValue.js` carries a dual display-WAA/internal-WAR track. `draftFV.js:343-358`
reverted to WAA because displayed ≠ scored. That inconsistency is the thing WAR-everywhere fixes.

### 2b. Design: A′ — WAA arithmetic stays, the engine emits WAR, everything downstream reads WAR

Rejected alternatives: pure JS-boundary offsets (what he has now; it produced the three-currency
mess), and rewriting WAA as WAR inside the engine (breaks his sheet-fidelity validators
`hitters.py main()`, `pitchers.py main()`, `ratings.py --selftest`, `build_json.py`, which gate every
engine change — and makes upstream merges unbearable).

Concretely:

1. **`engine/calib/<LG>/currency.json` gets a `replacement` block** (same opt-in overlay layer as
   `H30`): `{hitter_runs_per_600, sp_wins_at_H33, rp_wins_at_H34, provenance:{…}}`. The
   catcher credit is `hitter_runs_per_600 × 500/600` — his single hitter offset currently
   over-credits a 500-PA line by 1/6 (~0.28 wins).
2. **`hitters.py` after line 382** adds `{pos} WAR {vR,vL,wtd}`, `Max WAR *`, `MAX WAR P`,
   `Best Pos WAR`; **`pitchers.py` `emit`** adds `WAR *`, `WAR * RP`, `WARP`, `WARP RP` — exactly
   our `compute_waa` shape (`model/src/hitters.py:757-877`). `Best Pos` (WAA) stays for the
   fidelity check; `Best Pos WAR` is what the app uses. The argmax can flip for catchers (61 TGS /
   63 BLM MLB bats have Best Pos C today) — that is the catcher credit working, not a bug.
3. **One role decision for swingmen.** Today the ML uses raw `max(SP WAA, RP WAA)`
   (`ml/reprice.py:110`, `agecurve_fit.py:181`, `dev_signals.py:62,488`) while FV/market use WAR;
   under WAR, `max(SP+2.5, RP+0.3)` picks a different role for ~330 BLM arms. Decide once, in WAR,
   in the engine (`Role WAR`), and have ML, FV, optimizer and pages all read it.
4. **Replacement level is measured, per league, from our data** (ranked by auditability):
   1. 🟢 budget identity from banked actuals (his `leagueCalib.js:97-135` route) — we already
      ingest real stats per league; doubles as the gate Σ roster WAR per club ≈ G/2 − replacement
      wins (~33).
   2. 🟢 delivered-WAR regression on engine WAA with bootstrap CIs (`leagueCalib.js:136-142`).
   3. 🟢 org next-man-up (`scripts/measure_replacement.mjs`) — retained only as the optimizer's
      internal cut/keep parameter, *not* as a display currency.
   4. 🟡 our FanGraphs constants (`data_points.py:36-51, 925-929`: 20 R/600 PA, 0.12/0.03 W per
      9 IP ⇒ hitter 1.99 / SP 2.47 / RP 0.23 wins) — **retire**. Interesting coincidence: FG SP
      2.47 ≈ his measured market SP 2.5; FG RP 0.23 sits between his market 0.31 and org 0.01.
      RP replacement ≈ RP average is a real finding, not noise.
5. **App switch**: rename columns to WAR (`columns.js`), delete the display-WAA track
   (`futureValue.js:602-617, 897-905`, `usePlayerData.js:710-789`, `PlayerDetail.jsx:444-479`),
   stop adding offsets in `getPlayerWAR`, `draftFV.js:376-379`, `waivers.js:73-86`,
   `positionalStrength.js:209-216` (empty slot becomes 0), `rosterOptimizer.js:1233-1250, 1384-1397`.
   `TeamStandingsPage` keeps its re-centering for Proj W (invariant) and can additionally show team
   WAR with the budget-identity check. Remove the dead `'WAR wtd'` refs (`columns.js:51`,
   `PlayerDetail.jsx:393`).
6. **Replace multiplicative aging with the additive measured curve everywhere.**
   `futureValue.js:178-182 applyAging` and `marketValue.js:1164-1167 agedWAR` scale the *level*
   (`max(0.5,|v|)`); under WAR every level is ~2 wins higher, so a 6%/yr decline becomes ~5× what it
   was on the same player's WAA. The measured-curve path (`futureValue.js:360-377`) is additive and
   shift-invariant — make it the only path.
7. **Workload scaling** (`rosterOptimizer.js:1418-1429`, 0.942/0.957) must scale the credit too, or
   be replaced by the budget identity.
8. **Thresholds and colours** are all in WAA today (`columns.js:471-480` ≥5/3/1.5/0/−1;
   `RosterOptimizerPage.jsx:806`; `orgBuilder.js` `TRAIN_PEAK_BAR 0`, `NO_CHANCE_POT −1`,
   `BAT_POT_OK −0.25`; `draftFV.js:48-51` ceiling anchors −3/+5; `g5FV.js:231-245`;
   `futureValue.js:532-546` FV anchors). Each moves by the role credit; list them in one constants
   module so the shift is applied once.

### 2c. ML: what can be reused, what must be retrained

- **Hitters: reuse.** Gain quantiles, `d1..d5`, `present_k`, `regular_future` are differences or
  playing time. Reach classifiers train on `now < bar − 0.05` and predict `peak ≥ bar`; shift
  `now_waa`/`ceiling_waa` and the bars by the same hitter constant and the trees are identical.
  Assert OOF predictions match after the shift.
- **Pitchers: retrain** (`peak_P_*`, `path_P_*`): `now`/`ceiling`/peak are `max(SP, RP)` and the
  two roles carry different credits, so the shift is not constant. Re-run `ml/reprice.py` →
  `dataset.py` → `peak.py`/`path.py fit-final` on a WAR tuple. Add `now_war` *alongside* `now_waa`
  in the `.waa_cache` tuple so both bases stay auditable.
- **Bars.** Two options: (i) *relabel* — BLM market: MLB −1 → +0.9, Starter 0 → +1.9, Star
  +1.5 → +3.4 wins; no retrain. (ii) *redefine in WAR* — MLB = 0 (replacement), Starter ≈ an
  average regular (≈ hitter credit, 1.7–2.0), Star ≈ 3.5; cleaner meaning, but changes the reach
  targets for both roles → retrain all reach classifiers. **Recommendation:** relabel now,
  redefine at the first scheduled retrain (§6). `chance_order` and `blend_chance`
  (`ml/common.py:1209-1223`) survive either way.
- `dev_odds` peak cells and `age_curve.json` (dWAA/yr — additive, unchanged in value) are
  recomputed on the WAR tuple for consistency.
- **Add the missing guard:** `score.py` applies a model whose training prices carried one
  calibration fingerprint (`ml/common.py:1040`) to a league whose calibration may since have
  changed; nothing checks. Store the fingerprint in the model manifest and refuse (or warn) on
  mismatch — with our own calibration changes coming (§3), this will bite.

---

## 3. Phase 2 — Model merge: what ours does better, into his engine (≈ 3–4 weeks, audits included)

Each item gets a written audit (trace inputs → re-derive → resolve flags) before code. His engine
is **stdlib + numpy, no pandas**; our ports translate to numpy or land in `backtest/`/`ingest/`
where pandas is already a dependency.

| # | Item | Ours | His today | Merge | Effort | Audit |
|---|---|---|---|---|---|---|
| 1 | **Positional adjustments** | multi-year ½ ZR-switcher + ½ offense, centred (field-8 mean 0), H_def 5/cut 20, H_off 2.5/cut 8; frozen literals `data_points.py:977-1025`. BLM: C 16.1 / 1B −13.1 / 2B −2.3 / 3B −0.7 / SS 9.6 / LF −8.4 / CF 5.1 / RF −6.2 / DH −13.1 | single season, offense only, uncentred, LF=RF pooled: `metadata_calibrate.py:560-640 pos_adj_calc`. BLM: C 9.65 / 1B −4.87 / 2B −2.14 / 3B −0.20 / SS 6.93 / LF=RF −3.77 / CF 2.15 / DH −6.80 | new `engine/pos_adj_multiyear.py`: loop his `metadata_inputs.py --year` over the window, his `pos_adj_calc` per season for the offense half, a ZR-switcher half from `Fielding_Data`, recency weights, write P2..P10. **The two disagree by up to 6.5 runs at C and 8 at 1B — ~0.6 wins per player.** His own AUDIT Phase B asks for multi-season smoothing | M (L with switcher) | 🟢 inputs; 🔵 windows, ½-½, DH rule, centring choice |
| 2 | **Fielding out-values** | **derived per league** from linear weights: `inf_out = run_1b + runs_minus`; `of_out` = OF-hit-mix-weighted from BIZ accounting (`aggregators/hit_aggregator.py:115-152`). 0.75/0.90 are only the fallback. Separately our ZR research implies ~0.50/0.66 on a continuous catch-probability model | hand-entered 0.75 / 0.90 (`metadata_calibrate.py:76-77` F38/F39 → H38/H39); his AUDIT §6 says a "zone identity proves 0.75/0.9 is correct" | **Genuine conflict; resolve with data before merging.** Run both derivations on BLM's real `Fielding_Data` + run values, check Σ fielding runs against the zone identity, decide, record. Then port `_derive_out_values` into `compute_cells` if it wins | S–M | 🟡 both borrowed today; 🔵 "all XBH are OF events" |
| 3 | **Position eligibility floors** | 1B needs IF ERR > 20; SS needs TDP ≥ 45; LF/RF OF RNG ≥ 45 — retuned to real IP usage (`hitters.py:460-512`) | 1B no ERR floor; SS no TDP floor; LF/RF ≥ 50 (`engine/hitters.py` ~362) | three one-token edits after re-verifying against BLM/SSB IP usage; regenerate JSONs (draft/park/strength read `Eligible`) | S | 🟢 usage; 🔵 thresholds |
| 4 | **bestPos Option B** | client-side `dataProcessing.js:44-75`: argmax over eligible field positions of RunsP + defensive-only spectrum, LF/RF arm leaf (BLM arm threshold 55.2), DH only if eligible nowhere | `Best Pos` = argmax WAA wtd incl. DH | compute in `hitters.py` after `rp{}` as `Best Pos WAR`; needs per-league defensive spectrum (falls out of #1's switcher half) and the RF arm threshold (mean OF ARM of deployed RFs) | S code / M inputs | 🟡 if our spectra copied; 🔵 arm rule |
| 5 | **OOTP-27 curves** | continuous multi-knot piecewise (`data_points.py:98-130, 485-790`), knots from designed test-league sims (H-pool), referee-validated on real SSB 2043 (`docs/AUDIT_27.md`) | two-segment line with a seam at 50, or logistic S-curve per block, chosen by `promote_scurves.choose()` (S-curve iff monotone and >5% better on the real season); fitted from BLM clone sims | **three-way bake-off** in `scurve_fit.main`: add `f_pw` (our `utils.piecewise_delta`), transport all three to the live frame identically, extend `live_gate` and `choose()` to a 3-way min with the margin, add a `piecewise` curve type in `statline`. Hitting blocks (no S-curve path today) get the same harness on `Hitting_Data`/`Batter_Ratings`. Expect a hybrid: his curves where live players are dense, our knees in the tails — only if the real-season gate says so | M | 🟢 real-season gate; 🟡 both families are sim-derived from different substrates |
| 6 | **Baserunning** | pinned cubic intercepts (`regressions.py:544-545`, canonical c0 `data_points.py:216-232`); 27 league-adaptive SBA c0 (`metadata.py:809-866`) | B1 (SBA double count) fixed `calibrate.py` ~246-252 + STE cap 80; B9 (UBR baseline sign) fixed `hitters.py` ~253-262 | audit **ours**: `hitters.py:342` is the `(cubic − C40)` form B9 condemned — re-derive whether `lg.ubr`'s sign makes it the pooled rate or a phantom add; our 26 SBA c0 +0.0091 was found sign-wrong on real 27. Port our league-adaptive SBA c0 to his engine if his C41 handling doesn't already scale with the run environment | S each | 🔵 until re-derived |
| 7 | **Currency** | RA/9 exponent hard 2.0 (`pitchers.py:440`); RPW tangent formula | exponent fitted 2.28 BLM, RPW fitted 10.036, luck SD, workloads (`currency_fit.py`), all gated | adopt his; nothing to port | — | 🟢 |
| 8 | **Level transport (Jensen)**, split-aware potentials, measured role-stuff shift | absent / both splits = P / flat ±5 | present | adopt his | — | 🟢 |
| 9 | **Bugs in ours his engine already fixed** | B5 IF error units (`regressions.py:1100` fits E/IP, `hitters.py:652` applies per play — ~3× compressed); B8 catcher WAA adds 600-PA BSR to 500-PA batting (`hitters.py:871`) | fixed (B5 refit per play `calibrate.py:518-548`; B8 `BSR·(H32/PA)`) | adopting his engine removes them; record in the audit log | — | — |
| 10 | **Fielding referee** | `model/tools/referee_fielding.py`: post-season WLS of observed range runs on the model's runsP channel, HC1 + cluster-bootstrap SE, two-sample governance — vs the **real** league | only a sim-vs-engine ±3-run gate (`fielding_curves_fit.py:309`); his AUDIT §4.1 names the real-outcome loop as missing | port as `backtest/referee_fielding.py` on his `Fielding_Data` (pm/pa/zr) + `Fielding_Ratings` | M | 🟢 |
| 11 | **Per-league validation** | `validation.py:44-60`: league fields, required CSV columns, ballparks/team consistency, StatsPlus reachable | `doctor.py` is setup-only; fidelity validators are separate | port into `doctor.py --deep` | S | 🟢 |
| 12 | **Engine-version boundary** | `convert_league_version.py`: `engineFirstSeason`, metadata seasons filtered by engine version, C2 gate | no boundary concept (BLM has its own calib) | `engine_first_season` in settings + refusal in `metadata_inputs.py` | S | 🟢 |
| 13 | **Parks** | league mean includes the home park (`ballparks.py:269-284`, Excel row 33) | 50% home + 50% mean of *other* parks, Neutral/My-Park bases, per-club values with exact-delta gate | adopt his; drop ours | — | 🟢 |
| 14 | **Slot shares** | `compute_slot_shares.py` real-IP depth weights | check `positionalStrength.js` for measured vs assumed weights | port if assumed | S | 🟢 |

Our 462 pipeline tests do not port (they gate our pipeline byte-for-byte). What ports is the
*discipline*: every merged item lands with a fidelity test against a frozen fixture, in his
`tools/tests` style, run by CI.

---

## 4. Phase 3 — Data and ingest (≈ 1–2 weeks)

| Item | Ours | His | Merge | Effort |
|---|---|---|---|---|
| **Draft pool** | tokenless `<api>/draftpool/` + `/date`, ratings from dated scout dumps (`draftpool.py:73-115`) | requires the OOTP draft-pool CSV export; docstring claims StatsPlus has no eligibility endpoint — `/draftpool/` contradicts it | add `fetch_draftpool` to his `statsplus.py` as the primary source, export as fallback | S |
| **Contracts / options** | `/contract` + `/contractextension` incl. team/player/vesting options and buyouts (`statsplus.py:64-92`); `salary_report.py` annotations; `contract_projection.py` (Super Two, 172-day year) | `attach_contract_injury` (`statsplus.py:1378-1475`) **discards option/buyout fields**; `STATUS.md:121`: "options priced as guaranteed … ~149 TGS contracts overstate Owed/control" | keep the option fields; add `/contractextension`; port `contract_projection.py` | M |
| **Live waiver clock** | `/players` `days_on_waivers_left` (`app/src/utils/waivers.js:7-9,55-60`), `has_received_arbitration`, pro/secondary service days | keeps `OnWaivers`/`DFA` flags only; `waivers.js:20-21` has no 40-man flag | extend his `/players` mapping; write the game date into `metadata.json` (his `serviceTime.js` can't print FA years without it) | S |
| **Roster-management fields** (ON40, OPT, OY, R5, YL qualifiers, IC, PROY…) | from the OOTP `org.csv` export (184 cols → `export.py:734-790`) | ratings come from `/ratings` (~99 cols); his `serviceTime.js:26-27`: "NOT AVAILABLE: option years, the 40-man clock, Rule 5 status" | **optional local-export enrichment layer**: his `local_export` league type already exists (RG); accept `org.csv` beside the pull and merge by player ID. Without it, derive R5 from pro service + signing age (🔵 rule, labelled) | M |
| **Wrong-league guard, refusal typing, token age warning, honest pull report** | absent (our `_fetch_csv` swallows errors and caches `[]`) | present | adopt his | — |

---

## 5. Phase 4 — App: port our views into his app (≈ 3–4 weeks part-time)

**Design direction (decided 2026-10-03): the merged app looks like OURS, not his.** Our design was
recently redone and is the look we keep: gradient ground (`#0c1222 → #0f172a`), 210 px panel
sidebar with the emoji nav and the My team / Game date controls, translucent cards
(`rgba(15,23,42,0.4)`, 1 px `#1e293b`, radius 10), uppercase dim table headers, JetBrains Mono
throughout (`app/src/components/Dashboard.jsx:226`; `app/docs/prototype.css` is stale on the font),
pill tabs/filters, the 20–80 grade ramp, position/level/FV-tier colors, and the colored alert
strips. The three mockups on the canvas are in this design.

**How, given his framework:** keep his app's plumbing (React 19, react-router 7, TanStack Table,
Tailwind 4) and re-theme it rather than rebuild it. Tailwind 4's `@theme` block in
`tgs-viz/src/index.css` already defines his palette and fonts; replace those tokens with ours
(our `prototype.css` variables map one-to-one), set the body gradient and the mono font there, and
restyle the shell (`App.jsx` sidebar → our 210 px panel with team/date controls). Then sweep his
pages for the handful of non-token patterns (card radius/padding, table header case, pill shape).
Our views arrive already in our look (they use `theme.js` `S` styles); keep those inline styles
rather than converting them to Tailwind. Effort: theme + shell ≈ 1 day; per-page sweep ≈ 2–3
days for his ~16 pages. Not in Phase 0.

His stack: React 19, react-router 7, TanStack Table, Tailwind 4, lucide, recharts. Ours: React 18,
dnd-kit (works on 19), recharts, no router/Tailwind. Port, don't paste.

**Bridge first.** His JSON is flat with sheet column names (`'Max WAA wtd'`, `'1B WAA wtd'`,
`'1B Eligible'`, `'Price'`, `'SalarySchedule'`, `'MLBSvcDays'`, `'WAA wtd RP'`); ours is nested
(`maxWaa.wtd`, `positions['1b'].waa.wtd`, `meta.price`, `rp.waa`). Port our `accessors.js` as the
adapter so view code reads one shape; after Phase 1 it reads the WAR fields.

| View | Ours | Effort | Needs from pipeline |
|---|---|---|---|
| **Roster Planner** (drag-drop, options/arb/Super Two queues, Rule 5 risk, 40-man) | `views/RosterPlanner` 1,788 lines + `rosterPlanning/*` | L (1–2 wk) | Phase 3 contract/option fields + org.csv enrichment |
| **Waiver Wire** → merge into his Waiver Claim page (his valuation + our live clock, claimable/cleared split, smart rank) | `WaiverWireView.jsx` 293 | S–M | `days_on_waivers_left` |
| **Prospects** (FV tiers, farm rankings) | `ProspectsView.jsx` 544 | M | his `dev_ml.json` replaces our FV inputs |
| **Scout View** (trade targets) | `ScoutView.jsx` 231 | S–M | — |
| **Player Compare** | `PlayerCompareView.jsx` 229 | S | — |
| Draft Board "I drafted" tracking | part of `DraftBoard.jsx` | S | his `draft_picks.json` |

Drop ours: FV curve (`gapMax/gapExp` hand-tuned), dev curves, decline curve, lineup optimizer,
Dev Analysis sliders — his measured/ML versions replace them. Keep his Mock Draft, Series Planner,
Market Value, Team Projections, Org Builder as they are.

---

## 6. Phase 5 — ML on the Air (needs his data; ≈ 1 week of engineering, then batch time)

Facts (his `STATUS.md`, 2026-09-25): retrain ≈ 2.6 h per basis at 318 seasons on his desktop;
table build peaks ≈ **13 GB RAM** (≈ 45 GB at his 1,000-season goal). The models, the DEV
vintages (~1.5 GB) and dumps (~145 GB) are all gitignored.

**Decision (2026-10-02): retraining does not happen on the Air.** Daily use is scoring only
(`score.py`, minutes, ~2 GB), with his trained models (BLM basis) scoring SSB from day one. If an
SSB-basis retrain is ever justified (§0 open question, settled by the real-SSB backtest in §11),
it runs on a rented 64 GB VM for a few hours. The Polars + LightGBM memory work that would make
8 GB retraining possible is **dropped** from the plan; it is recorded here only so nobody re-derives
it: sklearn upcasts X to float64 and copies it again for its validation split (~5 GB per fit at
3.2M×90), LightGBM would cut that to ~1.5 GB, and the 13 GB pandas table build would need Polars.


Daily: **scoring only** (`score.py`, minutes, ~2 GB). Until our own retrain exists, use his
trained models for BLM as-is (same basis, same league).

**Ask him for:** `tgs-viz/backtest/.dev_cache/` (models, `waa_TGS`/BLM prices, `dev_mlb_pt`
cache), `vintages/DEV/` (~1.5 GB), his exact scikit-learn version (pickles are not
version-portable), and confirmation that the raw DEV dumps are not needed once those caches exist.

---

## 7. Phase 6 — Sims on a Mac (**out of v1**; parked)

**Not needed for SSB** (§0). Sims serve only (a) more OOTP 27 calibration samples (`grind` on the
27 master) and (b) a DEV league of our own. Neither touches an online league — you cannot sim a
league you don't commission, and his pipeline never tries to; it clones a generic master. The
OOTP 26 master (`Baseline.lg`) is committed; the OOTP 27 master (`6.lg`) is not — ask him for it.

`ootp/winsim.py` (1,587 lines) is the **Windows port of your own `ootpalex/ootp-autosim`**, which
is macOS-native already (Quartz events, `screencapture`, `osascript`,
`~/Library/Application Support/.../saved_games`, `autosim.py:47`). So this is a merge back, not a
port: your backend + his clone orchestration and DEV continuous mode, in the backend-module shape
his `PORTING-WINDOWS.md` describes. Windows layer to branch on `sys.platform`: `:186-196` DPI →
no-op; `:199-252` `win32gui` window enumeration/foreground/rect → Quartz
`CGWindowListCopyWindowInfo` + `NSRunningApplication.activate`; `:254-261` screen grab → `mss` or
`CGWindowListCreateImage` (Pillow's macOS grab loses Retina detail; the code still carries a
`scale` from the mac original); `:273-330` mouse → `pyautogui`/`CGEventPost`; `:277-281` admin
check → `AXIsProcessTrusted`; `:284-290` keep-awake → `caffeinate`; **`:293` `ctypes.windll` at
import** must be guarded first (even `--list` and `cleanup_clones.py` crash today). Recapture
`ootp/buttons/*.png` + `digits/` at Retina scale; grant Accessibility + Screen Recording. Platform-
neutral already: template matching, `saved_games.dat` parsing, dump watching, clone copy, digit
OCR, DEV continuous mode. `Recalibrate BLM` additionally needs his non-GitHub clone archive
(`engine/calib/BLM/*.csv`) — ask for it.

---

## 8. Languages and workflow review

**Python stays.** The projection math is numpy over ~16k players and runs in seconds; the slow
things are OOTP itself (75 min per clone cycle), sklearn fits (hours, compiled C++ inside), and
StatsPlus rate limits (one history request per 15 min, five a day). A Rust rewrite buys nothing
there and costs the upstream relationship. **Verdict on Rust: no.** The two places Rust-speed
helps, we get from libraries: **Polars** (Rust under the hood) for the ML table build, and
**LightGBM** for training. If profiling ever shows a pure-Python hot loop (the only candidate is
`reprice.py`, already process-parallel), move that one function to PyO3.

**Hygiene we add** (neither repo has lint, formatting or type tooling; his engine has zero type
hints):

- `uv` for the venv; a `pyproject.toml` with `ruff` (lint + format) and `pytest` as the single
  runner (it collects his `unittest` suites unchanged); env markers in `requirements.txt`.
- Type hints on new code and on every function we touch in a port; `mypy --strict` only on new
  modules.
- JS: `eslint` flat config; `vitest` (or stay on `node --test` — his `.mjs` tests already run
  that way); no TypeScript migration (churn without a reader).
- CI matrix on GitHub Actions (§1d).

**Cut the run-time Excel dependency.** His engine still loads `The Sheet Hitters.xlsx` /
`The Sheet Pitchers.xlsx` at run time (`ingest/ratings.py:168,403,425,467`, `engine/hitters.py:514`,
`engine/pitchers.py:622`, `refresh.py:66`) for Data Points / Filters / Ballparks / Player List; the
`calib/*.json` fits are overlays. 14 workbooks (~620 MB) are tracked in git without LFS. Freeze the
read cells to `engine/calib/<LG>/sheet_cells.json` (he already has
`engine/extracted/*_datapoints.json`, unused by the engine), make the workbook a calibration-time
input only, and replace the BLM SP/RP Excel paste with the `SP_Data.csv`/`RP_Data.csv` that
`metadata_calibrate.py` already consumes. The 620 MB stays in history (rewriting it would break
upstream merges); we simply stop adding to it. Excel-the-app then disappears from the Mac
requirements entirely.

**Process.** Merge his `STATUS.md` engineering-log habit (dated entries, user quotes, GO/NO-GO
verdicts) with our `CLAUDE.md` audit-first rule and provenance tags; add a `DATA_CONTRACT.md` for
`public/data/<LG>/*.json` (the flat sheet-name keys are undocumented today); turn his "WHICH
BUTTON" doc into the Control cards' help text, which it mostly already is.

**Git.** Fork; `upstream` remote; merge `upstream/main` monthly on a dedicated branch with CI
green before it lands; keep our changes additive/branched as in §0; upstream the portable fixes.

---

## 9. Sequence, dependencies, effort

Two clocks run here and they must not be added together. **Coding** is done by agents in
parallel (how both repos were built; his October drop was ~80k lines in a month) and collapses
to hours. **Audit / batch / external** time does not: a human re-derives numbers and decides,
batch jobs run for hours regardless of who wrote them, and his data has to arrive.

| Phase | Work | Depends on | Coding (agent-parallel) | Audit / batch / external |
|---|---|---|---|---|
| 0 | Fork, macOS 1a + 1b + 1c + 1d | — | an afternoon | — |
| 1 | WAR currency: engine fields, app switch, bar relabel, swingman role, aging fix | 0 | a day | measuring replacement level needs a finished season's banked actuals per league; a few hours of review |
| 2 | Model merge | 0 (1 for bestPos WAR) | a day for all code | **the long pole**: audits for posAdj, out-values, baserunning, the 27 bake-off — each a re-derivation against real BLM/SSB data and a decision (the CLAUDE.md rule); hours of attention each, spread over whenever the data and you are available |
| 3 | Ingest: draftpool, contracts/options, waiver clock, org.csv enrichment | 0 | an afternoon | one OOTP `org.csv` export to test against |
| 4 | App ports: adapter, Roster Planner, Waiver Wire merge, Prospects, Scout, Compare | 1, 3 | 1–2 days | your own review of the ported pages |
| 5 | ML: Polars table, LightGBM backend + gate; pitcher retrain on WAR; SSB basis | his data; 1 | a day | his DEV vintages + `.dev_cache` (transfer); repricing hours; retrain 5–15 h per basis on the Air; the compare gate |
| 6 | winsim ← autosim merge; grind on the 27 master; own DEV league (optional) | 0; his `6.lg` master + clone archive | ~1 day (button recapture is hands-on) | OOTP sim time (~75 min per clone cycle); his files |

**What an afternoon buys:** a macOS fork running your BLM on his engine with WAR fields emitted,
CI green, and the first app ports in (Phases 0, 1-code, 3, start of 4). **What remains after it**
is mostly decisions, batch runs and waiting on data — hours of human attention over a few weeks,
not weeks of work.

---

## 10. Decisions taken (grilling session, 2026-10-02)

| Topic | Decision |
|---|---|
| User / cadence | One user. Decision-point use, but data must be as fresh as possible whenever opened. |
| Definition of done | SSB Draft Board and Roster Planner on his engine's WAR, **dev odds on draft prospects** (headline), data never older than the last pull. |
| Why fork | Roster-management pages + WAR. His engine internals untouched. |
| Upstream | He keeps shipping; PRs maybe. Fork with `upstream` remote; additive-only changes; offer the macOS fixes and `/draftpool` as PRs; recommend `/draftpool` to him. No collaboration assumed. |
| WAR | Think-in-WAR + cross-role comparison + $ valuation. **Market** replacement for every displayed WAR and $; **org** replacement only inside the optimizer. **Rates** per full season, labelled; no playing-time model. Bars **relabelled** now, redefined at the first retrain. |
| Leagues | **SSB only.** BLM parked (configured, off) as the ML yardstick. No sims in v1. SSB = OOTP 27 curves + own StatsPlus metadata, gated with `live_gate`. |
| Freshness | His Control page + live refresh (so Phase 1b joblock/kill fixes are Phase 0). Pull on open, data-date visible. No scheduler. |
| Hardware | Air is the client. Retrain (if ever) on a rented VM. Air-memory engineering dropped. |
| ML | His models (BLM basis) score SSB from day one, labelled "DEV-trained". His ML trains on the DEV league only (`ml/common.py:46`); real-league outcomes never enter. **Gate** any FV-tier blending and the SSB-basis decision on a real-SSB backtest from StatsPlus past-date snapshots (ask the StatsPlus author to enable SSB history; ~2 days of pulls at 5/day for a usable window). |
| Draft odds | Add MLB% / Starter% / Star% / Exp-peak to Draft Board + Mock Draft now (the models already score amateurs; the board just doesn't display them). Fold into FV tiers after the backtest, FanGraphs-style. |
| Draft pool | `/draftpool` primary, OOTP export fallback. |
| Roster Planner data | Your `org.csv` export only; show the last export dated with a staleness warning, never hide. No service-time derivation fallback. |
| Audit order | replacement level → posAdj → out-values → 27-curve bake-off → baserunning. Everything else ships tagged **unaudited** in the app. Budget ≈ an hour a week. |
| Audit time | ~1 h/week. |
| Order of app work | Draft Board odds → Roster Planner → Waiver merge → Prospects → Scout/Compare. |
| Design | **Ours**, not his: the merged app is re-themed to our current design (gradient ground, mono, panel cards, pill tabs, emoji sidebar). His framework stays; his `@theme` tokens and shell are replaced (§5). Mockups of Control + freshness, Draft Board with odds, Roster Planner approved in our look (2026-10-03). |
| Dropped from ours | FV sliders, dev curves, decline curve, lineup optimizer, Dev Analysis. |
| Ask of him | `tgs-viz/backtest/.dev_cache/` (models + caches) and his scikit-learn version now; `vintages/DEV/` later; `6.lg` only if sims ever return. |

## 11. Immediate next steps

1. Send him the two-folder ask (message drafted in the session log).
2. Mockup page: Control/freshness, Draft Board + odds, Roster Planner in his stack.
3. Phase 0 on the fork (macOS 1a + 1b + 1c + 1d), console pull of SSB working.
4. Draft Board odds wiring (first app change; proves data → WAR layer → view).
5. Replacement-level audit (first calculation change).
