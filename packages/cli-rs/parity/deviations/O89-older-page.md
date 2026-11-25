# O89: an older-history page is not stitched onto a list that changed under it

**TypeScript.** `loadMore` publishes the older page only while the session's cursor is still the one the read
continued from (`packages/client/src/solid/data.ts`, `loadMore`). When a latest-page refresh replaced the
transcript and its cursor while the older read was in flight, the page is dropped and `loadMore` returns without a
retry; the caller asks again. A refresh that keeps the loaded transcript keeps its cursor, so the page is published.

**Rust.** `load_pages` publishes only while the session's cursor is still the one the read continued from. When a
refresh replaced it, the fetched pages are dropped and the load starts again from the new cursor, so the example
ends as [2, 3] with the cursor to [1] kept. When the cursor is gone (no older pages, eviction, or deletion), the
load publishes nothing.

**Reason.** Neither client stitches a page onto a list that changed under it. Rust retries the load itself, and its
refresh does not keep older pages (O89-transcript-refresh).
