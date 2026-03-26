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
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

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

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/opencode-lore) -->
## Long-term Knowledge

### Architecture

<!-- lore:4e7ecb18-e26f-4f13-a50e-567eda334a64 -->
* **Nuum eval baseline score: 72.6% on LongMemEval oracle**: Nuum eval scores (LongMemEval oracle, 500 questions, claude-sonnet-4-6): Baseline 72.6%, v1 73.8%, v2 final 88.0% (+14.2pp over v1). Key category gains: multi-session 85.1% (+20.6pp), temporal-reasoning 81.9% (+22.8pp), single-session-assistant 96.4% (recovered from 57.1% regression). Coding eval (15 questions): Default 10/15 (66.7%), Nuum 14/15 (93.3%). Results in eval/results/. Coding eval has two modes: Default uses 80k tail window (no tools), Nuum injects distilled observations + recall tool for FTS search fallback.

<!-- lore:8afece67-a241-4000-983a-d20d2822082e -->
* **Nuum incremental distillation: trigger on maxSegment threshold during session**: Nuum incremental distillation triggers backgroundDistill when undistilled message count >= config.distillation.maxSegment (default 50) during active sessions, instead of waiting for session.idle. Fires in message.updated handler after temporal.store() on completed assistant messages. session.idle remains as catchall. This prevents oversized first distillation batches (306+ msgs) that lose early detail. Priority order: (1) incremental distillation, (2) observer prompt refinements, (3) cross-session entity merging. Only applies to active sessions — historical ones need explicit backfill.

<!-- lore:019ca60f-977a-7c12-b9b1-11d2b056b587 -->
* **OpenCode web UI served via CDN proxy, no local static serving**: OpenCode binary embeds web UI via Bun's file loader. Build script (build.ts) runs \`bun run build\` in packages/app, scans dist/, generates a module importing each file with \`{ type: 'file' }\`. Font filtering excludes optional fonts (~27MB savings) — only Inter + IBM Plex Mono embedded; others fall through to CDN proxy. A \`static-asset-loader\` Bun plugin handles non-JS files. Pre-bootstrap middleware in server.ts serves embedded assets BEFORE Instance.provide() to avoid DB migration checks on every static request. Resolution order: embedded $bunfs → OPENCODE\_APP\_DIR env → auto-detect packages/app/dist → CDN proxy (app.opencode.ai). SPA fallback: page routes (no file extension) get index.html; asset requests (.js, .css, .woff2) that miss locally fall through to CDN. CSP header applied to HTML responses. For UI dev: separate Vite dev server + \`opencode serve --port 4096\`.

<!-- lore:019cab46-25f9-741a-94bd-a9b25450ba4c -->
* **OpenCode web UI: no virtualization, progressive turn backfill with mobile jank**: Web UI (SolidJS) uses virtua for virtualization: \`VList\` for sidebar session list in \`LocalWorkspace\`, \`Virtualizer\` with custom \`scrollRef\` for message timeline. The old \`createTimelineStaging\` rAF system was removed. Shared \`allMessages\` memo passed as prop to \`SessionTurn\` avoids N store subscriptions. Pre-built \`childMapByParent\` threaded through \`sessionPermissionRequest\` avoids O(n²) rebuilds. GlobalSyncProvider is non-blocking. Vite config has manual chunk splitting for katex, kobalte, luxon, diffs. Index bundle ~1,822KB (501KB gzip), diffs chunk 1MB (largest remaining target). For 50 sidebar items + 100 turns, reactive computations dropped from ~3,050 to ~260 (12x reduction).

### Gotcha

<!-- lore:019cb3d2-04b4-711f-83f8-129c8588f70c -->
* **anomalyco/opencode PR requires linked issue or auto-closes in 2h**: The anomalyco/opencode repo has GitHub Actions bots enforcing issue-first policy. Two bots check PRs: (1) \`check-compliance\` requires \`Closes #\<number>\` in PR description, (2) \`check-standards\` requires a linked issue. PRs without a referenced issue get a 2-hour auto-close warning. Issues must use a required template (Bug Report, Feature Request, or Question) with matching \`### Heading\` sections — free-form issue bodies get auto-closed after 2 hours too. Bug Report template requires: Description, Steps to reproduce, OpenCode version, OS headings. Bot-closed issues (state\_reason: \`not\_planned\`) cannot be reopened via API — create a new issue instead. Workflow: create issue using correct template via \`gh issue create --template bug-report.yml\`, then include \`Closes #\<number>\` in PR body.

<!-- lore:019cb9de-4f04-7cc4-8e0a-db7e9f5ffb3d -->
* **Archived session event-reducer wipes caches when session.updated fires with time.archived**: In event-reducer.ts, \`session.updated\` with \`info.time.archived\` removes the session from store and calls \`cleanupSessionCaches()\`. If a user views an archived session and any update fires, UI loses all data. Two-part fix applied: (1) Backend: \`Session.touch()\` now sets \`time\_archived: null\` to auto-unarchive. (2) Frontend: \`cleanupSessionCaches()\` removed from archived branch — only \`session.deleted\` cleans up permanently.

<!-- lore:019cab46-2cf0-78c7-84a0-773974dd13fa -->
* **Bun compile: non-JS entrypoints cause bundler errors**: Passing HTML/CSS/image files as Bun.build() entrypoints causes resolution errors — Bun tries to parse HTML as a bundle entry and follow asset references in CSS. Fix: use a Bun plugin with \`onLoad\` returning \`{ contents, loader: 'file' }\` for non-JS files. This tells Bun to embed them as opaque assets. Generate a manifest module that \`import\`s each file with \`{ type: 'file' }\` to get their $bunfs paths at runtime. Content hashes in $bunfs paths (\`/$bunfs/root/file-abc123.png\`) make direct path construction impossible — the manifest lookup is required.

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

<!-- lore:019cab46-2cf2-76a2-8e93-6b2307e54c9c -->
* **OpenCode server: static middleware must precede Instance.provide()**: In server.ts, Instance.provide() middleware runs DB migrations via InstanceBootstrap for every request. Static file serving (embedded $bunfs, local dir, or CDN proxy) MUST be a middleware before Instance.provide() that returns early for non-API paths. The current implementation checks \`isAsset(path)\` (file extension check) or SPA routes, serves them directly, and only calls \`next()\` for API routes. Without this ordering, every CSS/JS/image request triggers migration checks and fails with ENOENT in compiled binaries.

<!-- lore:019caeed-91bb-73d2-8044-bf3f9a16f147 -->
* **OpenCode Session.get NotFoundError class mismatch in TUI error handler**: Session.get() throws \`db.NotFoundError\` but the TUI's \`tui.selectSession\` onError handler checked \`instanceof Storage.NotFoundError\` — a different class. Both share \`name === "NotFoundError"\` but are distinct constructors. Fix: also check \`err.name === "NotFoundError"\` to cover both error classes. Without this, selecting a deleted/missing session causes an unhandled 404 crash instead of graceful recovery.

<!-- lore:019caedf-91c7-79a5-8357-7f13a532f36b -->
* **OpenCode worktrees accumulate massive .test-tmp dirs — clean periodically**: OpenCode worktrees at \`~/.local/share/opencode/worktree/\` accumulate massive \`.test-tmp/\` dirs (14+ GB in getsentry/cli). Worktrees are ephemeral — safe to delete entirely between sessions. Targeted: \`rm -rf ~/.local/share/opencode/worktree/\*/.test-tmp\`. Also: \`git checkout main\` fails because main is used by the worktree. Workaround: always use \`origin/main\` — \`git checkout -b \<branch> origin/main\` or rebase onto \`origin/main\`, never the local \`main\` branch.

<!-- lore:019d1544-eb64-7eb9-a905-96c1e5b8b217 -->
* **SessionPrompt.prompt() tools param overwrites session permissions**: In \`SessionPrompt.prompt()\` (prompt.ts ~L172-183), the \`tools\` parameter is converted to a permission ruleset and \*\*overwrites\*\* \`session.permission\` via \`Session.setPermission()\`. Permissions set during \`Session.create()\` are lost. To deny a tool in a subagent, it must appear in BOTH the \`Session.create()\` permission array AND the \`tools\` map passed to \`SessionPrompt.prompt()\` (as \`toolName: false\`). The task tool was missing \`plan\_exit: false\` and \`plan\_enter: false\` in its tools map, so those deny rules from session creation were silently overwritten.

<!-- lore:019caf6c-039b-7e0d-b3e0-1188dfab049b -->
* **SessionTurn allMessages N+1 subscription problem**: Each \`SessionTurn\` component internally creates \`createMemo(() => list(data.store.message\[sessionID]))\` — subscribing every turn instance to the same reactive store path. When any message updates, ALL turns re-derive their memo. Fix: compute \`allMessages\` once in the parent (\`MessageTimeline\`) and pass via optional \`messages\` prop. \`SessionTurn\` falls back to internal derivation when prop is absent (backwards compatible). This eliminates N redundant store subscriptions per session, critical for sessions with 100+ turns.

### Pattern

<!-- lore:61332766-4401-4846-a3a6-d8f9e94628dd -->
* **Nuum distillation prompt: exhaustive assistant output capture**: Nuum distillation prompt must exhaustively capture assistant-generated content: record EVERY list item with distinguishing attributes, preserve exact ordering for numbered lists, preserve quantities/ratios/temperatures for recipes, names/locations/prices for recommendations. Use 🟡 priority but never skip details. Under-capturing caused a -26.8pp regression on single-session-assistant (57.1% vs 83.9%). After expanding DISTILL\_SYSTEM prompt with detailed rules and good/bad examples, score jumped to 96.4%. The regression was entirely a prompt coverage issue.

<!-- lore:019caf6c-0398-7eab-8bc6-7b68535a5c19 -->
* **virtua SolidJS integration: VList vs Virtualizer**: In the OpenCode web UI, \`VList\` from \`virtua/solid\` is used when the virtualized list IS the scroll container (e.g., \`LocalWorkspace\` sidebar). \`Virtualizer\` is used when a parent element owns the scroll container — pass it via \`scrollRef\` prop captured from the parent's ref callback. For the message timeline, \`Virtualizer\` references \`ScrollView\`'s viewport element. The \`Virtualizer\` renders items inside an existing layout; \`VList\` creates its own scrollable div. Both accept \`data\` array + render children callback. Key: \`VList\` replaces \`overflow-y-auto\` on parent; \`Virtualizer\` works within it.

### Preference

<!-- lore:019cb078-0e9c-76c4-89c5-f64d051dd771 -->
* **Present plan before implementing optimizations**: When working on performance optimizations or non-trivial changes, present the plan with options to the user BEFORE diving into implementation. The user explicitly requested this after an agent eagerly implemented web UI chunk-splitting optimizations without first discussing whether it was the most impactful approach. Always outline what you intend to do and why, let the user confirm or redirect.
<!-- End lore-managed section -->
