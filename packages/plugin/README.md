# `@opencode/plugin`

Authoring interfaces and runtime loader support for OpenCode V2 plugins:

- `@opencode/plugin` — [Promise plugin API](./src/README.md)
- `@opencode/plugin/effect` — [Effect plugin API](./src/effect/README.md)
- `@opencode/plugin/rpc` — portable RPC contract definitions
- `@opencode/plugin/tui` — terminal UI plugin API

## Experimental permission review

Server plugins can register `ctx.permission.hook("experimental.review", callback)` to review an actual permission request after rules, evaluation hooks, and unattended policy settle on `ask`. Unlike `evaluate`, this hook does not run for permission probes or rechecks of pending requests. Experimental: may change without compatibility guarantees.

The callback receives `event.request`, including its ID and requesting tool source, and optional `event.agent`. It may set `event.result` to `{ decision: "approve" | "deny" | "escalate", reason: string }`. The reason must be nonempty. Promise callbacks return normally; Effect callbacks return an Effect, as with other hooks.

- `approve` allows only this request. It does not save a rule or resolve other pending requests.
- `deny` blocks only this request and returns the reason as tool feedback.
- `escalate` leaves the decision to the existing human prompt and supplies its message.

The hook cannot override permissions already allowed or denied by the preceding evaluation. Missing results leave the request pending for human review. Invalid results, hook failures, and the 30-second review deadline fall back to the human prompt. Cancelling the caller interrupts the review without creating a prompt.

This hook does not supply a reviewer model or change the default permission policy. Plugins own review policy, evidence collection, model calls, and any audit history. Reviewers run as trusted plugin code. Multiple review hooks share the mutable result, so plugins should leave an existing result unchanged when composing with another reviewer.

## Packaging And Runtime `effect`

When the OpenCode CLI loads server or TUI plugins, it resolves imports of `effect`, exported `effect/*` subpaths, and `@opencode/plugin` entrypoints (including imports from dependencies inside a plugin's `node_modules`) to the host's runtime module instances so fibers, loggers, and `Schema` parsers share one copy.

- Declare `"effect": "^4.0.0"` as a `peerDependency` (and `devDependency` for local type-checking and testing) rather than a bundled runtime dependency.
- Do not bundle `effect` into published plugin files; if you build with a bundler, keep `effect` and `effect/*` external. Two copies of `effect` do not share fiber, logger, or `Schema` internals.
- Plugins and their `node_modules` dependencies always receive OpenCode's host `effect` instance. Use `effect` APIs and module paths compatible with the OpenCode release you target; dependencies built on another `effect` major (such as Effect 3) are not supported.
- Only public `effect` subpaths are provided. A plugin that imports one of Effect's private `internal` modules fails to load with an error naming the path.
- The compiled OpenCode binary does not include the Scalar and Swagger UI assets used by Effect's HTTP API docs pages; serving those pages from a plugin shows a notice instead.
