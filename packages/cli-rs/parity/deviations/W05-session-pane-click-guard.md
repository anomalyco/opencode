# W05: the session pane's click guard lets presses through

## TypeScript

While the right pane (a terminal or a panel) has the input, `SessionFrame` lays a transparent box over the session
pane (`packages/tui/src/component/session-frame.tsx:300-322`). The box takes every press and release: a release
calls `focusSession`, which gives the prompt the focus back, and nothing under the box sees the click. It forwards
wheel events inside the transcript's viewport to the transcript.

## Rust

`SessionFrame` (`crates/tui/src/frame/mod.rs`) has no box. A left release that bubbles to the session pane calls
`focus_session` while the right pane is active, so the prompt gets the focus back the same way, and the wheel
reaches the transcript without forwarding. The press reaches the widget under the pointer first: a click on a
transcript button or a tab works while the right pane has the input, where TypeScript only moves the focus. The
prompt ignores the press while the right pane is active, as its `disabled()` does.

## Reason

opentui-rust cannot hand a wheel event to another widget, which the box needs to keep the transcript scrolling.
The difference is one action on the first click after the terminal or panel had the focus; the focus rule, which
the user reported (`rs-click-focus`), is the same.
