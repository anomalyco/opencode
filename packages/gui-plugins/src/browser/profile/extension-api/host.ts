import { writeFile } from "node:fs/promises"
import path from "node:path"
import { app, webContents, webFrameMain, type Extension, type ServiceWorkerMain, type Session, type WebContents } from "electron"
import type { Log } from "@opencode/plugin/gui/main"
import { Option, Schema } from "effect"
import type { ApiModule, ApiNamespace, Emit, ExtensionContext, Wire } from "./api"
import { declared } from "./tabs"
import preloadSource from "./preload.js?raw"

/** A context that listens to an event: a page frame, or the extension's service worker, which is started to hear it. */
type Subscriber = { readonly kind: "frame"; readonly process: number; readonly routing: number } | { readonly kind: "worker" }

export type ExtensionHost = Awaited<ReturnType<typeof createExtensionHost>>

/**
 * The bridge between extension contexts and the API modules. It writes the profile's preload, which adds each
 * module's namespaces to the pages and service workers of installed extensions, answers their calls and delivers
 * events to the contexts that listen.
 *
 * Trust: only a frame whose document is a `chrome-extension://` page of an extension loaded in `session`, or that
 * extension's service worker, is answered, and only for a namespace its manifest declares the permission of. Web
 * pages get no preload API, content scripts run in worlds the preload never touches, and calls from anything else
 * are refused.
 */
export async function createExtensionHost(input: {
  session: Session
  directory: string
  modules: readonly ApiModule[]
  log: Log
}) {
  const namespaces = input.modules.flatMap((module) => module.namespaces)
  const methods = new Map(input.modules.flatMap((module) => Object.entries(module.methods)))
  // Listeners by event, then by extension.
  const subscribers = new Map<string, Map<string, Subscriber[]>>()
  const workers = new Map<number, ServiceWorkerMain>()
  const file = path.join(input.directory, "extension-preload.js")

  // The modules already listen (to cookies, tabs); a host that cannot start lets them go again.
  await writeFile(
    file,
    preloadSource.replace('"__NAMESPACES__"', JSON.stringify(JSON.stringify(namespaces))),
    "utf8",
  ).catch((cause: unknown) => {
    input.modules.forEach((module) => module.dispose?.())
    throw cause
  })

  // Ids of this host alone, so a host of an earlier plugin instance that disposes late removes only its own.
  const instance = crypto.randomUUID()

  const preloads = [
    input.session.registerPreloadScript({ type: "frame", filePath: file, id: `opencode-extension-frame-${instance}` }),
    input.session.registerPreloadScript({
      type: "service-worker",
      filePath: file,
      id: `opencode-extension-worker-${instance}`,
    }),
  ]

  const extensionOf = (url: string | undefined) => {
    const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(url ?? "")?.[1]

    return id ? (input.session.extensions.getExtension(id) ?? undefined) : undefined
  }

  const call = async (context: ExtensionContext | undefined, name: string, args: readonly Wire[]) => {
    if (!context) throw new Error("This context cannot use extension APIs.")
    const run = methods.get(name)

    if (!run || !allowed(context.extension, namespaceOf(namespaces, name)))
      throw new Error(`chrome.${name} is not available in this browser.`)

    // A failure goes back to the extension; the log keeps a trace for support.
    return Promise.resolve()
      .then(() => run(context, Array.isArray(args) ? args : []))
      .catch((cause: unknown) => {
        input.log.write("debug", "extension api call failed", {
          extension: context.extension.id,
          name,
          cause: String(cause),
        })

        throw cause
      })
  }

  const subscribe = (extension: Extension | undefined, name: string, subscriber: Subscriber) => {
    if (!extension || !allowed(extension, namespaceOf(namespaces, name))) return
    const byExtension = subscribers.get(name) ?? new Map<string, Subscriber[]>()
    const list = byExtension.get(extension.id) ?? []
    const same = list.some((item) =>
      item.kind === "worker" || subscriber.kind === "worker"
        ? item.kind === subscriber.kind
        : item.process === subscriber.process && item.routing === subscriber.routing,
    )

    if (!same) byExtension.set(extension.id, [...list, subscriber])
    subscribers.set(name, byExtension)
  }

  const frameContext = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    const frame = event.senderFrame
    const extension = extensionOf(frame?.url)

    if (!frame || !extension || event.sender.session !== input.session) return undefined

    return { extension, contents: event.sender, frame }
  }

  // Pages whose IPC this host answers, so disposing removes its handlers from pages that outlive it.
  const pages = new Set<WebContents>()

  const watch = (contents: WebContents) => {
    pages.add(contents)
    contents.once("destroyed", () => pages.delete(contents))
    contents.ipc.removeHandler("browser-extension:call")
    contents.ipc.removeHandler("browser-extension:subscribe")
    contents.ipc.handle("browser-extension:call", (event, name: string, args: readonly Wire[]) =>
      call(frameContext(event), name, args),
    )
    contents.ipc.handle("browser-extension:subscribe", (event, name: string) => {
      const context = frameContext(event)

      if (context)
        subscribe(context.extension, name, {
          kind: "frame",
          process: context.frame.processId,
          routing: context.frame.routingId,
        })
    })
  }

  const created = (_event: Electron.Event, contents: WebContents) => {
    if (contents.session === input.session) watch(contents)
  }

  // A worker's handlers are attached as it starts, before its script runs and calls them.
  const started = (details: Electron.Event<Electron.ServiceWorkersRunningStatusChangedEventParams>) => {
    // Held while it runs: its handlers live on this object, which Electron does not keep alive for them.
    if (details.runningStatus === "stopped") return void workers.delete(details.versionId)

    if (workers.has(details.versionId)) return
    const worker = input.session.serviceWorkers.getWorkerFromVersionID(details.versionId)
    const extension = extensionOf(worker?.scope)

    if (!worker || !extension) return
    workers.set(details.versionId, worker)
    // A worker that stopped and starts again keeps its version and its handlers.
    worker.ipc.removeHandler("browser-extension:call")
    worker.ipc.removeHandler("browser-extension:subscribe")
    worker.ipc.handle("browser-extension:call", (_event, name: string, args: readonly Wire[]) =>
      call({ extension }, name, args),
    )
    worker.ipc.handle("browser-extension:subscribe", (_event, name: string) =>
      subscribe(extension, name, { kind: "worker" }),
    )
  }

  app.on("web-contents-created", created)
  input.session.serviceWorkers.on("running-status-changed", started)
  // Pages already open, as after a plugin reload, are answered too.
  webContents.getAllWebContents().forEach((contents) => {
    if (contents.session === input.session) watch(contents)
  })

  const deliver = (extension: string, subscriber: Subscriber, name: string, args: readonly Wire[]) => {
    if (subscriber.kind === "frame") {
      const frame = webFrameMain.fromId(subscriber.process, subscriber.routing)

      if (!frame || extensionOf(frame.url)?.id !== extension) return false
      frame.send("browser-extension:event", name, args)

      return true
    }

    // Chrome starts a stopped worker for an event it listens to; so does this.
    const scope = `chrome-extension://${extension}/`

    const running = Object.entries(input.session.serviceWorkers.getAllRunning()).find(
      ([, info]) => info.scope === scope,
    )

    const worker = running ? input.session.serviceWorkers.getWorkerFromVersionID(Number(running[0])) : undefined

    if (worker) {
      worker.send("browser-extension:event", name, args)

      return true
    }

    void input.session.serviceWorkers.startWorkerForScope(scope).then(
      (value) => value.send("browser-extension:event", name, args),
      (cause: unknown) => input.log.write("warn", "extension worker did not start", { extension, cause: String(cause) }),
    )

    return true
  }

  const emit: Emit = (name, args, extension) => {
    const byExtension = subscribers.get(name)

    if (!byExtension) return
    byExtension.forEach((list, id) => {
      if (extension !== undefined && id !== extension) return
      byExtension.set(
        id,
        list.filter((subscriber) => deliver(id, subscriber, name, args)),
      )
    })
  }

  return {
    emit,
    /** Forgets an extension's listeners, as when it is removed or turned off. */
    forget(extension: string) {
      subscribers.forEach((byExtension) => byExtension.delete(extension))
      input.modules.forEach((module) => module.forget?.(extension))
    },
    dispose() {
      app.off("web-contents-created", created)
      input.session.serviceWorkers.off("running-status-changed", started)
      preloads.forEach((id) => input.session.unregisterPreloadScript(id))

      pages.forEach((contents) => {
        if (contents.isDestroyed()) return
        contents.ipc.removeHandler("browser-extension:call")
        contents.ipc.removeHandler("browser-extension:subscribe")
      })
      pages.clear()

      workers.forEach((worker) => {
        worker.ipc.removeHandler("browser-extension:call")
        worker.ipc.removeHandler("browser-extension:subscribe")
      })
      workers.clear()
      subscribers.clear()
      input.modules.forEach((module) => module.dispose?.())
    },
  }
}

/** The namespace a `path.member` name belongs to: the one whose path is everything before the member. */
export function namespaceOf(namespaces: readonly ApiNamespace[], name: string) {
  return namespaces.find(
    (namespace) => name.startsWith(`${namespace.path}.`) && !name.slice(namespace.path.length + 1).includes("."),
  )
}

const Version = Schema.Struct({ manifest_version: Schema.optional(Schema.Number) })

/** Whether an extension may use a namespace: its manifest version matches and it declares one of its permissions. */
export function allowed(extension: Pick<Extension, "manifest">, namespace: ApiNamespace | undefined) {
  if (!namespace) return false
  const version = Option.getOrUndefined(Schema.decodeUnknownOption(Version)(extension.manifest))?.manifest_version

  if (namespace.manifest && namespace.manifest !== version) return false
  const permissions = declared(extension).permissions

  return !namespace.permissions?.length || namespace.permissions.some((item) => permissions.includes(item))
}
