# OT094: a legacy Shift+F3 report under the Kitty keyboard protocol

TypeScript (`@opentui/core` 0.9.4, since #63989): after startup, with the Kitty keyboard protocol on, the legacy form
`CSI 1;2R` reads as Shift+F3, so `parity/scenarios/OT/shift-f3.pty.ts` opens the settings dialog bound to it.

Rust (OpenTUI 0.9.4's Rust crates): with the Kitty protocol on, `CSI 1;2R` is a cursor position reply, as the
crates' conformance vectors say (`input/core_tests.rs`: a terminal in Kitty mode sends F3 as `CSI 13 ~`), so the
dialog stays closed. The Kitty form `CSI 13;2~` opens it in both.

Reason: key parsing is OpenTUI's. A terminal with the Kitty protocol on does not send the legacy form for a key, so
only a script sees it. 12 lines at the `shift-f3` checkpoint. It goes away when the crates and Core agree on the
vector.
