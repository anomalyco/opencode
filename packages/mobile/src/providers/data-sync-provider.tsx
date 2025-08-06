import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRemoteSessionsQuery } from "@/services/api/remote/sessions"
import { useUpsertLocalSessionMutation } from "@/services/api/local/sessions"
import { useRemoteModelsQuery } from "@/services/api/remote/config"
import { useUpsertLocalModelMutation } from "@/services/api/local/models"
import { useActiveProjectQuery } from "@/services/api/local/projects"
import { useSetUserSettingsMutation, useUserSettingsQuery } from "@/services/api/local/user-settings"
import { queryKeys } from "@/services/api/keys"
import type { Session } from "@/db/types"

interface DataSyncContextValue {
  isLoading: boolean
  lastSyncTime: Date | null
  syncSessions: () => Promise<void>
  syncMessages: (sessionId: string) => Promise<void>
  syncModels: () => Promise<void>
}

const DataSyncContext = createContext<DataSyncContextValue | null>(null)

interface DataSyncProviderProps {
  children: ReactNode
}

export const DataSyncProvider = ({ children }: DataSyncProviderProps) => {
  const [isLoading, setIsLoading] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [hasInitialSync, setHasInitialSync] = useState(false)

  const queryClient = useQueryClient()
  const { data: activeProject } = useActiveProjectQuery()
  const { data: remoteSessions, error: remoteError } = useRemoteSessionsQuery()
  const { data: remoteModels } = useRemoteModelsQuery()
  const { data: userSettings } = useUserSettingsQuery()
  const upsertLocalSession = useUpsertLocalSessionMutation()
  const upsertLocalModel = useUpsertLocalModelMutation()
  const setUserSettings = useSetUserSettingsMutation()

  const isConnected = activeProject?.connectionStatus === "connected"

  const transformRemoteSession = (remoteSession: any, projectId: string): Omit<Session, "createdAt" | "updatedAt"> => ({
    id: remoteSession.id,
    projectId,
    parentId: remoteSession.parentId || null,
    title: remoteSession.title,
    version: remoteSession.version,
    shareUrl: remoteSession.share?.url || null,
    timeCreated: new Date(remoteSession.time.created),
    timeUpdated: new Date(remoteSession.time.updated),
    revertMessageId: remoteSession.revert?.messageID || null,
    revertPartId: remoteSession.revert?.partID || null,
    revertSnapshot: remoteSession.revert?.snapshot || null,
    revertDiff: remoteSession.revert?.diff || null,
    // Initialize with 0 - will be calculated from messages
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    totalTokensReasoning: 0,
    totalTokensCacheRead: 0,
    totalTokensCacheWrite: 0,
    messageCount: 0,
    isSynced: true,
    lastSyncTimestamp: new Date(),
    isFavorite: false,
    localNotes: null,
    modelId: null,
  })

  const syncSessions = async () => {
    if (!isConnected || !remoteSessions || !activeProject) return

    setIsLoading(true)
    try {
      // Process all sessions in parallel instead of sequentially
      const upsertPromises = remoteSessions.map(async (remoteSession) => {
        try {
          const localSession = transformRemoteSession(remoteSession, activeProject.id)
          return await upsertLocalSession.mutateAsync({
            session: localSession,
            preserveRemoteTimestamp: true,
          })
        } catch (error) {
          // Log individual session sync failure but don't break the batch
          console.warn(`Failed to sync session ${remoteSession.id}:`, error)
          return null
        }
      })

      const results = await Promise.all(upsertPromises)
      const successCount = results.filter(Boolean).length

      // Only invalidate if we actually synced sessions
      if (successCount > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
        setLastSyncTime(new Date())
      }
    } catch (error) {
      console.error("Session sync failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Only sync once when first connecting
  useEffect(() => {
    if (isConnected && !hasInitialSync && remoteSessions && !remoteError) {
      Promise.all([syncSessions(), syncModels()]).then(() => setHasInitialSync(true))
    }
  }, [isConnected, hasInitialSync, remoteSessions, remoteError])

  // Reset initial sync flag when disconnected
  useEffect(() => {
    if (!isConnected) {
      setHasInitialSync(false)
    }
  }, [isConnected])

  const syncMessages = async (_sessionId: string) => {
    if (!isConnected) return
    // Message sync placeholder
  }

  const syncModels = async () => {
    if (!isConnected || !remoteModels) return

    setIsLoading(true)
    try {
      // Extract providers and default from the response
      const { providers, default: defaultModels } = remoteModels as any

      // Transform providers data to models format
      const modelPromises = providers.flatMap((provider: any) =>
        Object.values(provider.models).map(async (model: any) => {
          try {
            const modelData = {
              id: `${provider.id}:${model.id}`,
              name: model.name,
              providerId: provider.id,
              providerName: provider.name,
              contextLength: model.limit?.context || null,
              outputLength: model.limit?.output || null,
              inputPrice: model.cost?.input || null,
              outputPrice: model.cost?.output || null,
              cacheReadPrice: model.cost?.cache_read || null,
              cacheWritePrice: model.cost?.cache_write || null,
              attachment: model.attachment || false,
              reasoning: model.reasoning || false,
              temperature: model.temperature || false,
              toolCall: model.tool_call || false,
              knowledge: model.knowledge || null,
              releaseDate: model.release_date || null,
              lastUpdated: model.last_updated || null,
              openWeights: model.open_weights || false,
              isCached: true,
              lastSyncTimestamp: new Date(),
            }
            return await upsertLocalModel.mutateAsync(modelData)
          } catch (error) {
            console.warn(`Failed to sync modal ${model.id}:`, error)
            return null
          }
        }),
      )

      const results = await Promise.all(modelPromises)
      const successCount = results.filter(Boolean).length

      if (successCount > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.local.models.lists() })
        setLastSyncTime(new Date())
      }

      // Update user settings with default provider/model if not set
      if (defaultModels && (!userSettings?.defaultProviderId || !userSettings?.defaultModelId)) {
        try {
          const updates: any = {}

          // Set default provider if not already set
          if (!userSettings?.defaultProviderId && defaultModels.provider) {
            updates.defaultProviderId = defaultModels.provider
          }

          // Set default model if not already set
          if (!userSettings?.defaultModelId && defaultModels.model) {
            updates.defaultModelId = defaultModels.model
          }

          // Only update if we have changes
          if (Object.keys(updates).length > 0) {
            await setUserSettings.mutateAsync(updates)
          }
        } catch (error) {
          console.warn("Failed to update user settings with defaults:", error)
        }
      }
    } catch (error) {
      console.error("Model sync failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const value: DataSyncContextValue = {
    isLoading,
    lastSyncTime,
    syncSessions,
    syncMessages,
    syncModels,
  }

  return <DataSyncContext.Provider value={value}>{children}</DataSyncContext.Provider>
}

export const useDataSync = () => {
  const context = useContext(DataSyncContext)
  if (!context) {
    throw new Error("useDataSync must be used within a DataSyncProvider")
  }
  return context
}
