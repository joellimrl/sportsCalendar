'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { announcementPeriod, salesforceEvents, htmlScheduleEvents, mergeChessEvents, fetchChess } = require('../scripts/chess');

const edition = { competition: 'world-championship', year: 2030, title: 'FIDE World Championship', sourceUrl: 'https://worldchampionship.fide.com/schedule' };
const candidates = { competition: 'candidates', year: 2030, title: 'FIDE Candidates', sourceUrl: 'https://candidates2030.fide.com/schedule' };
const post = (title, text) => ({ title: { rendered: title }, content: { rendered: `<p>${text}</p>` }, link: 'https://www.fide.com/announcement/', date: '2029-10-01T00:00:00' });

test('announcements extract event dates but reject bidding, qualification, and unrelated competitions', () => {
  const p = post('The 2030 FIDE Candidates come to Cyprus', 'The tournament will take place between March 28 and April 16, 2030 in Cyprus.');
  assert.deepEqual(announcementPeriod(p, candidates), { startDate: '2030-03-28', endDate: '2030-04-16' });
  for (const title of ['Bidding for FIDE Candidates 2030', 'Qualification paths for Candidates 2030', 'Women’s Candidates 2030', 'World Rapid Championship 2030']) {
    assert.equal(announcementPeriod({ ...p, title: { rendered: title } }, candidates), null);
  }
  assert.equal(announcementPeriod(post('FIDE Candidates 2030 announced', 'Dates to be announced. Qualifiers were played March 28 – April 16, 2029.'), candidates), null);
  assert.equal(announcementPeriod(post('FIDE Candidates 2030 announced', 'Dates to be announced. The qualifier runs March 28 – April 16, 2030.'), candidates), null);
  assert.equal(announcementPeriod(post('FIDE Candidates 2030 announced', 'Registration runs March 28 – April 16, 2030.'), candidates), null);
});

test('announcements support day-first dates and reject impossible dates', () => {
  assert.deepEqual(announcementPeriod(post('FIDE World Championship Match 2030 confirmed', 'The match will be held from 22 November to 12 December 2030.'), edition), { startDate: '2030-11-22', endDate: '2030-12-12' });
  assert.equal(announcementPeriod(post('FIDE Candidates 2030', 'The event runs February 30 – March 10, 2030.'), candidates), null);
});

const match = { Name: 'FIDE World Championship Match 2030', Start_Date__c: '2030-11-22', End_Date__c: '2030-12-12' };
test('official UTC round timestamps convert to SGT, with stable IDs across rescheduling', () => {
  const row = { Round_Number__c: 1, Scheduled_Start__c: '2030-11-24T19:00:00Z', Round_Status__c: 'Scheduled' };
  const first = salesforceEvents(match, [row], [], edition).find(e => e.type === 'match');
  assert.equal(first.date, '2030-11-25');
  assert.equal(first.time, '03:00');
  const changed = salesforceEvents(match, [{ ...row, Scheduled_Start__c: '2030-11-26T14:00:00Z' }], [], edition).find(e => e.type === 'match');
  assert.equal(first.id, changed.id);
  assert.equal(changed.date, '2030-11-26');
  assert.throws(() => salesforceEvents(match, [{ ...row, Scheduled_Start__c: '2030-11-24T19:00:00' }], [], edition), /timestamp/i);
});

test('official period validates edition and dates; conditional tiebreak has no invented time', () => {
  const events = salesforceEvents(match, [], [{ Day__c: '2030-12-12', Event_Label__c: 'Tie-break (if needed), Closing Ceremony', Time__c: 'TBD' }], edition);
  assert.equal(events[0].startDate, '2030-11-22');
  const tie = events.find(e => e.type === 'match');
  assert.match(tie.title, /if needed/);
  assert.equal(tie.time, undefined);
  assert.throws(() => salesforceEvents({ ...match, Name: 'FIDE World Championship Match 2028' }, [], [], edition), /edition/i);
  assert.throws(() => salesforceEvents({ ...match, End_Date__c: '2030-11-01' }, [], [], edition), /date/i);
});

test('HTML Candidates schedule reads published rounds and explicit timezone, skipping rest days', () => {
  const html = '<h1>FIDE Candidates 2030</h1><p>March 28 - April 16</p><div>March 29</div><div>Round 1</div><div>15:30 - CEST+1</div><div>March 30</div><div>Rest day</div><div>March 31</div><div>Round 2</div><div>15:30 - CEST+1</div>';
  const events = htmlScheduleEvents(html, candidates);
  assert.equal(events.length, 2);
  assert.equal(events[0].date, '2030-03-29');
  assert.equal(events[0].time, '20:30');
  assert.equal(htmlScheduleEvents(html.replaceAll('CEST+1', 'local time'), candidates)[0].time, undefined);
  assert.equal(htmlScheduleEvents('<h1>FIDE Candidates 2030</h1><div>March 29 Round 1 15:30 local time</div><footer>Server time UTC</footer>', candidates)[0].time, undefined);
});

test('cache merges partial editions and keeps old times when a refresh omits time', () => {
  const old = [{ id: 'a', date: '2030-11-24', time: '22:00', sport: 'chess' }, { id: 'b', date: '2030-11-25', sport: 'chess' }];
  assert.equal(mergeChessEvents(old, [{ ...old[0], time: undefined }])[0].time, '22:00');
  assert.equal(mergeChessEvents(old, [{ ...old[0], date: '2030-11-26', time: undefined }])[0].time, undefined);
  assert.equal(mergeChessEvents(old, [])[1].id, 'b');
  assert.deepEqual(mergeChessEvents(old, [{ ...old[0], cancelled: true }]).map(e => e.id), ['b']);
});

test('discovery uses rolling years and follows official event links without fabricated dates', async () => {
  const urls = [];
  const events = await fetchChess(new Date('2030-11-25T00:00:00Z'), [], {
    fetchJson: async url => {
      urls.push(url);
      const u = new URL(url);
      assert.equal(u.hostname, 'www.fide.com');
      if (u.searchParams.get('search') === 'Candidates 2032') return [post('FIDE Candidates 2032 confirmed', 'The event will take place from March 28 to April 16, 2032.')];
      return [];
    },
    fetchText: async () => { throw new Error('offline'); }, warn: () => {},
  });
  assert.ok(urls.some(u => new URL(u).searchParams.get('search') === 'Candidates 2032'));
  assert.equal(events.length, 1);
  assert.equal(events[0].startDate, '2032-03-28');
});

test('unavailable sources preserve cached competitions and malformed JSON is not treated as empty success', async () => {
  const cached = [{ id: 'cached-candidates', date: '2030-12-01', sport: 'chess' }];
  const result = await fetchChess(new Date('2030-11-25'), cached, { fetchJson: async () => ({ error: 'broken' }), fetchText: async () => { throw Error('offline'); }, warn: () => {} });
  assert.deepEqual(result, cached);
  await assert.rejects(fetchChess(new Date('2030-11-25'), [], { fetchJson: async () => [], fetchText: async () => '', warn: () => {} }), /no.*chess/i);
});

test('official discovery follows changing runtime hashes and controller IDs, even when news is down', async () => {
  const cached = [{ sport: 'chess', competition: edition.competition, edition: edition.year, id: 'old-round', date: '2030-11-23', sourceUrl: edition.sourceUrl }];
  const calls = [];
  const result = await fetchChess(new Date('2030-11-25'), cached, {
    fetchText: async url => {
      calls.push(url);
      return url.includes('/webruntime/view/')
        ? 'getApexInvoker("","@udd/new-controller-id","getSchedule","false")'
        : '<script src="/webruntime/view/new-hash/prod/en-US/schedule_view"></script>';
    },
    fetchJson: async url => {
      if (url.startsWith('https://www.fide.com/')) throw Error('news offline');
      const u = new URL(url);
      assert.equal(u.searchParams.get('classname'), '@udd/new-controller-id');
      return { returnValue: ({ getMatch: match, getRounds: [{ Round_Number__c: 2, Scheduled_Start__c: '2030-11-25T14:00:00Z' }], getSchedule: [] })[u.searchParams.get('method')] };
    }, warn: () => {},
  });
  assert.ok(calls.some(u => u.includes('new-hash')));
  assert.equal(result.find(e => e.id.endsWith('round-2')).time, '22:00');
  assert.ok(result.some(e => e.id === 'old-round'));
});

test('HTML event schedule dates must agree with the discovered edition', async () => {
  const result = await fetchChess(new Date('2030-11-25'), [], {
    fetchJson: async url => new URL(url).searchParams.get('search') === 'Candidates 2030'
      ? [post('FIDE Candidates 2030 confirmed', 'The event takes place from March 28 to April 16, 2030. <a href="https://candidates2030.fide.com/">Official site</a>')]
      : [],
    fetchText: async url => url.endsWith('/schedule')
      ? '<h1>Candidates 2028</h1><div>March 29 Round 1 15:30 - CEST+1</div><footer>Copyright 2030</footer>'
      : '<a href="/schedule">Schedule</a>', warn: () => {},
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'tournament');
});
