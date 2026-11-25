'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const chess = require('../scripts/chess');
const getSources = () => require('../scripts/chess-sources');

test('Grand Swiss discovery accepts its own confirmed dates and excludes qualification dates', () => {
  const edition = { competition: 'grand-swiss', year: 2035 };
  const post = { title: { rendered: 'FIDE Grand Swiss 2035 announced' }, content: { rendered: '<p>The event will take place from May 10 to 25 on the Isle of Man.</p>' } };
  assert.deepEqual(chess.announcementPeriod(post, edition), { startDate: '2035-05-10', endDate: '2035-05-25' });
  assert.equal(chess.announcementPeriod({ ...post, title: { rendered: 'FIDE Grand Swiss 2035 qualification paths' } }, edition), null);
});

test('Grand Chess Tour discovers all published future stops without a season-specific event list', () => {
  const { tourEvents } = getSources();
  const card = (year, name, dates, slug) => `<figcaption class="tournament-small__caption"><h4>${year} ${name}</h4><span>Venue</span><span>${dates}</span><a href="/tours/${year}/tournaments/${year}-${slug}/">Overview</a></figcaption>`;
  const html = card(2035, 'SINQUEFIELD CUP', 'August 13 – 27', 'sinquefield-cup') + card(2036, 'NEW CLASSIC', 'June 28 – July 5', 'new-classic') + card(2034, 'OLD EVENT', 'May 1 – 8', 'old-event');
  const events = tourEvents(html, new Date('2035-11-25'));
  assert.equal(events.length, 2);
  assert.equal(events.find(e => e.edition === 2036).endDate, '2036-07-05');
  assert.ok(events.every(e => e.sourceUrl.startsWith('https://grandchesstour.org/')));
  assert.equal(tourEvents(html.replace('August 13 – 27', 'Dates TBA'), new Date('2035-11-25')).length, 1);
  assert.throws(() => tourEvents(html.replace('August 13 – 27', 'February 30 – March 5'), new Date('2035-11-25')), /date/i);
});

test('Tata Steel reads only the organiser event banner and requires its explicit year', () => {
  const { tataEvents } = getSources();
  const html = '<title>Tata Steel Chess</title><span class="spr-homepage-hero__date">15 - 31 Jan 2036</span><p>Amateurs 3-5 January</p><footer>Copyright 2037</footer>';
  const events = tataEvents(html, new Date('2035-11-25'));
  assert.equal(events.length, 1);
  assert.equal(events[0].startDate, '2036-01-15');
  assert.equal(events[0].title, 'Tata Steel Masters');
  assert.throws(() => tataEvents(html.replace('Jan 2036', 'Jan'), new Date('2035-11-25')), /year|edition/i);
  assert.deepEqual(tataEvents(html.replace('Jan 2036', 'Jan 2034'), new Date('2035-11-25')), []);
});

const rapidHtml = (year, offset = '') => `<title>FIDE World Rapid &amp; Blitz Championships ${year}</title><p>Arrivals: 25 December ${year}</p>
<table><caption>Rapid · 26 December ${year}</caption><tr><th>Time</th><th>Open</th><th>Women</th></tr><tr><th>1:00 pm</th><td colspan="2">Opening Ceremony</td></tr><tr><th>2:00 pm ${offset}</th><td>Round 1</td><td>Round 1</td></tr><tr><th>3:20 pm</th><td>Round 2</td><td>Round 2</td></tr></table>
<table><caption>Blitz · 29 December ${year}</caption><tr><th>Time</th><th>Open</th><th>Women</th></tr><tr><th>2:00 pm ${offset}</th><td>Round 1</td><td>Round 1</td></tr><tr><th>3:00 pm</th><td>—</td><td>Final</td></tr></table>`;

test('Rapid and Blitz use distinct playing-day sessions, omitting arrival days and unknown timezones', () => {
  const { rapidBlitzEvents } = getSources();
  const events = rapidBlitzEvents(rapidHtml(2036), new Date('2035-11-25'));
  assert.equal(events.length, 4);
  assert.equal(events.find(e => e.competition === 'world-rapid' && e.type === 'tournament').startDate, '2036-12-26');
  assert.equal(events.find(e => e.competition === 'world-blitz' && e.type === 'tournament').startDate, '2036-12-29');
  assert.ok(events.every(e => e.time === undefined));
  const timed = rapidBlitzEvents(rapidHtml(2036, 'UTC+3'), new Date('2035-11-25'));
  assert.equal(timed.find(e => e.type === 'match').time, '19:00');
  assert.deepEqual(rapidBlitzEvents(rapidHtml(2034), new Date('2035-11-25')), []);
});

test('a partial Rapid response does not shorten a cached period or erase Blitz/Candidates', () => {
  const { mergePublishedChess } = getSources();
  const old = [
    { id: 'rapid-period', competition: 'world-rapid', edition: 2036, type: 'tournament', startDate: '2036-12-26', endDate: '2036-12-28' },
    { id: 'rapid-day-1', competition: 'world-rapid', edition: 2036, type: 'match', date: '2036-12-26' },
    { id: 'rapid-day-2', competition: 'world-rapid', edition: 2036, type: 'match', date: '2036-12-28' },
    { id: 'blitz', competition: 'world-blitz', date: '2036-12-29' },
    { id: 'candidates', competition: 'candidates', date: '2036-04-01' },
  ];
  const fresh = [{ ...old[0], endDate: '2036-12-26' }, old[1]];
  const merged = mergePublishedChess(old, fresh);
  assert.equal(merged.find(e => e.id === 'rapid-period').endDate, '2036-12-28');
  assert.equal(merged.length, old.length);
  const timed = { ...old[1], time: '19:00' };
  assert.equal(mergePublishedChess([timed], [{ ...timed, time: undefined }])[0].time, '19:00');
  assert.equal(mergePublishedChess([timed], [{ ...timed, date: '2036-12-27', time: undefined }])[0].time, undefined);
});

test('organiser outages are independent and current/next editions roll without configuration', async () => {
  const { fetchOrganiserChess } = getSources();
  const results = await fetchOrganiserChess(new Date('2041-11-25'), [], {
    fetchText: async url => {
      if (url.includes('tatasteelchess')) return '<span class="spr-homepage-hero__date">15 - 31 Jan 2042</span>';
      throw Error('offline');
    }, warn: () => {},
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].edition, 2042);
});

test('missing rows within a playing day preserve its complete cached session without duplicates', () => {
  const { rapidBlitzEvents, mergePublishedChess } = getSources();
  const now = new Date('2035-11-25');
  const original = rapidHtml(2036);
  const cached = rapidBlitzEvents(original, now);
  for (const removed of [
    '<tr><th>2:00 pm </th><td>Round 1</td><td>Round 1</td></tr>',
    '<tr><th>3:20 pm</th><td>Round 2</td><td>Round 2</td></tr>',
  ]) {
    const fresh = rapidBlitzEvents(original.replace(removed, ''), now);
    const merged = mergePublishedChess(cached, fresh);
    assert.equal(merged.filter(e => e.competition === 'world-rapid' && e.type === 'match').length, 1);
    assert.deepEqual(merged.find(e => e.competition === 'world-rapid' && e.type === 'match'), cached.find(e => e.competition === 'world-rapid' && e.type === 'match'));
  }
});

test('duplicated source rounds are rejected rather than becoming duplicate playing sessions', () => {
  const { rapidBlitzEvents } = getSources();
  const html = rapidHtml(2036);
  const rapidTable = html.match(/<table>[\s\S]*?<\/table>/)[0];
  assert.throws(() => rapidBlitzEvents(html + rapidTable.replace('26 December', '27 December'), new Date('2035-11-25')), /duplicate/i);
});

test('FIDE discovers future Grand Swiss and Candidates together without inventing an unannounced edition', async () => {
  const searches = [];
  const events = await chess.fetchChess(new Date('2040-11-25'), [], {
    fetchJson: async url => {
      const search = new URL(url).searchParams.get('search');
      searches.push(search);
      if (!['Grand Swiss 2042', 'Candidates 2042'].includes(search)) return [];
      return [{ title: { rendered: `FIDE ${search} confirmed` }, content: { rendered: '<p>The event will take place from May 10 to 25, 2042.</p>' }, link: 'https://www.fide.com/announcement/', date: '2040-10-01T00:00:00' }];
    }, fetchText: async () => { throw Error('schedule not published'); }, warn: () => {},
  });
  assert.ok(searches.includes('Grand Swiss 2042'));
  assert.ok(searches.includes('Candidates 2042'));
  assert.deepEqual(new Set(events.map(e => e.competition)), new Set(['grand-swiss', 'candidates']));
  assert.ok(events.every(e => e.startDate === '2042-05-10'));
});

test('a stable FIDE root can discover its future edition-specific schedule host', async () => {
  const events = await chess.fetchChess(new Date('2040-11-25'), [], {
    fetchJson: async url => new URL(url).searchParams.get('search') === 'Grand Swiss 2042' ? [{ title: { rendered: 'FIDE Grand Swiss 2042 announced' }, content: { rendered: '<p>The event runs from May 10 to 25, 2042.</p>' }, link: 'https://www.fide.com/announcement/' }] : [],
    fetchText: async url => {
      if (url === 'https://grandswiss.fide.com') return '<a href="https://grandswiss2042.fide.com/schedule/">Schedule</a>';
      if (url === 'https://grandswiss2042.fide.com/schedule/') return '<h1>FIDE Grand Swiss 2042</h1><div>May 11 Round 1 15:00 UTC</div>';
      throw Error('offline');
    }, warn: () => {},
  });
  const round = events.find(e => e.type === 'match');
  assert.equal(round?.date, '2042-05-11');
  assert.equal(round?.time, '23:00');
  assert.equal(round?.sourceUrl, 'https://grandswiss2042.fide.com/schedule/');
});
