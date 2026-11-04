# Motion lint rules

Known limitations in Figma's motion code export. When a design uses one of the features listed below, surface the corresponding message to the user.

## Severity

- **Error** — code generation is not possible for this feature. Tell the user what's unsupported and why. Do not attempt a hand-rolled substitute.
- **Warning** — code is generated but has a known gap. Deliver the code and tell the user what might not match the design.

Each rule below includes the exact message to surface. **Copy the message verbatim — do not paraphrase, summarize, or rephrase it.** Consistent wording across sessions is the goal.

## Override: errors only

If an **Error** rule says code can't be generated, but `get_motion_context` returns valid code for that feature, the limitation has been resolved — skip the error and use the tool's output. **Warnings still apply even when code is returned** — warnings flag gaps in the generated code, so the user needs to know regardless.

## Top-level features

### Smart Animate / Transitions — Error

> **Surface verbatim:**
> Prototype interactions aren't currently supported in MCP. Keyframes on the canvas are visible, but not the smart animate interactions between frames or their transition settings. Code generated from this selection will represent the start and end states, not the transition between them.

### GIF / animated SVG export — Error

> **Surface verbatim:**
> GIFs or animated SVGs aren't currently supported in MCP. Vector layers will export as individual static SVGs with no motion data attached. For an animated raster, use video export. For an animated vector, plan to bring the static SVGs into a runtime (Motion.dev, Lottie) and reapply the keyframes from the Motion context.

## Functionality

### Groups get display: contents — Warning

> **Surface verbatim:**
> The sites runtime applies `display: contents` to group nodes, removing the group's box from the layout. We attempt to correct for this, but the fix may cause other layout issues. Animations targeting a group may not render as expected.
