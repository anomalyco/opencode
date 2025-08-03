import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { eq, desc } from "drizzle-orm"
import db from "../../../db"
import { sessions, messages, messageParts } from "../../../db/schema"
import { queryKeys } from "../keys"
import type { Session } from "../../../db/types"

// Raw database operations (internal use)
class SessionRepository {
  async getSessions() {
    return await db.select().from(sessions).orderBy(desc(sessions.updatedAt))
  }

  async getSession(id: string) {
    const result = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
    return result[0] || null
  }

  async createSession(session: Omit<Session, "createdAt" | "updatedAt">) {
    return await db
      .insert(sessions)
      .values({
        ...session,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
  }

  async upsertSession(session: Omit<Session, "createdAt" | "updatedAt">, preserveRemoteTimestamp = false) {
    const now = new Date()
    const updatedAt = preserveRemoteTimestamp && session.timeUpdated ? session.timeUpdated : now

    return await db
      .insert(sessions)
      .values({
        ...session,
        createdAt: now,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          title: session.title,
          version: session.version,
          shareUrl: session.shareUrl,
          timeCreated: session.timeCreated,
          timeUpdated: session.timeUpdated,
          revertMessageId: session.revertMessageId,
          revertPartId: session.revertPartId,
          revertSnapshot: session.revertSnapshot,
          revertDiff: session.revertDiff,
          isSynced: session.isSynced,
          lastSyncTimestamp: session.lastSyncTimestamp,
          updatedAt,
        },
      })
      .returning()
  }

  async updateSession(id: string, updates: Partial<Session>) {
    return await db
      .update(sessions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sessions.id, id))
      .returning()
  }

  async deleteSession(id: string) {
    // Delete related messages and parts first
    const sessionMessages = await db.select().from(messages).where(eq(messages.sessionId, id))
    for (const message of sessionMessages) {
      await db.delete(messageParts).where(eq(messageParts.messageId, message.id))
    }
    await db.delete(messages).where(eq(messages.sessionId, id))

    // Delete session
    return await db.delete(sessions).where(eq(sessions.id, id))
  }

  async markSessionSynced(id: string, timestamp: Date = new Date()) {
    return await db
      .update(sessions)
      .set({
        isSynced: true,
        lastSyncTimestamp: timestamp,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, id))
  }

  async getUnsyncedSessions() {
    return await db.select().from(sessions).where(eq(sessions.isSynced, false))
  }
}

const sessionRepo = new SessionRepository()

// TanStack Query hooks for local database
export function useLocalSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.local.sessions.lists(),
    queryFn: () => sessionRepo.getSessions(),
  })
}

export function useLocalSessionQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.local.sessions.detail(id),
    queryFn: () => sessionRepo.getSession(id),
    enabled: !!id,
  })
}

export function useUnsyncedSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.local.sessions.unsynced(),
    queryFn: () => sessionRepo.getUnsyncedSessions(),
  })
}

// Mutations for local database
export function useCreateLocalSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (session: Omit<Session, "createdAt" | "updatedAt">) => sessionRepo.createSession(session),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.unsynced() })
    },
  })
}

export function useUpdateLocalSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Session> }) => sessionRepo.updateSession(id, updates),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.detail(id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.unsynced() })
    },
  })
}

export function useDeleteLocalSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => sessionRepo.deleteSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
      queryClient.removeQueries({ queryKey: queryKeys.local.sessions.detail(id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.unsynced() })
    },
  })
}

export function useMarkSessionSyncedMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, timestamp }: { id: string; timestamp?: Date }) => sessionRepo.markSessionSynced(id, timestamp),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.detail(id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.unsynced() })
    },
  })
}

export function useUpsertLocalSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      session,
      preserveRemoteTimestamp = false,
    }: {
      session: Omit<Session, "createdAt" | "updatedAt">
      preserveRemoteTimestamp?: boolean
    }) => sessionRepo.upsertSession(session, preserveRemoteTimestamp),
    onSuccess: (_, { session }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.detail(session.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.unsynced() })
    },
  })
}
