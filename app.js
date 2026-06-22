'use strict';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

let allEvents = [];
let currentYear;
let currentMonth;

const activeSports = new Set(['f1', 'tennis', 'football', 'lol']);

const tooltip    = document.getElementById('tooltip');
const monthLabel = document.getElementById('month-label');

async function loadEvents() {
  const res  = await fetch('data/events.json');
  const data = await res.json();
  allEvents  = data.events;

  if (data.lastUpdated) {
    const updated  = new Date(data.lastUpdated);
    const fmt      = updated.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    document.getElementById('last-updated').textContent = `Data as of ${fmt}`;

    const daysSince = Math.floor((Date.now() - updated) / 86_400_000);
    if (daysSince > 8) {
      const warn = document.getElementById('stale-warning');
      document.getElementById('stale-days').textContent =
        daysSince === 1 ? '1 day ago' : `${daysSince} days ago`;
      warn.hidden = false;
    }
  }
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function getEventsForDate(year, month, day) {
  const target = new Date(year, month, day);
  const results = [];

  for (const ev of allEvents) {
    if (!activeSports.has(ev.sport)) continue;
    if (ev.date) {
      const d = parseDate(ev.date);
      if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
        results.push({ ...ev, spanType: 'single' });
      }
    } else if (ev.startDate && ev.endDate) {
      const start = parseDate(ev.startDate);
      const end   = parseDate(ev.endDate);
      if (target >= start && target <= end) {
        let spanType;
        if (target.getTime() === start.getTime()) spanType = 'start';
        else if (target.getTime() === end.getTime()) spanType = 'end';
        else spanType = 'mid';
        results.push({ ...ev, spanType });
      }
    }
  }

  return results;
}

function typeIcon(type) {
  const icons = { race: '🏁', qualifying: '⏱', sprint: '⚡', final: '🏆', semifinal: '🎯', tournament: '📅', season: '📅', match: '⚔️' };
  return icons[type] || '';
}

function chipLabel(ev) {
  if (ev.spanType === 'single') return ev.title;
  return ev.title;
}

function showTooltip(ev, x, y) {
  const dateStr = ev.date
    ? formatDate(parseDate(ev.date))
    : `${formatDate(parseDate(ev.startDate))} – ${formatDate(parseDate(ev.endDate))}`;

  const timeRow = ev.time ? `<div class="tooltip-date">🕐 ${ev.time} SGT</div>` : '';

  tooltip.innerHTML = `
    <div class="tooltip-title">${typeIcon(ev.type)} ${ev.title}</div>
    <div class="tooltip-detail">${ev.detail}</div>
    <div class="tooltip-date">${dateStr}</div>
    ${timeRow}
  `;
  tooltip.classList.add('visible');
  positionTooltip(x, y);
}

function positionTooltip(x, y) {
  const tw = tooltip.offsetWidth || 260;
  const th = tooltip.offsetHeight || 80;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x + 12;
  let top  = y + 12;
  if (left + tw > vw - 8) left = x - tw - 12;
  if (top  + th > vh - 8) top  = y - th - 12;
  tooltip.style.left = left + 'px';
  tooltip.style.top  = top  + 'px';
}

function hideTooltip() {
  tooltip.classList.remove('visible');
}

function buildCalendar(year, month) {
  document.getElementById('month-label').textContent = `${MONTHS[month]} ${year}`;

  const grid = document.getElementById('calendar-grid');
  const headers = Array.from(grid.querySelectorAll('.day-header'));
  grid.innerHTML = '';
  headers.forEach(h => grid.appendChild(h));

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const todayD = today.getDate();

  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'day-cell';

    let cellYear = year, cellMonth = month, cellDay;
    if (i < firstDay) {
      cellDay = prevMonthDays - firstDay + i + 1;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear  = month === 0 ? year - 1 : year;
      cellYear = prevYear; cellMonth = prevMonth;
      cell.classList.add('other-month');
    } else if (i - firstDay < daysInMonth) {
      cellDay = i - firstDay + 1;
    } else {
      cellDay = i - firstDay - daysInMonth + 1;
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear  = month === 11 ? year + 1 : year;
      cellYear = nextYear; cellMonth = nextMonth;
      cell.classList.add('other-month');
    }

    if (cellYear === todayY && cellMonth === todayM && cellDay === todayD) {
      cell.classList.add('today');
    }

    const numEl = document.createElement('div');
    numEl.className = 'day-number';
    numEl.textContent = cellDay;
    cell.appendChild(numEl);
    // wire up after dayEvents is known — see below

    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'events-in-day';

    const dayEvents = getEventsForDate(cellYear, cellMonth, cellDay);
    // Sort: tournament spans first (thin bars), then other spans, then single events
    dayEvents.sort((a, b) => {
      const score = e => e.spanType === 'single' ? 2 : e.type === 'tournament' ? 0 : 1;
      return score(a) - score(b);
    });
    const MAX_VISIBLE = 4;

    dayEvents.slice(0, MAX_VISIBLE).forEach(ev => {
      const chip = document.createElement('div');
      chip.className = `event-chip ${ev.sport} type-${ev.type}`;

      if (ev.spanType !== 'single') {
        const col = i % 7;
        const trueStart = ev.spanType === 'start';
        const trueEnd   = ev.spanType === 'end';
        const isMid     = ev.spanType === 'mid';
        const isRowStart = col === 0;
        const isRowEnd   = col === 6;

        const extendRight = (trueStart || isMid) && !isRowEnd;
        const extendLeft  = (trueEnd   || isMid) && !isRowStart;
        const showTitle   = trueStart || isRowStart;

        if (extendRight)              chip.classList.add('span-extend-right');
        if (extendLeft)               chip.classList.add('span-extend-left');
        if (!showTitle)               chip.classList.add('span-no-text');
        if (isRowStart && !trueStart) chip.classList.add('row-wrap-start');
      }

      // Tournament spans are thin bars — always suppress text; tooltip still works
      if (ev.type !== 'tournament') chip.textContent = chipLabel(ev);
      chip.addEventListener('mouseenter', e => showTooltip(ev, e.clientX, e.clientY));
      chip.addEventListener('mousemove',  e => positionTooltip(e.clientX, e.clientY));
      chip.addEventListener('mouseleave', hideTooltip);
      eventsContainer.appendChild(chip);
    });

    if (dayEvents.length > MAX_VISIBLE) {
      const more = document.createElement('div');
      more.className = 'more-events';
      more.textContent = `+${dayEvents.length - MAX_VISIBLE} more`;
      more.addEventListener('click', () => showDayModal(cellYear, cellMonth, cellDay));
      eventsContainer.appendChild(more);
    }

    // Make day number clickable when the day has events
    if (dayEvents.length > 0) {
      numEl.classList.add('has-events');
      numEl.addEventListener('click', () => showDayModal(cellYear, cellMonth, cellDay));
    }

    cell.appendChild(eventsContainer);
    grid.appendChild(cell);
  }
}

const modalOverlay  = document.getElementById('modal-overlay');
const modalDateEl   = document.getElementById('modal-date');
const modalEventsEl = document.getElementById('modal-events');

function showDayModal(year, month, day) {
  const events = getEventsForDate(year, month, day);
  if (events.length === 0) return;

  const date = new Date(year, month, day);
  modalDateEl.textContent = date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  modalEventsEl.innerHTML = '';
  for (const ev of events) {
    const item = document.createElement('div');
    item.className = 'modal-event';

    const timeRow = ev.time
      ? `<div class="modal-event-time">&#x1F550; ${ev.time} SGT</div>`
      : '';

    item.innerHTML = `
      <div class="modal-event-title">
        <span class="modal-event-dot ${ev.sport}"></span>
        ${typeIcon(ev.type)} ${ev.title}
      </div>
      <div class="modal-event-detail">${ev.detail}</div>
      ${timeRow}
    `;
    modalEventsEl.appendChild(item);
  }

  modalOverlay.hidden = false;
  hideTooltip();
}

function closeModal() { modalOverlay.hidden = true; }

document.getElementById('modal-close').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.getElementById('prev-btn').addEventListener('click', () => {
  if (currentMonth === 0) { currentMonth = 11; currentYear--; }
  else currentMonth--;
  buildCalendar(currentYear, currentMonth);
});

document.getElementById('next-btn').addEventListener('click', () => {
  if (currentMonth === 11) { currentMonth = 0; currentYear++; }
  else currentMonth++;
  buildCalendar(currentYear, currentMonth);
});

document.getElementById('today-btn').addEventListener('click', () => {
  const now = new Date();
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();
  buildCalendar(currentYear, currentMonth);
});

document.querySelectorAll('.legend-item[data-sport]').forEach(item => {
  const sport = item.dataset.sport;
  item.addEventListener('click', () => {
    if (activeSports.has(sport)) {
      activeSports.delete(sport);
      item.classList.add('inactive');
    } else {
      activeSports.add(sport);
      item.classList.remove('inactive');
    }
    buildCalendar(currentYear, currentMonth);
  });
});

(async () => {
  await loadEvents();
  const now = new Date();
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();
  buildCalendar(currentYear, currentMonth);
})();
