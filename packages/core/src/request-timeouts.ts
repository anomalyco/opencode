export * as RequestTimeouts from "./request-timeouts.js"

import { HttpTimeout } from "@opencode-ai/ai"
import { Option, Schema, Struct } from "effect"

/** Provider `settings` keys that configure request timeouts rather than the provider package. */
export const KEYS = ["headerTimeout", "chunkTimeout"] as const

const decode = Schema.decodeUnknownOption(HttpTimeout)

/** Read timeout settings; values that are not positive milliseconds or `false` are ignored so the default applies. */
export const from = (settings: Readonly<Record<string, unknown>> | undefined) => ({
  headerTimeout: Option.getOrUndefined(decode(settings?.headerTimeout)),
  chunkTimeout: Option.getOrUndefined(decode(settings?.chunkTimeout)),
})

export const strip = <T extends Readonly<Record<string, unknown>>>(settings: T) => Struct.omit(settings, KEYS)
