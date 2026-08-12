# OpenCode Terminal Catalog Agent Guide

## Purpose

This repository is the OpenCode-specific catalog application. It owns the scripted state suite, authored taxonomy, variant manifests, raw frame artifacts, browser renderer, review interactions, and deployment.

OpenCode Drive is the generic lifecycle and automation module. Do not move catalog concepts, OpenCode screen IDs, taxonomies, or comparison UI into Drive.

## Architecture

```text
OpenCode simulation protocol
  ui.capture -> normalized terminal frame
            |
OpenCode Drive
  isolated lifecycle + typed UI/LLM control
            |
Terminal catalog capture runner
  authored scenario + variants + deterministic manifest
            |
Catalog compiler
  boundary validation + taxonomy/flow compilation
            |
React catalog
  canvas renderer + filtering + variant navigation
```

The module seams are:

- `scripts/capture-opencode-drive.ts`: executes the canonical state scenario against one or more variants.
- `catalog/schema.ts`: versioned persisted and browser data contracts.
- `catalog/authoring.ts`: validates the capture graph and compiles authored metadata.
- `src/components/TerminalFrame.tsx`: derives canvas pixels from normalized frames.
- `src/App.tsx`: owns active variant and selected screen state.

## State Addresses

Executable states have canonical `<flow-id>/<state-id>` addresses. The catalog viewer's **Copy ID** action copies that address in flow mode. In screen and UI-element modes it copies the standalone capture ID.

Resolve and reproduce an executable state with:

```bash
bun run reproduce -- patch-success-lifecycle/permission-prompt \
  --opencode /path/to/opencode
```

The command executes the recipe only through the selected state and prints the path to a normalized `opencode-terminal-frame-v1` artifact. `packages/lab/catalog/scenarios/index.ts` is the executable-flow registry used for string resolution. An address is agent-replayable only after its flow is registered there; narrative catalog flows that have not migrated to executable recipes are browse-only.

## Protocol Convention

Keep Drive `--command.ui.*` names and parameter shapes identical to the frontend portion of the canonical OpenCode simulation protocol. The raw-frame command is `ui.capture` with no parameters.

Protocol changes originate in OpenCode, then are copied directly into Drive. Do not add aliases, convenience protocol commands, or backend LLM controls to the CLI.

`ui.capture` landed on OpenCode's `v2` branch in anomalyco/opencode#37135.

## Frame Contract

`opencode-terminal-frame-v1` is the authoritative visual artifact. It contains:

- `cols`, `rows`, and cursor coordinates.
- Lines of run-length-encoded spans.
- Span text and display-cell width.
- Resolved RGBA foreground/background tuples.
- OpenTUI text-attribute bits.

PNG is not authoritative. Do not reintroduce routine checked-in PNG capture.

The browser renderer must preserve the canonical 10 by 20 pixel cell geometry and use the bundled Commit Mono and Noto symbol/math fallback stack. Ordinary Unicode symbols belong in fallback fonts, not hand-drawn code. Render only terminal cell primitives such as solid blocks and structural bars geometrically. Cell geometry, attribute bits, and the block/bar glyph table are shared with the Drive PNG renderer through `opencode-drive/frame`; extend that module instead of hand-syncing constants.

The frame format is renderer-neutral. An SVG exporter should consume the same frame artifacts rather than changing capture.

## Variants

Variants are independent capture environments, not duplicated screen definitions.

```bash
bun run capture -- \
  --opencode /path/to/opencode \
  --revision v2~1 \
  --revision v2 \
  --theme opencode \
  --theme rosepine
```

Each variant must have:

- A unique lowercase slug ID.
- An OpenCode checkout path.
- A recorded checkout basename and Git revision.
- An optional OpenCode theme name.

Variants run concurrently with separate `OpenCodeDriver` instances. Steps inside a variant are sequential because later permission, question, subagent, and session states depend on earlier actions. Preserve deterministic manifest ordering regardless of execution concurrency.

The MVP displays one active variant at a time. In the viewer, left/right moves through flow steps and up/down changes the active variant. Do not add split comparison unless explicitly requested.

## Authored And Generated Files

Edit these by hand:

- `catalog/authored/taxonomies.ts`
- `catalog/authored/screens.ts`
- `catalog/authored/flows.ts`
- Capture scenario code and application source.

Generate, never hand-edit:

- `public/captures/**/*.frame.json`
- `public/drive-captures.json`
- `public/catalog.json`
- `dist/`

If OpenCode UI copy drifts, inspect the current target checkout and update exact markers. Do not paper over synchronization failures with large unconditional sleeps.

## Scope

- The annotation system was deliberately removed. Do not restore annotation routes, storage, KV bindings, or markup UI without an explicit product decision.
- OpenCode Drive is the generic published package in this monorepo (`packages/drive`); this app owns everything OpenCode-catalog-specific, and the package must not import the app.
- The catalog package is private and deployed only as internal developer tooling under `dev.opencode.ai/lab`.

## Verification

After capture or schema changes, run:

```bash
bun run generate
bun run typecheck
bun run test
bun run build
bunx oxlint src catalog scripts server.ts worker.ts
```

For UI changes, verify in a real browser at desktop and mobile widths:

- Every expected canvas loads without console errors.
- Intrinsic dimensions equal `cols * 10` by `rows * 20`.
- Left/right moves through flow steps; up/down switches variants.
- Up/down moves screens only inside the viewer.
- The page has no horizontal overflow on mobile.

For protocol changes, also run the OpenCode simulation tests and the full OpenCode Drive test suite.

## Dependencies

The catalog consumes OpenCode Drive as a Bun workspace dependency (`"opencode-drive": "workspace:*"`) and imports only its published entry points (`opencode-drive`, `opencode-drive/driver`, `opencode-drive/client` for protocol schemas, and the browser-safe `opencode-drive/frame` for renderer geometry). Never import package-internal `src/` paths.
