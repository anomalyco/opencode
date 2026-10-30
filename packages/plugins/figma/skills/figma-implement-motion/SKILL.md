---
name: figma-implement-motion
description: Translates Figma motion and animations into production-ready application code. Use when implementing animation/motion from a Figma design — user mentions "implement this motion", "add animation from Figma", "animate this component", provides a Figma URL whose node is animated, or when `get_design_context` returns motion data or instructs you to call `get_motion_context`.
disable-model-invocation: false
---

# Implement Motion

## Overview

This skill guides translation of Figma animations and transitions into runnable code (motion.dev, CSS keyframes, or framework-specific libraries).

Figma exposes motion through two tools:

- `get_motion_context` — authoritative motion tool. Returns the complete animated-node inventory, precomputed code snippets (CSS `@keyframes` + motion.dev), fallback keyframe bindings when snippets are unavailable, and recursive timeline coordination hints (`timelineCohorts`). **Source of truth for animation data and which node IDs animate.**
- `get_design_context` — the design's **structure**: layout, sizing, assets, styling, Code Connect hints, screenshot context, and sometimes **motion placement markers** on animated elements (`data-node-id`, and on split nodes `data-motion-keys` / `data-motion-wrapper-for` / `data-motion-transform-template`). It may render an animated node as a plain element (`div`, `p`, `span`, etc.) or a motion element (`motion.div`); it does not inline the animation values.

**The two are linked by node id, and that's the whole workflow.** `get_motion_context` tells you which nodes animate and gives the keyframe values, easing, timing, and snippets. `get_design_context` tells you what those nodes look like and where they sit. For every node in `get_motion_context.nodes`, find the matching `data-node-id` in design context and merge the motion into that structure — adding or wrapping a `motion.{tag}` when the structural element is plain. When design context has reused a Figma component, the motion node may also include `fallbackNodeId`; use it only as a fallback after trying the exact `nodeId`.

## Skill Boundaries

- Use this skill when the deliverable is motion code in the user's repository.
- If the user asks to create/edit animations inside Figma itself, switch to [figma-use](../figma-use/SKILL.md) and follow that skill instead.
- This skill currently covers **animations** as emitted by `get_motion_context` (snippets plus fallback keyframe tracks, including preset-authored motion resolved into those forms). Broader interactive variant flows may still need product-specific state handling in code.

## Prerequisites

- Figma MCP server connected and accessible.
- Node ID parsed from the Figma URL the user provides. URL format: `https://figma.com/design/:fileKey/:fileName?node-id=1-2` — extract `fileKey` (the segment after `/design/`) and `nodeId` (the value of the `node-id` query parameter, e.g. `42-15`).
- Target codebase. Motion output format adapts to stack (see [Framework Recommendations](#framework-recommendations)).

## Tool Choice

For motion implementation, use both tools with distinct roles:

| Situation | Tool | Why |
|---|---|---|
| Understanding static structure, assets, styles, Code Connect, or visual layout | `get_design_context` | Gives the component/page code reference and asset URLs you need to place animated nodes correctly. |
| Fetching animation data for any node | `get_motion_context` | Purpose-built for motion and the source of truth for timing, easing, snippets, and keyframes. |
| A node has motion markers (`data-motion-keys`, `data-motion-wrapper-for`) | Markers for split *placement*, `get_motion_context` for *values* | Split markers tell you which tracks go on which element; the keyframes/easing/timing and animated-node inventory come from `get_motion_context`. |

`get_motion_context` accepts `recursive: true` (capped at 500 nodes) when you need descendants' motion in one call.

## Required Workflow

### Step 1: Confirm static design context is available

```
get_design_context(fileKey=":fileKey", nodeId="<node-id>")
```

If `get_design_context` has already been called for this node, reuse that output. If not, call it normally now.

Use it as the **structure of record** — hierarchy, sizing, styling, assets, Code Connect hints, screenshot context, and any motion placement markers it happens to include (Step 3). The animated-node inventory and animation values come from `get_motion_context` (Step 2).

### Step 2: Fetch authoritative motion data

```
get_motion_context(fileKey=":fileKey", nodeId="<node-id>", recursive=true)
```

Response shape (one entry per animated node):

- `codeSnippets` — pre-generated CSS `@keyframes` and motion.dev strings. **Use these directly.** Do not regenerate them from fallback track data.
- `keyframeBindings` — bound keyframe tracks, including preset-derived motion resolved into track data, included only as fallback data when both snippet formats are missing.
- `motionSummary` — one-line-per-field natural-language description of the animation. Present **only when there's no snippet** (keyframe-bindings-only motion codegen couldn't express as CSS/motion.dev). Build from it when present; ignore it whenever a snippet exists.
- `fallbackNodeId` — optional fallback id for matching componentized design context. If `nodeId` is an instance-qualified id such as `I4005:6111;30:8005`, D2R may render the reusable component body with the backing component id instead, such as `4002:3957`. In that case, `fallbackNodeId` is the `data-node-id` to look for if exact `nodeId` lookup fails.

Recursive responses also include `timelineCohorts` — a **top-level** array (not per-node) of nodes sharing one timeline: `{ rootNodeId, durationMs, loopMode: 'once' | 'loop' | 'boomerang', memberNodeIds[] }`. For coordinated multi-node motion, drive all `memberNodeIds` from one shared lifecycle using `durationMs` (÷1000 for seconds) and `loopMode` — don't infer timing from sibling order.

Implementation details that matter for LLMs:

- When a snippet exists, `motionSummary`, `timelineDurationMs`, and `transformOrigin` may be omitted to shrink the payload — the snippet already carries duration + transform-origin (motion.dev `duration` / `style={{ transformOrigin }}`, or CSS `animation` / `transform-origin`) and the cohort carries `durationMs`. A missing field never means "no animation."
- Recursive responses dedupe exact duplicate snippets. A snippet may be replaced with a comment pointing to the first node with identical motion; reuse the same component, variant, class, or constants instead of writing a second animation.
- The MCP server infers CSS vs motion.dev snippets from `clientFrameworks`; if the response only contains one snippet format, adapt that format to the user's stack rather than assuming the other format failed.

### Step 3: Merge static and motion context

- Start from `get_motion_context.nodes`, not from visible `motion.*` tags in the static JSX. **Every returned node is animated.** Match each motion node back to `get_design_context` by exact `nodeId` / `data-node-id` first. If and only if there is no exact match, try `fallbackNodeId` / `data-node-id`. Fall back to node name/type and screenshot position only after both ids fail.
- **Exact id match wins over `fallbackNodeId`.** `fallbackNodeId` points at the backing component id that D2R may emit inside a reusable component. It is shared by every instance of that component. If the exact `nodeId` exists in design context, apply motion there and ignore the fallback. This is critical for root-instance animation: one instance can rotate or move differently from another instance of the same component, and applying that motion to the shared component body would animate all instances incorrectly.
- **Apply each motion node to the matching design-context structure, keyed by `data-node-id`.** The matching `data-node-id` is the structural anchor, not always the final DOM element that receives motion. Use the snippet shape and placement markers to decide whether motion goes on that exact element, a wrapper, an inner element, or an inlined SVG path. `get_design_context` may already emit `motion.{tag}` with values stripped, or it may emit a plain structural element (`div`, `p`, `span`, component root, etc.). If it is plain and the snippet targets the element itself, convert it to the appropriate `motion.{tag}` or add a motion wrapper while preserving the node's text, children, classes/styles, attributes, and `data-node-id`. Load [references/examples-and-anti-examples.md](references/examples-and-anti-examples.md) to see examples of this merging step.
- **Componentized child motion usually matches by fallback.** When design context extracts a Figma instance into a reusable React component, children inside that component body often have backing component ids (`4002:3957`) while motion context reports live instance ids (`I4005:6111;30:8005`). In this case, use `fallbackNodeId` to find the component-body `data-node-id`, but keep the motion scoped to the rendered instance you are implementing. If there are multiple instances and only one has different root motion, exact id matching keeps that per-instance motion separate.
- Split nodes carry a `data-motion-keys` / `data-motion-wrapper-for` marker — see _Handling interleaved transforms_ below.
- **Preserve `display: contents` wrappers — unless the group itself animates.** Layout-transparent group wrappers come through as `contents` (Tailwind `contents`), usually alongside a dead `absolute`/`inset-[…]` (those do nothing on a `contents` box). For a _static_ group, keep `display: contents` and let the children position against the nearest real ancestor — converting the wrapper's `inset` into a positioned box reparents the children to a smaller box, so they render too small / shifted inward. For an _animated_ group (the group node itself has motion), `display: contents` can't carry a transform — replace it with a real positioned wrapper and apply the group motion there. Load [references/gotchas.md](references/gotchas.md) before implementing this case.
- **`get_motion_context` is the complete animated-node inventory.** Some animated nodes render as plain (non-`motion`) elements — component instance roots (plain positioning `<div>`), text (`<p>`), masks — that still carry a `data-node-id`. Walk every node in the motion response and apply its motion to the element with the matching `data-node-id`, wrapping or converting as needed. If an animated node has no element at all in the output (e.g. an animated mask flattened into a static `mask-image`), don't drop it silently — leave a `// TODO: <nodeId> motion unsupported` comment and call it out in your summary.
- If a node appears in motion context but not in the static JSX, add the element needed to represent it — design-context code is a reference, not a complete animation inventory.
- On conflict between design and motion context (timing/easing/animated values), prefer `get_motion_context`.
- **Path-level SVG motion: inline the SVG and animate the real `<path>`.** When `get_motion_context` targets a vector's path (`PATH_TRIM`, `motion.path`, `stroke-dasharray`) but design context renders it as an `<img>`, inline the SVG and apply the snippet to the `<path>`, keeping the layout wrapper. Load [references/svg-and-path-motion.md](references/svg-and-path-motion.md) for the full how-to for this case (motion.path, `pathLength="1"`, wrapper+path layering, CSS path-trim).

#### Handling interleaved transforms

A node with **both** a static base transform and animated transforms is split across nested elements so the two compose correctly instead of fighting: an id-less `motion.div` carrying `data-motion-wrapper-for="<nodeId>"` (the OUTER wrapper) wraps a static-transform div (e.g. `rotate-45` + `hypot()` sizing — or the wrapper itself carries `data-motion-transform-template="<css>"`) which wraps the INNER node (`data-node-id`). Keep the `wrapper > static-transform div > inner` nesting — collapsing it breaks sizing and the base transform.

- **Place tracks by `data-motion-keys`.** The wrapper's `data-motion-keys` (transform tracks — `x`/`y`/`rotate`/`scaleX`/`scaleY`/`skewX`) go on the OUTER wrapper; the inner element's `data-motion-keys` go on the INNER element.
- **Re-apply a `data-motion-transform-template`.** If the wrapper carries one, set `transformTemplate={(_, generated) => "<css> " + generated}` so the animated transform composes on top of that static layout transform.
- **Offset the animated transform by the static base (avoid double rotation).** `get_motion_context` gives the node's _absolute_ transform, which already includes whatever static base those divs apply. A `rotate` snippet of `[45, 125, 125]` over a `rotate-45` base means the wrapper animates the **offset** `[0, 80, 80]` (= absolute − 45), not the absolute — else the 45° applies twice and the element sits at 90° at rest. Tracks with no static base (e.g. `x`/`y` starting at 0) pass through unchanged. See the interleaved-transform example.
- **Keep layout transforms separate from Motion transforms.** For every `motion.*` element that animates `rotate`, `scale`, or `skew`, verify it does not also rely on Tailwind layout transforms such as `-translate-x-1/2` or `-translate-y-1/2` for centering/positioning. Those utilities share the CSS `transform` property that Motion.dev writes inline, so Motion's transform can erase the layout translate. If both are needed, split the element into a static layout wrapper carrying the centering/positioning transform and an inner `motion.*` element carrying animated rotate/scale/opacity, or encode the layout offset in Motion itself (`x: "-50%"`) and keep it present for every keyframe.

### Step 4: Apply the motion in code

- **motion.dev present in snippets?** Use the motion.dev code verbatim for React targets. Import from `motion/react` — unless the codebase already uses another motion library (Framer Motion, React Spring, GSAP), in which case adapt the snippet to it. Load [references/framework-recommendations.md](references/framework-recommendations.md) when adapting to another stack or choosing a library.
- **CSS keyframes present?** Use for vanilla/non-React targets, or when the codebase has no React motion library.
- **No snippets (keyframe-bindings-only)?** Build equivalent motion.dev/CSS from `keyframeBindings` + `motionSummary`, taking loop timing from the cohort's `durationMs` / `loopMode` and reading `transformOrigin` / duration from the structured fields. Rare — snippets are normally present, including for SwiftUI/iOS (which get the CSS format).

### Step 5: Validate

- Read the component's existing motion imports/conventions before adding new ones. If the user already uses Framer Motion / React Spring / anime.js, adapt rather than forcing motion.dev.
- Spot-check one animation runs end-to-end (reload, observe, iterate) before batching changes across many nodes.
- Load [references/gotchas.md](references/gotchas.md), which covers specific bugs and edge cases seen in Figma motion output, and correct any such cases in the generated code.

## Critical Rules

These are the general principles. Specific gotchas (rotation pivots, HOLD semantics, color interpolation, etc.) live in the categorized [references](#references). When a linked reference is mentioned in this skill text and the situation applies, load that file before continuing.

1. **Respect the tool's output's *values*, not its layout.** Preserve the exact timing, easing, keyframe values, and `transformOrigin` from `codeSnippets` — don't regenerate them from `keyframeBindings` or the structured fields when snippets exist (regenerating loses fidelity on custom bezier easings, spring approximations, and overshoot values). `transformOrigin` is **per element**: apply each scaling/rotating node's own — including nested scalers, not just the outer wrapper — or the element pivots from the default center and grows/spins from the wrong corner (see the per-element-`transformOrigin` example). But the snippet is one node's data, not a copy-paste template: when many nodes share it, factor it per Rule 7 instead of pasting the block N times.
2. **Match the user's existing motion stack.** Read the component's imports and any sibling animations before adding dependencies. If the user already has Framer Motion, React Spring, anime.js, GSAP — adapt the output to their stack rather than forcing motion.dev.
3. **Honor `prefers-reduced-motion`.** Any motion added must soften or disable under `@media (prefers-reduced-motion: reduce)` — typically skip the `animate` (render the initial/resting state) or cut the duration to near-zero. This is an accessibility default, not an opt-in.
4. **Validate one animation end-to-end before batching.** Build, reload, and watch one full timeline loop — confirm each animated node appears at the time its keyframe track says it should. "Renders without error" is not "renders correctly." Motion failures compound when you batch — a wrong easing on one node is easy to spot; the same bug across twenty nodes is hours of untangling.
5. **Don't fabricate motion.** If a node has no motion data in the response, leave it static. Do not borrow easing/duration defaults from elsewhere in the design, and do not auto-animate "because the rest of the component is animated."
6. **Don't download an asset just to `Read` it.** `get_design_context` / `get_motion_context` return assets as URLs (`/api/mcp/asset/...`), often SVG. Reference the URL directly where the consumer fetches it (an `<img src>`, CSS `background-image`, an asset import), or `curl` one to inline its contents (e.g. inline the SVG and render via `NSImage(data:)` on SwiftUI). The important exception is path-level SVG motion: if the motion snippet targets a path inside an SVG asset, inline the SVG and animate the real path instead of leaving it behind an `<img>`. Don't download an asset and feed the file to the `Read` tool: SVG isn't a Read-able image format, so the read is rejected and wasted — and a file tool that doesn't detect SVG-as-image can stall the loop on it.
7. **Factor out repeated motion — never copy-paste the snippet per element.** Many nodes usually share the *same* animation differing only by a stagger delay, offset, or target value. Implement the shared motion **once** — a reusable animated component or a `variants` object parameterized by the values that vary — render from a mapped array (`items.map(...)`), and pull repeated literals (durations, easing arrays, offsets) into named constants. The animation's *values* stay verbatim from the snippet (Rule 1); the *code* stays DRY. The same transition object pasted 15+ times (800 lines that should be 150) is a low-quality result — fidelity and maintainability are both graded.

## Framework Recommendations

Rule 2 covers the general posture: prefer the user's existing stack. When none exists, defaults:

- **React**: [motion.dev](https://motion.dev) (the `motion` package). The tool returns motion.dev code directly — use it.
- **Vanilla / non-React web**: CSS `@keyframes` with `animation` shorthand, returned directly by the tool.
- **SwiftUI**: Native `.animation(...)` modifiers, translated from the **CSS** snippet (`get_motion_context` emits no SwiftUI code, but SwiftUI/iOS clients still get the CSS format; fall back to `keyframeBindings` / `motionSummary` / cohort only when snippet-less). **Use only real SwiftUI APIs** — no modifier takes a Figma/CSS easing directly, so load [references/framework-recommendations.md](references/framework-recommendations.md#swiftui-translation), map the easing to its SwiftUI equivalent, and verify rather than invent. This path is evolving; confirm with the user if unsure.

**For established effect classes, prefer a library over hand-rolled CSS.** Effects like glass/glassmorphism, confetti, particle systems, physics-based interactions, and scroll-linked motion have battle-tested library implementations that handle cross-browser quirks, accessibility, and performance far better than generated keyframes. Load [references/framework-recommendations.md](references/framework-recommendations.md) for the full library-by-effect-class table. Surface these as recommendations, not mandates — the user decides.

## Examples

Load [references/examples-and-anti-examples.md](references/examples-and-anti-examples.md) when you need worked examples or failure patterns. It covers the simple merge flow, plain text elements that need `motion.*` added, interleaved static+animated transforms, SVG path-level motion, and anti-examples for DOM rebuilding, node-id/position drift, and missing per-element `transformOrigin`.

## References

Six deep dives, fetched on demand. General frontend concerns (performance, units, accessibility mechanics) are handled by the critical rules above — these references focus on Figma-specific signal only. If this skill names one of these files in an inline instruction, load that file before continuing with that part of the task.

- [references/examples-and-anti-examples.md](references/examples-and-anti-examples.md) — worked examples and failure patterns. Load when applying the merge workflow, handling interleaved transforms, or checking whether a generated implementation has rebuilt the DOM, swapped node positions, or dropped `transformOrigin`.
- [references/gotchas.md](references/gotchas.md) — Figma-specific motion bugs and their fixes. Rotation/scale origin on nested groups, HOLD easing semantics, CUSTOM_SPRING preservation, independent axis scaling ambiguity, color interpolation. Load when troubleshooting unexpected runtime behavior. **Always load [references/motion-lint-rules.md](references/motion-lint-rules.md) alongside this file** — gotcha entries reference specific lint rules that must be surfaced to the user.
- [references/svg-and-path-motion.md](references/svg-and-path-motion.md) — implementing motion that targets an SVG vector path (inline the asset, `motion.path`, `pathLength="1"`, wrapper+path layering, CSS path-trim). Load when a vector's snippet targets the path, not a wrapper transform.
- [references/framework-recommendations.md](references/framework-recommendations.md) — motion.dev, CSS keyframes, SwiftUI defaults, library-by-effect-class table (glass, confetti, particles, physics, scroll-linked). Load before hand-rolling an effect.
- [references/unsupported-and-fallbacks.md](references/unsupported-and-fallbacks.md) — Figma motion features that don't export cleanly today (text animations, path animations, masks/booleans, variants/transitions). Includes video/lottie fallback guidance. Load when the tool response seems incomplete. **Always load [references/motion-lint-rules.md](references/motion-lint-rules.md) alongside this file** — unsupported entries reference specific lint rules that must be surfaced to the user.
- [references/motion-lint-rules.md](references/motion-lint-rules.md) — Linting rules: known export limitations (errors and warnings) that must be surfaced to the user. Load when generating motion code to check whether any active limitations apply.
