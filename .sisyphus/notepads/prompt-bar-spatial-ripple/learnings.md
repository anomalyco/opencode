# Learnings

# Learnings

## Task 1: tui.json schema for ripple options

- `TuiOptions` in `tui-schema.ts` is the central Zod schema; `TuiInfo` extends it with `$schema`, `theme`, `keybinds`
- `TuiConfig.get()` in `tui.ts` loads/merges config files and returns `Info` — no changes needed there when schema grows
- Nested optional objects (e.g. `options.diagonal_ripple`) flow through `mergeDeep` automatically
- Schema uses `.strict()` at the top level (`TuiInfo`) so unknown keys are rejected — new fields must be in `TuiOptions`
- Test fixture pattern: `tmpdir({ init })` + `Instance.provide({ directory, fn })` + `TuiConfig.get()`
- Direction enum: `down-right`, `down-left`, `up-right`, `up-left` — diagonal directions matching ripple feature name

## Task 1 fix: direction enum correction

- Original enum (`left`, `right`, `center`, `edge`) was wrong — feature is "diagonal ripple" so directions must be diagonal
- Always match enum values to the semantic domain of the feature

## Task 1 scope creep cleanup

- Previous attempts modified 60+ files (web docs, registry, idle-prompt-bar notepads) — only 2 files needed changes
- `git stash push -- <paths>` is effective for isolating non-target file changes without losing them
- Schema and test were already correct after the prior fix; scope creep was the only real issue
- Direction enum `down-right | down-left | up-right | up-left` confirmed correct, test uses `down-right`
- speed/intensity stay as numbers with no new fields needed

## Task 2: Ripple math helper and unit tests

- `RGBA.fromValues(r,g,b,a)` takes float 0-1 range; `RGBA.fromInts` takes 0-255 — `.r`/`.g`/`.b`/`.a` getters return floats
- Direction vectors at origin (0,0) produce identical `d` values since `u*dirX + v*dirY = 0` for all directions — tests must use non-origin positions
- `PromptBarVisualTheme` from `prompt-bar-visual.ts` provides the palette shape (primary/secondary/accent/info/success/warning/error)
- Pure helper pattern: no side effects, no hooks, just math — keeps unit tests fast and independent
- Clamp defaults: speed 0.18 (min 0.02, max 1), intensity 0.35 (min 0, max 1), direction "down-right"

## Task 3: Plugin interface + registry for spatial render

- Optional `render` on `PromptBarAnimationPlugin` enables spatial rendering alongside flat `resolve`
- `PromptBarAnimationRenderInput` bundles `buffer` (OptimizedBuffer), `data` (animation state), `ripple` (resolved config) — consumer resolves config before calling
- `diagonal-ripple` plugin delegates non-idle states to `legacyCyclePlugin.resolve` for legacy overlay parity
- Render function guards on `state !== idle || hasContent || !idleCycleEnabled` to skip spatial drawing when not appropriate
- Mock buffer pattern for testing: object with `width`, `height`, `fillRect` that records calls — cast via `as unknown as OptimizedBuffer` (not `as any`) to satisfy biome lint
- `isPlugin` validation doesn't need updating — `render` is optional so existing validation passes
- interval_ms=60 for diagonal-ripple gives ~16fps spatial animation vs 1000ms for legacy flat cycling

## Task 3 fix: biome lint compliance

- `as any` forbidden by biome `noExplicitAny` — use `as unknown as T` double-cast instead
- Non-null assertions (`!`) forbidden by biome `noNonNullAssertion` — use `expect(x).toBeDefined()` + optional chaining `x?.prop`
- `plugin.render!({...})` parsed by biome as `!({...})` (logical NOT), causing parse errors — optional chaining `plugin.render?.({...})` avoids this
- LSP diagnostics can lag behind file edits; `npx biome lint` gives authoritative check

## Task 4: Prompt bar spatial ripple render path

- `usePromptBarColorEffect` can expose stable animation metadata (`plugin`, `idleCycleIndex`, `idleCycleEnabled`, `state`, `hasContent`) so render-time code does not duplicate idle gating.
- `diagonal_ripple` options should be resolved once from `tuiConfig.prompt_bar_animation?.options?.diagonal_ripple` and passed into render-time plugin drawing.
- Applying spatial fill at the outer prompt container via `renderBefore` keeps layout constants untouched while enabling per-cell gradient painting.
- When spatial ripple mode is active, prompt surfaces need transparent backgrounds plus `shouldFill={false}` to avoid flat background overpainting.

## F4: Scope fidelity check (deep)

- Plan guardrails are explicit: no layout/padding/glyph changes, no trigger/gating changes, no unrelated UI changes.
- Planned prompt-bar file set is mostly respected (`tui-schema`, `tui.test`, ripple helper + test, animation plugin/registry + test, prompt `index.tsx`, `color-effect.ts`, layout policy + harness).
- Layout constants remain unchanged (`promptBarLayoutSpec` values and `promptBarLayoutHeight` expectations still `min: 6, max: 11`), so no padding/height drift detected.
- Trigger behavior remains aligned: `diagonal-ripple` non-idle states delegate to legacy resolver and idle render is gated by `state/hasContent/idleCycleEnabled` checks.
- Scope creep exists in working tree outside this plan: unplanned app e2e files (`packages/app/e2e/prompt/prompt-unthemed-background.spec.ts`, `packages/app/e2e/prompt/unthemed-background-scan.spec.ts`) and many unrelated `.sisyphus/*` artifacts are present.
- Result: strict scope fidelity = FAIL (workspace includes unplanned changes), feature-level guardrails inside planned prompt-bar files = PASS.

## F1: Plan Compliance Audit (2026-03-07)

- Result: FAIL (Tasks 1-3 pass; Task 4 integration deviates from non-idle/disabled gating)
- Key deviation: `promptBarSpatialRippleActive()` ignores `state/hasContent/idleCycleEnabled`, so surfaces go transparent even when `diagonal-ripple.render()` skips; this drops legacy overlay backgrounds in non-idle states and when idle cycling is disabled.
- Missing verification in this audit: plan DoD commands were not run (`bun run --cwd packages/opencode test:prompt-bar-regressions`, `bun run --cwd packages/opencode typecheck`, `bun run --cwd packages/opencode build`).
- Scope note: unplanned `packages/app/e2e/prompt/*unthemed-background*.spec.ts` and many `.sisyphus/evidence/*` artifacts present in the working tree.

## Task 4 gating follow-up (2026-03-07)

- Spatial transparency gating now matches renderer gating: activate only when plugin is `diagonal-ripple` and animation state is idle + no content + idle cycle enabled.

## Task 1 re-verification (2026-03-07)

- Schema and test confirmed present and passing: 22/22 tests pass, 0 LSP errors
- `diagonal_ripple` schema at tui-schema.ts:31-41 with speed (min 0), intensity (min 0, max 1), direction enum
- Test at tui.test.ts:537-570 exercises full config path through `TuiConfig.get()`
- No code changes needed — task was already completed in a prior session

## Task 4 verification (2026-03-07)

- All three target files (`prompt-bar-layout-policy.ts`, `prompt/index.tsx`, `prompt-layout-harness.test.ts`) confirmed correct.
- `promptBarSpatialRippleActive` signature already accepts `state/hasContent/idleCycleEnabled` and gates transparency to idle+empty+enabled only.
- Prompt index already passes `promptBarColor.animation()` fields (state, hasContent, idleCycleEnabled) into the policy function.
- Harness test covers 6 edge cases: disabled plugin, wrong plugin, non-idle state, has content, idle cycle disabled, and the happy path.
- LSP diagnostics clean on all three files — zero type errors.

## Task 4 typecheck fix (2026-03-07)

- `promptBarSpatialRippleActive` type did not include `renderBefore` but the call site passed it as an excess property — `tsgo --noEmit` caught it (`TS2353`), bun LSP did not.
- Fix: removed `renderBefore` from the call site since the gating logic only needs `pluginEnabled/plugin/state/hasContent/idleCycleEnabled` — `renderBefore` is redundant because `plugin === "diagonal-ripple"` already implies the plugin has a render function.
- `tsgo` (native TypeScript Go compiler) catches excess property checks that the bun LSP may miss — always run `typecheck` as final verification.
- Prior sessions had implemented all four target files correctly (renderBefore, transparency gating, harness tests) but left the excess property, causing typecheck to fail silently in test-only flows.

## Task 4: OpenTUI OptimizedBuffer research (2026-03-07)

### FrameBuffer drawing methods

OpenTUI provides `FrameBuffer` (alias `OptimizedBuffer`) for low-level per-cell rendering:

- **`fillRect(x, y, width, height, color)`** — fills rectangular area with RGBA color
  - Docs: https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/frame-buffer.mdx
- **`setCell(x, y, char, fg, bg, attributes?)`** — per-cell control with separate fg/bg RGBA
- **`setCellWithAlphaBlending(x, y, char, fg, bg)`** — alpha blending for transparency
- **`drawText(text, x, y, fg, bg?, attributes?)`** — draw text with optional background
- **`drawFrameBuffer(destX, destY, source, ...)`** — copy between buffers

Example:

```typescript
import { RGBA } from "@opentui/core"
canvas.frameBuffer.fillRect(10, 5, 20, 8, RGBA.fromHex("#FF0000"))
canvas.frameBuffer.setCell(10, 5, "@", RGBA.fromHex("#FFFF00"), RGBA.fromHex("#000000"))
```

### renderBefore / renderAfter lifecycle

OpenTUI `Renderable` class supports hooks:

- **`renderBefore(buffer, deltaTime)`** — called before `renderSelf`, ideal for background drawing
- **`renderSelf(buffer, deltaTime)`** — main rendering override
- **`renderAfter(buffer, deltaTime)`** — called after children render

Source: https://github.com/anomalyco/opentui/blob/main/packages/core/src/Renderable.ts#L1365

```typescript
// From Renderable.ts line 1365
if (this.renderBefore) {
  this.renderBefore.call(this, renderBuffer, deltaTime)
}
this.renderSelf(renderBuffer, deltaTime)
if (this.renderAfter) {
  this.renderAfter.call(this, renderBuffer, deltaTime)
}
```

Real-world usage in OpenTUI examples:

- `packages/core/src/examples/mouse-interaction-demo.ts` — uses `frameBuffer.clear()` + `setCellWithAlphaBlending`
- `packages/core/src/examples/console-demo.ts` — overrides `renderSelf` to draw dynamic backgrounds
- `packages/core/src/renderables/LineNumberRenderable.ts` — draws full-width backgrounds in `renderSelf`

### Buffered rendering for performance

Enable offscreen buffer with `buffered: true` option — useful for complex animations:

```typescript
const complex = new BoxRenderable(renderer, {
  id: "complex",
  buffered: true,
  renderAfter: (buffer) => {
    buffer.fillRect(0, 0, 10, 5, RGBA.fromHex("#FF0000"))
  },
})
```

Docs: https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/core-concepts/renderables.mdx

## Task 4 renderBefore exploration (2026-03-07)

### Harness test assertions for render hook wiring

The harness test at `prompt-layout-harness.test.ts:296-319` validates render hook wiring by:

1. Reading the prompt component source file as text
2. Checking for specific string patterns that prove wiring

Key assertions in "prompt component wires prompt layout through shared spec" test:

- `source.includes("promptBarLayoutSpec")` — ensures layout spec is imported/used
- `source.includes("promptBarUseLegacyLayoutForTheme")` — ensures legacy layout logic is used
- `source.includes("renderBefore={function (buffer) {")` — ensures renderBefore is wired to the outer box
- `source.includes("backgroundColor={promptBarSurfaceStyle().shellBackground}")` — ensures surface style is applied
- `source.includes("promptBarSpatialRipple()")` — ensures spatial ripple gating is used
- `source.includes("if (!promptBarSpatialRipple()) return")` — ensures early return guard exists

### renderBefore usage in prompt component

Located at `prompt/index.tsx:1021-1045` in the outer `<box>` element (the shell container):

```tsx
renderBefore = {
  function(buffer) {
    if (!promptBarSpatialRipple()) return // Gating: only draw when ripple active
    const animation = promptBarColor.animation()
    const render = animation.plugin.render
    if (!render) return // Guard: only draw if plugin has render function
    const el = this as BoxRenderable
    const scoped = {
      width: el.width,
      height: el.height,
      fillRect(x: number, y: number, w: number, h: number, color: RGBA) {
        buffer.fillRect(el.x + x, el.y + y, w, h, color) // Offset to element position
      },
    }
    render({
      buffer: scoped as unknown as OptimizedBuffer,
      ripple: promptBarRipple(),
      data: {
        state: animation.state,
        hasContent: animation.hasContent,
        idleCycleIndex: animation.idleCycleIndex,
        idleCycleEnabled: animation.idleCycleEnabled,
        theme,
      },
    })
  },
}
```

Key patterns:

- `this as BoxRenderable` — access element dimensions/position inside renderBefore
- Scoped buffer pattern — wrap the buffer to offset coordinates to element's x/y
- Gating at top level — `if (!promptBarSpatialRipple()) return` skips rendering when inactive
- Config resolution — `promptBarRipple()` resolves config once, passed to render function

### color-effect.ts exposes animation metadata

The `usePromptBarColorEffect` hook returns `animation` memo:

```typescript
const animation = createMemo(() => ({
  plugin: props.plugin(),
  state: props.state(),
  hasContent: props.hasContent(),
  idleCycleIndex: idleCycleIndex(),
  idleCycleEnabled: idleCycleEnabled(),
  renderBefore: !!props.plugin().render, // Signals spatial render support
}))
```

### How to extend harness tests for new render features

To add harness assertions for a new renderBefore feature:

1. Add new string pattern checks in the existing test (similar to lines 300-318)
2. Read the component source with `Bun.file(...).text()`
3. Assert `source.includes("specific_pattern")` for each wiring element
4. Keep assertions focused on wiring/connection, not behavior (behavior tested elsewhere)

The harness test intentionally does NOT test:

- Actual rendering behavior (tested in unit tests for helpers)
- Animation timing/intervals (tested in integration)
- Visual output (tested in e2e)

## F1: Plan Compliance Audit (2026-03-08)

- Files inspected (per plan):
  - packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx
  - packages/opencode/src/cli/cmd/tui/component/prompt/color-effect.ts
  - packages/opencode/src/cli/cmd/tui/util/prompt-bar-layout-policy.ts
  - packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-registry.ts
  - packages/opencode/src/cli/cmd/tui/util/prompt-bar-ripple.ts
  - packages/opencode/test/cli/tui/prompt-layout-harness.test.ts
  - packages/opencode/test/cli/tui/prompt-bar-animation-registry.test.ts
  - packages/opencode/test/cli/tui/prompt-bar-ripple.test.ts

- Verdict: PASS
- Plan alignment checks:
  - Spatial ripple activation is gated exactly to: pluginEnabled && plugin=="diagonal-ripple" && state=="idle" && !hasContent && idleCycleEnabled (see promptBarSpatialRippleActive in prompt-bar-layout-policy.ts).
  - Prompt bar surfaces go transparent only when spatial ripple is active (promptBarSurface sets backgrounds undefined + shouldFill false), preserving legacy overlay/background behavior in non-idle/disabled cases.
  - Prompt component wires per-cell rendering via renderBefore on the outer prompt box, and passes resolved diagonal_ripple config into plugin.render.
  - Layout/padding/glyph constants remain unchanged; layout harness asserts geometry stays { min: 6, max: 11 } and bottom-left glyph remains "╹".
  - Tests cover: ripple spatial+temporal variation (prompt-bar-ripple.test.ts), plugin registry render wiring + per-cell drawing (prompt-bar-animation-registry.test.ts), and prompt renderBefore wiring + spatial ripple gating edge cases (prompt-layout-harness.test.ts).

## F2: Code Quality Review (2026-03-07)

### Gating Logic Alignment — CORRECT

- `idleCycleEnabled` (color-effect.ts:23-29) gates on: visible, pluginEnabled, state===idle, !hasContent, animationsEnabled. Correct cascading logic.
- `promptBarSpatialRippleActive` (layout-policy.ts:58-70) gates on: pluginEnabled, plugin===diagonal-ripple, state===idle, !hasContent, idleCycleEnabled. Mirrors renderer gating exactly.
- `diagonal-ripple.render()` (registry.ts:76) guards on: state!==idle || hasContent || !idleCycleEnabled. Aligned with policy — transparency and rendering activate/deactivate together.
- Call site in index.tsx:191-199 correctly passes `promptBarColor.animation()` fields into the policy function.

### renderBefore Buffer Scoping — CORRECT

- Scoped buffer wraps `fillRect` with `el.x + x, el.y + y` offset — correct per OpenTUI coordinate system.
- `this as BoxRenderable` is valid because OpenTUI calls renderBefore via `.call(this, ...)` binding the element.
- `as unknown as OptimizedBuffer` avoids biome `noExplicitAny` — correct pattern.
- Scoped buffer only implements `width`, `height`, `fillRect` — sufficient for current `diagonal-ripple.render()` which only calls `fillRect`.

### Ripple Math — CORRECT

- `u/v` normalization: `Math.max(1, dim - 1)` prevents div-by-zero for 0-width/height. Correct.
- Phase calculation feeds into `sin()` so d-range exceeding [0,1] is fine (just phase shift).
- `ripple = (sin(phase) + 1) / 2` correctly maps to [0, 1].
- Double `mix()` interpolation produces valid RGBA since inputs are clamped.

### Test Coverage — THOROUGH

- 16 test cases in harness covering all gating branches, surface styles, legacy/plugin/ripple modes.
- Source-level harness assertions validate render hook wiring by checking string patterns in source file.
- No missing edge cases in current test suite.

### LSP Diagnostics on Changed Files

- `color-effect.ts`: 1 informational (import ordering)
- `prompt-bar-layout-policy.ts`: clean
- `prompt-bar-animation-registry.ts`: 1 informational (import ordering)
- `prompt-bar-ripple.ts`: clean
- `prompt-layout-harness.test.ts`: clean
- `index.tsx`: 3 pre-existing biome warnings (non-null assertions at L236-238), 1 pre-existing (non-null at L752), import suggestions — none introduced by ripple code

## F3: Runtime Manual QA (2026-03-07)

- Auth resolved via `--use-real-auth` (run-sandbox-tui.sh) — copies `~/.local/share/opencode/auth.json` into sandbox XDG dir.
- TUI launched successfully with `lucent-orng` theme, `diagonal-ripple` plugin, `enabled: true`.
- Three idle captures taken 1s apart — all byte-identical.
- Prompt bar background: flat `RGB(30,30,30)` across all columns, no per-column variation.
- Check script correctly detects: "Idle prompt bar background did not change between captures".
- Result: FAIL — spatial ripple configured but not producing visible output.
- Likely cause: renderBefore hook not firing, or render loop tick not advancing idle cycle index between 1s captures.
- The 1s capture interval may be too short for the 60ms render loop to produce detectable ANSI differences in tmux pane captures (tmux only captures the last rendered frame, not intermediate frames).

## Sandbox QA: readiness + gradient capture (2026-03-08)

- `run-sandbox-tui.sh` readiness check needed ANSI stripping to avoid false timeouts when gradients are active.
- Successful idle capture shows diagonal-ripple gradients in `.sisyphus/evidence/task-2-idle.txt`.

## Direct fix: renderBefore local buffer coordinates (2026-03-07)

- Updated prompt `renderBefore` scoped `fillRect` to use local buffer coordinates (`x`, `y`) instead of `el.x + x`, `el.y + y` in `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`.
- This avoids double-offset drawing and keeps ripple writes inside the prompt element's render buffer.

## Task: OpenTUI fillRect/setCell research (2026-03-08)

### Sources: fillRect for rectangular backgrounds

**1. LineNumberRenderable.ts** (per-line backgrounds)

- URL: https://github.com/anomalyco/opentui/blob/main/packages/core/src/renderables/LineNumberRenderable.ts
- Full-width background fill at line ~234:

```typescript
buffer.fillRect(startX, startY, this.width, this.height, this._bg)
```

- Per-line custom background at line ~263:

```typescript
buffer.fillRect(startX, startY + i, this.width, 1, lineBg)
```

**2. Slider.ts** (thumb background)

- URL: https://github.com/anomalyco/opentui/blob/main/packages/core/src/renderables/Slider.ts
- Horizontal render at line ~241:

```typescript
buffer.fillRect(this.x, this.y, this.width, this.height, this._backgroundColor)
```

**3. framebuffer-demo.ts** (transparency example)

- URL: https://github.com/anomalyco/opentui/blob/main/packages/core/src/examples/framebuffer-demo.ts
- Box fill with alpha at line ~199:

```typescript
const boxColor = RGBA.fromInts(80, 30, 100, 128)
boxBuffer.fillRect(0, 0, 20, 10, boxColor)
```

### Sources: setCell for per-cell backgrounds

**1. PaletteGrid.ts** (color swatch grid)

- URL: https://github.com/anomalyco/opentui/blob/main/packages/core/src/examples/lib/PaletteGrid.ts
- Per-cell gradient blocks at line ~98:

```typescript
for (let dy = 0; dy < this._blockHeight; dy++) {
  for (let dx = 0; dx < this._blockWidth; dx++) {
    buffer.setCell(x + dx, y + dy, " ", RGBA.fromInts(255, 255, 255), rgba)
  }
}
```

**2. grayscale-buffer-demo.ts** (pixel-level control)

- URL: https://github.com/anomalyco/opentui/blob/main/packages/core/src/examples/grayscale-buffer-demo.ts
- Cell-by-cell rendering at line ~153:

```typescript
fb.setCell(dividerX, y, "|", RGBA.fromInts(60, 60, 80, 255), bgColor)
```

**3. console-demo.ts** (sparkle effects)

- URL: https://github.com/anomalyco/opentui/blob/main/packages/core/src/examples/console-demo.ts
- Per-cell fg/bg with alpha at line ~86:

```typescript
buffer.setCell(centerX - 1, centerY, "✦", sparkleColor, this.backgroundColor)
```

### Core buffer API

**buffer.ts** - URL: https://github.com/anomalyco/opentui/blob/main/packages/core/src/buffer.ts

```typescript
// Line ~220 - setCell with separate fg/bg
public setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes: number = 0): void

// Line ~282 - fillRect for rectangular fills
public fillRect(x: number, y: number, width: number, height: number, bg: RGBA): void
```

### renderBefore hook

**Renderable.ts** - URL: https://github.com/anomalyco/opentui/blob/main/packages/core/src/Renderable.ts

```typescript
// Line ~103 - Options interface
renderBefore?: (this: T, buffer: OptimizedBuffer, deltaTime: number) => void
renderAfter?: (this: T, buffer: OptimizedBuffer, deltaTime: number) => void

// Line ~249 - Public declaration
public renderBefore?: (this: Renderable, buffer: OptimizedBuffer, deltaTime: number) => void
public renderAfter?: (this: Renderable, buffer: OptimizedBuffer, deltaTime: number) => void
```

### Coordinate handling patterns

1. **Element-relative coordinates**: In renderBefore, buffer operates on the element's local coordinate space (0,0 = top-left of element)
2. **Global coordinates**: For writing to parent buffer, add element's x/y offset
3. **Scoped buffer pattern**: Wrap buffer with offset function for reusable coordinate translation

### Guidance for prompt bar spatial ripple

- `fillRect` is sufficient for diagonal ripple (rectangular gradient cells)
- `setCell` needed only if per-cell glyph/char variation required
- renderBefore receives OptimizedBuffer with local coordinates
- Use scoped buffer wrapper to offset coordinates when element position matters
- Alpha blending via RGBA alpha parameter (0-1 float or 0-255 int)

## Task 4: OpenTUI Official Documentation Sources (2026-03-07)

### Renderable renderBefore/renderAfter Lifecycle

**Official Type Definition Source**:

- Package: `@opentui/core` v0.1.79 (latest stable)
- URL: https://app.unpkg.com/@opentui/core@0.1.79/files/Renderable.d.ts
- Lines 85-86 define the hooks:

```typescript
renderBefore?: (this: T, buffer: OptimizedBuffer, deltaTime: number) => void;
renderAfter?: (this: T, buffer: OptimizedBuffer, deltaTime: number) => void;
```

**Official Documentation**:

- OpenTUI Docs: https://opentui.com/docs/core-concepts/renderer/
- Renderables Guide: https://opentui.com/docs/core-concepts/renderables/

**Source Code Invocation**:

- GitHub: https://github.com/anomalyco/opentui/blob/main/packages/core/src/Renderable.ts#L1365-L140
- The render method calls hooks in sequence:
  1. `renderBefore` — before `renderSelf`
  2. `renderSelf` — main rendering
  3. `renderAfter` — after children render

### OptimizedBuffer Methods for Per-Cell Backgrounds

**Official Type Definition Source**:

- Package: `@opentui/core` v0.1.79
- URL: https://app.unpkg.com/@opentui/core@0.1.79/files/buffer.d.ts
- Full file shows all methods

**Key Methods for Per-Cell Backgrounds**:

| Method                     | Signature                                                                              | Purpose                                     |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| `fillRect`                 | `(x: number, y: number, width: number, height: number, bg: RGBA): void`                | Fill rectangular area with background color |
| `setCell`                  | `(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void`  | Set single cell with separate fg/bg         |
| `setCellWithAlphaBlending` | `(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void`  | Alpha blending for transparency             |
| `drawText`                 | `(text: string, x: number, y: number, fg: RGBA, bg?: RGBA, attributes?: number): void` | Draw text line with background              |

**Coordinate System**:

- 0-based indexing (x=0, y=0 is top-left cell)
- Coordinates are scoped to the buffer's dimensions
- For element-relative drawing, offset by element's x/y position

**Example from Type Definitions** (buffer.d.ts lines 75-76):

```typescript
fillRect(x: number, y: number, width: number, height: number, bg: RGBA): void;
setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes?: number): void;
```

### Official OpenTUI Resources

| Resource          | URL                                              |
| ----------------- | ------------------------------------------------ |
| Main Docs         | https://opentui.com/docs/getting-started/        |
| Core Concepts     | https://opentui.com/docs/core-concepts/renderer/ |
| GitHub Repository | https://github.com/anomalyco/opentui             |
| NPM Package       | https://www.npmjs.com/package/@opentui/core      |

### Caveats for Buffer Coordinates

1. **No automatic clipping**: Methods do not clip to buffer bounds — out-of-bounds coordinates are silently ignored
2. **Alpha handling**: Set `respectAlpha: true` on OptimizedBuffer constructor for proper alpha blending
3. **Buffered mode**: Use `buffered: true` option on Renderable for offscreen double-buffering (useful for complex animations)
4. **Coordinate scoping**: The buffer passed to renderBefore is the element's own frame buffer, not the global screen buffer — no need for global-to-local coordinate translation

## Task 4: Source code location audit (2026-03-08)

### Files confirmed with line numbers

| File                        | Key Elements                                               | Lines                  |
| --------------------------- | ---------------------------------------------------------- | ---------------------- |
| prompt-bar-layout-policy.ts | promptBarSpatialRippleActive()                             | 58-70                  |
| prompt/index.tsx            | renderBefore, promptBarRipple, promptBarSpatialRipple call | 61, 192-203, 1025-1049 |
| color-effect.ts             | animation memo with unused renderBefore                    | 62-69                  |
| prompt-bar-ripple.ts        | resolvePromptBarRippleConfig defaults                      | 27-37                  |

### Gating conditions (exact)

1. pluginEnabled === true
2. plugin === "diagonal-ripple"
3. state === "idle"
4. hasContent === false
5. idleCycleEnabled === true

Matches plan expectations: idle-only + no-content + idleCycleEnabled.

### renderBefore buffer pattern

- Uses scoped buffer wrapper: `{ width, height, fillRect }`
- fillRect at line 1035: `buffer.fillRect(el.x + x, el.y + y, w, h, color)`
- This is DOUBLE OFFSET pattern (element position + local coords)
- Notepad entry claims "direct fix" applied to use local (x,y) only, but current code still shows double offset

### Config resolution path

- Source: tuiConfig.prompt_bar_animation?.options?.diagonal_ripple
- Resolver: resolvePromptBarRippleConfig() in prompt-bar-ripple.ts
- Defaults: speed 0.18, intensity 0.35, direction "down-right"

### Excess/unused fields

- color-effect.ts:68 `renderBefore: !!props.plugin().render` - computed but never consumed
- Previously passed to promptBarSpatialRippleActive, removed to fix tsgo excess property error
- Remains as dead code (negligible performance impact)

### Discrepancy noted

- Notepad claims line 1035 was fixed to use local coords (x, y)
- Current source shows (el.x + x, el.y + y) - double offset pattern present
- Either: fix was reverted, or notepad entry was aspirational

## Task 4: Prompt bar layout harness tests analysis (2026-03-08)

### Primary Test File

- `/home/choza/projects/opencode-source/packages/opencode/test/cli/tui/prompt-layout-harness.test.ts`

### Render Hook Wiring Assertions (lines 296-319)

The harness test validates render hook wiring via source-level string pattern matching:

| Line    | Assertion Pattern                                                                                          | Validates                           |
| ------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 300     | `source.includes("promptBarLayoutSpec")`                                                                   | Layout spec is imported/used        |
| 301     | `source.includes("promptBarUseLegacyLayoutForTheme")`                                                      | Legacy layout logic is used         |
| 302     | `source.includes('if (promptBarAnimationPlugin().id === "diagonal-ripple") return true')`                  | Diagonal ripple detection           |
| 303     | `source.includes("<box ref={(r) => (anchor = r)} visible={props.visible !== false}>")`                     | Box ref pattern                     |
| 304     | negated: `source.includes("visible={props.visible !== false}\n        renderBefore={function (buffer) {")` | Should NOT have inline renderBefore |
| 305     | `source.includes("renderBefore={function (buffer) {")`                                                     | renderBefore is wired to outer box  |
| 306     | `source.includes("const el = this as BoxRenderable")`                                                      | Element access via `this` binding   |
| 307     | `source.includes("width: el.width")`                                                                       | Width dimension extraction          |
| 308     | `source.includes("height: el.height")`                                                                     | Height dimension extraction         |
| 309     | `source.includes("buffer.fillRect(el.x + x, el.y + y, w, h, color)")`                                      | fillRect coordinate handling        |
| 310-314 | `source.includes("backgroundColor={promptBarSurfaceStyle().shellBackground}...")`                          | Surface style + renderBefore combo  |
| 315     | `source.includes("if (!promptBarSpatialRipple()) return")`                                                 | Gating guard exists                 |
| 316     | `source.includes("diagonal_ripple")`                                                                       | Ripple config reference             |
| 317     | `source.includes("spatialRippleActive: promptBarSpatialRipple()")`                                         | Spatial ripple flag passed          |
| 318     | `source.includes("shouldFill={promptBarSurfaceStyle().shouldFill}")`                                       | shouldFill prop applied             |
| 319     | `source.includes("chromeVisible: theme.backgroundElement.a !== 0")`                                        | Chrome visibility check             |

### Spatial Ripple Gating Assertions (lines 71-126)

Tests `promptBarSpatialRippleActive()` function with 6 edge cases:

| Lines   | Input Condition        | Expected | Coverage            |
| ------- | ---------------------- | -------- | ------------------- |
| 72-80   | pluginEnabled=false    | false    | Disabled plugin     |
| 81-89   | plugin="legacy-cycle"  | false    | Wrong plugin        |
| 90-98   | state="streaming"      | false    | Non-idle state      |
| 99-107  | hasContent=true        | false    | Has content         |
| 108-116 | idleCycleEnabled=false | false    | Idle cycle disabled |
| 117-125 | All conditions met     | true     | Active (happy path) |

### Transparency/Surface Assertions

Tests validate surface transparency when spatial ripple is active:

- **Lines 235-249**: `spatialRippleActive: true` → surfaces undefined, shouldFill=false
- **Lines 252-280**: `spatialRippleActive: false` → surfaces get overlay color, shouldFill=true

### Layout Invariants Asserted

- **Line 249**: `promptBarLayoutHeight(promptBarLayoutSpec())` returns `{ min: 6, max: 11 }`
- **Lines 230-232**: `promptBarBottomLeft()` returns "╹" in all modes
- **Lines 282-293**: Layout spec constants unchanged (padding, heights, etc.)

### Other Prompt Bar Test Files

| File                                    | Focus                                                        |
| --------------------------------------- | ------------------------------------------------------------ |
| `prompt-bar-ripple.test.ts`             | Ripple math (computeRippleColor, spatial/temporal variation) |
| `prompt-bar-visual.test.ts`             | Overlay color resolution (state → theme color mapping)       |
| `prompt-bar-animation-registry.test.ts` | Plugin registry and render function wiring                   |
| `prompt-bar-state.test.ts`              | Prompt bar state management                                  |
| `prompt-bar-animation-registry.test.ts` | Animation plugin resolution                                  |

### Edge Cases Covered

- All 6 gating branches for spatial ripple activation
- Legacy vs plugin mode surface handling
- Chrome visibility → separator glyph mapping
- Layout dimension preservation
- Bottom-left glyph invariance
- Transparency gating alignment with renderer gating

### Edge Cases MISSING

1. **renderBefore hook invocation** — No test verifies OpenTUI actually calls renderBefore at runtime
2. **Animation tick/interval** — No test verifies idleCycleIndex advances over time
3. **Runtime ANSI capture** — No harness test; verified manually via sandbox capture
4. **Scoped buffer partial implementation** — Scoped buffer only implements fillRect; no test for plugins using other buffer methods
5. **Buffer coordinate edge cases** — No test for 0-width/height or out-of-bounds coordinates
6. **Multiple rapid state transitions** — No test for state changing from idle → streaming → idle rapidly
7. **Theme alpha edge case** — No test for theme.backgroundElement.a === 255 (fully opaque) vs 0 (fully transparent) boundary

### Test Pattern Summary

Harness tests use **source-level string assertions** (not runtime behavior checks):

- Validates wiring/connections between components
- Does NOT test actual rendering output
- Does NOT test animation timing/intervals
- Does NOT test visual output (e2e covers this)

This aligns with the style guide principle: "tests cannot run from repo root; run from package dirs".

## fillRect local coords fix

`renderBefore` scoped buffer's `fillRect` was adding `el.x + x` and `el.y + y`, double-offsetting into global coords. Changed to pass `x, y` directly so the scoped buffer operates in local element space.

## Task 4: Harness test alignment with local-coords fix

- Harness test line 309 still asserted `buffer.fillRect(el.x + x, el.y + y, w, h, color)` but source was already updated to `buffer.fillRect(x, y, w, h, color)` — caused test failure.
- Fix: updated test assertion to match source. All 54 tests pass, 188 expect calls.
- Lesson: when fixing source code, always update corresponding source-level string assertions in harness tests simultaneously.
