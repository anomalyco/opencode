import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { eq, asc } from "drizzle-orm"
import db from "../../../db"
import { messages, messageParts } from "../../../db/schema"
import { queryKeys } from "../keys"
import type { Message, MessagePart } from "../../../db/types"

// Raw database operations (internal use)
class MessageRepository {
  async getMessages(sessionId: string) {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt))
    return result
  }

  async getMessage(id: string) {
    const result = await db.select().from(messages).where(eq(messages.id, id)).limit(1)
    return result[0] || null
  }

  async createMessage(message: Omit<Message, "createdAt" | "updatedAt">) {
    return await db
      .insert(messages)
      .values({
        ...message,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
  }

  async updateMessage(id: string, updates: Partial<Message>) {
    return await db
      .update(messages)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(messages.id, id))
      .returning()
  }

  async deleteMessage(id: string) {
    // Delete related parts first
    await db.delete(messageParts).where(eq(messageParts.messageId, id))
    return await db.delete(messages).where(eq(messages.id, id))
  }

  async getMessageParts(messageId: string) {
    return await db
      .select()
      .from(messageParts)
      .where(eq(messageParts.messageId, messageId))
      .orderBy(asc(messageParts.createdAt))
  }

  async createMessagePart(part: Omit<MessagePart, "createdAt" | "updatedAt">) {
    return await db
      .insert(messageParts)
      .values({
        ...part,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
  }

  async updateMessagePart(id: string, updates: Partial<MessagePart>) {
    return await db
      .update(messageParts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(messageParts.id, id))
      .returning()
  }

  async deleteMessagePart(id: string) {
    return await db.delete(messageParts).where(eq(messageParts.id, id))
  }

  async upsertMessagePart(part: Omit<MessagePart, "createdAt" | "updatedAt">) {
    return await db
      .insert(messageParts)
      .values({
        ...part,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: messageParts.id,
        set: {
          sessionId: part.sessionId,
          messageId: part.messageId,
          type: part.type,
          textContent: part.textContent,
          isSynthetic: part.isSynthetic,
          timeStart: part.timeStart,
          timeEnd: part.timeEnd,
          isSynced: part.isSynced,
          lastSyncTimestamp: part.lastSyncTimestamp,
          fileMime: part.fileMime,
          fileFilename: part.fileFilename,
          fileUrl: part.fileUrl,
          fileSourceType: part.fileSourceType,
          fileSourcePath: part.fileSourcePath,
          fileSourceTextValue: part.fileSourceTextValue,
          fileSourceTextStart: part.fileSourceTextStart,
          fileSourceTextEnd: part.fileSourceTextEnd,
          fileSourceName: part.fileSourceName,
          fileSourceKind: part.fileSourceKind,
          fileSourceRange: part.fileSourceRange,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          toolStatus: part.toolStatus,
          toolInput: part.toolInput,
          toolOutput: part.toolOutput,
          toolTitle: part.toolTitle,
          toolMetadata: part.toolMetadata,
          toolError: part.toolError,
          toolTimeStart: part.toolTimeStart,
          toolTimeEnd: part.toolTimeEnd,
          stepCost: part.stepCost,
          stepTokensInput: part.stepTokensInput,
          stepTokensOutput: part.stepTokensOutput,
          stepTokensReasoning: part.stepTokensReasoning,
          stepTokensCacheRead: part.stepTokensCacheRead,
          stepTokensCacheWrite: part.stepTokensCacheWrite,
          snapshotId: part.snapshotId,
          patchHash: part.patchHash,
          patchFiles: part.patchFiles,
          updatedAt: new Date(),
        },
      })
      .returning()
  }

  async upsertMessage(message: Omit<Message, "createdAt" | "updatedAt">) {
    return await db
      .insert(messages)
      .values({
        ...message,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: messages.id,
        set: {
          role: message.role,
          timeCreated: message.timeCreated,
          timeCompleted: message.timeCompleted,
          providerId: message.providerId,
          modelId: message.modelId,
          mode: message.mode,
          isSynced: message.isSynced,
          lastSyncTimestamp: message.lastSyncTimestamp,
          updatedAt: new Date(),
        },
      })
      .returning()
  }
}

const messageRepo = new MessageRepository()

// TanStack Query hooks for local database
export function useLocalMessagesQuery(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.local.messages.list(sessionId),
    queryFn: () => messageRepo.getMessages(sessionId),
    enabled: !!sessionId,
  })
}

export function useLocalMessageQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.local.messages.detail(id),
    queryFn: () => messageRepo.getMessage(id),
    enabled: !!id,
  })
}

export function useLocalMessagePartsQuery(messageId: string) {
  return useQuery({
    queryKey: queryKeys.local.messages.parts(messageId),
    queryFn: () => messageRepo.getMessageParts(messageId),
    enabled: !!messageId,
  })
}

// Mutations for local database
export function useCreateLocalMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (message: Omit<Message, "createdAt" | "updatedAt">) => messageRepo.createMessage(message),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.list(variables.sessionId) })
    },
  })
}

export function useUpdateLocalMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Message> }) => messageRepo.updateMessage(id, updates),
    onSuccess: (data, { id }) => {
      const message = data[0]
      if (message) {
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.list(message.sessionId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.detail(id) })
      }
    },
  })
}

export function useDeleteLocalMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => messageRepo.deleteMessage(id),
    onMutate: async (id) => {
      // Get the message to know which session to invalidate
      const message = await messageRepo.getMessage(id)
      return { sessionId: message?.sessionId }
    },
    onSuccess: (_, id, context) => {
      if (context?.sessionId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.list(context.sessionId) })
      }
      queryClient.removeQueries({ queryKey: queryKeys.local.messages.detail(id) })
      queryClient.removeQueries({ queryKey: queryKeys.local.messages.parts(id) })
    },
  })
}

export function useCreateLocalMessagePartMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (part: Omit<MessagePart, "createdAt" | "updatedAt">) => messageRepo.createMessagePart(part),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.parts(variables.messageId) })
    },
  })
}

export function useUpdateLocalMessagePartMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<MessagePart> }) =>
      messageRepo.updateMessagePart(id, updates),
    onSuccess: (data) => {
      const part = data[0]
      if (part) {
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.parts(part.messageId) })
      }
    },
  })
}

export function useUpsertLocalMessagePartMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (part: Omit<MessagePart, "createdAt" | "updatedAt">) => messageRepo.upsertMessagePart(part),
    onSuccess: (data) => {
      const part = data[0]
      if (part) {
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.list(part.sessionId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.parts(part.messageId) })
      } else {
        console.log("⚠️ No part returned from upsert mutation")
      }
    },
    onError: (error, variables) => {
      console.log("❌ Failed to upsert message part:", (error as any)?.message || error, "for part:", variables.id)
    },
  })
}
export function useUpsertLocalMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (message: Omit<Message, "createdAt" | "updatedAt">) => messageRepo.upsertMessage(message),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.messages.list(variables.sessionId) })
    },
  })
}
