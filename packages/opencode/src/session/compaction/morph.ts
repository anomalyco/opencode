import { Log } from "@/util/log"
import type { CompactionInput, CompactionProvider, CompactionResult } from "./provider"

const MORPH_API_URL = "https://api.morphllm.com/v1/compact"
const TIMEOUT_MS = 120_000

const log = Log.create({ service: "compaction.morph" })

export function createMorphProvider(apiKey: string): CompactionProvider {
  return {
    name: "morph",
    async compact(input: CompactionInput): Promise<CompactionResult> {
      log.info("sending", { messages: input.messages.length, ratio: input.compressionRatio })

      const response = await fetch(MORPH_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: input.messages,
          compression_ratio: input.compressionRatio,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => "")
        throw new Error(`Morph compaction failed (${response.status}): ${body}`)
      }

      const data = (await response.json()) as { messages: Array<{ role: string; content: string }> }

      if (!data.messages || !Array.isArray(data.messages)) {
        throw new Error("Morph compaction returned invalid response: missing messages array")
      }

      log.info("received", { messages: data.messages.length })

      return { messages: data.messages }
    },
  }
}
