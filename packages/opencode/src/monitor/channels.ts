/**
 * Zod schemas for the channels + rules write surface.
 *
 * Mirrors `monitor.sql.ts` Drizzle schemas but at the API boundary, with
 * clear input (write) vs. output (public) shapes — output masks secrets
 * so we never leak HMAC keys or webhook URLs back over the wire.
 */

import { z } from "zod"
import { ProviderID, CredentialField } from "./webhook"

const SECRET_MASK = "***"

export const ChannelWriteSchema = z.object({
  project_id: z.string().min(1),
  type: ProviderID,
  name: z.string().min(1).max(80),
  url: z.string().url().optional(),
  credentials: z.record(z.string(), z.string()).default({}),
  secret: z.string().optional(),
  enabled: z.boolean().default(true),
})
export type ChannelWrite = z.infer<typeof ChannelWriteSchema>

export const ChannelPublicSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  type: ProviderID,
  name: z.string(),
  url: z.string().nullable(),
  credentials: z.record(z.string(), z.string()),
  secret: z.string().nullable(),
  enabled: z.boolean(),
  time_created: z.number(),
  time_updated: z.number(),
  // Form metadata the UI uses to render the credential inputs. We expose
  // it through this endpoint so the client can build the form without
  // duplicating the registry.
  credentialFields: z.array(CredentialField),
})
export type ChannelPublic = z.infer<typeof ChannelPublicSchema>

export { SECRET_MASK }