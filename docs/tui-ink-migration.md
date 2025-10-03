# Ink Migration Research

This document captures the current state of the Go/Bubble Tea TUI, findings from reviewing Continue’s Ink-based CLI, and a recommended migration path. It is meant to serve as a primer for anyone evaluating or executing a future move to Ink.

## 1. Current Go TUI Architecture

### 1.1 Launch flow
- `packages/opencode/src/cli/cmd/tui.ts` is the entrypoint. It bootstraps the Opencode server, locates the platform-specific Go binary, and spawns it with relevant flags (`--model`, `--session`, etc.).
- The CLI exposes `OPENCODE_TUI_PATH` for overrides (useful for experimenting with alternative implementations).
- The Go binary lives under `packages/tui` and is built with Bubble Tea + the Charmbracelet ecosystem.

### 1.2 Packages of interest
- `packages/tui/internal/app`: application state, config integration, session metadata, persisted “tui state” (recent models/agents, message history, toggles).
- `packages/tui/internal/tui/tui.go`: Bubble Tea `Model` implementation. Handles Init/Update/View loop, key bindings, modal stack, toasts, diff overlay, etc.
- `packages/tui/internal/components`: UI primitives composed by the model.
  - `chat`: editor, messages pane, caches, markdown rendering.
  - `commands`: command palette, leader key management.
  - `dialog`: completion popovers (command, file, agent), session picker, confirmation dialogs.
  - `diff`: diff overlay with syntax highlighting.
  - `textarea`: multiline editor with history, mode switch (chat vs bash), key debounce logic.
  - `status`: bottom status bar (cwd/git branch, model info, latency, queue state).
  - `toast`: transient notifications.
  - `qr`, `modal`, `list`: supporting components for login flows, overlays, navigation lists.
- `packages/tui/internal/app/state.go`: persists TUI state to TOML (theme, recently used models/agents, message history, toggles).

### 1.3 Feature inventory
The current TUI provides a rich, IDE-like experience in the terminal. Key features include:

| Feature | Go implementation notes |
| --- | --- |
| Home screen | ASCII logo, quick start shortcuts, model summary (see `tui.Home()` in `tui.go`). |
| Multi-pane chat view | Split layout (messages left, editor bottom, optional diff overlay, modals stacked on top). |
| Streaming messages | Bubble Tea subscriptions update `chat.MessagesComponent` incrementally. |
| Markdown + syntax highlighting | `glamour`, `chroma` render markdown and diffs. |
| File editor integration | Textarea component with history, command detection (`/`, `@`, `!`), bash mode toggle. |
| Command palette | Leader key sequences, completion dialogs for commands/files/agents. |
| Status bar | Displays cwd/git branch, session status, cost & latency, background tasks. |
| Toast notifications | Non-blocking success/error banners via `toast.New*`. |
| Modals & selectors | Session picker with rename, confirm dialogs, login prompts. |
| Diff viewer | Full-screen overlay for patch review with scroll + syntax colors. |
| Telemetry integration | Bottom indicators for tool timings, agent model, plan status. |
| Key handling | Debounced exit and interrupt keys, leader key sequences, ctrl+z suspend, mouse wheel scroll. |
| Persistence | TOML state file for recents/history toggles, updated through `state.go`. |
| Server bridge | Communicates with Opencode server via `app.Client` interfaces (sessions, prompts, tools, telemetry). |

### 1.4 Input/event flow
- Bubble Tea `Update` function orchestrates key events. It routes to editor, commands, modals, or toasts.
- Commands are defined in `packages/tui/internal/commands` and matched via `Commands.Matches` with leader flag support.
- Completion dialog logic selects providers (`commandProvider`, `fileProvider`, `symbolsProvider`, `agentsProvider`).
- Background tasks: diff overlay, telemetry updates, plan watchers, login flows, file watchers (through `app.Watchers`).

### 1.5 Packaging & distribution
- Go binary is embedded in npm package (`packages/opencode/bin/opencode`).
- Cross-platform distribution uses Go compiler, minimal runtime dependencies, near-instant startup.

## 2. Continue’s Ink CLI (Reference Implementation)
We surveyed https://github.com/continuedev/continue (locally at `/Users/jonathanhaas/Documents/Dev/continue`).

### 2.1 Stack overview
- Entire CLI lives under `extensions/cli` and is written in TypeScript.
- UI is implemented with Ink and React components (`extensions/cli/src/ui`).
- State is provided through custom service containers (`extensions/cli/src/services`), contexts, and hooks.
- Packaging via npm scripts: `tsc` + bundling (`build.mjs`), shipped as JS binaries (`dist/index.js`), no Go binaries involved.

### 2.2 UI component structure
- `AppRoot.tsx` wraps the app in `NavigationProvider` and renders `TUIChat`.
- `TUIChat.tsx` orchestrates layout: chat history, editor, status bars, diff viewer, session selectors, modals, update notifications.
- Numerous components mirror the complexity of our Go TUI: Markdown renderer, syntax highlighting, model selectors, slash command UI, diff viewer, resource debug bar, etc.
- `extensions/cli/spec/tui.md` documents Ink stack and UI requirements (git/cwd display, etc.).

### 2.3 Key takeaways
- Ink can support a large-scale, feature-rich TUI given sufficient component scaffolding.
- Continue leans on React conventions (contexts, hooks) to manage global state and service interactions, which aligns well with our TS codebase.
- Distribution is via Node runtime (npm package). Startup will be slower than a baked Go binary but acceptable for modern CLIs.

## 3. Proposed Migration Strategy
This is a multi-phase effort; start with research and proof-of-concept.

### Phase 0 — Documentation (you are here)
- Capture architecture of current Go TUI and reference Ink implementation (this document).

### Phase 1 — Proof of concept
- Create `packages/opencode/src/tui-poc.tsx` implemented with Ink.
- Replicate the “home” screen (logo, quick shortcuts, model summary, text input).
- Wire to existing Opencode server bootstrap for data (reuse `bootstrap` from `tui.ts`).
- Measure startup time and memory vs. Go binary.

### Phase 2 — Feature parity plan
For each Go component, define the Ink equivalent and implementation notes:

| Go component | Responsibility | Ink plan |
| --- | --- | --- |
| `chat.MessagesComponent` | Streaming message list, markdown render, tool traces | Ink list view + custom markdown renderer (`ink-markdown`, `marked-terminal`). Maintain virtualized list for performance. |
| `chat.EditorComponent` | Multiline editor, history, slash commands, bash mode | Build Ink component using raw stdin handling, history state, placeholder hints. Evaluate community packages (`ink-use-stdin`, `ink-text-input`) vs custom. |
| `dialog.CompletionDialog` | Slash command & @ mention completion overlays | Overlay component via Ink `<Box>` with absolute positioning (managed via terminal columns) + keyboard navigation. |
| `commands` | Leader key handling, command routing | Reuse existing TS command definitions. Implement keyboard handler hook to track leader sequences and debounced keys (interrupt/exit). |
| `diff.DiffComponent` | Full-screen diff overlay, syntax highlight | Use `diff` + `cli-highlight` or `shiki` for syntax, overlay with Ink `<Box>` taking full width/height. |
| `toast` | Temporary banners | Ink component anchored top-right/bottom. Manage lifetime via `setTimeout`. |
| `status.StatusComponent` | Bottom status bar, git/cwd, model info, tool telemetry | Compose `<Box>` rows with computed spans; reuse existing TS providers for data (git/cwd logic already in TS). |
| `modal` | Session selector, rename dialog, login prompt | Portal-like Ink component triggered via context state. |
| `qr` | ASCII QR codes for login flows | Use `qrcode-terminal` library. |
| `list` | Generic selection lists (sessions, models) | Build re-usable Ink list component with highlight + filtering support. |
| `app.State` persistence | Recents, toggles, history stored as TOML | Reuse existing TS persistence utilities (`Config`, `Session`, `Storage`) or port `state.go` logic to TS module. |

### Phase 3 — Infra & packaging
- Decide on runtime: require Bun/Node, or explore `bun build --compile` for native binaries.
- Update CLI entrypoint to detect and launch Ink version (guarded by env flag for beta testers).
- Ensure cross-platform behavior (macOS, Linux, Windows). Test terminal compatibility (colors, resizing, mouse scroll).
- Integrate CI (lint, tests) for new TUI. Reuse `vitest` for component tests similar to Continue’s `extensions/cli/src/ui/__tests__`.

### Phase 4 — Feature completion & rollout
- Incrementally port features from Go components, verifying against feature checklist.
- Provide fallback to Go TUI until Ink reaches parity (controlled by flag).
- Document migration path for users (release notes, README updates).

## 4. Risks & Considerations
- **Performance:** Node/Ink startup will be slower than Go. Need benchmarks; possibly mitigate by keeping Go binary as optional fast mode.
- **Key handling:** Reimplement complex keybindings (leader sequences, debounced interrupt/exit) carefully to avoid regressions.
- **Streaming:** Ensure Ink rendering remains responsive during long-running operations (might require throttling updates or using `ink`’s `<Static>` regions).
- **Terminal capability detection:** Continue uses contexts to manage width/height; we must replicate status line/bottom bar layout across different terminal sizes.
- **Packaging:** If we depend on Bun/Node availability, document prerequisites; bundling standalone binaries increases maintenance.
- **Testing:** Snapshots for Ink components can be brittle—need a test story (Continue uses `vitest` + Ink render tests).

## 5. Next Actions
1. Track this work in an issue (see draft below).
2. Stand up `tui-poc.tsx` and benchmark.
3. Produce a detailed feature parity checklist with owners/estimates.
4. Decide on packaging strategy early to avoid surprises late in migration.

### Draft GitHub issue summary
- Title: “Evaluate migrating Go-based TUI to Ink”
- Checklist covering research, POC, packaging, parity plan, report back with recommendation.

---

**References**
- Opencode Go TUI source: `packages/tui/internal/**/*`
- CLI launcher: `packages/opencode/src/cli/cmd/tui.ts`
- Continue Ink CLI (for ideas): `/Users/jonathanhaas/Documents/Dev/continue/extensions/cli`
