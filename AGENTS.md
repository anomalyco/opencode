# moks

This repo is the product. moks is to talent acquisition what OpenCode is to software engineering.

**Code is everything** means the *shape* of agentic work is domain-portable: workspace, plan, tools, permissions, local working copy, remote system of record, review, and push. We do **not** rebuild the harness. We rewrite the job from “ship software” to “fill reqs / move candidates with evidence.”

People are not files. The working set is materials, records, and drafts.

Strategy: `docs/gtm.html`.

## Ontology (locked)

The company folder is the workspace (the repo). A req is a subdirectory you focus (a package). Cards stay markdown working copies. People are not files.

```
<company>/                    ← workspace root
  HIRING.md                   ← company constitution
  <req>/                      ← a requisition
    HIRING.md                 ← req constitution
    candidates/<id>.md        ← working copies
  .moks/                      ← cache only (plans, ats.json)
```

| Piece | Role |
|-------|------|
| workspace root | the company |
| company `HIRING.md` | company constitution |
| `<req>/` | a requisition |
| `<req>/HIRING.md` | req constitution (scorecard, must-haves, process) |
| `<req>/candidates/<id>.md` | working copies (score, outreach, notes) |
| focus (`@<req>` or last-focused req) | working set this turn |
| `moks commit` | git audit of a decision |
| `moks push` | the write (local/mock ATS now; remote later) |
| `.moks/` | cache at company root. Not a hiring book |
| `~/.config/moks/HIRING.md` | this recruiter’s global constitution |

`/init` at the company root scaffolds a req directory. A root that itself has `HIRING.md` + `candidates/` is a single-req workspace (fixture / one-req company).

The filesystem is the book. Do not invent `.moks/reqs/`. Do not build a cloud req picker. Do not treat a parent software repo as the company.

## Porting rule

Mold the harness. Do not rebuild it.

Keep: session runner, permissions, MCP host, skill loader, multi-provider, plan-mode machinery, diff plumbing.

Change: prominence, defaults, copy, agent wiring, workspace paths.

| OpenCode | moks | Wrong port |
|----------|------|------------|
| Repo / project | Company folder is the workspace | One git remote per req; cwd-only req |
| `AGENTS.md` | `HIRING.md` at company + per req | `/init` still writes coding AGENTS.md |
| GitHub | ATS (Ashby later) | GitHub recruiting as the product |
| Working tree | company + focused req packet | Cloud ATS with no local drafts |
| Diff | Local hiring file deltas | Delete diff, or only show remote ATS |
| `git commit` | `moks commit` | Raw `git commit`; commit with no push path |
| `git push` | `moks push` | Silent ATS writes from the agent |
| PR review | `/review` packet review | `/review` still runs `gh pr` |
| `build` doer | `recruit` | Rename the binary; keep `build` default |
| Plan → implement | Plan → execute hiring steps | Plan → generate recruiting software |
| Explore codebase | Explore HIRING.md / cards / notes | Explore → OSINT-only agent |
| LSP / formatters | Not a TA surface (defaults off) | TA-LSP metaphor, or delete the subsystem |

Default loop: open company → `/init` a req → focus it → load that `HIRING.md` → score onto the card → draft outreach → `/review` → `moks commit` → `moks push`.

Cast: `recruit` is the doer. Plan stays and exits to `recruit`. There is no coding agent. Skills: `req-context`, `score-candidate`, `draft-outreach`, `commit-disposition`.

We do **not** use product moks to code this repo. Day-to-day engineering is the installed coding agent. Monorepo `.opencode/` configures that agent. It is not product code.

## Product path

Work lives in `packages/moks` (CLI / TUI / server), `packages/core`, and `packages/tui`, plus what those import (`plugin`, `protocol`, `schema`, `server`, `sdk/js`, `llm`).

Folder `packages/moks` and npm names `@moks/*` are the product. Monorepo `.opencode/` is the installed coding agent that edits this repo — not product code.

Do not bring back pruned company surfaces (desktop, console, web, app, SST). Do not ship under OpenCode install names. MIT stays; keep existing copyright notices; add moks copyright only on new work.

Product identity is isolated: `moks.json` / `.moks/` / `MOKS_*` / `~/.config/moks`. Ignore `opencode.json`, `.opencode/`, and `OPENCODE_*`.

## Repo

Hard fork of OpenCode (`anomalyco/opencode` → `artemysone/moks`). OpenCode is lineage and the installed coding agent that edits this repo — not what we ship. No official affiliation.

| Remote | Points at | Role |
|--------|-----------|------|
| `origin` | `artemysone/moks` | push |
| `upstream` | `anomalyco/opencode` | reference only |

- Default branch: `dev`. Push to `origin`.
- Do not merge `upstream/dev`. Cherry-pick a provider/kernel fix only if needed.
- Runtime is Bun (`bun install`, `bun dev`). Do not make pnpm/npm the primary workflow.
- Do not edit `~/.config/opencode` or `~/.local/share/opencode` unless asked.

## Monorepo

- To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit `src/generated` or `src/generated-effect` directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk-next` composes Client, Core, and Server.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `candidate-cards`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify hiring diff title`, `docs: update contributing guide`, `feat(product): score onto candidate cards`.

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
- In Effect generators, bind services to named variables before calling methods. Do not use nested service yields such as `yield* (yield* Foo.Service).bar()`.

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
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@moks/core/project"`, then reference `Project.ID`.
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
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/moks`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/moks`), never `tsc` directly.

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
