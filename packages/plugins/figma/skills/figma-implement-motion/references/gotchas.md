# Figma Motion Gotchas

Specific bugs and edge cases seen in Figma motion output. Consult when runtime behavior doesn't match the design, or when the tool's `codeSnippets` are missing and you need to hand-roll.

Everything here is **Figma-specific** — general CSS/animation wisdom is not repeated. If a behavior is standard browser motion, it's not in this file.

> **User-facing messaging lives in [motion-lint-rules.md](./motion-lint-rules.md).** This file covers technical workarounds only. When you encounter one of these issues, check the lint rules for the appropriate severity and message to surface.

## HOLD easing is `steps(1, jump-end)`, not linear

**Symptom**: A HOLD-eased track renders as a linear ramp instead of holding the previous keyframe value until the exact boundary.

**Why**: HOLD preserves the previous keyframe's value until the segment boundary, then snaps. The correct CSS equivalent is `steps(1, jump-end)` (also spelled `step-end`). Substituting `linear` or a cubic-bezier approximation produces a visible ramp.

**Fix**: Use the tool's emitted easing verbatim — it will be `step-end` / `steps(1, jump-end)` for HOLD. Do not approximate.

**Edge case**: On the *final* segment, HOLD preserves the last keyframe value (i.e. the end state persists). This is a Figma convention — don't "fix" it by substituting the previous keyframe's value.

## Duration-0 animations should be skipped entirely

**Symptom**: Emitting a motion.dev or CSS `@keyframes` block with `duration: 0` can cause unexpected opacity flashes or layout jumps at mount.

**Why**: Fade with duration 0 previously rendered opacity unexpectedly; the fix collapses zero-duration segments to an instantaneous state change.

**Fix**: If a keyframe track has duration 0, apply the final state as a static style — do not emit an animation block. Motion libraries vary in their duration-0 handling, so be conservative.

## Animated mask layers: position works, mask properties don't

**Symptom**: A design with animated groups behind a mask layer positions correctly (the mask follows the group as it animates), but the mask's own properties — mask size, image, position — aren't animatable.

**Why**: Mask positioning during group animation is handled in `sites-runtime/src/attributes/masks.ts`. However, there is no code path that animates the mask *itself* as a property; no keyframe tracks target mask-size or mask-position.

**Fix**: If the user's intent is to animate the mask image/size/position itself, surface this as unsupported. Animating a *masked* group is fine.

## Animation on Groups which emit as display: contents

**Symptom**: The motion payload shows valid group-level transforms (for example `TRANSLATION_X`, `SCALE_XY`, or `OPACITY` on a Figma group), but the generated app appears static or only partially animated. This often shows up on Group nodes: the payload had correct keyframes, but the React tree emitted wrappers with `className="... contents ..."`, so scale/translation did not reliably affect the visible children.

**Why**: CSS `display: contents` removes the element's own layout box. Transform, scale, rotation, opacity, and transform-origin semantics need an actual rendered box to operate predictably. Figma groups can have a visual bounding box, but a generated `display: contents` wrapper does not. Applying motion to that wrapper either becomes a no-op or affects descendants differently from Figma's group-level transform.

**Fix**: Do not attach motion transforms to a `display: contents` wrapper. When a Figma group has motion, emit or insert a real wrapper element with `position: absolute`/explicit bounds (or another layout-preserving display value) and apply the group motion to that wrapper.

This applies only when the **group itself animates**. A _static_ `display: contents` wrapper (no motion on the group) must be **preserved as-is** — see SKILL.md Step 3, "Preserve `display: contents` wrappers" — because converting it into a positioned box reparents its children to a smaller box and shrinks them. So: static contents wrapper → keep it; animated group that emitted as contents → replace it with a real box.

Introducing a real wrapper must not change the static layout. Preserve the Figma node's visual bounds and coordinate space relative to the same parent, keep child offsets visually unchanged after reparenting into the wrapper, and set explicit width/height when transform origin or child positioning depends on the wrapper box. Verify the static frame still matches before judging motion fidelity; a wrapper with correct keyframes but wrong bounds can make the motion look like an export bug.

**Lint rule:** "Groups get display: contents — Warning" in [motion-lint-rules.md](./motion-lint-rules.md).

## Motion transform overrides class-based layout transforms

**Symptom**: An element positioned with a class transform, such as Tailwind `left-1/2 -translate-x-1/2`, jumps off-center or loses its centering once rotate/scale motion is applied. At the end state, the computed transform may settle to `none` even though the layout class is still present.

**Why**: Tailwind translate utilities and Motion.dev rotate/scale/skew animations both write the CSS `transform` property. Motion writes an inline transform, which has higher priority than the class-generated transform. When Motion's animated transform becomes identity (`rotate(0) scale(1)`), it may still serialize as `transform: none`, wiping out the class-based translate.

**Fix**: Split layout transforms from animated transforms. Put static centering/positioning transforms on a non-motion wrapper, then put Motion's rotate/scale/opacity props on an inner element. If the offset is itself part of the animation layer, encode it in Motion (`x: "-50%"`, `y: "-50%"`) and preserve that offset across all keyframes. Do not rely on class-based `translate-*` utilities on the same element that Motion controls via `rotate`, `scale`, `skew`, `x`, or `y`.

## Color interpolation happens in RGB by default

**Symptom**: An animated color transition from saturated red → saturated blue passes through muddy gray rather than purple.

**Why**: Naive RGB interpolation produces the gray midpoint. Perceptually correct paths require OKLCH or HSL interpolation, which motion.dev supports via `color-interpolation-filters` or explicit color-space hints.

**Fix**: If the tool emits a color interpolation hint, use it. For hand-rolled color animations, prefer OKLCH interpolation when the endpoints are saturated and visually distant.

## Rotation pivot may land on the wrong side of the element

**Symptom**: A rotation animation is generated faithfully from `codeSnippets`, but the animated element never appears on-screen — it orbits below or above the viewport for the entire loop. Common on orbiting-body / satellite patterns where multiple elements share a rotational pivot but have different starting positions.

**Why**: Figma encodes `transformOrigin.y` as a positive scalar relative to element height (e.g. `3.098` ≈ "pivot at 309.8% of element height from top"). The runtime resolves it against the parent frame to a single scene point shared by sibling animations. The exported `transform-origin: x% y%` doesn't carry that resolution: when the element sits *below* the conceptual pivot in scene Y, the literal CSS value places the pivot even further below, and the orbit ends up entirely off-screen.

**Fix**: If a rotation animation's element is never on-screen during the loop, try negating `(transformOrigin.y - 1) * 100%` as the CSS Y. For `transformOrigin.y = 3.098`, that's `-209.8%`. Verify by watching one full loop. This is a debugging check, not a definitive rule — the underlying resolution logic isn't fully documented.

## Static assets bake the t=0 state of animated properties

**Symptom**: An element with an opacity (or transform) animation that *starts* at zero / off-screen ships as a permanently-invisible asset. Animating the parent's opacity back to 1 doesn't recover visibility — multiplied by the SVG group's baked `opacity="0"`, the product stays 0.

**Why**: Figma's asset exporter renders the design at timeline t=0 and serializes the result. Properties animated from an invisible initial state (opacity 0, off-canvas translate, scale 0) are present in the static asset.

**Fix**: When an animated element renders blank despite a correct opacity animation, inspect the asset bytes (`curl <asset-url>`) and check for hardcoded `opacity` / `transform` on the root group. Either inline the SVG with the static values stripped, or move the opacity animation onto a wrapper element whose initial state is `opacity: 1`.

## Performance

- Apply `will-change` only to elements that are actively animating, not everywhere — it forces GPU layer promotion and costs memory.
- Never approximate a spring as a cubic-bezier. Springs are physics; beziers are shape, and the feel differs. For a 2-keyframe track use Motion.dev's `type: "spring"`; for 3+ keyframes keep the baked easing array.

## Don't preserve these: no known issues

If the tool returns `codeSnippets`, trust them. The gotchas above describe cases where (a) the tool doesn't emit snippets, (b) the runtime has a known limitation, or (c) the LLM is adapting snippets to a different library and needs to preserve non-obvious semantics.

## Related

- Back to [../SKILL.md](../SKILL.md)
- [framework-recommendations.md](framework-recommendations.md) for library-specific easing/origin syntax
- [unsupported-and-fallbacks.md](unsupported-and-fallbacks.md) for features without cleanup export paths
