# O89: an older-history page is not stitched onto a list that changed under it

**TypeScript.** `loadMore` prepends the older page to whatever transcript is current and installs the page's own
`next` cursor (`packages/client/src/solid/data.ts:1910-1919`). When a latest-page refresh lands while the older
read is in flight, the page is stitched onto the refreshed list: the messages between the two pages are missing,
and the old continuation replaces the refreshed cursor. With latest page [2], an older read for [1], and a refresh
to [3], the transcript is [1, 3] with no more pages.

**Rust.** `load_pages` publishes only while the session's cursor is still the one the read continued from. When a
refresh replaced it, the fetched pages are dropped and the load starts again from the new cursor, so the example
ends as [2, 3] with the cursor to [1] kept. When the cursor is gone (no older pages, eviction, or deletion), the
load publishes nothing.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.
