# Changelog

## 1.1.1

- Add an Android panel for Random note, On This Day, Daily Recall and Writing statistics, including progress, Copy Markdown and Recount.
- Add comma-separated source notebook IDs and an optional recursive sub-notebook scope for all review features. Writing statistics continue to cover the whole library.
- Reject malformed or unavailable source notebooks instead of silently reviewing all notebooks. Empty scopes preserve existing daily summaries.
- Disable automatic startup generation on mobile. Guard summary generation against repeated taps and sync changes on one device.
- Find existing daily summaries independently of the search index and source scope, avoiding duplicate output caused by a lagging index.
- Use the visible Created date for date-based reviews and statistics, including imported or backdated notes. Historical date breakdowns can change from 1.0.1; whole-library word totals are unaffected.
- Escape brackets and backslashes in generated note links.

Upgrade: fully restart Joplin after updating so the new settings appear. Source notebook settings are configured on each device. The declared minimum is Joplin 3.0 on desktop and 3.4 on mobile; community device feedback covers Android 16/17 with Joplin 3.7.8 and Ubuntu 26.04 with Joplin 3.7.21. iOS and real multi-device sync have not been verified. Independently generating on two offline devices can still create duplicate daily summaries after sync.

## 1.0.1

- Whole-library writing statistics with CJK-aware counting, caching, a heatmap and year/notebook breakdowns in a desktop dialog.
