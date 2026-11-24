# DLG07: the Go upsell art always takes its 24-bit color path

## TypeScript

When the screen has room (at least 22 rows, 26 below 52 columns), `DialogGoUpsell` draws `go_upsell_art` behind
the text: rings and the GO logo, at 30 fps while animations run and the frame halfway through the period while they
are off (`packages/tui/src/component/dialog-go-upsell.tsx:142-154`, `component/go-upsell-art.ts`). The logo's full
blocks (`█`) are drawn as upper half blocks (`▀`) with a top and a bottom color only when the terminal reports 24-bit
color (`capabilities.rgb`); otherwise they stay `█` in one color, the average of the two.

## Rust

The same art (`crates/tui/src/dialogs/go_upsell_art.rs`), cell for cell: the still frame equals TS's on a 24-bit
color terminal (P-COMP `E.16/go-upsell-art`, 90x34). It always takes the half-block path, whatever the terminal's
color depth.

## Reason

OpenTUI's Rust crates expose no color-depth capability to the client, so it cannot tell which path TS would take.
The 24-bit path is what TS draws in the terminals the clients target (the plugins field test saw it). Driven by
`models::go_upsell_art_matches_typescript_when_still` against `E.16/go-upsell-art-256`, the TS frame without 24-bit
color: exactly the logo's seven full-block cells differ, `█` in TS and `▀` in Rust. The difference goes away when
OpenTUI's Rust crates report the color depth.
