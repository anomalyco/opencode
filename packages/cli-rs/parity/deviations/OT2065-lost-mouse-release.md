# OT2065: a left press after a lost mouse release starts a new gesture

TypeScript: `@opentui/core` 0.8.4. When a terminal or multiplexer drops a mouse release, the next left press joins
the old gesture: it goes to the renderable that was dragged, not the one clicked, a new selection cannot start
("mouse clicks stop working"), and a scroll box keeps auto-scrolling.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2065). A left press while a gesture is held ends that
gesture first, as a release at its last point would (targets get their leaves, no drop), then routes the press:
it starts a new selection, and Ctrl+press still extends. With releases that arrive, both clients behave the same.

Reason: TS's behavior is a Core defect, fixed in the same pull request for Core. The difference goes away when TS
moves to an `@opentui/core` release that includes #2065.
