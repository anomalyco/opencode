import { Log } from "./log"

/**
 * Utilities for monitoring and managing the Node.js event loop.
 *
 * This namespace provides functions to inspect the event loop state,
 * useful for debugging async operations and ensuring clean shutdown.
 */
export namespace EventLoop {
  /**
   * Waits for the event loop to become empty.
   *
   * Polls the event loop until all active handles and requests are cleared.
   * Useful for ensuring all async operations complete before shutdown.
   * Logs active handles on each check for debugging purposes.
   *
   * @returns A promise that resolves when the event loop is empty
   * @example
   * ```typescript
   * // Wait for all async operations to complete
   * await EventLoop.wait()
   * console.log("Event loop is empty, safe to exit")
   * ```
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
