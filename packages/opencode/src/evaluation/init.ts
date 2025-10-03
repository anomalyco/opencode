import { registerBuiltinMetrics } from "./metrics/builtin"
import { Log } from "../util/log"

const log = Log.create({ service: "evaluation-init" })

let initialized = false

/**
 * Initialize the evaluation framework
 * Registers built-in metrics and sets up event listeners
 */
export async function initEvaluation(): Promise<void> {
  if (initialized) return
  
  try {
    // Register all built-in metrics
    await registerBuiltinMetrics()
    
    log.info("evaluation framework initialized", {
      metricsRegistered: true,
    })
    
    initialized = true
  } catch (error) {
    log.error("failed to initialize evaluation framework", {
      error: error instanceof Error ? error.message : String(error),
    })
    // Don't throw - evaluation framework initialization failures shouldn't block the app
  }
}
