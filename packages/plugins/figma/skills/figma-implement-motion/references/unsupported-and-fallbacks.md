# Unsupported Features and Fallbacks

Figma motion features that don't have clean code-output paths today. When a design relies on one of these, choose a fallback or surface the limitation to the user rather than emit code that won't render correctly.

Status in this file is point-in-time — verify with the tool's response before treating anything here as definitive. If `get_motion_context` returns snippets for a feature listed below, the feature is supported; trust the tool.

> **User-facing messaging lives in [motion-lint-rules.md](./motion-lint-rules.md).** This file covers fallback alternatives only. When you encounter one of these features, check the lint rules for the appropriate severity and message to surface.

## Features without code-gen support

### Arc paths

Arc path properties (arc start, arc sweep, arc ratio) have no native codegen support in CSS or Motion.dev. Animations on these properties can't be exported.

**Fallback**:
- Pre-render as video.
- For simple arcs, approximate with SVG arc paths and manual translate/rotate keyframes.

### GenEffects in code export

Code export emits the motion but not the GenEffect shader visual. The layer will animate without the shader-driven visuals.

**Fallback**:
- Use video export for a faithful result.
- Code export is appropriate when you want to reapply the motion to a different visual or recreate the effect in your own runtime.

### Video export of GenEffects

GenEffects don't run server-side in the video export flow — the effect won't appear in the exported video. The motion itself renders correctly; only the GenEffect visual is missing.

**Fallback**:
- Export the video locally from Figma instead of via MCP to get the GenEffect baked in.

### GIF / animated SVG export

MCP can't produce GIFs or animated SVGs. Vector layers export as individual static SVGs with no motion data attached.

**Fallback**:
- For an animated raster: use video export instead.
- For an animated vector: bring the static SVGs into a runtime (Motion.dev, Lottie) and reapply the keyframes from the motion context.

**Lint rule:** "GIF / animated SVG export — Error" in [motion-lint-rules.md](./motion-lint-rules.md).

### Path trims (stroke-dashoffset reveals with unsupported timing)

Path trim has dedicated code-gen support for common cases: draw / erase stroke reveals, aligned start+end "wipe" trims, and integer-wrap marching-ants trims. CSS / SVG output maps these to `stroke-dasharray` + `stroke-dashoffset`; Motion.dev output uses `motion.path` with `pathLength` / `pathOffset`, or raw `strokeDashoffset` for marching ants.

Some manually-authored or mixed animations still don't round-trip cleanly: start and end trim tracks with misaligned keyframe times, non-integer wraparound, out-of-range Motion.dev `pathOffset` values, and path trim combined with non-SVG-safe animated wrapper properties like color or stroke weight.

**Fallback**:
- Supported trim snippet from `get_motion_context`: use it as authoritative.
- Unsupported / partial trim: preserve the vector as SVG and implement a simplified dash-based animation, or recommend a library (see [framework-recommendations.md](framework-recommendations.md)).

### Variants and transitions (component variant animations)

Transitions between component variants (click → variant B with a Smart Animate) are handled by a separate data path from keyframe animations. This skill currently covers **animations only**; transition data is not yet integrated.

**Fallback**:
- For now, implement variants as React conditional rendering / CSS state classes, with a short `transition:` on the changing properties to get "close enough" motion.
- When transition support lands in `get_motion_context` / `get_design_context`, this section will be revised.

**Lint rule:** "Smart Animate / Transitions — Error" in [motion-lint-rules.md](./motion-lint-rules.md).

### Animated masks (mask size/image/position as animation targets)

Group animations *under* a mask position correctly (the runtime was updated for this). Animating the mask itself (its image, size, or position as keyframe targets) is not yet supported.

**Fallback**:
- Animate content inside the mask, keeping the mask static.
- If the design requires the mask shape itself to animate, pre-render as video or recommend SVG clip-path animation via a library.

### Complex vector networks and boolean operations in motion

Vector networks (Figma's non-SVG vector format) and boolean operations (union/subtract/intersect) have limited export fidelity, which compounds when animated. Static export is often imperfect; animated export can produce unexpected artifacts.

**Fallback**:
- Export as flattened SVG and animate the whole SVG via transform/opacity.
- Pre-render as video if per-frame fidelity matters.

## Fallback formats when code-gen isn't enough

When the above workarounds don't suffice, consider a non-code fallback:

- **Lottie** — good for complex vector animations exported from After Effects or via the Bodymovin plugin. Renders via Lottie player library. Keeps the design as data.
- **Video (MP4 / WebM)** — for motion that truly can't be reproduced in code (3D, particle-heavy, precise timing with audio). Loses interactivity but is always accurate.
- **WebP animation or APNG** — for short loops with limited color range, lower bandwidth than video.
- **SVG animation (SMIL)** — limited browser support (deprecated-ish on Chromium but still works) — generally prefer CSS/JS over SMIL, but worth knowing exists for defensive reading of existing code.

## When in doubt, ask the user

If a feature is ambiguous or the tool returns partial data, **surface the ambiguity**. Don't silently approximate. A clear "this part of the design uses X which I can't reproduce in code as specified — want me to (a) animate a simpler approximation, (b) recommend a library, or (c) use a video fallback?" is strictly better than shipping broken output.

## Related

- Back to [../SKILL.md](../SKILL.md)
- [gotchas.md](gotchas.md) for supported features with known bugs
- [framework-recommendations.md](framework-recommendations.md) for libraries that cover gaps
