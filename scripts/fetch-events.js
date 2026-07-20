#!/usr/bin/env node
'use strict';

/*
 * Keyless, rolling sports-calendar generator.
 *
 * Sources are queried for dates around the current year; no season, fixture,
 * or tournament-date arrays belong in this file. Each source has a
 * last-known-good cache so a temporary upstream failure cannot empty the site.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const EVENTS_PATH = path.join(DATA_DIR, 'events.json');
const CACHE_PATH = path.join(DATA_DIR, 'source-cache.json');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function dateOf(value) {
  return value ? value.slice(0, 10) : null;
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function toSGT(dateStr, utcTime) {
  if (!utcTime) return null;
  const iso = `${dateStr}T${utcTime.replace(/^T/, '')}`;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('hour')}:${get('minute')}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'sportsCalendar/1.0 (keyless personal calendar)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function uniqueById(events) {
  return [...new Map(events.filter(e => e?.id).map(e => [e.id, e])).values()];
}

function rollingYears(now, previous = 0, future = 1) {
  const year = now.getUTCFullYear();
  return Array.from({ length: previous + future + 1 }, (_, i) => year - previous + i);
}

function eventTime(iso) {
  const date = dateOf(iso);
  const time = iso?.split('T')[1];
  return time ? toSGT(date, time) : null;
}

async function fetchF1(now) {
  const events = [];
  for (const year of rollingYears(now)) {
    const json = await fetchJson(`https://api.jolpi.ca/ergast/f1/${year}/races.json?limit=100`);
    for (const race of json.MRData?.RaceTable?.Races ?? []) {
      const title = race.raceName.replace(' Grand Prix', ' GP');
      const base = { sport: 'f1', detail: `Round ${race.round} · ${race.Circuit.circuitName}, ${race.Circuit.Location.locality}` };
      if (race.Qualifying) events.push({
        id: `f1-${year}-r${race.round}-q`, title: `${title} – Qualifying`, date: race.Qualifying.date,
        type: 'qualifying', ...base, ...(race.Qualifying.time && { time: toSGT(race.Qualifying.date, race.Qualifying.time) }),
      });
      if (race.Sprint) events.push({
        id: `f1-${year}-r${race.round}-s`, title: `${title} – Sprint`, date: race.Sprint.date,
        type: 'sprint', ...base, ...(race.Sprint.time && { time: toSGT(race.Sprint.date, race.Sprint.time) }),
      });
      events.push({
        id: `f1-${year}-r${race.round}-r`, title: `${title} – Race`, date: race.date,
        type: 'race', ...base, ...(race.time && { time: toSGT(race.date, race.time) }),
      });
    }
  }
  if (!events.length) throw new Error('Jolpica returned no F1 events');
  return uniqueById(events);
}

async function espnEvents(sport, league, years) {
  const pages = await Promise.all(years.map(year => fetchJson(
    `${ESPN}/${sport}/${league}/scoreboard?dates=${year}&limit=1000`
  )));
  return uniqueById(pages.flatMap(page => page.events ?? []));
}

function footballEvent(event, id, title, type, detail) {
  const date = dateOf(event.date);
  if (!date) return null;
  return {
    id, title, date, sport: 'football', type, detail,
    ...(event.date && { time: eventTime(event.date) }),
  };
}

async function fetchFootball(now) {
  const events = [];
  const years = rollingYears(now, 1, 1);
  const premierLeague = await espnEvents('soccer', 'eng.1', years);
  const bySeason = new Map();

  for (const match of premierLeague) {
    const season = match.season?.year;
    const date = dateOf(match.date);
    if (!season || !date) continue;
    const matches = bySeason.get(season) ?? [];
    matches.push(match);
    bySeason.set(season, matches);
  }

  for (const [season, matches] of bySeason) {
    // A calendar-year query contains the tail of an older season. Keep the
    // current and next Premier League seasons, not a partial historical one.
    if (season < now.getUTCFullYear() - 1) continue;
    const dates = matches.map(m => dateOf(m.date)).sort();
    const label = matches[0].season?.slug || `${season}-${season + 1}`;
    events.push({
      id: `football-pl-${label}`,
      title: 'Premier League', startDate: dates[0], endDate: dates.at(-1),
      sport: 'football', type: 'tournament', detail: matches[0].season?.type?.name || `${season}/${season + 1} Premier League season`,
    });

    for (const match of matches) {
      const competitors = match.competitions?.[0]?.competitors ?? [];
      const liverpool = competitors.find(c => c.team?.slug === 'liverpool' || c.team?.displayName === 'Liverpool');
      if (!liverpool) continue;
      const home = liverpool.homeAway === 'home';
      const opponent = competitors.find(c => c !== liverpool)?.team?.displayName || 'TBD';
      events.push(footballEvent(
        match, `football-liverpool-pl-${match.id}`,
        home ? `Liverpool vs ${opponent}` : `${opponent} vs Liverpool`, 'match',
        `${matches[0].season?.type?.name || 'Premier League'} · ${home ? 'Home (Anfield)' : 'Away'}`,
      ));
    }
  }

  const championsLeague = await espnEvents('soccer', 'uefa.champions', years);
  for (const match of championsLeague) {
    const stage = match.season?.slug || '';
    if (!['semifinals', 'final'].includes(stage)) continue;
    const type = stage === 'final' ? 'final' : 'semifinal';
    events.push(footballEvent(
      match, `football-ucl-${match.id}`, type === 'final' ? 'Champions League Final' : 'UCL Semi-Final', type,
      `${match.season?.year ?? ''}/${(match.season?.year ?? 0) + 1} UEFA Champions League · ${match.name || 'TBD'}`,
    ));
  }

  // World Cup data is only present in ESPN's keyless feed during a World Cup year.
  const worldCup = await espnEvents('soccer', 'fifa.world', years);
  if (worldCup.length) {
    const dates = worldCup.map(m => dateOf(m.date)).filter(Boolean).sort();
    const season = worldCup[0].season?.year || now.getUTCFullYear();
    events.push({ id: `football-world-cup-${season}`, title: `FIFA World Cup ${season}`, startDate: dates[0], endDate: dates.at(-1), sport: 'football', type: 'tournament', detail: 'FIFA World Cup' });
    for (const match of worldCup) {
      const stage = match.season?.slug || '';
      if (!['semifinals', 'final'].includes(stage)) continue;
      const type = stage === 'final' ? 'final' : 'semifinal';
      events.push(footballEvent(match, `football-world-cup-${match.id}`, `World Cup – ${type === 'final' ? 'Final' : 'Semi-Final'}`, type, match.name || 'FIFA World Cup'));
    }
  }

  const clean = uniqueById(events.filter(Boolean));
  if (!clean.some(event => event.id.startsWith('football-pl-'))) throw new Error('ESPN returned no Premier League season');
  return clean;
}

function tournamentMainDates(event) {
  const dates = (event.calendar?.calendar ?? []).map(dateOf).filter(Boolean);
  if (!dates.length) return [dateOf(event.date), dateOf(event.endDate)];
  const chunks = [[dates[0]]];
  for (const date of dates.slice(1)) {
    const previous = chunks.at(-1).at(-1);
    const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`)) / 86400000;
    if (gap > 1) chunks.push([]);
    chunks.at(-1).push(date);
  }
  const mainDraw = chunks.at(-1);
  return [mainDraw[0], mainDraw.at(-1)];
}

async function fetchTennis(now) {
  const events = [];
  for (const year of rollingYears(now)) {
    const tournaments = (await fetchJson(`${ESPN}/tennis/atp/scoreboard?dates=${year}&limit=1000`)).events ?? [];
    for (const tournament of tournaments.filter(event => event.major)) {
      const [startDate, endDate] = tournamentMainDates(tournament);
      if (!startDate || !endDate) continue;
      const key = slug(tournament.name);
      const venue = tournament.venue?.displayName || 'Venue TBA';
      events.push({ id: `tennis-${tournament.id}`, title: tournament.name, startDate, endDate, sport: 'tennis', type: 'tournament', detail: `Grand Slam · ${venue}` });
      const singles = tournament.groupings?.find(group => group.grouping?.slug === 'mens-singles');
      for (const round of ['Semifinal', 'Final']) {
        const matches = singles?.competitions?.filter(match => match.round?.displayName === round) ?? [];
        const date = matches.map(match => dateOf(match.date)).filter(Boolean).sort()[0];
        if (!date) continue;
        events.push({
          id: `tennis-${tournament.id}-${round === 'Final' ? 'final' : 'semis'}`,
          title: `${tournament.name} – ${round === 'Final' ? 'Final' : 'Semis'}`,
          date, sport: 'tennis', type: round === 'Final' ? 'final' : 'semifinal', detail: `Men's Singles · ${venue}`,
        });
      }
    }
  }
  if (!events.length) throw new Error('ESPN returned no Grand Slam events');
  return uniqueById(events);
}

async function fetchLol(now) {
  const start = `${now.getUTCFullYear()}-01-01`;
  const end = `${now.getUTCFullYear() + 2}-01-01`;
  const query = async params => {
    const json = await fetchJson(`https://lol.fandom.com/api.php?${new URLSearchParams({ action: 'cargoquery', format: 'json', limit: '500', ...params })}`);
    if (json.error) throw new Error(`Leaguepedia: ${json.error.info || json.error.code}`);
    return (json.cargoquery ?? []).map(item => item.title).filter(Boolean);
  };
  const leagues = "('LCK','LPL','LEC','MSI','Worlds')";
  const tournaments = await query({
    tables: 'Tournaments=T', order_by: 'T.DateStart ASC',
    fields: 'T.OverviewPage=OverviewPage,T.Name=Name,T.StandardName=StandardName,T.League=League,T.DateStart=DateStart,T.Date=DateEnd,T.Split=Split,T.SplitNumber=SplitNumber,T.IsPlayoffs=IsPlayoffs,T.IsOfficial=IsOfficial',
    where: `T.League IN ${leagues} AND T.DateStart >= '${start}' AND T.DateStart < '${end}'`,
  });
  if (!tournaments.length) throw new Error('Leaguepedia returned no LoL tournaments');

  const regional = new Set(['LCK', 'LPL', 'LEC']);
  const eventName = row => `${row.Name} ${row.StandardName}`.toLowerCase();
  const knockoutTournament = row => row.IsPlayoffs === '1' || /playoff|knockout|play-in|bracket|regional qualifier|finals?/.test(eventName(row));
  const selected = tournaments.filter(row => !regional.has(row.League) || knockoutTournament(row));
  const byPage = new Map(tournaments.map(row => [row.OverviewPage, row]));
  const events = [];

  for (const row of tournaments) {
    if (!regional.has(row.League) || !row.DateStart || !row.DateEnd) continue;
    const split = row.Split || (row.SplitNumber ? `Split ${row.SplitNumber}` : row.Name || row.StandardName);
    events.push({
      id: `lol-${slug(row.League)}-period-${slug(row.OverviewPage)}`,
      title: `${row.League} – ${split}`, startDate: row.DateStart, endDate: row.DateEnd,
      sport: 'lol', type: 'tournament', detail: row.StandardName || row.Name,
    });
  }
  for (const row of tournaments.filter(row => ['MSI', 'Worlds'].includes(row.League) && row.DateStart && row.DateEnd)) {
    events.push({ id: `lol-${slug(row.League)}-${slug(row.OverviewPage)}-span`, title: row.League, startDate: row.DateStart, endDate: row.DateEnd, sport: 'lol', type: 'tournament', detail: row.StandardName || row.Name });
  }

  // Leaguepedia permits 500 keyless results per request and rate-limits calls.
  // Only knockout regional pages and international events need match-level rows.
  const pages = selected.map(row => row.OverviewPage).filter(Boolean);
  if (!pages.length) return uniqueById(events);
  await new Promise(resolve => setTimeout(resolve, 61_000));
  const matches = await query({
    tables: 'MatchSchedule=MS', group_by: 'MS.MatchId', order_by: 'MS.DateTime_UTC ASC',
    fields: 'MS.MatchId=MatchId,MS.OverviewPage=OverviewPage,MS.Team1=Team1,MS.Team2=Team2,MS.DateTime_UTC=DateTime,MS.Round=Round,MS.Phase=Phase,MS.Tab=Tab',
    where: `MS.OverviewPage IN (${pages.map(page => `'${page.replace(/'/g, "''")}'`).join(',')})`,
  });
  for (const row of matches) {
    const tournament = byPage.get(row.OverviewPage);
    const date = dateOf(row.DateTime);
    if (!tournament || !date || !row.MatchId) continue;
    const knockoutText = `${row.Round} ${row.Phase} ${row.Tab}`.toLowerCase();
    const type = /(?:^|\s)final(?:$|\s)/.test(knockoutText) && !/semi|quarter/.test(knockoutText) ? 'final'
      : /semi|quarter/.test(knockoutText) ? 'semifinal' : 'match';
    events.push({
      id: `lol-${slug(tournament.League)}-${slug(row.MatchId)}`, title: `${tournament.League} – ${tournament.StandardName || tournament.Name}`,
      date, sport: 'lol', type, detail: [row.Team1, row.Team2].filter(Boolean).join(' vs ') || row.Round || row.Phase || 'TBD',
      ...(row.DateTime && { time: eventTime(row.DateTime) }),
    });
  }
  return uniqueById(events);
}

function validate(source, events) {
  if (!Array.isArray(events) || !events.length) throw new Error(`${source} returned no events`);
  const ids = new Set();
  for (const event of events) {
    if (!event.id || ids.has(event.id)) throw new Error(`${source} produced duplicate or missing event IDs`);
    if (!event.date && !(event.startDate && event.endDate)) throw new Error(`${source} produced an event without a date`);
    ids.add(event.id);
  }
  if (source === 'football' && !events.some(event => event.id.startsWith('football-liverpool-pl-'))) throw new Error('Football source did not include Liverpool fixtures');
  if (source === 'tennis' && !events.some(event => event.type === 'tournament')) throw new Error('Tennis source did not include Grand Slam periods');
}

function bootstrapCache(previousEvents) {
  const cache = { f1: [], football: [], tennis: [], lol: [] };
  for (const event of previousEvents) {
    if (cache[event.sport]) cache[event.sport].push(event);
  }
  return cache;
}

async function main() {
  const now = new Date();
  const previous = readJson(EVENTS_PATH, { events: [], lastUpdated: null });
  const cache = readJson(CACHE_PATH, bootstrapCache(previous.events ?? []));
  const sources = { f1: fetchF1, football: fetchFootball, tennis: fetchTennis, lol: fetchLol };

  for (const [name, fetchSource] of Object.entries(sources)) {
    try {
      const events = await fetchSource(now);
      validate(name, events);
      cache[name] = events;
      console.log(`  ${name}: ${events.length} refreshed`);
    } catch (error) {
      console.warn(`  ${name}: refresh failed; retaining ${cache[name]?.length ?? 0} cached events (${error.message})`);
    }
  }

  const events = uniqueById(Object.values(cache).flat()).sort((a, b) => (a.date || a.startDate).localeCompare(b.date || b.startDate));
  if (!events.length) throw new Error('No cached or refreshed events available');
  const unchanged = JSON.stringify(events) === JSON.stringify(previous.events ?? []);
  writeJson(CACHE_PATH, cache);
  writeJson(EVENTS_PATH, { lastUpdated: unchanged ? previous.lastUpdated : now.toISOString(), events });
  console.log(`✓ ${events.length} events written${unchanged ? ' (no event changes)' : ''}`);
}

main().catch(error => { console.error(error); process.exit(1); });
