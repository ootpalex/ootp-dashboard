# Original Excel Workbook README (Historical)

This project is a Python + React rewrite of an Excel workbook system originally created and shared by **the YourKidnies**. The text below is preserved verbatim as it shipped with the original spreadsheets.

The Excel-specific parts (manual calc, "calc now > refresh all > calc now") no longer apply to the Python pipeline. The calibration philosophy described here, however, still holds: Regressions are calibrated per OOTP version from a baseline league simmed for 10 years × 5 sims = 50 years of data, and Metadata is calibrated per league from a single year of the current league's data. See [`MULTI_LEAGUE.md`](MULTI_LEAGUE.md) for how the modern pipeline implements this split.

---

> These spreadsheets are tuned for a live start in OOTP 26. If you are playing in a different environment you should at least update the metadata sheet and copy the data points to get better results. If you are playing a different version of OOTP other than 26 I would not expect anything to work properly without updating the Regressions sheet. The Regressions sheet uses the baseline league simmed 10 years 5 times to collect 50 years of data. The Metadata sheet can be updated with a single year of data from your current league. None of this stuff will work with PT, but I am sure you people will try anyway.
>
> Make sure to have manual calc turned on in Excel when using these spreadsheets or they will probably just crash.
>
> When updating the Metadata or the Regressions sheet because they rely heavily on the data model you need to click calc now > refresh all > calc now to properly update the data.
>
> If you want my Filters and Views you can past them into Documents > Out of the Park Developments > OOTP Baseball 26 > tables. This will overwrite your existing filters and views. So either make a copy of those or be prepared to lose them.
>
> Sliders are only set individually for players who can steal. I will set them to override and max out the stealing slider. You can adjust fatigue settings for bench players accordingly.
>
> SOBR Discord: <https://discord.gg/CjkXqWqTRn> (Probably the best place to learn about OOTP)

*(The original creator's personal Discord invite was included in the original text but is no longer active and has been omitted from this preserved copy.)*

---

## Notes that carry over to the Python pipeline

- **OOTP 26 calibration is the baseline.** `data_points.py` ships with constants derived from the original Excel calibration. For OOTP 27+, see [`MULTI_LEAGUE.md`](MULTI_LEAGUE.md) — drop new sim CSVs into `data/regressions/ootp<version>/` and re-run `regressions.py`.
- **Per-league metadata refresh** is still recommended after each season for best accuracy. Drop your league's metadata CSVs into `leagues/<slug>/metadata/`; the pipeline auto-detects them. To smooth out single-season noise you can instead keep one **year-named subfolder per season** (`leagues/<slug>/metadata/2026/`, `2025/`, `2024/`); the pipeline pools the most recent three with recency weights (default `3:2:1`, tunable via `seasonWeights` in `league.json`). See [`MULTI_LEAGUE.md`](MULTI_LEAGUE.md#per-league-config-leaguejson) and the [metadata pipeline doc](../model/docs/pipelines/METADATA_PIPELINE.md#multi-season-pooling).
- **Perfect Team is not supported** — the rating mechanics, contract structure, and roster rules are different enough that the existing calibration doesn't apply.
- **Slider advice (gameplay):** the original author maxed the stealing slider on every player who could steal (override mode), and adjusted bench-player fatigue settings accordingly. The Roster Planner page surfaces stealing speed in the position eligibility table; gameplay decisions remain yours.
- **Filters and Views file location:** the bundled OOTP saved-views file ships at [`docs/ootp_views/`](ootp_views/). Installation overwrites your existing OOTP filters and views, so back yours up first.
