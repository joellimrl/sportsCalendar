# Sports Calendar

A personal sports calendar showing key events across F1, tennis, football, and
League of Legends. Times are shown in Singapore Time (SGT / UTC+8).

## What it shows

- A monthly calendar with colour-coded sport chips.
- Tournament and split periods as thin bars across their date range.
- Individual finals, semifinals, races, and selected knockout matches.
- Per-sport visibility controls and a Today shortcut.

## Data sources

| Sport | Events | Keyless source |
|---|---|---|
| F1 | Qualifying, Sprint, Race for every round | [Jolpica](https://api.jolpi.ca/) |
| Football | Every published Liverpool men's first-team fixture; World Cup, Euro and Copa América periods plus knockout matches | ESPN public scoreboard data |
| Tennis | Grand Slam periods, semifinals and finals | ESPN public ATP calendar data |
| LoL | LCK/LPL split periods and knockouts; First Stand, MSI, Worlds and EWC periods plus play-in/knockout matches | Leaguepedia public Cargo API, with public iCalendar fallback |

## Automatic refresh architecture

The browser loads the generated `data/events.json` file. A daily GitHub Action
runs `node scripts/fetch-events.js`, which discovers a rolling current/next
season window from public sources without API keys.

Each source has a committed last-known-good snapshot in
`data/source-cache.json`. If an upstream source is unavailable or incomplete,
the calendar preserves its prior source data rather than deleting it. The
Leaguepedia is additionally backed by a public fixture-calendar fallback for
temporary Cargo API rate limits. The workflow commits only when event content
changes.

All recurring data must remain rolling and source-driven. Adding a new sport or
competition is the only reason to change source configuration; annual fixture
or tournament-date edits are not required.

## Run locally

```sh
npx serve .
# or
python3 -m http.server
```

Then open the URL printed by the server.

## Refresh data locally

```sh
node scripts/fetch-events.js
```

This updates `data/events.json` and `data/source-cache.json`.

## GitHub Actions

`.github/workflows/update-events.yml` runs daily at 03:17 UTC, validates and
refreshes the sources, and commits both generated data files when they change.
No secrets or API keys are required.
