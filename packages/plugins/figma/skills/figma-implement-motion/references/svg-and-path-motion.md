# SVG and Path-Level Motion

How to implement motion that targets an SVG vector — especially *path-level* motion (draw/erase reveals, path trims), where the animation lives on the `<path>` itself, not on a wrapper transform.

Consult this when `get_motion_context` returns a snippet for a vector node whose `get_design_context` representation is an `<img src={…}>` asset, or whose snippet uses `motion.path` / `pathLength` / `pathOffset` / `stroke-dasharray`.

## Inline the SVG before applying path-level motion

`get_design_context` often represents a vector as an asset URL rendered through `<img src={imgVectorUrl} />`, while `get_motion_context` targets the original vector node and returns snippets for the SVG path itself (for example `PATH_TRIM`, `motion.path`, or CSS `stroke-dasharray`). When the motion targets the path:

- Remove the `<img>` and fetch/inline the SVG markup from the asset URL (`curl <asset-url>`; don't pass the bytes to the Read tool — see the asset rule in SKILL.md).
- Preserve the surrounding layout wrapper from design context (position, sizing, `data-node-id`).
- Apply the motion snippet to the actual inline `<path>` element that corresponds to the animated node.

Whole-element transforms (rotate/scale/translate on the vector as a unit) do **not** need inlining — animate the existing wrapper. Inlining is only for motion that targets the path geometry.

## motion.dev output

Convert the inline SVG path to `motion.path`, preserve its `d`, stroke, fill, and `viewBox` data, and merge the returned `initial`, `animate`, and `transition` props onto that path.

When motion.dev returns **both** an animated SVG wrapper and animated child paths, preserve both layers: merge wrapper-level `initial`/`animate`/`transition` onto the inline `motion.svg`, and merge path-level trim/draw props onto the matching `motion.path`. Do not collapse wrapper transform motion into the path or drop either animation layer.

## CSS path-trim output

Add `pathLength="1"` to the SVG `<path>` when the snippet says it is required, place the returned animation styles on that path (class or inline style), and include the returned `@keyframes` exactly once.

`stroke-dasharray: 0 1` / `1 1` only works as normalized path trim when `pathLength="1"` is present: it normalizes the path's measured length to `1`, so the dash values map to a fraction of the path (0 = start, 1 = whole path) regardless of the path's real length or `viewBox`. Without it, `stroke-dasharray` is in user units and the reveal will be wrong across different path sizes.

## Worked examples

Real vectors from one chart card. Each is a single-`<path>` SVG, so the inlined structure is identical — only the motion *target* differs. Two independent questions decide where the motion goes:

- **Does the wrapper transform animate?** (opacity / x / y / scale / rotate on the vector as a unit) → the inlined `<svg>` becomes `motion.svg` and carries those props.
- **Does the path geometry animate?** (path-trim / draw / `stroke-dasharray` / `motion.path`) → the inlined `<path>` becomes `motion.path` and carries those props.

They compose: a vector can hit neither, one, or both. The three cases below are wrapper-only, path-only, and both.

The snippets below strip the layout classes (positioning, sizing, `inset` wrappers) to keep the focus on the SVG — preserve all of that from `get_design_context` verbatim. The only changes that matter here: replace the `<img>` with the inlined SVG (keep `viewBox`, `preserveAspectRatio`, and any `<defs>` the path references by id), and move the motion onto the `<svg>` and/or `<path>`.

### Wrapper animates, path doesn't — `motion.svg`, plain `<path>`

`get_motion_context` returns a `motion.svg` (opacity on the whole vector), so the design-context `motion.div` wrapper is the wrong place — apply the values to the inlined `motion.svg`:

```tsx
// get_design_context — the node is a motion.div, but the real animated element is the svg
<motion.div data-node-id="1:50"><img src={imgVector3} /></motion.div>

// get_motion_context for 1:50
<motion.svg initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1, 1] }}
  transition={{ opacity: { duration: 2, times: [0, 0.1, 0.75, 1],
    ease: ["linear", [0.25, 1, 0.5, 1], "linear"], repeat: Infinity } }} />
```

```tsx
// result — wrapper becomes a plain div; the inlined svg carries the motion
<div data-node-id="1:50">
  <motion.svg
    viewBox="0 0 310 117.156"
    initial={{ opacity: 0 }}
    animate={{ opacity: [0, 0, 1, 1] }}
    transition={{ opacity: { duration: 2, times: [0, 0.1, 0.75, 1], ease: ["linear", [0.25, 1, 0.5, 1], "linear"], repeat: Infinity } }}
  >
    <path d="M15.5769 49.7441…" />
  </motion.svg>
</div>
```

### Path animates, wrapper doesn't — plain `<svg>`, `motion.path`

The teaching case: in `get_design_context` this node is a **plain `<div>` with no motion marker** — yet it animates. Path-level motion lives inside the opaque `<img>`, so the gutting can't mark it; only `get_motion_context` reveals it. **Never read a plain (un-`motion`) element as "static" — walk every node in the motion response.** `get_motion_context` returns just a `motion.path` (no wrapper props), so only the inlined `<path>` becomes `motion.path`:

```tsx
// get_design_context — a plain div, no motion marker, yet 1:51 animates
<div data-node-id="1:51"><img src={imgVector2} /></div>

// get_motion_context for 1:51
<motion.path pathLength={1} initial={{ strokeDasharray: '0 1', strokeDashoffset: 0 }}
  animate={{ strokeDasharray: ['0 1', '1 1', '1 1'] }}
  transition={{ duration: 2, ease: 'linear', times: [0, 0.75, 1], repeat: Infinity }} />
```

```tsx
// result — svg stays plain; only the path animates. Keep <defs> the path references
<div data-node-id="1:51">
  <svg viewBox="0 0 341.469 102.312">
    <defs>{/* filter0_f_0_31 — preserve it */}</defs>
    <motion.path
      d="M15.7347 82.6128…" filter="url(#filter0_f_0_31)"
      pathLength={1}
      initial={{ strokeDasharray: '0 1', strokeDashoffset: 0 }}
      animate={{ strokeDasharray: ['0 1', '1 1', '1 1'] }}
      transition={{ duration: 2, ease: 'linear', times: [0, 0.75, 1], repeat: Infinity }}
    />
  </svg>
</div>
```

### Both animate — `motion.svg` *and* `motion.path`

`get_motion_context` returns a `motion.svg` (x/y slide) wrapping a `motion.path` (path-trim). Keep both layers: the inlined `<svg>` becomes `motion.svg` with the wrapper transform, the `<path>` becomes `motion.path` with the trim. Don't collapse the path motion into the wrapper or drop either:

```tsx
// get_design_context
<motion.div data-node-id="1:52"><img src={imgVector1} /></motion.div>

// get_motion_context for 1:52
<motion.svg initial={{ x: -19, y: -80 }} animate={{ x: [-19, -19, -19], y: [-80, -47, -47] }} transition={…}>
  <motion.path pathLength={1} initial={{ strokeDasharray: '0 1', strokeDashoffset: 0 }}
    animate={{ strokeDasharray: ['0 1', '1 1', '1 1'] }} transition={…} />
</motion.svg>
```

```tsx
// result — both layers animate
<div data-node-id="1:52">
  <motion.svg
    viewBox="0 0 311.469 72.3117"
    initial={{ x: -19, y: -80 }}
    animate={{ x: [-19, -19, -19], y: [-80, -47, -47] }}
    transition={{
      x: { duration: 2, times: [0, 0.9, 1], ease: "linear", repeat: Infinity },
      y: { duration: 2, times: [0, 0.9, 1], ease: "linear", repeat: Infinity },
    }}
  >
    <motion.path
      d="M0.734678 67.6128…"
      pathLength={1}
      initial={{ strokeDasharray: '0 1', strokeDashoffset: 0 }}
      animate={{ strokeDasharray: ['0 1', '1 1', '1 1'] }}
      transition={{ duration: 2, ease: 'linear', times: [0, 0.75, 1], repeat: Infinity }}
    />
  </motion.svg>
</div>
```

## When the snippet doesn't round-trip

Some path-trim animations (misaligned start/end trim times, non-integer wraparound, out-of-range `pathOffset`, trim combined with animated color/stroke-weight) don't export cleanly. See [unsupported-and-fallbacks.md#path-trims-stroke-dashoffset-reveals-with-unsupported-timing](unsupported-and-fallbacks.md) for the fallback (preserve the SVG, simplify the dash animation, or recommend a library).

## Related

- Back to [../SKILL.md](../SKILL.md)
- [unsupported-and-fallbacks.md](unsupported-and-fallbacks.md) — path-trim limitations and fallbacks
- [framework-recommendations.md](framework-recommendations.md) — SVG path-drawing libraries
