export * as ServerWorkerd from "./workerd"

import { Effect, Layer } from "effect"
import { ConfigPluginSource } from "@opencode-ai/core/config/plugin/source"
import { Database } from "@opencode-ai/core/database/database"
import { sqliteLayer } from "@opencode-ai/core/database/sqlite.workerd"
import type { DurableObjectStorage } from "@opencode-ai/core/database/sqlite.workerd"
import { EnvironmentUnavailable } from "@opencode-ai/core/environment/unavailable"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { Pty } from "@opencode-ai/core/pty"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Vcs } from "@opencode-ai/core/vcs"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import type { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { ServerFetch } from "./fetch"
import type { ServerOptions } from "./options"

/**
 * The workerd runtime profile: boots opencode core and server inside a
 * Cloudflare Durable Object, with every intentionally-local service replaced
 * or disabled.
 *
 * - Database runs on the injected `DurableObjectStorage` SQLite.
 * - Watcher and fff are disabled through their existing option flags; pty, fff,
 *   shell-parser, photon, and process-lock native modules resolve to inert
 *   stubs under the `workerd` bundle condition.
 * - Bare locations use a typed no-execution-plane process spawner; FileSystem,
 *   FileSystemSearch, and Pty fail with a clear defect until a remote sandbox
 *   backs them; Snapshot and Vcs degrade to no-op results.
 * - Config is injected as a string (no filesystem); plugin discovery is
 *   precompiled-only, and stdio MCP reports the same no-plane failure as Shell.
 *
 * Bundle with the `workerd` condition, e.g.
 * `bun build src/workerd.ts --conditions=workerd --target=node`
 * (see `script/workerd-probe.ts`).
 */
export interface Options {
  /** Durable Object storage whose SQLite database backs the opencode database. */
  readonly storage: DurableObjectStorage
  readonly app?: ServerOptions["app"]
  readonly password?: string
  /** Inline opencode config content (JSON), same as `ServerOptions.config.content`. */
  readonly config?: { readonly content?: string }
  /** models.dev catalog options; the bundled snapshot is the boot-time floor either way. */
  readonly models?: ServerOptions["models"]
}

/**
 * Builds the web-standard fetch handler for a Durable Object's `fetch()`. The
 * application layer builds eagerly in the caller's scope, so hold it in the
 * Durable Object instance rather than per request.
 */
export function create(options: Options) {
  // Eviction can kill the isolate between a turn's Started and terminal events with no
  // teardown. The write-ahead execution claim plus ServerFetch.make's boot-time resume
  // recovers such orphaned turns by replaying the drain from durable history on the next wake.
  return ServerFetch.make(serverOptions(options), { overrides: replacements(options) })
}

export function serverOptions(options: Options): ServerOptions {
  return {
    app: options.app,
    password: options.password,
    fs: { filewatcher: false, fff: false },
    // Durable event history is how a turn orphaned by eviction is recovered:
    // the boot-time resume replays it. A runtime that dies without teardown
    // cannot opt out of it, so this is not exposed as an option.
    events: { persist: true },
    config: { content: options.config?.content },
    models: options.models,
  }
}

/** The workerd replacement graph, applied after the standard server replacements. */
export function replacements(options: Options): LayerNode.Replacements {
  return [
    [Database.node, Database.configuredClient(sqliteLayer({ storage: options.storage }))],
    [CrossSpawnSpawner.node, EnvironmentUnavailable.layer],
    [Snapshot.node, Snapshot.noopLayer],
    [Vcs.node, vcsLayer],
    [FileSystem.node, fileSystemLayer],
    [FileSystemSearch.node, fileSystemSearchLayer],
    [Pty.node, ptyLayer],
    // Precompiled (internal and SDK) plugins only: no plugin-directory scan, npm
    // install, or import of plugin code from disk.
    [ConfigPluginSource.node, ConfigPluginSource.empty],
  ]
}

const unavailable = (what: string) => Effect.die(new Error(`${what} is unavailable in the workerd profile`))

// Vcs degrades to empty results, matching its behavior for locations without a
// supported VCS, so read-only clients never need to special-case this runtime.
const vcsLayer = Layer.succeed(
  Vcs.Service,
  Vcs.Service.of({
    info: () => Effect.succeed({ branch: {} }),
    status: () => Effect.succeed([]),
    diff: () => Effect.succeed([]),
  }),
)

// The Location-scoped filesystem has no local worktree to serve until a remote
// sandbox backs it.
const fileSystemLayer = Layer.succeed(
  FileSystem.Service,
  FileSystem.Service.of({
    read: () => unavailable("FileSystem.read"),
    list: () => unavailable("FileSystem.list"),
    find: () => unavailable("FileSystem.find"),
  }),
)

const fileSystemSearchLayer = Layer.succeed(
  FileSystemSearch.Service,
  FileSystemSearch.Service.of({
    find: () => unavailable("FileSystemSearch.find"),
  }),
)

const ptyLayer = Layer.succeed(
  Pty.Service,
  Pty.Service.of({
    list: () => Effect.succeed([]),
    get: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
    create: () => unavailable("Pty.create"),
    update: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
    remove: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
    write: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
    attach: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
  }),
)
