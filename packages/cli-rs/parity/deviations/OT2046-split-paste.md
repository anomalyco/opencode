# OT2046: text typed right after Escape is kept, and a split paste stays a paste

TypeScript: `@opentui/core` 0.8.4's native input parser. On terminals that confirm the Kitty keyboard protocol
(Kitty, Ghostty, foot, Alacritty, WezTerm), a raw Escape at the end of a read makes the next read the rest of an
escape sequence, however late it comes: typing `OA` quickly after Escape moves prompt history as Up, `[a` loses
characters, and some text swallows every later key, Enter included. On any terminal, a bracketed paste whose start
marker is split by a pause of 20 ms or more is typed as keys, so each pasted newline submits the prompt.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2046). After Escape the parser joins a read only as a
sequence such a terminal sends (a CSI starting with a digit, `?`, `>`, `<` or a key or focus letter, or a Kitty
graphics reply); everything else is typed. A cut paste start waits for the rest of its marker, so the paste arrives
whole. Keys and pastes that arrive in one read behave as in TS.

Reason: TS's behavior is a defect of the shared native parser. The difference goes away when TS moves to an
`@opentui/core` release that includes #2046.
