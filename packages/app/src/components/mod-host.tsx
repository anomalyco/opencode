import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, type Accessor } from "solid-js"
import { usePlatform, type DesktopMod, type Platform } from "@/context/platform"
import { useCommand, type CommandOption } from "@/context/command"

type ModPanel = {
  modID: string
  panelID: string
}

type ModMessage = {
  source?: string
  requestID?: string
  action?: string
  key?: string
  value?: string
  url?: string
}

type HostRuntime = {
  dispose: Set<() => void>
  host: NonNullable<Window["opencodeHost"]>["forMod"] extends (id: string) => infer Value ? Value : never
}

declare global {
  interface Window {
    opencodeHost?: {
      forScript: () => {
        id: string
        commands: {
          register: (command: CommandOption) => () => void
        }
        ui: {
          mount: (id: string, selector?: string) => HTMLElement
          style: (id: string, css: string) => () => void
          observe: (selector: string, callback: (element: HTMLElement) => void) => () => void
        }
        events: {
          emit: (type: string, detail?: unknown) => void
          on: (type: string, listener: EventListener) => () => void
        }
        storage: {
          get: (key: string) => Promise<string | null>
          set: (key: string, value: string) => Promise<void>
          delete: (key: string) => Promise<void>
        }
        openExternal: (url: string) => Promise<void>
        reload: () => void
        desktop: typeof window.api
      }
      forMod: (id: string) => {
        id: string
        commands: {
          register: (command: CommandOption) => () => void
        }
        ui: {
          mount: (id: string, selector?: string) => HTMLElement
          style: (id: string, css: string) => () => void
          observe: (selector: string, callback: (element: HTMLElement) => void) => () => void
        }
        events: {
          emit: (type: string, detail?: unknown) => void
          on: (type: string, listener: EventListener) => () => void
        }
        storage: {
          get: (key: string) => Promise<string | null>
          set: (key: string, value: string) => Promise<void>
          delete: (key: string) => Promise<void>
        }
        openExternal: (url: string) => Promise<void>
        reload: () => void
        desktop: typeof window.api
      }
      commands: {
        register: (command: CommandOption) => () => void
      }
      ui: {
        mount: (id: string, selector?: string) => HTMLElement
      }
      reload: () => void
    }
  }
}

export function ModHostScripts() {
  const command = useCommand()
  const platform = usePlatform()
  const [mods, { refetch }] = createResource(() => platform.mods?.list())
  const [commands, setCommands] = createSignal<CommandOption[]>([])
  const scripts = new Map<string, HTMLScriptElement>()
  const runtimes = new Map<string, HostRuntime>()
  const registerCommand = (item: CommandOption) => {
    setCommands((current) => [
      ...current.filter((command) => command.id !== item.id),
      { ...item, category: item.category ?? "MODs" },
    ])
    return () => setCommands((current) => current.filter((command) => command.id !== item.id))
  }
  const mount = (id: string, selector = "body") => {
    const target = document.querySelector(selector)
    if (!target) throw new Error(`MOD host mount target "${selector}" was not found`)
    target.querySelector(`[data-opencode-mod-host="${CSS.escape(id)}"]`)?.remove()
    const element = document.createElement("div")
    element.dataset.opencodeModHost = id
    target.append(element)
    return element
  }
  const host: NonNullable<Window["opencodeHost"]> = {
    forScript: () => {
      const id = (document.currentScript as HTMLScriptElement | null)?.dataset.opencodeModHostScript
      if (!id) throw new Error("opencodeHost.forScript() must be called while a MOD host script is loading")
      return host.forMod(id)
    },
    forMod: (id) => {
      const runtime = runtimes.get(id)
      if (!runtime) throw new Error(`MOD host "${id}" is not active`)
      return runtime.host
    },
    commands: {
      register: registerCommand,
    },
    ui: {
      mount,
    },
    reload: () => window.location.reload(),
  }

  window.opencodeHost = host
  command.register("mods-host", commands)

  const refresh = () => void refetch()
  window.addEventListener("opencode:mods-changed", refresh)
  onCleanup(() => {
    window.removeEventListener("opencode:mods-changed", refresh)
    scripts.forEach((script) => script.remove())
    runtimes.forEach((runtime) => runtime.dispose.forEach((dispose) => dispose()))
    if (window.opencodeHost === host) delete window.opencodeHost
  })

  createEffect(() => {
    const desired = new Map(
      (mods.latest ?? [])
        .filter((mod) => mod.enabled && mod.compatible && mod.contributes?.host)
        .map((mod) => [mod.id, modURL(mod.id, mod.contributes!.host!)]),
    )
    scripts.forEach((script, id) => {
      if (desired.has(id)) return
      script.remove()
      scripts.delete(id)
      runtimes.get(id)?.dispose.forEach((dispose) => dispose())
      runtimes.delete(id)
    })
    desired.forEach((src, id) => {
      if (scripts.has(id)) return
      const dispose = new Set<() => void>()
      const track = (cleanup: () => void) => {
        dispose.add(cleanup)
        return () => {
          cleanup()
          dispose.delete(cleanup)
        }
      }
      runtimes.set(id, {
        dispose,
        host: {
          id,
          commands: {
            register: (item) => track(registerCommand({ ...item, id: `mod.${id}.${item.id}` })),
          },
          ui: {
            mount: (name, selector) => {
              const element = mount(`${id}.${name}`, selector)
              track(() => element.remove())
              return element
            },
            style: (name, css) => {
              const selector = `[data-opencode-mod-host-style="${CSS.escape(`${id}.${name}`)}"]`
              document.head.querySelector(selector)?.remove()
              const style = document.createElement("style")
              style.dataset.opencodeModHostStyle = `${id}.${name}`
              style.textContent = css
              document.head.append(style)
              return track(() => style.remove())
            },
            observe: (selector, callback) => {
              const seen = new WeakSet<HTMLElement>()
              const run = () =>
                document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
                  if (seen.has(element)) return
                  seen.add(element)
                  callback(element)
                })
              const observer = new MutationObserver(run)
              observer.observe(document.documentElement, { childList: true, subtree: true })
              run()
              return track(() => observer.disconnect())
            },
          },
          events: {
            emit: (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail })),
            on: (type, listener) => {
              window.addEventListener(type, listener)
              return track(() => window.removeEventListener(type, listener))
            },
          },
          storage: {
            get: (key) => platform.mods?.storageGet(id, key) ?? Promise.reject(new Error("MOD storage is unavailable")),
            set: (key, value) =>
              platform.mods?.storageSet(id, key, value) ?? Promise.reject(new Error("MOD storage is unavailable")),
            delete: (key) =>
              platform.mods?.storageDelete(id, key) ?? Promise.reject(new Error("MOD storage is unavailable")),
          },
          openExternal: (url) =>
            platform.mods?.openExternal(id, url) ?? Promise.reject(new Error("External links are unavailable")),
          reload: () => window.location.reload(),
          desktop: window.api,
        },
      })
      const script = document.createElement("script")
      script.src = src
      script.async = false
      script.dataset.opencodeModHostScript = id
      script.addEventListener(
        "error",
        () => {
          script.remove()
          scripts.delete(id)
          runtimes.get(id)?.dispose.forEach((dispose) => dispose())
          runtimes.delete(id)
        },
        { once: true },
      )
      document.head.append(script)
      scripts.set(id, script)
    })
  })

  return null
}

export function ModStyles() {
  const platform = usePlatform()
  const [mods, { refetch }] = createResource(() => platform.mods?.list())

  const refresh = () => void refetch()
  window.addEventListener("opencode:mods-changed", refresh)
  onCleanup(() => window.removeEventListener("opencode:mods-changed", refresh))

  const styles = createMemo(() =>
    (mods.latest ?? [])
      .filter((mod) => mod.enabled && mod.compatible && mod.contributes?.styles)
      .map((mod) => ({ id: mod.id, href: modURL(mod.id, mod.contributes!.styles!) })),
  )

  return (
    <For each={styles()}>
      {(style) => <link data-opencode-mod-style={style.id} rel="stylesheet" href={style.href} />}
    </For>
  )
}

export function ModSidebarItems(props: {
  active: Accessor<ModPanel | undefined>
  open: (modID: string, panelID: string) => void
  close: () => void
}) {
  const platform = usePlatform()
  const [mods, { refetch }] = createResource(() => platform.mods?.list())

  const refresh = () => void refetch()
  const openPanel = (event: Event) => {
    const detail = (event as CustomEvent<ModPanel>).detail
    if (!detail?.modID || !detail.panelID) return
    props.open(detail.modID, detail.panelID)
  }
  window.addEventListener("opencode:mods-changed", refresh)
  window.addEventListener("opencode:open-mod-panel", openPanel)
  onCleanup(() => {
    window.removeEventListener("opencode:mods-changed", refresh)
    window.removeEventListener("opencode:open-mod-panel", openPanel)
  })

  const panels = createMemo(() =>
    (mods.latest ?? [])
      .filter((mod) => mod.enabled && mod.compatible)
      .flatMap((mod) =>
        (mod.contributes?.sidebar ?? []).map((panel) => ({
          ...panel,
          modID: mod.id,
          order: panel.order ?? 0,
        })),
      )
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title)),
  )

  return (
    <For each={panels()}>
      {(panel) => (
        <Tooltip placement="right" value={panel.title}>
          <IconButton
            icon="sidebar"
            variant="ghost"
            size="large"
            aria-label={panel.title}
            onClick={() => {
              const active = props.active()
              if (active?.modID === panel.modID && active.panelID === panel.id) return props.close()
              props.open(panel.modID, panel.id)
            }}
          />
        </Tooltip>
      )}
    </For>
  )
}

export function ModSidebarPanel(props: { panel: ModPanel }) {
  const platform = usePlatform()
  const [mods] = createResource(() => platform.mods?.list())
  const panel = createMemo(() => findPanel(mods.latest ?? [], props.panel))
  let frame: HTMLIFrameElement | undefined

  const receive = (event: MessageEvent<ModMessage>) => {
    if (event.source !== frame?.contentWindow) return
    if (event.data?.source !== "opencode-mod" || !event.data.requestID || !event.data.action) return
    const mod = panel()?.mod
    if (!mod || !platform.mods) return
    void runRequest(platform.mods, mod.id, event.data)
      .then((value) => reply(event, { source: "opencode-host", requestID: event.data.requestID, ok: true, value }))
      .catch((error) =>
        reply(event, {
          source: "opencode-host",
          requestID: event.data.requestID,
          ok: false,
          error: error instanceof Error ? error.message : "MOD request failed",
        }),
      )
  }

  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))

  return (
    <div class="h-full min-h-0 min-w-0 bg-background-base">
      <iframe
        ref={(element) => {
          frame = element
        }}
        title={panel()?.panel.title ?? "OpenCode MOD"}
        class="h-full w-full border-0 bg-background-base"
        sandbox="allow-scripts"
        src={panel() ? modURL(props.panel.modID, panel()!.panel.entry) : undefined}
      />
    </div>
  )
}

function findPanel(mods: DesktopMod[], target: ModPanel) {
  const mod = mods.find((item) => item.id === target.modID && item.enabled && item.compatible)
  const panel = mod?.contributes?.sidebar?.find((item) => item.id === target.panelID)
  if (!mod || !panel) return
  return { mod, panel }
}

async function runRequest(
  mods: NonNullable<Platform["mods"]>,
  modID: string,
  request: Required<Pick<ModMessage, "action">> & ModMessage,
) {
  if (request.action === "storage.get" && typeof request.key === "string") return mods.storageGet(modID, request.key)
  if (request.action === "storage.set" && typeof request.key === "string" && typeof request.value === "string") {
    return mods.storageSet(modID, request.key, request.value)
  }
  if (request.action === "storage.delete" && typeof request.key === "string")
    return mods.storageDelete(modID, request.key)
  if (request.action === "external.open" && typeof request.url === "string")
    return mods.openExternal(modID, request.url)
  if (request.action === "window.open") return mods.openWindow(modID)
  throw new Error("Unsupported MOD request")
}

function reply(event: MessageEvent, data: object) {
  ;(event.source as WindowProxy | null)?.postMessage(data, "*")
}

function modURL(id: string, file: string) {
  return `oc-mod://${id}/${file
    .replace(/^[/\\]+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`
}
