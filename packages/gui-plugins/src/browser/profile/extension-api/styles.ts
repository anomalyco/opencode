import { once } from "node:events"
import { realpath } from "node:fs/promises"
import type { Extension, WebFrameMain } from "electron"
import { Schema } from "effect"
import { openContained } from "@opencode/util/contained-file"
import { method, type ApiModule, type ExtensionContext } from "./api"
import { matchesHost } from "./match-pattern"
import type { Manifests } from "./manifest"
import type { ExtensionTabs } from "./tabs"

const Origin = Schema.Literals(["author", "user"])

const denied = "Cannot access contents of the page."

class UserSheetRemovalError extends Error {}

const Details = Schema.Struct({ code: Schema.optional(Schema.String), file: Schema.optional(Schema.String), frameId: Schema.optional(Schema.Int), allFrames: Schema.optional(Schema.Boolean), matchAboutBlank: Schema.optional(Schema.Boolean), cssOrigin: Schema.optional(Origin), runAt: Schema.optional(Schema.Literals(["document_start", "document_end", "document_idle"])) })

const Arguments = Schema.Union([Schema.Tuple([Details]), Schema.Tuple([Schema.NullOr(Schema.Int), Details])])

const Injection = Schema.Struct({ target: Schema.Struct({ tabId: Schema.Int, allFrames: Schema.optional(Schema.Boolean), frameIds: Schema.optional(Schema.Array(Schema.Int)), documentIds: Schema.optional(Schema.Array(Schema.String)) }) })

/** An activeTab gesture lends the top origin, not arbitrary cross-site children. The pane registry is the
 * first fence; also check the currently committed top document even for a separately permitted web iframe. */
export function canStyle(top: string, url: string, origin: string, hosts: readonly string[], grant: string | undefined, blank: boolean, appURL: string) {
  if (!publicTop(top, appURL)) return false
  const inherited = !url || url === "about:blank" || url === "about:srcdoc"
  const target = URL.parse(inherited && blank ? origin : url)

  if (!target || !/^https?:$/.test(target.protocol) || target.origin === URL.parse(appURL)?.origin) return false

  return matchesHost(hosts, target.href) || (URL.parse(top)?.origin === grant && target.origin === grant)
}

function publicTop(top: string, appURL: string) {
  const url = URL.parse(top)

  return url && /^https?:$/.test(url.protocol) && url.origin !== URL.parse(appURL)?.origin
}

export function createStyles(tabs: ExtensionTabs, manifest: Manifests) {
  const grants = new Map<number, Map<string, string>>()
  const owners = new Map<string, AbortController>()

  const release = tabs.watch(tab => {
    const contents = tab.contents

    const committed = () => {
      const origin = URL.parse(contents.getURL())?.origin
      grants.get(contents.id)?.forEach((prior, id, entries) => { if (prior !== origin) entries.delete(id) })
    }

    contents.on("did-navigate", committed)

    return () => {
      grants.delete(contents.id)

      if (!contents.isDestroyed()) contents.off("did-navigate", committed)
    }
  })

  const grant = (extension: Extension, id: number) => {
    const tab = tabs.get(id)

    if (!tab || !manifest(extension).permissions.includes("activeTab")) return
    const url = URL.parse(tab.contents.getURL())

    if (!url || !/^https?:$/.test(url.protocol)) return
    const entries = grants.get(id) ?? new Map<string, string>()
    entries.set(extension.id, url.origin)
    grants.set(id, entries)
  }

  const forget = (id: string) => {
    owners.get(id)?.abort()
    owners.delete(id)
    grants.forEach(entries => entries.delete(id))

    for (const tab of tabs.ids()) {
      for (const frame of tabs.get(tab)?.contents.mainFrame.framesInSubtree ?? []) {
        if (!frame.detached && !frame.isDestroyed()) frame.send("browser-extension:forget-css", id)
      }
    }
  }

  const apply = async (context: ExtensionContext, id: number | null | undefined, details: typeof Details.Type, remove: boolean) => {
    const current = id ?? tabs.current(context)
    const tab = current === undefined ? undefined : tabs.get(current)

    if (!tab) throw new Error(current === undefined ? "No active tab." : `No tab with id: ${current}.`)

    if ((details.code === undefined) === (details.file === undefined)) throw new Error("Specify exactly one of 'code' and 'file'.")

    if (details.allFrames && details.frameId !== undefined) throw new Error("Cannot specify both 'allFrames' and 'frameId'.")
    const extension = context.extension
    const owner = owners.get(extension.id) ?? new AbortController()
    owners.set(extension.id, owner)
    const top = tab.contents.mainFrame

    if (!publicTop(top.url, tab.window.webContents.getURL())) throw new Error(denied)

    const allowed = (frame: WebFrameMain) => !owner.signal.aborted && !tab.contents.isDestroyed() && tabs.get(tab.contents.id) === tab && !frame.isDestroyed() && !frame.detached &&
      tab.contents.mainFrame === top && canStyle(top.url, frame.url, frame.origin, manifest(extension).hosts, grants.get(tab.contents.id)?.get(extension.id), !!details.matchAboutBlank, tab.window.webContents.getURL())

    const frames = details.allFrames ? top.framesInSubtree : [details.frameId ? top.framesInSubtree.find(f => f !== top && f.frameTreeNodeId === details.frameId) : top]

    if (frames.some(f => !f)) throw new Error(`No frame with id ${details.frameId} in tab ${current}.`)
    const targets = frames.filter((f): f is WebFrameMain => !!f && allowed(f))

    if (!targets.length) throw new Error(denied)
    const css = details.code ?? await packageCSS(extension, details.file ?? "")

    const results = await Promise.allSettled(targets.map(async frame => {
      if (!allowed(frame)) throw new Error("The target frame is no longer available.")
      const channel = `browser-extension:css:${crypto.randomUUID()}`
      const ipc = frame.ipc
      const lifetime = new AbortController()
      const signal = AbortSignal.any([owner.signal, lifetime.signal, AbortSignal.timeout(15000)])
      // An initial empty document may never receive a sandbox preload. Distinguish no receiver from a live
      // receiver waiting for document_end/idle. Never send CSS via a parent on the child's behalf.
      const blank = !frame.url || frame.url === "about:blank"
      const absent = new Error("The blank frame has no stylesheet receiver.")
      const timer = blank ? setTimeout(() => lifetime.abort(absent), 250) : undefined
      const heard = () => clearTimeout(timer)

      if (blank) ipc.once(`${channel}:received`, heard)
      // Reauthorize in the receiving document, at the requested runAt, not just when the command was queued.
      ipc.handleOnce(channel, event => {
        if (event.senderFrame !== frame || !allowed(frame)) return null

        return { id: extension.id, css, origin: details.cssOrigin ?? "author", remove }
      })

      try {
        const [reply] = await Promise.all([
          once(ipc, channel, { signal }),
          Promise.resolve().then(() => frame.send("browser-extension:css", channel, remove ? "document_start" : details.runAt ?? "document_idle", blank)),
        ]).catch(cause => { throw lifetime.signal.reason === absent ? absent : cause })

        if (reply[1] === "user-removal") throw new UserSheetRemovalError("Electron cannot remove a user-origin stylesheet until the document is reloaded.")

        if (reply[1] !== true) throw new Error("The target frame is no longer available.")
      } finally {
        clearTimeout(timer)

        if (blank) ipc.off(`${channel}:received`, heard)
        lifetime.abort()
        ipc.removeHandler(channel)
      }
    }))

    for (const result of results) {
      if (remove && result.status === "rejected" && result.reason instanceof UserSheetRemovalError) throw result.reason
    }

    if (!results.some(result => result.status === "fulfilled")) {
      const failure = results.find(result => result.status === "rejected")

      if (failure) throw failure.reason
    }
  }

  const mv2 = (remove: boolean) => method(Arguments, (context, args) => args.length === 1 ? apply(context, undefined, args[0], remove) : apply(context, args[0], args[1], remove))

  // MV3 has native CSS APIs. Keep Chromium's package-file resolution, cascade origins and removal; return
  // only approved frame IDs, never allFrames (a newly attached child has not been authorized). This guards
  // calls through our preload, not Chromium's native injection APIs in contexts without that preload.
  const mv3 = method(Schema.Tuple([Injection]), (context, [input]) => {
    if (input.target.documentIds) throw new Error("Targeting a document by UUID is not supported in this browser.")

    if (input.target.frameIds && input.target.allFrames) throw new Error("Cannot specify both 'allFrames' and 'frameIds'.")

    const tab = tabs.get(input.target.tabId)

    if (!tab) throw new Error(`No tab with id: ${input.target.tabId}.`)
    const top = tab.contents.mainFrame

    if (!publicTop(top.url, tab.window.webContents.getURL())) throw new Error(denied)
    const ids = input.target.frameIds ?? [0]
    const frames = top.framesInSubtree.map(frame => ({ frame, id: frame === top ? 0 : frame.frameTreeNodeId }))

    if (ids.some(id => !frames.some(f => f.id === id))) throw new Error("The target frame is no longer available.")
    const requested = frames.filter(f => input.target.allFrames || ids.includes(f.id))
    const allowed = requested.filter(({ frame }) => canStyle(top.url, frame.url, frame.origin, manifest(context.extension).hosts, grants.get(tab.contents.id)?.get(context.extension.id), false, tab.window.webContents.getURL()))

    if (!allowed.length || (!input.target.allFrames && requested.length !== allowed.length)) throw new Error(denied)

    return { tabId: tab.contents.id, frameIds: allowed.map(f => f.id) }
  })

  const module: ApiModule = {
    namespaces: [
      { path: "tabs", manifest: 2, methods: ["insertCSS", "removeCSS"], events: [] },
      { path: "scripting", manifest: 3, permissions: ["scripting"], methods: ["insertCSS", "removeCSS"], events: [] },
    ],
    methods: { "tabs.insertCSS": mv2(false), "tabs.removeCSS": mv2(true), "scripting.insertCSS": mv3, "scripting.removeCSS": mv3 },
    forget,
    dispose() { owners.forEach((_, id) => forget(id)); release() },
  }

  return { module, grant }
}

async function packageCSS(extension: Extension, resource: string) {
  const path = resource.replace(/^\/(?!\/)/, "")

  if (!path || /[\\:%?#]/.test(path)) throw new Error("Invalid extension stylesheet path.")
  const opened = await realpath(extension.path).then(root => openContained(root, path)).catch(() => undefined)

  if (!opened) throw new Error(`Could not load file: '${resource}'.`)

  try {
    if (opened.size > 4 * 1024 * 1024) throw new Error("Extension stylesheet exceeds 4 MiB.")
    // Bound the actual read as well as the stat, even if the file grows while open.
    const bytes = Buffer.alloc(opened.size + 1)
    let length = 0

    while (length < bytes.length) {
      const read = await opened.file.read(bytes, length, bytes.length - length, length)

      if (!read.bytesRead) break
      length += read.bytesRead
    }

    if (length > opened.size) throw new Error("Extension stylesheet changed while reading.")

    return bytes.toString("utf8", 0, length)
  } finally { await opened.file.close() }
}
