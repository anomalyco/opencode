export * as SessionPromptCacheKey from "./prompt-cache-key.js"

import { SessionSchema } from "./schema.js"

export const make = (sessionID: SessionSchema.ID) =>
  /^ses_[0-9a-f]{64}$/.test(sessionID) ? sessionID.slice(4) : sessionID
