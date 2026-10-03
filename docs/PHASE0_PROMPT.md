# Phase 0 prompt — fork perfektprojections and make it run on macOS

*Paste everything below the line into a Claude Code session on the Mac. Companion to
`MIGRATION_PLAN.md` §1 and §5 (same branch). Line numbers refer to perfektprojections `e9aca96`
(2026-10-01) — treat them as pointers and grep before editing.*

---

I'm migrating my OOTP analytics work onto a fork of a friend's repo, `perfektoa/perfektprojections`
(Python engine + ingest in `tgs-viz/`, Vite/React app in `tgs-viz/src`, OOTP automation in `ootp/`,
Windows `.bat` launchers at the root). It is Windows-only today. Your job is **Phase 0: fork it and
make the app, the StatsPlus pulls, the engine and ML scoring run on this Mac (Apple Silicon)**, with
CI proving it. Nothing about the model or the app's features changes in this phase.

## Ground rules

- **Additive and portable.** Every change is behind `sys.platform`/`os.name`, a settings default, or
  a new file. Windows must keep working byte-for-byte where the existing tests assert it. I will be
  merging his `main` monthly, so keep the diff small and mergeable; never rewrite his engine
  (`tgs-viz/engine/`) or his ingest logic.
- **Never push to `perfektoa/perfektprojections`.** Work on a branch `macos-baseline` in **my** fork.
- **"TGS" is the name of HIS online league, not a product name.** I'm not in it. Existing file,
  env-var and task names in his repo keep it (`Launch TGS.bat`, `TGS_SELFTEST`, `TGS_CONTROL_DIR`,
  the `tgs-viz/` folder, the `TGS` league entry) — leave those alone for mergeability — but nothing
  NEW we create is named TGS. New launchers are `Launch Dashboard.command` etc., new env vars are
  `DASH_*`, docs say "the app". The TGS league and its data stay committed but are switched off in
  `settings.local.json`; my league is SSB.
- **Secrets.** My StatsPlus token goes only in the gitignored `StatsPlus Tokens.txt` and is never
  printed, logged or committed. Ask me for it when you reach step 6; don't guess at it.
- Commit after each numbered step with a clear message. Run the relevant tests before each commit.
- If something in this list turns out to be already fixed, or wrong, say so and move on — don't
  invent work. If a step needs a decision I haven't given you, ask.
- **Design direction (read before touching anything in `tgs-viz/src`).** The merged app will look
  like MY dashboard's redesign — "Night Scorecard" — not like his. Night Scorecard is a specified
  system in `ootp-dashboard` (`app/src/theme.js`, `app/docs/redesign/mockup/night-scorecard.html`,
  `app/docs/redesign/CHECKS.md`, generated `app/src/tokens.css`): graphite ground `#141516`, panel
  `#1b1c1e` / panel-2 `#212225`, cream ink `#ebe6da`, ONE red-pencil accent `#e6655a`, Archivo (body)
  + Archivo Narrow (headers, chips, nav, buttons), radius 3, scorecard boxes with panel-2 header
  strips, OKLab-verified encodings (20–80 grade ramp `--g20…--g80`, position `--p-*`, level ladder
  `--l-*`, filled FV tier pills, z-heat cells, NEED rows). **None of his visual language survives**
  (slate/blue palette, rounded-xl cards, uppercase tracking labels, lucide icons, pill filters).
  What we keep from his app is interaction structure only: the Control page's job panel + task
  cards, toggleable column groups and a sticky name column on wide tables, League / Park-basis
  controls in the sidebar's nav-controls box, the in-place refresh toast, row → detail drawer.
  In this phase you do NOT restyle his pages (that is a later phase); you only (a) get the redesign
  into git so it is reachable, and (b) lay the token foundation in the fork (steps 0 and 7 below)
  so nothing built on his `@theme` has to be undone later.

## Steps

### 0. Push my redesign first (it exists only on this machine)
- In my `ootp-dashboard` checkout the Night Scorecard redesign is uncommitted/unpushed. Before
  anything else: `git status`, then `git checkout -b design/redo`, commit everything belonging to
  the redesign (`app/src/theme.js`, `app/src/tokens.css`, `app/docs/redesign/**` — the mockup,
  `CHECKS.md`, `contrast.mjs`, `gen-tokens-css.mjs` — and any call-site migrations already made
  for the BREAKING items listed in the `theme.js` header), and `git push -u origin design/redo`.
  Show me `git status` before committing if anything looks unrelated; don't sweep unrelated
  local changes into it. Confirm `node app/docs/redesign/gen-tokens-css.mjs > app/src/tokens.css`
  reproduces the committed `tokens.css` (so the generator, not the file, is the source of truth).

### 1. Fork and set up
- `gh repo fork perfektoa/perfektprojections --clone --remote` (origin = my fork, `upstream` = his).
  `cd` in, `git checkout -b macos-baseline`.
- One venv: `uv venv .venv --python 3.13` (or `python3 -m venv .venv` if uv isn't installed), then
  install `requirements.txt` **and** `requirements-ml.txt` into it. The repo currently assumes two
  interpreters (`python` 3.13 and `py -3.14` for ML); we use one.
- `cd tgs-viz && npm install`.

### 2. Make the Python side run on POSIX (app + pulls + engine + scoring)
- `requirements.txt`: `pywin32` has no macOS wheel — add environment markers
  (`pywin32; sys_platform == "win32"`). Add `pyobjc-framework-Quartz; sys_platform == "darwin"`
  only if you also do step 7; otherwise leave it out.
- Interpreter defaults: `tgs-viz/tools/settings.defaults.json` has `"python": {"main": ["python"],
  "ml": ["py", "-3.14"]}`; hard fallbacks in `tgs-viz/control/paths.js` (~:70, :89),
  `tgs-viz/tools/run_task.py` (~:1505), `tgs-viz/tools/doctor.py` (~:162, :190). Default to
  `["python3"]` on non-Windows, and write a `settings.local.json` (gitignored) that points both
  `python.main` and `python.ml` at `<repo>/.venv/bin/python`. The interpreter is a settings value
  (`settings.py` ~:319-322, `run_task.py` ~:529-534), so no code should need to change for the
  unification itself — only defaults, tests and docs.
- Path separators: `tgs-viz/tools/tasks.py` has ~49 raw-string Windows paths (e.g.
  `WINSIM = r"ootp\winsim.py"` ~:1033, `r"tgs-viz\backtest\ml\dataset.py"` ~:1158, `exists_check`
  paths ~:1520, calib JSONs ~:1541-1543, `"{job_dir}\\xl"` ~:2218) plus `run_task.py` ~:1364.
  `run_task.argv()` (~:525-537) passes them verbatim to `Popen(cwd=REPO)`, so on POSIX every task
  step dies "can't open file". **Normalise in one place** — `argv()` and `tgs-viz/tools/conditions.py`
  (~:53-56) — rather than editing 49 strings. Windows accepts `/`, so normalising to `/` is safe.
- `run_task.py` ~:947 and ~:1197 call `subprocess.call("pause", shell=True)` (a cmd.exe builtin;
  on POSIX exit 127 and the gate falls through). Use `input()` when not Windows.
- `doctor.py`: ~:239-251 checks `node_modules/.bin/vite.cmd` (fails on a healthy Mac — check
  `.bin/vite` or `node_modules/vite/package.json`); ~:166 lists `win32gui` as an expected module
  (make the list platform-conditional); ~:190 probes `py -3`.
- OOTP save paths: `settings.defaults.json` ~:7-8 has `C:/OOTP 26/...` and
  `%USERPROFILE%/Documents/...`; `settings.py expand_path` (~:367-375) leaves `%USERPROFILE%`
  literal on POSIX. Add a darwin default of
  `~/Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games` and
  add that path to the discovery fallbacks in `tgs-viz/backtest/dump_source.py` (~:149-152) and
  `tgs-viz/ingest/export_league.py` (~:92-94).
- Launcher: the 13 root `.bat` files and 5 `ootp/*.bat` are one 15-line template that runs
  `tgs-viz\tools\run_task.py <task> %*` then `pause`. Add a `.command` equivalent
  (`cd "$(dirname "$0")"; "${DASH_PY:-.venv/bin/python}" tgs-viz/tools/run_task.py <task> "$@";
  rc=$?; read -rp "Press Enter"; exit $rc`) for at least `Launch Dashboard.command` (his
  `Launch TGS.bat`), `Check Setup.command`, `Get StatsPlus Ratings.command`,
  `Update Draft Board.command`; set the exec bit with `git update-index --chmod=+x`.
  Leave the `.bat` files and `.gitattributes` (`*.bat eol=crlf`) alone.
- Verify: `python tgs-viz/tools/run_task.py --plan doctor` (or the task's `--plan` form — check
  `run_task.py --help`) shows POSIX paths; `python tgs-viz/tools/doctor.py` reports no spurious
  failures; `cd tgs-viz && npx vite --port 3000 --strictPort` serves the app with the committed
  league data (his four leagues ship in `public/data/`; SSB is added in step 6).

### 3. Make jobs and the Control page work on POSIX
These are what the app's Control page needs for safe concurrent jobs; until they're done, console
mode works one run at a time but the guards are void.
- `tgs-viz/tools/joblock.py` ~:174-175 and ~:206-211 read `/proc/<pid>/stat` for a process start
  time. No `/proc` on macOS → `None` → `alive()` (~:217-221) is false for every job → active jobs
  are reaped as "lost", locks are void, `--kill` says not active. Add a darwin branch: `libproc`
  `proc_pidinfo(PROC_PIDTBSDINFO)` via ctypes, or parse `ps -o lstart= -p <pid>`. Keep the Linux
  `/proc` path.
- `joblock.py take_lock` (~:296-299) relies on `os.rename` raising `FileExistsError`; POSIX rename
  overwrites silently, so two takers both win. Use `os.open(..., O_CREAT | O_EXCL)` (or `os.link`).
- `run_task.py kill_tree` (~:869-874) and `cmd_kill` (~:1920-1926) use `taskkill`; on POSIX the
  exception is swallowed and Kill does nothing. Spawn steps with `start_new_session=True` (the
  spawn is ~:822-824, which already passes `creationflags` only on Windows) and kill with
  `os.killpg(SIGTERM)` then `SIGKILL`.
- `tgs-viz/control/test/mock_tools/run_task.py` (~:45-62, :499-505, :564) has unguarded
  `ctypes.WinDLL`, `creationflags` and `taskkill`; mirror joblock's platform branch so the three
  Node smoke tests can run.
- Verify: start two tasks that share a data lock from the Control page (`TGS_SELFTEST=1` exposes
  harmless self-test tasks — see `tgs-viz/control/DESIGN.md` §15) and confirm the second waits;
  Kill actually stops a running job; `/__tgs/` jobs survive a page reload with correct status.

### 4. Tests
- Portable now: `tgs-viz/tools/tests/test_catalog.py`, `test_doctor.py`, `test_new_league.py`,
  `test_settings_defaults.py` — fix the `python`/`py` assertions (`test_settings_defaults.py`
  ~:54-58, :174-177, :185-186; `test_new_league.py` ~:215). Node:
  `tgs-viz/control/test/{fileMap,guards,pythonMain}.test.mjs`, `tgs-viz/tests/client/*.test.mjs`
  (`node <file>`).
- Windows-bound — gate on `os.name == "nt"` with a clear skip message, don't delete:
  `test_bat_equivalence.py` (+ `batsim.py`: `cmd /c`, `taskkill`, CRLF checks),
  `test_run_task.py` (`creationflags`, Toolhelp). Port `test_run_task.py` to POSIX after step 3 if
  it's tractable; otherwise leave it gated and say so.
- Run everything with `python -m pytest tgs-viz/tools/tests` (pytest collects his `unittest`
  classes unchanged; add `pytest` to a `requirements-dev.txt`).

### 5. CI
- Add `.github/workflows/ci.yml`: matrix `macos-latest` + `ubuntu-latest`; Python 3.13 with both
  requirement files; `python -m pytest tgs-viz/tools/tests`; the Node test files; `npm ci && npm run
  build` in `tgs-viz`. The repo has no CI today. Make it green on both runners before you call the
  branch done — the macOS runner is the only place the Darwin-only branches (joblock start time,
  Library path) actually execute, so it's part of the verification, not decoration.

### 6. Prove a real pull works (my league)
- Restore the ratings archive: `python tgs-viz/backtest/vintage_backup.py --restore` (every update
  task refuses until `tgs-viz/backtest/ratings_history.db` exists).
- Add my league **SSB** with the New League backend (`tgs-viz/tools/new_league.py` — check,
  profile, register; or the wizard on the Control page). SSB is OOTP 27; its basis is **BLM** for
  now (same OOTP version; the plan gives SSB its own metadata later). Ask me for the StatsPlus
  token and the league's StatsPlus URL when you get here.
- Run `Get StatsPlus Ratings` for SSB from the console (`run_task.py get_ratings`, or
  `update.SSB` if the registry names it that way) and show me the data-date report at the end. The
  app should then list SSB with today's game date. If StatsPlus refuses (token, "too soon", not
  enabled), report the typed refusal exactly; don't retry in a loop.

### 7. Design foundation in the fork (tokens + shell only — no page restyling yet)
- Copy `app/src/tokens.css` from `design/redo` into the fork as `tgs-viz/src/tokens.css` and note
  its origin in a one-line header (it is generated upstream; do not hand-edit it here).
- In `tgs-viz/src/index.css` replace his Tailwind 4 `@theme` block's colour and font tokens with
  Night Scorecard's: map `--color-surface/-2/-3` → `--bg/--panel/--panel-2`, `--color-border` →
  `--line-2`, `--color-primary` → `--accent`, `--color-positive/negative/accent` → `--good/--bad/
  --warn`, `--font-sans` → Archivo, and add Archivo Narrow as `--font-narrow`; set `body` to the
  graphite ground, cream ink, Archivo 13px, `font-variant-numeric: tabular-nums`; remove the Inter /
  JetBrains Mono `<link>` in `tgs-viz/index.html` and add the Archivo + Archivo Narrow Google Fonts
  `<link>` (the exact URL is in the `tokens.css` header). Delete his `.data-table` rules or re-point
  them at the token variables; do not leave two palettes alive.
- Rebuild the shell only: `tgs-viz/src/App.jsx` sidebar → the Night Scorecard nav from the mockup
  (200 px paper panel `--panel` with `--line-2` right rule; brand "SSB" 22 px 800 with "GM
  Dashboard" in Archivo Narrow muted; a nav-controls box on `--panel-2` holding League, My Team,
  Game Date, Park basis as underlined selects; page list in Archivo Narrow 14 px with the red-pencil
  tick `::before` on the active item; Settings pinned at the bottom above a `--line` rule). Keep
  his routes and page components untouched; they will look wrong against the new ground and that
  is expected at the end of this phase.
- Verify: the app loads with the graphite ground, Archivo, and the new sidebar; every route still
  renders; `npm run build` passes. Screenshot the Hitters page and the Control page for me.

### 8. Skip for now
- Restyling his ~16 pages to Night Scorecard (scorecard boxes with `h2` strips, Archivo Narrow
  table headers, `.badge`/`.tier`/NEED encodings) is the next phase, after this one is green.
- `ootp/winsim.py` (OOTP GUI automation) stays Windows-only in this phase. Only make sure its
  import-time `ctypes.windll` (~:293) is guarded so `--list`/`--dry-run` and
  `ootp/cleanup_clones.py` don't crash on import. Sims are out of scope.
- Nothing in `tgs-viz/engine/`, `tgs-viz/ingest/statsplus*.py`, or the ML code changes.

## Done means
- `macos-baseline` on my fork, CI green on macOS and Ubuntu.
- `Launch Dashboard.command` opens the app; Control page runs `doctor` and `get_ratings` as jobs with
  working Stop and lock exclusion.
- An SSB pull completed from this Mac with a clean data-date report.
- `design/redo` pushed on `ootp-dashboard`; the fork carries `tokens.css`, the Night Scorecard
  `@theme`, fonts and shell, with his pages still functionally intact (unrestyled).
- A short `docs/MACOS.md` in the fork: setup steps, what's platform-branched and where, what's
  still Windows-only (winsim, the bat-equivalence tests).
- A list, in your final message, of the fixes that are pure portability wins I could offer upstream
  as a PR (path normalisation, `pause`, doctor checks, requirements markers), separated from the
  ones that are mine (SSB registration, settings.local.json).
