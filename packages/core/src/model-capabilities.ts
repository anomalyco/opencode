import { Capabilities } from "@opencode/ai/effect"
import type { Compatibility } from "./model.js"

/** Config and catalog `compatibility` keys as AI package capabilities. Unset keys stay unknown. */
export const fromCompatibility = (compatibility: Compatibility | undefined) =>
  compatibility === undefined
    ? undefined
    : Capabilities.merge<Capabilities.Any>({
        reasoning: {
          field: compatibility.reasoningField,
          required: compatibility.requireReasoning,
          updates: compatibility.supportsEffortUpdates,
          thinkingBlockBinding: compatibility.supportsThinkingBlockBinding,
        },
        output: {
          maxTokensField: compatibility.maxTokensField,
          requireFinishReason: compatibility.requireFinishReason,
          streamUsage: compatibility.streamUsage,
        },
        messages: { requireAssistantAfterTool: compatibility.requireAssistantAfterTool },
        cache: { promptCacheKey: compatibility.supportsPromptCacheKey, format: compatibility.cacheFormat },
        system: { updates: compatibility.supportsSystemUpdates },
      })

/** A package model's capabilities with catalog and config facts over them. */
export const resolve = (
  runtime: Capabilities.Any | undefined,
  compatibility: Compatibility | undefined,
  freeform: NonNullable<NonNullable<Capabilities.Any["tools"]>["freeform"]>,
) => Capabilities.merge(runtime, fromCompatibility(compatibility), { tools: { freeform } })

export * as ModelCapabilities from "./model-capabilities.js"
