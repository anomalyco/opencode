import { create } from "zustand"
import * as SecureStore from "expo-secure-store"

const SETTINGS_KEY = "opencode_settings"

const DEFAULTS = {
  pageSize: 25,
} as const

interface Settings {
  pageSize: number
}

interface SettingsState extends Settings {
  loaded: boolean
  load: () => Promise<void>
  setPageSize: (size: number) => Promise<void>
}

async function persist(settings: Settings) {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings))
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  load: async () => {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      set({ ...DEFAULTS, ...parsed, loaded: true })
      return
    }
    set({ loaded: true })
  },

  setPageSize: async (size) => {
    const clamped = Math.max(10, Math.min(200, size))
    set({ pageSize: clamped })
    await persist({ pageSize: clamped })
  },
}))
