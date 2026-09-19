export * as NativeCompactionPlugin from "./compaction.js"

import { LLMClient, Message } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { SessionCompaction } from "../session/compaction.js"
import type { PluginInternal } from "./internal.js"

export const Plugin = define({
  id: "opencode.compaction.native",
  effect: Effect.fn("NativeCompactionPlugin")(function* () {
    const llm = yield* LLMClient.Service
    const compaction = yield* SessionCompaction.Service
    yield* compaction.transform((editor) => {
      editor.native((input) => {
        const request = input.request
        if (LLMClient.canCompact(request, { mechanism: "trigger" }))
          return Effect.gen(function* () {
            const retained = yield* input.retained
            const result = yield* llm.compact(request, { ...input.options, mechanism: "trigger" })
            return { replacement: [...retained, Message.assistant(result.checkpoint)], usage: result.usage }
          })
        if (LLMClient.canCompact(request))
          return llm.compact(request, { mechanism: "endpoint", http: input.options.http })
        return undefined
      })
    })
  }),
} satisfies PluginInternal.InternalPlugin)
