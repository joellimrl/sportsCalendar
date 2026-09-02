'use strict';

function toSGT(dateStr, utcTime) {
  if (!dateStr) return null;
  let iso = utcTime ? `${dateStr}T${utcTime.replace(/^T/, '')}` : dateStr.replace(' ', 'T');
  if (iso.includes('T') && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) iso += 'Z';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = type => parts.find(part => part.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

module.exports = { toSGT };
