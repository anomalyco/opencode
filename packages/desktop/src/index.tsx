// @refresh reload
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface, PlatformProvider, Platform } from "@opencode-ai/app"
import { open, save } from "@tauri-apps/plugin-dialog"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { type as ostype } from "@tauri-apps/plugin-os"
import { check, Update } from "@tauri-apps/plugin-updater"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification"
import { relaunch } from "@tauri-apps/plugin-process"
import { AsyncStorage } from "@solid-primitives/storage"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { Store } from "@tauri-apps/plugin-store"
import { Logo } from "@opencode-ai/ui/logo"
import { createSignal, Show, Accessor, JSX, createResource } from "solid-js"

import { UPDATER_ENABLED } from "./updater"
import { createMenu } from "./menu"
import pkg from "../package.json"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

let update: Update | null = null

const createPlatform = (password: Accessor<string | null>): Platform => ({
  platform: "desktop",
  version: pkg.version,

  async openDirectoryPickerDialog(opts) {
    const result = await open({
      directory: true,
      multiple: opts?.multiple ?? false,
      title: opts?.title ?? "Choose a folder",
    })
    return result
  },

  async openFilePickerDialog(opts) {
    const result = await open({
      directory: false,
      multiple: opts?.multiple ?? false,
      title: opts?.title ?? "Choose a file",
    })
    return result
  },

  async saveFilePickerDialog(opts) {
    const result = await save({
      title: opts?.title ?? "Save file",
      defaultPath: opts?.defaultPath,
    })
    return result
  },

  openLink(url: string) {
    void shellOpen(url).catch(() => undefined)
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
          icon: "https://opencode.ai/favicon-96x96.png",
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

  // @ts-expect-error
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
})

createMenu()

// Stops mousewheel events from reaching Tauri's pinch-to-zoom handler
root?.addEventListener("mousewheel", (e) => {
  e.stopPropagation()
})

render(() => {
  const [serverPassword, setServerPassword] = createSignal<string | null>(null)
  const platform = createPlatform(() => serverPassword())

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        {ostype() === "macos" && (
          <div class="mx-px bg-background-base border-b border-border-weak-base h-8" data-tauri-drag-region />
        )}
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
  )
}, root!)

type ServerReadyData = { url: string; password: string | null }

// Gate component that waits for the server to be ready
function ServerGate(props: { children: (data: Accessor<ServerReadyData>) => JSX.Element }) {
  const [serverData] = createResource<ServerReadyData>(() => invoke("ensure_server_ready"))

  return (
    // Not using suspense as not all components are compatible with it (undefined refs)
    <Show
      when={serverData.state !== "pending" && serverData()}
      fallback={
        <div class="h-screen w-screen flex flex-col items-center justify-center bg-background-base">
          <Logo class="w-xl opacity-12 animate-pulse" />
          <div class="mt-8 text-14-regular text-text-weak">Initializing...</div>
        </div>
      }
    >
      {(data) => props.children(data)}
    </Show>
  )
}
