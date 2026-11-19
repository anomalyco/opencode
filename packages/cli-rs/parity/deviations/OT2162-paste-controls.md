# OT2162: a field's own paste drops control characters

TypeScript: `@opentui/core` 0.8.4's `TextareaRenderable.handlePaste` strips escape sequences
(`stripAnsiSequences`) and inserts the rest, so other control characters stay and the field draws them as notation:
a paste of `a`, BEL, `b` shows `a^Gb`. This is the paste a field takes itself: a dialog's prompt, a select's search,
a permission's reject message, the integration form, and mini's form and permission fields. The prompts and the
session form handle their pastes themselves and strip only escape sequences there, in both clients.

Rust: the client pins OpenTUI 0.9.4. A `Textarea` or `Input` paste strips escape sequences, then every control
character but tab and line breaks (anomalyco/opentui#2163, as Core does since #2162), so the same paste shows `ab`.
Text set or inserted by the client keeps its control characters and shows notation, as in TS.

Reason: Core makes its own paste drop control characters since #2162, and OpenTUI's Rust widgets follow it. Before
0.9.4 the Rust widgets dropped them from all text. The difference goes away when TS moves to an `@opentui/core`
release that includes #2162.
