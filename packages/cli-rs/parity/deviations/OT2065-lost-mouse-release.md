# OT2065: a left press after a lost mouse release starts a new gesture

TypeScript: `@opentui/core` 0.8.4. When a terminal or multiplexer drops a mouse release, the next left press joins
the old gesture. In `parity/scenarios/OT/lost-release.pty.ts` the prompt holds `copy this text now`; a drag over
`copy` loses its release, then a press, drag and release go over `text`. TS selects and copies nothing, the cursor
stays where the first drag left it, and `Z` goes there: `copyZ this text now`.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2065). The press ends the old drag as a release at its
last point would, then starts a new selection: `text` is selected and copied (the "Copied to clipboard" toast and an
OSC 52 write), and `Z` replaces it: `copy this Z now`. With releases that arrive, both clients behave the same.

Reason: TS's behavior is a Core defect, fixed in the same pull request for Core. The difference goes away when TS
moves to an `@opentui/core` release that includes #2065.
