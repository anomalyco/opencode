# O89: mini prints each row once after a list

**TypeScript.** A resize replay lists the messages again, then restores the rows only this client printed
(`performResizeReplay`). It skips a restored row whose message the list showed, by `messageIDs` and `errors`, but
three kinds of listed rows are not recorded there, so their live rows print a second time:

- a shell (`renderMessage` marks `shellStarted` and `shellEnded`; its rows carry no message ID);
- a skill message (`skillMessages` only);
- a failed compaction's error (the list writes it without adding to `errors`).

The streamed summary of an aborted compaction, which the list does not show, is restored without its header. The
events that arrived while the list was read apply after it: a tool call's `session.tool.input.started` among them
resets the call the list shows running to streaming, so its `session.tool.called` prints the call's start again.

With tools hidden, a `session.text.ended` after any list (the first, a reconnect's, or a resize's) that printed its
part buffers the whole text, and the step's end prints it again below the listed text.

**Rust.** `Transcript::replayed` restores a shell's start or end only when the list did not print it, and records
it. A listed skill message counts as shown, a listed compaction error is recorded in `errors`, and an assistant or
reasoning row of a listed message whose part the list does not hold is dropped. An input start leaves a call that is
further along as it is. With tools hidden, an end buffers only the text after what a list showed. After a resize, the
screen shows what a new client shows for the same list.

**Reason.** The user decided to fix the defects the TS client shares in Rust and record them as deviations, with no
upstream proposal (O-89).
