# O89: a resize replay prints each listed row once

**TypeScript.** A resize replay lists the messages again, then restores the rows only this client printed
(`performResizeReplay`). It skips a restored row whose message the list showed, by `messageIDs` and `errors`, but
three kinds of listed rows are not recorded there, so their live rows print a second time:

- a shell (`renderMessage` marks `shellStarted` and `shellEnded`; its rows carry no message ID);
- a skill message (`skillMessages` only);
- a failed compaction's error (the list writes it without adding to `errors`).

The streamed summary of an aborted compaction, which the list does not show, is restored without its header.

**Rust.** `Transcript::replayed` restores a shell's start or end only when the list did not print it, and records
it. A listed skill message counts as shown, a listed compaction error is recorded in `errors`, and an assistant or
reasoning row of a listed message whose part the list does not hold is dropped. After a resize, the screen shows what
a new client shows for the same list.

**Reason.** The user decided to fix the defects the TS client shares in Rust and record them as deviations, with no
upstream proposal (O-89).
