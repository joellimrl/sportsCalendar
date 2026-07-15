#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

<<<<<<< Updated upstream
// ── helpers ────────────────────────────────────────────────────────────────

function toSGT(dateStr, utcTime) {
  if (!utcTime) return null;
  const clean = utcTime.replace(/\.\d+Z$/, 'Z').replace('Z', '');
  const [h, m] = clean.split(':').map(Number);
  const totalMin = h * 60 + m + 480; // UTC+8
=======
const DAY_MS = 24 * 60 * 60 * 1000;
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'events.json');
const sourceStatus = {};

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
  return dateOnly(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS);
}

function compactDate(value) {
  return value.replaceAll('-', '');
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function toSGT(dateStr, utcTime) {
  if (!utcTime) return null;
  const [h, m] = utcTime.replace('Z', '').split(':').map(Number);
  const totalMin = h * 60 + m + 480;
>>>>>>> Stashed changes
  const sgtH = Math.floor(totalMin / 60) % 24;
  const sgtM = totalMin % 60;
  const nextDay = totalMin >= 1440;
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(sgtH)}:${pad(sgtM)}`;
  if (!nextDay) return time;
  const [year, month, day] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][next.getUTCDay()];
  return `${time} (${weekday})`;
}

function isoToSGT(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = type => parts.find(part => part.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

<<<<<<< Updated upstream
// ── F1 via Jolpica (Ergast fork) ───────────────────────────────────────────

async function fetchF1(year) {
  const events = [];
=======
async function safeFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
>>>>>>> Stashed changes
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'sportsCalendar/1.0 (keyless personal calendar updater)',
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options) {
  return (await safeFetch(url, options)).json();
}

function loadCachedEvents() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')).events || [];
  } catch {
    return [];
  }
}

function eventOverlapsWindow(event, start, end) {
  const eventStart = event.date || event.startDate;
  const eventEnd = event.date || event.endDate || eventStart;
  return Boolean(eventStart && eventEnd && eventEnd >= start && eventStart <= end);
}

function cachedFor(cachedEvents, predicate, start, end) {
  return cachedEvents.filter(event => predicate(event) && eventOverlapsWindow(event, start, end));
}

async function runSource(name, fetcher, fallback) {
  try {
    const events = await fetcher();
    sourceStatus[name] = { status: 'ok', events: events.length };
    console.log(`  ${name}: ${events.length} events`);
    return events;
  } catch (error) {
    const events = fallback();
    sourceStatus[name] = { status: 'cached', events: events.length, error: error.message };
    console.warn(`  ${name} failed; retained ${events.length} cached events: ${error.message}`);
    return events;
  }
}

// Formula 1: Jolpica's keyless Ergast-compatible API.
async function fetchF1Year(year) {
  const json = await fetchJson(`https://api.jolpi.ca/ergast/f1/${year}/races.json?limit=100`);
  const races = json.MRData?.RaceTable?.Races || [];
  const events = [];

  for (const race of races) {
    const gp = race.raceName.replace(' Grand Prix', ' GP');
    const location = `${race.Circuit.circuitName}, ${race.Circuit.Location.locality}`;
    const base = { sport: 'f1', detail: `Round ${race.round} · ${location}` };

    if (race.Qualifying) {
      events.push({
        id: `f1-${year}-r${race.round}-q`,
        title: `${gp} – Qualifying`,
        date: race.Qualifying.date,
        ...base,
        type: 'qualifying',
        ...(race.Qualifying.time && { time: toSGT(race.Qualifying.date, race.Qualifying.time) }),
      });
    }

    if (race.Sprint) {
      events.push({
        id: `f1-${year}-r${race.round}-s`,
        title: `${gp} – Sprint`,
        date: race.Sprint.date,
        ...base,
        type: 'sprint',
        ...(race.Sprint.time && { time: toSGT(race.Sprint.date, race.Sprint.time) }),
      });
    }

    events.push({
      id: `f1-${year}-r${race.round}-r`,
      title: `${gp} – Race`,
      date: race.date,
      ...base,
      type: 'race',
      ...(race.time && { time: toSGT(race.date, race.time) }),
    });
  }
  return events;
}

<<<<<<< Updated upstream
// ── Football via ESPN unofficial API + static UCL dates ────────────────────
// WC 2026: ESPN FIFA.World scoreboard enriches SF/Final with real team names.
// UCL: static key-round dates (no free live API; update annually when confirmed).
=======
async function fetchF1(start, end) {
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  const results = await Promise.allSettled(
    Array.from({ length: lastYear - firstYear + 1 }, (_, index) => fetchF1Year(firstYear + index)),
  );
  const events = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!events.length && results.some(result => result.status === 'rejected')) {
    throw results.find(result => result.status === 'rejected').reason;
  }
  return events;
}

async function fetchEspnScoreboard(sport, league, start, end) {
  const range = `${compactDate(start)}-${compactDate(end)}`;
  return fetchJson(`${ESPN_BASE}/${sport}/${league}/scoreboard?dates=${range}&limit=1000`);
}

function footballMatch(event, competition, title, type) {
  const sgt = isoToSGT(event.date);
  const venue = event.competitions?.[0]?.venue?.fullName;
  return {
    id: `football-espn-${competition}-${event.id}`,
    title,
    date: sgt.date,
    sport: 'football',
    type,
    detail: `${event.name}${venue ? ` · ${venue}` : ''}`,
    time: sgt.time,
  };
}

// Football: ESPN's public, unauthenticated JSON scoreboards.
async function fetchUcl(start, end) {
  const json = await fetchEspnScoreboard('soccer', 'uefa.champions', addDays(start, -120), end);
  const events = [];
  for (const event of json.events || []) {
    const round = event.season?.slug;
    if (round === 'semifinals') {
      events.push(footballMatch(event, 'ucl', 'UCL Semi-Final', 'semifinal'));
    } else if (round === 'final') {
      events.push(footballMatch(event, 'ucl', 'Champions League Final', 'final'));
    }
  }
  return events;
}

async function fetchWorldCup(start, end) {
  const json = await fetchEspnScoreboard('soccer', 'fifa.world', addDays(start, -120), end);
  const matches = json.events || [];
  if (!matches.length) return [];
>>>>>>> Stashed changes

async function fetchFootball() {
  const events = [];
<<<<<<< Updated upstream
  const now = new Date();
  const year = now.getFullYear();

  // UCL – static key rounds (update this block each season when UEFA confirms dates)
  const UCL = [
    { season: '2024/25', sf: ['2025-04-29','2025-05-06'], finalDate: '2025-05-31', finalVenue: 'Allianz Arena, Munich',  finalUtc: '19:00:00Z' },
    { season: '2025/26', sf: ['2026-04-28','2026-05-05'], finalDate: '2026-05-28', finalVenue: 'PayPal Park, San José',  finalUtc: '19:00:00Z' },
  ];
  for (const u of UCL) {
    const sk = u.season.replace('/', '-');
    for (let i = 0; i < u.sf.length; i++) {
      events.push({
        id: `football-ucl-${sk}-sf${i + 1}`,
        title: 'UCL Semi-Final',
        date: u.sf[i],
        sport: 'football',
        type: 'semifinal',
        detail: `${u.season} UEFA Champions League Semi-Final (leg ${i + 1})`,
      });
    }
    events.push({
      id: `football-ucl-${sk}-final`,
      title: 'Champions League Final',
      date: u.finalDate,
      sport: 'football',
      type: 'final',
      detail: `${u.season} UEFA Champions League Final · ${u.finalVenue}`,
      time: toSGT(u.finalDate, u.finalUtc),
    });
  }

  // WC 2026 – tournament span is official; SF and Final enriched via ESPN
  if (year <= 2026) {
    events.push({
      id: 'football-wc2026',
      title: 'FIFA World Cup 2026',
      startDate: '2026-06-11',
      endDate: '2026-07-19',
      sport: 'football',
      type: 'tournament',
      detail: 'FIFA World Cup 2026 · USA, Canada & Mexico',
    });

    // Official FIFA match-day dates for SF and Final (won't change)
    const WC_KEY = [
      { date: '20260714', label: 'Semi', type: 'semifinal' },
      { date: '20260715', label: 'Semi', type: 'semifinal' },
      { date: '20260719', label: 'Final', type: 'final'    },
    ];

    let liveCount = 0;
    for (const { date, label, type } of WC_KEY) {
      try {
        const data = await safeFetch(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.World/scoreboard?dates=${date}`
        );
        for (const ev of data.events ?? []) {
          const eventDate = ev.date?.split('T')[0];
          const utcTime   = ev.date?.split('T')[1] ?? null;
          events.push({
            id: `football-wc2026-${ev.id ?? date}`,
            title: `World Cup 2026 – ${label}`,
            date: eventDate,
            sport: 'football',
            type,
            detail: `FIFA World Cup 2026 · ${ev.name ?? 'TBD'}`,
            ...(utcTime && { time: toSGT(eventDate, utcTime) }),
          });
          liveCount++;
        }
      } catch (e) {
        console.warn(`  Football WC ${date}: ${e.message}`);
      }
    }

    // Static fallback if ESPN returned nothing for WC key rounds
    if (liveCount === 0) {
      events.push(
        { id: 'football-wc2026-sf1',   title: 'World Cup 2026 – Semi',  date: '2026-07-14', sport: 'football', type: 'semifinal', detail: 'FIFA World Cup Semi-Final' },
        { id: 'football-wc2026-sf2',   title: 'World Cup 2026 – Semi',  date: '2026-07-15', sport: 'football', type: 'semifinal', detail: 'FIFA World Cup Semi-Final' },
        { id: 'football-wc2026-final', title: 'World Cup 2026 – Final', date: '2026-07-19', sport: 'football', type: 'final',     detail: 'FIFA World Cup Final · MetLife Stadium, New Jersey', time: toSGT('2026-07-19', '20:00:00Z') }
      );
    }

    console.log(`  Football WC 2026: ${liveCount} live events from ESPN`);
  }

  console.log(`  Football: ${events.length} events`);
  return events;
}

// ── Tennis ─────────────────────────────────────────────────────────────────
// No reliable free API exists for Grand Slam schedules. Dates are announced
// years in advance and rarely shift, so static data is accurate enough.
// TheSportsDB searched by event name returns unrelated results (other sports
// with "Wimbledon"/"Australian Open" in team or event names).
// Update this table when official dates are confirmed for future years.

function fetchTennis() {
  return getTennisFallback();
}

function getTennisFallback() {
  const slams = [
    { y: 2025, id: 'ao',  name: 'Australian Open',             start: '2025-01-12', end: '2025-01-26', sf: '2025-01-24', final: '2025-01-26', venue: 'Melbourne Park',               finalTime: '18:30' },
    { y: 2025, id: 'fo',  name: 'French Open (Roland Garros)', start: '2025-05-25', end: '2025-06-08', sf: '2025-06-05', final: '2025-06-08', venue: 'Roland Garros, Paris',          finalTime: '21:00' },
    { y: 2025, id: 'wim', name: 'Wimbledon',                   start: '2025-06-30', end: '2025-07-13', sf: '2025-07-11', final: '2025-07-13', venue: 'All England Club, London',      finalTime: '21:00' },
    { y: 2025, id: 'uso', name: 'US Open',                     start: '2025-08-25', end: '2025-09-07', sf: '2025-09-05', final: '2025-09-07', venue: 'USTA Billie Jean King NTC, NY', finalTime: '03:00 (Mon)' },
    { y: 2026, id: 'ao',  name: 'Australian Open',             start: '2026-01-19', end: '2026-02-01', sf: '2026-01-29', final: '2026-02-01', venue: 'Melbourne Park',               finalTime: '18:30' },
    { y: 2026, id: 'fo',  name: 'French Open (Roland Garros)', start: '2026-05-24', end: '2026-06-07', sf: '2026-06-04', final: '2026-06-07', venue: 'Roland Garros, Paris',          finalTime: '21:00' },
    { y: 2026, id: 'wim', name: 'Wimbledon',                   start: '2026-06-29', end: '2026-07-12', sf: '2026-07-10', final: '2026-07-12', venue: 'All England Club, London',      finalTime: '21:00' },
    { y: 2026, id: 'uso', name: 'US Open',                     start: '2026-08-31', end: '2026-09-13', sf: '2026-09-11', final: '2026-09-13', venue: 'USTA Billie Jean King NTC, NY', finalTime: '03:00 (Mon)' },
  ];
  const events = [];
  for (const s of slams) {
    events.push(
      { id: `tennis-${s.y}-${s.id}`,    title: s.name,              startDate: s.start, endDate: s.end, sport: 'tennis', type: 'tournament', detail: `Grand Slam · ${s.venue}` },
      { id: `tennis-${s.y}-${s.id}-sf`, title: `${s.name} – Semis`, date: s.sf,         sport: 'tennis', type: 'semifinal', detail: `Grand Slam Semifinals · ${s.venue}` },
      { id: `tennis-${s.y}-${s.id}-f`,  title: `${s.name} – Final`, date: s.final,      sport: 'tennis', type: 'final',     detail: `Grand Slam Final · ${s.venue}`, time: s.finalTime }
    );
  }
  console.log(`  Tennis: ${events.length} events (static fallback)`);
  return events;
}

// ── LoL via Riot unofficial esports API ────────────────────────────────────
// The x-api-key is Riot's public client key used by lolesports.com — it is
// intentionally public and requires no personal account or signup.
// Covers LCK, LPL, LEC (regional: playoffs/semis/finals only) and
// MSI + Worlds (international: all matches + tournament span).

async function fetchLol() {
  const LOL_API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
  const headers = { 'x-api-key': LOL_API_KEY };

  const LEAGUES = [
    { id: '98767991310872058', slug: 'lck',    name: 'LCK',    regional: true  },
    { id: '98767991314006698', slug: 'lpl',    name: 'LPL',    regional: true  },
    { id: '98767991302996019', slug: 'lec',    name: 'LEC',    regional: true  },
    { id: '98767991325878492', slug: 'msi',    name: 'MSI',    regional: false },
    { id: '98767975604431411', slug: 'worlds', name: 'Worlds', regional: false },
  ];

  // For regional leagues, only surface playoffs/knockouts — not every weekly match.
  // Riot uses inconsistent block names: "Knockouts", "Playoffs", "Finals", etc.
  const REGIONAL_KEY = ['semi', 'final', 'quarter', 'playoff', 'knockout'];

  const now = new Date();
  // Keep events from Jan 1 of current year through end of next year
  const dateMin = `${now.getFullYear()}-01-01`;
  const dateMax = `${now.getFullYear() + 2}-01-01`;

  async function fetchLeaguePages(leagueId) {
    const all = [];
    let url = `https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=${leagueId}`;
    let pages = 0;
    while (url && pages < 8) {
      const data = await safeFetch(url, { headers });
      const schedule = data?.data?.schedule;
      if (!schedule) break;
      all.push(...(schedule.events ?? []));
      const newer = schedule.pages?.newer;
      url = newer
        ? `https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=${leagueId}&pageToken=${newer}`
        : null;
      pages++;
    }
    return all;
  }

  const events = [];

  for (const league of LEAGUES) {
    try {
      const scheduleEvents = await fetchLeaguePages(league.id);

      // Restrict to current year + next year only
      const inWindow = scheduleEvents.filter(e => {
        const d = e.startTime?.split('T')[0] ?? '';
        return d >= dateMin && d < dateMax;
      });

      const matches = inWindow.filter(e => e.type === 'match');

      const filtered = league.regional
        ? matches.filter(e => REGIONAL_KEY.some(k => (e.blockName ?? '').toLowerCase().includes(k)))
        : matches;

      if (filtered.length === 0) {
        console.log(`  LoL ${league.name}: no events in current window`);
        continue;
      }

      // Add a tournament span for international events (MSI, Worlds)
      if (!league.regional) {
        const dates = filtered.map(e => e.startTime?.split('T')[0]).filter(Boolean).sort();
        if (dates.length >= 2) {
          events.push({
            id: `lol-${league.slug}-span`,
            title: league.name,
            startDate: dates[0],
            endDate: dates[dates.length - 1],
            sport: 'lol',
            type: 'tournament',
            detail: `${league.name} – International event`,
          });
        }
      }

      for (const ev of filtered) {
        const date = ev.startTime?.split('T')[0];
        if (!date) continue;
        const utcTime  = ev.startTime.split('T')[1] ?? null;
        const blockName = ev.blockName ?? '';
        const bl = blockName.toLowerCase();
        const type = bl.includes('final') && !bl.includes('semi') && !bl.includes('quarter') ? 'final'
                   : bl.includes('semi')    ? 'semifinal'
                   : bl.includes('quarter') ? 'semifinal'
                   : 'match';
        const teams = (ev.match?.teams ?? []).map(t => t.name).filter(Boolean).join(' vs ');

        events.push({
          id: `lol-${league.slug}-${ev.match?.id ?? date}`,
          title: `${league.name} – ${blockName}`,
          date,
          sport: 'lol',
          type,
          detail: teams || `${league.name} ${blockName}`,
          ...(utcTime && { time: toSGT(date, utcTime) }),
        });
      }

      console.log(`  LoL ${league.name}: ${filtered.length} events`);
    } catch (e) {
      console.warn(`  LoL ${league.name} failed: ${e.message}`);
    }
  }

  return events;
}

// ── main ──────────────────────────────────────────────────────────────────

=======
  const byYear = groupBy(matches, event => event.season?.year || Number(event.date.slice(0, 4)));
  for (const [year, yearMatches] of byYear) {
    const dates = yearMatches.map(event => dateOnly(event.date)).sort();
    events.push({
      id: `football-wc-${year}`,
      title: `FIFA World Cup ${year}`,
      startDate: dates[0],
      endDate: dates.at(-1),
      sport: 'football',
      type: 'tournament',
      detail: `FIFA World Cup ${year}`,
    });

    for (const event of yearMatches) {
      if (event.season?.slug === 'semifinals') {
        events.push(footballMatch(event, `wc-${year}`, `World Cup ${year} – Semi-Final`, 'semifinal'));
      } else if (event.season?.slug === 'final') {
        events.push(footballMatch(event, `wc-${year}`, `World Cup ${year} – Final`, 'final'));
      }
    }
  }
  return events;
}

function tennisRoundEvent(tournament, grouping, roundName, type) {
  const matches = (grouping.competitions || []).filter(
    competition => competition.round?.displayName?.toLowerCase() === roundName.toLowerCase(),
  );
  if (!matches.length) return null;
  const first = matches.sort((a, b) => a.date.localeCompare(b.date))[0];
  const event = {
    id: `tennis-espn-${tournament.id}-${type}`,
    title: `${tournament.name} – ${type === 'semifinal' ? 'Semis' : 'Final'}`,
    date: dateOnly(first.date),
    sport: 'tennis',
    type,
    detail: `Men's Singles ${type === 'semifinal' ? 'Semifinals' : 'Final'}${first.venue?.fullName ? ` · ${first.venue.fullName}` : ''}`,
  };
  if (first.timeValid !== false) event.time = isoToSGT(first.date).time;
  return event;
}

// Tennis: the ATP scoreboard contains both draws and full Grand Slam windows.
async function fetchTennis(start, end) {
  const json = await fetchEspnScoreboard('tennis', 'atp', start, end);
  const events = [];
  for (const tournament of json.events || []) {
    if (!tournament.major) continue;
    const year = tournament.season?.year || Number(tournament.date.slice(0, 4));
    const venue = tournament.groupings?.flatMap(group => group.competitions || [])
      .find(competition => competition.venue?.fullName)?.venue?.fullName;
    events.push({
      id: `tennis-espn-${tournament.id}`,
      title: tournament.name,
      startDate: dateOnly(tournament.date),
      endDate: dateOnly(tournament.endDate || tournament.date),
      sport: 'tennis',
      type: 'tournament',
      detail: `Grand Slam ${year}${venue ? ` · ${venue}` : ''}`,
    });

    const mensSingles = (tournament.groupings || []).find(group => group.grouping?.slug === 'mens-singles');
    if (!mensSingles) continue;
    const semifinal = tennisRoundEvent(tournament, mensSingles, 'Semifinal', 'semifinal');
    const final = tennisRoundEvent(tournament, mensSingles, 'Final', 'final');
    if (semifinal) events.push(semifinal);
    if (final) events.push(final);
  }
  return events;
}

function extractJsonObjects(text, marker) {
  const objects = [];
  let position = 0;
  while ((position = text.indexOf(marker, position)) !== -1) {
    const start = text.lastIndexOf('{', position);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}' && --depth === 0) {
        end = index + 1;
        break;
      }
    }
    if (end < 0) break;
    try {
      objects.push(JSON.parse(text.slice(start, end)));
    } catch {
      // Ignore unrelated JavaScript objects that happen to contain the marker.
    }
    position = end;
  }
  return objects;
}

function mergeCachedSpan(cachedEvents, id, startDate, endDate) {
  const cached = cachedEvents.find(event => event.id === id && event.startDate && event.endDate);
  return {
    startDate: cached ? [cached.startDate, startDate].sort()[0] : startDate,
    endDate: cached ? [cached.endDate, endDate].sort().at(-1) : endDate,
  };
}

function lolMatchEvent(event) {
  const teams = (event.matchTeams || []).map(team => team.code || team.name).filter(Boolean);
  const sgt = isoToSGT(event.startTime);
  const league = event.league.name;
  const bestOf = event.match?.strategy?.count ? ` · Bo${event.match.strategy.count}` : '';
  return {
    id: `lol-official-${event.id}`,
    title: `${league} · ${teams.join(' vs ') || event.blockName}`,
    date: sgt.date,
    sport: 'lol',
    type: /final/i.test(event.blockName || '') ? 'final' : 'playoff',
    detail: `${event.tournament?.name || league} · ${event.blockName || 'Knockout'}${bestOf}`,
    time: sgt.time,
  };
}

// LoL: parse the schedule already embedded in Riot's server-rendered page.
async function fetchLol(cachedEvents) {
  const url = 'https://lolesports.com/en-US/leagues/lck%2Clpl%2Cmsi%2Cworlds';
  const html = await (await safeFetch(url, { timeoutMs: 45000 })).text();
  const extracted = extractJsonObjects(html, '"__typename":"EventMatch"');
  const matches = [...new Map(extracted.map(event => [event.id, event])).values()]
    .filter(event => event.startTime && event.league?.name);
  if (!matches.length) throw new Error('Riot schedule page contained no match data');

  const events = [];
  const regional = matches.filter(event => ['LCK', 'LPL'].includes(event.league.name));
  const knockoutPattern = /knockout|playoff|final|play[ -]?in|road to msi|knights/i;

  for (const event of regional) {
    const phase = `${event.blockName || ''} ${event.tournament?.name || ''}`;
    if (knockoutPattern.test(phase)) events.push(lolMatchEvent(event));
  }

  const seasonGroups = groupBy(regional, event => `${event.league.name}-${event.startTime.slice(0, 4)}`);
  for (const [key, seasonMatches] of seasonGroups) {
    const [league, year] = key.split('-');
    const dates = seasonMatches.map(event => dateOnly(event.startTime)).sort();
    const id = `lol-${year}-${league.toLowerCase()}-season`;
    const span = mergeCachedSpan(cachedEvents, id, dates[0], dates.at(-1));
    events.push({
      id,
      title: `${league} ${year} Season`,
      ...span,
      sport: 'lol',
      type: 'season',
      detail: `${league} ${year} published season window; individual entries are knockouts only`,
    });
  }

  const international = matches.filter(event => ['MSI', 'Worlds'].includes(event.league.name));
  const tournamentGroups = groupBy(
    international,
    event => `${event.league.name}-${event.startTime.slice(0, 4)}-${event.tournament?.id || event.tournament?.name}`,
  );
  for (const tournamentMatches of tournamentGroups.values()) {
    const first = tournamentMatches[0];
    const league = first.league.name;
    const year = first.startTime.slice(0, 4);
    const dates = tournamentMatches.map(event => dateOnly(event.startTime)).sort();
    const id = `lol-${year}-${league.toLowerCase()}`;
    events.push({
      id,
      title: league === 'MSI' ? 'Mid-Season Invitational' : `Worlds ${year}`,
      startDate: dates[0],
      endDate: dates.at(-1),
      sport: 'lol',
      type: 'tournament',
      detail: `${league} ${year} · International event`,
    });
    for (const event of tournamentMatches.filter(item => /grand final|^finals?$|championship/i.test(item.blockName || ''))) {
      events.push(lolMatchEvent(event));
    }
  }

  return events;
}

// EWC: derive the overall window from tournament dates embedded by the official site.
async function fetchEwc() {
  const html = await (await safeFetch('https://esportsworldcup.com/en', { timeoutMs: 60000 })).text();
  const decoded = html.replaceAll('\\"', '"');
  const tournamentObjects = extractJsonObjects(decoded, '"tournamentStart":"')
    .filter(item => item.year && item.tournamentStart && item.tournamentEnd && item.pageSlug);
  if (!tournamentObjects.length) throw new Error('EWC page contained no tournament windows');

  const events = [];
  const byYear = groupBy(tournamentObjects, item => item.year);
  for (const [year, tournaments] of byYear) {
    const starts = tournaments.map(item => item.tournamentStart).sort();
    const ends = tournaments.map(item => item.tournamentEnd).sort();
    events.push({
      id: `lol-${year}-ewc`,
      title: 'Esports World Cup',
      startDate: addDays(starts[0], -1),
      endDate: ends.at(-1),
      sport: 'lol',
      type: 'tournament',
      detail: `Esports World Cup ${year} · Riyadh`,
    });
  }
  return events;
}

>>>>>>> Stashed changes
async function main() {
  const now = new Date();
  const windowStart = dateOnly(now.getTime() - 30 * DAY_MS);
  const windowEnd = dateOnly(now.getTime() + 365 * DAY_MS);
  const cachedEvents = loadCachedEvents();

  console.log(`Refreshing sports data (${windowStart} through ${windowEnd})...`);

<<<<<<< Updated upstream
  const [f1Cur, f1Next, football, lol] = await Promise.allSettled([
    fetchF1(years[0]),
    fetchF1(years[1]),
    fetchFootball(),
    fetchLol(),
  ]);

  const all = [
    ...(f1Cur.status    === 'fulfilled' ? f1Cur.value    : []),
    ...(f1Next.status   === 'fulfilled' ? f1Next.value   : []),
    ...(football.status === 'fulfilled' ? football.value : []),
    ...fetchTennis(),
    ...(lol.status      === 'fulfilled' ? lol.value      : []),
  ];
=======
  const [f1, ucl, worldCup, tennis, lol, ewc] = await Promise.all([
    runSource(
      'Jolpica F1',
      () => fetchF1(windowStart, windowEnd),
      () => cachedFor(cachedEvents, event => event.sport === 'f1', windowStart, windowEnd),
    ),
    runSource(
      'ESPN Champions League',
      () => fetchUcl(windowStart, windowEnd),
      () => cachedFor(cachedEvents, event => event.id.includes('ucl'), windowStart, windowEnd),
    ),
    runSource(
      'ESPN World Cup',
      () => fetchWorldCup(windowStart, windowEnd),
      () => cachedFor(cachedEvents, event => event.id.includes('wc'), windowStart, windowEnd),
    ),
    runSource(
      'ESPN Tennis',
      () => fetchTennis(windowStart, windowEnd),
      () => cachedFor(cachedEvents, event => event.sport === 'tennis', windowStart, windowEnd),
    ),
    runSource(
      'LoL Esports',
      () => fetchLol(cachedEvents),
      () => cachedFor(cachedEvents, event => event.sport === 'lol' && !event.id.endsWith('-ewc'), windowStart, windowEnd),
    ),
    runSource(
      'Esports World Cup',
      fetchEwc,
      () => cachedFor(cachedEvents, event => event.id.endsWith('-ewc'), windowStart, windowEnd),
    ),
  ]);
>>>>>>> Stashed changes

  const all = [...f1, ...ucl, ...worldCup, ...tennis, ...lol, ...ewc]
    .filter(event => eventOverlapsWindow(event, windowStart, windowEnd));
  const deduplicated = [...new Map(all.map(event => [event.id, event])).values()];
  deduplicated.sort((a, b) => (a.date || a.startDate).localeCompare(b.date || b.startDate));

  const output = {
    lastUpdated: now.toISOString(),
    window: { startDate: windowStart, endDate: windowEnd },
    sources: sourceStatus,
    events: deduplicated,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`✓ ${deduplicated.length} events written to ${OUTPUT_PATH}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
