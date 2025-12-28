import type { WorkflowStrategy } from "./strategy"

/**
 * In-memory storage for registered strategies
 */
const strategies = new Map<string, WorkflowStrategy.Strategy>()

/**
 * Registry for workflow strategies
 * Allows registration and retrieval of workflow implementations
 */
export namespace WorkflowRegistry {
  /**
   * Register a workflow strategy
   */
  export function register(strategy: WorkflowStrategy.Strategy): void {
    if (strategies.has(strategy.id)) {
      console.warn(`Overwriting existing strategy: ${strategy.id}`)
    }

    strategies.set(strategy.id, strategy)
  }

  /**
   * Get a strategy by ID
   */
  export function get(id: string): WorkflowStrategy.Strategy {
    const strategy = strategies.get(id)

    if (!strategy) {
      throw new Error(`Workflow strategy not found: ${id}`)
    }

    return strategy
  }

  /**
   * List all registered strategies
   */
  export function list(): WorkflowStrategy.Strategy[] {
    return Array.from(strategies.values())
  }

  /**
   * Clear all registered strategies (for testing)
   */
  export function clear(): void {
    strategies.clear()
  }
}
