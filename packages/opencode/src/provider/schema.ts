import { Schema } from "effect"

import { withStatics } from "@opencode-ai/core/schema"

const providerIdSchema = Schema.String.pipe(Schema.brand("ProviderID"))

export type ProviderID = typeof providerIdSchema.Type

export const ProviderID = providerIdSchema.pipe(
  withStatics((schema: typeof providerIdSchema) => ({
    // Well-known providers
    opencode: schema.makeUnsafe("opencode"),
    anthropic: schema.makeUnsafe("anthropic"),
    openai: schema.makeUnsafe("openai"),
    google: schema.makeUnsafe("google"),
    googleVertex: schema.makeUnsafe("google-vertex"),
    githubCopilot: schema.makeUnsafe("github-copilot"),
    githubCopilotEnterprise: schema.makeUnsafe("github-copilot-enterprise"),
    amazonBedrock: schema.makeUnsafe("amazon-bedrock"),
    azure: schema.makeUnsafe("azure"),
    openrouter: schema.makeUnsafe("openrouter"),
    mistral: schema.makeUnsafe("mistral"),
    gitlab: schema.makeUnsafe("gitlab"),
  })),
)

const modelIdSchema = Schema.String.pipe(Schema.brand("ModelID"))

export type ModelID = typeof modelIdSchema.Type

export const ModelID = modelIdSchema
