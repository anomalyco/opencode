import type { PollOptions, PollResult } from "../types.js"

/**
 * Generic polling utility with timeout and progress tracking
 * @param options Polling configuration options
 * @returns The data from the successful poll result
 * @throws Error if polling times out or fails
 */
export async function poll<T>(options: PollOptions<T>): Promise<T> {
  const { interval, maxAttempts, pollFn } = options

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Wait before polling (except first attempt)
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    const result: PollResult<T> = await pollFn()

    // If polling should stop
    if (!result.continue) {
      if (result.error) {
        throw result.error
      }
      if (!result.data) {
        throw new Error("Polling stopped without data")
      }
      return result.data
    }
  }

  throw new Error("Polling timeout: Maximum attempts reached")
}

/**
 * Calculate time remaining in a human-readable format
 * @param startTime Start time in milliseconds
 * @param expiresIn Total expiration time in seconds
 * @returns Formatted time string (e.g., "9:45")
 */
export function formatTimeRemaining(startTime: number, expiresIn: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const remaining = Math.max(0, expiresIn - elapsed)
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
