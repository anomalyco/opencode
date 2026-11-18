- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit generated client files directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk` composes Client, Core, and Server.
- Current implementation changes belong in `packages/core`, `packages/cli`, `packages/server`, `packages/protocol`, `packages/schema`, and related generated client surfaces when required.
- This repository does not use Changesets. Do not add `.changeset` files; follow the existing release workflow instead.
- The default branch in this repo is `integration-v2` (`origin/integration-v2` on `shuv1337/shuvcode`). Upstream OpenCode V2 development happens on `dev`, the default branch of `anomalyco/opencode` (`upstream/dev`). Upstream promoted V2 to `dev` in `5caf1f9f6f`; `upstream/v2` stopped at `4617210822` (2026-10-10) and is no longer a sync source. There is no `origin/v2`.
- Default new branches and worktrees to `integration-v2`, or `origin/integration-v2` when the local `integration-v2` ref is unavailable, and default pull requests to target `integration-v2` on `origin`, not `upstream`. Use another base or target branch when the requester explicitly instructs it.
- Local `main` ref may not exist; use `integration-v2` or `origin/integration-v2` for diffs. Use `upstream/dev` to compare with or sync from upstream. If upstream moves V2 work again, confirm the current default with `git ls-remote --symref upstream HEAD` before syncing.
- Before syncing `upstream/dev` into `integration-v2`, run `git fetch upstream dev` and refresh fork refs with `git fetch --prune origin`. Choose `base=integration-v2` when `git show-ref --verify --quiet refs/heads/integration-v2` succeeds, otherwise `base=origin/integration-v2`; verify the chosen base matches the refreshed default before continuing. Inventory local branches with `git branch --no-merged "$base"` and fork remote-tracking branches with `git for-each-ref --no-merged="$base" --format='%(refname:short)' refs/remotes/origin/`. Exclude `upstream/*` from this fork inventory.
- Review each unmerged fork branch's unique changes and PR status, distinguishing intentionally open work from fixes missing from the default. Record an explicit disposition for each: already landed by an equivalent change (with its reference), intentionally open and preserved across the sync (with its PR or work reference), a missing fix to reconcile before syncing, or obsolete work with a recorded decision. Do not automatically merge or delete every unmerged branch; landing or discarding work still requires authorization.
- Title sync PRs `chore(sync): ...` and release-prep PRs `chore(release): ...`, or add the `upstream-sync` label. Either one makes `test.yml` run its `unit` and `e2e` jobs on the PR, the same suite that gates `publish.yml`. Both must pass before merge; a failure that also fails on `integration-v2` needs a recorded disposition, not a silent merge. Other PRs get only `typecheck.yml`; add the `full-tests` label to run the full suite on risky ones, such as CI, build, or cross-package runtime changes. Any PR event restarts a gated PR's suite, including description edits and new labels; batch those edits while the suite runs.
- When a pull request changes more than 300 files, fetch it (`git fetch origin pull/<number>/head`) and review the complete change with `git diff <base>...FETCH_HEAD`. GitHub's diff endpoint returns HTTP 406 past that cap, so `gh pr diff` and Plannotator `--no-local` omit file hunks. Inspect how a merge commit resolved conflicts with `git show --remerge-diff <merge-commit>` (`git log` accepts the same option).

## Shuvcode Fork

This tree is the Shuvcode fork of upstream OpenCode V2, rebuilt from a pinned
upstream commit. `PLAN-fresh-v2-rewrite.md` is the map; do not undo these
identity facts when merging or refactoring:

- Package and binary are `shuvcode` (`packages/cli/package.json`); there is no
  `opencode` or `opencode2` bin. Internal imports stay `@opencode/*`.
- Versions are always `<upstream base>-shuv.<n>` (`packages/script/src/version.ts`).
  Never publish a bare upstream version under `shuvcode`.
- `Global.app` is `shuvcode`: XDG roots are `~/.config/shuvcode`,
  `~/.local/share/shuvcode`, `~/.local/state/shuvcode`, `~/.cache/shuvcode`.
  File names inside them (`opencode.json`, `opencode.db`, project `.opencode/`)
  are formats, not identity, and stay as upstream.
- Default service port is `0x1337` (`0x1338` for the `local` channel).
- Updates come from npm dist-tags on `shuvcode` / `shuvcode-node`; there is no
  curl installer and no `opencode.ai` update service.
- Publishing is guarded to `shuv1337/shuvcode` and CLI packages only
  (`packages/cli/script/publish.ts`); OpenCode infra trees (`packages/console`,
  `packages/data`, `services/*`, enterprise, desktop) stay in the repo but
  are outside fork CI and publish. Upstream relocated stats to `packages/data`,
  the API worker to `services/legacy`, and V1 web docs to `services/site`.
- Host deploys from a jj merge or other detached working copy must set
  `OPENCODE_CHANNEL=integration-v2` before `bun run --cwd packages/cli build`.
  `git branch --show-current` is empty there, and a merge working copy has no
  single bookmark, so channel inference can be ambiguous or unavailable. The
  build fails closed in that case; the explicit channel pins the intended
  database and service identity.
- The upstream Claude Agent SDK provider stays on disk
  (`packages/core/src/plugin/provider/claude-agent/**` and its tests, plus the
  optional `@anthropic-ai/claude-agent-sdk` peer and `#claude-agent-sdk`
  alias) so later syncs do not resurrect a deleted tree. It is not a Shuvcode
  provider. The guarantee is three layers, not the bundled registry alone:
  `ProviderPlugins` does not load it, `ConfigProviderPlugin` skips provider
  ids `claude-agent` and `opencode.provider.claude-agent`, and every client
  list of integrations, providers, or models calls
  `isHiddenProvider` from `@opencode/util/hidden-provider`. Do not register
  `ClaudeAgentPlugin` or `make(...)`, do not let config recreate the id, and
  do not add a list surface that omits the predicate. Anthropic in the
  product is `@shuvcode/claude-plugin` (`ClaudePlugin`). When merging
  `upstream/dev`, drop any reintroduced registration, config path, or
  user-facing surface for that provider.

## Live V2 TUI Testing

- Run `bun run dev:live` from a development worktree to test its TUI against the currently elected `shuvcode` background server and live sessions.
- Pass a directory after the script when needed, for example `bun run dev:live /path/to/project`.
- The script discovers the server with `shuvcode service status`, injects its private local credential from `shuvcode service get password`, and uses the `dev` TUI storage channel so tabs and other client-local state match the installed client.
- Prefer `dev:live` over plain `bun run dev` for this workflow. An implicit managed-service connection may replace the live server when the worktree client version differs; explicit `--server` warns and continues without replacing it.

## Live Desktop Diagnostics

- When attaching Playwright to a running desktop app, use `chromium.connectOverCDP(endpoint, { noDefaults: true })`.
- Without `noDefaults`, Playwright applies light-mode media emulation during attachment. An app following the system theme then flashes light until the connection closes. The option also preserves the existing focus and other media preferences.
- Do not emulate a color scheme or reduced-motion preference on the user's live window unless explicitly requested; use an isolated test context for those scenarios.

## V2 TUI Stories

- When a user asks for a TUI story, add a fixture-driven story under `packages/tui/src/feature-plugins/system/storybook` and register it in `index.tsx`.
- Render the real production component rather than a visual copy. Keep submissions and other side effects local to the story so it is safe to explore repeatedly.
- Expose the meaningful state dimensions through story keybindings and list them in `StoryFooter`; include a reset command when combinations can leave the fixture in a confusing state.
- Run a specific story with `OPENCODE_STORY=<story-id> bun run dev:live` from the development worktree, and exercise narrow and wide terminal sizes when layout is relevant.

## TUI Theme Tokens

- Choose theme tokens by semantic role, not by their current color. Do not use raw `theme.hue` values or borrow an unrelated semantic token to achieve a preferred appearance.
- Use `text.feedback` and `background.feedback` only for outcome or status feedback such as errors, warnings, success messages, and informational messages. Use `formfield` states for form-control text, ordinals, and selection markers, and `action` states for actions.
- If the theme does not expose a token for the required semantic role, extend the theme schema, defaults, resolution, and types with that role before using it in a component. Do not repurpose the nearest-looking existing token.
- When changing the public theme token surface, verify the built-in light and dark defaults and the custom-theme fallback path in addition to the affected TUI component.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## A/B checks against HEAD

- Copy the committed blob to a temporary file with `git show HEAD:<path>` when comparing a worktree file to HEAD.
- Leave intent-to-add index entries (`git add -N`) out of `git stash push <pathspec>`. That stash can record a tree with a duplicate path entry; pop then aborts and leaves phantom add/delete index entries until `git reset` and `git rm --cached`.

For user-facing `feat`, `fix` and `perf` PRs, add a small looping animated SVG of the change under `### Visual` in the PR body (a `svg` code block, 240×72, for example a dock growing out of the composer or spinners turning in step). Draw with `currentColor` and opacity so it works in light and dark, make the unanimated state a good still (it is shown under reduced motion), animate with CSS or SMIL only, and keep it under 8 KB with no scripts or external references. The desktop beta's "What's new" dialog shows it.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Validate unknown values once at the boundary that owns them. Pass typed values inward instead of repeating `typeof value === "object"` and property-existence checks. Do not defensively revalidate values already guaranteed by a schema, constructor, or internal type.
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Before adding complexity for a speculative or vanishingly unlikely race or security edge case, explain the concrete failure mode, likelihood, and complexity cost to the user and get their buy-in. Do not silently expand scope for theoretical robustness.
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
- Never use type-position `import("...")` references such as `Schema.declare<import("@opencode/plugin/effect/plugin").Plugin["effect"]>`. Only when two imports genuinely collide on a name and no other option exists, an aliased type import (`import type { Plugin as PluginDefinition } from "..."`) is permitted as a last resort — still strongly preferred not to.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode/core/project"`, then reference `Project.ID`.
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

### Experimental API

- An experimental endpoint lives at `/api/experimental/<group>/...`, its OpenAPI identifier is `experimental.<group>.<method>`, and it lands in the SDK as `client.experimental.<group>.<method>`. Its description says "Experimental: may change without compatibility guarantees."
- `packages/protocol/test/experimental-identifiers.test.ts` enforces the path and identifier match in both directions; the SDK namespace follows from the path.
- An experimental field or parameter on a stable endpoint goes under an `experimental` key (`experimental.<name>`), the same way config does (`config.experimental.*`).
- New endpoints and new default behaviors start experimental.
- To graduate one, move the route out of `/api/experimental`, drop the `experimental.` prefix, and note it in `CHANGELOG.md`.
- Experimental HTTP routes change without aliases: rename or remove the route, then update the callers.
- A breaking move of shipped SDK or plugin API (including moving it under `experimental`) keeps the old path and type names as deprecated aliases of the new ones until the next minor, each marked `@deprecated` with the replacement and "Removed in the next minor". Generated SDK moves get them from the codegen (`compile(..., { aliases: true })` in `packages/client/script/generate.ts`), not by hand.
- Experimental plugin hooks are named `experimental.*` (`experimental.ws.handshake`).

### Feature Flags

- When you open a PR, decide whether the change needs a flag: new user-visible behavior, risky core changes, and anything not ready to release get one; fixes, refactors, docs and tests do not.
- Gate risky behavior, or behavior that lands over several PRs, with a key and a description in `packages/schema/src/config/flag.ts`, and read it with `Flag.enabled("<key>")` from `@opencode/core/flag`.
- Flags default to on in local and dev builds and off in releases, except `optInOnly` flags (such as `full_codemode`), which require an explicit `OPENCODE_FLAGS=<key>` or `experimental.<key>: true` in every build.
- Say in the PR body which flag guards the change. The reserved switches `OPENCODE_FLAGS=all` and `experimental.all_flags: true` skip opt-in-only flags; use `all,-<key>` or `experimental.<key>: false` to opt out within the respective source.
- Ship a feature by deleting its flag and the checks that read it.

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package directories such as `packages/core`.
- Before writing or changing tests, read the matching skill in `.opencode/skills`: `unit-tests` (bun test), `tui-tests` (OpenTUI renderer tests), `app-e2e-tests` (Playwright in `packages/app/e2e`) or `component-tests` (Playwright on stories, `packages/stories`). They cover what has made tests slow or flaky in CI.

## Checks

- Run `bun run check` from the repository root as the canonical full lint and type-check verification.
- During focused iteration, run `bun typecheck` from the affected package directory (for example, `packages/core`). Never run `tsc` directly.
- Validate whitespace with plain `git diff --check`, or check formatting with Prettier (`bun run prettier --ignore-unknown --check .`). `jj diff` has no `--check` flag.
- Local `typecheck` scripts use `bun check`. CI and package publishing run `typecheck:tsc`, which uses the official TypeScript compiler (`@typescript/native`). When the two disagree, `tsc` is the source of truth; reproduce with `bun run typecheck:tsc` from the package directory.
- `bun check` aims to match TypeScript 7.1, not the `7.0.2` that `process.versions.typescript` reports (oven-sh/bun#46536). When `bun check` and `tsc` from the pinned `@typescript/native` report different errors, file a minimal, dependency-free repro at https://github.com/oven-sh/bun/issues, with the output of both. `bun check` writes no declaration files, so declaration-emit errors such as TS5088 or TS2883 are expected to appear only in `tsc`; do not report those.

## Remote port probes

- Check whether a remote port accepts connections with a timeout-bounded connect. In bash, use `/dev/tcp` under `timeout`. Otherwise use `nc -z` with a connect timeout.
- Do not use `lsof` for that probe. On macOS a read-only listener precheck can enter uninterruptible sleep and ignore `SIGTERM` and `SIGKILL`.

## Dependencies

- This workspace uses Bun's isolated linker (`configVersion` 1 in `bun.lock`; `bunfig.toml` does not set `install.linker`). `node_modules` links a package only for the workspace that declares it.
- Trace an installed package, including a transitive one, with `bun pm why <pkg>` from the repository. `bun pm ls` lists the workspace; `bun pm ls --all` lists the lockfile.
- Resolve direct dependencies from the workspace that declares them. For transitive dependencies, use `createRequire` to follow each declaring dependency. `packages/desktop` and `packages/gui-extensions` declare `lighthouse`, whose chain is `lighthouse` → `configstore` → `xdg-basedir`; neither workspace declares `configstore` or `xdg-basedir`, so resolving either directly there fails. Run this example from `packages/desktop`:

  ```bash
  bun -e '
  import { createRequire } from "node:module"
  const lighthouse = require.resolve("lighthouse")
  const configstore = createRequire(lighthouse).resolve("configstore")
  console.log(createRequire(configstore).resolve("xdg-basedir"))
  '
  ```

## Plugin Loading

- Plugins load asynchronously. Server handlers never wait for them (`Plugin.awaitActivation`), never retry until something appears, and never turn slow plugins into a timeout or 503. This applies to reads and to actions such as `rpc.call` and `vcs.init`.
- Temporary exception: endpoints that list or use providers managed policy can deny (`model.list`, `model.default`, `provider.list`, `generate.*`, `voice.*` and `websearch.query`) wait through `awaitPlugins` in `packages/server/src/location.ts`, because policy is applied by the last plugin to activate and is missing until then. Don't add new waits; this goes away once a plugin batch becomes visible only when it ends.
- The server answers with what is loaded now: lists may be empty or partial on a cold Location, and an action whose model, provider or RPC hasn't loaded yet fails with not-found. That is expected, not a bug to fix on the server.
- Clients are responsible for making sure what they need is loaded before they call. Long-lived clients refresh on the matching `*.updated` event (`model.updated`, `agent.updated`, `skill.updated`, `integration.updated`, `plugin.updated`, ...). One-shot clients (CLI commands, ACP, SDK callers) wait on their side, for example by polling `plugin.list` or the entry they need. See `packages/cli/src/services/plugin-startup.ts`.
- Running the hooks that are registered and waiting for their result is fine (for example `hooks.trigger("session", "http.request", ...)`). What is not allowed is waiting for plugins to load first: if the plugin that adds a hook hasn't loaded yet, the call runs without that hook.

## V2 Session Core

- Keep durable events minimal: record irreducible new facts and do not repeat state derivable by folding the ordered aggregate history. Enrich projections and read models with previous or derived state when consumers need self-contained views.
- Keep durable prompt admission separate from model execution. `Session.prompt(...)` publishes `session.inbox.enqueued`, whose projection inserts one durable `session_inbox` row, before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. Delivery publishes `session.inbox.delivered`; its projection consumes the inbox row and inserts the visible message in the same transaction. `session_inbox` stores only unconsumed work.
- Reusing a Session ID adopts the existing Session. Reusing a user or synthetic inbox item ID is idempotent when Session and type match: the first admission wins and the retried payload, metadata, and delivery mode are ignored, whether the item is still pending or already delivered (reconciled from the projected message without retained enqueue history). Cross-Session or cross-type reuse fails. Control items keep their operation-specific conflict behavior.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; interruption of a known but idle or locally unowned Session is a no-op, while the public API rejects an unknown Session.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per Physical Attempt and reload projected history before durable continuation. A logical Step may use generic pre-output retries, one full-context retry after continuation rejection, incomplete-stream continuation, or one overflow-compaction rebuild. Generic retries retain the logical step number and do not consume another agent-step allowance. Do not delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. A write-ahead execution claim marks a process-local busy period for restart recovery: terminal completion, failure, or user interruption releases it, while shutdown interruption and process death preserve it. Startup recovery resumes claimed Sessions with durable per-execution attempt accounting. Running subagent Jobs own recovery of the children they represent. The claim is a recovery marker, not clustered ownership, fencing, or an exactly-once guarantee.
- Keep provider-specific native compaction mechanisms in `@opencode/ai` behind `LLMClient.compact`. `SessionCompaction` chooses a summary or native compaction from the model's `compaction` setting and owns route provenance, request shrinking, the retry policy, interruption, usage accounting, and checkpoint persistence.
- Keep delivery vocabulary explicit. Prompts steer by default. At safe step boundaries, steered compaction takes priority up to the first steered move control; other steers retain enqueue order. At an idle boundary, steers take priority; otherwise exactly one queued item delivers before the runner reevaluates continuation. Inbox items may be cancelled or changed between queue and steer before delivery. Promoting new user input resets the selected agent's step allowance; a batch of steers resets it once.
- One step is one logical LLM call; its durable record covers only the model-visible span. Do not write "provider turn", and do not use bare "turn" for a single call: "turn" is reserved for the future assistant-turn unit containing all steps from prompt promotion until the session would go idle.
- Keep event replay ownership separate from clustered Session execution ownership.
- Keep the Instructions algebra and built-ins in `src/instructions`; keep instruction producers with their observed domains, and keep Session History selection plus `InstructionState` and `InstructionEntry` persistence Session-owned. `InstructionDiscovery` observes ambient global and upward-project instructions. The runner composes built-ins, discovery, guidance, and entries explicitly in `loadInstructions`; there is no instruction registry.
- `session.instructions.updated` stores changed source keys and content hashes and may freeze rendered chronological update text. Blob values live once in `instruction_blob`; the projected `instruction_state` row is the normal boundary-processing source of current and initial values. Request assembly renders the epoch baseline from stored values, while later frozen updates enter history as durable System messages. Completed compaction moves the instruction epoch; Session movement retains it so destination instruction changes are chronological, while committed revert clears it. Forks adopt the parent's newest instruction values even when copied message history ends at an earlier boundary. Unavailable sources retain the last value and block only the initial complete delta.

## Plugin state

Registries such as skills, commands, agents, tools, MCP, formatters, and the model catalog are `State`s (`packages/core/src/state.ts`). Tool registration detail is in `packages/core/src/tool/AGENTS.md`.

- Register a synchronous transform. Do not mutate a live registry. A rebuild starts from `initial()` and runs every registered transform once, in order. A transform that throws inside a plugin group drops that plugin's registrations.
- Refresh captured inputs, then `reload()`. Do not register another transform on each refresh. The plugin supervisor handles file create, edit, and delete: an edit drops the old generation and runs the new one. Config, MCP, and plugins reload the same way. Do not tell the user to quit or run `/reload` for those changes. `/reload` is `location.reload`, a separate command.
- A step keeps the snapshot it already captured. A tool written mid-step is visible on the next step of the same turn, not inside the request that is already running. Callers may retain a `get()` result; later reloads do not rewrite it.
