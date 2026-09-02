'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const calendarDisplay = require('../calendar-display');
const { eventDisplayPolicy } = calendarDisplay;

const today = new Date('2026-09-02T04:00:00Z');

test('derives the current calendar date in Singapore', () => {
  assert.equal(typeof calendarDisplay.singaporeDateParts, 'function');
  assert.deepEqual(
    calendarDisplay.singaporeDateParts(new Date('2026-09-01T16:30:00Z')),
    { year: 2026, month: 8, day: 2 },
  );
});

test('uses the Singapore date to decide whether a day has passed', () => {
  const afterMidnightInSingapore = new Date('2026-09-01T16:30:00Z');
  assert.deepEqual(eventDisplayPolicy(2026, 8, 1, afterMidnightInSingapore), {
    showAll: false,
    visibleLimit: 4,
  });
  assert.deepEqual(eventDisplayPolicy(2026, 8, 2, afterMidnightInSingapore), {
    showAll: true,
    visibleLimit: Infinity,
  });
});

test('keeps the four-event limit for dates before today', () => {
  assert.deepEqual(eventDisplayPolicy(2026, 8, 1, today), {
    showAll: false,
    visibleLimit: 4,
  });
});

test('shows every event on today', () => {
  assert.deepEqual(eventDisplayPolicy(2026, 8, 2, today), {
    showAll: true,
    visibleLimit: Infinity,
  });
});

test('shows every event on future dates', () => {
  assert.deepEqual(eventDisplayPolicy(2026, 8, 3, today), {
    showAll: true,
    visibleLimit: Infinity,
  });
});

test('sorts tournament bars first, then fixtures by time, then untimed fixtures', () => {
  assert.equal(typeof calendarDisplay.sortEventsForDay, 'function');

  const events = [
    { id: 'untimed-1', type: 'match' },
    { id: 'late', type: 'match', time: '23:00' },
    { id: 'period', type: 'tournament' },
    { id: 'early', type: 'match', time: '03:00' },
    { id: 'untimed-2', type: 'match' },
  ];

  assert.deepEqual(
    calendarDisplay.sortEventsForDay(events).map(event => event.id),
    ['period', 'early', 'late', 'untimed-1', 'untimed-2'],
  );
});

test('prefixes a timed fixture label with its time', () => {
  assert.equal(typeof calendarDisplay.fixtureLabel, 'function');
  assert.equal(
    calendarDisplay.fixtureLabel({ title: 'Ipswich Town vs Liverpool', time: '03:00' }),
    '03:00 · Ipswich Town vs Liverpool',
  );
});

test('leaves an untimed fixture label unchanged', () => {
  assert.equal(typeof calendarDisplay.fixtureLabel, 'function');
  assert.equal(
    calendarDisplay.fixtureLabel({ title: 'LCK Grand Final' }),
    'LCK Grand Final',
  );
});

test('opens the day popup when a fixture is clicked', () => {
  assert.equal(typeof calendarDisplay.bindDayModalActivation, 'function');

  const fixture = new EventTarget();
  let opened = 0;
  calendarDisplay.bindDayModalActivation(fixture, () => { opened++; });
  fixture.dispatchEvent(new Event('click'));

  assert.equal(opened, 1);
});

test('opens the day popup when a focused fixture receives Enter', () => {
  const fixture = new EventTarget();
  const enter = new Event('keydown', { cancelable: true });
  Object.defineProperty(enter, 'key', { value: 'Enter' });
  let opened = 0;

  calendarDisplay.bindDayModalActivation(fixture, () => { opened++; });
  fixture.dispatchEvent(enter);

  assert.equal(opened, 1);
  assert.equal(enter.defaultPrevented, true);
});

test('opens the day popup when a focused fixture receives Space', () => {
  const fixture = new EventTarget();
  const space = new Event('keydown', { cancelable: true });
  Object.defineProperty(space, 'key', { value: ' ' });
  let opened = 0;

  calendarDisplay.bindDayModalActivation(fixture, () => { opened++; });
  fixture.dispatchEvent(space);

  assert.equal(opened, 1);
  assert.equal(space.defaultPrevented, true);
});
