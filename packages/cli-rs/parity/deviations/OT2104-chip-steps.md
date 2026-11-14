# OT2104: the prompt steps over one label at a time

TypeScript: `@opentui/core` 0.8.4 keeps the cursor rules for virtual extmarks in JavaScript (`extmarks.ts`). Its Left
and Right move with `setCursorByOffset`, which the same rules wrap. When two labels touch, one key crosses both. Its
Up keeps the cursor at a label's end when the row above lands nearer that end.

Rust: the client pins OpenTUI `32e9e414e`. Since anomalyco/opentui#2104, the rules run in native code (`OT_EDIT_ATOMIC`)
and are the same for Core and Rust: each Left or Right steps over one label, and a vertical move never stays inside a
label or where it started. Two cases differ from TS.

**Labels that touch.** Each paste puts a space after its label, but Delete before that space joins two labels. In
`parity/scenarios/OT/extmark-chips.pty.ts` the prompt is `a [Image 1][Image 1]`:

- From the end of the second label, Left: TS moves before both labels and `X` reads `aX [Image 1][Image 1]`. Rust
  stops between them and `X` reads `a [Image 1]X[Image 1]`.
- From the line start, Right twice: TS moves past both labels and `Y` reads `a [Image 1][Image 1]Y`. Rust stops
  between them and `Y` reads `a [Image 1]Y[Image 1]`.

Before #2104, Rust's Right was the same as now, and Left went to the start of the first label.

**Up from the end of a label that wraps over three rows.** In `parity/scenarios/OT/extmark-wrapped-up.pty.ts`, a file
mention of 168 cells wraps over three rows of 70. Left over the space after it, then Up. The row above lands nearer
the mention's end:

- TS stays at the end (screen column 44), and `X` goes after the mention. That extends the mention's word, so the file
  list opens again.
- Rust moves before the mention (screen column 17), and `X` goes in front of it.

Before #2104, Rust stayed at the end, as TS does. A mention must be at least twice the prompt width for this to occur.

Backspace and Delete next to touching labels delete one label in both clients, the one ending or starting at the
cursor. Undo brings it back in both clients.

Reason: TS's double step and its Up that does not move come from Core 0.8.4's JavaScript rules, which #2104 replaces
with the native ones. The difference goes away when TS moves to an `@opentui/core` release that includes #2104.
