import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRemoteSessionsQuery } from "@/services/api/remote/sessions"
import { useUpsertLocalSessionMutation } from "@/services/api/local/sessions"
import { useLocalAppConfigQuery } from "@/services/api/local/config"
import { queryKeys } from "@/services/api/keys"
import type { Session } from "@/db/types"

interface DataSyncContextValue {
  isLoading: boolean
  lastSyncTime: Date | null
  syncSessions: () => Promise<void>
}

const DataSyncContext = createContext<DataSyncContextValue | null>(null)

interface DataSyncProviderProps {
  children: ReactNode
}

export const DataSyncProvider = ({ children }: DataSyncProviderProps) => {
  const [isLoading, setIsLoading] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)

  const queryClient = useQueryClient()
  const { data: appConfig } = useLocalAppConfigQuery()
  const { data: remoteSessions, error: remoteError } = useRemoteSessionsQuery()
  const upsertLocalSession = useUpsertLocalSessionMutation()

  const isConnected = appConfig?.connectionStatus === "connected"

  const syncSessions = async () => {
    console.log("🔄 DataSync: syncSessions called", { isConnected, remoteSessions: remoteSessions?.length })
    if (!isConnected || !remoteSessions) return

    setIsLoading(true)
    console.log("📥 DataSync: Starting sync of", remoteSessions.length, "sessions")
    try {
      for (const remoteSession of remoteSessions) {
        console.log("📋 DataSync: Remote session data", JSON.stringify(remoteSession, null, 2))
        const localSession: Omit<Session, "createdAt" | "updatedAt"> = {
          id: remoteSession.id,
          parentId: remoteSession.parentId || null,
          title: remoteSession.title,
          version: remoteSession.version,
          shareUrl: remoteSession.shareUrl || null,
          timeCreated: new Date(remoteSession.time.created),
          timeUpdated: new Date(remoteSession.time.updated),
          revertMessageId: remoteSession.revertMessageId || null,
          revertPartId: remoteSession.revertPartId || null,
          revertSnapshot: remoteSession.revertSnapshot || null,
          revertDiff: remoteSession.revertDiff || null,
          isSynced: true,
          lastSyncTimestamp: new Date(),
          isFavorite: false,
          localNotes: null,
        }

        console.log("💾 DataSync: Upserting session", remoteSession.id)
        const result = await upsertLocalSession.mutateAsync(localSession)
        console.log("✅ DataSync: Upserted session", remoteSession.id, remoteSession.title, result)
      }

      // Invalidate local queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
      setLastSyncTime(new Date())
      console.log("✅ DataSync: Sync completed successfully, invalidated queries")
    } catch (error) {
      console.error("❌ DataSync: Session sync failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-sync when connected and remote sessions are available
  useEffect(() => {
    console.log("🔍 DataSync: useEffect triggered", {
      isConnected,
      remoteSessions: remoteSessions?.length,
      remoteError: !!remoteError,
    })
    if (isConnected && remoteSessions && !remoteError && !isLoading) {
      console.log("🚀 DataSync: Triggering auto-sync")
      syncSessions()
    }
  }, [isConnected, remoteSessions, remoteError])

  const value: DataSyncContextValue = {
    isLoading,
    lastSyncTime,
    syncSessions,
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
