import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { eq, desc, count, isNull, and } from "drizzle-orm"
import db from "@/db"
import { sessions, messages, messageParts, projects } from "@/db/schema"
import { queryKeys } from "../keys"
import type { Session } from "@/db/types"

// Raw database operations (internal use)
class SessionRepository {
  async getActiveProjectId() {
    const result = await db.select({ id: projects.id }).from(projects).where(eq(projects.isActive, true)).limit(1)
    return result[0]?.id || null
  }

  async getSessions(limit = 20, offset = 0, projectId?: string) {
    const activeProjectId = projectId || (await this.getActiveProjectId())
    if (!activeProjectId) return []

    return await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.projectId, activeProjectId),
          isNull(sessions.parentId), // Only get root sessions (parentId is null)
        ),
      )
      .orderBy(desc(sessions.timeUpdated))
      .limit(limit)
      .offset(offset)
  }

  async getSessionsCount(projectId?: string) {
    const activeProjectId = projectId || (await this.getActiveProjectId())
    if (!activeProjectId) return 0

    const result = await db.select({ count: count() }).from(sessions).where(eq(sessions.projectId, activeProjectId))
    return result[0]?.count || 0
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
          totalCost: session.totalCost,
          totalTokensInput: session.totalTokensInput,
          totalTokensOutput: session.totalTokensOutput,
          totalTokensReasoning: session.totalTokensReasoning,
          totalTokensCacheRead: session.totalTokensCacheRead,
          totalTokensCacheWrite: session.totalTokensCacheWrite,
          messageCount: session.messageCount,
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

  async updateSessionModel(id: string, modelId: string) {
    return await db
      .update(sessions)
      .set({
        modelId,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, id))
  }

  async getUnsyncedSessions() {
    return await db.select().from(sessions).where(eq(sessions.isSynced, false))
  }

  async recalculateAllSessionAggregates() {
    const allSessions = await db.select().from(sessions)

    for (const session of allSessions) {
      // Get all messages for this session
      const sessionMessages = await db.select().from(messages).where(eq(messages.sessionId, session.id))

      // Calculate aggregates
      const aggregates = sessionMessages.reduce(
        (acc, message) => ({
          totalCost: acc.totalCost + (message.cost || 0),
          totalTokensInput: acc.totalTokensInput + (message.tokensInput || 0),
          totalTokensOutput: acc.totalTokensOutput + (message.tokensOutput || 0),
          totalTokensReasoning: acc.totalTokensReasoning + (message.tokensReasoning || 0),
          totalTokensCacheRead: acc.totalTokensCacheRead + (message.tokensCacheRead || 0),
          totalTokensCacheWrite: acc.totalTokensCacheWrite + (message.tokensCacheWrite || 0),
          messageCount: acc.messageCount + 1,
        }),
        {
          totalCost: 0,
          totalTokensInput: 0,
          totalTokensOutput: 0,
          totalTokensReasoning: 0,
          totalTokensCacheRead: 0,
          totalTokensCacheWrite: 0,
          messageCount: 0,
        },
      )

      // Update session with aggregated values
      await db
        .update(sessions)
        .set({
          ...aggregates,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, session.id))
    }
  }
}

const sessionRepo = new SessionRepository()

// TanStack Query hooks for local database
export function useLocalSessionsQuery(limit = 20, offset = 0) {
  return useQuery({
    queryKey: queryKeys.local.sessions.lists(limit, offset),
    queryFn: () => sessionRepo.getSessions(limit, offset),
  })
}

export function useLocalSessionsCountQuery() {
  return useQuery({
    queryKey: queryKeys.local.sessions.count(),
    queryFn: () => sessionRepo.getSessionsCount(),
  })
}

export function useInfiniteLocalSessionsQuery(pageSize = 20) {
  return useInfiniteQuery({
    queryKey: queryKeys.local.sessions.lists(pageSize, 0),
    queryFn: ({ pageParam = 0 }) => sessionRepo.getSessions(pageSize, pageParam * pageSize),
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === pageSize ? allPages.length : undefined
    },
    initialPageParam: 0,
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

export function useUpdateSessionModelMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, modelId }: { id: string; modelId: string }) => sessionRepo.updateSessionModel(id, modelId),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.detail(id) })
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

export function useRecalculateSessionAggregatesMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => sessionRepo.recalculateAllSessionAggregates(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
    },
  })
}
