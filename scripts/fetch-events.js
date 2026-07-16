#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// ── helpers ────────────────────────────────────────────────────────────────

function toSGT(dateStr, utcTime) {
  if (!utcTime) return null;
  const clean = utcTime.replace(/\.\d+Z$/, 'Z').replace('Z', '');
  const [h, m] = clean.split(':').map(Number);
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

// ── Football via ESPN unofficial API + static UCL dates ────────────────────
// WC 2026: ESPN FIFA.World scoreboard enriches SF/Final with real team names.
// UCL: static key-round dates (no free live API; update annually when confirmed).

async function fetchFootball() {
  const events = [];
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
    { id: '116838530616006090', slug: 'ewc',   name: 'EWC',    regional: false },
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

async function main() {
  const now   = new Date();
  const years = [now.getFullYear(), now.getFullYear() + 1];

  console.log('Fetching sports data...');

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

  all.sort((a, b) => (a.date || a.startDate || '').localeCompare(b.date || b.startDate || ''));

  const out = { lastUpdated: now.toISOString(), events: all };
  const dest = path.join(__dirname, '..', 'data', 'events.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ ${all.length} events written to ${dest}`);
}

main().catch(err => { console.error(err); process.exit(1); });
