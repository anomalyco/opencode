import { z } from "zod"
import { eq, and } from "drizzle-orm"
import { Database } from "./drizzle"
import { ModelTable } from "./schema/model.sql"
import { Identifier } from "./identifier"
import { fn } from "./util/fn"
import { Actor } from "./actor"
import { Resource } from "@opencode-ai/console-resource"

export namespace ZenData {
  const FormatSchema = z.enum(["anthropic", "google", "openai", "oa-compat"])
  export type Format = z.infer<typeof FormatSchema>

  const ModelCostSchema = z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number().optional(),
    cacheWrite5m: z.number().optional(),
    cacheWrite1h: z.number().optional(),
  })

  const ModelSchema = z.object({
    name: z.string(),
    cost: ModelCostSchema,
    cost200K: ModelCostSchema.optional(),
    allowAnonymous: z.boolean().optional(),
    trial: z
      .object({
        limit: z.number(),
        provider: z.string(),
      })
      .optional(),
    rateLimit: z.number().optional(),
    fallbackProvider: z.string().optional(),
    providers: z.array(
      z.object({
        id: z.string(),
        model: z.string(),
        weight: z.number().optional(),
        disabled: z.boolean().optional(),
        storeModel: z.string().optional(),
      }),
    ),
  })

  const ProviderSchema = z.object({
    api: z.string(),
    apiKey: z.string(),
    format: FormatSchema,
    headerMappings: z.record(z.string(), z.string()).optional(),
  })

  const ModelsSchema = z.object({
    models: z.record(z.string(), ModelSchema),
    providers: z.record(z.string(), ProviderSchema),
  })

  export const validate = fn(ModelsSchema, (input) => {
    return input
  })

  export const list = fn(z.void(), () => {
    const json = JSON.parse(
      Resource.ZEN_MODELS1.value + Resource.ZEN_MODELS2.value + Resource.ZEN_MODELS3.value + Resource.ZEN_MODELS4.value,
    )
    return ModelsSchema.parse(json)
  })
}

export namespace Model {
  export const enable = fn(z.object({ model: z.string() }), ({ model }) => {
    Actor.assertAdmin()
    return Database.use((db) =>
      db.delete(ModelTable).where(and(eq(ModelTable.workspaceID, Actor.workspace()), eq(ModelTable.model, model))),
    )
  })

  export const disable = fn(z.object({ model: z.string() }), ({ model }) => {
    Actor.assertAdmin()
    return Database.use((db) =>
      db
        .insert(ModelTable)
        .values({
          id: Identifier.create("model"),
          workspaceID: Actor.workspace(),
          model: model,
        })
        .onDuplicateKeyUpdate({
          set: {
            timeDeleted: null,
          },
        }),
    )
  })

  export const listDisabled = fn(z.void(), () => {
    return Database.use((db) =>
      db
        .select({ model: ModelTable.model })
        .from(ModelTable)
        .where(eq(ModelTable.workspaceID, Actor.workspace()))
        .then((rows) => rows.map((row) => row.model)),
    )
  })

  export const isDisabled = fn(
    z.object({
      model: z.string(),
    }),
    ({ model }) => {
      return Database.use(async (db) => {
        const result = await db
          .select()
          .from(ModelTable)
          .where(and(eq(ModelTable.workspaceID, Actor.workspace()), eq(ModelTable.model, model)))
          .limit(1)

        return result.length > 0
      })
    },
  )
}
