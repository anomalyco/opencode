# O89: mini prints a restored prompt once

**TypeScript.** A resize replay lists the messages again, then restores the rows only this client printed
(`performResizeReplay`, `:1727`). A restored local user prompt does not record its message ID. When the prompt was
delivered but the terminal was resized before `message.list` had it, the next list (the turn settles, or the
stream reconnects) prints the same prompt a second time.

**Rust.** `Transcript::restore` records the message ID of a restored user row, so the listed message counts as shown
and the prompt prints once. The skill rows and the images of that message were already handled once each.

**Reason.** The user decided to fix the defects the TS client shares in Rust and record them as deviations, with no
upstream proposal (O-89).
