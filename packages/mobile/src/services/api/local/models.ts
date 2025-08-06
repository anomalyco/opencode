import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { eq } from "drizzle-orm"
import db from "@/db"
import { models } from "@/db/schema"
import type { Model, NewModel } from "@/db/types"
import { queryKeys } from "../keys"

// Query hooks
export function useLocalModelsQuery() {
  return useQuery({
    queryKey: queryKeys.local.models.lists(),
    queryFn: async (): Promise<Model[]> => {
      return await db.select().from(models)
    },
  })
}

export function useLocalModelQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.local.models.detail(id),
    queryFn: async (): Promise<Model | null> => {
      const result = await db.select().from(models).where(eq(models.id, id)).limit(1)
      return result[0] || null
    },
    enabled: !!id,
  })
}

// Mutation hooks
export function useUpsertLocalModelMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (model: Omit<NewModel, "createdAt" | "updatedAt">): Promise<Model> => {
      const now = new Date()
      const modelData: NewModel = {
        ...model,
        createdAt: now,
        updatedAt: now,
      }

      // Use INSERT OR REPLACE to handle upserts
      await db
        .insert(models)
        .values(modelData)
        .onConflictDoUpdate({
          target: models.id,
          set: {
            name: modelData.name,
            providerId: modelData.providerId,
            providerName: modelData.providerName,
            contextLength: modelData.contextLength,
            inputPrice: modelData.inputPrice,
            outputPrice: modelData.outputPrice,
            isCached: modelData.isCached,
            lastSyncTimestamp: modelData.lastSyncTimestamp,
            updatedAt: now,
          },
        })

      // Return the inserted/updated model
      const result = await db.select().from(models).where(eq(models.id, model.id)).limit(1)
      return result[0]
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.models.all })
    },
  })
}

export function useDeleteLocalModelMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await db.delete(models).where(eq(models.id, id))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.models.all })
    },
  })
}
