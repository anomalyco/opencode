import { Log } from "./log"

/**
 * Event loop monitoring namespace.
 *
 * Provides utilities for checking the Node.js event loop state
 * and waiting for all active handles and requests to complete.
 *
 * @example
 * ```typescript
 * await EventLoop.wait() // Waits for event loop to be empty
 * ```
 */
export namespace EventLoop {
  /**
   * Waits for the event loop to become empty.
   *
   * Polls active handles and requests until none remain.
   * Useful for ensuring all async operations complete before exit.
   */
  export async function wait() {
    return new Promise<void>((resolve) => {
      const check = () => {
        const active = [...(process as any)._getActiveHandles(), ...(process as any)._getActiveRequests()]
        Log.Default.info("eventloop", {
          active,
        })
        if ((process as any)._getActiveHandles().length === 0 && (process as any)._getActiveRequests().length === 0) {
          resolve()
        } else {
          setImmediate(check)
        }
      }
      check()
    })
  }
}
