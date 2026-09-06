---
name: better-colors
description: Helps you build a color system and answer anything about color in your project. You can generate palettes, use semantic tokens, convert between formats, check contrast and more.
---

# Colors

A color system is a small set of ramps, named by role and verified against the backgrounds they actually render on. Most color bugs are system bugs. A value picked in isolation, a token borrowed because it looked right, a pair nobody measured.

Never report a contrast value you did not measure, and never estimate a color you could compute. Colors are one of the few interface concerns with an exact answer, so produce the exact answer.

Contrast requirements belong to `better-accessibility`. Surfaces, shadows and icon color belong to `better-ui`.

## Match the project's color system

Reuse the project's tokens and notation. A second representation added to fix one value makes the palette harder to reason about. A consistent hex system beats hex with `oklch()` scattered through it.

For a new system, `oklch()` is the best default, because its numbers behave the way the ramp rules below describe. Everywhere else, a color library produces the same ramp in the project's own notation ([color-formats.md](color-formats.md)).

## A system is ramps, not colors

One neutral ramp, one accent ramp and only the status ramps the product actually renders. A `warning` ramp nothing imports is maintenance for zero pixels. A second accent hue earns its place only when two things must be distinguishable at a glance.

## Every step has a job

A ramp is not a gradient to pick from by eye. Each step exists because a role needs it: page background, component hover, border, solid fill, body text. Do not generate a step no role consumes. Both the Tailwind `50`–`950` and Radix `1`–`12` conventions map to those roles ([palette-structure.md](palette-structure.md)).

## Name primitives by hue, semantics by role

Primitives name a value (`--blue-500`) and are never applied in a component. Semantic tokens name a job (`--color-text-secondary`), point at a primitive and are the only tier components reference.

That seam is what makes theming possible. Without it, dark mode means auditing every usage to work out which meant "the accent" and which just wanted blue ([token-naming.md](token-naming.md)).

## Use a token only in its role

Never borrow a token because its value is right today. A separator used as a text color works until borders get lighter, and then the text goes with them. If a role has no token, add the token.

## Hold the hue across the ramp

Four properties define a well-formed ramp:

- Steps step evenly in *perceived* lightness, not in whatever the format calls lightness.
- Hue stays constant end to end.
- Vividness peaks mid-ramp and falls off at both ends.
- Steps sit denser at the light end than at the dark end.

Both ends stop short of pure black and white, which cannot carry hue at all. Use a color library rather than eyeballing it ([palette-generation.md](palette-generation.md)).

## One color, one meaning

Use a color for one purpose across the whole interface, treating anything within `15°` of hue as the same color. If the accent means interactive, that hue on static text tells users to click something that is not clickable, and an interactive element rendered neutral misleads just as badly. Color is never the only carrier of meaning, which `better-accessibility` owns.

## Fill exactly one action per view

When filled color encodes primary emphasis, one primary action gets it and peers stay neutral. Put the color on the background, not the label. A filled button reads as primary across the room; accent-colored text on a neutral button reads as a link.

Several colored backgrounds are fine when they encode distinct states or categories rather than competing as peers.

## Measure the rendered pair, then report

Measure a foreground against the background it actually renders on, not the page background. When a pair fails, report the pair, its measured value and the threshold it misses, then leave the colors alone. They are a design decision. Change them only when asked, and remeasure after ([contrast.md](contrast.md)).

## Pick a gradient's interpolation space

The space is a look, not a correctness setting.

- **`in oklab`** is the best default: even brightness, no hue surprises.
- **`in oklch`** travels around the hue wheel rather than through the middle, staying vivid and sweeping every hue between the stops. Reach for it when a two-hue gradient goes gray in the middle.
- **The sRGB default** darkens and mutes the midpoint. It is what most interfaces already have, because it is what you get without asking.

See [color-usage.md](color-usage.md).

## Before you finish

| Mistake | Fix |
| --- | --- |
| A raw value where the project has a token | Reuse or add the role token, in the project's notation |
| An isolated `oklch()` value dropped into a hex codebase | Keep the established notation unless a migration is in scope |
| A primitive like `--blue-500` used directly in a component | Point a semantic token at it |
| Token named for its appearance (`--color-blue-button`) or first use (`--color-sidebar-gray`) | Name it for its role: `--color-accent-solid`, `--color-bg-surface` |
| `--color-primary` meaning the brand and `--color-text-primary` meaning body text | Reserve `accent` for the brand; let `primary` mean "most prominent of its group" |
| Semantic token used outside its role (separator as text) | Add a token for the missing role; never borrow by value |
| Ramp built by varying HSL lightness | Rebuild against perceived lightness with a constant hue |
| Ramp spaced evenly across the full range | Tighten the light end until `50` and `100` read as two surfaces |
| Same saturation number reused across hues | Match the proportion of each hue's own maximum, not the raw value |
| Status hue that collides with the accent hue | Move it until destructive and primary read apart side by side |
| Dark mode made by mechanically reversing the light palette | Reverse as a starting point, then reduce vividness, widen the dark end and recheck every pair |
| `prefers-color-scheme` setting some tokens and a `.dark` class setting others | Pick one switching mechanism and use it throughout |
| Contrast fixed by changing hue | Change lightness, the channel contrast responds to |
| P3 color with no sRGB fallback | Declare the sRGB value first, then override inside `@media (color-gamut: p3)` |

## Reporting

**Severity.** `HIGH` makes content unreadable or assigns a misleading semantic color. `MEDIUM` is a noticeable theme, token, or gamut failure. `LOW` is isolated polish.

**Verification.** Without a browser: token values, the gamut of every declared color, both theme blocks present and contrast computed from the declared token pair. With one: the background actually rendered behind the text, including opacity and any image beneath it, measured in both light and dark. A failing pair is reported, not repainted. Report every check you could not run as `Not verified`.

**Format.** Group findings under the principle each violates, ordered by severity, one row per root cause listing every location it appears in:

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |

`Location` is `path/to/file:line`. `Why` names the principle and the user impact.

End with `Block` when any `HIGH` remains, `Approve` otherwise, leaving the rest in the table as work to do. Never `Approve` coverage you did not inspect. With nothing to report, state "No actionable color findings" and report verification.
