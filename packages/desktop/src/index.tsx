// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  filePickerFilters,
} from "../../app/src"
import { AppBaseProviders, AppInterface } from "../../app/src/app"
import { type Locale, loadLocaleDict, normalizeLocale } from "../../app/src/context/language"
import { type Platform, PlatformProvider } from "../../app/src/context/platform"
import { ServerConnection } from "../../app/src/context/server"
import { useCommand } from "../../app/src/context/command"
import { handleNotificationClick } from "../../app/src/utils/notification-click"
import type { AsyncStorage } from "@solid-primitives/storage"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { listen } from "@tauri-apps/api/event"
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
import { createEffect, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../package.json"
import { initI18n, startup, t } from "./i18n"
import { UPDATER_ENABLED } from "./updater"
import { webviewZoom } from "./webview-zoom"
import "./styles.css"
import { Channel } from "@tauri-apps/api/core"
import { commands, type InitStep } from "./bindings"
import { findInPage } from "./find-in-page"
import { createMenu } from "./menu"
import { pathRoute, routeInitialPath } from "./path-route"

function loopback(url: string) {
  try {
    const next = new URL(url)
    if (next.protocol !== "http:") return false
    return next.hostname === "localhost" || next.hostname === "127.0.0.1" || next.hostname === "::1" || next.hostname === "[::1]"
  } catch {
    return false
  }
}

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()

document.documentElement.dataset.platform = "desktop"

const os = (() => {
  const type = ostype()
  if (type === "macos" || type === "windows" || type === "linux") return type
  return undefined
})()

if (os) document.documentElement.dataset.os = os

let update: Update | null = null
let reloadTask: Promise<void> | undefined
const [openclawTick, setOpenclawTick] = createSignal(0)
const [hermesTick, setHermesTick] = createSignal(0)
const [genericagentTick, setGenericagentTick] = createSignal(0)

type StartupPhase = "launch" | "backend" | "project" | "session" | "ready"
const startupReadyEvent = "opencode:startup-interactive"
type HermesConfig = {
  enabled: boolean
  pythonExecutable?: string
  hermesDir?: string
  hermesHome?: string
}
type HermesTest = {
  ok: boolean
  logs: string[]
}
type GenericagentConfig = {
  enabled: boolean
  pythonExecutable?: string
  genericAgentDir?: string
}
type GenericagentTest = {
  ok: boolean
  logs: string[]
}
type DesktopTrellisTask = {
  id: string
  name: string
  title: string
  status: string
  priority?: string
  assignee?: string
  package?: string
  parent?: string
  children: string[]
  createdAt?: string
  completedAt?: string
  path: string
  current: boolean
}
type DesktopTrellisTaskList = {
  root: string
  current?: string
  tasks: DesktopTrellisTask[]
}
type DesktopPlatform = Platform & {
  getHermesConfig: () => Promise<HermesConfig>
  setHermesConfig: (config: HermesConfig) => Promise<void> | void
  testHermesConfig: (config: HermesConfig) => Promise<HermesTest>
  abortHermesTest: () => Promise<boolean>
  getGenericagentConfig: () => Promise<GenericagentConfig>
  setGenericagentConfig: (config: GenericagentConfig) => Promise<void> | void
  testGenericagentConfig: (config: GenericagentConfig) => Promise<GenericagentTest>
  abortGenericagentTest: () => Promise<boolean>
  listTrellisTasks: (directory: string) => Promise<DesktopTrellisTaskList>
  listLocalDirectory: (path: string) => Promise<Array<{ path: string; kind: "file" | "directory" }>>
}

function startupShell() {
  if (location.pathname === "/loading") return
  const root = document.getElementById("oc-startup-shell")
  const app = document.getElementById("root")
  const title = document.getElementById("oc-startup-title")
  const note = document.getElementById("oc-startup-note")
  const actions = document.getElementById("oc-startup-actions")
  const retry = document.getElementById("oc-startup-retry")
  const steps = Array.from(document.querySelectorAll<HTMLElement>(".desktop-startup-step[data-step]"))
  if (
    !(root instanceof HTMLElement) ||
    !(app instanceof HTMLElement) ||
    !(title instanceof HTMLElement) ||
    !(note instanceof HTMLElement) ||
    !(actions instanceof HTMLElement) ||
    !(retry instanceof HTMLButtonElement)
  ) {
    return
  }

  const state = {
    hidden: false,
  }

  const setNote = (value?: string) => {
    const text = value?.trim()
    note.textContent = text ?? ""
    note.hidden = !text
  }

  const setActions = (value: boolean) => {
    actions.hidden = !value
  }

  const complete = () => {
    show("ready")
    window.setTimeout(hide, 140)
  }

  const onReady = () => complete()
  const onStartup = (_event: Event) => {}
  window.addEventListener(startupReadyEvent, onReady, { once: true })
  window.addEventListener("opencode:startup-ready", onStartup)
  window.addEventListener(startupReadyEvent, onStartup)
  retry.onclick = () => {
    retry.disabled = true
    void relaunch().finally(() => {
      retry.disabled = false
    })
  }

  // This shell intentionally lives in the main window, not in styles.css, so we can
  // keep painting a localized loading state after the native loading window closes.
  const copy: Record<StartupPhase, () => { title: string }> = {
    launch: () => ({
      title: startup().launch,
    }),
    backend: () => ({
      title: startup().backend,
    }),
    project: () => ({
      title: startup().project,
    }),
    session: () => ({
      title: startup().session,
    }),
    ready: () => ({
      title: startup().ready,
    }),
  }

  const order: StartupPhase[] = ["backend", "project", "session"]

  const show = (phase: StartupPhase) => {
    if (state.hidden) return
    root.dataset.phase = phase
    root.setAttribute("aria-busy", "true")
    const next = copy[phase]()
    title.textContent = next.title
    title.dataset.text = next.title
    setNote()
    setActions(false)
    const current = order.indexOf(phase)
    const names = startup()
    for (const step of steps) {
      const key = step.dataset.step as "backend" | "project" | "session" | undefined
      if (!key) continue
      const label = step.lastElementChild
      if (label instanceof HTMLElement) label.textContent = names[`${key}_step`]
      const index = order.indexOf(key)
      const state = current === -1 ? "done" : index < current ? "done" : index === current ? "current" : "pending"
      step.dataset.state = state
    }
  }

  const fail = (detail?: string) => {
    if (state.hidden) return
    root.dataset.phase = "failed"
    root.setAttribute("aria-busy", "false")
    title.textContent = t("desktop.startup.failed.title")
    title.dataset.text = t("desktop.startup.failed.title")
    setNote(detail ? `${t("desktop.startup.failed.message")}\n${detail}` : t("desktop.startup.failed.message"))
    setActions(true)
    for (const step of steps) {
      step.dataset.state = step.dataset.step === "backend" ? "failed" : "pending"
    }
  }

  const hide = () => {
    if (state.hidden) return
    state.hidden = true
    window.removeEventListener(startupReadyEvent, onReady)
    window.removeEventListener("opencode:startup-ready", onStartup)
    window.removeEventListener(startupReadyEvent, onStartup)
    app.classList.add("is-ready")
    root.dataset.phase = "ready"
    root.classList.add("is-hidden")
    root.setAttribute("aria-busy", "false")
    window.setTimeout(() => root.remove(), 320)
  }

  show("launch")
  return { show, hide, fail }
}

const reload = async () => {
  if (reloadTask) return reloadTask
  reloadTask = commands
    .reloadSidecar()
    .then(() => undefined)
    .finally(() => {
      reloadTask = undefined
    })
  return reloadTask
}

const syncOpenclaw = async () => {
  return commands.syncOpenclawServer().catch(() => null)
}

const syncHermes = async () => {
  return commands.syncHermesServer().catch(() => null)
}

const syncGenericagent = async () => {
  return commands.syncGenericagentServer().catch(() => null)
}

const deepLinkEvent = "opencode:deep-link"

const navigateToPath = (path: string) => {
  window.history.pushState(null, "", pathRoute(path))
  window.dispatchEvent(new PopStateEvent("popstate"))
}

const listenForOpenPath = async () => {
  await listen<string>("opencode:open-path", (event) => {
    navigateToPath(event.payload)
  })
}

const dragDropEvent = "opencode:drag-drop"

export type DragDropDetail = {
  type: "enter" | "over" | "drop" | "leave"
  paths: string[]
  position: { x: number; y: number }
}

const emitDragDrop = (detail: DragDropDetail) => {
  window.dispatchEvent(new CustomEvent(dragDropEvent, { detail }))
}

const listenForDragDrop = async () => {
  await getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload
    switch (payload.type) {
      case "enter":
        emitDragDrop({ type: "enter", paths: payload.paths, position: payload.position })
        break
      case "over":
        emitDragDrop({ type: "over", paths: [], position: payload.position })
        break
      case "drop":
        emitDragDrop({ type: "drop", paths: payload.paths, position: payload.position })
        break
      case "leave":
        emitDragDrop({ type: "leave", paths: [], position: { x: 0, y: 0 } })
        break
    }
  })
}

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

const createPlatform = (): DesktopPlatform => {
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

    async openInFinder(path: string) {
      await commands.openInFinder(path)
    },

    async openInVscode(path: string) {
      await commands.openInVscode(path)
    },

    async openInEditor(editor: string, path: string) {
      const customPath = await commands.getCustomEditorPath().catch(() => null)
      await commands.openInEditor(editor, path, customPath)
    },

    async getCustomEditorPath() {
      return commands.getCustomEditorPath().catch(() => null)
    },

    async setCustomEditorPath(path: string | null) {
      await commands.setCustomEditorPath(path)
    },

    async getDefaultEditor() {
      return commands.getDefaultEditor().catch(() => null)
    },

    async setDefaultEditor(editor: string | null) {
      await commands.setDefaultEditor(editor)
    },

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
        filters: filePickerFilters(opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS),
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

    async filterDirectories(paths: string[]) {
      return commands.filterDirectories(paths)
    },

    async find(query, dir) {
      return findInPage(query, dir)
    },
    async openPath(path: string, app?: string) {
      await commands.openPath(path, app ?? null)
    },

    async listConfigFiles(directory) {
      return commands.listConfigFiles(directory ?? null)
    },

    async listTrellisTasks(directory: string) {
      const data = await commands.listTrellisTasks(directory)
      return {
        root: data.root,
        current: data.current ?? undefined,
        tasks: data.tasks.map((task) => ({
          id: task.id,
          name: task.name,
          title: task.title,
          status: task.status,
          priority: task.priority ?? undefined,
          assignee: task.assignee ?? undefined,
          package: task.package ?? undefined,
          parent: task.parent ?? undefined,
          children: task.children,
          createdAt: task.createdAt ?? undefined,
          completedAt: task.completedAt ?? undefined,
          path: task.path,
          current: task.current,
        })),
      }
    },

    async listConfigDirectory(path: string) {
      const list = await commands.listConfigDirectory(path)
      return list.map((item) => ({
        path: item.path,
        kind: item.kind === "directory" ? "directory" : "file",
      }))
    },

    async listLocalDirectory(path: string) {
      const list = await commands.listConfigDirectory(path)
      return list.map((item) => ({
        path: item.path,
        kind: item.kind === "directory" ? "directory" : "file",
      }))
    },

    async readConfigFile(path: string) {
      return commands.readConfigFile(path)
    },

    async writeConfigFile(path: string, content: string) {
      await commands.writeConfigFile(path, content)
    },

    async createConfigFile(path: string, content: string) {
      await commands.createConfigFile(path, content)
    },

    async getConfigWorkspace() {
      const data = await commands.getConfigWorkspace()
      return {
        configRoot: data.configRoot ?? undefined,
        agentsRoot: data.agentsRoot ?? undefined,
        skillsRoot: data.skillsRoot ?? undefined,
        pluginsRoot: data.pluginsRoot ?? undefined,
        agentsMdPath: data.agentsMdPath ?? undefined,
        agents: data.agents,
        plugins: data.plugins,
      }
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

    reloadBackend: async () => {
      await reload()
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

    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : typeof input === "string" ? input : input.toString()
      // Loopback requests must stay on the webview fetch path. Sending desktop localhost
      // traffic through plugin-http brought back old startup/session regressions such as
      // "无法列出文件" even though the sidecar itself was healthy.
      if (loopback(url)) {
        return input instanceof Request ? fetch(input) : fetch(input, init)
      }
      return input instanceof Request ? tauriFetch(input) : tauriFetch(input, init)
    },

    getWslEnabled: async () => {
      const next = await commands.getWslConfig().catch(() => null)
      if (next) return next.enabled
      return window.__OPENCODE__!.wsl ?? false
    },

    setWslEnabled: async (enabled) => {
      await commands.setWslConfig({ enabled })
    },

    getOpenclawConfig: async () => {
      const next = await commands.getOpenclawConfig().catch(() => null)
      return {
        enabled: next?.enabled ?? false,
        url: next?.url ?? undefined,
        token: next?.token ?? undefined,
      }
    },

    setOpenclawConfig: async (config) => {
      await commands.setOpenclawConfig({
        enabled: config.enabled,
        url: config.url ?? null,
        token: config.token ?? null,
      })
      await syncOpenclaw()
      setOpenclawTick((x) => x + 1)
    },

    testOpenclawConfig: async (config) => {
      const next = await commands.testOpenclawServer({
        enabled: config.enabled,
        url: config.url ?? null,
        token: config.token ?? null,
      })
      return {
        ok: next.ok,
        logs: next.logs,
      }
    },

    abortOpenclawTest: async () => {
      return commands.abortOpenclawTest()
    },

    getHermesConfig: async () => {
      const next = await commands.getHermesConfig().catch(() => null)
      return {
        enabled: next?.enabled ?? false,
        pythonExecutable: next?.pythonExecutable ?? undefined,
        hermesDir: next?.hermesDir ?? undefined,
        hermesHome: next?.hermesHome ?? undefined,
      }
    },

    setHermesConfig: async (config: HermesConfig) => {
      console.debug("[desktop] set hermes config", {
        enabled: config.enabled,
        python: config.pythonExecutable ?? null,
        dir: config.hermesDir ?? null,
        home: config.hermesHome ?? null,
      })
      await commands.setHermesConfig({
        enabled: config.enabled,
        pythonExecutable: config.pythonExecutable ?? null,
        hermesDir: config.hermesDir ?? null,
        hermesHome: config.hermesHome ?? null,
      })
      await syncHermes()
      setHermesTick((x) => x + 1)
    },

    testHermesConfig: async (config: HermesConfig) => {
      console.debug("[desktop] test hermes config", {
        enabled: config.enabled,
        python: config.pythonExecutable ?? null,
        dir: config.hermesDir ?? null,
        home: config.hermesHome ?? null,
      })
      const next = await commands.testHermesServer({
        enabled: config.enabled,
        pythonExecutable: config.pythonExecutable ?? null,
        hermesDir: config.hermesDir ?? null,
        hermesHome: config.hermesHome ?? null,
      })
      return {
        ok: next.ok,
        logs: next.logs,
      }
    },

    abortHermesTest: async () => {
      console.debug("[desktop] abort hermes test")
      return commands.abortHermesTest()
    },

    getGenericagentConfig: async () => {
      const next = await commands.getGenericagentConfig().catch(() => null)
      return {
        enabled: next?.enabled ?? false,
        pythonExecutable: next?.pythonExecutable ?? undefined,
        genericAgentDir: next?.genericAgentDir ?? undefined,
      }
    },

    setGenericagentConfig: async (config: GenericagentConfig) => {
      await commands.setGenericagentConfig({
        enabled: config.enabled,
        pythonExecutable: config.pythonExecutable ?? null,
        genericAgentDir: config.genericAgentDir ?? null,
      })
      await syncGenericagent()
      setGenericagentTick((x) => x + 1)
    },

    testGenericagentConfig: async (config: GenericagentConfig) => {
      const next = await commands.testGenericagentServer({
        enabled: config.enabled,
        pythonExecutable: config.pythonExecutable ?? null,
        genericAgentDir: config.genericAgentDir ?? null,
      })
      return {
        ok: next.ok,
        logs: next.logs,
      }
    },

    abortGenericagentTest: async () => {
      return commands.abortGenericagentTest()
    },

    getDefaultServer: async () => {
      const url = await commands.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      if (loopback(url)) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: string | null) => {
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
const path = routeInitialPath()
if (path) console.debug("[desktop] initial path routed before mount", { path })
void listenForDeepLinks()
void listenForOpenPath()
void listenForDragDrop()

render(() => {
  const platform = createPlatform()
  const shell = startupShell()
  const channel = new Channel<InitStep>()
  const [init, setInit] = createSignal<InitStep>({ phase: "server_waiting" })
  channel.onmessage = (next) => setInit(next)
  const loadLocale = async () => {
    shell?.show("launch")
    const current = await platform.storage?.("opencode.global.dat").getItem("language")
    const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
    const raw = current ?? legacy
    if (!raw) {
      return
    }
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) {
      return
    }
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  // Fetch sidecar credentials from Rust (available immediately, before health check)
  const [sidecar] = createResource(async () => {
    shell?.show("backend")
    return commands.awaitInitialization(channel as any).then((result) => {
      return result
    })
  })
  const [openclaw] = createResource(openclawTick, syncOpenclaw)
  const [hermes] = createResource(hermesTick, syncHermes)
  const [genericagent] = createResource(genericagentTick, syncGenericagent)

  const [defaultServer] = createResource(async () => {
    shell?.show("project")
    return platform.getDefaultServer?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    })
  })
  const [locale] = createResource(loadLocale)
  const local = ServerConnection.Key.make("sidecar")
  const wantsLocal = () => (defaultServer.latest ?? local) === local

  // Build the sidecar server connection once credentials arrive
  const servers = () => {
    const list = [] as ServerConnection.Any[]
    const data = sidecar()
    if (data) {
      const http = {
        url: data.url,
        username: data.username ?? undefined,
        password: data.password ?? undefined,
      }
      list.push({
        displayName: t("desktop.server.local"),
        type: "sidecar",
        variant: "base",
        http,
      })
    }

	    const claw = openclaw()
	    if (claw) {
	      list.push({
	        displayName: t("desktop.server.openclaw"),
	        integration: "openclaw",
	        type: "http",
	        http: {
	          url: claw.url,
	          username: claw.username ?? undefined,
	          password: claw.password ?? undefined,
	        },
	      } as unknown as ServerConnection.Any)
	    }

	    const hm = hermes()
	    if (hm) {
	      list.push({
	        displayName: t("desktop.server.hermes"),
	        integration: "hermes",
	        type: "http",
	        http: {
	          url: hm.url,
	          username: hm.username ?? undefined,
	          password: hm.password ?? undefined,
	        },
	      } as unknown as ServerConnection.Any)
	    }

	    const ga = genericagent()
	    if (ga) {
	      list.push({
	        displayName: t("desktop.server.genericagent"),
	        integration: "genericagent",
	        type: "http",
	        http: {
	          url: ga.url,
	          username: ga.username ?? undefined,
	          password: ga.password ?? undefined,
	        },
	      } as unknown as ServerConnection.Any)
	    }

    return list
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

    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  const boot = () => !defaultServer.loading && !locale.loading && (!wantsLocal() || !sidecar.loading)

  const detail = () => {
    const next = init()
    if (next.phase !== "failed") return undefined
    return next.detail
  }
  const ready = () => {
    if (!boot()) return false
    if (!wantsLocal()) return true
    if (!sidecar()) return false
    return init().phase === "done"
  }
  const failed = () => boot() && wantsLocal() && init().phase === "failed"
  const skipHealth = () => wantsLocal()

  createEffect(() => {
    if (!shell) return
    if (failed()) {
      shell.fail(detail())
      return
    }
    if (wantsLocal() && !sidecar()) {
      shell.show("backend")
      return
    }
    if (!boot()) {
      shell.show("project")
      return
    }
    shell.show("session")
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show when={ready()}>
          {(_) => {
            return (
              <AppInterface
                defaultServer={defaultServer.latest ?? ServerConnection.Key.make("sidecar")}
                servers={servers()}
                disableHealthCheck={skipHealth}
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
