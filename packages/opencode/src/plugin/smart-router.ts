/**
 * Smart Router Plugin for opencode.
 *
 * DELEGATES all smart routing to hermes-agent.
 * 
 * This plugin just adds headers indicating that smart routing is enabled.
 * All actual routing, deduplication, and cost optimization happens on hermes-agent.
 *
 * Architecture:
 *   OpenCode (thin client) → Hermes (smart brain) → LLM APIs
 *
 * Benefits:
 * - Single point of routing logic (DRY)
 * - Centralized cost tracking
 * - Works for all clients (CLI, API, etc.)
 */

import type { Hooks } from "@opencode-ai/plugin"
import { Log } from "@/util/log"

const log = Log.create({ service: "smart_router_plugin" })

// Hook implementations
export const smartRouterHooks: Hooks = {
  "chat.params": async (input, output) => {
    // All smart routing is handled by hermes-agent
    // OpenCode just passes through
    return output
  },

  "chat.headers": async (input, output) => {
    // Signal that requests should use hermes's smart routing
    return {
      ...output,
      "x-smart-routing": "hermes",  // Tell hermes to handle routing
    }
  },
}

// Stats are fetched from hermes via /stats endpoint
// This is called by monitoring dashboards
export async function getSmartRouterStats(hermesUrl?: string) {
  // Default to local hermes
  const baseUrl = hermesUrl ?? "http://localhost:8642"
  
  try {
    const response = await fetch(`${baseUrl}/stats`)
    if (response.ok) {
      return await response.json()
    }
  } catch (error) {
    log.warn("Failed to fetch smart router stats from hermes", { error })
  }
  
  return {
    status: "unavailable",
    message: "Hermes stats endpoint unreachable",
  }
}
