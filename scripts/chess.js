'use strict';

const { toSGT } = require('./date-time');
const { fetchOrganiserChess } = require('./chess-sources');
const API = 'https://www.fide.com/wp-json/wp/v2/posts';
const COMPETITIONS = [
  { competition: 'world-championship', title: 'FIDE World Championship', search: 'World Championship' },
  { competition: 'candidates', title: 'FIDE Candidates', search: 'Candidates' },
  { competition: 'grand-swiss', title: 'FIDE Grand Swiss', search: 'Grand Swiss', officialOrigin: 'https://grandswiss.fide.com' },
];
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const text = html => String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—').replace(/&rsquo;/gi, '’').replace(/\s+/g, ' ').trim();

function dateParts(year, month, day) {
  const value = `${year}-${String(MONTHS.indexOf(month.toLowerCase().slice(0, 3)) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return validDate(value) ? value : null;
}

function matchesCompetition(title, edition) {
  if (!new RegExp(`\\b${edition.year}\\b`).test(title)) return false;
  if (/women[’']?s/i.test(title) && !/\band\b.*women/i.test(title)) return false;
  if (/\b(?:rapid|blitz|freestyle|junior|youth|cadet|senior|amateur|team|under|u\d+)\b/i.test(title)) return false;
  if (edition.competition === 'grand-swiss') return /\bgrand swiss\b/i.test(title);
  return edition.competition === 'candidates' ? /\bcandidates\b/i.test(title) : /\bworld (?:chess )?championship\b/i.test(title);
}

function announcementPeriod(post, edition) {
  const title = text(post.title?.rendered);
  if (!matchesCompetition(title, edition) || /bidd?ing|qualification|qualify|qualifier|circuit|nomination|fan zone|history of/i.test(title)) return null;
  // Only introductory paragraphs about the event itself, never application or qualifier windows.
  const paragraphs = [...String(post.content?.rendered || '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].slice(0, 4).map(m => text(m[1]));
  const leads = paragraphs.length ? paragraphs : [text(post.content?.rendered).slice(0, 1100)];
  const join = '(?:[-–—]|to|and)';
  const patterns = [
    { regex: new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})\\s*${join}\\s*(?:(${MONTH})\\s+)?(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'gi'), monthFirst: true },
    { regex: new RegExp(`\\b(\\d{1,2})\\s+(${MONTH})\\s*${join}\\s*(\\d{1,2})\\s+(${MONTH})(?:\\s+(\\d{4}))?`, 'gi') },
    { regex: new RegExp(`\\b(\\d{1,2})\\s*${join}\\s*(\\d{1,2})\\s+(${MONTH})(?:\\s+(\\d{4}))?`, 'gi'), sameMonth: true },
  ];
  for (const lead of leads) {
    if (/dates? (?:are |to be |will be )?(?:announced|confirmed)|qualif(?:ier|ication)|bidding|registration|accreditation|deadline|ticket sales|(?:begin|start) between/i.test(lead)) continue;
    if (!/\b(?:held|take place|takes place|taking place|scheduled|runs?|from|between)\b/i.test(lead)) continue;
    for (const pattern of patterns) {
      for (const m of lead.matchAll(pattern.regex)) {
        const year = Number(m[pattern.sameMonth ? 4 : 5] || edition.year);
        if (year !== edition.year) continue;
        let startDate, endDate;
        if (pattern.monthFirst) { startDate = dateParts(year, m[1], m[2]); endDate = dateParts(year, m[3] || m[1], m[4]); }
        else if (pattern.sameMonth) { startDate = dateParts(year, m[3], m[1]); endDate = dateParts(year, m[3], m[2]); }
        else { startDate = dateParts(year, m[2], m[1]); endDate = dateParts(year, m[4], m[3]); }
        if (startDate && endDate && endDate >= startDate && (Date.parse(endDate) - Date.parse(startDate)) / 86400000 <= 45) return { startDate, endDate };
      }
    }
  }
  return null;
}

function baseEvent(edition) {
  return { sport: 'chess', competition: edition.competition, edition: edition.year, sourceUrl: edition.sourceUrl };
}
const eventId = (edition, suffix) => `chess-${edition.competition}-${edition.year}-${suffix}`;
function periodEvent(edition, period) {
  return { ...baseEvent(edition), id: eventId(edition, 'period'), title: edition.title, ...period, type: 'tournament', detail: 'Official FIDE tournament dates' };
}

function salesforceEvents(match, rounds, schedule, edition) {
  if (!match || !matchesCompetition(match.Name || '', edition)) throw new Error('Official chess edition mismatch');
  if (!validDate(match.Start_Date__c) || !validDate(match.End_Date__c) || match.End_Date__c < match.Start_Date__c || Number(match.Start_Date__c.slice(0, 4)) !== edition.year) throw new Error('Invalid official tournament dates');
  if (!Array.isArray(rounds) || !Array.isArray(schedule)) throw new Error('Invalid official chess schedule');
  const events = [periodEvent(edition, { startDate: match.Start_Date__c, endDate: match.End_Date__c })];
  const seen = new Set();
  for (const round of rounds) {
    if (round.Tiebreak__c) continue; // One conditional tiebreak day, not speculative individual games.
    const number = Number(round.Round_Number__c);
    if (!Number.isInteger(number) || number < 1 || seen.has(number)) throw new Error('Invalid or duplicate official round');
    seen.add(number);
    const timestamp = round.Scheduled_Start__c;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp || '') || !Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid official round timestamp');
    const timing = toSGT(timestamp);
    const sourceDate = timestamp.slice(0, 10);
    if (sourceDate < match.Start_Date__c || sourceDate > match.End_Date__c) throw new Error('Official round outside tournament dates');
    const players = [round.White__r?.Name, round.Black__r?.Name].filter(Boolean).join(' vs ');
    events.push({ ...baseEvent(edition), id: eventId(edition, `round-${number}`), title: `${edition.title} – Game ${number}`, ...timing, type: 'match',
      detail: [players, 'Official schedule; later games may not be needed'].filter(Boolean).join(' · '),
      ...(/cancelled|canceled|not played/i.test(round.Round_Status__c || '') && { cancelled: true }) });
  }
  for (const row of schedule) {
    if (!/tie.?break/i.test(row.Event_Label__c || '')) continue;
    if (!validDate(row.Day__c) || row.Day__c < match.Start_Date__c || row.Day__c > match.End_Date__c) throw new Error('Invalid tiebreak date');
    events.push({ ...baseEvent(edition), id: eventId(edition, 'tiebreak'), title: `${edition.title} – Tiebreak (if needed)`, date: row.Day__c, type: 'match', detail: 'Conditional; start time TBA' });
  }
  return events;
}

function explicitOffset(label) {
  const m = label.match(/^\s*[-–—(]?\s*(CEST|CET|UTC|GMT)(?:\s*([+-])\s*(\d{1,2})(?::(\d{2}))?)?\b/i);
  if (!m) return null;
  const base = { CEST: 120, CET: 60, UTC: 0, GMT: 0 }[m[1].toUpperCase()];
  const minutes = base + (m[2] === '-' ? -1 : 1) * (Number(m[3] || 0) * 60 + Number(m[4] || 0));
  return Math.abs(minutes) <= 14 * 60 ? minutes : null;
}

function htmlScheduleEvents(html, edition) {
  const content = text(html);
  const rows = new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})\\s+(?:Round|Game)\\s+(\\d{1,2})(?:\\s+(\\d{1,2}:\\d{2})([^<>]*?))?(?=\\b${MONTH}\\s+\\d|$)`, 'gi');
  const events = [];
  for (const row of content.matchAll(rows)) {
    const date = dateParts(edition.year, row[1], row[2]);
    if (!date) throw new Error('Invalid HTML chess schedule date');
    let timing = { date };
    const offset = explicitOffset(row[5] || '');
    if (row[4] && offset !== null) {
      const [hour, minute] = row[4].split(':').map(Number);
      if (hour > 23 || minute > 59) throw new Error('Invalid HTML chess time');
      timing = toSGT(new Date(Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute - offset) * 60_000).toISOString());
    }
    events.push({ ...baseEvent(edition), id: eventId(edition, `round-${Number(row[3])}`), title: `${edition.title} – Round ${Number(row[3])}`, ...timing, type: 'match', detail: timing.time ? 'Official published round schedule' : 'Official published round date · Time TBA' });
  }
  return events;
}

function mergeChessEvents(previous, fresh) {
  const merged = new Map(previous.map(event => [event.id, event]));
  for (const event of fresh) {
    if (event.cancelled) { merged.delete(event.id); continue; }
    const old = merged.get(event.id);
    // An unknown time on a changed date must not inherit the old day's time.
    const next = { ...event };
    if (!next.time && old?.date === event.date && old?.time) next.time = old.time;
    merged.set(event.id, next);
  }
  return [...merged.values()];
}

function eventSites(posts, edition) {
  const urls = new Set();
  for (const post of posts) {
    if (!matchesCompetition(text(post.title?.rendered), edition)) continue;
    for (const m of (post.content?.rendered || '').matchAll(/href=["']([^"']+)["']/gi)) {
      try {
        const url = new URL(m[1]);
        const pattern = edition.competition === 'grand-swiss' ? /^grandswiss\d*\.fide\.com$/ : edition.competition === 'candidates' ? /^candidates\d*\.fide\.com$/ : /^worldchampionship\d*\.fide\.com$/;
        if (url.protocol === 'https:' && pattern.test(url.hostname)) urls.add(url.origin);
      } catch { /* Ignore non-URLs. */ }
    }
  }
  return [...urls];
}

async function officialSchedule(origin, edition, { fetchText, fetchJson }) {
  const home = await fetchText(origin);
  // Discover the current hashed public bundle rather than pinning a deployment ID.
  const view = home.match(/\/webruntime\/view\/[^\s"'<>]+\/schedule_view/);
  const sourceUrl = `${origin}/schedule`;
  const context = { ...edition, sourceUrl };
  if (view) {
    const bundle = await fetchText(new URL(view[0], origin).href);
    const controller = bundle.match(/getApexInvoker\(["'][^"']*["'],["'](@udd\/[^"']+)["'],["']getSchedule["']/)?.[1];
    if (!controller) throw new Error('Official schedule controller not found');
    const invoke = async method => {
      const url = new URL('/webruntime/api/apex/execute', origin);
      url.search = new URLSearchParams({ cacheable: 'true', classname: controller, isContinuation: 'false', method, namespace: '', language: 'en-US', asGuest: 'true', htmlEncode: 'false' });
      const json = await fetchJson(url.href);
      if (!json || !Object.hasOwn(json, 'returnValue')) throw new Error('Missing official schedule response');
      return json.returnValue;
    };
    const [match, rounds, schedule] = await Promise.all(['getMatch', 'getRounds', 'getSchedule'].map(invoke));
    return salesforceEvents(match, rounds, schedule, context);
  }
  const href = [...home.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .find(m => /^(?:tournament |match )?schedule$/i.test(text(m[2])))?.[1];
  const scheduleUrl = href ? new URL(href, origin) : null;
  const family = hostname => hostname.replace(/\d+(?=\.fide\.com$)/, '');
  if (!scheduleUrl || scheduleUrl.protocol !== 'https:' || family(scheduleUrl.hostname) !== family(new URL(origin).hostname)) throw new Error('Official schedule link not found');
  const html = await fetchText(scheduleUrl.href);
  // A footer copyright is not an event identity. Require a dated event heading
  // or edition-specific official host, and reject conflicting event headings.
  const headings = [...html.matchAll(/<(?:title|h[1-3])\b[^>]*>([\s\S]*?)<\/(?:title|h[1-3])>/gi)].map(m => text(m[1])).join(' ');
  const identityYears = [...headings.matchAll(/(?:candidates(?: tournament)?|grand swiss|world (?:chess )?championship(?: match)?)\s+(\d{4})|(\d{4})\s+(?:fide\s+)?(?:candidates|grand swiss|world (?:chess )?championship)/gi)].map(m => Number(m[1] || m[2]));
  const hostYear = Number(scheduleUrl.hostname.match(/(\d{4})\.fide\.com$/)?.[1]);
  if (identityYears.some(y => y !== edition.year) || (hostYear && hostYear !== edition.year) || (!identityYears.includes(edition.year) && hostYear !== edition.year)) throw new Error('Official schedule edition not confirmed');
  const events = htmlScheduleEvents(html, { ...context, sourceUrl: scheduleUrl.href });
  if (!events.length) throw new Error('No parseable official chess rounds');
  return events;
}

async function discoverPosts(edition, fetchJson) {
  const posts = [];
  for (let page = 1; ; page++) {
    const url = new URL(API);
    url.search = new URLSearchParams({ search: `${edition.search} ${edition.year}`, 'search_columns[]': 'post_title', per_page: '100', page: String(page), _fields: 'id,title,content,link,date,modified_gmt' });
    const json = await fetchJson(url.href);
    if (!Array.isArray(json) || json.some(p => typeof p.content?.rendered !== 'string' || typeof p.title?.rendered !== 'string' || typeof p.link !== 'string')) throw new Error('Invalid FIDE discovery response');
    posts.push(...json);
    if (json.length < 100) break;
  }
  return posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function fetchChess(now, previous, helpers) {
  const { warn = console.warn } = helpers;
  const fresh = [];
  const year = now.getUTCFullYear();
  const officialIds = new Set();
  // Previous snapshots remain authoritative if a partial scrape omits an edition.
  for (const competition of COMPETITIONS) {
    for (let y = year; y <= year + 2; y++) {
      const edition = { ...competition, year: y };
      let posts = [];
      try {
        posts = await discoverPosts(edition, helpers.fetchJson);
        const announcement = posts.map(post => ({ post, period: announcementPeriod(post, edition) })).find(item => item.period);
        const cachedPeriod = previous.find(e => e.id === eventId(edition, 'period'));
        if (announcement && !cachedPeriod?.officialSchedule) fresh.push(periodEvent({ ...edition, sourceUrl: announcement.post.link }, announcement.period));
      } catch (error) { warn(`  chess: ${competition.title} ${y} discovery unavailable (${error.message}); retaining cache`); }
      const sites = eventSites(posts, edition);
      if (competition.officialOrigin && posts.some(post => announcementPeriod(post, edition)) && !sites.includes(competition.officialOrigin)) sites.push(competition.officialOrigin);
      // Retry previously discovered official sites when news search is incomplete.
      for (const event of previous.filter(e => e.competition === edition.competition && e.edition === y && e.sourceUrl)) {
        try {
          const host = new URL(event.sourceUrl);
          if (host.protocol === 'https:' && host.hostname !== 'www.fide.com' && host.hostname.endsWith('.fide.com') && !sites.includes(host.origin)) sites.push(host.origin);
        } catch { /* Ignore malformed legacy source metadata. */ }
      }
      for (const origin of sites) {
        try {
          const events = await officialSchedule(origin, edition, helpers);
          for (const event of events) {
            if (officialIds.has(event.id)) continue;
            officialIds.add(event.id);
            fresh.push({ ...event, officialSchedule: true });
          }
        } catch (error) { warn(`  chess: ${competition.title} ${y} schedule unavailable (${error.message}); retaining cached rounds`); }
      }
    }
  }
  const events = await fetchOrganiserChess(now, mergeChessEvents(previous, fresh), helpers);
  if (!events.length) throw new Error('No published chess dates available');
  return events;
}

module.exports = { announcementPeriod, salesforceEvents, htmlScheduleEvents, mergeChessEvents, fetchChess };
