import type { MetadataExtractor } from "@ai-sdk/openai-compatible"
import { isRecord } from "@/util/record"

const nonNegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined

function extract(value: unknown) {
  if (!isRecord(value)) return {}
  const count = isRecord(value.usage) ? nonNegative(value.usage.cache_creation_input_tokens) : undefined
  const writes = Number.isSafeInteger(count) ? count : undefined
  const cost =
    isRecord(value.x_nanogpt_pricing) && value.x_nanogpt_pricing.currency === "USD"
      ? nonNegative(value.x_nanogpt_pricing.amount)
      : undefined
  return {
    ...(writes === undefined ? {} : { cacheCreationInputTokens: writes }),
    ...(cost === undefined ? {} : { costUSD: cost }),
  }
}

export const metadataExtractor: MetadataExtractor = {
  async extractMetadata({ parsedBody }) {
    return { nanogpt: extract(parsedBody) }
  },
  createStreamExtractor() {
    let metadata: ReturnType<typeof extract> = {}
    return {
      processChunk(chunk) {
        // Usage and settled pricing can arrive in separate frames. Explicit zero
        // replaces an earlier value; absent or invalid fields leave it intact.
        metadata = { ...metadata, ...extract(chunk) }
      },
      buildMetadata() {
        return { nanogpt: metadata }
      },
    }
  },
}

export * as NanoGPT from "./nanogpt"
