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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'sportsCalendar/1.0 (keyless personal calendar)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
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
  return uniqueById(pages.flatMap(page => (page.events ?? []).map(event => ({
    ...event, calendarLeague: page.leagues?.[0]?.name || league,
  }))));
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
  // These are stable competition identifiers, not season data. Querying every
  // competition keeps Liverpool fixtures complete as draws are published.
  const liverpoolCompetitions = ['eng.1', 'eng.fa', 'eng.league_cup', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'uefa.super_cup', 'eng.community_shield', 'fifa.cwc'];
  const competitionResults = await Promise.allSettled(liverpoolCompetitions.map(league => espnEvents('soccer', league, years)));
  const liverpoolMatches = uniqueById(competitionResults.flatMap(result => result.status === 'fulfilled' ? result.value : []));

  for (const match of liverpoolMatches) {
    // The rolling scoreboard range overlaps the tail of the prior season. Keep
    // the current and upcoming seasons, but avoid carrying a partial old one.
    if ((match.season?.year ?? now.getUTCFullYear()) < now.getUTCFullYear() - 1) continue;
    const competitors = match.competitions?.[0]?.competitors ?? [];
    const liverpool = competitors.find(c => c.team?.slug === 'liverpool' || c.team?.displayName === 'Liverpool');
    if (!liverpool) continue;
    const home = liverpool.homeAway === 'home';
    const opponent = competitors.find(c => c !== liverpool)?.team?.displayName || 'TBD';
    events.push(footballEvent(
      match, `football-liverpool-${match.id}`,
      home ? `Liverpool vs ${opponent}` : `${opponent} vs Liverpool`, 'match',
      `${match.calendarLeague} · ${home ? 'Home (Anfield)' : 'Away'}`,
    ));
  }

  const internationalCompetitions = [
    ['fifa.world', 'FIFA World Cup'],
    ['uefa.euro', 'UEFA European Championship'],
    ['conmebol.america', 'Copa América'],
  ];
  for (const [league, title] of internationalCompetitions) {
    let matches;
    try { matches = await espnEvents('soccer', league, years); }
    catch (error) {
      console.warn(`  football: ${title} unavailable (${error.message})`);
      continue;
    }
    const byTournament = new Map();
    for (const match of matches) {
      const key = `${match.season?.year || now.getUTCFullYear()}`;
      const group = byTournament.get(key) ?? [];
      group.push(match);
      byTournament.set(key, group);
    }
    for (const [key, tournamentMatches] of byTournament) {
      const dates = tournamentMatches.map(match => dateOf(match.date)).filter(Boolean).sort();
      if (!dates.length) continue;
      events.push({ id: `football-international-${slug(league)}-${slug(key)}`, title, startDate: dates[0], endDate: dates.at(-1), sport: 'football', type: 'tournament', detail: title });
      for (const match of tournamentMatches) {
        const stage = match.season?.slug || '';
        if (!/round-of|quarter|semi|final|3rd-place/.test(stage)) continue;
        const type = stage === 'final' ? 'final' : /semi|quarter/.test(stage) ? 'semifinal' : 'match';
        events.push(footballEvent(match, `football-international-${match.id}`, `${title} – ${stage.replaceAll('-', ' ')}`, type, match.name || title));
      }
    }
  }

  const clean = uniqueById(events.filter(Boolean));
  if (!clean.some(event => event.id.startsWith('football-liverpool-'))) throw new Error('Football source did not include Liverpool fixtures');
  return clean;
}

function tournamentMainDates(event) {
  const singles = event.groupings?.filter(group => /singles/.test(group.grouping?.slug || '')) ?? [];
  const singlesDates = singles.flatMap(group => group.competitions ?? [])
    .filter(match => !/qualifying/i.test(match.round?.displayName || ''))
    .map(match => dateOf(match.date)).filter(Boolean).sort();
  if (singlesDates.length) return [singlesDates[0], singlesDates.at(-1)];
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
  const tournaments = await query({
    tables: 'Tournaments=T', order_by: 'T.DateStart ASC',
    fields: 'T.OverviewPage=OverviewPage,T.Name=Name,T.StandardName=StandardName,T.League=League,T.DateStart=DateStart,T.Date=DateEnd,T.Split=Split,T.SplitNumber=SplitNumber,T.IsPlayoffs=IsPlayoffs,T.IsOfficial=IsOfficial',
    where: `T.DateStart >= "${start}" AND T.DateStart < "${end}" AND (T.League IN ("LCK","LPL","MSI","Worlds") OR T.Name LIKE "LCK %" OR T.Name LIKE "LPL %" OR T.StandardName LIKE "LCK %" OR T.StandardName LIKE "LPL %" OR T.Name LIKE "%First Stand%" OR T.StandardName LIKE "%First Stand%" OR T.Name LIKE "%Esports World Cup%" OR T.StandardName LIKE "%Esports World Cup%")`,
  });
  if (!tournaments.length) throw new Error('Leaguepedia returned no LoL tournaments');

  const regional = new Set(['LCK', 'LPL']);
  const eventName = row => `${row.Name} ${row.StandardName}`.toLowerCase();
  const internationalName = row => {
    const name = eventName(row);
    if (name.includes('first stand')) return 'First Stand';
    if (name.includes('esports world cup')) return 'EWC';
    if (row.League === 'MSI') return 'MSI';
    if (row.League === 'Worlds') return 'Worlds';
    return null;
  };
  const knockoutTournament = row => row.IsPlayoffs === '1' || /playoff|knockout|play-in|bracket|regional qualifier|finals?/.test(eventName(row));
  const selected = tournaments.filter(row => {
    const international = internationalName(row);
    return regional.has(row.League) ? knockoutTournament(row) : Boolean(international) && !/qualifier/.test(eventName(row));
  });
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
  for (const row of tournaments.filter(row => internationalName(row) && !/qualifier/.test(eventName(row)) && row.DateStart && row.DateEnd)) {
    const name = internationalName(row);
    events.push({ id: `lol-${slug(name)}-${slug(row.OverviewPage)}-span`, title: name, startDate: row.DateStart, endDate: row.DateEnd, sport: 'lol', type: 'tournament', detail: row.StandardName || row.Name });
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
    if (!/playoff|knockout|play-in|bracket|quarter|semi|final|elimination/.test(knockoutText)) continue;
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

// A public iCalendar mirror is a deliberately independent fallback for the
// rare occasions where Leaguepedia's keyless Cargo endpoint rate-limits us.
// It contains the published fixtures themselves, so its date ranges advance
// without source-code changes as the calendar is refreshed.
function icalEvents(text) {
  return text.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1).map(block => {
    const value = name => block.match(new RegExp(`^${name}(?:;[^:]*)?:(.+)$`, 'm'))?.[1]?.trim();
    const rawDate = value('DTSTART');
    return {
      id: value('UID'),
      date: rawDate?.match(/\d{8}/)?.[0]?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      summary: value('SUMMARY')?.replace(/\\,/g, ',').replace(/\\n/g, ' ') || 'TBD',
    };
  }).filter(event => event.id && event.date);
}

async function fetchLolCalendarFallback(now) {
  const calendars = [
    ['LCK', 'league-of-legends-lck-champions-korea'],
    ['LPL', 'league-of-legends-lpl-china'],
    ['First Stand', 'league-of-legends-first-stand'],
    ['MSI', 'league-of-legends-mid-invitational'],
    ['Worlds', 'league-of-legends-world-championship'],
    ['EWC', 'league-of-legends-esports-world-cup'],
  ];
  const firstYear = now.getUTCFullYear();
  const events = [];
  for (const [name, calendar] of calendars) {
    const text = await fetchText(`https://zlypher.github.io/lol-events/cal/${calendar}.ical`);
    const fixtures = icalEvents(text).filter(fixture => Number(fixture.date.slice(0, 4)) >= firstYear && Number(fixture.date.slice(0, 4)) <= firstYear + 1)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!fixtures.length) continue;
    const periods = name === 'LCK' || name === 'LPL'
      ? fixtures.reduce((groups, fixture) => {
        const group = groups.at(-1);
        const previous = group?.at(-1);
        const gap = previous ? (Date.parse(`${fixture.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86400000 : 0;
        if (!group || gap > 14) groups.push([fixture]); else group.push(fixture);
        return groups;
      }, [])
      : [fixtures];
    periods.forEach((period, index) => events.push({
      id: `lol-${slug(name)}-period-${firstYear}-${index + 1}`,
      title: name === 'LCK' || name === 'LPL' ? `${name} – Split ${index + 1}` : name,
      startDate: period[0].date, endDate: period.at(-1).date,
      sport: 'lol', type: 'tournament', detail: 'Published fixture period',
    }));
    for (const fixture of fixtures) {
      if (!/playoff|knockout|play-in|bracket|quarter|semi|final|elimination/i.test(fixture.summary)) continue;
      const type = /(?:^|\s)final(?:$|\s|:)/i.test(fixture.summary) && !/semi|quarter/i.test(fixture.summary) ? 'final'
        : /semi|quarter/i.test(fixture.summary) ? 'semifinal' : 'match';
      events.push({ id: `lol-${slug(name)}-${slug(fixture.id)}`, title: `${name} – ${fixture.summary}`, date: fixture.date, sport: 'lol', type, detail: fixture.summary });
    }
  }
  if (!events.length) throw new Error('LoL fallback calendars returned no fixtures');
  return uniqueById(events);
}

async function fetchLolWithFallback(now) {
  try { return await fetchLol(now); }
  catch (error) {
    console.warn(`  lol: Leaguepedia unavailable (${error.message}); using public calendar fallback`);
    return fetchLolCalendarFallback(now);
  }
}

function validate(source, events) {
  if (!Array.isArray(events) || !events.length) throw new Error(`${source} returned no events`);
  const ids = new Set();
  for (const event of events) {
    if (!event.id || ids.has(event.id)) throw new Error(`${source} produced duplicate or missing event IDs`);
    if (!event.date && !(event.startDate && event.endDate)) throw new Error(`${source} produced an event without a date`);
    ids.add(event.id);
  }
  if (source === 'football' && !events.some(event => event.id.startsWith('football-liverpool-'))) throw new Error('Football source did not include Liverpool fixtures');
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
  const sources = { f1: fetchF1, football: fetchFootball, tennis: fetchTennis, lol: fetchLolWithFallback };

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
