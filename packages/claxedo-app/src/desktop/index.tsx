// @refresh reload
import "./webview-zoom"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { PlatformProvider, type Platform } from "@/context/platform"
import { open, save } from "@tauri-apps/plugin-dialog"
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { type as ostype } from "@tauri-apps/plugin-os"
import { check, Update } from "@tauri-apps/plugin-updater"
import { invoke, Channel } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification"
import { relaunch } from "@tauri-apps/plugin-process"
import { AsyncStorage } from "@solid-primitives/storage"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { Store } from "@tauri-apps/plugin-store"
import { ClaxedoSplash } from "@claxedo/claxedo-ui/components/claxedo-logo"
import { createSignal, Show, Accessor, JSX, createResource, onMount, onCleanup } from "solid-js"

import { initClaxedo, getDefaultConfig, ConfigProvider, getAuthToken } from "@claxedo/index"

import { UPDATER_ENABLED } from "./updater"
import { createMenu } from "./menu"
import { initI18n, t } from "./i18n"
import pkg from "../../../desktop/package.json"
import "./styles.css"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()

const encode = (reason: unknown) => {
  if (reason instanceof Error) return { name: reason.name, message: reason.message, stack: reason.stack ?? null }
  if (typeof reason === "string") return { message: reason }
  return { message: String(reason) }
}

const showFatal = (label: string, payload: unknown) => {
  window.__OPENCODE__ ??= {}
  ;(window.__OPENCODE__ as unknown as { lastError?: { label: string; payload: unknown } }).lastError = {
    label,
    payload,
  }

  const id = "opencode-fatal"
  const host =
    document.getElementById(id) ??
    (() => {
      const elt = document.createElement("div")
      elt.id = id
      elt.style.position = "fixed"
      elt.style.left = "8px"
      elt.style.right = "8px"
      elt.style.bottom = "8px"
      elt.style.zIndex = "2147483647"
      elt.style.maxHeight = "40vh"
      elt.style.overflow = "auto"
      elt.style.padding = "10px 12px"
      elt.style.borderRadius = "10px"
      elt.style.background = "rgba(0,0,0,0.80)"
      elt.style.color = "white"
      elt.style.fontFamily =
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
      elt.style.fontSize = "12px"
      elt.style.whiteSpace = "pre-wrap"
      elt.style.userSelect = "text"
      document.body.appendChild(elt)
      return elt
    })()

  const text = (() => {
    try {
      return `${label}\n` + JSON.stringify(payload, null, 2)
    } catch {
      return `${label}\n` + String(payload)
    }
  })()
  host.textContent = text
}

window.addEventListener(
  "error",
  (event) => {
    const payload = {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: encode(event.error),
    }
    console.error("[desktop] window.error", payload)
    if (import.meta.env.DEV) showFatal("window.error", payload)
  },
  true,
)

window.addEventListener(
  "unhandledrejection",
  (event) => {
    const payload = encode(event.reason)
    console.error("[desktop] unhandledrejection", payload)
    if (import.meta.env.DEV) showFatal("unhandledrejection", payload)
    event.preventDefault()
  },
  true,
)

// Initialize Claxedo
const config = getDefaultConfig()
await initClaxedo(config)

// Floating UI can call getComputedStyle with non-elements (e.g., null refs, virtual elements).
// This happens on all platforms (WebView2 on Windows, WKWebView on macOS), not just Windows.
const originalGetComputedStyle = window.getComputedStyle
window.getComputedStyle = ((elt: Element, pseudoElt?: string | null) => {
  if (!(elt instanceof Element)) {
    // Fall back to a safe element when a non-element is passed.
    return originalGetComputedStyle(document.documentElement, pseudoElt ?? undefined)
  }
  return originalGetComputedStyle(elt, pseudoElt ?? undefined)
}) as typeof window.getComputedStyle

let update: Update | null = null

const deepLinkEvent = "opencode:deep-link"

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__OPENCODE__ ??= {}
  const pending = window.__OPENCODE__.deepLinks ?? []
  window.__OPENCODE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = async () => {
  const startUrls = await getCurrent().catch(() => null)
  if (startUrls?.length) emitDeepLinks(startUrls)
  await onOpenUrl((urls) => emitDeepLinks(urls)).catch(() => undefined)
}

const createPlatform = (password: Accessor<string | null>): Platform => ({
  platform: "desktop",
  os: (() => {
    const type = ostype()
    if (type === "macos" || type === "windows" || type === "linux") return type
    return undefined
  })(),
  version: pkg.version,

  async openDirectoryPickerDialog(opts) {
    const result = await open({
      directory: true,
      multiple: opts?.multiple ?? false,
      title: opts?.title ?? t("desktop.dialog.chooseFolder"),
    })
    return result
  },

  async openFilePickerDialog(opts) {
    const result = await open({
      directory: false,
      multiple: opts?.multiple ?? false,
      title: opts?.title ?? t("desktop.dialog.chooseFile"),
    })
    return result
  },

  async saveFilePickerDialog(opts) {
    const result = await save({
      title: opts?.title ?? t("desktop.dialog.saveFile"),
      defaultPath: opts?.defaultPath,
    })
    return result
  },

  openLink(url: string) {
    void shellOpen(url).catch(() => undefined)
  },

  back() {
    window.history.back()
  },

  forward() {
    window.history.forward()
  },

  storage: (() => {
    type StoreLike = {
      get(key: string): Promise<string | null | undefined>
      set(key: string, value: string): Promise<unknown>
      delete(key: string): Promise<unknown>
      clear(): Promise<unknown>
      keys(): Promise<string[]>
      length(): Promise<number>
    }

    const WRITE_DEBOUNCE_MS = 250

    const storeCache = new Map<string, Promise<StoreLike>>()
    const apiCache = new Map<string, AsyncStorage & { flush: () => Promise<void> }>()
    const memoryCache = new Map<string, StoreLike>()

    const flushAll = async () => {
      const apis = Array.from(apiCache.values())
      await Promise.all(apis.map((api) => api.flush().catch(() => undefined)))
    }

    if ("addEventListener" in globalThis) {
      const handleVisibility = () => {
        if (document.visibilityState !== "hidden") return
        void flushAll()
      }

      window.addEventListener("pagehide", () => void flushAll())
      document.addEventListener("visibilitychange", handleVisibility)
    }

    const createMemoryStore = () => {
      const data = new Map<string, string>()
      const store: StoreLike = {
        get: async (key) => data.get(key),
        set: async (key, value) => {
          data.set(key, value)
        },
        delete: async (key) => {
          data.delete(key)
        },
        clear: async () => {
          data.clear()
        },
        keys: async () => Array.from(data.keys()),
        length: async () => data.size,
      }
      return store
    }

    const getStore = (name: string) => {
      const cached = storeCache.get(name)
      if (cached) return cached

      const store = Store.load(name).catch(() => {
        const cached = memoryCache.get(name)
        if (cached) return cached

        const memory = createMemoryStore()
        memoryCache.set(name, memory)
        return memory
      })

      storeCache.set(name, store)
      return store
    }

    const createStorage = (name: string) => {
      const pending = new Map<string, string | null>()
      let timer: ReturnType<typeof setTimeout> | undefined
      let flushing: Promise<void> | undefined

      const flush = async () => {
        if (flushing) return flushing

        flushing = (async () => {
          const store = await getStore(name)
          while (pending.size > 0) {
            const batch = Array.from(pending.entries())
            pending.clear()
            for (const [key, value] of batch) {
              if (value === null) {
                await store.delete(key).catch(() => undefined)
              } else {
                await store.set(key, value).catch(() => undefined)
              }
            }
          }
        })().finally(() => {
          flushing = undefined
        })

        return flushing
      }

      const schedule = () => {
        if (timer) return
        timer = setTimeout(() => {
          timer = undefined
          void flush()
        }, WRITE_DEBOUNCE_MS)
      }

      const api: AsyncStorage & { flush: () => Promise<void> } = {
        flush,
        getItem: async (key: string) => {
          const next = pending.get(key)
          if (next !== undefined) return next

          const store = await getStore(name)
          const value = await store.get(key).catch(() => null)
          if (value === undefined) return null
          return value
        },
        setItem: async (key: string, value: string) => {
          pending.set(key, value)
          schedule()
        },
        removeItem: async (key: string) => {
          pending.set(key, null)
          schedule()
        },
        clear: async () => {
          pending.clear()
          const store = await getStore(name)
          await store.clear().catch(() => undefined)
        },
        key: async (index: number) => {
          const store = await getStore(name)
          return (await store.keys().catch(() => []))[index]
        },
        getLength: async () => {
          const store = await getStore(name)
          return await store.length().catch(() => 0)
        },
        get length() {
          return api.getLength()
        },
      }

      return api
    }

    return (name = "default.dat") => {
      const cached = apiCache.get(name)
      if (cached) return cached

      const api = createStorage(name)
      apiCache.set(name, api)
      return api
    }
  })(),

  checkUpdate: async () => {
    if (!UPDATER_ENABLED) return { updateAvailable: false }
    const next = await check().catch(() => null)
    if (!next) return { updateAvailable: false }
    const ok = await next
      .download()
      .then(() => true)
      .catch(() => false)
    if (!ok) return { updateAvailable: false }
    update = next
    return { updateAvailable: true, version: next.version }
  },

  update: async () => {
    if (!UPDATER_ENABLED || !update) return
    if (ostype() === "windows") await invoke("kill_sidecar").catch(() => undefined)
    await update.install().catch(() => undefined)
  },

  restart: async () => {
    await invoke("kill_sidecar").catch(() => undefined)
    await relaunch()
  },

  notify: async (title, description, href) => {
    const granted = await isPermissionGranted().catch(() => false)
    const permission = granted ? "granted" : await requestPermission().catch(() => "denied")
    if (permission !== "granted") return

    const win = getCurrentWindow()
    const focused = await win.isFocused().catch(() => document.hasFocus())
    if (focused) return

    await Promise.resolve()
      .then(() => {
        const notification = new Notification(title, {
          body: description ?? "",
          icon: "https://opencode.ai/favicon-96x96-v3.png",
        })
        notification.onclick = () => {
          const win = getCurrentWindow()
          void win.show().catch(() => undefined)
          void win.unminimize().catch(() => undefined)
          void win.setFocus().catch(() => undefined)
          if (href) {
            window.history.pushState(null, "", href)
            window.dispatchEvent(new PopStateEvent("popstate"))
          }
          notification.close()
        }
      })
      .catch(() => undefined)
  },

  fetch: (input, init) => {
    const pw = password()

    const addHeader = (headers: Headers, password: string) => {
      headers.append("Authorization", `Basic ${btoa(`opencode:${password}`)}`)
    }

    if (input instanceof Request) {
      if (pw) addHeader(input.headers, pw)
      return tauriFetch(input)
    } else {
      const headers = new Headers(init?.headers)
      if (pw) addHeader(headers, pw)
      return tauriFetch(input, {
        ...(init as any),
        headers: headers,
      })
    }
  },

  getDefaultServerUrl: async () => {
    const result = await invoke<string | null>("get_default_server_url").catch(() => null)
    return result
  },

  setDefaultServerUrl: async (url: string | null) => {
    await invoke("set_default_server_url", { url })
  },

  parseMarkdown: async (markdown: string) => {
    return invoke<string>("parse_markdown_command", { markdown })
  },

  getAuthToken,
})

createMenu()
void listenForDeepLinks()

render(() => {
  const [serverPassword, setServerPassword] = createSignal<string | null>(null)
  const platform = createPlatform(() => serverPassword())

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <ConfigProvider config={config}>
      <PlatformProvider value={platform}>
        <AppBaseProviders>
          <ServerGate>
            {(data) => {
              setServerPassword(data().password)
              window.__OPENCODE__ ??= {}
              window.__OPENCODE__.serverPassword = data().password ?? undefined

              return <AppInterface defaultUrl={data().url} />
            }}
          </ServerGate>
        </AppBaseProviders>
      </PlatformProvider>
    </ConfigProvider>
  )
}, root!)

type ServerReadyData = { url: string; password: string | null }

// Gate component that waits for the server to be ready
function ServerGate(props: { children: (data: Accessor<ServerReadyData>) => JSX.Element }) {
  const [serverData] = createResource<ServerReadyData>(() =>
    invoke("await_initialization", { events: new Channel() }).then((v) => v as ServerReadyData),
  )

  const errorMessage = () => {
    const error = serverData.error
    if (!error) return t("error.chain.unknown")
    if (typeof error === "string") return error
    if (error instanceof Error) return error.message
    return String(error)
  }

  const restartApp = async () => {
    await invoke("kill_sidecar").catch(() => undefined)
    await relaunch().catch(() => undefined)
  }

  return (
    // Not using suspense as not all components are compatible with it (undefined refs)
    <Show
      when={serverData.state === "errored"}
      fallback={
        <Show
          when={serverData.state !== "pending" && serverData()}
          fallback={
            <div class="h-screen w-screen flex flex-col items-center justify-center bg-background-base">
              <ClaxedoSplash class="w-16 h-20 opacity-50 animate-pulse" />
              <div data-tauri-decorum-tb class="flex flex-row absolute top-0 right-0 z-10 h-10" />
            </div>
          }
        >
          {(data) => props.children(data)}
        </Show>
      }
    >
      <div class="h-screen w-screen flex flex-col items-center justify-center bg-background-base gap-4 px-6">
        <div class="text-16-semibold">{t("desktop.error.serverStartFailed.title")}</div>
        <div class="text-12-regular opacity-70 text-center max-w-xl">
          {t("desktop.error.serverStartFailed.description")}
        </div>
        <div class="w-full max-w-3xl rounded border border-border bg-background-base overflow-auto max-h-64">
          <pre class="p-3 whitespace-pre-wrap break-words text-11-regular">{errorMessage()}</pre>
        </div>
        <button class="px-3 py-2 rounded bg-primary text-primary-foreground" onClick={() => void restartApp()}>
          {t("error.page.action.restart")}
        </button>
        <div data-tauri-decorum-tb class="flex flex-row absolute top-0 right-0 z-10 h-10" />
      </div>
    </Show>
  )
}
