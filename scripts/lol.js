'use strict';

const { toSGT } = require('./date-time');
const WIKI = 'https://lol.fandom.com/api.php';
const CALENDAR = 'https://zlypher.github.io/lol-events/cal/';
const COMPETITIONS = [
  ['LCK', 'league-of-legends-lck-champions-korea'],
  ['LPL', 'league-of-legends-lpl-china'],
  ['First Stand', 'league-of-legends-first-stand'],
  ['MSI', 'league-of-legends-mid-invitational'],
  ['Worlds', 'league-of-legends-world-championship'],
  ['EWC', 'league-of-legends-esports-world-cup'],
  ['Demacia Cup', 'league-of-legends-demacia-cup'],
  ['Demacia Cup Global Invitational', 'league-of-legends-demacia-cup-global-invitational'],
];
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

function competitionOf(title) {
  if (/^LCK\//.test(title)) return 'LCK';
  if (/^LPL\//.test(title)) return 'LPL';
  if (/Demacia Cup Global Invitational/.test(title)) return 'Demacia Cup Global Invitational';
  if (/Demacia Cup/.test(title)) return 'Demacia Cup';
  if (/Season World Championship/.test(title)) return 'Worlds';
  if (/Mid-Season Invitational/.test(title)) return 'MSI';
  if (/First Stand/.test(title)) return 'First Stand';
  if (/Esports World Cup/.test(title)) return 'EWC';
  return null;
}

function inWindow(event, now) {
  const year = now.getUTCFullYear();
  return (event.endDate || event.date) >= `${year}-01-01` &&
    (event.startDate || event.date) < `${year + 2}-01-01`;
}

// Extract only the dated tournament infobox, never dates from results or news.
function tournamentEvent(page, now) {
  const text = page.revisions?.[0]?.slots?.main?.content;
  if (typeof text !== 'string') throw new Error(`Missing page content: ${page.title}`);
  const start = text.search(/\{\{Infobox Tournament\s*\n/i);
  if (start < 0) return null; // Overview and redirect pages have no tournament.
  const infobox = text.slice(start).split(/\n\}\}/)[0];
  const field = name => infobox.match(new RegExp(`^\\|${name}\\s*=\\s*([^\\n]*)`, 'mi'))?.[1]?.trim();
  const startDate = field('sdate');
  const endDate = field('edate');
  if (!startDate && !endDate) return null; // Future event not yet announced.
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) {
    throw new Error(`Incomplete tournament dates: ${page.title}`);
  }
  const competition = competitionOf(page.title);
  if (!competition) return null;
  const split = page.title.split('/').at(-1);
  const event = {
    id: `lol-${slug(competition)}-${slug(page.title)}-span`,
    title: ['LCK', 'LPL'].includes(competition) ? `${competition} – ${split}` : competition,
    startDate, endDate, sport: 'lol', type: 'tournament',
    detail: field('name') || page.title, competition, dataSource: 'leaguepedia-pages',
  };
  return inWindow(event, now) ? event : null;
}

async function wikiQuery(params, fetchJson) {
  const json = await fetchJson(`${WIKI}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params })}`);
  if (json.error) throw new Error(json.error.info || json.error.code);
  if (!json.query) throw new Error('Leaguepedia returned no query data');
  return json;
}

async function discoverTitles(prefix, fetchJson) {
  const titles = [];
  let continuation = {};
  do {
    const json = await wikiQuery({ list: 'allpages', apprefix: prefix, aplimit: '500', ...continuation }, fetchJson);
    if (!Array.isArray(json.query.allpages)) throw new Error('Invalid Leaguepedia page list');
    titles.push(...json.query.allpages.map(page => page.title));
    continuation = json.continue;
  } while (continuation);
  return titles;
}

async function fetchTournamentPeriods(now, { fetchJson, warn }) {
  const year = now.getUTCFullYear();
  const prefixes = [year, year + 1].flatMap(y => [`LCK/${y}`, `LPL/${y}`, `${y} `]);
  prefixes.push('Demacia Cup', 'Esports World Cup');
  const titles = new Set();
  for (const prefix of prefixes) {
    try {
      for (const title of await discoverTitles(prefix, fetchJson)) {
        const pageYear = Number(title.match(/\b\d{4}\b/)?.[0]);
        if (pageYear < year - 1 || pageYear > year + 1 || !pageYear || !competitionOf(title)) continue;
        // Regional tournament pages have one stage below the season; deeper
        // pages are stats/rosters. International child pages duplicate spans.
        if (/^LCK\/|^LPL\//.test(title) ? title.split('/').length > 3 : title.includes('/')) continue;
        if (/qualifier|showmatch/i.test(title)) continue;
        titles.add(title);
      }
    } catch (error) { warn(`  lol: tournament discovery ${prefix} unavailable (${error.message})`); }
  }
  const events = [];
  const pages = [...titles];
  // Small batches stay below the keyless MediaWiki title and URL limits.
  for (let offset = 0; offset < pages.length; offset += 20) {
    try {
      const json = await wikiQuery({ prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: pages.slice(offset, offset + 20).join('|') }, fetchJson);
      if (!Array.isArray(json.query.pages)) throw new Error('Invalid Leaguepedia revisions');
      for (const page of json.query.pages) {
        try {
          const event = tournamentEvent(page, now);
          if (event) events.push(event);
        } catch (error) { warn(`  lol: ${error.message}; retaining cached tournament`); }
      }
    } catch (error) { warn(`  lol: tournament pages unavailable (${error.message})`); }
  }
  return events;
}

function icalEvents(text) {
  if (!/^BEGIN:VCALENDAR\r?$/m.test(text) || !/^END:VCALENDAR\r?$/m.test(text)) throw new Error('Invalid or truncated iCalendar');
  const blocks = text.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1);
  const ids = new Set();
  return blocks.map(block => {
    if (!block.includes('END:VEVENT')) throw new Error('Truncated calendar fixture');
    const value = name => block.match(new RegExp(`^${name}(?:;[^:]*)?:(.+)$`, 'm'))?.[1]?.trim();
    const rawDate = value('DTSTART');
    const id = value('UID');
    const date = rawDate?.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    if (!id || ids.has(id) || !validDate(date)) throw new Error('Invalid calendar fixture');
    ids.add(id);
    let timing = { date };
    if (rawDate.length > 8) {
      if (!/^\d{8}T\d{6}Z$/.test(rawDate)) throw new Error('Unsupported calendar timezone');
      const time = rawDate.slice(9, 15).replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3Z');
      if (!Number.isFinite(Date.parse(`${date}T${time}`))) throw new Error('Invalid calendar time');
      timing = toSGT(date, time);
    }
    return { id, ...timing, summary: value('SUMMARY')?.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ') || 'TBD' };
  });
}

function calendarEvents(name, fixtures, now) {
  const ordered = fixtures.filter(f => inWindow(f, now)).sort((a, b) => a.date.localeCompare(b.date));
  const periods = [];
  for (const fixture of ordered) {
    const group = periods.at(-1);
    // Separate editions, even when multiple editions fall in the same year.
    if (!group || Date.parse(fixture.date) - Date.parse(group.at(-1).date) > 14 * 86400000) periods.push([fixture]);
    else group.push(fixture);
  }
  const base = { sport: 'lol', competition: name, dataSource: 'public-calendar' };
  const events = periods.map(period => ({
    ...base, id: `lol-${slug(name)}-period-${period[0].date}`,
    title: name, startDate: period[0].date, endDate: period.at(-1).date,
    type: 'tournament', detail: 'Published fixture period',
  }));
  for (const fixture of ordered) {
    if (!includeFixture(name, fixture.summary)) continue;
    const type = /(?:^|\s)final(?:$|\s|:)/i.test(fixture.summary) && !/semi|quarter/i.test(fixture.summary) ? 'final'
      : /semi|quarter/i.test(fixture.summary) ? 'semifinal' : 'match';
    events.push({ ...base, id: `lol-${slug(name)}-${slug(fixture.id)}`, title: `${name} – ${fixture.summary}`,
      date: fixture.date, ...(fixture.time && { time: fixture.time }), type, detail: fixture.summary });
  }
  return events;
}

function includeFixture(name, summary) {
  return name?.startsWith('Demacia Cup')
    ? /quarter[ -]?final|semi[ -]?final|(?:^|\s)final(?:$|\s|:)/i.test(summary)
    : /playoff|knockout|play-in|bracket|quarter|semi|final|elimination/i.test(summary);
}

function cachedCompetition(event) {
  return event.competition || COMPETITIONS.map(([name]) => name).sort((a, b) => b.length - a.length)
    .find(name => event.title === name || event.title.startsWith(`${name} – `));
}

function mergeEvents(previous, fresh, now) {
  const events = [...new Map([...previous, ...fresh].filter(e => inWindow(e, now)).map(e => [e.id, e])).values()];
  const authoritative = events.filter(e => e.dataSource === 'leaguepedia-pages');
  return events.filter(event => {
    if (cachedCompetition(event)?.startsWith('Demacia Cup') && event.type !== 'tournament' &&
      !includeFixture(cachedCompetition(event), event.detail || event.title)) return false;
    if (event.type !== 'tournament' || event.dataSource === 'leaguepedia-pages') return true;
    // Replace fixture-derived estimates with a published full tournament span.
    return !authoritative.some(period => cachedCompetition(event) === period.competition &&
      period.startDate <= event.endDate && period.endDate >= event.startDate);
  });
}

async function fetchLol(now, previous = [], { fetchJson, fetchText, warn = console.warn }) {
  const periods = await fetchTournamentPeriods(now, { fetchJson, warn });
  const fresh = [...periods];
  for (const [name, calendar] of COMPETITIONS) {
    try {
      const fixtures = icalEvents(await fetchText(`${CALENDAR}${calendar}.ical`));
      fresh.push(...calendarEvents(name, fixtures, now));
    } catch (error) { warn(`  lol: ${name} calendar unavailable (${error.message}); retaining cached events`); }
  }
  if (!fresh.length) throw new Error('LoL sources returned no current events');
  return mergeEvents(previous, fresh, now);
}

module.exports = { fetchLol, icalEvents, tournamentEvent, calendarEvents, mergeEvents, discoverTitles };
