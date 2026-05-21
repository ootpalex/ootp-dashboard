# OOTP Export Guide

How to export OOTP data so the dashboard can read it. The fastest path is to install the bundled OOTP saved-views file (so you don't have to build the column list by hand), export each CSV at most once per refresh, and drop them into `leagues/<your-slug>/csv/players/`.

## Required CSV files

The pipeline discovers files by exact filename in `leagues/<your-slug>/csv/players/`. Patterns are defined in `model/src/players.py` (`_SOURCE_PATTERNS`).

| Filename | Source tag | Required? |
|---|---|---|
| `org.csv` | `Organization` | **Yes** — MLB + MiLB players; the only file the pipeline strictly requires |
| `intl.csv` | `Organization` | Optional — IntlComplex split file; needed only when OOTP paginates the org export |
| `ballparks.csv` | (loaded separately) | **Yes** — saved one level up at `leagues/<slug>/csv/ballparks.csv` |
| `freeagents.csv` | `Free Agent` | Optional — enables Free Agent Finder view |
| `iafa.csv` | `IAFA` | Optional — enables IAFA Board view |
| `draftYYYY.csv` (e.g. `draft2042.csv`, `draft1967.csv`, `draft2156.csv`) | `Draft YYYY` | Optional — enables Draft Board. Any 4-digit year works. |
| `*_osa.csv` siblings | OSA blend | Optional (80/20 default) |
| `*_aaa.csv` / `*_aa.csv` siblings | Relative-rating blend | Optional |

When an optional CSV is missing, the corresponding view in the dashboard hides itself automatically — no errors.

Files **must** be saved into `leagues/<your-slug>/csv/players/`. Power users can override the path via `python3 model/main.py --league <slug> --player-dir <other-path>`, but the standard flow uses the league folder.

---

## org.csv

- **OOTP screen:** **League → Reports & Info → List All MLB Players**.
  - Check **Include minor leaguers**.
  - **Small leagues:** also check **Include international complex** and export everything in one pass.
  - **Large leagues:** leave **Include international complex** *unchecked* and export the IntlComplex players separately as `intl.csv` (see the next section). OOTP only writes the visible page to CSV, so if your org listing paginates, splitting the export is the only way to capture every player.
  - Clear all filters.
  - Set the position selector to **All Players**.
- **Filters & Views preset:** Load the bundled `Player Export` preset. The project ships two OOTP data files at [`docs/ootp_views/`](ootp_views/) — `player_views` (column layouts) and `player_filters` (filter presets). Copy both into OOTP's `tables/` folder; see [`docs/ootp_views/README.md`](ootp_views/README.md) for the exact path on macOS / Windows / Linux. **Loading these files overwrites your existing OOTP views and filters** — back yours up first if you have customized presets.
- **Required columns:** The `Player Export` preset already includes every column the pipeline reads. It is intentionally a superset — almost every non-stats column OOTP exposes — so the same preset can be reused for `intl.csv`, `freeagents.csv`, `iafa.csv`, and `draftYYYY.csv` without modification.
- **Export action:** Click **Report → Write Report to CSV**. OOTP writes the file into your save's `<your-league>.lg/import_export/` folder.
  - **Important:** OOTP overwrites the same filename on every export. Move/rename the freshly-written CSV (drop it into `leagues/<slug>/csv/players/org.csv` directly) **before** exporting the next file, or you'll lose it.
- **Save as:** `leagues/<slug>/csv/players/org.csv`
- **Gotchas:**
  - OOTP overwrites previous exports in `<league>.lg/import_export/` without warning. Always move/rename between exports.
  - Only `org.csv` is strictly required; the rest of this guide is about additional optional exports that unlock more dashboard views (IntlComplex split, Free Agent Finder, IAFA Board, Draft Board, OSA / AAA / AA blending).
  - **Migrating from a pre-rename project?** Rename your existing `organization.csv` (and any `organization_osa.csv` / `_aaa.csv` / `_aa.csv` siblings) to `org.csv` (and `org_osa.csv` / etc.). Validation will print a friendly reminder if it spots the legacy name.

## intl.csv (optional — needed when OOTP paginates the org export)

In larger leagues, **List All MLB Players** can grow past one screen, and OOTP's CSV export only writes the visible page. The workaround is to export the IntlComplex players as a separate file.

- **OOTP screen:** Same screen as `org.csv` (**League → Reports & Info → List All MLB Players**), with two changes:
  - Check **Include international complex**.
  - Apply a filter so only complex players remain (e.g. filter by team / level so non-complex rows drop out). Any filter that yields a one-page list of IntlComplex players works.
- **Filters & Views preset:** Same `Player Export` preset as `org.csv`.
- **Export action:** **Report → Write Report to CSV**, then move/rename the file out of `<your-league>.lg/import_export/`.
- **Save as:** `leagues/<slug>/csv/players/intl.csv`
- **How the pipeline treats it:** rows from `intl.csv` are concatenated with `org.csv` and tagged `source = "Organization"` — downstream views (Prospects, Org → R5 Eligible, etc.) behave identically to a single-file export.
- **OSA / AAA / AA pairing:** follows the same stem rule as `org.csv` — `intl_osa.csv`, `intl_aaa.csv`, `intl_aa.csv` are auto-discovered if present.

## freeagents.csv (optional — enables Free Agent Finder)

- **OOTP screen:** **League → Reports & Info → Free Agents**.
  - Clear all filters.
  - Set the position selector to **All Players**.
- **Filters & Views preset:** Set the view to **Player Export** (the same view used for `org.csv`).
- **Export action:** **Report → Write Report to CSV**. OOTP overwrites the same file in `<your-league>.lg/import_export/` — move/rename the new CSV before exporting the next one.
- **Save as:** `leagues/<slug>/csv/players/freeagents.csv`

## iafa.csv (optional — enables IAFA Board)

- **OOTP screen:** Two ways to get there:
  - **During signing period:** **League → International Amateurs** sometimes appears as its own menu entry.
  - **Always available:** **League → Reports & Info → Free Agents**, then on the ribbon at the top click **International Amateur FA**.
  - Clear all filters and set the position selector to **All Players**.
- **Filters & Views preset:** Set the view to **Player Export** (the same preset used for `org.csv`).
- **Export action:** **Report → Write Report to CSV**, then move/rename the file out of `<your-league>.lg/import_export/`.
- **Save as:** `leagues/<slug>/csv/players/iafa.csv`

## draftYYYY.csv (optional — enables Draft Board)

- **OOTP screen:** **League → Rookie Draft**, then click **Draft Pool** from the ribbon at the top.
  - In the **top-right corner** there is a dropdown to choose the draft year. Pick the year you want to export.
  - Clear all filters and set the position selector to **All Players**.
- **Filters & Views preset:** Set the view to **Player Export**. Draft-specific columns (`Round`, `Pick In Round`, `Supplemental`) come from this same view.
- **Filename rule:** must match the regex `^draft(\d{4})\.csv$` (case-insensitive). Any 4-digit year works — `draft2042.csv`, `draft1967.csv`, `draft2156.csv`. Multiple draft classes can coexist; each becomes a `Draft YYYY` source tag.
- **Export action:** **Report → Write Report to CSV**, then **rename the file to `draftYYYY.csv`** matching the draft year you selected, before moving it into `leagues/<slug>/csv/players/`. Repeat the export once per draft year.
- **Save as:** `leagues/<slug>/csv/players/draftYYYY.csv` (e.g., `draft2042.csv`).

## Optional: OSA, AAA, AA blending exports

The pipeline can blend additional rating sources for finer-grained projections. Each blend is its own export — same `Player Export` view, same filter, but with the rating-source toggles changed before clicking **Report → Write Report to CSV**.

### OSA (Online Scouting Association) ratings

Every player-listing screen (List All MLB Players, Free Agents, International Amateur FA, Draft Pool) has a **Scouting** dropdown / toggle. Click it and choose the OSA option instead of your own scout. Re-export each screen you care about; rename each resulting CSV with the `_osa` suffix.

| Scout file | OSA companion |
|---|---|
| `org.csv` | `org_osa.csv` |
| `intl.csv` | `intl_osa.csv` |
| `freeagents.csv` | `freeagents_osa.csv` |
| `iafa.csv` | `iafa_osa.csv` |
| `draftYYYY.csv` | `draftYYYY_osa.csv` |

The pipeline blends scout and OSA at an 80/20 weight by default (configurable per league via `scoutWeight` / `osaWeight` in `league.json`).

### AAA / AA relative ratings

OOTP ratings are quantized to 5-point increments (20, 25, 30, …, 80). Exporting at a lower level reveals finer distinctions within each tier — see `model/src/relative_ratings.py` for the blending algorithm.

To switch the rating frame:

1. Click into **any player profile**.
2. In the top-right of the player card, find the **"Ratings relative to: …"** label and click the dropdown.
3. Pick a **AAA league** (for the `_aaa.csv` exports) or a **AA league** (for the `_aa.csv` exports).
4. Back out to **List All MLB Players** and re-export. Repeat for each filter (org / intl / freeagents / iafa / draft).
5. **Use the same AAA league across every `_aaa.csv` export, and the same AA league across every `_aa.csv` export.** Inconsistent reference leagues across files will produce noisy blending. The specific league you pick doesn't matter as long as you stay consistent.
6. The dropdown setting persists globally between screens. The most efficient workflow is to do all three exports for one filter before moving to the next:
   - On the **org** screen: export at MLB, switch to AAA → export, switch to AA → export.
   - On the **intl** screen (if you're using the split export): MLB, AAA, AA.
   - Move to the **free agents** screen: MLB, AAA, AA.
   - Move to **IAFA**: MLB, AAA, AA.
   - Move to **draft**: MLB, AAA, AA.
7. **When you're done, change the dropdown back to MLB.** Leaving OOTP in AAA-relative or AA-relative mode is easy to forget about and will confuse you later when ratings look "off".

| Scout file | AAA companion | AA companion |
|---|---|---|
| `org.csv` | `org_aaa.csv` | `org_aa.csv` |
| `intl.csv` | `intl_aaa.csv` | `intl_aa.csv` |
| `freeagents.csv` | `freeagents_aaa.csv` | `freeagents_aa.csv` |
| `iafa.csv` | `iafa_aaa.csv` | `iafa_aa.csv` |
| `draftYYYY.csv` | `draftYYYY_aaa.csv` | `draftYYYY_aa.csv` |

When OSA blending is enabled too, OOTP will also need separate AAA / AA exports of the **OSA-source** view (`org_osa_aaa.csv`, `org_osa_aa.csv`, etc.). The relative-rating dropdown applies to whichever scout you have selected, so toggle the Scouting dropdown to OSA first, then change the relative-ratings league.

In total, with all blends enabled, you can end up with as many as 4 files per filter: `<base>.csv`, `<base>_osa.csv`, `<base>_aaa.csv`, `<base>_aa.csv`, plus the OSA equivalents (`<base>_osa_aaa.csv`, `<base>_osa_aa.csv`). All blending is opt-in — `org.csv` alone is enough for a working dashboard.

---

## Metadata files (per-league seasonal refresh)

The pipeline can calibrate league-specific constants — wOBA weights, league stat rates, rating averages, fielding baselines, and position adjustments — from your own league's data instead of the bundled OOTP 26 defaults. It does this by reading the CSVs in `leagues/<slug>/metadata/`.

**This is optional.** With an empty `metadata/` directory the pipeline falls back to `DEFAULT_HITTER_DP` / `DEFAULT_PITCHER_DP` (calibrated against OOTP 26 baseline data) and produces a perfectly usable dashboard. Refreshing metadata from your own league improves accuracy for *that* league and is recommended once per season.

> **Timing — export at the start of the playoffs, _not_ the offseason.** Once the offseason begins, players retire. Retired players still show up in the exports, but their ratings come through as **OSA-only**, which skews the league rating averages the pipeline computes. Exporting at the start of the playoffs captures the full league while everyone still has real (non-OSA) ratings.

### Season layout

`leagues/<slug>/metadata/` supports two layouts:

**Single season (flat).** Drop the metadata CSVs directly in the folder; the pipeline treats them as one season:

```
leagues/<slug>/metadata/
├── hitting_data.csv
├── batter_ratings_vr.csv
└── … (the full file set below)
```

**Multiple seasons (recency-pooled).** Put each season's CSVs in an all-digit `<year>/` subfolder. The pipeline pools the most recent seasons, weighting newer data more heavily:

```
leagues/<slug>/metadata/
├── 2042/   ← newest present season
│   └── … (the full file set below)
├── 2041/
│   └── … (the full file set below)
└── 2040/
    └── … (the full file set below)
```

- Recency weights are **3 / 2 / 1**, newest-first (`metadata.py` `_DEFAULT_SEASON_WEIGHTS`). The newest present year gets weight 3, one year older 2, two years older 1.
- Each season's constants are computed independently, then **field-wise weighted-averaged** into the final calibration.
- Seasons more than two years older than the newest are **ignored**. Gap years are fine — e.g. with `2042/` and `2040/` present (no `2041/`), 2042 gets weight 3 and 2040 gets weight 1; the empty weight-2 slot is just unused.
- On a pooled run the pipeline prints `Pooling N metadata seasons [years] weighted [weights]` so you can confirm what it picked up.

**To add a new season:** create a new `<year>/` subfolder and export the full file set below into it. (If you're currently on the flat single-season layout and want to start pooling, move your existing CSVs into a `<year>/` subfolder first.)

### Files to export each season

Every season folder needs the same set of files, sourced from a handful of OOTP screens. Export each one and save it with the exact filename shown.

| File | Contents |
|---|---|
| `hitting_data.csv` | League batting counting stats |
| `pitching_data.csv` | League pitching counting stats (overall) |
| `sp_data.csv` | Starter-only pitching counting stats |
| `rp_data.csv` | Reliever-only pitching counting stats |
| `batter_ratings_vr.csv` / `batter_ratings_vl.csv` | Per-batter ratings vs RHP / vs LHP |
| `pitcher_ratings_vr.csv` / `pitcher_ratings_vl.csv` | All pitcher ratings vs RHP / vs LHP (SP/RP split is computed by the pipeline) |
| `fielding_data_c.csv` … `fielding_data_rf.csv` (8 files) | Per-position fielding stats (`c`, `1b`, `2b`, `3b`, `ss`, `lf`, `cf`, `rf`) |
| `fielding_ratings.csv` | Per-player fielding ratings |

The per-screen export walkthroughs below follow the same shape as the player-CSV sections above (OOTP screen → view preset → export action → save-as).

### hitting_data.csv

- **OOTP screen:** Click your league name in the top bar (e.g. **MLB**) → **Statistics → Sortable Stats**. Set the player pool to **All players** (not just *Qualified*), so part-season and low-PA players are included.
- **View:** Load the **`Batting Export`** view. *(New saved view — ships in [`docs/ootp_views/`](ootp_views/); see [`docs/ootp_views/README.md`](ootp_views/README.md) for install.)*
- **Filters:** Set all **splits to None** and **Scope** to the **major-league level**. A **PA > 0** filter is optional — it only trims the list cosmetically, since the model already ignores 0-PA players.
- **Export action:** **Report → Write Report to CSV**.
- **Save as:** OOTP writes the file into your league's `import_export/` folder. Rename it to `hitting_data.csv` and move it into the season folder — `leagues/<slug>/metadata/<year>/hitting_data.csv` (e.g. `leagues/SSB/metadata/2042/hitting_data.csv`).

### pitching_data.csv / sp_data.csv / rp_data.csv

All three come off the same screen and view — only the **Split** changes.

- **OOTP screen:** Click your league name in the top bar (e.g. **MLB**) → **Statistics → Sortable Stats**. Set the player pool to **All players** (not just *Qualified*).
- **View:** Load the **`Pitching Export`** view. *(New saved view — ships in [`docs/ootp_views/`](ootp_views/).)*
- **Filters:** **Scope** = **major-league level** for all three. The **Split** selects which file you're producing:

  | File | Split |
  |---|---|
  | `pitching_data.csv` | All splits **None** (overall pitching) |
  | `sp_data.csv` | **Split → Lineup → As Starter** |
  | `rp_data.csv` | **Split → Lineup → As Reliever / Substitution** |

- **Export action:** **Report → Write Report to CSV**, once per split.
- **Save as:** rename each export from your league's `import_export/` folder to the filename above and move it into `leagues/<slug>/metadata/<year>/`. Re-export and rename between split changes — OOTP overwrites the same `import_export/` file each time.

### batter_ratings_vr.csv / batter_ratings_vl.csv

Both come off the same screen and view; only the **Split** changes. The `Batting Rtng Export` view includes **both** vR and vL rating columns in every export — the Split doesn't change which ratings appear, it changes the **PA column** (plate appearances logged against that side). That side-specific PA count is what the pipeline uses to PA-weight each side's league rating averages, so you still need both files.

- **OOTP screen:** Click your league name in the top bar (e.g. **MLB**) → **Statistics → Sortable Stats**. Set the player pool to **All players** (not just *Qualified*).
- **View:** Load the **`Batting Rtng Export`** view. *(New saved view — ships in [`docs/ootp_views/`](ootp_views/).)*
- **Filters:** **Scope** = **major-league level**. The **Split** selects the file:

  | File | Split |
  |---|---|
  | `batter_ratings_vr.csv` | **Versus Right** |
  | `batter_ratings_vl.csv` | **Versus Left** |

- **Export action:** **Report → Write Report to CSV**, once per split.
- **Save as:** rename each export from `import_export/` to the filename above and move it into `leagues/<slug>/metadata/<year>/`.

### fielding_data_c.csv … fielding_data_rf.csv (one per position)

- **OOTP screen:** Click your league name in the top bar (e.g. **MLB**) → **Statistics → Sortable Stats**. Set the player pool to **All players** (not just *Qualified*).
- **View:** Load the **`Fielding Export`** view. *(New saved view — ships in [`docs/ootp_views/`](ootp_views/).)*
- **Filters:** No filter; **Scope** = **major-league level**. Set the **`POSITION:`** selector to the position you're exporting, then re-export for each.
- **Export action:** **Report → Write Report to CSV**, once per position.
- **Save as:** rename each export to `fielding_data_<pos>.csv` and move it into `leagues/<slug>/metadata/<year>/`. The eight positions the pipeline reads:

  | Position | File |
  |---|---|
  | Catcher | `fielding_data_c.csv` |
  | First base | `fielding_data_1b.csv` |
  | Second base | `fielding_data_2b.csv` |
  | Third base | `fielding_data_3b.csv` |
  | Shortstop | `fielding_data_ss.csv` |
  | Left field | `fielding_data_lf.csv` |
  | Center field | `fielding_data_cf.csv` |
  | Right field | `fielding_data_rf.csv` |

- **Optional — `fielding_data_p.csv` (pitchers):** You can also set `POSITION:` to **Pitcher** and export `fielding_data_p.csv`. The pipeline does **not** read it today (the positions list above stops at RF), so it has no effect on the current build — but pitchers carry stolen-bases-against and catcher-framing-benefit data that may be useful later, so it's worth capturing. Dropping it in the folder is safe: it only nudges the metadata cache hash (forcing a recompute), never an error.

### fielding_ratings.csv

- **OOTP screen:** Click your league name in the top bar (e.g. **MLB**) → **Statistics → Sortable Stats**. Set the player pool to **All players** (not just *Qualified*).
- **View:** Load the **`Fielding Rtng Export`** view. *(New saved view — ships in [`docs/ootp_views/`](ootp_views/).)*
- **Filters:** No filter; **Scope** = **major-league level**.
- **Export action:** **Report → Write Report to CSV**.
- **Save as:** rename to `fielding_ratings.csv` and move it into `leagues/<slug>/metadata/<year>/`.

### pitcher_ratings_vr.csv / pitcher_ratings_vl.csv

Same shape as the batter ratings: one row per pitcher with both vR and vL rating columns; the two files differ only in the `BF` column (RH-faced vs LH-faced). **You do not split by role (SP/RP) on export** — the pipeline classifies each pitcher from their actual starter-vs-reliever innings (in `sp_data.csv` / `rp_data.csv`) and weights their contribution to the SP and RP league averages proportionally. The view includes a `POS` column so the pipeline can apply OOTP's SP↔RP Stuff conversion (±5) where a pitcher's usage differs from their listing.

- **OOTP screen:** Click your league name in the top bar (e.g. **MLB**) → **Statistics → Sortable Stats**. Set the player pool to **All players** (not just *Qualified*).
- **View:** Load the **`Pitching Rtng Export`** view. *(New saved view — ships in [`docs/ootp_views/`](ootp_views/).)*
- **Filters:** **Scope** = **major-league level**, no role filter. The **Split** selects the file:

  | File | Split |
  |---|---|
  | `pitcher_ratings_vr.csv` | **Versus Right** |
  | `pitcher_ratings_vl.csv` | **Versus Left** |

- **Export action:** **Report → Write Report to CSV**, once per split.
- **Save as:** rename each export from `import_export/` to the filename above and move it into `leagues/<slug>/metadata/<year>/`.
- **Migrating from the legacy 4-file format?** Older seasons (and the bundled `default/`) used `sp_ratings_vr/vl` + `rp_ratings_vr/vl`. Those still load — the pipeline auto-detects the format per season folder — so you don't need to re-export old years.

---

## File-naming summary

All filenames are **case-insensitive but strict on stem**. Files not matching one of the patterns above are silently skipped by `_discover_csv_files()` (`model/src/players.py:33`).

## Verifying the export

After saving the CSVs, run `python3 run.py --league <slug>` from the project root. Validation runs first — if `org.csv` is missing, or if `ballparks.csv` lists a different team set than `org.csv`, you'll get a friendly error in under a second. (If you have a legacy `organization.csv`, validation prints a one-line rename reminder.) If all required inputs are present, the pipeline runs and prints the source tag and row count for each CSV it discovered.

Optional files that aren't present produce no error — the corresponding view (Free Agent Finder / IAFA Board / Draft Board) just doesn't appear in the sidebar.
