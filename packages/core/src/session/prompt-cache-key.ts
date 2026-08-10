export * as SessionPromptCacheKey from "./prompt-cache-key"

import { SessionSchema } from "./schema"

export const make = (sessionID: SessionSchema.ID) =>
  /^ses_[0-9a-f]{64}$/.test(sessionID) ? sessionID.slice(4) : sessionID
