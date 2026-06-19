#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');


// ── helpers ────────────────────────────────────────────────────────────────

function toSGT(dateStr, utcTime) {
  if (!utcTime) return null;
  const [h, m] = utcTime.replace('Z', '').split(':').map(Number);
  const totalMin = h * 60 + m + 480; // UTC+8
  const sgtH = Math.floor(totalMin / 60) % 24;
  const sgtM = totalMin % 60;
  const nextDay = totalMin >= 1440;
  const pad = n => String(n).padStart(2, '0');
  const t = `${pad(sgtH)}:${pad(sgtM)}`;
  if (!nextDay) return t;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const name = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(y, mo - 1, d + 1).getDay()];
  return `${t} (${name})`;
}

async function safeFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// ── F1 via Jolpica (Ergast fork) ───────────────────────────────────────────
// https://api.jolpi.ca/ergast/f1/{year}/races.json

async function fetchF1(year) {
  const events = [];
  try {
    const json = await safeFetch(
      `https://api.jolpi.ca/ergast/f1/${year}/races.json?limit=100`
    );
    const races = json.MRData?.RaceTable?.Races ?? [];

    for (const race of races) {
      const gp   = race.raceName.replace(' Grand Prix', ' GP');
      const loc  = `${race.Circuit.circuitName}, ${race.Circuit.Location.locality}`;
      const base = { sport: 'f1', detail: `Round ${race.round} · ${loc}` };

      if (race.Qualifying) {
        events.push({
          id: `f1-${year}-r${race.round}-q`,
          title: `${gp} – Qualifying`,
          date: race.Qualifying.date,
          ...base, type: 'qualifying',
          ...(race.Qualifying.time && { time: toSGT(race.Qualifying.date, race.Qualifying.time) })
        });
      }

      if (race.Sprint) {
        events.push({
          id: `f1-${year}-r${race.round}-s`,
          title: `${gp} – Sprint`,
          date: race.Sprint.date,
          ...base, type: 'sprint',
          ...(race.Sprint.time && { time: toSGT(race.Sprint.date, race.Sprint.time) })
        });
      }

      events.push({
        id: `f1-${year}-r${race.round}-r`,
        title: `${gp} – Race`,
        date: race.date,
        ...base, type: 'race',
        ...(race.time && { time: toSGT(race.date, race.time) })
      });
    }
    console.log(`  F1 ${year}: ${events.length} events`);
  } catch (e) {
    console.warn(`  F1 ${year} failed: ${e.message}`);
  }
  return events;
}

// ── Football (static — update annually when official dates are confirmed) ─────

function getFootballEvents() {
  // UCL: official draw/final dates announced by UEFA each season.
  // WC 2026: official FIFA schedule (announced 2024-02-04).
  const ucl = [
    {
      season: '2024/25',
      sf1: '2025-04-29', sf2: '2025-05-06',
      finalDate: '2025-05-31', finalVenue: 'Allianz Arena, Munich',     finalUtc: '19:00:00Z',
    },
    {
      season: '2025/26',
      sf1: '2026-04-28', sf2: '2026-05-05',
      finalDate: '2026-05-28', finalVenue: 'PayPal Park, San José',      finalUtc: '19:00:00Z',
    },
  ];

  const events = [];

  for (const u of ucl) {
    const seasonKey = u.season.replace('/', '-');
    events.push({
      id: `football-ucl-${seasonKey}-sf`,
      title: 'UCL Semi-Finals',
      date: u.sf1,
      sport: 'football', type: 'semifinal',
      detail: `${u.season} UEFA Champions League Semi-Finals (legs ${u.sf1} & ${u.sf2})`,
    });
    events.push({
      id: `football-ucl-${seasonKey}-final`,
      title: 'Champions League Final',
      date: u.finalDate,
      sport: 'football', type: 'final',
      detail: `${u.season} UEFA Champions League Final · ${u.finalVenue}`,
      time: toSGT(u.finalDate, u.finalUtc),
    });
  }

  // FIFA World Cup 2026
  events.push({
    id: 'football-wc2026',
    title: 'FIFA World Cup 2026',
    startDate: '2026-06-11',
    endDate:   '2026-07-19',
    sport: 'football', type: 'tournament',
    detail: 'FIFA World Cup 2026 · USA, Canada & Mexico',
  });
  events.push({
    id: 'football-wc2026-sf',
    title: 'World Cup 2026 – Semis',
    date: '2026-07-14',
    sport: 'football', type: 'semifinal',
    detail: 'FIFA World Cup Semi-Finals',
  });
  events.push({
    id: 'football-wc2026-final',
    title: 'World Cup 2026 – Final',
    date: '2026-07-19',
    sport: 'football', type: 'final',
    detail: 'FIFA World Cup Final · MetLife Stadium, New Jersey',
    time: toSGT('2026-07-19', '20:00:00Z'),
  });

  console.log(`  Football: ${events.length} events (static)`);
  return events;
}

// ── Tennis (Grand Slam dates — announced years in advance, very stable) ─────

function getTennisEvents() {
  // Update this table when official dates are announced for future years.
  const slams = [
    // 2025 — confirmed
    { y: 2025, id: 'ao',  name: 'Australian Open',            start: '2025-01-12', end: '2025-01-26', sf: '2025-01-24', final: '2025-01-26', venue: 'Melbourne Park',               finalTime: '18:30' },
    { y: 2025, id: 'fo',  name: 'French Open (Roland Garros)',start: '2025-05-25', end: '2025-06-08', sf: '2025-06-05', final: '2025-06-08', venue: 'Roland Garros, Paris',          finalTime: '21:00' },
    { y: 2025, id: 'wim', name: 'Wimbledon',                  start: '2025-06-30', end: '2025-07-13', sf: '2025-07-11', final: '2025-07-13', venue: 'All England Club, London',      finalTime: '21:00' },
    { y: 2025, id: 'uso', name: 'US Open',                    start: '2025-08-25', end: '2025-09-07', sf: '2025-09-05', final: '2025-09-07', venue: 'USTA Billie Jean King NTC, NY', finalTime: '03:00 (Mon)' },
    // 2026 — estimated (update when officially announced)
    { y: 2026, id: 'ao',  name: 'Australian Open',            start: '2026-01-19', end: '2026-02-01', sf: '2026-01-29', final: '2026-02-01', venue: 'Melbourne Park',               finalTime: '18:30' },
    { y: 2026, id: 'fo',  name: 'French Open (Roland Garros)',start: '2026-05-24', end: '2026-06-07', sf: '2026-06-04', final: '2026-06-07', venue: 'Roland Garros, Paris',          finalTime: '21:00' },
    { y: 2026, id: 'wim', name: 'Wimbledon',                  start: '2026-06-29', end: '2026-07-12', sf: '2026-07-10', final: '2026-07-12', venue: 'All England Club, London',      finalTime: '21:00' },
    { y: 2026, id: 'uso', name: 'US Open',                    start: '2026-08-31', end: '2026-09-13', sf: '2026-09-11', final: '2026-09-13', venue: 'USTA Billie Jean King NTC, NY', finalTime: '03:00 (Mon)' },
  ];

  const events = [];
  for (const s of slams) {
    events.push(
      { id: `tennis-${s.y}-${s.id}`,    title: s.name,                   startDate: s.start, endDate: s.end, sport: 'tennis', type: 'tournament', detail: `Grand Slam · ${s.venue}` },
      { id: `tennis-${s.y}-${s.id}-sf`, title: `${s.name} – Semis`,      date: s.sf,         sport: 'tennis', type: 'semifinal', detail: `Grand Slam Semifinals · ${s.venue}` },
      { id: `tennis-${s.y}-${s.id}-f`,  title: `${s.name} – Final`,      date: s.final,      sport: 'tennis', type: 'final',     detail: `Grand Slam Final · ${s.venue}`, time: s.finalTime }
    );
  }
  console.log(`  Tennis: ${events.length} events (static)`);
  return events;
}

// ── League of Legends (international events — update annually) ─────────────
// Worlds/MSI windows shift ~1-2 weeks year-to-year. Update when Riot announces.

function getLolEvents() {
  const seasons = [
    {
      y: 2025,
      lckSpringF: '2025-04-06', lplSpringF: '2025-04-20',
      msiStart:   '2025-05-01', msiEnd: '2025-05-25', msiF: '2025-05-25',
      lckSummerF: '2025-08-24', lplSummerF: '2025-08-31',
      worldsStart:'2025-10-01', worldsEnd: '2025-11-02', worldsF: '2025-11-02',
    },
    {
      y: 2026,
      lckSpringF: '2026-04-05', lplSpringF: '2026-04-19',
      msiStart:   '2026-05-07', msiEnd: '2026-05-31', msiF: '2026-05-31',
      lckSummerF: '2026-08-23', lplSummerF: '2026-08-30',
      worldsStart:'2026-10-01', worldsEnd: '2026-11-01', worldsF: '2026-11-01',
    },
  ];

  const events = [];
  for (const s of seasons) {
    const y = s.y;
    events.push(
      { id: `lol-${y}-lck-spring-f`, title: 'LCK Spring Finals',       date: s.lckSpringF, sport: 'lol', type: 'final',      detail: `LCK ${y} Spring Split Finals` },
      { id: `lol-${y}-lpl-spring-f`, title: 'LPL Spring Finals',       date: s.lplSpringF, sport: 'lol', type: 'final',      detail: `LPL ${y} Spring Split Finals` },
      { id: `lol-${y}-msi`,          title: 'Mid-Season Invitational',  startDate: s.msiStart, endDate: s.msiEnd, sport: 'lol', type: 'tournament', detail: `MSI ${y} – International event` },
      { id: `lol-${y}-msi-f`,        title: `MSI ${y} – Final`,        date: s.msiF,       sport: 'lol', type: 'final',      detail: `Mid-Season Invitational ${y} Grand Final` },
      { id: `lol-${y}-lck-summer-f`, title: 'LCK Summer Finals',       date: s.lckSummerF, sport: 'lol', type: 'final',      detail: `LCK ${y} Summer Split Finals` },
      { id: `lol-${y}-lpl-summer-f`, title: 'LPL Summer Finals',       date: s.lplSummerF, sport: 'lol', type: 'final',      detail: `LPL ${y} Summer Split Finals` },
      { id: `lol-${y}-worlds`,        title: `Worlds ${y}`,            startDate: s.worldsStart, endDate: s.worldsEnd, sport: 'lol', type: 'tournament', detail: `LoL World Championship ${y}` },
      { id: `lol-${y}-worlds-f`,      title: `Worlds ${y} – Final`,    date: s.worldsF,    sport: 'lol', type: 'final',      detail: `LoL World Championship ${y} Grand Final` }
    );
  }
  console.log(`  LoL: ${events.length} events (static)`);
  return events;
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  const now   = new Date();
  const years = [now.getFullYear(), now.getFullYear() + 1];

  console.log('Fetching sports data...');

  const all = [
    ...(await fetchF1(years[0])),
    ...(await fetchF1(years[1])),
    ...getFootballEvents(),
    ...getTennisEvents(),
    ...getLolEvents(),
  ];

  all.sort((a, b) => (a.date || a.startDate || '').localeCompare(b.date || b.startDate || ''));

  const out = { lastUpdated: now.toISOString(), events: all };
  const dest = path.join(__dirname, '..', 'data', 'events.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ ${all.length} events written to ${dest}`);
}

main().catch(err => { console.error(err); process.exit(1); });
