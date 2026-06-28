# Worktree Merge Request

A web-UI action and agent tool that squash-merges a git worktree's branch back
into the project's default branch, driven by the agent that did the work.

## Goal

When a session runs inside an isolated git worktree and has uncommitted or
committed changes, the user can ask for those changes to be merged back into the
project's main checkout without leaving the chat. The flow:

1. The user clicks **Merge into main** in the worktree session's `Changed files`
   header.
2. The UI preflights that the main checkout is clean, then prompts the current
   worktree agent to commit (no push) and call the `worktree_merge_request`
   tool.
3. The tool starts a dedicated session in the project's **main checkout** and
   instructs that session's agent to perform the squash merge there.
4. The main-checkout agent runs `git merge --squash <branch>`, commits on
   success, and aborts + reports on conflict. It never pushes, never opens a PR,
   and never removes the worktree.

## Why it is built this way

### The web UI runs on the V1 prompt path

The app sends prompts through `client.session.promptAsync(...)`
(`packages/app/src/components/prompt-input/submit.ts`), which POSTs to
`/session/{sessionID}/prompt_async`. That endpoint is handled by the **V1**
`Session.Service` + `SessionPrompt.Service`
(`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`).
The V1 `SessionPrompt.runLoop` (`packages/opencode/src/session/prompt.ts`) runs
the agent loop itself and builds the model's tool list from the **V1 tool
registry** (`packages/opencode/src/tool/registry.ts` via
`packages/opencode/src/session/tools.ts`).

The separate V2 `prompt` SDK method targets `/api/session/{sessionID}/prompt`
(`SessionV2.Service` in `packages/core/src/session.ts`), whose `SessionRunner`
reads the **V2 registry** (`packages/core/src/tool/registry.ts` + built-ins +
`ApplicationTools`). The web UI does not currently use this path.

Consequence: a tool must be registered in the **V1 registry** to be visible to
the agent the web UI actually drives. It is also registered as a V2 process-
global application tool so the feature keeps working after the UI migrates to
the V2 prompt path.

### A new backend tool is required (not a plugin)

The OpenCode plugin system cannot inject buttons or components into the web UI,
so the button is added to the app source. The merge orchestration is a backend
tool because it must create a session in a different directory (the main
checkout) and prompt it.

### `/commit` is not reused

`.opencode/command/commit.md` is defined as `commit and push`. The merge flow
must never push, so it does not reuse that command.

## Resolving the main checkout from a worktree session

A worktree session's working directory is the linked worktree, not the main
checkout. Neither the V1 `InstanceContext.worktree` field nor the V2
`ProjectV2.resolve(dir).directory` returns the main checkout for a worktree
session — both resolve to the worktree's own toplevel.

The reliable derivation, used by both implementations, is the shared git store
(`git rev-parse --git-common-dir`), which for a linked worktree resolves to
`<mainCheckout>/.git`:

```
mainCheckout = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir
```

This mirrors `packages/core/src/project/copy-strategies.ts`. Web-UI worktrees are
created on a real branch named `opencode/<name>` (not detached HEAD), so the
branch to merge is resolved with `git symbolic-ref --short HEAD` in the worktree
(`Git.branch`).

## The `worktree_merge_request` tool

Parameters:

- `summary` — user-facing description of what the worktree accomplished (the
  WHY), used to give the main-checkout agent context.
- `squashCommitMessage` — recommended squash commit message with a conventional
  prefix (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).

Behavior (both V1 and V2 implementations):

1. Require a git project.
2. Derive the main checkout from `--git-common-dir`; fail if it equals the
   worktree directory (i.e. the tool was called from the main checkout).
3. Resolve the worktree branch; fail on detached HEAD.
4. Resolve the default branch; fail if the worktree is already on it.
5. Reuse the worktree session's model for the merge session.
6. Create a session in the main checkout and fire-and-forget a prompt
   instructing it to perform the squash merge.

Returns the tracking session id, target directory, and branch.

## Visibility: worktree sessions only

`worktree_merge_request` is only advertised to the model when the session runs
inside a linked worktree. A main-checkout session never sees it, so the model
cannot try to "merge the main checkout into itself" (the tool would fail at
execution anyway, but hiding it avoids wasted turns and confusing affordances).

The visibility test mirrors the execution-time main-checkout derivation: a
session is a worktree session when its working directory differs from the
project's main checkout. Both implementations use an already-resolved value
instead of spawning git per turn:

- V1 (`packages/opencode/src/tool/registry.ts`, `tools()`): filter on
  `instance.project.worktree !== "/" && instance.directory !== instance.project.worktree`,
  the same signal the web UI uses to decide whether to show the merge button.
- V2 (`packages/core/src/session/runner/llm.ts`): filter the materialized
  definitions on `location.vcs?.store`, the shared git directory
  (`--git-common-dir`) resolved once at `Location` construction. If
  `dirname(store)` (when `store` ends in `.git`) differs from the session
  directory, it is a worktree session.

Visibility filtering is catalog exposure, not authorization. The tool still
guards at execution time and fails if invoked from the main checkout.

The squash-merge prompt instructs the main-checkout agent to:

- Confirm the main checkout is clean; stop and report dirty files otherwise.
- Confirm it is on the default branch.
- Run `git merge --squash <branch>`.
- On conflict: `git merge --abort`, do **not** auto-resolve, list conflicting
  files, tell the user to resolve manually (e.g. rebase the branch onto the
  default branch in the worktree), then stop.
- On success: `git commit` with the recommended message.
- Hard constraints: no push, no PR, no worktree removal, no unrelated edits.

## V1 implementation (the live web-UI path)

- `packages/opencode/src/tool/worktree-merge-request.ts` — tool definition;
  derives the main checkout, resolves branch and default branch, reuses the
  model from the most recent assistant message, and dynamically imports the
  orchestrator.
- `packages/opencode/src/tool/worktree-merge-request/orchestrate.ts` —
  `startMerge(...)` runs under the main checkout's instance context via
  `AppRuntime.runPromise(InstanceStore.Service.use((store) => store.provide({ directory: mainCheckout }, ...)))`,
  creates the session with `Session.Service`, then `AppRuntime.runFork`s the
  `SessionPrompt.prompt(...)` so the merge proceeds independently.
- `packages/opencode/src/tool/registry.ts` — registers the tool in the `builtin`
  list and adds `Git` to the registry's `defaultLayer` and `node`.

The orchestrator is **dynamically imported** to keep `AppRuntime` (which
statically imports the tool registry) out of the tool's static import graph,
avoiding a `registry -> tool -> app-runtime -> registry` cycle.

## V2 implementation (process-global application tool)

The V2 SessionRunner reads the V2 registry. V2 built-in tools are Location-
scoped, but this tool must reach the **process-global** `SessionV2.Service` to
create a session in the main checkout. `SessionV2.Service` is wired above
`LocationServiceMap`, so the tool cannot be a Location built-in.

It is therefore a **process-global application tool**, constructed where
`SessionV2.Service` and `ApplicationTools.Service` coexist:

- `packages/core/src/tool/worktree-merge-request.ts` — a `make({ session, git })`
  factory. The tool's `execute` closure has no service requirements (V2 tools
  carry `R = never`), so it captures `SessionV2`/`Git` at construction.
- `packages/server/src/worktree-merge-tool.ts` — `worktreeMergeToolLayer`
  yields `SessionV2.Service`, `Git.Service`, and `ApplicationTools.Service`,
  then registers the tool.
- `packages/server/src/handlers.ts` — merges `worktreeMergeToolLayer` and
  provides `ApplicationTools.layer` at the same composition root as
  `SessionV2.defaultLayer` and `LocationServiceMap.layer`.

`LocationServiceMap` lists `ApplicationTools.layer` in its `dependencies`.
Providing the same module-level `ApplicationTools.layer` reference at the root is
deduplicated by Effect's memo map, so the tool registers into the same registry
the Location session runners read from. This is the established pattern in
`packages/core/src/public/opencode.ts` and is covered by
`packages/core/test/location-layer.test.ts`.

## Frontend

`packages/app/src/pages/session/message-timeline.tsx`:

- `TimelineDiffSummaryRow` shows a **Merge into main** button only when the
  session runs in a worktree (`sdk.directory !== project.worktree`).
- `handleMergeToMain`:
  - Creates a client against the main checkout and preflights `vcs.status()`;
    if dirty, it toasts the offending files and aborts (this preflight is
    cheap when the main-checkout instance is already booted).
  - Otherwise prompts the current worktree session (via `promptAsync`) to commit
    without pushing and call `worktree_merge_request`.

i18n keys: `session.review.mergeToMain`, `session.review.mergeToMain.unclean.*`,
`session.review.mergeToMain.starting` in `packages/app/src/i18n/{en,zh}.ts`.

## Out of scope

- Worktree cleanup after a successful merge (no card/flow yet).
- Renaming a worktree (no backend API today; UI rename only mutates local
  state).
- Auto-navigating to the merge tracking session (the user opens it manually).
- Conflict auto-resolution (explicitly disallowed; abort and report).

## Tests

- `packages/core/test/worktree-merge-request.test.ts` — live git repo with a
  linked `opencode/feature` worktree; asserts the V2 tool derives the main
  checkout, spawns the merge session there (not in the worktree), prompts it
  with the squash-merge instructions including the no-push constraint, and
  rejects when called from the main checkout.
- `packages/core/test/location-layer.test.ts` — confirms a process-global
  application tool is visible in a Location's materialized registry, which is
  the sharing pattern the V2 wiring relies on.
- `packages/core/test/session-runner.test.ts` — "hides worktree_merge_request
  from a main-checkout session" registers a tool under that name and asserts the
  runner omits it from the advertised tool definitions for the non-worktree
  `/project` session while keeping other tools.
