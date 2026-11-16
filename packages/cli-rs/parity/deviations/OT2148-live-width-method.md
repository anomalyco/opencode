# OT2148: a text area follows a width method that changes after startup

TypeScript: `@opentui/core` 0.8.4 makes each text area's edit buffer with the width method the renderer has when the
text area is created (`EditBuffer.create(ctx.widthMethod, …)`). When the terminal's DECRPM 2027 reply arrives after
startup and changes the method, the scene measures with the new one, but the text area's buffer keeps the old one.
On a terminal that turns out not to cluster graphemes (mode 0), the prompt that was already open still counts `👍🏽`
as 2 cells, and its cursor sits 2 cells after the start of the text while the emoji is drawn 4 wide.

Rust: the client pins OpenTUI `cee1698ad`. Since anomalyco/opentui#2148, `Code`, `Input` and `Textarea` create their
buffers with `OT_EDIT_BUFFER_FOLLOW_SESSION_WIDTH`: a buffer measures with the width method of the session that shows
it, also after that method changes, and keeps its cursor, selections, marks, styled runs and undo points on their
text. The prompt's cursor after `👍🏽` is 4 cells after the start of the text, where the drawn text ends. Before
#2148 the Rust client was worse than TS (record 692): the prompt drew the thumb without its skin tone, the cursor where
TS has it.

Driven against TS: `parity/scenarios/OT/late-width.pty.ts` (P-PTY). The home screen opens, a `\e[?2027;0$y` reply
arrives, and `👍🏽` is typed. The screens are equal. The `typed:cursor` record differs in its one line: TS `18,16`,
Rust `20,16`. On the earlier pin `c3a007e0d` the Rust screen showed `👍` alone, with the cursor at `18,16`.

Reason: a TS defect, fixed by OpenTUI (O-89). Core's newer releases follow too (#2148 changes Core's `EditBuffer`).
The difference goes away when TS moves to an `@opentui/core` release that includes #2148.
