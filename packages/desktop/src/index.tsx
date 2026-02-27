// @refresh reload

import {
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  type Platform,
  PlatformProvider,
  ServerConnection,
  useCommand,
} from "@opencode-ai/app"
import { Splash } from "@opencode-ai/ui/logo"
import type { AsyncStorage } from "@solid-primitives/storage"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { readImage } from "@tauri-apps/plugin-clipboard-manager"
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link"
import { open, save } from "@tauri-apps/plugin-dialog"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification"
import { type as ostype } from "@tauri-apps/plugin-os"
import { relaunch } from "@tauri-apps/plugin-process"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { Store } from "@tauri-apps/plugin-store"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { createResource, type JSX, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../package.json"
import { initI18n, t } from "./i18n"
import { UPDATER_ENABLED } from "./updater"
import { webviewZoom } from "./webview-zoom"
import "./styles.css"
import { Channel } from "@tauri-apps/api/core"
import { commands, ServerReadyData, type InitStep } from "./bindings"
import { createMenu } from "./menu"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()

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

const createPlatform = (): Platform => {
  const os = (() => {
    const type = ostype()
    if (type === "macos" || type === "windows" || type === "linux") return type
    return undefined
  })()

  const wslHome = async () => {
    if (os !== "windows" || !window.__OPENCODE__?.wsl) return undefined
    return commands.wslPath("~", "windows").catch(() => undefined)
  }

  const handleWslPicker = async <T extends string | string[]>(result: T | null): Promise<T | null> => {
    if (!result || !window.__OPENCODE__?.wsl) return result
    if (Array.isArray(result)) {
      return Promise.all(result.map((path) => commands.wslPath(path, "linux").catch(() => path))) as any
    }
    return commands.wslPath(result, "linux").catch(() => result) as any
  }

  return {
    platform: "desktop",
    os,
    version: pkg.version,

    async openDirectoryPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await open({
        directory: true,
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath,
      })
      return await handleWslPicker(result)
    },

    async openFilePickerDialog(opts) {
      const result = await open({
        directory: false,
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
      })
      return handleWslPicker(result)
    },

    async saveFilePickerDialog(opts) {
      const result = await save({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return handleWslPicker(result)
    },

    openLink(url: string) {
      void shellOpen(url).catch(() => undefined)
    },
    async openPath(path: string, app?: string) {
      await commands.openPath(path, app ?? null)
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
      if (ostype() === "windows") await commands.killSidecar().catch(() => undefined)
      await update.install().catch(() => undefined)
    },

    restart: async () => {
      await commands.killSidecar().catch(() => undefined)
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
            handleNotificationClick(href)
            notification.close()
          }
        })
        .catch(() => undefined)
    },

    fetch: (input, init) => {
      if (input instanceof Request) {
        return tauriFetch(input)
      } else {
        return tauriFetch(input, init)
      }
    },

    getWslEnabled: async () => {
      const next = await commands.getWslConfig().catch(() => null)
      if (next) return next.enabled
      return window.__OPENCODE__!.wsl ?? false
    },

    setWslEnabled: async (enabled) => {
      await commands.setWslConfig({ enabled })
    },

    getDefaultServerUrl: async () => {
      const result = await commands.getDefaultServerUrl().catch(() => null)
      return result
    },

    setDefaultServerUrl: async (url: string | null) => {
      await commands.setDefaultServerUrl(url)
    },

    getDisplayBackend: async () => {
      const result = await commands.getDisplayBackend().catch(() => null)
      return result
    },

    setDisplayBackend: async (backend) => {
      await commands.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => commands.parseMarkdownCommand(markdown),

    webviewZoom,

    checkAppExists: async (appName: string) => {
      return commands.checkAppExists(appName)
    },

    async readClipboardImage() {
      const image = await readImage().catch(() => null)
      if (!image) return null
      const bytes = await image.rgba().catch(() => null)
      if (!bytes || bytes.length === 0) return null
      const size = await image.size().catch(() => null)
      if (!size) return null
      const canvas = document.createElement("canvas")
      canvas.width = size.width
      canvas.height = size.height
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      const imageData = ctx.createImageData(size.width, size.height)
      imageData.data.set(bytes)
      ctx.putImageData(imageData, 0, 0)
      return new Promise<File | null>((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) return resolve(null)
          resolve(
            new File([blob], `pasted-image-${Date.now()}.png`, {
              type: "image/png",
            }),
          )
        }, "image/png")
      })
    },
  }
}

let menuTrigger = null as null | ((id: string) => void)
createMenu((id) => {
  menuTrigger?.(id)
})
void listenForDeepLinks()

render(() => {
  const platform = createPlatform()

  const [defaultServer] = createResource(() =>
    platform.getDefaultServerUrl?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    }),
  )

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
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <ServerGate>
          {(data) => {
            const http = {
              url: data.url,
              username: data.username ?? undefined,
              password: data.password ?? undefined,
            }
            const server: ServerConnection.Any = data.is_sidecar
              ? {
                  displayName: "Local Server",
                  type: "sidecar",
                  variant: "base",
                  http,
                }
              : { type: "http", http }

            function Inner() {
              const cmd = useCommand()

              menuTrigger = (id) => cmd.trigger(id)

              return null
            }

            return (
              <Show when={!defaultServer.loading}>
                <AppInterface defaultServer={defaultServer.latest ?? ServerConnection.key(server)} servers={[server]}>
                  <Inner />
                </AppInterface>
              </Show>
            )
          }}
        </ServerGate>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)

// Gate component that waits for the server to be ready
function ServerGate(props: { children: (data: ServerReadyData) => JSX.Element }) {
  const [serverData] = createResource(() => commands.awaitInitialization(new Channel<InitStep>() as any))
  if (serverData.state === "errored") throw serverData.error

  return (
    <Show
      when={serverData.state !== "pending" && serverData()}
      fallback={
        <div class="h-screen w-screen flex flex-col items-center justify-center bg-background-base">
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
          <div data-tauri-decorum-tb class="flex flex-row absolute top-0 right-0 z-10 h-10" />
        </div>
      }
    >
      {(data) => props.children(data())}
    </Show>
  )
}
