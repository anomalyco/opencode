import { Database, eq } from "@opencode-ai/console-core/drizzle/index.js"
import { ModelStickyProviderTable } from "@opencode-ai/console-core/schema/ip.sql.js"

export function createStickyTracker(modelId: string, stickyProvider: "strict" | "prefer" | undefined, session: string) {
  if (!stickyProvider) return
  if (!session) return
  const id = `${modelId}/${session}`
  let _providerId: string | undefined

  return {
    get: async () => {
      const data = await Database.use((tx) =>
        tx
          .select({
            providerId: ModelStickyProviderTable.providerId,
          })
          .from(ModelStickyProviderTable)
          .where(eq(ModelStickyProviderTable.id, id))
          .limit(1),
      )
      _providerId = data[0]?.providerId
      return _providerId
    },
    set: async (providerId: string) => {
      if (_providerId === providerId) return

      await Database.use((tx) =>
        tx
          .insert(ModelStickyProviderTable)
          .values({
            id,
            providerId,
          })
          .onDuplicateKeyUpdate({
            set: {
              providerId,
            },
          }),
      )
    },
  }
}
