// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  type Locale,
  type Platform,
  PlatformProvider,
  ServerConnection,
} from "@opencode-ai/app"
import { createNativeAPI } from "@opencode-ai/ipc-bridge"
import * as Sentry from "@sentry/solid"
import type { AsyncStorage } from "@solid-primitives/storage"
import { MemoryRouter } from "@solidjs/router"
import { createResource, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../package.json"
import "@/index.css"

declare global {
  interface Window {
    __YUNPAT_SERVER_URL__?: string
  }
}

const native = createNativeAPI()

const root = document.getElementById("root")
if (!(root instanceof HTMLElement)) {
  throw new Error("找不到 #root 节点")
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop-mac@${pkg.version}`,
    initialScope: {
      tags: { platform: "desktop-mac" },
    },
    integrations: (integrations) =>
      integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" &&
          !(
            import.meta.env.VITE_OPENCODE_CHANNEL === "prod" &&
            (i.name === "GlobalHandlers" || i.name === "BrowserApiErrors")
          ),
      ),
  })
}

const createPlatform = (): Platform => {
  const storage = (() => {
    const cache = new Map<string, AsyncStorage>()

    const createStorage = (name: string): AsyncStorage => ({
      getItem: (key: string) => native.storeGet(name, key),
      setItem: (key: string, value: string) => native.storeSet(name, key, value),
      removeItem: (key: string) => native.storeDelete(name, key),
      clear: () => native.storeClear(name),
      key: async (index: number) => (await native.storeKeys(name))[index],
      getLength: () => native.storeLength(name),
      get length() {
        return createStorage(name).getLength()
      },
    })

    return (name = "default.dat") => {
      const cached = cache.get(name)
      if (cached) return cached
      const api = createStorage(name)
      cache.set(name, api)
      return api
    }
  })()

  return {
    platform: "desktop",
    os: "macos",
    version: pkg.version,

    async openDirectoryPickerDialog(opts) {
      const result = await native.openDirectoryPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title,
      })
      if (!result) return null
      if (Array.isArray(result)) return result
      return result.includes(":") ? result.split(":") : result
    },

    async openFilePickerDialog(opts) {
      const result = await native.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title,
        extensions: opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS,
      })
      if (!result) return null
      if (Array.isArray(result)) return result
      return result.includes(":") ? result.split(":") : result
    },

    async saveFilePickerDialog(opts) {
      return native.saveFilePicker({
        title: opts?.title,
        defaultPath: opts?.defaultPath,
      })
    },

    openLink(url: string) {
      native.openLink(url)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage,

    restart: async () => {
      await native.killSidecar().catch(() => undefined)
      native.relaunch()
    },

    notify: async (title, description, href) => {
      const focused = await native.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return
      native.showNotification(title, description, "info")
      void native.showWindow()
      void native.setWindowFocus()
      handleNotificationClick(href)
    },

    async readClipboardImage() {
      const image = await native.readClipboardImage().catch(() => null)
      if (!image?.buffer) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, { type: "image/png" })
    },
  }
}

render(() => {
  const platform = createPlatform()

  const loadLocale = async () => {
    const current = await platform.storage?.("opencode.global.dat").getItem("language")
    const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
    const raw = current ?? legacy
    if (!raw) return
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) return
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  const [sidecar] = createResource(async () => {
    const injected = window.__YUNPAT_SERVER_URL__
    if (injected) return { url: injected, username: null, password: null }
    return native.awaitInitialization(() => undefined)
  })

  const [locale] = createResource(loadLocale)

  const servers = () => {
    const data = sidecar()
    if (!data) return []
    const server: ServerConnection.Sidecar = {
      displayName: "本地服务",
      type: "sidecar",
      variant: "base",
      http: {
        url: data.url,
        username: data.username ?? undefined,
        password: data.password ?? undefined,
      },
    }
    return [server] as ServerConnection.Any[]
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => document.removeEventListener("click", handleClick))
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show when={!sidecar.loading && !locale.loading}>
          <AppInterface
            defaultServer={ServerConnection.Key.make("sidecar")}
            servers={servers()}
            router={MemoryRouter}
          />
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root)
