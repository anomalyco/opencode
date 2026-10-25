# Examples and Anti-Examples

Worked end-to-end examples, each pairing the `get_design_context` structure with the `get_motion_context` data (joined by `data-node-id`) and the resulting code.

## Simple example

A single element with all of its motion on one tag. `get_design_context` gives the structure; `get_motion_context` gives the animation for that node id:

```tsx
// get_design_context — structure
<div data-node-id="1:379">
  <motion.div data-node-id="1:380"> <img src={imgVector} /> </motion.div>
</div>

// get_motion_context for 1:380 — animation
<motion.svg initial={{ rotate: 0, scale: 1 }} animate={{ rotate: [0, 360], scale: [1, 2] }}
  transition={{ duration: 10, ease: [0.5, 0, 0.5, 1], repeat: Infinity }} />
```

Merge the snippet's `initial`/`animate`/`transition` onto the node's element, keeping its structure — declaratively, values straight from the snippet:

```tsx
<div data-node-id="1:379">
  <motion.div
    data-node-id="1:380"
    initial={{ rotate: 0, scale: 1 }}
    animate={{ rotate: [0, 360], scale: [1, 2] }}
    transition={{ duration: 10, ease: [0.5, 0, 0.5, 1], repeat: Infinity }}
  >
    <img src={imgVector} />
  </motion.div>
</div>
```

## Plain text element example

Some animated nodes have no `motion.*` marker in `get_design_context`. Treat `get_motion_context` as the source of truth: if it returns motion for a node id, find the matching `data-node-id` in the static structure and make that element motion-capable without changing its text, spans, classes, or attributes.

```tsx
// get_design_context — plain text element, NO motion marker, yet 16:2894 animates
<p
  data-node-id="16:2894"
>
  <span>{`+4.3% `}</span>
  <span>vs last week</span>
</p>

// get_motion_context for 16:2894 — scale animation
<motion.div
  initial={{ scaleX: 1, scaleY: 1 }}
  animate={{ scaleX: [1, 1.18, 1, 1], scaleY: [1, 1.18, 1, 1] }}
  transition={{
    scaleX: { duration: 2, times: [0, 0.175, 0.375, 1], ease: ["easeOut", "easeInOut", "linear"], repeat: Infinity },
    scaleY: { duration: 2, times: [0, 0.175, 0.375, 1], ease: ["easeOut", "easeInOut", "linear"], repeat: Infinity },
  }}
/>
```

```tsx
// result — keep the text structure, convert the matching element to motion.p
<motion.p
  data-node-id="16:2894"
  initial={{ scaleX: 1, scaleY: 1 }}
  animate={{ scaleX: [1, 1.18, 1, 1], scaleY: [1, 1.18, 1, 1] }}
  transition={{
    scaleX: { duration: 2, times: [0, 0.175, 0.375, 1], ease: ["easeOut", "easeInOut", "linear"], repeat: Infinity },
    scaleY: { duration: 2, times: [0, 0.175, 0.375, 1], ease: ["easeOut", "easeInOut", "linear"], repeat: Infinity },
  }}
>
  <span>{`+4.3% `}</span>
  <span>vs last week</span>
</motion.p>
```

If the target framework or DOM semantics make `motion.p` awkward, wrap the `<p>` in a layout-neutral `motion.div` instead — but keep the `data-node-id` associated with the animated node and do not rewrite the spans or text content.

## Interleaved transform example

A vector with a static 45° base rotation *and* an animated rotate/translate. `get_design_context` nests three layers — an animated wrapper, a static-transform + sizing div, and the node — and the wrapper carries the markers:

```tsx
// get_design_context (layout classes trimmed; the static rotate-45 + hypot sizing are the point)
<motion.div
  data-motion-wrapper-for="1:356"
  data-motion-keys="rotate,x,y" {/* all the motion lives on this wrapper */}
>
  <div className="rotate-45 w-[hypot(…)] h-[hypot(…)]"> {/* static rotation + sizing — NOT a motion node */}
    <div data-node-id="1:356"> <img src={imgVector} /> </div>
  </div>
</motion.div>

// get_motion_context for 1:356 — ABSOLUTE (rotate starts at the 45° base)
animate={{ rotate: [45, 125, 125], x: [0, 200, 200], y: [0, 0, 0] }} transition={{ … }}
```

Keep all three layers and put the wrapper's tracks (`rotate,x,y`) on the wrapper — but the middle div *already* applies the 45° statically, and `get_motion_context`'s `rotate` is absolute (also starts at 45). Subtract the base so the wrapper animates the **offset** (`[0, 80, 80]` = `[45,125,125] − 45`); `x`/`y` have no static base so they pass through:

```tsx
<motion.div
  data-motion-wrapper-for="1:356"
  initial={{ rotate: 0, x: 0, y: 0 }}
  animate={{ rotate: [0, 80, 80], x: [0, 200, 200], y: [0, 0, 0] }} {/* rotate offset by the 45° base */}
  transition={{ /* from the snippet */ }}
>
  <div className="rotate-45 w-[hypot(…)] h-[hypot(…)]"> {/* static 45° base + sizing — kept verbatim */}
    <div data-node-id="1:356"> <img src={imgVector} /> </div>
  </div>
</motion.div>
```

Two misses to avoid: (1) collapsing the middle `rotate-45` + sizing div — the vector then sizes to the wrapper's box (too big) and loses its base rotation; (2) putting the absolute `rotate: [45, …]` on the wrapper on top of that static 45° — it double-rotates to 90° at rest. Keep every static div, and offset the wrapper's animated transform by whatever base those divs apply.

## SVG example

Path-level motion — inline the SVG asset and animate the real `<path>`. Two independent questions decide where the motion goes: does the **wrapper transform** animate (→ inlined `<svg>` becomes `motion.svg`) and does the **path geometry** animate (→ inlined `<path>` becomes `motion.path`). They compose.

The case to internalize: a node that is a **plain `<div>` with no motion marker** in `get_design_context` but still animates — because the motion targets the path *inside* the opaque `<img>`, which the markers can't see. Only `get_motion_context` reveals it, so walk every node there:

```tsx
// get_design_context — plain div, NO motion marker, yet 1:51 animates
<div data-node-id="1:51"><img src={imgVector2} /></div>

// get_motion_context for 1:51 — a bare motion.path (path-trim draw)
<motion.path pathLength={1} initial={{ strokeDasharray: '0 1', strokeDashoffset: 0 }}
  animate={{ strokeDasharray: ['0 1', '1 1', '1 1'] }}
  transition={{ duration: 2, ease: 'linear', times: [0, 0.75, 1], repeat: Infinity }} />
```

```tsx
// result — inline the SVG; svg stays plain, only the <path> becomes motion.path
<div data-node-id="1:51">
  <svg viewBox="0 0 341.469 102.312">
    <motion.path
      d="M15.7347 82.6128…" pathLength={1}
      initial={{ strokeDasharray: '0 1', strokeDashoffset: 0 }}
      animate={{ strokeDasharray: ['0 1', '1 1', '1 1'] }}
      transition={{ duration: 2, ease: 'linear', times: [0, 0.75, 1], repeat: Infinity }}
    />
  </svg>
</div>
```

Full worked set — wrapper-only (`motion.svg` opacity), path-only (above), and both layers together — with the inlining mechanics (`pathLength="1"`, preserving `<defs>`, wrapper+path layering): [svg-and-path-motion.md#worked-examples](svg-and-path-motion.md#worked-examples).

## Anti-example: don't rebuild the DOM

`get_design_context` is the structure of record — here a wrapper node around the vector (classNames trimmed; the point is the hierarchy and the ids):

```tsx
<div data-node-id="1:347">
  <motion.div data-node-id="1:348"> {/* the animated node */}
    <img src={imgVector} />
  </motion.div>
</div>
```

`get_motion_context` is the animation for node `1:348` (a `skewX` on the vector):

```jsonc
{ "nodeId": "1:348", "codeSnippets": { "motionDev":
  "<motion.svg initial={{ skewX: 0 }} animate={{ skewX: [0, 28.648, 28.648] }} transition={{ skewX: { duration: 10, times: [0, 0.3, 1], ease: [[0.5, 0, 0.5, 1], 'linear'], repeat: Infinity } } }} />" } }
```

What NOT to do — flatten the tree and animate one element:

```tsx
// ❌ the 1:348 wrapper is gone, data-node-ids dropped, motion put straight on the img
<div>
  <motion.img src="/vector.svg" initial={{ skewX: 0 }} animate={{ skewX: [0, 28.648, 28.648] }} transition={/* … */} />
</div>
```

Why it's wrong: `get_design_context` already gives the correct DOM — keep its hierarchy and `data-node-id`s, and layer the motion *onto* that tree. The `motion.div` wrapper (`1:348`) must survive; the only change is inlining the vector as an `<svg>` (the snippet returns `motion.svg`, so animate the inlined svg, not an `<img>`) and attaching the snippet's `initial`/`animate`/`transition` verbatim.

## Anti-example: keep each node's position bound to its id

A rotating group with two mirror-image copies of a vector — a left and a right one. `get_motion_context` animates the group *and* the RIGHT copy (`1:245`). `get_design_context` puts each copy where it belongs via its `inset` (Tailwind `inset-[top right bottom left]`, so the 4th value is the left edge):

```tsx
<motion.div data-node-id="1:243"> {/* group — rotates, so both children rotate with it */}
  <motion.div className="inset-[8.53%_4.32%_8.3%_52.53%]" data-node-id="1:245"> {/* left edge 52.53% = RIGHT; also rotates */}
    <img src={imgVector1} />
  </motion.div>
  <div className="inset-[8.53%_52.45%_8.3%_4.4%]" data-node-id="1:246"> {/* left edge 4.4% = LEFT; static */}
    <img src={imgVector2} />
  </div>
</motion.div>
```

What NOT to do — swap the two siblings' positions while transcribing:

```tsx
// ❌ 1:245 (the animated node) given the LEFT inset, 1:246 given the RIGHT inset
<motion.div style={{ left: "4.4%", right: "52.53%" }} data-node-id="1:245"> … </motion.div> {/* now on the left */}
<div        style={{ left: "52.45%", right: "4.32%" }} data-node-id="1:246"> … </div>        {/* now on the right */}
```

The motion still attaches to the right node id (`1:245`), but its position drifted to the sibling's — so the WRONG copy does the extra rotation. Mirror-image pairs (left/right, top/bottom) are exactly where this slips.

Why it's wrong / do instead: take every node's values from `get_design_context` — position, sizing, structure, attributes, text — and keep them bound to the SAME `data-node-id` the motion targets. `get_design_context` is the source of truth for everything except the animation; only the motion values come from `get_motion_context`. Keep the *values* verbatim, but adapt the styling *format* to the target project — `get_design_context` returns React + Tailwind as a reference, so convert the Tailwind classes to the project's styling (e.g. inline styles / its CSS) when it has no Tailwind, without changing what they encode. Don't infer placement from element order or `data-name`, and don't re-derive any value — the animated node must keep its own design-context output, or the right motion plays on the wrong element.

## Anti-example: `transformOrigin` is per element

A scaling icon where `get_motion_context` returns a `transformOrigin` on _each_ scaling node — here both the outer group and the inner icon grow from the bottom-right:

```tsx
<motion.svg data-node-id="1:3576" style={{ transformOrigin: '100% 100%' }} animate={{ scaleX: [0,1,1], scaleY: [0,1,1] }} … />
<motion.svg data-node-id="1:3577" style={{ transformOrigin: '100% 100%' }} animate={{ scaleX: [0,0,1,1], scaleY: [0,0,1,1] }} … />
```

What NOT to do — apply `transformOrigin` to the outer element but forget the nested one:

```tsx
<motion.div data-node-id="1:3576" style={{ transformOrigin: "100% 100%" }} animate={{ scaleX: [0,1,1], scaleY: [0,1,1] }}>
  {/* ❌ no transformOrigin → defaults to center 50% 50%, so this icon grows from the wrong corner */}
  <motion.div data-node-id="1:3577" animate={{ scaleX: [0,0,1,1], scaleY: [0,0,1,1] }}>
    …
  </motion.div>
</motion.div>
```

Apply each node's own `transformOrigin` (`100% 100%` on both here) so every scaler grows from the corner the snippet specifies. A scale or rotate with no `transformOrigin` pivots from the default center — the growth/spin starts at the wrong corner even though the keyframe values are correct.
