import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { eq } from "drizzle-orm"
import db from "../../../db"
import { appConfig, userSettings } from "../../../db/schema"
import { queryKeys } from "../keys"
import type { AppConfig, UserSettings } from "../../../db/types"

// Raw database operations (internal use)
class ConfigRepository {
  async getAppConfig() {
    const result = await db.select().from(appConfig).limit(1)
    return result[0] || null
  }

  async setAppConfig(config: Partial<AppConfig>) {
    const existing = await this.getAppConfig()
    if (existing) {
      return await db
        .update(appConfig)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(appConfig.id, 1))
        .returning()
    } else {
      return await db
        .insert(appConfig)
        .values({
          id: 1,
          ...config,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as AppConfig)
        .returning()
    }
  }

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

  async getServerUrl() {
    const config = await this.getAppConfig()
    if (!config) return null
    return `http://${config.serverHostname}:${config.serverPort}`
  }

  async setServerConnection(hostname: string, port: number) {
    return await this.setAppConfig({
      serverHostname: hostname,
      serverPort: port,
      serverUrl: `http://${hostname}:${port}`,
    })
  }

  async updateConnectionStatus(status: "connected" | "disconnected" | "connecting") {
    return await this.setAppConfig({
      connectionStatus: status,
      lastSyncTimestamp: new Date(),
    })
  }
}

const configRepo = new ConfigRepository()

// TanStack Query hooks for local config
export function useLocalAppConfigQuery() {
  return useQuery({
    queryKey: queryKeys.local.config.appConfig(),
    queryFn: () => configRepo.getAppConfig(),
  })
}

export function useLocalUserSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.local.config.userSettings(),
    queryFn: () => configRepo.getUserSettings(),
  })
}

export function useLocalServerUrlQuery() {
  return useQuery({
    queryKey: queryKeys.local.config.serverUrl(),
    queryFn: () => configRepo.getServerUrl(),
  })
}

// Mutations for local config
export function useSetLocalAppConfigMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (config: Partial<AppConfig>) => configRepo.setAppConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.appConfig() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.serverUrl() })
    },
  })
}

export function useSetLocalUserSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings: Partial<UserSettings>) => configRepo.setUserSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.userSettings() })
    },
  })
}

export function useSetServerConnectionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ hostname, port }: { hostname: string; port: number }) =>
      configRepo.setServerConnection(hostname, port),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.appConfig() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.serverUrl() })
    },
  })
}

export function useUpdateConnectionStatusMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (status: "connected" | "disconnected" | "connecting") => configRepo.updateConnectionStatus(status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.appConfig() })
    },
  })
}

// Export the repository for direct access when needed (e.g., in streaming service)
export const localConfigService = configRepo
