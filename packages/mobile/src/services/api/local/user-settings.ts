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

  async getCurrentAgent() {
    const settings = await this.getUserSettings()
    return settings?.currentAgent || "build"
  }

  async setCurrentAgent(agent: string) {
    return await this.setUserSettings({
      currentAgent: agent,
    })
  }

  async cycleAgent(forward: boolean = true, availableAgents?: string[]) {
    // Use provided agents or fallback to default
    const agents = availableAgents || ["general", "build", "plan", "example-driven-docs-writer"]
    const currentAgent = await this.getCurrentAgent()
    let currentIndex = agents.indexOf(currentAgent)

    // If current agent is not found in the array, start from the beginning
    if (currentIndex === -1) {
      currentIndex = 0
    }

    let newIndex
    if (forward) {
      newIndex = currentIndex + 1 >= agents.length ? 0 : currentIndex + 1
    } else {
      newIndex = currentIndex - 1 < 0 ? agents.length - 1 : currentIndex - 1
    }

    const newAgent = agents[newIndex]
    await this.setCurrentAgent(newAgent)
    return newAgent
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

export function useCurrentAgentQuery() {
  return useQuery({
    queryKey: queryKeys.local.config.currentAgent(),
    queryFn: () => userSettingsRepo.getCurrentAgent(),
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

export function useSetCurrentAgentMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (agent: string) => userSettingsRepo.setCurrentAgent(agent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.currentAgent() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.userSettings() })
    },
  })
}

export function useSwitchAgentMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ forward = true, availableAgents }: { forward?: boolean; availableAgents?: string[] }) =>
      userSettingsRepo.cycleAgent(forward, availableAgents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.currentAgent() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.config.userSettings() })
    },
  })
}
// Export the repository for direct access when needed
export const localUserSettingsService = userSettingsRepo
