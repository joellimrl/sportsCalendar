'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toSGT } = require('../scripts/date-time');

test('moves the calendar date forward when UTC-to-SGT conversion crosses midnight', () => {
  assert.deepEqual(toSGT('2026-09-04T19:00Z'), {
    date: '2026-09-05',
    time: '03:00',
  });
});

test('converts sources that provide separate UTC date and time fields', () => {
  assert.deepEqual(toSGT('2026-09-04', '16:00:00Z'), {
    date: '2026-09-05',
    time: '00:00',
  });
});

test('treats Leaguepedia date-time strings as UTC', () => {
  assert.deepEqual(toSGT('2026-09-04 19:00:00'), {
    date: '2026-09-05',
    time: '03:00',
  });
});
