---
name: figma-use-motion
description: "Motion / animation context for the `use_figma` MCP tool — animating Figma nodes via manual keyframes, animation styles, easing, and timeline duration. Load alongside figma-use whenever a task involves adding, editing, or inspecting animation on a node."
disable-model-invocation: false
---

# use_figma — Figma Plugin API Skill for Motion

Motion context for the `use_figma` MCP tool. [figma-use](../figma-use/SKILL.md) covers the foundational Plugin API rules — load both together.

**Always pass `skillNames: "figma-use-motion"` (comma-separated alongside `figma-use`) when calling `use_figma` for motion work.** Logging only.

## Runtime Gating

Motion APIs are gated behind the `metronome` user feature flag. When the calling user doesn't have it, every motion property and helper referenced in this skill throws `"<name>" is not a supported API`.

**Bail out fast on that error.** Do not retry; tell the user motion isn't enabled for them and stop. Otherwise you'll burn calls and confuse the user with repeated identical failures.

## When to use this skill

Load this skill whenever a `use_figma` task involves:

- Adding, editing, or removing keyframes on a node (`manualKeyframeTracks`, `applyManualKeyframeTrack`, `removeManualKeyframeTrack`).
- Animating fill or stroke colors over time.
- Applying, editing, or removing animation styles (`applyAnimationStyle`, `removeAnimationStyle`, `animationStyles`).
- Reading or writing timeline duration via `node.timelines` / `node.setTimelineDuration(id, seconds)`.
- Choosing easing for any of the above.

Static design work (creating shapes, components, variables, layout) goes through [figma-use](../figma-use/SKILL.md) alone — this skill is only for the time dimension.

## Exposed motion API surface

- `node.manualKeyframeTracks` — read/write manual keyframes (including fill, stroke, and effect tracks).
- `node.applyManualKeyframeTrack(field, track)` / `node.removeManualKeyframeTrack(field)` — add, replace, or remove one manual keyframe track without rewriting the whole object.
- `node.animationStyles` — read/write animation-style metadata applied to a node.
- `node.applyAnimationStyle(styleId, presetData?)` / `node.removeAnimationStyle(id)` — apply a discovered style and remove an applied style instance by its returned/read-back `id`.
- `node.timelines` — read-only timeline list for the containing top-level frame, with durations in seconds.
- `node.setTimelineDuration(id, durationSeconds)` — write the containing top-level frame timeline duration.
- `node.animations` — read-only resolved keyframe data (currently manual tracks only — see [motion-patterns.md](references/motion-patterns.md)).
- `figma.motion.figmaAnimationStyles()` — read-only list of Figma's first-party animation styles.

Authoring custom `"figma:motion"` preset module source code is out of scope. If the user wants a brand-new animation style, say so and stop; don't fabricate one.

## Reference docs

Load these as needed based on what the task involves:

| Doc | When to load | What it covers |
|-----|-------------|----------------|
| [motion-patterns.md](references/motion-patterns.md) | Adding/editing motion animation | Manual keyframes, animated fills/strokes, applying animation styles, timeline duration |
| [motion-easing.md](references/motion-easing.md) | Setting animation easing | Keyframe easing objects, custom cubic/spring, `HOLD`, applying easing inside an animation style |

## Verifying the animation

`get_screenshot` shows only the timeline's **resting state**, never motion. To check motion, `export_video` and sample frames — but it renders server-side and is **slow and expensive (~10s to minutes)**, so make each render count.

**Plan before rendering — cost scales with pixels × frames, so keep both no larger than the frames need:**

1. **Pick the moments first.** You need one frame per *phase* (e.g. per stagger step, or start / mid / settle), not smooth playback — usually 4–6. This count sets your fps.
2. **Size to what you must read.** Start small — `constraint: { type: 'WIDTH', value: 320 }`, `quality: "low"` — but text and small elements blur there, so raise `WIDTH` (768+) when you need to judge fine detail. Omitting `constraint` = full size (1x; server clamps to 10x / 4096px).
3. **Set fps just high enough to land those frames:** `fps: 5` covers a handful; 10 is an upper bound. Higher just bloats the render.

**Mechanics:** `export_video` works only on a **top-level frame** whose children carry the animation (pass that frame, not the descendant you keyframed). It returns a `jobId` with `status: "processing"` — re-invoke with `{ fileKey, jobId }` to poll. Then extract frames locally with `ffmpeg -ss <t> -i anim.mp4 -frames:v 1 frame_<t>.png` — extraction is free, so once you've paid for the render, mine it for every frame that tells you something rather than re-exporting. Without a frame extractor like `ffmpeg`, skip the export and reason about the keyframes instead.

**Iterate until it's right.** The export is a diagnostic, not a sign-off: if the frames are wrong (bad order, off timing, a missing element, a mask blanking the composite), fix the keyframes/styles and re-export. Read *all* the frames and batch every fix into one pass before re-rendering — every render carries real overhead, so make each one count instead of re-exporting after each small change.

Skip the export entirely for trivial or self-evident changes.

## Pre-flight checklist

In addition to the [figma-use pre-flight checklist](../figma-use/SKILL.md#8-pre-flight-checklist), verify:

- [ ] Easing uses the public `{ type: 'EASE_OUT', easingFunctionCubicBezier?: …, easingFunctionSpring?: … }` shape — not internal scenegraph names like `OUT_CUBIC`.
- [ ] Ease-in-out uses the exact public enum `EASE_IN_AND_OUT` (or `EASE_IN_AND_OUT_BACK`); never emit the invalid alias `EASE_IN_OUT`.
- [ ] The node being animated is not a top-level frame (direct child of a page). Animate descendants instead.
- [ ] Timeline values are seconds in the public Plugin API. Extend via `setTimelineDuration`; never shorten unless the user asked.
- [ ] Transform keyframe fields use public names (`TRANSLATION_X`, `TRANSLATION_Y`, `ROTATION`, `SCALE_X`, `SCALE_Y`, `SCALE_XY`), not internal `MOTION_*` scenegraph names.
- [ ] Manual keyframe fields come from the public allowlist in [motion-patterns.md](references/motion-patterns.md#animatable-fields); generated/internal scenegraph fields intentionally throw.
- [ ] Mutated node IDs are returned (per `figma-use` Rule 15).
- [ ] When motion correctness isn't self-evident and a frame extractor (`ffmpeg`) is available, verify via `export_video` + frame sampling — render small, low `fps`, iterate until right (see the Verifying the animation section above). `get_screenshot` shows only the resting state.
