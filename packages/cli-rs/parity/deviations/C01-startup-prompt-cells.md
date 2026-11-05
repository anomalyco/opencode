# C01: cells around a submitted startup prompt

The C.13 scenarios (`C.13/auto`, `C.13/prompt-new`, `C.13/prompt-session`, `C.13/prompt-continue`) are the first
P-APP scenarios whose prompt has a loaded agent and model, and the first that submit. One difference shows that
does not come from the root flags (three or four cells per checkpoint):

- **The color of the gaps in the prompt's metadata row.** TypeScript lays the row out as separate texts with
  `gap={1}`, so the gap cells keep the frame's default foreground. Rust draws the row as one text whose
  separators (`" · "`, `" auto"`, `" Demo"`) carry the muted color. The symbols and backgrounds are equal; only the
  foreground of space cells differs, which no terminal shows. Reason: one text keeps the row's truncation in
  one place (E.2); the difference is invisible.

The bar of a user message still in the inbox takes `border.base` in both clients
(`routes/session/messages/user.rs`, E.10b). The random home placeholder is masked (`T17-home-prompt`).
