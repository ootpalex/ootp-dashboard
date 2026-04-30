# OOTP Saved Views and Filters

This folder contains two OOTP data files that define the column layout (`player_views`) and saved filters (`player_filters`) used by every CSV export the pipeline reads. Loading these into your OOTP installation gives you a one-click "Player Export" preset that already includes every column the dashboard needs — you don't have to build the column list by hand.

## Files

- **`player_views`** — defines all saved column-layout views, including the `Player Export` view this project relies on.
- **`player_filters`** — defines all saved filter presets.

Both files are binary OOTP data files (no extension, no human-readable structure). They are bundled exactly as the original creator distributed them.

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

Open OOTP, navigate to **League → Reports & Info → List All MLB Players**, and load the **Player Export** preset from the views dropdown. The preset includes every column the pipeline reads, plus several it doesn't — that's intentional, so the same preset can be reused for free agents, IAFA, and draft pool exports.

For the full export workflow (toggling OSA ratings, selecting AAA/AA relative-rating leagues, where the CSV gets written), see [`../OOTP_EXPORT_GUIDE.md`](../OOTP_EXPORT_GUIDE.md).
