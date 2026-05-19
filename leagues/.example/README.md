# Example League Template

Copy this folder to `leagues/<your-league-slug>/` (use a short abbreviation, e.g. `BLM`, `SSB`, `TSB`) and fill in the contents:

1. **`league.json`** — Set `slug` to your league's abbreviation, `leagueName` to its display name, `ootpVersion` to the OOTP version you're playing on (e.g. `"26"` or `"27"`), `team` to your franchise's full name (must match a row in `csv/ballparks.csv`), and `statsplusUrl` to your league's StatsPlus API base if you have one.
2. **`csv/players/`** — Drop your OOTP player CSV exports here. Only **`org.csv` is required**; the others are optional and the corresponding views in the dashboard will hide automatically when their CSVs are absent:
   - `org.csv` — every MLB + MiLB player in the league (required)
   - `intl.csv` — IntlComplex players (optional; needed only when the OOTP org export paginates in large leagues)
   - `freeagents.csv` — free-agent pool (enables Free Agent Finder)
   - `iafa.csv` — international free agents (enables IAFA Board)
   - `draftYYYY.csv` — one per draft year (enables Draft Board). Any 4-digit year works (`draft1967.csv`, `draft2156.csv`, etc.).
   See `docs/OOTP_EXPORT_GUIDE.md` for export instructions.
3. **`csv/ballparks.csv`** — One row per team in your league with park-factor values.
4. **`metadata/`** — Optional. Drop league-specific metadata CSVs here to override the OOTP-version defaults; otherwise leave empty.
5. **`output/`** — Auto-populated by the pipeline. Don't edit by hand.

Run the dashboard from the project root: `python3 run.py --league <your-slug>` (or just `python3 run.py` for the menu).
