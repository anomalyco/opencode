# O89: a failed transcript read shows a toast

**TypeScript.** When the first `message.list` of a session fails, `data.session.message.sync` rethrows
(`packages/client/src/solid/data.ts:1880-1922`), and `createSessionRows` drops the error with `.catch(() => undefined)`
(`packages/tui/src/routes/session/rows.ts:128-143`). The session opens with an empty transcript, as if it had no
messages. Nothing is shown or logged, and nothing reads the page again until the session or the connection status
changes. A failed older page is dropped in the same way. `loadMore` rethrows (`data.ts:1924-1987`), and
`createHistoryPrepend` handles the rejection by clearing its pending load and running nothing else
(`packages/tui/src/routes/session/history.ts:25-42`). This applies to a scroll near the top and to the
previous-message walk (`routes/session/index.tsx:884`). The older messages never arrive, and nothing says why. Only
`session.first` shows its failure (`toast.error(error)`, `index.tsx:1035`).

**Rust.** The same failures show an error toast with the error's message alone, as `toast.error` shows it: the
session's first read (`routes/session/mod.rs` `load`), an older page (`messages/list.rs` `load_older`) and the
previous-message walk (`navigation.rs`). Everything else matches TS. The transcript keeps what it had, the scroll
position is not restored after a failed first read, and Rust adds no retry: a later scroll near the top, or another
previous-message move, asks again as it does in TS. P-APP `E.6a/history-failed` records this. The cells outside the
toast equal TS's empty transcript.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations. Without the
toast, the user has no sign that the transcript failed to load.
