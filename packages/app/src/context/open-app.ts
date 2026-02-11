import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { usePlatform } from "./platform"
import { useServer } from "./server"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "./language"

const OPEN_APPS = [
  "vscode",
  "cursor",
  "zed",
  "textmate",
  "antigravity",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "xcode",
  "android-studio",
  "powershell",
  "sublime-text",
] as const

export type OpenApp = (typeof OPEN_APPS)[number]

const MAC_APPS = [
  { id: "vscode", label: "VS Code", icon: "vscode", openWith: "Visual Studio Code" },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "Cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "Zed" },
  { id: "textmate", label: "TextMate", icon: "textmate", openWith: "TextMate" },
  { id: "antigravity", label: "Antigravity", icon: "antigravity", openWith: "Antigravity" },
  { id: "terminal", label: "Terminal", icon: "terminal", openWith: "Terminal" },
  { id: "iterm2", label: "iTerm2", icon: "iterm2", openWith: "iTerm" },
  { id: "ghostty", label: "Ghostty", icon: "ghostty", openWith: "Ghostty" },
  { id: "xcode", label: "Xcode", icon: "xcode", openWith: "Xcode" },
  { id: "android-studio", label: "Android Studio", icon: "android-studio", openWith: "Android Studio" },
  { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
] as const

const WINDOWS_APPS = [
  { id: "vscode", label: "VS Code", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "zed" },
  { id: "powershell", label: "PowerShell", icon: "powershell", openWith: "powershell" },
  { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
] as const

const LINUX_APPS = [
  { id: "vscode", label: "VS Code", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "zed" },
  { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
] as const

export const { use: useOpenApp, provider: OpenAppProvider } = createSimpleContext({
  name: "OpenApp",
  init: () => {
    const platform = usePlatform()
    const server = useServer()
    const language = useLanguage()

    const os = createMemo<"macos" | "windows" | "linux" | "unknown">(() => {
      if (platform.platform === "desktop" && platform.os) return platform.os
      if (typeof navigator !== "object") return "unknown"
      const value = navigator.platform || navigator.userAgent
      if (/Mac/i.test(value)) return "macos"
      if (/Win/i.test(value)) return "windows"
      if (/Linux/i.test(value)) return "linux"
      return "unknown"
    })

    const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({ finder: true })

    const apps = createMemo(() => {
      if (os() === "macos") return MAC_APPS
      if (os() === "windows") return WINDOWS_APPS
      return LINUX_APPS
    })

    const fileManager = createMemo(() => {
      if (os() === "macos") return { label: "Finder", icon: "finder" as const }
      if (os() === "windows") return { label: "File Explorer", icon: "file-explorer" as const }
      return { label: "File Manager", icon: "finder" as const }
    })

    createEffect(() => {
      if (platform.platform !== "desktop") return
      if (!platform.checkAppExists) return

      const list = apps()
      setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

      void Promise.all(
        list.map((app) =>
          Promise.resolve(platform.checkAppExists?.(app.openWith))
            .then((value) => Boolean(value))
            .catch(() => false)
            .then((ok) => [app.id, ok] as const),
        ),
      ).then((entries) => {
        setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
      })
    })

    const options = createMemo(() => {
      return [
        { id: "finder" as const, label: fileManager().label, icon: fileManager().icon },
        ...apps().filter((app) => exists[app.id]),
      ]
    })

    const checksReady = createMemo(() => {
      if (platform.platform !== "desktop") return true
      if (!platform.checkAppExists) return true
      return apps().every((app) => exists[app.id] !== undefined)
    })

    const [prefs, setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))

    const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
    const current = createMemo(() => options().find((o) => o.id === prefs.app) ?? options()[0])

    createEffect(() => {
      if (platform.platform !== "desktop") return
      if (!checksReady()) return
      const value = prefs.app
      if (options().some((o) => o.id === value)) return
      setPrefs("app", options()[0]?.id ?? "finder")
    })

    const open = (target: string, app?: OpenApp) => {
      if (!canOpen()) return

      const item = options().find((o) => o.id === (app ?? prefs.app))
      const openWith = item && "openWith" in item ? item.openWith : undefined
      Promise.resolve(platform.openPath?.(target, openWith)).catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
    }

    const openFile = (file: string, directory: string) => {
      const absolute = file.startsWith("/") ? file : `${directory}/${file}`
      open(absolute)
    }

    return {
      OPEN_APPS,
      apps,
      os,
      exists,
      setExists,
      options,
      checksReady,
      prefs,
      setPrefs,
      canOpen,
      current,
      fileManager,
      open,
      openFile,
    }
  },
})
