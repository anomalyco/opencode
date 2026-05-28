// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FILE_TYPES,
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  type Locale,
  type Platform,
  PlatformProvider,
  ServerConnection,
  useCommand,
} from "@opencode-ai/app"
import * as Sentry from "@sentry/solid"
import type { AsyncStorage } from "@solid-primitives/storage"
import { MemoryRouter } from "@solidjs/router"
import { createEffect, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { findInPage } from "../find-in-page"
import { desktopApi } from "./api"
import { initI18n, t } from "./i18n"
import { resetZoom, setPinchZoomEnabled, webviewZoom, zoomIn, zoomOut } from "./webview-zoom"
import "./styles.css"
import { useTheme } from "@opencode-ai/ui/theme"
import type { ExtraAgentServer } from "../preload/types"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "desktop",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" &&
          !(
            import.meta.env.OPENCODE_CHANNEL === "prod" &&
            (i.name === "GlobalHandlers" || i.name === "BrowserApiErrors")
          ),
      )
    },
  })
}

void initI18n()

const deepLinkEvent = "opencode:deep-link"

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__OPENCODE__ ??= {}
  const pending = window.__OPENCODE__.deepLinks ?? []
  window.__OPENCODE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = () => {
  void desktopApi.consumeInitialDeepLinks().then((urls) => emitDeepLinks(urls))
  return desktopApi.onDeepLink((urls) => emitDeepLinks(urls))
}

const createPlatform = (refreshExtraAgents?: () => void): Platform => {
  const os = (() => {
    const ua = navigator.userAgent
    if (ua.includes("Mac")) return "macos"
    if (ua.includes("Windows")) return "windows"
    if (ua.includes("Linux")) return "linux"
    return undefined
  })()

  const isWslEnabled = async () => {
    if (os !== "windows") return false
    return desktopApi
      .getWslConfig()
      .then((config) => config.enabled)
      .catch(() => false)
  }

  const wslHome = async () => {
    if (!(await isWslEnabled())) return undefined
    return desktopApi.wslPath("~", "windows").catch(() => undefined)
  }

  const handleWslPicker = async <T extends string | string[]>(result: T | null): Promise<T | null> => {
    if (!result || !(await isWslEnabled())) return result
    if (Array.isArray(result)) {
      return Promise.all(result.map((path) => desktopApi.wslPath(path, "linux").catch(() => path))) as any
    }
    return desktopApi.wslPath(result, "linux").catch(() => result) as any
  }

  const runDesktopMenuAction: Platform["runDesktopMenuAction"] = (action) => {
    switch (action) {
      case "view.resetZoom":
        resetZoom()
        return
      case "view.zoomIn":
        zoomIn()
        return
      case "view.zoomOut":
        zoomOut()
        return
    }

    return desktopApi.runDesktopMenuAction(action)
  }

  const storage = (() => {
    const cache = new Map<string, AsyncStorage>()

    const createStorage = (name: string) => {
      const api: AsyncStorage = {
        getItem: (key: string) => desktopApi.storeGet(name, key),
        setItem: (key: string, value: string) => desktopApi.storeSet(name, key, value),
        removeItem: (key: string) => desktopApi.storeDelete(name, key),
        clear: () => desktopApi.storeClear(name),
        key: async (index: number) => (await desktopApi.storeKeys(name))[index],
        getLength: () => desktopApi.storeLength(name),
        get length() {
          return api.getLength()
        },
      }
      return api
    }

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
    os,
    version: pkg.version,

    async openDirectoryPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await desktopApi.openDirectoryPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath,
      })
      return await handleWslPicker(result)
    },

    async openFilePickerDialog(opts) {
      const result = await desktopApi.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
        accept: opts?.accept ?? ACCEPTED_FILE_TYPES,
        extensions: opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS,
      })
      return handleWslPicker(result)
    },

    async saveFilePickerDialog(opts) {
      const result = await desktopApi.saveFilePicker({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return handleWslPicker(result)
    },

    openLink(url: string) {
      desktopApi.openLink(url)
    },
    async openPath(path: string, app?: string) {
      if (os === "windows") {
        const resolvedApp = app ? await desktopApi.resolveAppPath(app).catch(() => null) : null
        const resolvedPath = await (async () => {
          if (await isWslEnabled()) {
            const converted = await desktopApi.wslPath(path, "windows").catch(() => null)
            if (converted) return converted
          }
          return path
        })()
        return desktopApi.openPath(resolvedPath, resolvedApp ?? undefined)
      }
      return desktopApi.openPath(path, app)
    },

    openInFinder: (path: string) => desktopApi.openInFinder(path),

    openInVscode: (path: string) => desktopApi.openInEditor("vscode", path),

    openInEditor: (editor: string, path: string) => desktopApi.openInEditor(editor, path),

    getCustomEditorPath: () => desktopApi.getCustomEditorPath(),

    setCustomEditorPath: (path) => desktopApi.setCustomEditorPath(path),

    getDefaultEditor: () => desktopApi.getDefaultEditor(),

    setDefaultEditor: (editor) => desktopApi.setDefaultEditor(editor),

    reloadBackend: async () => {
      await desktopApi.reloadBackend()
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage,

    checkUpdate: async () => {
      const config = await desktopApi.getWindowConfig().catch(() => ({ updaterEnabled: false }))
      if (!config.updaterEnabled) return { updateAvailable: false }
      return desktopApi.checkUpdate()
    },

    updateAndRestart: async () => {
      const config = await desktopApi.getWindowConfig().catch(() => ({ updaterEnabled: false }))
      if (!config.updaterEnabled) return
      await desktopApi.installUpdate()
    },

    exportDebugLogs: () => desktopApi.exportDebugLogs(),

    recordFatalRendererError: (error) => desktopApi.recordFatalRendererError(error),

    restart: async () => {
      await desktopApi.killSidecar().catch(() => undefined)
      desktopApi.relaunch()
    },

    notify: async (title, description, href) => {
      const focused = await desktopApi.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://opencode.ai/favicon-96x96-v3.png",
      })
      notification.onclick = () => {
        void desktopApi.showWindow()
        void desktopApi.setWindowFocus()
        handleNotificationClick(href)
        notification.close()
      }
    },

    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)
      return fetch(input, init)
    },

    getWslEnabled: () => isWslEnabled(),

    setWslEnabled: async (enabled) => {
      await desktopApi.setWslConfig({ enabled })
    },

    getDefaultServer: async () => {
      const url = await desktopApi.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: string | null) => {
      await desktopApi.setDefaultServerUrl(url)
    },

    getDisplayBackend: async () => {
      return desktopApi.getDisplayBackend().catch(() => null)
    },

    setDisplayBackend: async (backend) => {
      await desktopApi.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => desktopApi.parseMarkdownCommand(markdown),

    webviewZoom,

    getPinchZoomEnabled: () => desktopApi.getPinchZoomEnabled(),

    setPinchZoomEnabled,

    runDesktopMenuAction,

    checkAppExists: async (appName: string) => {
      return desktopApi.checkAppExists(appName)
    },

    filterDirectories: (paths: string[]) => desktopApi.filterDirectories(paths),

    async find(query, dir) {
      return findInPage(query, dir)
    },

    listConfigFiles: (directory?: string | null) => desktopApi.listConfigFiles(directory),

    readConfigFile: (path: string) => desktopApi.readConfigFile(path),

    writeConfigFile: (path: string, content: string) => desktopApi.writeConfigFile(path, content),

    createConfigFile: (path: string, content: string) => desktopApi.createConfigFile(path, content),

    getConfigWorkspace: () => desktopApi.getConfigWorkspace(),

    listConfigDirectory: (path: string) => desktopApi.listConfigDirectory(path),

    listLocalDirectory: (path: string) => desktopApi.listLocalDirectory(path),

    listTrellisTasks: (directory: string) => desktopApi.listTrellisTasks(directory),

    getOpenclawConfig: () => desktopApi.getOpenclawConfig(),

    setOpenclawConfig: async (config) => {
      await desktopApi.setOpenclawConfig(config)
      refreshExtraAgents?.()
    },

    testOpenclawConfig: (config) => desktopApi.testOpenclawConfig(config),

    detectOpenclawConfig: () => desktopApi.detectOpenclawConfig(),

    abortOpenclawTest: () => desktopApi.abortOpenclawTest(),

    getGenericagentConfig: () => desktopApi.getGenericagentConfig(),

    setGenericagentConfig: async (config) => {
      await desktopApi.setGenericagentConfig(config)
      refreshExtraAgents?.()
    },

    testGenericagentConfig: (config) => desktopApi.testGenericagentConfig(config),

    abortGenericagentTest: () => desktopApi.abortGenericagentTest(),

    getHermesConfig: () => desktopApi.getHermesConfig(),

    setHermesConfig: async (config) => {
      await desktopApi.setHermesConfig(config)
      refreshExtraAgents?.()
    },

    testHermesConfig: (config) => desktopApi.testHermesConfig(config),

    abortHermesTest: () => desktopApi.abortHermesTest(),

    async readClipboardImage() {
      const image = await desktopApi.readClipboardImage().catch(() => null)
      if (!image) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, {
        type: "image/png",
      })
    },
  }
}

let menuTrigger = null as null | ((id: string) => void)
desktopApi.onMenuCommand((id) => {
  menuTrigger?.(id)
})
listenForDeepLinks()

render(() => {
  const [extraAgentVersion, setExtraAgentVersion] = createSignal(0)
  const platform = createPlatform(() => setExtraAgentVersion((value) => value + 1))
  const [windowConfig] = createResource(() => desktopApi.getWindowConfig().catch(() => ({ updaterEnabled: false })))
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

  const [windowCount] = createResource(() => desktopApi.getWindowCount())

  // Fetch sidecar credentials (available immediately, before health check)
  const [sidecar] = createResource(() => desktopApi.awaitInitialization(() => undefined))
  const [extraAgents] = createResource(extraAgentVersion, () => desktopApi.listExtraAgentServers().catch(() => []))
  // Runtime extra-agent refreshes should update server state without remounting the app shell.
  const extraAgentsInitialLoading = () => extraAgents.loading && extraAgents.latest === undefined

  const [defaultServer] = createResource(() =>
    platform.getDefaultServer?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    }),
  )
  const [locale] = createResource(loadLocale)

  const servers = () => {
    const data = sidecar()
    if (!data) return []
    const server: ServerConnection.Sidecar = {
      displayName: "Local Server",
      type: "sidecar",
      variant: "base",
      http: {
        url: data.url,
        username: data.username ?? undefined,
        password: data.password ?? undefined,
      },
    }
    return [server, ...extraAgentConnections(extraAgents.latest ?? [])] as ServerConnection.Any[]
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)

    const theme = useTheme()

    onMount(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
        if (event.key.toLowerCase() !== "f") return

        event.preventDefault()
        event.stopPropagation()
        cmd.trigger("page.find", "keybind")
      }

      window.addEventListener("keydown", onKeyDown, { capture: true })
      onCleanup(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))
    })

    createEffect(() => {
      theme.themeId()
      theme.mode()
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
      if (bg) {
        void desktopApi.setBackgroundColor(bg)
      }
    })

    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show
          when={
            !defaultServer.loading &&
            !sidecar.loading &&
            !extraAgentsInitialLoading() &&
            !windowConfig.loading &&
            !windowCount.loading &&
            !locale.loading
          }
        >
          {(_) => {
            return (
              <AppInterface
                defaultServer={defaultServer.latest ?? ServerConnection.Key.make("sidecar")}
                servers={servers()}
                router={MemoryRouter}
              >
                <Inner />
              </AppInterface>
            )
          }}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)

function extraAgentConnections(items: ExtraAgentServer[]): ServerConnection.Http[] {
  return items.map((item) => ({
    displayName: extraAgentLabel(item.id),
    integration: item.id,
    type: "http",
    http: {
      url: item.url,
      username: item.username ?? undefined,
      password: item.password ?? undefined,
    },
  }))
}

function extraAgentLabel(id: ExtraAgentServer["id"]) {
  if (id === "openclaw") return "OpenClaw"
  if (id === "hermes") return "Hermes"
  return "GenericAgent"
}
