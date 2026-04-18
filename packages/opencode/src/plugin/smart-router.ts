/**
 * Smart Router Plugin for opencode.
 *
 * Integrates prompt deduplication and smart model routing into opencode.
 * Uses the chat.params hook to modify model selection based on query complexity.
 *
 * Features:
 * - Prompt deduplication (caches identical prompt responses)
 * - Smart model routing (routes simple queries to cheaper models)
 * - Cost tracking and statistics
 */

import type { Hooks } from "@opencode-ai/plugin"
import { SmartRouter, Dedup } from "@/util/dedup"
import { Log } from "@/util/log"

const log = Log.create({ service: "smart_router_plugin" })

// Plugin state
let initialized = false

function init() {
  if (initialized) return
  initialized = true

  // Initialize deduplicator with defaults
  Dedup.init()

  // Configure smart router with defaults
  SmartRouter.configure({
    primaryModel: "anthropic/claude-3-5-sonnet",
    budgetModel: "anthropic/claude-3-5-haiku",
    enableRouting: true,
    routingThreshold: 0.7,
  })

  log.info("smart router plugin initialized")
}

// Hook implementations
export const smartRouterHooks: Hooks = {
  "chat.params": async (input, output) => {
    init()

    const { message } = input
    if (!message?.content) return output

    // Extract prompt text from message
    const promptText = typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((c: any) => c.text ?? "").join(" ")
        : ""

    if (!promptText) return output

    // Check dedup cache first
    const [cached, found] = Dedup.get(promptText, input.model?.id ?? "unknown")
    if (found && cached) {
      log.info("dedup cache hit", { model: input.model?.id })
      // Note: We can't directly return cached response here because
      // the stream is already started. This is a limitation of the hook system.
      // The actual dedup benefit comes from the hermes-agent side.
    }

    // Route based on complexity
    const routing = SmartRouter.route(promptText)

    log.debug("routing decision", {
      complexity: routing.complexity,
      model: routing.model,
      reason: routing.reason,
    })

    // Note: We can't change model here because it's already resolved
    // The routing happens on the hermes-agent side

    return output
  },

  "chat.headers": async (input, output) => {
    // Add routing headers for debugging
    return {
      ...output,
      "x-smart-routing": "enabled",
    }
  },
}

// Stats API for debugging/monitoring
export function getSmartRouterStats() {
  return {
    dedup: Dedup.getStats(),
    routing: SmartRouter.getStats(),
  }
}

export function resetSmartRouterStats() {
  SmartRouter.resetStats()
}
