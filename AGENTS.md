- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/loreai) -->
## Long-term Knowledge

### Architecture

<!-- lore:4e7ecb18-e26f-4f13-a50e-567eda334a64 -->
* **Nuum eval baseline score: 72.6% on LongMemEval oracle**: Nuum eval scores (LongMemEval oracle, 500 questions, claude-sonnet-4-6): Baseline 72.6%, v1 73.8%, v2 final 88.0% (+14.2pp over v1). Key category gains: multi-session 85.1% (+20.6pp), temporal-reasoning 81.9% (+22.8pp), single-session-assistant 96.4% (recovered from 57.1% regression). Coding eval (15 questions): Default 10/15 (66.7%), Nuum 14/15 (93.3%). Results in eval/results/. Coding eval has two modes: Default uses 80k tail window (no tools), Nuum injects distilled observations + recall tool for FTS search fallback.

<!-- lore:8afece67-a241-4000-983a-d20d2822082e -->
* **Nuum incremental distillation: trigger on maxSegment threshold during session**: Nuum incremental distillation triggers backgroundDistill when undistilled message count >= config.distillation.maxSegment (default 50) during active sessions, instead of waiting for session.idle. Fires in message.updated handler after temporal.store() on completed assistant messages. session.idle remains as catchall. This prevents oversized first distillation batches (306+ msgs) that lose early detail. Priority order: (1) incremental distillation, (2) observer prompt refinements, (3) cross-session entity merging. Only applies to active sessions — historical ones need explicit backfill.

<!-- lore:019ca60f-977a-7c12-b9b1-11d2b056b587 -->
* **OpenCode web UI served via CDN proxy, no local static serving**: OpenCode web UI build/serve architecture: Binary embeds web UI via Bun's file loader. build.ts runs \`bun run build\` in packages/app, scans dist/, generates a manifest module importing each file with \`{ type: 'file' }\`. Font filtering excludes optional fonts (~27MB savings); only Inter + IBM Plex Mono embedded, others fall through to CDN proxy. \`static-asset-loader\` Bun plugin handles non-JS files (HTML/CSS/image entrypoints cause bundler errors otherwise — content hashes in $bunfs paths require manifest lookup). Pre-bootstrap middleware in server.ts serves embedded assets BEFORE \`Instance.provide()\` to avoid DB migration checks on every static request (checks \`isAsset(path)\` via extension, returns early for non-API). Resolution: embedded $bunfs → OPENCODE\_APP\_DIR env → auto-detect packages/app/dist → CDN proxy (app.opencode.ai). SPA fallback: page routes get index.html; asset misses fall through to CDN. CSP on HTML. Dev: separate Vite + \`opencode serve --port 4096\`.

<!-- lore:019cab46-25f9-741a-94bd-a9b25450ba4c -->
* **OpenCode web UI: no virtualization, progressive turn backfill with mobile jank**: OpenCode web UI virtualization + perf: Uses virtua/solid — \`VList\` when list IS scroll container (sidebar in LocalWorkspace); \`Virtualizer\` with \`scrollRef\` when parent owns scroll (message timeline uses ScrollView viewport). Old \`createTimelineStaging\` rAF system removed. Shared \`allMessages\` memo computed once in \`MessageTimeline\`, passed as prop to \`SessionTurn\` (fallback to internal derivation if prop absent) — fixes N+1 subscription problem where each turn's \`createMemo(() => list(data.store.message\[sessionID]))\` caused all turns to re-derive on any update. Pre-built \`childMapByParent\` threaded through \`sessionPermissionRequest\` avoids O(n²). GlobalSyncProvider non-blocking. Vite manual chunks for katex, kobalte, luxon, diffs. Index ~1822KB (501KB gzip), diffs 1MB. For 50 sidebar + 100 turns, reactive computations dropped ~3050→260 (12x).

### Gotcha

<!-- lore:019cb3d2-04b4-711f-83f8-129c8588f70c -->
* **anomalyco/opencode PR requires linked issue or auto-closes in 2h**: anomalyco/opencode PR/issue bot policies: (1) PRs require \`Closes #\<number>\` in description + linked issue or auto-close in 2h (bots: \`check-compliance\`, \`check-standards\`). Issues must use required template (Bug Report/Feature Request/Question) with matching \`### Heading\` sections or also auto-close. Bot-closed issues (\`not\_planned\`) can't be reopened — create new. Use \`gh issue create --template bug-report.yml\`. (2) PR titles must use conventional commit prefix: \`feat:\`, \`fix:\`, \`docs:\`, \`chore:\`, \`refactor:\`, \`test:\` (optional scope). \`perf:\` NOT allowed — use \`chore(scope):\` or \`fix(scope):\`. Check via pr-standards workflow on \`pull\_request\_target\`. BYK is not in TEAM\_MEMBERS, so applies to our PRs.

<!-- lore:019cb9de-4f04-7cc4-8e0a-db7e9f5ffb3d -->
* **Archived session event-reducer wipes caches when session.updated fires with time.archived**: In event-reducer.ts, \`session.updated\` with \`info.time.archived\` removes the session from store and calls \`cleanupSessionCaches()\`. If a user views an archived session and any update fires, UI loses all data. Two-part fix applied: (1) Backend: \`Session.touch()\` now sets \`time\_archived: null\` to auto-unarchive. (2) Frontend: \`cleanupSessionCaches()\` removed from archived branch — only \`session.deleted\` cleans up permanently.

<!-- lore:019d4a08-25aa-74d5-b1d5-e873af6e1bcd -->
* **Biome formatter runs check --write which removes unused imports during partial edits**: OpenCode's biome formatter default command was \`biome check --write $FILE\` which applies lint auto-fixes including \`noUnusedImports\` removal — not just formatting. When the agent adds an import in one edit and the usage in a subsequent edit, biome removes the "unused" import between edits. Fix: use \`biome format --write $FILE\` in packages/opencode/src/format/formatter.ts (~line 107) which only applies formatting. The biome LSP separately surfaces lint diagnostics. Users wanting old behavior can override via \`formatter.biome.command\` in opencode config.

<!-- lore:3ed3e973-7706-464a-afa9-2152c55e7b6a -->
* **Nuum eval sessions pollute session list without hidden root**: Nuum eval harness must create all eval sessions as children of a hidden root session — OpenCode hides child sessions from the main list. Without this, eval runs produce ~4000 top-level sessions. The eval root is created once in main() before the concurrency pool starts. Also: backfilled distillations for actively-used sessions get replaced when the live plugin runs distillation cycles — only inactive sessions retain stable backfilled segments.

<!-- lore:bb4dd0c6-f96e-48d5-b547-134f8a0b0b13 -->
* **Nuum FTS5 content-sync purge: must rebuild index after content table deletes**: When temporal messages are deleted from the temporal\_messages content table (e.g., during orphan reset or cleanup), the FTS5 index (temporal\_fts) becomes stale because FTS5 content= tables don't auto-sync deletes. Fix: rebuild the FTS5 index after content table deletes using INSERT INTO temporal\_fts(temporal\_fts) VALUES('rebuild'). Committed as 1d02e1d. Without this, FTS5 searches can return stale results or crash on deleted rowids.

<!-- lore:019caeed-917e-7676-9604-e5d3b8033b57 -->
* **OpenCode app-manifest.ts stub must be committed for CI**: packages/opencode/src/server/app-manifest.ts is generated by the build script (build.ts) when compiling the binary, but CI needs a valid module at import time. Solution: commit a stub file exporting \`{}\` and remove it from .gitignore. The build script overwrites it locally during binary compilation. Without the stub, CI typecheck and tests fail on missing module.

<!-- lore:019cab46-2cf6-71e0-9eac-99a8785ba1d7 -->
* **OpenCode binary: OPENCODE\_MIGRATIONS define required for compiled binaries**: In compiled binaries, \`import.meta.dirname\` resolves to \`/$bunfs/root\`, so \`path.join(import.meta.dirname, '../../migration')\` becomes \`/$bunfs/migration\` which doesn't exist. The code in storage/db.ts checks \`typeof OPENCODE\_MIGRATIONS !== 'undefined'\` first — this define should contain the migration SQL array serialized at build time. Without it, the TUI crashes with \`ENOENT: scandir '/$bunfs/migration'\`. The stable release build must set this define; the dev build script was missing it.

<!-- lore:019cd290-5a19-77bd-86bc-c475a4fea911 -->
* **OpenCode channel-based DB naming causes session loss on branch builds**: When compiling opencode from a non-release branch, \`Script.channel\` resolves to the git branch name (e.g. \`web-ui-virtualization\`), and the DB path becomes \`opencode-\<branch>.db\` instead of \`opencode.db\`. Sessions created with a release binary (channel \`latest\`/\`beta\`) or dev mode (\`local\`) live in \`opencode.db\` and become invisible. Fix: set \`OPENCODE\_CHANNEL=latest\` at build time or \`OPENCODE\_DISABLE\_CHANNEL\_DB=1\` at runtime. The channel logic is in \`packages/opencode/src/storage/db.ts\` and \`packages/script/src/index.ts\`. Data is never deleted — it's just in a different SQLite file.

<!-- lore:019caeed-91bb-73d2-8044-bf3f9a16f147 -->
* **OpenCode Session.get NotFoundError class mismatch in TUI error handler**: Session.get() throws \`db.NotFoundError\` but the TUI's \`tui.selectSession\` onError handler checked \`instanceof Storage.NotFoundError\` — a different class. Both share \`name === "NotFoundError"\` but are distinct constructors. Fix: also check \`err.name === "NotFoundError"\` to cover both error classes. Without this, selecting a deleted/missing session causes an unhandled 404 crash instead of graceful recovery.

<!-- lore:019caedf-91c7-79a5-8357-7f13a532f36b -->
* **OpenCode worktrees accumulate massive .test-tmp dirs — clean periodically**: OpenCode worktrees at \`~/.local/share/opencode/worktree/\` accumulate massive \`.test-tmp/\` dirs (14+ GB in getsentry/cli). Worktrees are ephemeral — safe to delete entirely between sessions. Targeted: \`rm -rf ~/.local/share/opencode/worktree/\*/.test-tmp\`. Also: \`git checkout main\` fails because main is used by the worktree. Workaround: always use \`origin/main\` — \`git checkout -b \<branch> origin/main\` or rebase onto \`origin/main\`, never the local \`main\` branch.

<!-- lore:019da534-c788-76f0-8eb6-20e7a34f762f -->
* **Question dock scroll chain: 4-level flex with overflow: clip on DockShell**: Question dock (plan\_exit modal) issues cluster: (1) Scroll chain — \`DockShell\` needs \`overflow: hidden\` not \`clip\` (blocks descendants); \`dock-prompt\` needs \`overflow: hidden\` (max-height alone doesn't clip); \`\[data-dock-surface="shell"]\` and \`\[data-slot="question-body"]\` are the SAME element, both need \`flex: 1; min-height: 0\`; \`question-content\` needs direct \`max-height: calc(var(--question-prompt-max-height, 70dvh) - 140px); overflow-y: auto\`; \`question-options\` must NOT have nested scroll. (2) Focus auto-scrolls to bottom — use \`focus({ preventScroll: true })\` in \`focus()\` helper. (3) Text not selectable — add \`\[data-slot="question-text"]\` to user-select allow-list in message-part.css (~L691-703); button children need explicit opt-in. (4) Tap-to-collapse — \`minimized\` prop on \`DockPrompt\` wraps content in \`\<Show>\`, header title needs \`flex: 1; cursor: pointer; min-width: 0\`; feature lives only in cumulative branch, lost on rebases.

<!-- lore:019d2bc9-e305-7851-b634-52a79c5ce8b6 -->
* **SDK auth.set property name changed across SDK regenerations**: The OpenCode v2 SDK's \`auth.set()\` method parameter name for credentials changed between SDK generations — from \`body\` to \`auth\` (or vice versa) depending on the OpenAPI annotation. After rebasing, app code using \`body:\` failed typecheck because the regenerated SDK now expects \`auth:\`. The desktop/electron packages use \`tsgo -b\` with project references, resolving SDK types from source — so mismatches surface there first. Always check SDK type signatures after rebase if auth-related code fails typecheck.

<!-- lore:019d1544-eb64-7eb9-a905-96c1e5b8b217 -->
* **SessionPrompt.prompt() tools param overwrites session permissions**: In \`SessionPrompt.prompt()\` (prompt.ts ~L172-183), the \`tools\` parameter is converted to a permission ruleset and \*\*overwrites\*\* \`session.permission\` via \`Session.setPermission()\`. Permissions set during \`Session.create()\` are lost. To deny a tool in a subagent, it must appear in BOTH the \`Session.create()\` permission array AND the \`tools\` map passed to \`SessionPrompt.prompt()\` (as \`toolName: false\`). The task tool was missing \`plan\_exit: false\` and \`plan\_enter: false\` in its tools map, so those deny rules from session creation were silently overwritten. Fixed by adding both to the tools map in task.ts line ~147.

### Pattern

<!-- lore:61332766-4401-4846-a3a6-d8f9e94628dd -->
* **Nuum distillation prompt: exhaustive assistant output capture**: Nuum distillation prompt must exhaustively capture assistant-generated content: record EVERY list item with distinguishing attributes, preserve exact ordering for numbered lists, preserve quantities/ratios/temperatures for recipes, names/locations/prices for recommendations. Use 🟡 priority but never skip details. Under-capturing caused a -26.8pp regression on single-session-assistant (57.1% vs 83.9%). After expanding DISTILL\_SYSTEM prompt with detailed rules and good/bad examples, score jumped to 96.4%. The regression was entirely a prompt coverage issue.

<!-- lore:019d79ab-d3e3-7cdd-9a80-dc6c73863999 -->
* **OpenCode auto-discovers project icons from favicon files in worktree**: Project.discover() (project.ts ~L327-347) globs \`\*\*/favicon.{ico,png,svg,jpg,jpeg,webp}\` in the worktree, picks the shortest path match, base64-encodes it, and stores as \`icon.url\`. Runs once on first project load — skips if \`icon.override\` or \`icon.url\` already set (lines 329-330). Won't re-run for existing projects. OpenCode's own repo also has a hardcoded fallback: \`OPENCODE\_PROJECT\_ID\` check in the UI forces \`https://opencode.ai/favicon.svg\`. To get auto-icon for any project, drop a \`favicon.svg\` at repo root before first open. For existing projects, either edit via right-click → Edit Project dialog, or clear the project's cached layout data to trigger re-discovery.

<!-- lore:019da534-c79a-70b3-84ab-d14b042e9507 -->
* **OpenCode notification dots persist via IndexedDB across page refreshes**: Red dot on project icons = \`notification.project.unseenCount(directory) > 0\` in app/src/pages/layout/sidebar-items.tsx. Store is persisted via \`Persist.global("notification")\` → IndexedDB \`opencode:global:notification\`. Hard refresh doesn't clear. To clear: right-click project → "Clear notifications" context menu (calls \`project.markViewed(directory)\`). Or manual: \`indexedDB.deleteDatabase("opencode:global:notification")\`. Notifications come from \`session.idle\`/\`session.error\` SSE events, marked viewed only when navigating to the session/project.

### Preference

<!-- lore:019cb078-0e9c-76c4-89c5-f64d051dd771 -->
* **Present plan before implementing optimizations**: When working on performance optimizations or non-trivial changes, present the plan with options to the user BEFORE diving into implementation. The user explicitly requested this after an agent eagerly implemented web UI chunk-splitting optimizations without first discussing whether it was the most impactful approach. Always outline what you intend to do and why, let the user confirm or redirect.
<!-- End lore-managed section -->
