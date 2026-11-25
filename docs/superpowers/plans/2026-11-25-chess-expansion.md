# Expanded chess schedules

User-approved scope: add World Rapid and Blitz, Tata Steel Masters, all Grand Chess Tour stops, and Grand Swiss; retain World Championship and Candidates. Prioritise confirmed dates over guessing times. Future editions must require no annual configuration edits.

## Approach

Use current organiser pages as rolling discovery roots, and the existing FIDE publication API for Grand Swiss. Keep published tournament spans; group rapid/blitz rounds into one session per published playing day. Prefer official round schedules to older announcements. Unknown dates/times remain absent. Source outages and malformed/partial editions preserve last-known-good data independently.

No season-specific production dates, fixture lists, year guards, or annual URLs. Derive the discovery window from the current date. Root URLs and competition identifiers are permanent configuration. Date/year extraction must be scoped to event content, never copyright or registration information. Upstream format changes can require maintenance; season rollover cannot.

## Tasks

- [x] Add regressions for rolling future years, tournament discovery, separate Rapid/Blitz playing days, partial-source failures, malformed dates, and Candidates retention.
- [x] Implement isolated organiser adapters with common strict date parsing. Extend FIDE Grand Swiss discovery without loosening other competition filters.
- [x] Keep official source links available for all new organisers and document the source strategy.
- [x] Refresh live sources, run the complete tests, check rendered dates, and obtain code review. Deliver on the existing feature branch as already requested in this chat.

## Validation focus

Do not treat amateurs as Tata Steel Masters rounds; do not reuse an old edition under a future year; do not include arrival dates as Rapid/Blitz playing sessions; validate real calendar dates; preserve other competitions when an adapter fails; keep round/session identifiers stable across rescheduling. Tests must advance into synthetic future years rather than relying on today's edition.

## Execution evidence

- Live refresh discovered 52 chess entries (378 total events), including 2026 Rapid/Blitz daily sessions, 2027 Tata Steel and Grand Swiss spans, and all twelve published 2026/2027 Grand Chess Tour stops. The existing Candidates period and fourteen rounds remain intact.
- Grand Swiss's current event site still identifies the prior edition. The collector retains the confirmed future FIDE announcement dates rather than relabelling the old schedule. Future edition-specific hosts can be followed from the stable root automatically.
- Browser checks verified December Rapid/Blitz days, January Tata Steel dates and its source link, and the May Grand Swiss/Grand Chess Tour overlap. Mobile day details remain readable at 390px width.
- Reviewer identified truncated Rapid/Blitz rows creating duplicate sessions. Added failing regressions, cached round-set validation, and duplicate-source-round rejection.
- Synthetic tests exercise future editions through 2042, simultaneous FIDE Candidates/Grand Swiss discovery, source outages, missing days and rows, unknown timezones, malformed dates and future-host discovery.
- Final verification: all 45 tests passed; reviewer follow-up found no material regression. No runtime packages, API keys, or additional annual configuration are required. The existing daily GitHub Action calls the expanded collector unchanged.
