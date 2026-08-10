# Proposal: `opencode serve` must initialize the Plugin service once at startup

- **Upstream branch (this fork):** `herjarsa/opencode` `fix/plugins-serve-init` (off `upstream/dev`)
- **Reference issue:** [anomalyco/opencode#38470](https://github.com/anomalyco/opencode/issues/38470) (open, assigned to kitlangton)
- **Status:** tracked in this fork as a proposal; no code has been changed yet.
- **Target upstream PR:** `anomalyco/opencode` dev branch.

## 1. Problem (verified empirically)

When opencode runs in HTTP serve mode (e.g. launched by OpenChamber, by the desktop client, or by `opencode serve --port N`), the OpenCode Plugin service is never initialized. As a consequence, any plugin installed via `plugins:` in `opencode.jsonc` is silently dead in that runtime — no hooks fire, no custom tools are registered, no `system.transform` / `messages.transform` injections happen.

Three independent verifications:

1. **Reproducer (opencode 1.18.15 and 1.18.16, both buggy):** start `opencode serve`, authenticate, `POST /session` + `POST /session/:id/message`. Server returns 200, prompt completes, but `~/.config/opencode/<plugin>/<plugin>.log` shows only `MetaGovernor plugin loaded` (module-scope import) — never `factory_invoked` and never `config_loaded`. The plugin's own `server(input)` function is never called by the host.

2. **Source check (`packages/opencode/src/plugin/index.ts`):** the Plugin service uses `InstanceState.make<State>(Effect.fn("Plugin.state")(...))` — a *lazy* `ScopedCache` keyed by directory. The state (and the `PluginLoader.loadExternal` call inside it) is only built when one of `Plugin.init` / `Plugin.list` / `Plugin.trigger` is called and resolves through `InstanceState.get(state)`. The serve command has `instance: false` (see `packages/opencode/src/cli/cmd/serve.ts:12`) explicitly disabling an ambient `InstanceContext` at startup. The chat pipeline (bootstrap.run → plugin.init → InstanceState.get) is supposed to fire per-request on the *per-directory* `InstanceStore`, but in practice the request-scoped bootstrap does not reach it consistently in HTTP mode.

3. **Same code paths in TUI / `opencode run` work fine:** the same bundle (PluginModule form `{ id, server }` or the default-function form) reaches `server(input)` and emits `factory_invoked` + `config_loaded`. So this is *not* a plugin bug; it is a serve-mode initialization bug.

## 2. Why the in-tree tests don't catch it

- TUI / `opencode run` always materializes ambient plugins via the per-process bootstrap.
- Test fixtures for the HTTP API (`packages/opencode/script/httpapi-exercise.ts`) assert route shapes and auth, not that `Plugin.Service` is initialized for a real session.
- The plugin "loaded" in module scope (which we *can* see in the log) is unrelated: that is the JS module being imported by `PluginLoader.loadExternal` *inside* the lazy state factory — and yet we see the import but not the subsequent `server(input)` call. That asymmetry is the entire bug.

## 3. Proposed fix (small, scoped to serve command)

In `packages/opencode/src/cli/cmd/serve.ts`, after `Server.listen(opts)` and before `Effect.never`, fork a scope that calls `InstanceStore.use({directory: process.cwd()}, Effect.void)` (or whichever API the current Effect refactor exposes — see "Reviewer notes" below). This:

- Materializes `Plugin.Service` once at startup, so all subsequent request handlers find a non-empty `hooks` array.
- Caches plugin state by `directory` in the existing `ScopedCache`, so per-request `x-opencode-directory` still wins when it differs from `process.cwd()`.
- Is wrapped in `Effect.forkScoped` so it dies cleanly with the serve.

Sketch (verify exact API against current `src/project/instance-store.ts` before submitting):

```ts
import { Effect } from "effect"
import { InstanceStore } from "@/project/instance-store"     // adjust import path
...
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: ...")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    // Warm plugin state for the ambient cwd. Per-request x-opencode-directory
    // cache entries still take precedence; this only fixes the case where
    // OpenChamber / CLI serve happens to use the cwd as the project root.
    const ambientCwd = process.cwd()
    yield* InstanceStore.use(
      (svc) => svc.load({ directory: ambientCwd }) as Effect.Effect<unknown, never, never>,
    ).pipe(Effect.forkScoped)

    yield* Effect.never
  }),
```

(The exact method on `InstanceStore` is `load`, which mirrors `store.load` in the v1.18.15 source. The current fork's `src/project/instance-store.ts` may name it differently — adjust accordingly. The behaviour we need is `resolve InstanceContext for this directory, triggering `bootstrap.run` → `plugin.init()`.)

## 4. Tests to add / surface

1. Add an integration test under `packages/opencode/test/cli/serve.test.ts` (or similar) that:
   - Spawns a real `opencode serve` process against a fixture project that declares a `tools:`-providing plugin in its `opencode.jsonc`.
   - Hits `POST /session` + `POST /session/:id/message`.
   - Asserts that the plugin's log file contains `factory_invoked` after the prompt returns.
2. A unit test for `bootstrap.ts` confirming that calling `InstanceStore.load` materializes `Plugin.Service` for that directory (i.e. `Plugin.Service.list()` is non-empty afterwards).

## 5. Reviewer notes / open questions for upstream

- The author of the lazy `InstanceState` design (per-directory ScopedCache) is intentional (so different working directories get different plugin sets). We must preserve that. Forcing a single eager global init would *break* that property, which is why the fix above warms only `process.cwd()`. If upstream wants something stronger, they should:
  - Set up an ambient `InstanceContext` in the serve command (`instance: true`) **and** keep `x-opencode-directory` overrides on top of it. (Equivalent in semantics to this proposal.)
- There may be an even smaller fix: change `Plugin.state` so it initializes *at least the global (cwd-free) plugin set* on `make` instead of deferring to the first `get(state)`. But that would change the cache semantics — current proposal is safer.
- The branch `origin/brendan/lazy-init-plugins` on this fork and the commit `02051e9cec fix(plugin): reuse active server for client requests` are tangentially related; review whether they already address this on `dev`. (They appear to address the *client plugin client* reuse, not the *server plugin state* materialization — different scope.)
- Related upstream issue: comment on `#38470` linking to this proposal so kitlangton has the reproducer.

## 6. Branch / build steps for the eventual PR

1. `fix/plugins-serve-init` is already off `upstream/dev` on this fork (`herjarsa/opencode`). The next step is to apply the diff above (verified against the current `src/project/instance-store.ts` API) and re-run `bun run --cwd packages/opencode typecheck`.
2. Add the integration test from §4.
3. Push and open a PR against `anomalyco/opencode` `dev`. Title suggestion: `fix(server): ensure Plugin service initializes at serve startup` (matches the upstream commit-message style observed in the fork).

## 7. Local repro (paste-ready)

```pwsh
# in this fork, at fix/plugins-serve-init:
$env:OPENCODE_SERVER_PASSWORD = "test"
Start-Process bun -ArgumentList "run","--cwd","packages/opencode","--conditions=browser","src/index.ts","serve","--port","54010"

# then:
$auth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:test"))
$h    = @{ Authorization = $auth; "x-opencode-directory" = "D:\GITHUB\omo-meta-governor" }
$r    = Invoke-RestMethod -Uri "http://127.0.0.1:54010/session" -Method Post -Headers $h `
              -ContentType "application/json" -Body '{"title":"repro"}'
Invoke-RestMethod -Uri "http://127.0.0.1:54010/session/$($r.id)/message" -Method Post -Headers $h `
              -ContentType "application/json" -Body '{"providerID":"zhipuai","modelID":"glm-5.2","parts":[{"type":"text","text":"ok"}]}'

# observe ~/.config/opencode/meta-governor.log:
#   MetaGovernor plugin loaded      ← always (module-scope import)
#   factory_invoked                  ← MISSING without this fix
#   config_loaded                    ← MISSING without this fix
```
