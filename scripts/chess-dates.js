'use strict';

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const text = html => String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—').replace(/&rsquo;/gi, '’').replace(/\s+/g, ' ').trim();
const slug = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const inWindow = (year, now) => year >= now.getUTCFullYear() && year <= now.getUTCFullYear() + 2;

function dateParts(year, month, day) {
  const date = `${year}-${String(MONTHS.indexOf(month.toLowerCase().slice(0, 3)) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!validDate(date)) throw new Error(`Invalid published chess date: ${date}`);
  return date;
}

function parseDateRange(value, year) {
  const content = text(value);
  const join = '(?:[-–—]|to|and)';
  const monthFirst = content.match(new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})\\s*${join}\\s*(?:(${MONTH})\\s+)?(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i'));
  const dayFirst = content.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH})\\s*${join}\\s*(\\d{1,2})\\s+(${MONTH})(?:,?\\s+(\\d{4}))?`, 'i'));
  const sameMonth = content.match(new RegExp(`\\b(\\d{1,2})\\s*${join}\\s*(\\d{1,2})\\s+(${MONTH})(?:,?\\s+(\\d{4}))?`, 'i'));
  const m = monthFirst || dayFirst || sameMonth;
  if (!m) return null;
  const explicitYear = Number(m[sameMonth === m ? 4 : 5] || year);
  if (explicitYear !== year) throw new Error('Published date range has a different edition year');
  let startDate, endDate;
  if (m === monthFirst) { startDate = dateParts(year, m[1], m[2]); endDate = dateParts(year, m[3] || m[1], m[4]); }
  else if (m === dayFirst) { startDate = dateParts(year, m[2], m[1]); endDate = dateParts(year, m[4], m[3]); }
  else { startDate = dateParts(year, m[3], m[1]); endDate = dateParts(year, m[3], m[2]); }
  if (endDate < startDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 45) throw new Error('Invalid published chess date range');
  return { startDate, endDate };
}

function explicitOffset(label) {
  const m = label.match(/^\s*[-–—(]?\s*(CEST|CET|UTC|GMT)(?:\s*([+-])\s*(\d{1,2})(?::(\d{2}))?)?\b/i);
  if (!m) return null;
  const base = { CEST: 120, CET: 60, UTC: 0, GMT: 0 }[m[1].toUpperCase()];
  const minutes = base + (m[2] === '-' ? -1 : 1) * (Number(m[3] || 0) * 60 + Number(m[4] || 0));
  return Math.abs(minutes) <= 14 * 60 ? minutes : null;
}

module.exports = { MONTH, validDate, text, slug, inWindow, dateParts, parseDateRange, explicitOffset };
