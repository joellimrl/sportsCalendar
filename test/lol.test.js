'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchLol, icalEvents, tournamentEvent, calendarEvents, mergeEvents, discoverTitles } = require('../scripts/lol');
const now = new Date('2030-10-02T00:00:00Z');
const page = (title, start, end) => ({ title, revisions: [{ slots: { main: { content:
  `{{Infobox Tournament\n|name=${title}\n|sdate=${start}\n|edate=${end}\n}}\n|date=1999-01-01` } } }] });
const calendar = (date = '20301003T180000Z', summary = 'Semifinal: A vs B') =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:fixture@example\r\nDTSTART:${date}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test('published Worlds and Demacia periods do not depend on match fixtures', () => {
  for (const [title, competition] of [
    ['2030 Season World Championship', 'Worlds'],
    ['2030 Demacia Cup Global Invitational', 'Demacia Cup Global Invitational'],
    ['Demacia Cup 2029', 'Demacia Cup'],
  ]) {
    const event = tournamentEvent(page(title, '2030-10-03', '2030-11-14'), now);
    assert.equal(event.competition, competition);
    assert.equal(event.endDate, '2030-11-14');
  }
  assert.throws(() => tournamentEvent(page('2030 Season World Championship', '2030-02-30', '2030-11-14'), now), /Incomplete/);
  assert.throws(() => tournamentEvent(page('2030 Season World Championship', '2030-10-03', ''), now), /Incomplete/);
});

test('calendar fixtures use SGT including next-day matches, unfolding and all-day dates', () => {
  const fixtures = icalEvents(calendar().replace('A vs B', 'A vs\r\n B'));
  assert.equal(fixtures[0].date, '2030-10-04');
  assert.equal(fixtures[0].time, '02:00');
  assert.equal(fixtures[0].summary, 'Semifinal: A vsB');
  assert.equal(calendarEvents('Worlds', fixtures, now)[1].time, '02:00');
  assert.equal(icalEvents(calendar('20301003'))[0].date, '2030-10-03');
  assert.throws(() => icalEvents('<html>Unavailable</html>'), /Invalid/);
  assert.throws(() => icalEvents(calendar().replace('END:VEVENT', '')), /Truncated/);
  assert.throws(() => icalEvents(calendar('20301003T180000')), /timezone/);
  assert.throws(() => icalEvents(calendar('20300230T180000Z')), /Invalid/);
});

test('separate annual editions and preserve a prior-year tournament crossing January', () => {
  const events = calendarEvents('Demacia Cup', [
    { id: '1', date: '2029-12-25', summary: 'Quarterfinal' },
    { id: '2', date: '2030-01-03', summary: 'Final' },
    { id: '3', date: '2030-10-03', summary: 'Quarterfinal' },
    { id: '4', date: '2031-10-03', summary: 'Quarterfinal' },
  ], now);
  const periods = events.filter(e => e.type === 'tournament');
  assert.equal(periods.length, 3);
  assert.equal(new Set(periods.map(e => e.id)).size, 3);
  assert.ok(tournamentEvent(page('Demacia Cup 2029', '2029-12-25', '2030-01-03'), now));
});

test('partial refresh retains missing competitions and matches, replaces estimates, and updates times', () => {
  const worlds = tournamentEvent(page('2030 Season World Championship', '2030-10-15', '2030-11-14'), now);
  const old = [worlds, { id: 'match', title: 'LCK – Final', sport: 'lol', date: '2030-08-01', type: 'final' },
    { id: 'estimate', title: 'Worlds', startDate: '2030-10-20', endDate: '2030-10-25', type: 'tournament' }];
  const merged = mergeEvents(old, [{ ...old[1], time: '18:00' }], now);
  assert.deepEqual(merged.map(e => e.id), [worlds.id, 'match']);
  assert.equal(merged[1].time, '18:00');
  assert.deepEqual(mergeEvents(merged, [{ ...old[1], time: '18:00' }], now), merged);
  const overlapping = { ...old[2], startDate: '2030-10-16', endDate: '2030-11-15' };
  assert.equal(mergeEvents([worlds, overlapping], [], now).length, 1);
});

test('both Demacia competitions show only quarterfinals and above while keeping full periods', () => {
  const fixtures = ['Round 1', 'Round 4', 'Elimination', 'Quarterfinal 1', 'Semifinal 1', 'Grand Final']
    .map((stage, index) => ({ id: String(index), date: '2030-10-03', time: '16:00', summary: `${stage}: A vs B` }));
  for (const name of ['Demacia Cup', 'Demacia Cup Global Invitational']) {
    const events = calendarEvents(name, fixtures, now);
    assert.equal(events.length, 4);
    assert.equal(events[0].type, 'tournament');
    assert.deepEqual(events.slice(1).map(e => e.detail), ['Quarterfinal 1: A vs B', 'Semifinal 1: A vs B', 'Grand Final: A vs B']);
    assert.equal(events[1].time, '16:00');
    const opening = { id: 'cached-opening', title: `${name} – Round 1: A vs B`, detail: 'Round 1: A vs B', date: '2030-10-03', type: 'match' };
    assert.deepEqual(mergeEvents([opening, ...events], [], now), events);
  }
});

test('page discovery follows MediaWiki continuation', async () => {
  const calls = [];
  const titles = await discoverTitles('LCK/2030', async url => {
    calls.push(new URL(url).searchParams);
    return calls.length === 1 ? { query: { allpages: [{ title: 'First' }] }, continue: { apcontinue: 'Next', continue: '-||' } }
      : { query: { allpages: [{ title: 'Next' }] } };
  });
  assert.deepEqual(titles, ['First', 'Next']);
  assert.equal(calls[1].get('apcontinue'), 'Next');
});

test('rolling refresh avoids Cargo and retains Worlds during empty or failed feeds', async () => {
  const worlds = tournamentEvent(page('2030 Season World Championship', '2030-10-15', '2030-11-14'), now);
  const prefixes = [];
  const events = await fetchLol(now, [worlds], {
    warn: () => {},
    fetchJson: async url => {
      const params = new URL(url).searchParams;
      assert.equal(params.get('action'), 'query');
      if (params.get('list')) {
        prefixes.push(params.get('apprefix'));
        return { query: { allpages: params.get('apprefix') === '2030 ' ? [{ title: '2030 Demacia Cup Global Invitational' }] : [] } };
      }
      return { query: { pages: [page('2030 Demacia Cup Global Invitational', '2030-10-03', '2030-10-17')] } };
    },
    fetchText: async url => {
      if (url.includes('world-championship')) return 'BEGIN:VCALENDAR\nEND:VCALENDAR';
      if (url.includes('lck')) return calendar();
      throw new Error('HTTP 503');
    },
  });
  assert.ok(prefixes.includes('LCK/2031'));
  assert.ok(prefixes.includes('LPL/2030'));
  assert.ok(events.some(e => e.id === worlds.id));
  assert.ok(events.some(e => e.title === 'Demacia Cup Global Invitational'));
  assert.ok(events.some(e => e.title === 'LCK – Semifinal: A vs B' && e.time === '02:00'));
});

test('a complete source outage throws so the caller retains the last-known-good cache', async () => {
  await assert.rejects(fetchLol(now, [], {
    warn: () => {}, fetchJson: async () => { throw new Error('offline'); }, fetchText: async () => { throw new Error('offline'); },
  }), /no current events/);
});
