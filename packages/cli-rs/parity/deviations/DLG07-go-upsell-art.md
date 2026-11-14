# DLG07: the Go upsell draws no rings

## TypeScript

When the screen has room (at least 22 rows, 26 below 52 columns), `DialogGoUpsell` draws `go_upsell_art` behind
the text: animated rings and the OpenCode logo, a custom renderable at 30 fps
(`packages/tui/src/component/dialog-go-upsell.tsx:142-154`, `component/go-upsell-art.ts`). The text sits on a
translucent panel (alpha 186) so it stays legible over the rings.

## Rust

The same text, link, and buttons on the same translucent panel, with no art behind them. In the compact layout
TypeScript draws no art either, and both sides draw the same cells (P-COMP `E.16/go-upsell`, 80x20).

## Reason

The art is a frame-by-frame custom renderable, not part of what the dialog says or does. It waits for a port of
`go-upsell-art.ts` onto opentui-rust's custom drawing, which no step owns yet.
