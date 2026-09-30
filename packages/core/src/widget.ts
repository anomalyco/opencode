export * as Widget from "./widget.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Widget as WidgetSchema } from "@opencode/schema/widget"
import { Context, Effect, Layer, Option, Stream } from "effect"
import path from "path"
import { Bus } from "./bus.js"
import { Config } from "./config.js"
import { Watcher } from "./filesystem/watcher.js"

export const ID = WidgetSchema.ID
export type ID = typeof ID.Type
export const Info = WidgetSchema.Info
export type Info = WidgetSchema.Info
export const Source = WidgetSchema.Source
export type Source = WidgetSchema.Source
export const State = WidgetSchema.State
export type State = WidgetSchema.State
export const Capability = WidgetSchema.Capability
export type Capability = WidgetSchema.Capability
export const Event = WidgetSchema.Event
export const BRIDGE = WidgetSchema.BRIDGE
export const BRIDGE_ID = WidgetSchema.BRIDGE_ID
export const BRIDGE_ASSET = WidgetSchema.BRIDGE_ASSET
export const BRIDGE_HELPER = WidgetSchema.BRIDGE_HELPER

const CAPABILITIES = ["read", "write", "full"] as const

// Widgets are user-authored panels shipped as a folder with an index.html and an
// optional widget.json manifest. They are discovered from disk so adding or
// editing one never requires rebuilding the app.
export const DIRECTORY = "widgets"
export const ENTRY = "index.html"
export const MANIFEST = "widget.json"

export type Asset = {
  readonly body: Uint8Array
  readonly mime: string
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  /** Read a widget asset. Returns the file contents and its mime type. */
  readonly read: (id: string, asset: string) => Effect.Effect<Asset | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Widget") {}

type Located = Info & { root: string }

// Resolve a request path to a file inside a widget root, refusing anything that
// escapes the directory (path traversal via `..`, absolute paths).
export function asset(root: string, relative: string): string | undefined {
  const clean = relative.startsWith("/") ? relative : `/${relative}`
  const target = path.resolve(root, `.${clean}`)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined
  return target
}

// A widget whose entry is missing stays in the inventory as failed so the UI can
// explain what went wrong instead of silently hiding the folder.
function locate(fs: FSUtil.Interface, base: string, type: Source["type"]) {
  return Effect.gen(function* () {
    const entries = yield* fs.readDirectoryEntries(base).pipe(Effect.orElseSucceed(() => []))
    return yield* Effect.forEach(
      entries.filter((entry) => entry.type === "directory" || entry.type === "symlink"),
      (entry) =>
        Effect.gen(function* () {
          const root = path.join(base, entry.name)
          if (!(yield* fs.isDir(root))) return Option.none<Located>()
          const id = ID.make(entry.name)
          const manifest = yield* readManifest(fs, root)
          const info = {
            id,
            title: manifest.title,
            ...(manifest.description ? { description: manifest.description } : {}),
            source: { type, path: root },
            requests: manifest.requests,
          }
          if (!(yield* fs.existsSafe(path.join(root, ENTRY))))
            return Option.some<Located>({ ...info, state: { status: "failed", error: `Missing ${ENTRY}` }, root })
          return Option.some<Located>({ ...info, state: { status: "active" }, root })
        }),
      { concurrency: "unbounded" },
    ).pipe(Effect.map((items) => items.flatMap(Option.toArray)))
  })
}

function readManifest(fs: FSUtil.Interface, root: string) {
  return Effect.gen(function* () {
    const file = path.join(root, MANIFEST)
    if (!(yield* fs.existsSafe(file))) return { title: path.basename(root), requests: [] }
    const raw = yield* fs.readJson(file).pipe(Effect.orElseSucceed(() => undefined))
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { title: path.basename(root), requests: [] }
    const data = raw as Record<string, unknown>
    const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : path.basename(root)
    const description = typeof data.description === "string" ? data.description : undefined
    return { title, description, requests: parseRequests(data.capabilities) }
  })
}

// A manifest may request capabilities. Only known names count, and requesting
// "full" implies the lower levels, so the settings UI can offer one switch per
// level without the widget having to repeat itself.
function parseRequests(input: unknown): Capability[] {
  if (!Array.isArray(input)) return []
  const requested = new Set(input.filter((item): item is Capability => CAPABILITIES.includes(item)))
  if (requested.has("full")) return ["read", "write", "full"]
  if (requested.has("write")) return ["read", "write"]
  return requested.has("read") ? ["read"] : []
}

// Global widgets live under the config directory; project widgets live under
// `.opencode/widgets`. Global widgets win over project widgets with the same id.
export const discover = Effect.fn("Widget.discover")(function* (
  fs: FSUtil.Interface,
  global: Global.Interface,
  config: Config.Interface,
) {
  const entries = yield* config.entries()
  const directories = [...new Set(entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : [])))]
  const globalDirectory = path.join(global.config, DIRECTORY)
  const projectDirectories = directories
    .filter((directory) => directory !== global.config)
    .map((directory) => path.join(directory, ".opencode", DIRECTORY))
  const found = [
    ...(yield* locate(fs, globalDirectory, "global")),
    ...(yield* Effect.forEach(projectDirectories, (directory) => locate(fs, directory, "project"), {
      concurrency: "unbounded",
    })).flat(),
  ]
  const seen = new Set<string>()
  return found.filter((widget) => {
    if (seen.has(widget.id)) return false
    seen.add(widget.id)
    return true
  })
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const config = yield* Config.Service
    const watcher = yield* Watcher.Service
    const bus = yield* Bus.Service

    // Watch the global and project widgets directories so a widget dropped on
    // disk shows up without restarting the server. The list itself always reads
    // from disk, so the event only needs to tell clients to refetch.
    const roots = yield* config.entries().pipe(
      Effect.map((entries) => {
        const directories = new Set(entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : [])))
        return [
          path.join(global.config, DIRECTORY),
          ...[...directories]
            .filter((root) => root !== global.config)
            .map((root) => path.join(root, ".opencode", DIRECTORY)),
        ]
      }),
    )
    yield* Effect.forEach(
      roots,
      (root) =>
        Stream.unwrap(
          watcher.subscribe({ path: root, type: "directory", ignore: ["node_modules", ".git"] }),
        ).pipe(
          Stream.debounce("200 millis"),
          Stream.runForEach(() => bus.publish(Event.Updated, {})),
          Effect.forkScoped({ startImmediately: true }),
        ),
      { concurrency: "unbounded", discard: true },
    )

    return Service.of({
      list: Effect.fn("Widget.list")(function* () {
        const found = yield* discover(fs, global, config)
        return found.map(({ root: _root, ...info }) => info)
      }),
      read: Effect.fn("Widget.read")(function* (id, relative) {
        // The bridge helper is a virtual asset served for every widget so a
        // widget can load it without bundling the protocol itself.
        if (id === BRIDGE_ID) {
          if ((relative || BRIDGE_ASSET) !== BRIDGE_ASSET) return undefined
          return { body: new TextEncoder().encode(BRIDGE_HELPER), mime: "text/javascript" }
        }
        const found = yield* discover(fs, global, config)
        const widget = found.find((item) => item.id === id)
        if (!widget) return undefined
        const file = asset(widget.root, relative || ENTRY) ?? asset(widget.root, ENTRY)
        if (!file) return undefined
        if (!(yield* fs.isFile(file))) return undefined
        const body = yield* fs.readFile(file).pipe(Effect.orElseSucceed(() => undefined))
        if (!body) return undefined
        return { body, mime: FSUtil.mimeType(file) }
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Config.node, Watcher.node, Bus.node],
})
