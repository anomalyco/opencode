# O89: an older-history page is not stitched onto a list that changed under it

**TypeScript.** `loadMore` publishes the older page only while the session's cursor is still the one the read
continued from (`packages/client/src/solid/data.ts`, `loadMore`). When a latest-page refresh replaced the
transcript and its cursor while the older read was in flight, the page is dropped and `loadMore` returns without a
retry; the caller asks again. A refresh that keeps the loaded transcript keeps its cursor, so the page is published.

**Rust.** `load_pages` publishes only while the session's cursor is still the one the read continued from. A refresh
that keeps the loaded transcript keeps its cursor, so the page is published. When a refresh replaced the cursor, the
fetched pages are dropped and the load starts again from the new cursor, so no message is skipped. When the cursor is
gone (no older pages, eviction, or deletion), the load publishes nothing.

**Reason.** Neither client stitches a page onto a list that changed under it. Rust retries the load itself.
