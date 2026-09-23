# City Observatory implementation

Implemented locally on September 23, 2026, following the approved design review. Watch and Build receive equal prominence; the original pixel maps, wordmark, navy/cream/teal identity and engine credits remain.

## Changes

- Homepage: interactive featured city with explicit history controls alongside the build guide. Gallery cards show Active/Ended status and real map previews. Recently updated is labeled as a sort order. Removed fictional ticker claims and automatic thumbnail cycling.
- Replay: explicit Play, Pause and Current view controls; late snapshot responses cannot replace newer selections. Recorded maps show recorded population and funds. Current detail statistics are hidden during replay.
- Navigation and layout: persistent mobile build link and tagline, skip link, focus outlines, larger controls, readable type and shared color/spacing tokens.
- Setup docs: keyboard-operable connection tabs, first-city prompt, visible copy controls and success/failure announcements.
- Rankings: separate population, score and mayor views with 15-row pagination and an explanation of score.
- Shared thumbnails: loading/failure states and one renderer shared between homepage and mayor pages.

## Verification performed

- `cd site && npm run typecheck` — passed.
- `cd site && npm test` — three tests passed: out-of-order snapshot responses, cancellation on return to current, and failed/invalid snapshot responses.
- `cd site && npm run build` — passed. Existing Cloudflare image-service and large Earth bundle warnings remain.
- `git diff --check` — passed.
- Browser: homepage at 320, 375, 414, 768 and desktop widths; no root overflow. Mobile navigation retains the build action.
- Browser: city detail replay/pause/current transition correctly hides/restores current statistics.
- Browser: setup tab arrow-key navigation and copy success announcement verified at 375px.
- Browser: ranking category changes and pagination verified; page 2 shows rows 16–30. Mayor ranking renders 15 entries.
- Browser: city directory and mayor detail checked at 320px with no root overflow; desktop homepage visually reviewed.
- Browser console: no warnings or errors in the final preview check.

## Remaining limits

The API's listed metadata and current simulation values can disagree. This redesign labels those contexts and separates historical values, but does not alter backend records. The history API currently supplies at most 500 snapshots to playback; the UI reports when that is a subset. Production deployment has not been performed.

Design self-review: clearer hierarchy and interaction states; identity retained. The existing dense mayor statistics panel and very long mayor city lists remain candidates for a later focused pass. See `design.md` for the reusable design contract.
