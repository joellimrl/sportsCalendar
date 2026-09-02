'use strict';

const singaporeDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

function singaporeDateParts(date = new Date()) {
  const parts = singaporeDateFormatter.formatToParts(date);
  const get = type => Number(parts.find(part => part.type === type)?.value);
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

function eventDisplayPolicy(year, month, day, today = new Date()) {
  const targetKey = year * 10_000 + (month + 1) * 100 + day;
  const singaporeToday = singaporeDateParts(today);
  const todayKey = singaporeToday.year * 10_000 + (singaporeToday.month + 1) * 100 + singaporeToday.day;
  const showAll = targetKey >= todayKey;
  return { showAll, visibleLimit: showAll ? Infinity : 4 };
}

function sortEventsForDay(events) {
  return events.sort((a, b) => {
    const tournamentOrder = Number(a.type !== 'tournament') - Number(b.type !== 'tournament');
    if (tournamentOrder !== 0) return tournamentOrder;
    if (a.type === 'tournament') return 0;
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1;
    if (b.time) return 1;
    return 0;
  });
}

function fixtureLabel(event) {
  return event.time ? `${event.time} · ${event.title}` : event.title;
}

function bindDayModalActivation(fixture, openDay) {
  fixture.addEventListener('click', openDay);
  fixture.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDay(event);
  });
}

const CalendarDisplay = { singaporeDateParts, eventDisplayPolicy, sortEventsForDay, fixtureLabel, bindDayModalActivation };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalendarDisplay;
}

if (typeof window !== 'undefined') {
  window.CalendarDisplay = CalendarDisplay;
}
