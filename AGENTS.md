- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
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

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

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

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

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

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.

## Custom Features

These are project-specific features added on top of upstream opencode. Document any new one here so future agents can extend it without re-deriving the design.

### Queued follow-ups (the "chain" feature)

**What it does.** Lets the user queue follow-up messages from the prompt that fire **only after the agent has completely finished the current turn** — not mid-turn. The default TUI behavior of typing while busy uses `steer` delivery, which can inject between provider steps; the chain feature instead waits for true idle. Messages chain: each waits its turn, runs to full completion, then the next runs. Mixed permutations of the three variants chain correctly.

**Three variants (slash commands typed in the prompt):**

- `/queue <msg>` — kind `"followup"`. Plain follow-up in the **same** session, sent after the current turn fully completes.
- `/queue-com <msg>` — kind `"compact"`. Compacts the **same** session first (a compaction checkpoint slices model context server-side and renders as the visible boundary), then answers in place. No new chat.
- `/queue-new <msg>` — kind `"fresh"`. Opens a **brand-new standalone** session and answers there. Must NOT set `parentID` — a `parentID` makes opencode render the session as a sub-agent and hides the prompt input (see `packages/tui/src/routes/session/index.tsx` `visible` memo, ~line 235).

**Queue management commands:**

- `/queue-edit-N` — load queued message N (1-based) into the prompt for editing. Enter applies (`chain.update`), empty input leaves it unchanged, Esc cancels. If the edited job is consumed mid-edit, the edit is discarded and the draft restored (a `createEffect` watches `chain.has(id)`).
- `/queue-remove-N` — remove queued message N (1-based) from the queue. Cancels the edit first if that job is being edited.

**Architecture (TUI-only; ephemeral — jobs live in memory, lost on TUI restart, like the upstream queue).**

- `packages/tui/src/context/chain.tsx` — the orchestrator context (`ChainProvider` / `useChain`). Holds a `createStore` of `{ jobs: ChainJob[], running: boolean }`. Exposes `jobs`, `running`, `enqueue`, `update`, `remove`, `has`, `clear`.
  - `pump()` is a single-flight async loop (guarded by `store.running`) that processes jobs FIFO. It threads a `head` session forward: a `fresh` job advances the head to its new session; `followup`/`compact` keep it. `head ?? job.sessionID` seeds the first job from where the command was typed.
  - `dispatch(job, sourceID)` waits for the source turn to fully finish (`waitForIdle`), then per kind: `followup` → `prompt` same session; `compact` → `summarize` (which awaits compaction server-side before resolving, so no extra status polling) then `prompt`; `fresh` → `create` (no `parentID`) + `navigate` + `prompt`. Returns the session the message landed in (the next head).
  - `waitForIdle`/`waitForBusy` poll `sync.session.status(sessionID)` (returns `"idle"`/`"working"`/`"compacting"`, see `packages/tui/src/context/sync.tsx` ~line 567). After each dispatch the pump calls `waitForBusy(ranIn)` so the next job doesn't read a stale `"idle"` from the just-finished turn.
- `packages/tui/src/app.tsx` — `<ChainProvider>` is mounted just inside `<LocalProvider>`, **above** the session route, so a `/queue-new` navigation doesn't tear down the queue.
- `packages/tui/src/component/prompt/index.tsx` — in `submitInner`, intercepts (before any server call) `/queue`, `/queue-com`, `/queue-new` (longest-name-first regex so prefixes don't collide), `/queue-edit-N`, and `/queue-remove-N`. Also: edit-mode state (`editingJobID` signal, `beginEditJob`/`endEditJob`), the mid-edit cancellation effect, the Esc-to-cancel binding, the edit-mode placeholder/highlight, and the per-job rectangles rendered above the input (`<For each={chain.jobs}>` with serial number, kind tag, one-line truncated text).
- `packages/tui/src/component/prompt/autocomplete.tsx` — registers `/queue`, `/queue-com`, `/queue-new` static entries plus dynamic `/queue-edit-N` and `/queue-remove-N` entries (one pair per queued job, with a text preview). All gated on an active `sessionID`.

**Key invariants for future edits:**

- `parentID` must stay omitted for `fresh` sessions (else the prompt is hidden).
- `session.create` takes `model: { id, providerID, variant }`; `session.prompt` takes `model: { providerID, modelID }`. Don't mix these.
- `summarize` resolves only after compaction is written server-side — rely on the awaited promise, don't add status polling after it (a no-op summarize would otherwise stall on a `waitForBusy` timeout).
- Reactivity: reads of `chain.jobs` / `chain.has(...)` inside a `createMemo`/`createEffect`/`<For>` are tracked by SolidJS dynamically; no need to wrap them.
