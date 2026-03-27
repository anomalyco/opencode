import { createStore, reconcile } from "solid-js/store"
import { createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { persisted } from "@/utils/persist"

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
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
  }
  updates: {
    startup: boolean
  }
  appearance: {
    fontSize: number
    font: string
    uiFont: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
}

export const monoDefault = "IBM Plex Mono"
export const sansDefault = "Inter"

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const monoBase = `"${monoDefault}", "IBM Plex Mono Fallback", ${monoFallback}`
const sansBase = `"${sansDefault}", "Inter Fallback", ${sansFallback}`
const monoKey = "ibm-plex-mono"

function input(font: string | undefined, key?: string) {
  if (!font || font === key || !font.trim()) return ""
  return font
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string, key?: string) {
  const value = input(font, key).trim()
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font, monoKey)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase, monoKey)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    showReasoningSummaries: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
  },
  updates: {
    startup: true,
  },
  appearance: {
    fontSize: 14,
    font: "",
    uiFont: "",
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

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  init: () => {
    const [store, setStore, _, ready] = persisted("settings.v3", createStore<Settings>(defaultSettings))

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.font))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.uiFont))
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        releaseNotes: withFallback(() => store.general?.releaseNotes, defaultSettings.general.releaseNotes),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
        },
        followup: withFallback(() => store.general?.followup, defaultSettings.general.followup),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value)
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
      },
      updates: {
        startup: withFallback(() => store.updates?.startup, defaultSettings.updates.startup),
        setStartup(value: boolean) {
          setStore("updates", "startup", value)
        },
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.font, defaultSettings.appearance.font),
        setFont(value: string) {
          setStore("appearance", "font", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.uiFont, defaultSettings.appearance.uiFont),
        setUIFont(value: string) {
          setStore("appearance", "uiFont", value.trim() ? value : "")
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
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
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
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
    }
  },
})
