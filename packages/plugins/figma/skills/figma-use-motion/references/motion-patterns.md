# Motion Patterns

Use this reference when a `use_figma` task adds, edits, removes, or inspects Motion animation on Figma design nodes.

This is for Plugin API code executed through the MCP `use_figma` tool. Follow the main `figma-use` rules: use top-level `await`, use `return` for output, do not call `figma.closePlugin()`, do not use `figma.notify()`, and return every mutated node ID. Runtime gating (`metronome`) and the exposed-API surface are summarised in [figma-use-motion/SKILL.md](../SKILL.md) — bail closed on `"not a supported API"`.

**`node.animations` reflects manual-keyframe tracks only at present.** Applying an animation style writes its metadata to `node.animationStyles` but the style-generated tracks are not materialized into `node.animations` yet. Validate style writes by reading back `node.animationStyles`, not `node.animations`.

## Standard Workflow

1. Inspect the target nodes first. Check selection, parentage, existing `manualKeyframeTracks`, existing `animationStyles`, and `timelines`.
2. Pick the animation type:
   - If the user explicitly asks for keyframes or an animation style, use the requested type.
   - Default to manual keyframes for new motion. They are the most direct way to express node-specific timing, choreography, fills/strokes/effects, and custom keyframe values.
   - Use animation styles when the requested motion matches an existing reusable style, when the design system has motion variables/tokens you should bind to, or when matching existing style usage on neighbouring nodes.
3. Preserve static design data. Do not create, delete, detach, or restructure nodes unless the user asked for it.
4. Write the smallest useful motion change. Spread existing tracks or styles unless intentionally replacing them.
5. Extend the containing timeline with `setTimelineDuration` only when the animation exceeds the current duration. Do not shorten it unless asked.
6. Validate by returning the updated track or style data and the mutated node IDs.

Do not animate top-level frames that are direct children of the page. Animate their children or descendants instead.

## Inspect Motion State

Use a read-only script before making changes:

```js
const nodes = figma.currentPage.selection;

return nodes.map((node) => ({
  id: node.id,
  name: node.name,
  type: node.type,
  parentType: node.parent?.type ?? null,
  timelines: node.timelines,
  manualKeyframeTracks: node.manualKeyframeTracks,
  animationStyles: node.animationStyles,
}));
```

For a known node ID:

```js
const node = await figma.getNodeByIdAsync("123:456");

return {
  id: node.id,
  name: node.name,
  timelines: node.timelines,
  manualKeyframeTracks: node.manualKeyframeTracks,
  animationStyles: node.animationStyles,
};
```

## Manual Keyframes

Manual keyframes are stored on `node.manualKeyframeTracks`. Top-level keys are animatable fields. A track contains a `keyframes` array, and each keyframe describes the value at a timeline position.

When creating a new manual keyframe track, omit `baseValue`; the API derives it from the node. When editing an existing track, preserve the existing track `id`, `baseValue`, and keyframe `id`s unless the user explicitly asks to replace that data.

Timeline positions are in seconds.

```js
{
  timelinePosition: 1,
  value: { type: "FLOAT", value: 120 },
  easing: { type: "EASE_OUT" }
}
```

The easing on a keyframe controls how to animate from the previous keyframe to this keyframe. See [motion-easing.md](motion-easing.md) for the full easing object shape (including `CUSTOM_CUBIC_BEZIER`, `CUSTOM_SPRING`, and `HOLD`).

### Animatable Fields

The Plugin API accepts only the public allowlist below. Do not use generated/internal scenegraph field names even if they appear in codegen types: fields such as `SHEAR`, `SCROLL_OFFSET_X`, `SCROLL_OFFSET_Y`, `DISSOLVE_PROGRESS`, `MEDIA_CURRENT_TIME`, 3D transform fields, polygon/arc fields, and `VARIANT_PROPERTIES` intentionally throw.

Two semantic categories. Read the "Compose with" column before writing values — these are the only differences agents trip on.

**Transform fields — compose with the node's existing transform.** A value of `0` (or `1` for scale) means "no change from the node's resting transform". The value you write is added to (or multiplied with) the current value, not substituted for it.

| Field | Value | Compose with | Notes |
|---|---|---|---|
| `TRANSLATION_X` | `FLOAT` pixels | additive (neutral `0`) | Positive moves right. |
| `TRANSLATION_Y` | `FLOAT` pixels | additive (neutral `0`) | Positive moves down. |
| `TRANSLATION_XY` | `VECTOR` pixels | additive (neutral `{ x: 0, y: 0 }`) | Use when X and Y should stay in one track. |
| `ROTATION` | `FLOAT` degrees | additive (neutral `0`) | Positive rotates counter-clockwise, matching `node.rotation`; negative rotates clockwise. Unlike `node.rotation`, motion rotation is not normalized to -180..180, so use `-360` for one full clockwise turn *on top of* the resting transform. |
| `SCALE_X`, `SCALE_Y`, `SCALE_XY` | `FLOAT` or `VECTOR` multiplier | multiplicative (neutral `1` or `{ x: 1, y: 1 }`) | `1` = no scale change. `0.5` halves the node's current scale; `2` doubles it. |

**Absolute fields — replace the node's value within the animation window.**

| Field | Value | Notes |
|---|---|---|
| `OPACITY` | `FLOAT` 0-1 | `0` transparent, `1` fully opaque, matching `node.opacity`. |
| `CORNER_RADIUS` | `FLOAT` pixels | `0` is no rounding. |
| `RECTANGLE_TOP_LEFT_CORNER_RADIUS`, `RECTANGLE_TOP_RIGHT_CORNER_RADIUS`, `RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS`, `RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS` | `FLOAT` pixels | Per-corner radius fields for rectangles. |
| `STROKE_WEIGHT`, `BORDER_TOP_WEIGHT`, `BORDER_BOTTOM_WEIGHT`, `BORDER_LEFT_WEIGHT`, `BORDER_RIGHT_WEIGHT` | `FLOAT` pixels | Stroke/border weights. |
| `STACK_SPACING`, `STACK_COUNTER_SPACING`, `STACK_PADDING_LEFT`, `STACK_PADDING_TOP`, `STACK_PADDING_RIGHT`, `STACK_PADDING_BOTTOM`, `GRID_ROW_GAP`, `GRID_COLUMN_GAP` | `FLOAT` pixels | Layout spacing and padding fields. |
| `PATH_TRIM_START`, `PATH_TRIM_END` | `FLOAT` 0-1 | Path trim start/end. |
| `WIDTH`, `HEIGHT` | `FLOAT` pixels | Must be positive. Not valid for groups and vector shapes. |

Fill color animation uses `manualKeyframeTracks.fills` by paint index; stroke color animation uses `manualKeyframeTracks.strokes`, and effect animation uses `manualKeyframeTracks.effects`. See the indexed keyframe sections below.

### Pre-first and post-last keyframe behaviour

The first keyframe's value **holds back to `t=0`** — the field stays at that value from the start of the timeline until the first keyframe is reached. The last keyframe's value holds forward to the end of the timeline. You don't need a redundant `t=0` keyframe just to "pin" the resting state.

```js
// Track starts animating at t=2s. No explicit t=0 keyframe needed —
// OPACITY holds at 0 from t=0 until the first keyframe.
{
  OPACITY: {
    keyframes: [
      { timelinePosition: 2, value: { type: "FLOAT", value: 0 } },
      { timelinePosition: 2.5, value: { type: "FLOAT", value: 1 }, easing: { type: "EASE_OUT" } },
    ],
  },
}
```

This also means the easing on the first keyframe is unused (there's no previous keyframe to ease from).

### Add A Translation Track

```js
const node = await figma.getNodeByIdAsync("123:456");
const existing = node.manualKeyframeTracks ?? {};
const duration = 1;
const mutatedNodeIds = [node.id];

node.manualKeyframeTracks = {
  ...existing,
  TRANSLATION_X: {
    keyframes: [
      {
        timelinePosition: 0,
        easing: { type: "LINEAR" },
        value: { type: "FLOAT", value: 0 },
      },
      {
        timelinePosition: duration,
        easing: { type: "EASE_OUT" },
        value: { type: "FLOAT", value: 120 },
      },
    ],
  },
};

const [timeline] = node.timelines;
if (timeline && timeline.duration < duration) {
  node.setTimelineDuration(timeline.id, duration);
  mutatedNodeIds.push(timeline.id);
}

return {
  mutatedNodeIds,
  manualKeyframeTracks: node.manualKeyframeTracks,
  timelines: node.timelines,
};
```

Prefer `applyManualKeyframeTrack` when adding or replacing a single track; it avoids reconstructing unrelated tracks:

```js
const node = await figma.getNodeByIdAsync("123:456");
const duration = 1;
const mutatedNodeIds = [node.id];

node.applyManualKeyframeTrack(
  { type: "PROPERTY", name: "TRANSLATION_X" },
  {
    keyframes: [
      { timelinePosition: 0, value: { type: "FLOAT", value: 0 } },
      { timelinePosition: duration, easing: { type: "EASE_OUT" }, value: { type: "FLOAT", value: 120 } },
    ],
  },
);

const [timeline] = node.timelines;
if (timeline && timeline.duration < duration) {
  node.setTimelineDuration(timeline.id, duration);
  mutatedNodeIds.push(timeline.id);
}

return {
  mutatedNodeIds,
  manualKeyframeTracks: node.manualKeyframeTracks,
  timelines: node.timelines,
};
```

### Edit An Existing Track

When editing existing manual keyframes, preserve track `id` values and keyframe `id` values for anything that should continue to exist.

```js
const node = await figma.getNodeByIdAsync("123:456");
const existing = node.manualKeyframeTracks ?? {};
const opacityTrack = existing.OPACITY;

if (!opacityTrack) {
  throw new Error("Node has no OPACITY manual keyframe track.");
}

node.manualKeyframeTracks = {
  ...existing,
  OPACITY: {
    ...opacityTrack,
    keyframes: opacityTrack.keyframes.map((keyframe, index) =>
      index === 1
        ? { ...keyframe, value: { type: "FLOAT", value: 0.75 } }
        : keyframe,
    ),
  },
};

return {
  mutatedNodeIds: [node.id],
  manualKeyframeTracks: node.manualKeyframeTracks,
};
```

### Remove Tracks

Remove one track by omitting it when writing the object back:

```js
const node = await figma.getNodeByIdAsync("123:456");
const { ROTATION, ...rest } = node.manualKeyframeTracks ?? {};
node.manualKeyframeTracks = rest;

return {
  mutatedNodeIds: [node.id],
  removedTrack: "ROTATION",
  manualKeyframeTracks: node.manualKeyframeTracks,
};
```

Or remove one track with the helper:

```js
const node = await figma.getNodeByIdAsync("123:456");
node.removeManualKeyframeTrack({ type: "PROPERTY", name: "ROTATION" });

return {
  mutatedNodeIds: [node.id],
  manualKeyframeTracks: node.manualKeyframeTracks,
};
```

Remove all manual tracks:

```js
const node = await figma.getNodeByIdAsync("123:456");
node.manualKeyframeTracks = {};

return {
  mutatedNodeIds: [node.id],
  manualKeyframeTracks: node.manualKeyframeTracks,
};
```

## Fill and Stroke Color Keyframes

Fill color animation is stored in `manualKeyframeTracks.fills`, keyed by the zero-based paint index in `node.fills`. Stroke color animation works the same way via `manualKeyframeTracks.strokes`, keyed by index in `node.strokes`. Only `SOLID` paints can be animated this way.

Color keyframe values use `{ r, g, b, a }` in the `0-1` range. All examples below use `fills`; the `strokes` shape is identical — substitute `strokes` for `fills` and `node.strokes` for `node.fills`.

### Read Animated Fills

```js
const node = await figma.getNodeByIdAsync("123:456");

return {
  id: node.id,
  fills: node.fills,
  animatedFills: node.manualKeyframeTracks?.fills ?? {},
};
```

### Write A Fill Color Track

Always ensure the target fill index exists and is a solid fill.

```js
const node = await figma.getNodeByIdAsync("123:456");
const mutatedNodeIds = [node.id];

node.fills = [
  { type: "SOLID", color: { r: 1, g: 0, b: 0 } },
];

const existing = node.manualKeyframeTracks ?? {};
const duration = 1;

node.manualKeyframeTracks = {
  ...existing,
  fills: {
    ...(existing.fills ?? {}),
    0: {
      keyframes: [
        {
          timelinePosition: 0,
          easing: { type: "LINEAR" },
          value: { type: "COLOR", value: { r: 1, g: 0, b: 0, a: 1 } },
        },
        {
          timelinePosition: duration,
          easing: { type: "LINEAR" },
          value: { type: "COLOR", value: { r: 0, g: 0, b: 1, a: 1 } },
        },
      ],
    },
  },
};

const [timeline] = node.timelines;
if (timeline && timeline.duration < duration) {
  node.setTimelineDuration(timeline.id, duration);
  mutatedNodeIds.push(timeline.id);
}

return {
  mutatedNodeIds,
  animatedFills: node.manualKeyframeTracks.fills,
  timelines: node.timelines,
};
```

### Edit A Fill Color Track

Preserve existing track and keyframe IDs:

```js
const node = await figma.getNodeByIdAsync("123:456");
const existing = node.manualKeyframeTracks ?? {};
const fill0 = existing.fills?.[0];

if (!fill0) {
  throw new Error("Node has no animated fill at paint index 0.");
}

node.manualKeyframeTracks = {
  ...existing,
  fills: {
    ...existing.fills,
    0: {
      ...fill0,
      keyframes: fill0.keyframes.map((keyframe, index) =>
        index === 1
          ? { ...keyframe, value: { type: "COLOR", value: { r: 0, g: 0, b: 1, a: 1 } } }
          : keyframe,
      ),
    },
  },
};

return {
  mutatedNodeIds: [node.id],
  animatedFills: node.manualKeyframeTracks.fills,
};
```

## Effect Keyframes

Effect animation is stored in `manualKeyframeTracks.effects`, keyed first by the zero-based effect index in `node.effects`, then by effect field name.

- Always ensure the target effect index exists before writing an effect track.
- Allowed effect fields are `OFFSET_X`, `OFFSET_Y`, `RADIUS`, `SPREAD`, `COLOR`, `REFRACTION_RADIUS`, `SPECULAR_ANGLE`, `SPECULAR_INTENSITY`, `CHROMATIC_ABERRATION`, `SPLAY`, `REFRACTION_INTENSITY`, `START_RADIUS`, `NOISE_SIZE_X`, `NOISE_SIZE_Y`, `DENSITY`, `EFFECT_OPACITY`, and `SECONDARY_COLOR`.
- Do not use generated effect fields that are not public Plugin API fields. `START_OFFSET_X`, `START_OFFSET_Y`, `END_OFFSET_X`, and `END_OFFSET_Y` intentionally throw.
- `COLOR` and `SECONDARY_COLOR` require `{ type: "COLOR", value: { r, g, b, a } }`.
- All other effect fields require `{ type: "FLOAT", value }`.
- Normalized effect fields (`SPECULAR_INTENSITY`, `CHROMATIC_ABERRATION`, `SPLAY`, `REFRACTION_INTENSITY`) use public `0-1` values.

```js
const node = await figma.getNodeByIdAsync("123:456");

node.applyManualKeyframeTrack(
  { type: "INDEXED_ITEM", collection: "effects", index: 0, field: "RADIUS" },
  {
    keyframes: [
      { timelinePosition: 0, value: { type: "FLOAT", value: 0 } },
      { timelinePosition: 0.4, easing: { type: "EASE_OUT" }, value: { type: "FLOAT", value: 24 } },
    ],
  },
);

return {
  mutatedNodeIds: [node.id],
  animatedEffects: node.manualKeyframeTracks.effects,
};
```

## Animation Styles

Animation styles are reusable animations applied through `node.animationStyles`. A node can have multiple styles.

Style entries have:

- `styleId`: style definition ID, from `figma.motion.figmaAnimationStyles()`.
- `name`: required display name.
- `duration`: top-level duration in seconds for this style.
- `timelineOffset`: top-level start time in seconds.
- `props`: style-specific properties such as `timing`, `moveX`, `fade`, or `easing`. The available props vary per style — inspect the discovered definition's `props` before writing.

`duration` and `timelineOffset` are top-level fields, not `props`.

### Discover Styles

```js
const styles = figma.motion.figmaAnimationStyles();

return styles.map((style) => ({
  styleId: style.styleId,
  name: style.name,
  description: style.description,
  props: style.props,
}));
```

The `props` field returns **documentation strings**, not setter shapes. For example, the Fade style reports its easing default as `"easing // default: { easingType: OUT_CUBIC }"` — that string is a signature hint, not a value to copy. When writing easing on a style's `props`, always use the public `{ type: 'EASE_OUT' }` form (see [motion-easing.md](motion-easing.md)).

### Apply A Style

```js
const node = await figma.getNodeByIdAsync("123:456");
const styles = figma.motion.figmaAnimationStyles();
const fadeDef = styles.find((style) => style.name === "Fade");
const mutatedNodeIds = [node.id];

if (!fadeDef) {
  throw new Error("Could not find the Fade animation style.");
}

node.animationStyles = [
  ...(node.animationStyles ?? []),
  {
    styleId: fadeDef.styleId,
    name: fadeDef.name,
    duration: 0.5,
    timelineOffset: 0,
    props: {
      timing: "in",
      easing: { type: "EASE_OUT" },
    },
  },
];

const styleEnd = 0 + 0.5;
const [timeline] = node.timelines;
if (timeline && timeline.duration < styleEnd) {
  node.setTimelineDuration(timeline.id, styleEnd);
  mutatedNodeIds.push(timeline.id);
}

return {
  mutatedNodeIds,
  animationStyles: node.animationStyles,
  timelines: node.timelines,
};
```

Prefer `applyAnimationStyle` when adding a style. It returns the applied style instance `id`, which is the value to pass to `removeAnimationStyle` later:

```js
const node = await figma.getNodeByIdAsync("123:456");
const styles = figma.motion.figmaAnimationStyles();
const fadeDef = styles.find((style) => style.name === "Fade");
const mutatedNodeIds = [node.id];

if (!fadeDef) {
  throw new Error("Could not find the Fade animation style.");
}

const appliedStyleId = node.applyAnimationStyle(fadeDef.styleId, {
  duration: 0.5,
  timelineOffset: 0,
  props: {
    timing: "in",
    easing: { type: "EASE_OUT" },
  },
});

const [timeline] = node.timelines;
if (timeline && timeline.duration < 0.5) {
  node.setTimelineDuration(timeline.id, 0.5);
  mutatedNodeIds.push(timeline.id);
}

return {
  mutatedNodeIds,
  appliedStyleId,
  animationStyles: node.animationStyles,
  timelines: node.timelines,
};
```

### Edit Styles

Overwrite `node.animationStyles` with a mapped array:

```js
const node = await figma.getNodeByIdAsync("123:456");

node.animationStyles = (node.animationStyles ?? []).map((style) =>
  style.name === "Fade"
    ? { ...style, duration: 0.35 }
    : style,
);

return {
  mutatedNodeIds: [node.id],
  animationStyles: node.animationStyles,
};
```

### Remove Styles

```js
const node = await figma.getNodeByIdAsync("123:456");

node.animationStyles = (node.animationStyles ?? []).filter(
  (style) => style.name !== "Fade",
);

return {
  mutatedNodeIds: [node.id],
  animationStyles: node.animationStyles,
};
```

When you have the applied style instance `id`, use the helper:

```js
const node = await figma.getNodeByIdAsync("123:456");
const fade = (node.animationStyles ?? []).find((style) => style.name === "Fade");

if (!fade?.id) {
  throw new Error("Node has no applied Fade style instance.");
}

node.removeAnimationStyle(fade.id);

return {
  mutatedNodeIds: [node.id],
  animationStyles: node.animationStyles,
};
```

## Timeline Duration

`node.timelines` returns the containing top-level frame timeline as `{ id, duration }`, where `duration` is in seconds. `node.setTimelineDuration(id, durationSeconds)` writes that containing timeline; the `id` must match the timeline returned by the same node.

```js
const node = await figma.getNodeByIdAsync("123:456");
const requiredDuration = 3;
const [timeline] = node.timelines;
const mutatedNodeIds = [];

if (timeline && timeline.duration < requiredDuration) {
  node.setTimelineDuration(timeline.id, requiredDuration);
  mutatedNodeIds.push(timeline.id);
}

return {
  mutatedNodeIds,
  timelines: node.timelines,
};
```

## Transform Notes

Motion transform values are relative to the node's own coordinate system.

- Translation values are pixels.
- Rotation values are degrees.
- Scale values are multipliers.
- `ROTATION` and `SCALE_X` / `SCALE_Y` / `SCALE_XY` pivot around the node's visual centre by default.

## Motion Design Defaults

Unless the user asks for a strong effect, keep motion subtle:

- Prefer short durations around `0.25s` to `0.7s`.
- Stagger related elements instead of animating everything at once.
- Use sequence to show hierarchy: header, subheader, primary content, secondary content.
- Prefer `EASE_OUT`, `EASE_IN_AND_OUT`, `GENTLE`, or `QUICK` for polished UI motion.
- Avoid flashy loops, large rotations, and excessive bounce unless requested.
