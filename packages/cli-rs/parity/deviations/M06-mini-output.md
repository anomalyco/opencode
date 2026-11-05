# M06, M07, M08, M14: mini's output, settings, spinners, and models

## Sequenced work spinners loop their main clip

- TypeScript: `block-soft-sweep`, `block-low-comet`, and `seed` are sequenced: `seed` plays an intro first, and
  the three slow down over a minute of work (`pace`). The spinner keeps its age across repaints.
- Rust: every work spinner loops its main clip at its fixed interval, and starts over when its color changes.
- Reason: opentui-rust's `Spinner` drives a looping clip only. The default spinner, `block-soft-slide`, and the
  other ten are not sequenced and match.

## No launch animation for the entry header

- TypeScript: with `mini.splash: show` and animations on, the entry header first shows in the footer with the
  seed's launch spinner for about 0.8 s, then moves into the scrollback.
- Rust: the entry header is written to the scrollback at once.
- Reason: the scrollback ends the same; the animation is cosmetic and short.

## Switching mono leaves the footer's ASCII as it started

- TypeScript: the settings panel's "Monochrome UI" redraws everything in the new mode.
- Rust: the scrollback, its theme, and the status row switch; the composer and the panels keep the markers and
  separators they started with until mini restarts. The setting is saved either way.
- Reason: the prompt and footer views take mono at construction; rebuilding them mid-session is a larger change.

## The work spinner row of the settings panel has no icon

- TypeScript: the "Work spinner" row shows the selected spinner animating.
- Rust: the row shows the spinner's name only.
- Reason: the panel menu draws text rows; the name is what changes.

## Image previews draw in half blocks

- TypeScript: with `session.image_preview`, Core's `ImageRenderable` picks the terminal's best image protocol and
  fits the picture by its pixel size and the terminal's pixel resolution.
- Rust: the picture draws in Unicode half blocks, fitted by its aspect to the terminal's width and the rows above
  the footer.
- Reason: scrollback rows are immutable cells; a Kitty or Sixel placement does not survive as a snapshot. The
  captions, and every case without a preview, match.

## An unknown tool's metadata draws as Markdown text

- TypeScript: an unknown tool without output shows its metadata as highlighted JSON (`<code filetype="json">`).
- Rust: the JSON goes through the Markdown widget, so it is not highlighted.
- Reason: the writer draws code bodies with the Markdown widget (M.1); only unknown tools reach this body.

## The context share uses the current model

- TypeScript: `% ctx` divides a step's tokens by the context window of the step's model (`session.step.started`).
- Rust: it uses the model mini sends with.
- Reason: they differ only when the model changed while a step ran.

## Messages and events that do not decode are dropped

- TypeScript: the transport reads messages and events as JSON, so a field of the wrong shape shows what it can.
- Rust: messages and events are decoded into the generated types once (O4). A message that does not decode is
  kept as unknown and draws nothing; an event that does not decode is skipped. A server always sends the full
  shapes; this matters only for hand-made fixtures.
