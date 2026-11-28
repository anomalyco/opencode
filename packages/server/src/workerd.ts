export * as ServerWorkerd from "./workerd"

import { Context, Effect } from "effect"
import type { Layer } from "effect"
import { BlobStore } from "@opencode/core/blob-store"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Database } from "@opencode/core/database/database"
import { sqliteLayer } from "@opencode/core/database/sqlite.workerd"
import type { DurableObjectStorage } from "@opencode/core/database/sqlite.workerd"
import { EnvironmentUnavailable } from "@opencode/core/environment/unavailable"
import { WorkspaceConnector } from "@opencode/core/environment/workspace-connector"
import { Identity } from "@opencode/core/machine/identity"
import { Pty } from "@opencode/core/pty"
import { VideoGeneration } from "@opencode/core/video-generation"
import { Workspace } from "@opencode/core/workspace"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Npm } from "@opencode/util/npm"
import { ServerFetch } from "./fetch"
import type { ServerOptions } from "./options"
import { withoutParentSpan } from "./request-tracing"
import { createRoutes } from "./routes"
import { WorkerdMachineLink } from "./workerd-machine-link"

/**
 * The workerd runtime profile: boots opencode core and server inside a
 * Cloudflare Durable Object, with every intentionally-local service replaced
 * or disabled.
 *
 * - Database runs on the injected `DurableObjectStorage` SQLite.
 * - `Workspace` is configured with `keepWarm: 0`, `pollInterval: null`, and
 *   `storage.setAlarm` scheduling so the Durable Object can hibernate at zero
 *   idle cost. Callers forward the Durable Object's `alarm()` method to
 *   `handler.alarm()` (or `opencode.alarm()` via `@opencode/sdk/workerd`).
 * - Watcher and fff are disabled through their existing option flags; pty, fff,
 *   and photon native modules resolve to inert stubs under the `workerd` bundle
 *   condition.
 * - Bare locations use a typed no-execution-plane process spawner; FileSystem,
 *   FileSystemSearch, Snapshot, Vcs, and Worktree route or gate through
 *   Environment (working on attached remote workspaces where supported and
 *   degrading or failing cleanly on bare locations). Pty fails with a clear
 *   defect; Npm fails package installs with a typed unsupported error.
 * - Blob storage and video generation report themselves unsupported: blobs are files on a local disk.
 * - Config is injected as a string (no filesystem); plugin discovery is
 *   precompiled-only, and stdio MCP reports the same no-plane failure as Shell.
 * - With the `machines` flag on, workers dial in to `machine.link` as on Node,
 *   upgraded through a `WebSocketPair` (see `WorkerdMachineLink`).
 *
 * Bundle with the `workerd` condition, e.g.
 * `bun build src/workerd.ts --conditions=workerd --target=node`
 * (see `script/workerd-probe.ts`).
 */
export interface Options {
  /** Durable Object storage whose SQLite database backs the opencode database. */
  readonly storage: DurableObjectStorage
  readonly app?: ServerOptions["app"]
  /** Enforces HTTP Basic auth (user `opencode`) on every route but the machine link; omit to serve unauthenticated. */
  readonly password?: string
  /** Extra browser origins allowed to call the API across sites, on top of localhost and opencode.ai. */
  readonly cors?: ServerOptions["cors"]
  /** Inline opencode config content (JSON), same as `ServerOptions.config.content`. */
  readonly config?: { readonly content?: string }
  /** models.dev catalog options. Fetching is off by default, so a wake serves the bundled snapshot with no network. */
  readonly models?: ServerOptions["models"]
  /** Replaces `globalThis.fetch` for OpenCode's own HTTP requests, e.g. to route them through a Service Binding. */
  readonly fetch?: ServerOptions["fetch"]
}

export interface Handler {
  (request: Request): Promise<Response>
  /** Suspends any workspaces past their idle threshold; call from the Durable Object's `alarm()` method. */
  readonly alarm: () => Promise<void>
}

/**
 * Builds the web-standard fetch + alarm handler for a Durable Object. The
 * application layer builds eagerly in the caller's scope, so hold it in the
 * Durable Object instance rather than per request.
 *
 * Callers must forward the Durable Object's `alarm()` lifecycle method to
 * `handler.alarm()`: this profile disables background idle polling so the
 * isolate can hibernate at zero idle cost.
 */
export const create = Effect.fn("ServerWorkerd.create")(function* (options: Options) {
  // Eviction can kill the isolate between a turn's Started and terminal events with no
  // teardown. The write-ahead execution claim plus the boot-time resume in `serve`
  // recovers such orphaned turns by replaying the drain from durable history on the next wake.
  return yield* serve(yield* ServerFetch.build(routes(options)), options)
})

/**
 * The workerd profile's route layer, unbuilt: `createRoutes` over `serverOptions` with `replacements` applied, then
 * `overrides` after them so they win. For embedders (the SDK) that build the context, register plugins and only then
 * `serve` it, so recovery never runs without them.
 */
export function routes(options: Options, overrides: LayerNode.Replacements = []) {
  return createRoutes(serverOptions(options), () => [], [...replacements(options), ...overrides])
}

/**
 * Serves a context built from `routes`: resumes suspended Sessions, then answers machine-link upgrades through a
 * `WebSocketPair` and every other request through the routes behind the `RequestSite` and CORS middleware.
 */
export const serve = Effect.fn("ServerWorkerd.serve")(function* (
  context: Context.Context<Layer.Success<ReturnType<typeof routes>>>,
  options: Pick<Options, "cors">,
) {
  const handler = yield* ServerFetch.serve(context, ServerFetch.middleware(options))
  const run = Effect.runPromiseWith(yield* withoutParentSpan(Effect.context()))
  const workspace = Context.get(context, Workspace.Service)
  const link = yield* WorkerdMachineLink.make(options).pipe(Effect.provide(context))
  const served: Handler = Object.assign(
    (request: Request) => {
      const upgrade = link(request)
      return upgrade ? run(upgrade) : handler(request)
    },
    { alarm: () => run(Effect.asVoid(workspace.suspendIdle())) },
  )
  return served
})

export function serverOptions(options: Options): ServerOptions {
  return {
    app: options.app,
    password: options.password,
    cors: options.cors,
    fs: { filewatcher: false, fff: false },
    // Durable event history is how a turn orphaned by eviction is recovered:
    // the boot-time resume replays it. A runtime that dies without teardown
    // cannot opt out of it, so this is not exposed as an option.
    events: { persist: true },
    config: { content: options.config?.content },
    models: { ...options.models, fetch: options.models?.fetch ?? false },
    fetch: options.fetch,
  }
}

/** The workerd replacement graph, applied after the standard server replacements. */
export function replacements(options: Options): LayerNode.Replacements {
  return [
    Database.node.replace(Database.configuredClient(sqliteLayer({ storage: options.storage }))),
    Identity.node.replace(Identity.kvNode),
    Workspace.node.replace(
      Workspace.configured({
        keepWarm: 0,
        pollInterval: null,
        onIdleScheduled: (atMs) => Effect.tryPromise(() => options.storage.setAlarm(atMs)),
      }),
    ),
    // Kept here so ServerWorkerd.replacements stays self-contained when composed outside routes.ts.
    WorkspaceConnector.node.replace(Workspace.connectorNode),
    CrossSpawnSpawner.node.replace(EnvironmentUnavailable.layer),
    Pty.node.replace(Pty.unsupportedLayer),
    Npm.node.replace(Npm.unsupportedLayer),
    // Blobs need a local `blobs/` folder, which a Durable Object doesn't have.
    BlobStore.node.replace(BlobStore.unsupportedLayer),
    VideoGeneration.node.replace(VideoGeneration.unsupportedLayer),
    // Precompiled (internal and SDK) plugins only: no plugin-directory scan, npm
    // install, or import of plugin code from disk.
    ConfigPluginSource.node.replace(ConfigPluginSource.empty),
  ]
}
