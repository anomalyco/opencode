# C01: cells around a submitted startup prompt

The C.13 scenarios (`C.13/auto`, `C.13/prompt-new`, `C.13/prompt-session`, `C.13/prompt-continue`) are the first
P-APP scenarios whose prompt has a loaded agent and model, and the first that submit. Two differences show
that do not come from the root flags:

- **The bar of a pending user message.** TypeScript draws the left bar of a user message that is still in the
  inbox in `border.base` (`borderColor={delivery() ? theme.border.base : color()}`,
  `routes/session/index.tsx:2384-2386`). Rust draws every user message bar in the agent color
  (`routes/session/messages/user.rs`), so the three rows of the sent `hello` differ in the bar's color only.
  Reason: not built yet. The pending-steer row is E.10b's; when it is built, this part of the file goes.
- **The color of the gaps in the prompt's metadata row.** TypeScript lays the row out as separate texts with
  `gap={1}`, so the gap cells keep the frame's default foreground. Rust draws the row as one text whose
  separators (`" · "`, `" auto"`, `" Demo"`) carry the muted color. The symbols and backgrounds are equal; only the
  foreground of space cells differs, which no terminal shows. Reason: one text keeps the row's truncation in
  one place (E.2); the difference is invisible.

The random home placeholder is masked (`T17-home-prompt`).
