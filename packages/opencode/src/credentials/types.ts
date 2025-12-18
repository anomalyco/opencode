import z from "zod"
import { type VaultEncryptedBlob } from "@/vault/crypto"

export namespace Credentials {
  export const Kind = z.enum(["oauth", "api", "wellknown", "mcp"]).meta({ ref: "CredentialKind" })
  export type Kind = z.infer<typeof Kind>

  export const Health = z
    .object({
      cooldownUntil: z.number().optional(),
      lastStatusCode: z.number().optional(),
      lastErrorAt: z.number().optional(),
      successCount: z.number().default(0),
      failureCount: z.number().default(0),
    })
    .strict()
    .default(() => ({ successCount: 0, failureCount: 0 }))
    .meta({ ref: "CredentialHealth" })
  export type Health = z.infer<typeof Health>

  export const RecordMeta = z
    .object({
      id: z.string(),
      providerId: z.string(),
      namespace: z.string().default("default"),
      label: z.string().optional(),
      kind: Kind,
      createdAt: z.number(),
      updatedAt: z.number(),
      health: Health,
    })
    .strict()
    .meta({ ref: "CredentialRecordMeta" })
  export type RecordMeta = z.infer<typeof RecordMeta>

  export const EncryptedBlob = z.object({
    v: z.literal(2),
    alg: z.literal("AES-256-GCM"),
    nonce_b64: z.string(),
    tag_b64: z.string(),
    data_b64: z.string(),
    aad_b64: z.string(),
  }).strict().meta({ ref: "VaultEncryptedBlob" })
  export type EncryptedBlob = VaultEncryptedBlob

  export const RecordFile = z
    .object({
      meta: RecordMeta,
      secret: EncryptedBlob,
    })
    .strict()
    .meta({ ref: "CredentialRecordFile" })
  export type RecordFile = z.infer<typeof RecordFile>

  export type OAuthSecret = {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    extra?: Record<string, unknown>
  }

  export type ApiSecret = {
    apiKey: string
  }

  export type WellknownSecret = {
    envKey: string
    token: string
  }

  export type McpSecret = {
    entry: unknown
  }

  export type Secret = OAuthSecret | ApiSecret | WellknownSecret | McpSecret
}
