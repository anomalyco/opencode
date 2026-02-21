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
  const TrialSchema = z.object({
    provider: z.string(),
    limits: z.array(
      z.object({
        limit: z.number(),
        client: z.enum(["cli", "desktop"]).optional(),
      }),
    ),
  })
  const RateLimitSchema = z.object({
    period: z.enum(["day", "rolling"]),
    value: z.number().int(),
    checkHeader: z.string().optional(),
    fallbackValue: z.number().int().optional(),
  })
  export type Format = z.infer<typeof FormatSchema>
  export type Trial = z.infer<typeof TrialSchema>
  export type RateLimit = z.infer<typeof RateLimitSchema>

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
    byokProvider: z.enum(["openai", "anthropic", "google"]).optional(),
    stickyProvider: z.enum(["strict", "prefer"]).optional(),
    trial: TrialSchema.optional(),
    rateLimit: RateLimitSchema.optional(),
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
    format: FormatSchema.optional(),
    headerMappings: z.record(z.string(), z.string()).optional(),
    payloadModifier: z.record(z.string(), z.any()).optional(),
    family: z.string().optional(),
  })

  const ProviderFamilySchema = z.object({
    headers: z.record(z.string(), z.string()).optional(),
    responseModifier: z.record(z.string(), z.string()).optional(),
  })

  const ModelsSchema = z.object({
    models: z.record(z.string(), z.union([ModelSchema, z.array(ModelSchema.extend({ formatFilter: FormatSchema }))])),
    liteModels: z.record(z.string(), ModelSchema),
    providers: z.record(z.string(), ProviderSchema),
    providerFamilies: z.record(z.string(), ProviderFamilySchema),
  })

  export const validate = fn(ModelsSchema, (input) => {
    return input
  })

  export const list = fn(z.enum(["lite", "full"]), (modelList) => {
    const json = JSON.parse(
      Resource.ZEN_MODELS1.value +
        Resource.ZEN_MODELS2.value +
        Resource.ZEN_MODELS3.value +
        Resource.ZEN_MODELS4.value +
        Resource.ZEN_MODELS5.value +
        Resource.ZEN_MODELS6.value +
        Resource.ZEN_MODELS7.value +
        Resource.ZEN_MODELS8.value +
        Resource.ZEN_MODELS9.value +
        Resource.ZEN_MODELS10.value +
        Resource.ZEN_MODELS11.value +
        Resource.ZEN_MODELS12.value +
        Resource.ZEN_MODELS13.value +
        Resource.ZEN_MODELS14.value +
        Resource.ZEN_MODELS15.value +
        Resource.ZEN_MODELS16.value +
        Resource.ZEN_MODELS17.value +
        Resource.ZEN_MODELS18.value +
        Resource.ZEN_MODELS19.value +
        Resource.ZEN_MODELS20.value +
        Resource.ZEN_MODELS21.value +
        Resource.ZEN_MODELS22.value +
        Resource.ZEN_MODELS23.value +
        Resource.ZEN_MODELS24.value +
        Resource.ZEN_MODELS25.value +
        Resource.ZEN_MODELS26.value +
        Resource.ZEN_MODELS27.value +
        Resource.ZEN_MODELS28.value +
        Resource.ZEN_MODELS29.value +
        Resource.ZEN_MODELS30.value,
    )
    const { models, liteModels, providers, providerFamilies } = ModelsSchema.parse(json)
    return {
      models: modelList === "lite" ? liteModels : models,
      providers: Object.fromEntries(
        Object.entries(providers).map(([id, provider]) => [
          id,
          { ...provider, ...(provider.family ? providerFamilies[provider.family] : {}) },
        ]),
      ),
    }
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
