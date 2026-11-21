# DLG35: select rows ignore a right-click release

## TypeScript

Each `DialogSelect` row runs `option.onSelect` and `props.onSelect` from `onMouseUp`
(`packages/tui/src/ui/dialog-select.tsx:799-803`), whatever the button. OpenTUI Core delivers the release of any
button to `onMouseUp`, so releasing a right-click (or middle click) over a row chooses it.

## Rust

`Select::row_mouse` (`crates/ui/src/select.rs`) chooses a row only on `MouseEventKind::Up(MouseButton::Left)`.
Releasing any other button over a row does nothing.

## Reason

Choosing a row on a right-click release is a TypeScript bug: a right-click is not a request to choose, and it
can run an action the user did not ask for (O-41, `reviews/ms3-ms4.review-carbon.md` notes). The left-click path
is the same on both sides; `ui/tests/all/dialogs.rs::clicks_select_rows_and_the_backdrop_closes_the_dialog`
covers both buttons.
