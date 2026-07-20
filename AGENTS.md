# Calendar data rules

All recurring calendar data must be discovered from rolling, keyless public
sources. GitHub Actions must be sufficient to move the calendar into future
seasons without a code or data edit.

- Do not add season-specific fixture lists, tournament dates, or year guards to
  production code.
- New sources must derive their requested years from the current date and use
  stable source identifiers rather than a manually maintained schedule.
- Each source must validate its response and preserve last-known-good data when
  the upstream service is unavailable or incomplete.
- Adding a new sport or competition is the only reason a manual data-source
  configuration change should be needed.
