# Framework Recommendations

When to use which motion library, and when to reach for a specialized library for a specific effect. Everything here is a **recommendation**, not a mandate — defer to the user's existing stack.

## Default motion frameworks

| Target | Default | Why |
|---|---|---|
| React | [motion.dev](https://motion.dev) (the `motion` package) | Tool emits motion.dev code directly. Supports keyframes, springs, scroll-linked, gesture, layout transitions. |
| Vanilla / non-React web | CSS `@keyframes` with `animation` shorthand | Tool emits CSS directly. No runtime cost. |
| SwiftUI | Native `.animation(...)` modifiers, `withAnimation`, `matchedGeometryEffect` | Tool does not emit SwiftUI code; translate from preset/keyframe data — use only real SwiftUI APIs and map easing per [SwiftUI translation](#swiftui-translation). Path is evolving — confirm with user if uncertain. |
| Android (Compose) | `animate*AsState`, `Animatable`, `updateTransition` | Tool does not yet emit Compose code; translate from preset data. |

If the user's codebase already uses Framer Motion, React Spring, GSAP, anime.js, or a similar library, **adapt the output to that library** rather than pulling in motion.dev. Check imports in the target file before suggesting a new dependency.

## SwiftUI translation

`get_motion_context` does not emit SwiftUI code — you translate from the preset/keyframe data. Two rules:

**1. Emit only SwiftUI APIs that exist.** There is no SwiftUI modifier that takes a Figma (or CSS) easing type directly, so don't reach for an invented convenience method — map to the real animation surface, and verify against Apple's documentation if you're unsure a method exists:

- Timing curves: `.linear(duration:)`, `.easeIn` / `.easeOut` / `.easeInOut(duration:)`, `.timingCurve(_:_:_:_:duration:)`
- Springs: `.spring(duration:bounce:)`, `.interpolatingSpring(mass:stiffness:damping:initialVelocity:)`
- Multi-stop keyframes (iOS 17 / macOS 14+): `KeyframeAnimator` / `KeyframeTimeline` with `LinearKeyframe`, `CubicKeyframe`, `SpringKeyframe`, `MoveKeyframe`

**2. Map the emitted easing to its SwiftUI equivalent.** Translate the easing the tool actually emits (a `cubic-bezier(...)` / `step-end` string, or a spring descriptor) — not a guessed name. These are intended equivalents, not guaranteed-exact transforms:

| Emitted easing | SwiftUI | Notes |
|---|---|---|
| `linear` | `.linear(duration: d)` | Exact. |
| `cubic-bezier(x1, y1, x2, y2)` (Figma BEZIER) | `.timingCurve(x1, y1, x2, y2, duration: d)` | Copy the four control points verbatim. Overshoot curves (points outside `[0,1]`) pass through, but eyeball the result. |
| spring (Figma SPRING / CUSTOM_SPRING) | `.spring(duration: d, bounce: b)` | Figma motion spring reads include `bounce` only. Prefer the emitted bounce value for SwiftUI. If you are starting from physical spring constants, use `figma.motion.physicalSpringToNormalized({ mass, stiffness, damping })` before writing Figma motion. |
| `step-end` (Figma HOLD) | No timing curve — hold the previous value, then snap at the segment boundary (apply the change with `.animation(nil)` / instant, or in `KeyframeAnimator` repeat the value then `MoveKeyframe`). | Mirrors the CSS `step-end` mapping in [gotchas.md](gotchas.md). |

After translating, **verify one animation end-to-end** (SKILL Critical Rule 4) — especially spring feel, which is the most likely to drift across parameterizations.

## Library-by-effect-class

For these effect classes, prefer a well-known library over hand-rolled keyframes. These effects have browser quirks, accessibility considerations, and performance edges that are hard to get right by hand — and that a library handles for you.

| Effect class | Preferred libraries | Notes |
|---|---|---|
| **Glass / glassmorphism** | CSS `backdrop-filter` first; reach for library only for refractive/liquid effects | Simple glass (blur + transparency + border) is a handful of CSS properties. Fancy liquid/refractive glass often needs WebGL or a specialized library. |
| **Confetti / particle bursts** | [`canvas-confetti`](https://github.com/catdad/canvas-confetti), [`react-confetti`](https://github.com/alampros/react-confetti), [`party-js`](https://party.js.org/) | Trying to recreate in keyframes produces 50+ lines of CSS with poor browser compatibility. One-liner with the library. |
| **Persistent particle systems** | [`tsParticles`](https://particles.js.org/), or `three.js` / `react-three-fiber` for 3D | Backgrounds, snow, embers, etc. Hand-rolled keyframes can't fake volume and depth well. |
| **Scroll-linked motion** | `motion/react`'s `useScroll` + `useTransform`; GSAP `ScrollTrigger` for complex sequences | Scroll-linked requires IntersectionObserver or RAF plumbing. Both listed libraries wrap this correctly including resize handling. |
| **Text reveal / typewriter / per-character animation** | [`splitting.js`](https://splitting.js.org/), `motion/react` `<TextReveal>` pattern, `anime.js` text plugins | Hand-rolling per-character animation is fragile (breaks on ligatures, RTL, dynamic content). |
| **SVG path morphing** | GSAP `MorphSVGPlugin`, [`flubber`](https://github.com/veltman/flubber), `motion/react` path utilities | Interpolating between arbitrary SVG paths is nontrivial math. Libraries handle point-count mismatch. |
| **SVG path drawing (stroke reveal)** | `motion/react` `<motion.path>` + `pathLength`; GSAP `DrawSVGPlugin`; plain CSS `stroke-dasharray`/`stroke-dashoffset` for simple cases | Simple stroke reveal is a CSS one-liner; complex or segment-synced needs a library. |
| **Drag / gesture interactions** | `motion/react`'s `drag` prop; `@use-gesture/react` | Touch/pointer handling across devices is a mess. These libraries normalize it. |
| **Spring physics** | Use the user's existing motion library's spring primitive — never hand-roll as cubic-bezier | `motion.dev`, `react-spring`, `framer-motion` all have spring primitives. Approximating as bezier loses the physics model. |

## Anti-patterns

- **Don't recreate `backdrop-filter` with nested filters or canvases** when the browser supports it natively. Safari still has partial support on some OS versions — feature-detect, don't polyfill with DOM tricks.
- **Don't chain 50+ CSS `@keyframes` to fake particles.** If the effect requires dozens of independently-moving elements, reach for canvas or a particle library.
- **Don't approximate a spring with a cubic-bezier** unless the user explicitly asks. Springs are physics; beziers are shape. The feel is different and the tool's output will preserve the distinction.
- **Don't add `will-change: transform` to everything.** It forces GPU layer promotion and hurts memory. Apply only to elements actively animating, and remove after.

## Related

- Back to [../SKILL.md](../SKILL.md)
- [gotchas.md](gotchas.md) for specific Figma motion bugs
- [unsupported-and-fallbacks.md](unsupported-and-fallbacks.md) for features without clean export paths
