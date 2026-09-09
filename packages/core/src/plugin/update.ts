export * as PluginUpdate from "./update"

import npa from "npm-package-arg"
import path from "path"
import semver from "semver"
import { Effect, FileSystem, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Global } from "../global"
import { Npm } from "../npm"
import { NpmConfig } from "../npm-config"
import { Flag } from "../flag/flag"
import { FSUtil } from "../fs-util"
import { filesystem, httpClient } from "../effect/app-node-platform"
import { LayerNode } from "../effect/layer-node"

const WINDOW_MS = 24 * 60 * 60 * 1000

const NpmPackage = Schema.Struct({
  version: Schema.String,
})

const Manifest = Schema.Record(Schema.String, Schema.String)

type Store = Record<string, { last_checked: number }>

// A spec is eligible when it resolves to a registry package and the user did not
// pin an exact version. Local paths and pinned versions are never touched.
export function isAutoUpdateEligible(spec: string): boolean {
  if (spec.startsWith("file://") || spec.startsWith(".") || spec.startsWith("/")) return false
  if (/^[A-Za-z]:[\\/]/.test(spec)) return false
  if (path.isAbsolute(spec)) return false

  let hit
  try {
    hit = npa(spec)
  } catch {
    return false
  }
  if (!hit) return false
  const target = hit.type === "alias" ? (hit as npa.AliasResult).subSpec : hit
  if (!target) return false

  const raw = target.rawSpec ?? ""
  // An exact version is a user pin; leave it alone.
  if (raw && semver.valid(raw)) return false
  return true
}

function packageName(spec: string): string {
  try {
    const hit = npa(spec)
    const target = hit?.type === "alias" ? (hit as npa.AliasResult).subSpec : hit
    const name = target?.name ?? hit?.name
    if (name) return name
  } catch {}
  return spec
}

const registryVersion = Effect.fn("PluginUpdate.registryVersion")(function* (pkg: string) {
  const http = yield* HttpClient.HttpClient
  const registry = yield* NpmConfig.registry(process.cwd())
  const response = yield* http.execute(
    HttpClientRequest.get(`${registry}/${pkg}/latest`).pipe(HttpClientRequest.acceptJson),
  )
  const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
  return data.version
}, Effect.orElseSucceed(() => ""))

const manifestVersion = Effect.fn("PluginUpdate.manifestVersion")(function* (url: string, pkg: string) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson))
  const data = yield* HttpClientResponse.schemaBodyJson(Manifest)(response)
  const value = data[pkg]
  // A manifest entry that is not a usable version is treated as a miss so the
  // registry stays authoritative for anything the manifest gets wrong.
  if (!value || !semver.valid(value)) return ""
  return value
}, Effect.orElseSucceed(() => ""))

// The manifest wins when it knows the package; anything else falls back to the
// registry so a broken or partial mirror can never block updates entirely.
export const latestVersion = Effect.fn("PluginUpdate.latestVersion")(function* (pkg: string, source?: string) {
  if (source) {
    const hit = yield* manifestVersion(source, pkg)
    if (hit) return hit
  }
  return yield* registryVersion(pkg)
})

function storePath() {
  return Flag.OPENCODE_PLUGIN_UPDATE_FILE ?? path.join(Global.Path.state, "plugin-update.json")
}

// One check per package per window. This is deliberately lock free: the lock
// acquire is uninterruptible, so a stale lock from a crashed process would hang
// plugin loading. Losing the race only costs one extra version lookup.
export const shouldCheck = Effect.fn("PluginUpdate.shouldCheck")(function* (pkg: string) {
  const afs = yield* FSUtil.Service
  const file = storePath()

  const store = yield* afs.readJson(file).pipe(Effect.orElseSucceed(() => undefined))
  const prev = store && typeof store === "object" ? (store as Store)[pkg] : undefined
  const now = Date.now()
  if (prev && now - prev.last_checked < WINDOW_MS) return false

  const next: Store = { ...(store as Store), [pkg]: { last_checked: now } }
  yield* afs.writeJson(file, next).pipe(Effect.orElseSucceed(() => undefined))
  return true
})

function cachedDirectory(spec: string, name: string) {
  return path.join(Global.Path.cache, "packages", Npm.sanitize(spec), "node_modules", name)
}

export const maybeUpdate = Effect.fn("PluginUpdate.maybeUpdate")(function* (
  spec: string,
  source?: string,
  enabled?: boolean,
) {
  // Opt in through config; the env flag remains a hard kill switch.
  if (enabled !== true) return
  if (Flag.OPENCODE_DISABLE_PLUGIN_AUTOUPDATE) return
  if (!isAutoUpdateEligible(spec)) return

  const pkg = packageName(spec)
  if (!(yield* shouldCheck(pkg))) return

  const afs = yield* FSUtil.Service
  const fs = yield* FileSystem.FileSystem
  const dir = cachedDirectory(spec, pkg)
  const raw = yield* afs.readJson(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => undefined))
  const installed =
    raw && typeof raw === "object" && typeof (raw as { version?: unknown }).version === "string"
      ? (raw as { version: string }).version
      : undefined

  const latest = yield* latestVersion(pkg, source)
  if (!latest) return
  // Only ever move forward: a registry rollback must not trigger a reinstall.
  if (installed && !semver.gt(latest, installed)) return

  // Npm.add keys its cache on the whole spec, so reinstalling with a version
  // pinned spec would create a second directory instead of refreshing this one.
  yield* fs.remove(dir, { recursive: true, force: true }).pipe(Effect.orElseSucceed(() => undefined))
  const npm = yield* Npm.Service
  yield* npm.add(spec).pipe(Effect.orElseSucceed(() => undefined))
}, Effect.catchCause((cause) => Effect.logError("plugin auto-update failed", cause)))

export const layer = LayerNode.compile(
  LayerNode.group([FSUtil.node, Global.node, Npm.node, filesystem, httpClient]),
)

// Runs the update check with the node dependencies it needs. Callers in the
// opencode package use this because plugin loading there is plain async code.
export function update(spec: string, source?: string, enabled?: boolean) {
  return Effect.runPromise(maybeUpdate(spec, source, enabled).pipe(Effect.provide(layer))).catch(() => undefined)
}
