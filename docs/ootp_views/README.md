# OOTP Saved Views and Filters

This folder contains two OOTP data files that define the **column layouts** (`player_views`) and **saved filters** (`player_filters`) used by every CSV export the pipeline reads. Loading these into your OOTP installation gives you one-click presets that already include every column the dashboard needs — you don't have to build the column lists by hand. An OOTP "view" is just a saved selection of which columns to display.

## Files

- **`player_views`** — all saved column-layout views: the `Player Export` view (player-list CSVs) plus the six metadata export views used on the **Statistics → Sortable Stats** screen.
- **`player_filters`** — defines all saved filter presets.

Both are OOTP data files (no extension, not human-readable). They originate from the YourKidnies' spreadsheet bundle; the only change here is a view rename (`Batting Rtngs Export` → `Batting Rtng Export`).

### Views in this bundle

| View | Produces | OOTP screen |
|---|---|---|
| `Player Export` | `org` / `intl` / `freeagents` / `iafa` / `draftYYYY` CSVs | List All MLB Players (+ Free Agents / IAFA / Draft Pool) |
| `Batting Export` | `hitting_data.csv` | Statistics → Sortable Stats |
| `Pitching Export` | `pitching_data.csv` / `sp_data.csv` / `rp_data.csv` | Statistics → Sortable Stats |
| `Batting Rtng Export` | `batter_ratings_vr.csv` / `batter_ratings_vl.csv` | Statistics → Sortable Stats |
| `Pitching Rtng Export` | pitcher-rating exports | Statistics → Sortable Stats |
| `Fielding Export` | `fielding_data_<pos>.csv` (per position) | Statistics → Sortable Stats |
| `Fielding Rtng Export` | `fielding_ratings.csv` | Statistics → Sortable Stats |

The player CSVs (`Player Export`) are required for any build; the rest drive the optional per-league metadata refresh — see [`../OOTP_EXPORT_GUIDE.md`](../OOTP_EXPORT_GUIDE.md) "Metadata files".

## Installation

OOTP looks for these files inside its per-version `tables/` folder. Copy both files into:

| Platform | Path |
|---|---|
| **macOS** | `~/Library/Application Support/Out of the Park Developments/OOTP Baseball 26/tables/` |
| **Windows** | `Documents\Out of the Park Developments\OOTP Baseball 26\tables\` |
| **Linux** | `~/.local/share/Out of the Park Developments/OOTP Baseball 26/tables/` |

Adjust `OOTP Baseball 26` to your major version (e.g., `OOTP Baseball 27`) if you're on a newer release.

## ⚠️ Warning — this overwrites existing views and filters

Copying these files **replaces** any saved views and filters you have already created in OOTP. If you have customized views you want to keep, **back up your current `player_views` and `player_filters` first** (just copy them somewhere safe before overwriting).

## After installation

For the **player CSVs**: open OOTP, navigate to **League → Reports & Info → List All MLB Players**, and load the **Player Export** preset from the views dropdown. The preset includes every column the pipeline reads, plus several it doesn't — that's intentional, so the same preset can be reused for free agents, IAFA, and draft pool exports.

For the **metadata CSVs**: navigate to **(League) → Statistics → Sortable Stats** and load the matching export view from the table above (`Batting Export`, `Fielding Rtng Export`, etc.).

For the full export workflow (which view + filter + split each file needs, toggling OSA ratings, selecting AAA/AA relative-rating leagues, where the CSV gets written), see [`../OOTP_EXPORT_GUIDE.md`](../OOTP_EXPORT_GUIDE.md).
