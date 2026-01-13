/**
 * SSH Port Allocator
 *
 * Robust port allocation strategy using system socket binding:
 * 1. Bind to 127.0.0.1:0 to get OS-allocated port
 * 2. Close socket immediately to release port
 * 3. Use port in SSH -L forwarding
 *
 * Collision Handling:
 * - Bounded retry loop with fixed backoff
 * - Max 5 attempts, 100ms backoff between attempts
 * - Fails gracefully with descriptive error
 *
 * Property Invariants:
 * - Allocated port is always on 127.0.0.1 (localhost only)
 * - Port is guaranteed to be available at allocation time
 * - Collision is rare but handled gracefully
 * - No resource leaks (sockets closed immediately)
 */

/**
 * Port allocation result
 */
export interface PortAllocation {
  port: number
  timestamp: number
}

/**
 * Port allocation error
 */
export interface PortAllocationError {
  message: string
  attempts: number
  lastError?: string
}

/**
 * Configuration for port allocation
 */
export interface PortAllocatorConfig {
  /** Maximum number of allocation attempts (default: 5) */
  maxAttempts?: number
  /** Backoff delay in milliseconds between retries (default: 100) */
  backoffMs?: number
}

/**
 * Allocates a local port using system socket binding
 *
 * Strategy:
 * 1. Create temporary server on 127.0.0.1:0
 * 2. OS assigns available port
 * 3. Close server immediately to release port
 * 4. Return port number
 * 5. Retry on collision with bounded backoff
 *
 * This approach is more reliable than trying random ports because:
 * - OS guarantees port availability at bind time
 * - Collision window is minimal (close → SSH immediately)
 * - Deterministic and testable
 *
 * @throws PortAllocationError if unable to allocate after max attempts
 */
export async function allocatePort(config?: PortAllocatorConfig): Promise<PortAllocation> {
  const maxAttempts = config?.maxAttempts ?? 5
  const backoffMs = config?.backoffMs ?? 100

  let lastError: string | undefined
  let port: number | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      port = await attemptPortAllocation()
      return {
        port,
        timestamp: Date.now(),
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)

      // If this was not the last attempt, wait and retry
      if (attempt < maxAttempts - 1) {
        await sleep(backoffMs)
      }
    }
  }

  // All attempts failed
  throw {
    message: `Failed to allocate port after ${maxAttempts} attempts`,
    attempts: maxAttempts,
    lastError,
  } as PortAllocationError
}

/**
 * Single port allocation attempt using Bun's TCP server
 * Binds to 127.0.0.1:0 to get OS-allocated port
 */
async function attemptPortAllocation(): Promise<number> {
  return new Promise((resolve, reject) => {
    // Use Bun's built-in server capabilities
    // Note: In actual implementation, this would use the appropriate
    // networking API available in the runtime (Bun, Node, etc.)

    // Create a temporary server socket
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0, // OS chooses available port
      fetch() {
        return new Response("placeholder")
      },
    })

    // Get the allocated port immediately
    const allocatedPort = server.port

    // Close the server to release the port
    server.stop()

    // Verify port is valid
    if (!allocatedPort || allocatedPort <= 0 || allocatedPort > 65535) {
      reject(new Error(`Invalid port allocated: ${allocatedPort}`))
      return
    }

    resolve(allocatedPort)
  })
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
