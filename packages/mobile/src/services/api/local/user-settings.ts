import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { eq } from "drizzle-orm"
import db from "@/db"
import { userSettings } from "@/db/schema"
import { queryKeys } from "../keys"
import type { UserSettings } from "@/db/types"

// Raw database operations (internal use)
class UserSettingsRepository {
  async getUserSettings() {
    const result = await db.select().from(userSettings).limit(1)
    return result[0] || null
  }

  async setUserSettings(settings: Partial<UserSettings>) {
    const existing = await this.getUserSettings()
    if (existing) {
      return await db
        .update(userSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(userSettings.id, 1))
        .returning()
    } else {
      return await db
        .insert(userSettings)
        .values({
          id: 1,
          ...settings,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as UserSettings)
        .returning()
    }
  }

  async getCurrentMode() {
    const settings = await this.getUserSettings()
    return settings?.currentMode || "build"
  }

  async setCurrentMode(mode: string) {
    return await this.setUserSettings({
      currentMode: mode,
    })
  }

  async switchMode() {
    const currentMode = await this.getCurrentMode()
    const newMode = currentMode === "build" ? "plan" : "build"
    await this.setCurrentMode(newMode)
    return newMode
  }
}

const userSettingsRepo = new UserSettingsRepository()

// Query hooks
export function useUserSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.local.config.userSettings(),
    queryFn: () => userSettingsRepo.getUserSettings(),
  })
}

export function useCurrentModeQuery() {
  return useQuery({
    queryKey: queryKeys.local.config.currentMode(),
    queryFn: () => userSettingsRepo.getCurrentMode(),
  })
}

// Mutations
export function useSetUserSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings: Partial<UserSettings>) => userSettingsRepo.setUserSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.userSettings() })
    },
  })
}

export function useSetCurrentModeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (mode: string) => userSettingsRepo.setCurrentMode(mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.currentMode() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.userSettings() })
    },
  })
}

export function useSwitchModeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => userSettingsRepo.switchMode(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.currentMode() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.userSettings() })
    },
  })
}

// Export the repository for direct access when needed
export const localUserSettingsService = userSettingsRepo
