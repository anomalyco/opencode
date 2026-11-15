# D131: the exit summary of an untitled session

## TypeScript

The session route records `Locale.truncate(session()?.title ?? "", 50)` for the exit summary
(`packages/tui/src/routes/session/index.tsx:201-204`), and `epilogue` prints it as is
(`packages/tui/src/util/presentation.ts:39`). A session the server has not titled, such as one whose title
generation failed, prints a `Session` row with nothing after the label.

## Rust

An untitled session (no title, or an empty one) prints `New session`, or `Child session` for a child: the label TS
gives such a session in its links (`SessionTitleFallback.displayLabel`). A titled session prints its title, as in TS
(`crates/tui/src/features/epilogue.rs`).

## Reason

A TS defect, fixed here (O-89): the row names the session, and an empty one says nothing; the D131 Windows run
showed it for a session the server gave no title. Driven by `parity/scenarios/D131/title-untitled.pty.ts`
(checkpoint `epilogue`, one line); `title-renamed.pty.ts` checks that a titled session prints as in TS.
