'use strict';

const { toSGT } = require('./date-time');
const { MONTH, text, slug, inWindow, dateParts, parseDateRange, explicitOffset } = require('./chess-dates');
const SOURCES = {
  tour: 'https://grandchesstour.org/',
  tata: 'https://tatasteelchess.com/en',
  rapid: 'https://worldrapidandblitz.fide.com/',
};

function period(competition, title, year, dates, sourceUrl, detail = 'Official organiser tournament dates') {
  return { id: `chess-${competition}-${year}-period`, sport: 'chess', competition, edition: year, title, ...dates, type: 'tournament', sourceUrl, detail, officialSchedule: true };
}

function tourEvents(html, now) {
  const events = [];
  for (const caption of html.matchAll(/<figcaption\b[^>]*class=["'][^"']*tournament-small__caption[^"']*["'][^>]*>([\s\S]*?)<\/figcaption>/gi)) {
    const heading = text(caption[1].match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]);
    const year = Number(heading.match(/^(\d{4})\b/)?.[1]);
    if (!inWindow(year, now)) continue;
    const spans = [...caption[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map(m => text(m[1]));
    const dates = spans.map(value => parseDateRange(value, year)).find(Boolean);
    if (!dates) continue;
    const links = [...caption[1].matchAll(/href=["']([^"']+)["']/gi)].map(m => new URL(m[1], SOURCES.tour));
    const link = links.find(u => u.origin === new URL(SOURCES.tour).origin && new RegExp(`^/tours/${year}/tournaments/[^/]+/$`).test(u.pathname));
    if (!link) throw new Error('Grand Chess Tour event is missing its official edition link');
    const key = link.pathname.split('/').filter(Boolean).at(-1).replace(/^\d{4}-/, '');
    const title = heading.replace(/^\d{4}\s+/, '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\bGct\b/g, 'GCT');
    events.push(period(`grand-chess-tour-${slug(key)}`, title, year, dates, link.href, `Grand Chess Tour · ${spans[0] || 'Venue TBA'} · Official tournament dates`));
  }
  return [...new Map(events.map(e => [e.id, e])).values()];
}

function tataEvents(html, now) {
  // The banner is the organiser's next tournament, not amateur registration/news dates.
  const banner = text(html.match(/class=["'][^"']*spr-homepage-hero__date[^"']*["'][^>]*>([^<]+)/i)?.[1]);
  if (!banner) throw new Error('Tata Steel event banner unavailable');
  const year = Number(banner.match(/\b(\d{4})\b/)?.[1]);
  if (!year) throw new Error('Tata Steel event edition year unavailable');
  if (!inWindow(year, now)) return [];
  const dates = parseDateRange(banner, year);
  if (!dates) throw new Error('Tata Steel dates are incomplete');
  return [period('tata-steel-masters', 'Tata Steel Masters', year, dates, SOURCES.tata, 'Wijk aan Zee · Official tournament dates')];
}

function publishedTime(value, date) {
  const m = value.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?\s*(.*)$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (m[3]) {
    if (hour < 1 || hour > 12) throw new Error('Invalid published chess time');
    hour = hour % 12 + (/pm/i.test(m[3]) ? 12 : 0);
  }
  if (hour > 23 || minute > 59) throw new Error('Invalid published chess time');
  const offset = explicitOffset(m[4]);
  const localMinutes = hour * 60 + minute;
  return { localMinutes, ...(offset !== null && { timing: toSGT(new Date(Date.parse(`${date}T00:00:00Z`) + (localMinutes - offset) * 60_000).toISOString()) }) };
}

function rapidBlitzEvents(html, now) {
  const identity = text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const edition = Number(identity.match(/\b(\d{4})\b/)?.[1]);
  if (!/world.*rapid.*blitz/i.test(identity) || !edition) throw new Error('World Rapid and Blitz edition unavailable');
  if (!inWindow(edition, now)) return [];
  const sessions = [];
  const seenRounds = new Set();
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const caption = text(table[1].match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1]);
    const m = caption.match(new RegExp(`^(Rapid|Blitz)\\s*[·–—-]\\s*(\\d{1,2})\\s+(${MONTH})\\s+(\\d{4})$`, 'i'));
    if (!m || Number(m[4]) !== edition) continue;
    const date = dateParts(edition, m[3], m[2]);
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => text(cell[1])));
    const header = rows.find(row => row[0] === 'Time' && row.includes('Open'));
    if (!header) throw new Error('World Rapid and Blitz table lacks an Open column');
    const openIndex = header.indexOf('Open');
    const rounds = rows.filter(row => /^Round\s+\d+$/i.test(row[openIndex] || '')).map(row => ({ number: Number(row[openIndex].match(/\d+/)[0]), start: publishedTime(row[0], date) }));
    if (!rounds.length) continue;
    const first = rounds.reduce((a, b) => a.number < b.number ? a : b);
    const format = m[1].toLowerCase();
    const competition = `world-${format}`;
    for (const round of rounds) {
      const key = `${format}-${round.number}`;
      if (seenRounds.has(key)) throw new Error('Duplicate published Rapid/Blitz round');
      seenRounds.add(key);
    }
    sessions.push({ id: `chess-${competition}-${edition}-session-round-${first.number}`, sport: 'chess', competition, edition, title: `World ${format === 'rapid' ? 'Rapid' : 'Blitz'} – Rounds ${first.number}–${Math.max(...rounds.map(r => r.number))}`, date, ...(first.start?.timing || {}), type: 'match', sourceUrl: SOURCES.rapid,
      detail: 'Official Open playing-day schedule' + (first.start?.timing ? '' : ' · Start time TBA in SGT'), officialSchedule: true,
      publishedDate: date, roundNumbers: rounds.map(r => r.number).sort((a, b) => a - b) });
  }
  const periods = ['rapid', 'blitz'].flatMap(format => {
    const competition = `world-${format}`;
    const days = sessions.filter(e => e.competition === competition).map(e => e.date).sort();
    if (!days.length) return [];
    return [period(competition, `FIDE World ${format === 'rapid' ? 'Rapid' : 'Blitz'} Championship`, edition, { startDate: days[0], endDate: days.at(-1) }, SOURCES.rapid, 'Official published playing dates; arrivals and ceremonies excluded')];
  });
  if (!sessions.length) throw new Error('World Rapid and Blitz playing schedule unavailable');
  return [...periods, ...sessions];
}

function mergePublishedChess(previous, fresh) {
  const merged = new Map(previous.map(event => [event.id, event]));
  const accepted = fresh.filter(event => {
    if (!event.roundNumbers) return true;
    const old = previous.find(e => e.competition === event.competition && e.edition === event.edition && e.type === 'match' &&
      (e.id === event.id || (e.publishedDate || e.date) === event.publishedDate || e.roundNumbers?.some(n => event.roundNumbers.includes(n))));
    if (!old) return true;
    // A missing first row changes the candidate ID; a missing later row reduces
    // its round set. Neither is evidence to replace a complete cached session.
    if (!old.roundNumbers) return old.id === event.id;
    return old.roundNumbers.every(n => event.roundNumbers.includes(n));
  });
  for (const event of accepted) {
    const old = merged.get(event.id);
    if (old?.type === 'tournament' && /^world-(?:rapid|blitz)$/.test(event.competition)) {
      const missing = previous.filter(e => e.competition === event.competition && e.edition === event.edition && e.type === 'match' && !accepted.some(n => n.id === e.id));
      if (missing.length) {
        merged.set(event.id, { ...event, startDate: [old.startDate, event.startDate].sort()[0], endDate: [old.endDate, event.endDate].sort().at(-1) });
        continue;
      }
    }
    const next = { ...event };
    if (!next.time && old?.date === next.date && old?.time) next.time = old.time;
    merged.set(event.id, next);
  }
  return [...merged.values()];
}

async function fetchOrganiserChess(now, previous, { fetchText, warn = console.warn }) {
  const fresh = [];
  for (const [name, url, parse] of [['Grand Chess Tour', SOURCES.tour, tourEvents], ['Tata Steel', SOURCES.tata, tataEvents], ['World Rapid and Blitz', SOURCES.rapid, rapidBlitzEvents]]) {
    try { fresh.push(...parse(await fetchText(url), now)); }
    catch (error) { warn(`  chess: ${name} unavailable (${error.message}); retaining cached dates`); }
  }
  return mergePublishedChess(previous, fresh);
}

module.exports = { tourEvents, tataEvents, rapidBlitzEvents, mergePublishedChess, fetchOrganiserChess };
