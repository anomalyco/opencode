# DLG13: the model dialog scrolls to the current model

## TypeScript

`DialogModel` selects the current model (`current={local.model.current()}`,
`packages/tui/src/component/dialog-model.tsx:250`), but when that row starts below the first screen of the list
the list stays at the top. The highlighted row is off screen until the user moves. Seen at 90x34 with the
E.16 fixture: the current model, Claude Sonnet, is the ninth row and the list shows rows one to eight. At
90x60, where the whole list fits, the row is highlighted in place.

## Rust

The select scrolls to the current option when it opens, as `DialogSelect` does for every other dialog
(the `U.3/select` fixture), so the current model is on screen and highlighted.

## Reason

`DialogSelect` asks for this scroll (`scrollAfterLayout(true, current)`, `packages/tui/src/ui/dialog-select.tsx:181`),
and the other dialogs get it. The TypeScript client misses it here, so Rust does not copy that. P-COMP fixtures
`E.16/model` and `E.16/model-filter` are taken at 90x60, where both sides draw the same cells.
