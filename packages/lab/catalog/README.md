# OpenCode Terminal Catalog

Internal deployment: <https://dev.opencode.ai/lab/catalog>

Capture a reproducible catalog of OpenCode terminal states from local checkouts, browse every state in one web app, and flip between themes or branches without changing the selected screen.

The generated manifest is the source of truth for the current state count. It covers navigation, sessions, assistant responses, questions, subagents, shell, file patches, reads, project search, web tools, permissions, notifications, and review surfaces.

## Prerequisites

- [Bun](https://bun.sh/) 1.3 or newer.
- A current local OpenCode v2 checkout with dependencies installed.

## Install

```bash
gh repo clone anomalyco/opencode
cd opencode/packages/lab/catalog
bun install
```

The OpenCode checkout can live anywhere. Capture commands receive its path explicitly; no sibling-directory layout is required.

## Capture Revision Sets

```bash
bun run capture -- \
  --opencode $HOME/code/opencode \
  --revision v2~1 \
  --revision v2

bun run generate
bun run dev
```

Open the URL printed by `bun run dev`.

Each revision is resolved to an immutable commit and captured from an isolated detached worktree. Set IDs are derived from the commit SHA, prior sets remain in the manifest, and rerunning the same commit/theme replaces only that set. Sets are ordered by commit time, so the newest commit is selected when the catalog opens.

Prepared revision worktrees are cached under `.tmp/capture-worktrees`. Warm captures reuse the exact resolved commit and its installed dependencies; pass `--fresh` to deliberately rebuild the prepared checkout. Full capture groups scenarios by their declared LLM response mode and reuses one OpenCode process within each group. Frames are staged under `.tmp` and replace the revision directory only after every scenario succeeds.

During scenario development, execute one registered flow without changing the authoritative manifest:

```bash
bun run capture -- \
  --opencode $HOME/code/opencode \
  --revision v2 \
  --flow search-lifecycle
```

Preview frames are written under `.tmp/capture-runs`. The scenario registry in `scenarios/index.ts` is authoritative for capture, canonical replay addresses, authored screens, and replayable flow metadata.

When `--revision` is omitted, capture resolves `origin/v2`; it never trusts the checkout's current `HEAD`, which may be a stale feature branch.

## Compare Themes

Variants can use the same OpenCode checkout with different configured themes:

```bash
bun run capture -- \
  --opencode $HOME/code/opencode \
  --revision v2 \
  --theme opencode \
  --theme rosepine

bun run generate
bun run dev
```

Repeated revisions and themes form a cross-product. Use `--theme default` to include OpenCode's configured default alongside named themes. Built-in names include `opencode`, `nord`, `one-dark`, `gruvbox`, `rosepine`, `solarized`, `monokai`, and `palenight`.

In the catalog:

- Use the capture-set picker or press up/down to compare revisions and themes without losing the current screen.
- In the viewer, press left/right to move through flow steps and up/down to switch capture sets.
- Use **Copy ID** to copy the active flow state address, or the capture ID when browsing screens directly.
- Open captures have stable `screen`, `flow`, and `set` URL parameters for sharing an exact catalog state.
- Right-click any terminal image to copy its canonical ID or deep link.
- Click a card to open its full-screen viewer and press `Escape` to close it.
- Press `Cmd+K` or `Ctrl+K` to search screens, labels, UI elements, and flows.

Reproduce a registered executable state against an OpenCode checkout:

```bash
bun run reproduce -- patch-success-lifecycle/permission-prompt \
  --opencode /path/to/opencode
```

The command prints the path to a normalized terminal frame. Only states from flows registered in `scenarios/index.ts` are currently reproducible; other catalog flows remain browse-only until their recipes are migrated.

## Compare Branches

Capture any refs available in one OpenCode checkout:

```bash
bun run capture -- \
  --opencode $HOME/code/opencode \
  --revision origin/v2 \
  --revision v2

bun run generate
bun run dev
```

The common local feature-branch comparison is:

```bash
bun run capture -- \
  --opencode /path/to/opencode \
  --revision origin/v2 \
  --revision HEAD
```

Commit local changes first: capture sets intentionally resolve Git commits and exclude an uncommitted working tree. In the catalog, `origin/v2` is the before set and `HEAD` is the after set; use the picker or up/down without losing the selected state.

Themes and checkout comparisons can be combined:

```bash
bun run capture -- \
  --opencode $HOME/code/opencode \
  --revision origin/v2 \
  --revision v2 \
  --theme nord \
  --theme rosepine
```

Each capture set runs in an isolated OpenCode Drive instance. Independent sets capture concurrently, while states inside one set remain sequential so session-dependent states stay deterministic.

## Agent Workflow

An agent can operate the full workflow using ordinary shell commands. Give it the catalog repository path, the OpenCode checkout paths, and the variants you want.

Example request:

```text
Capture the OpenCode terminal catalog with these variants:

- baseline: ~/code/opencode-main using the opencode theme
- redesign: ~/code/opencode-redesign using the rosepine theme

Run generation, typecheck, tests, and the production build. Start the local
catalog and verify that left/right moves through flow steps while up/down changes variants.
Do not hand-edit generated frame files.
```

The equivalent commands are:

```bash
bun install
bun run capture -- \
  --opencode $HOME/code/opencode \
  --revision v2~1 \
  --revision v2 \
  --theme opencode \
  --theme rosepine
bun run generate
bun run typecheck
bun run test
bun run build
bun run dev
```

Repository-specific architecture and editing rules for agents are in [`AGENTS.md`](./AGENTS.md).

## Generated Artifacts

Capture writes:

```text
public/drive-captures.json
public/captures/<variant>/<screen>.frame.json
```

Generation reads those files and writes:

```text
public/catalog.json
```

Raw terminal frames are authoritative. They preserve text spans, cell widths, resolved RGBA colors, text attributes, cursor position, and terminal dimensions. The browser derives canvas pixels from those frames with Commit Mono. PNG and SVG renderers can be added later without recapturing states.

Do not edit generated frame or manifest files manually. Change the capture scenario or authored catalog metadata and regenerate them.

## Catalog Metadata

Human-authored classification lives in:

```text
catalog/authored/taxonomies.ts
catalog/authored/screens.ts
catalog/authored/flows.ts
```

These files control titles, labels, UI elements, facets, and flow membership independently of terminal capture data.

## Validation

Run the complete local validation:

```bash
bun run generate
bun run typecheck
bun run test
bun run build
```

Generation validates every frame's schema, viewport, row count, and cell width before producing `catalog.json`.

## Deploy

The application deploys as a Cloudflare Worker with static assets:

```bash
bun run deploy
```

Current deployment: https://dev.opencode.ai/lab/catalog

## Troubleshooting

### `ui.capture` is unknown

The target OpenCode checkout predates the simulation protocol change. Fetch and update to the current `v2` branch, which includes [PR #37135](https://github.com/anomalyco/opencode/pull/37135).

### Capture times out waiting for text

OpenCode UI copy changed. Read the current v2 TUI source, update the exact wait marker in `scripts/capture-opencode-drive.ts`, and rerun the whole capture. Do not weaken waits with arbitrary sleeps.

### A theme does not appear

Confirm the theme name in OpenCode's `/themes` picker. Theme names are passed directly to OpenCode configuration.

### The browser shows stale assets

Restart `bun run dev` after changing dependencies, then reload the page. Production builds always start from a clean `dist/` directory.
