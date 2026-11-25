# Sports Calendar

A personal sports calendar showing key events across F1, tennis, football,
League of Legends, and chess. Times are shown in Singapore Time (SGT / UTC+8).

## What it shows

- A monthly calendar with colour-coded sport chips.
- Tournament and split periods as thin bars across their date range.
- Individual finals, semifinals, races, and selected knockout matches.
- LoL Swiss/group stages have labelled start and end events, with the full
  date range in the tooltip and day details, without individual stage matches.
- Per-sport visibility controls and a Today shortcut.

## Data sources

| Sport | Events | Keyless source |
|---|---|---|
| F1 | Qualifying, Sprint, Race for every round | [Jolpica](https://api.jolpi.ca/) |
| Football | Every published Liverpool men's first-team fixture; World Cup, Euro and Copa América periods plus knockout matches | ESPN public scoreboard data |
| Tennis | Grand Slam periods, semifinals and finals | ESPN public ATP calendar data |
| Chess | World Championship, Candidates, Grand Swiss, World Rapid & Blitz, Tata Steel Masters, and all published Grand Chess Tour stops | FIDE public publication API and official FIDE, Tata Steel and Grand Chess Tour websites |
| LoL | LCK/LPL split periods and knockouts; First Stand, MSI, Worlds and EWC periods plus play-in/knockout matches; Demacia Cup and Demacia Cup Global Invitational periods plus quarterfinals, semifinals and finals | Leaguepedia public tournament pages and [public iCalendars](https://github.com/zlypher/lol-events) |

## Automatic refresh architecture

The browser loads the generated `data/events.json` file. A daily GitHub Action
runs `node scripts/fetch-events.js`, which discovers a rolling current/next
season window from public sources without API keys.

Each source has a committed last-known-good snapshot in
`data/source-cache.json`. If an upstream source is unavailable or incomplete,
the calendar preserves its prior source data rather than deleting it.
LoL discovers current/next-year tournament pages using Leaguepedia's public
MediaWiki page API, avoiding the rate-limited Cargo endpoint. Published infobox
dates provide tournament periods before fixtures are available. Prior-year
Demacia Cup pages are also checked for tournaments crossing New Year.
Independent public iCalendars supply fixtures with times converted to SGT.
Each refresh merges valid LoL updates into its cache so an empty, incomplete,
or failed competition feed cannot erase another competition or prior matches.
Published tournament periods replace overlapping fixture-derived estimates.
Swiss/group-stage boundaries use the first and last published fixtures in SGT;
they reflect the published schedule and may change as fixtures are announced.
Leaguepedia's format identifies Swiss stages when the calendar calls them groups.
Stage updates missing previously known fixtures retain the cached boundaries.
The workflow commits only when event content changes.

Chess discovers current-year through two-years-ahead editions through FIDE's
public WordPress title search, then follows official event-site schedule links.
Championship Salesforce runtime assets and controller identifiers are discovered
from the site, rather than pinned to a deployment. Explicit UTC round timestamps
take precedence over announcement dates; parseable official HTML round schedules
are also supported. Times are shown only with a published timezone. Rest days
are omitted, and championship tiebreaks are marked conditional with time TBA.
Announcements without confirmed dates do not create events. Bidding windows and
qualification announcements are excluded. Individual rounds and competitions
retain their last-known-good data independently when responses are incomplete
or unavailable. Official schedule links appear in the day details. No news feed
or live results are included. Changes to upstream page formats may require a
parser update, but new seasons require no configuration or date edits.

Grand Swiss uses the same rolling FIDE discovery window as Candidates, including
editions two years ahead. Grand Chess Tour stops are discovered from the current
organiser calendar, including newly published stops, rather than a fixed list of
annual tournaments. Tata Steel's current event banner supplies its next confirmed
edition and tournament period; amateur event schedules are not used as Masters
rounds. The current World Rapid & Blitz site supplies separate Rapid and Blitz
playing periods, with one session per published Open playing day. Arrival days,
ceremonies and women's-only fixtures do not become Open playing sessions. Times
without an explicit source timezone are omitted rather than guessed. Each organiser
refresh fails independently, and partial responses preserve cached competitions
and sessions. All discovery years are calculated from the current date; there are
no annually maintained fixture lists, URLs or date constants.

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
