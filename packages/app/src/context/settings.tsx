import { createStore, reconcile } from "solid-js/store"
import { createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { persisted } from "@/utils/persist"
import { usePlatform } from "./platform"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
}

export interface Settings {
  general: {
    autoSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    showFileTree: boolean
    showNavigation: boolean
    showSearch: boolean
    showStatus: boolean
    showTerminal: boolean
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    showSessionProgressBar: boolean
    showCustomAgents: boolean
    newLayoutDesigns?: boolean
  }
  appearance: {
    fontSize: number
    mono: string
    sans: string
    terminal: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
}

export const monoDefault = "System Mono"
export const sansDefault = "System Sans"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"
export const newLayoutDesignsDefault = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = sansFallback
const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    showFileTree: false,
    showNavigation: false,
    showSearch: false,
    showStatus: false,
    showTerminal: false,
    showReasoningSummaries: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    showSessionProgressBar: true,
    showCustomAgents: false,
  },
  appearance: {
    fontSize: 14,
    mono: "",
    sans: "",
    terminal: "",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

function desktopFallback<T>(read: () => T | undefined, config: () => T | undefined, fallback: T) {
  return createMemo(() => config() ?? read() ?? fallback)
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const desktopConfig = () => (platform.platform === "desktop" ? platform.desktopConfig?.() : undefined)
    const [store, setStore, _, ready] = persisted("settings.v3", createStore<Settings>(defaultSettings))
    const showFileTree = desktopFallback(
      () => store.general?.showFileTree,
      () => desktopConfig()?.general?.showFileTree,
      defaultSettings.general.showFileTree,
    )
    const showSearch = desktopFallback(
      () => store.general?.showSearch,
      () => desktopConfig()?.general?.showSearch,
      defaultSettings.general.showSearch,
    )
    const showStatus = desktopFallback(
      () => store.general?.showStatus,
      () => desktopConfig()?.general?.showStatus,
      defaultSettings.general.showStatus,
    )
    const showCustomAgents = desktopFallback(
      () => store.general?.showCustomAgents,
      () => desktopConfig()?.general?.showCustomAgents,
      defaultSettings.general.showCustomAgents,
    )
    const newLayoutDesigns = desktopFallback(
      () => store.general?.newLayoutDesigns,
      () => desktopConfig()?.general?.newLayoutDesigns,
      newLayoutDesignsDefault,
    )
    const visible = (preference: () => boolean) => createMemo(() => !newLayoutDesigns() || preference())

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    createEffect(() => {
      if (store.general?.followup !== "queue") return
      setStore("general", "followup", "steer")
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: desktopFallback(
          () => store.general?.autoSave,
          () => desktopConfig()?.general?.autoSave,
          defaultSettings.general.autoSave,
        ),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        releaseNotes: desktopFallback(
          () => store.general?.releaseNotes,
          () => desktopConfig()?.general?.releaseNotes,
          defaultSettings.general.releaseNotes,
        ),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
        },
        followup: desktopFallback(
          () => (store.general?.followup === "queue" ? "steer" : store.general?.followup),
          () =>
            desktopConfig()?.general?.followup === "queue" ? "steer" : desktopConfig()?.general?.followup,
          defaultSettings.general.followup,
        ),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value === "queue" ? "steer" : value)
        },
        showFileTree,
        setShowFileTree(value: boolean) {
          setStore("general", "showFileTree", value)
        },
        showNavigation: desktopFallback(
          () => store.general?.showNavigation,
          () => desktopConfig()?.general?.showNavigation,
          defaultSettings.general.showNavigation,
        ),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
        },
        showSearch,
        setShowSearch(value: boolean) {
          setStore("general", "showSearch", value)
        },
        showStatus,
        setShowStatus(value: boolean) {
          setStore("general", "showStatus", value)
        },
        showTerminal: desktopFallback(
          () => store.general?.showTerminal,
          () => desktopConfig()?.general?.showTerminal,
          defaultSettings.general.showTerminal,
        ),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
        },
        showReasoningSummaries: desktopFallback(
          () => store.general?.showReasoningSummaries,
          () => desktopConfig()?.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        shellToolPartsExpanded: desktopFallback(
          () => store.general?.shellToolPartsExpanded,
          () => desktopConfig()?.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: desktopFallback(
          () => store.general?.editToolPartsExpanded,
          () => desktopConfig()?.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        showSessionProgressBar: desktopFallback(
          () => store.general?.showSessionProgressBar,
          () => desktopConfig()?.general?.showSessionProgressBar,
          defaultSettings.general.showSessionProgressBar,
        ),
        setShowSessionProgressBar(value: boolean) {
          setStore("general", "showSessionProgressBar", value)
        },
        showCustomAgents,
        setShowCustomAgents(value: boolean) {
          setStore("general", "showCustomAgents", value)
        },
        newLayoutDesigns,
        setNewLayoutDesigns(value: boolean) {
          setStore("general", "newLayoutDesigns", value)
        },
      },
      visibility: {
        fileTree: visible(showFileTree),
        search: visible(showSearch),
        status: visible(showStatus),
        customAgents: visible(showCustomAgents),
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApprove: desktopFallback(
          () => store.permissions?.autoApprove,
          () => desktopConfig()?.permissions?.autoApprove,
          defaultSettings.permissions.autoApprove,
        ),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
      sounds: {
        agentEnabled: desktopFallback(
          () => store.sounds?.agentEnabled,
          () => desktopConfig()?.sounds?.agentEnabled,
          defaultSettings.sounds.agentEnabled,
        ),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: desktopFallback(
          () => store.sounds?.agent,
          () => desktopConfig()?.sounds?.agent,
          defaultSettings.sounds.agent,
        ),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: desktopFallback(
          () => store.sounds?.permissionsEnabled,
          () => desktopConfig()?.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: desktopFallback(
          () => store.sounds?.permissions,
          () => desktopConfig()?.sounds?.permissions,
          defaultSettings.sounds.permissions,
        ),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: desktopFallback(
          () => store.sounds?.errorsEnabled,
          () => desktopConfig()?.sounds?.errorsEnabled,
          defaultSettings.sounds.errorsEnabled,
        ),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: desktopFallback(
          () => store.sounds?.errors,
          () => desktopConfig()?.sounds?.errors,
          defaultSettings.sounds.errors,
        ),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
    }
  },
})
