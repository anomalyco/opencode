import { createStore } from "solid-js/store"
import { createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { persisted } from "@/utils/persist"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface Settings {
  general: {
    autoSave: boolean
  }
  appearance: {
    fontSize: number
    font: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
}

const defaultSettings: Settings = {
  general: {
    autoSave: true,
  },
  appearance: {
    fontSize: 14,
    font: "ibm-plex-mono",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: false,
    permissions: false,
    errors: false,
  },
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  init: () => {
    const [store, setStore, _, ready] = persisted("settings.v1", createStore<Settings>(defaultSettings))

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: createMemo(() => store.general?.autoSave ?? defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
      },
      appearance: {
        fontSize: createMemo(() => store.appearance?.fontSize ?? defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: createMemo(() => store.appearance?.font ?? defaultSettings.appearance.font),
        setFont(value: string) {
          setStore("appearance", "font", value)
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", action, undefined!)
        },
      },
      permissions: {
        autoApprove: createMemo(() => store.permissions?.autoApprove ?? defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      notifications: {
        agent: createMemo(() => store.notifications?.agent ?? defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: createMemo(() => store.notifications?.permissions ?? defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: createMemo(() => store.notifications?.errors ?? defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
    }
  },
})
