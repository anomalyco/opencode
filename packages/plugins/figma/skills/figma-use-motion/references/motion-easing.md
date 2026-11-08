# Motion Easing

Use this reference when setting `easing` on a `manualKeyframeTracks` keyframe or on an `animationStyles[].props.easing` value in `use_figma` scripts.

The motion easing object is the same shape used by smart-animate transitions, with `'HOLD'` added for motion-only step interpolation. The full set of accepted `type` values is listed below.

## Easing Object

```js
{ type: "EASE_OUT" }
```

`type` accepts any of:

| Value | Meaning |
|---|---|
| `EASE_IN` | Ease in (cubic) |
| `EASE_OUT` | Ease out (cubic) |
| `EASE_IN_AND_OUT` | Ease in and out (cubic) |
| `LINEAR` | Linear |
| `EASE_IN_BACK` | Ease in back |
| `EASE_OUT_BACK` | Ease out back |
| `EASE_IN_AND_OUT_BACK` | Ease in and out back |
| `CUSTOM_CUBIC_BEZIER` | Custom cubic bezier (requires `easingFunctionCubicBezier`) |
| `GENTLE` | Gentle spring |
| `QUICK` | Quick spring |
| `BOUNCY` | Bouncy spring |
| `SLOW` | Slow spring |
| `CUSTOM_SPRING` | Custom spring (requires `easingFunctionSpring`) |
| `HOLD` | Hold / step interpolation (motion-only; do not include any extra fields) |

The easing on a keyframe controls how to animate from the previous keyframe to the current keyframe.

**Do not** use internal scenegraph names like `OUT_CUBIC`, `INOUT_CUBIC`, `CUSTOM_CUBIC`, `SPRING_PRESET_ONE`, etc. They're rejected by the public schema.

**Do not** shorten ease-in-out enum names. The public schema accepts `EASE_IN_AND_OUT` and `EASE_IN_AND_OUT_BACK`; it rejects `EASE_IN_OUT` and `EASE_IN_OUT_BACK`.

## Custom Cubic Bezier

`CUSTOM_CUBIC_BEZIER` requires `easingFunctionCubicBezier`:

```js
{
  type: "CUSTOM_CUBIC_BEZIER",
  easingFunctionCubicBezier: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 }
}
```

Example on a manual keyframe track:

```js
const node = await figma.getNodeByIdAsync("123:456");

node.manualKeyframeTracks = {
  ...(node.manualKeyframeTracks ?? {}),
  TRANSLATION_X: {
    keyframes: [
      {
        timelinePosition: 0,
        value: { type: "FLOAT", value: 0 },
      },
      {
        timelinePosition: 1,
        value: { type: "FLOAT", value: 120 },
        easing: {
          type: "CUSTOM_CUBIC_BEZIER",
          easingFunctionCubicBezier: { x1: 0, y1: 0, x2: 0.58, y2: 1 },
        },
      },
    ],
  },
};

return {
  mutatedNodeIds: [node.id],
  manualKeyframeTracks: node.manualKeyframeTracks,
};
```

## Custom Spring

`CUSTOM_SPRING` requires `easingFunctionSpring`. Use `bounce` (a number from 0 to 1):

```js
{
  type: "CUSTOM_SPRING",
  easingFunctionSpring: { bounce: 0.3 }
}
```

`bounce` controls how springy the motion feels: `0` settles smoothly with no overshoot, and higher values (up to `1`) add progressively more oscillation. The API enforces `bounce >= 0 && bounce <= 1`.

If you are starting from physical spring params, convert them before writing:

```js
const bounce = figma.motion.physicalSpringToNormalized({ mass: 1, stiffness: 100, damping: 10 });

{
  type: "CUSTOM_SPRING",
  easingFunctionSpring: { bounce }
}
```

When reading motion keyframes back, `easingFunctionSpring` includes only `bounce`.

## Hold

`HOLD` keeps the previous keyframe value until the current keyframe is reached, then steps immediately to the current value. Do not include `easingFunctionCubicBezier` or `easingFunctionSpring`.

```js
{
  type: "HOLD"
}
```

Use `HOLD` for discrete state changes, step reveals, or intentionally abrupt toggles.

## Easing Inside An Animation Style

Some animation styles expose an `easing` prop. First inspect the style definition's `props` to confirm the name and accepted shape:

```js
const styles = figma.motion.figmaAnimationStyles();
const fadeDef = styles.find((style) => style.name === "Fade");

return {
  fadeStyle: fadeDef
    ? {
        styleId: fadeDef.styleId,
        name: fadeDef.name,
        props: fadeDef.props,
      }
    : null,
};
```

When the style prop accepts an easing, use the same public easing object:

```js
const node = await figma.getNodeByIdAsync("123:456");
const styles = figma.motion.figmaAnimationStyles();
const fadeDef = styles.find((style) => style.name === "Fade");

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
      easing: {
        type: "CUSTOM_CUBIC_BEZIER",
        easingFunctionCubicBezier: { x1: 0, y1: 0, x2: 0.58, y2: 1 },
      },
    },
  },
];

return {
  mutatedNodeIds: [node.id],
  animationStyles: node.animationStyles,
};
```
