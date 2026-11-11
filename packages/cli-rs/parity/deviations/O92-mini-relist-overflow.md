# O92: mini bounds the events a resize relist holds

**TypeScript.** While a resize replay lists the messages again, `receive` pushes every event into
`state.buffered.events` (`stream-v2.transport.ts:1450-1453`), with no bound, and applies them after the list
(`performResizeReplay`, `:1737`).

**Rust.** `Transcript::event` holds at most `RELIST_LIMIT` (4096) events. One more drops them and starts a new read
under a new ticket; the older read no longer applies. Until a relist clears the terminal again the transcript is
`lost`:

- a reconnect hydration relists after it;
- a failed read tries again after the resize delay (250 ms);
- the clearing relist hydrates the subagents as a reconnect does, since their events were dropped too.

Below the limit, mini prints what TS prints. Past it, the terminal is cleared and written once more, and a
`session.renamed` among the dropped events does not update the title until the next one.

**Reason.** Every queue between tasks and the UI is bounded (`packages/cli-rs/AGENTS.md`). Bounded storage cannot
replay a slow read exactly, so the relist starts over after the dropped events (O-92, models plan M6 and S5).
