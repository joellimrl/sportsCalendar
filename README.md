# Sports Calendar

A personal sports calendar showing key events across F1, Tennis, Football, and League of Legends — all times in Singapore Time (SGT / UTC+8).

## What it looks like

- Monthly calendar grid with colour-coded event chips per sport
- Tournament spans (e.g. Wimbledon, MSI) render as thin coloured bars across the date range
- Individual events (Finals, Semis, Race days) render as full chips with hover tooltips
- Click any sport in the legend to show/hide it
- "Today" button jumps back to the current month

## Sports covered

| Sport | Events | Source |
|---|---|---|
| **F1** | Qualifying, Sprint, Race for every round | [Jolpica API](https://api.jolpi.ca/) (free, no auth) |
| **LoL** | LCK / LPL / LEC playoffs + MSI + Worlds | Riot unofficial esports API (public key, no auth) |
| **Football** | World Cup 2026 SF & Final (live team names) | ESPN unofficial scoreboard API (no auth) |
| **Football** | UCL key rounds | Static dates (update annually) |
| **Tennis** | Grand Slam dates 2025–2026 | Static dates (announced years in advance) |

## Architecture

No build step. The browser loads a static `data/events.json` file.

```
Browser → fetch data/events.json → render calendar

GitHub Actions (daily 03:00 UTC)
  → node scripts/fetch-events.js
  → commits updated data/events.json if changed
```

## Running locally

```sh
# Serve with any static server
npx serve .
# or
python3 -m http.server
```

Then open `http://localhost:3000` (or whatever port the server reports).

## Refreshing event data manually

```sh
node scripts/fetch-events.js
```

Writes an updated `data/events.json`. The script exits non-zero on fatal errors, gracefully warns and skips on per-source failures.

## Updating static data

Two sources require manual updates each year:

**UCL** — edit the `UCL` array in `scripts/fetch-events.js`:
```js
const UCL = [
  { season: '2025/26', sf: ['2026-04-28','2026-05-05'], finalDate: '2026-05-28', ... },
  // add next season here
];
```

**Tennis** — edit the `slams` array in `getTennisFallback()` in the same file. Grand Slam dates are announced 1–2 years ahead on the ATP/WTA calendars.

## GitHub Actions setup

The workflow at `.github/workflows/update-events.yml` runs daily and commits when data changes. No secrets required — all APIs are either public or use Riot's own public key.

To deploy on GitHub Pages: Settings → Pages → Deploy from branch `main`, root `/`.
