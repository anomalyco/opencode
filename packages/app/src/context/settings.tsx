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

type ModelKey = {
  providerID: string
  modelID: string
}

type AssistantModel = ModelKey | "disabled" | undefined

export interface Settings {
  general: {
    autoSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    showReasoningSummaries: boolean
    showCustomHookParts: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
  }
  updates: {
    startup: boolean
  }
  appearance: {
    fontSize: number
    font: string
    zoomLevel: number
    contentWidth: number
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  assistant: {
    model: AssistantModel
  }
  notifications: NotificationSettings
  sounds: SoundSettings
}

function migrate(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const next = value as Record<string, unknown>
  const general =
    next.general && typeof next.general === "object" && !Array.isArray(next.general)
      ? (next.general as Record<string, unknown>)
      : undefined
  if (!general) return value
  if (general.showReasoningSummaries === true) return value
  return {
    ...next,
    general: {
      ...general,
      showReasoningSummaries: true,
    },
  }
}

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    showReasoningSummaries: true,
    showCustomHookParts: true,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
  },
  updates: {
    startup: true,
  },
  appearance: {
    fontSize: 14,
    font: "ibm-plex-mono",
    zoomLevel: 1,
    contentWidth: 300, // Default max-w-300 (1200px)
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  assistant: {
    model: "disabled",
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

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoFonts: Record<string, string> = {
  "ibm-plex-mono": `"IBM Plex Mono", "BlexMono Nerd Font Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "cascadia-code": `"Cascadia Code Nerd Font", "Cascadia Code NF", "Cascadia Mono NF", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "fira-code": `"Fira Code Nerd Font", "FiraMono Nerd Font", "FiraMono Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  hack: `"Hack Nerd Font", "Hack Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  inconsolata: `"Inconsolata Nerd Font", "Inconsolata Nerd Font Mono","IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "intel-one-mono": `"Intel One Mono Nerd Font", "IntoneMono Nerd Font", "IntoneMono Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  iosevka: `"Iosevka Nerd Font", "Iosevka Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "jetbrains-mono": `"JetBrains Mono Nerd Font", "JetBrainsMono Nerd Font Mono", "JetBrainsMonoNL Nerd Font", "JetBrainsMonoNL Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "meslo-lgs": `"Meslo LGS Nerd Font", "MesloLGS Nerd Font", "MesloLGM Nerd Font", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "roboto-mono": `"Roboto Mono Nerd Font", "RobotoMono Nerd Font", "RobotoMono Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "source-code-pro": `"Source Code Pro Nerd Font", "SauceCodePro Nerd Font", "SauceCodePro Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "ubuntu-mono": `"Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "UbuntuMono Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
  "geist-mono": `"GeistMono Nerd Font", "GeistMono Nerd Font Mono", "IBM Plex Mono", "IBM Plex Mono Fallback", ${monoFallback}`,
}

export function monoFontFamily(font: string | undefined) {
  return monoFonts[font ?? defaultSettings.appearance.font] ?? monoFonts[defaultSettings.appearance.font]
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

let font: Promise<typeof import("@opencode-ai/ui/font-loader")> | undefined

function loadFont() {
  font ??= import("@opencode-ai/ui/font-loader")
  return font
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      {
        key: "settings.v3",
        migrate,
      },
      createStore<Settings>(defaultSettings),
    )

    createEffect(() => {
      if (typeof document === "undefined") return
      const id = store.appearance?.font ?? defaultSettings.appearance.font
      if (id !== defaultSettings.appearance.font) {
        void loadFont().then((x) => x.ensureMonoFont(id))
      }
      document.documentElement.style.setProperty("--font-family-mono", monoFontFamily(id))
    })

    createEffect(() => {
      if (typeof document === "undefined") return
      const fontSize = store.appearance?.fontSize ?? defaultSettings.appearance.fontSize
      document.documentElement.style.setProperty("--font-size-base", `${fontSize}px`)
    })

    createEffect(() => {
      if (typeof document === "undefined") return
      const width = store.appearance?.contentWidth ?? defaultSettings.appearance.contentWidth
      // Apply 0.8 scaling factor to reduce default width (1200px -> 960px)
      const effectiveWidth = width * 0.8
      // Convert to rem units (width units are in 0.25rem spacing scale)
      document.documentElement.style.setProperty("--session-content-width", `${effectiveWidth * 0.25}rem`)
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
        showCustomHookParts: withFallback(
          () => store.general?.showCustomHookParts,
          defaultSettings.general.showCustomHookParts,
        ),
        setShowCustomHookParts(value: boolean) {
          setStore("general", "showCustomHookParts", value)
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
          setStore("appearance", "font", value)
        },
        zoomLevel: createMemo(() => store.appearance?.zoomLevel ?? defaultSettings.appearance.zoomLevel),
        setZoomLevel(value: number) {
          setStore("appearance", "zoomLevel", value)
        },
        contentWidth: createMemo(() => store.appearance?.contentWidth ?? defaultSettings.appearance.contentWidth),
        setContentWidth(value: number) {
          setStore("appearance", "contentWidth", value)
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
      assistant: {
        model: withFallback(() => store.assistant?.model, defaultSettings.assistant.model),
        setModel(value: AssistantModel) {
          setStore("assistant", "model", value)
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
