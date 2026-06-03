import { createStore, reconcile } from "solid-js/store"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { removePersisted } from "@/utils/persist"
import { usePlatform } from "./platform"
import { useServerSDK } from "./server-sdk"

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
  updates: {
    startup: boolean
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
export const newLayoutDesignsDefault = true

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
  updates: {
    startup: true,
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

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  init: () => {
    const serverSDK = useServerSDK()
    const platform = usePlatform()
    const queryClient = useQueryClient()
    const [store, setStore] = createStore<Settings>(defaultSettings)
    const queryKey = () => ["ui", "settings", serverSDK.url] as const

    const query = useQuery(() => ({
      queryKey: queryKey(),
      queryFn: () => serverSDK.client.ui.settings.get().then((x) => x.data?.settings ?? defaultSettings),
    }))

    const applyServerSettings = (settings: Settings | undefined) => {
      if (!settings) return
      queryClient.setQueryData<Settings>(queryKey(), settings)
      setStore(reconcile(settings))
    }

    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: queryKey() })
    }

    const appSettings = () => ({
      general: {
        ...store.general,
        followup: store.general.followup === "queue" ? "steer" : store.general.followup,
        newLayoutDesigns: store.general.newLayoutDesigns ?? newLayoutDesignsDefault,
      },
      updates: { ...store.updates },
      appearance: { ...store.appearance },
      permissions: { ...store.permissions },
      notifications: { ...store.notifications },
      sounds: { ...store.sounds },
    })

    const appMutation = useMutation(() => ({
      mutationFn: () => serverSDK.client.ui.settings.app.update({ uiSettingsAppSettings: appSettings() }),
      onSuccess: (result) => applyServerSettings(result.data?.settings),
      onError: refetch,
    }))

    const keybindMutation = useMutation(() => ({
      mutationFn: () =>
        serverSDK.client.ui.settings.keybinds.replace({ uiSettingsKeybindsInput: { keybinds: { ...store.keybinds } } }),
      onSuccess: (result) => applyServerSettings(result.data?.settings),
      onError: refetch,
    }))

    const saveApp = () => appMutation.mutate()
    const saveKeybinds = () => keybindMutation.mutate()

    let cleanedLegacy = false
    createEffect(() => {
      applyServerSettings(query.data)
      if (!query.data || cleanedLegacy) return
      cleanedLegacy = true
      removePersisted({ key: "settings.v3" }, platform)
    })

    const unsub = serverSDK.event.on("global", (event) => {
      if (event.type !== "ui.settings.updated") return
      if (event.properties.profileID !== "default") return
      refetch()
    })
    onCleanup(unsub)

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    createEffect(() => {
      if (store.general?.followup !== "queue") return
      setStore("general", "followup", "steer")
      saveApp()
    })

    const ready = createMemo(() => !query.isLoading)

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
          saveApp()
        },
        releaseNotes: withFallback(() => store.general?.releaseNotes, defaultSettings.general.releaseNotes),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
          saveApp()
        },
        followup: withFallback(
          () => (store.general?.followup === "queue" ? "steer" : store.general?.followup),
          defaultSettings.general.followup,
        ),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value === "queue" ? "steer" : value)
          saveApp()
        },
        showFileTree: withFallback(() => store.general?.showFileTree, defaultSettings.general.showFileTree),
        setShowFileTree(value: boolean) {
          setStore("general", "showFileTree", value)
          saveApp()
        },
        showNavigation: withFallback(() => store.general?.showNavigation, defaultSettings.general.showNavigation),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
          saveApp()
        },
        showSearch: withFallback(() => store.general?.showSearch, defaultSettings.general.showSearch),
        setShowSearch(value: boolean) {
          setStore("general", "showSearch", value)
          saveApp()
        },
        showStatus: withFallback(() => store.general?.showStatus, defaultSettings.general.showStatus),
        setShowStatus(value: boolean) {
          setStore("general", "showStatus", value)
          saveApp()
        },
        showTerminal: withFallback(() => store.general?.showTerminal, defaultSettings.general.showTerminal),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
          saveApp()
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
          saveApp()
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
          saveApp()
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
          saveApp()
        },
        showSessionProgressBar: withFallback(
          () => store.general?.showSessionProgressBar,
          defaultSettings.general.showSessionProgressBar,
        ),
        setShowSessionProgressBar(value: boolean) {
          setStore("general", "showSessionProgressBar", value)
          saveApp()
        },
        showCustomAgents: withFallback(() => store.general?.showCustomAgents, defaultSettings.general.showCustomAgents),
        setShowCustomAgents(value: boolean) {
          setStore("general", "showCustomAgents", value)
          saveApp()
        },
        newLayoutDesigns: withFallback(() => store.general?.newLayoutDesigns, newLayoutDesignsDefault),
        setNewLayoutDesigns(value: boolean) {
          setStore("general", "newLayoutDesigns", value)
          saveApp()
        },
      },
      updates: {
        startup: withFallback(() => store.updates?.startup, defaultSettings.updates.startup),
        setStartup(value: boolean) {
          setStore("updates", "startup", value)
          saveApp()
        },
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
          saveApp()
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
          saveApp()
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
          saveApp()
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
          saveApp()
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
          saveKeybinds()
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
          saveKeybinds()
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
          saveKeybinds()
        },
      },
      permissions: {
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
          saveApp()
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
          saveApp()
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
          saveApp()
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
          saveApp()
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
          saveApp()
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
          saveApp()
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
          saveApp()
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
          saveApp()
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
          saveApp()
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
          saveApp()
        },
      },
    }
  },
})
