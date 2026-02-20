import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "terminal-control" })

/**
 * TerminalControl coordinates TUI renderer suspend/resume with interactive tool execution.
 *
 * When a tool needs to spawn an interactive subprocess (stdio: "inherit"), it should:
 * 1. Call suspend() before spawning
 * 2. Run the subprocess
 * 3. Call resume() after subprocess exits (use try/finally)
 */
export namespace TerminalControl {
  const DEFAULT_SUSPEND_TIMEOUT_MS = 100
  const DEFAULT_RESUME_TIMEOUT_MS = 50

  interface AckHandler {
    readonly token: string
    readonly resolve: () => void
    readonly timer: NodeJS.Timeout
  }

  interface State {
    pendingAcks: Map<string, AckHandler>
    subscriptionsInitialized: boolean
  }

  const state = Instance.state(() => ({
    pendingAcks: new Map<string, AckHandler>(),
    subscriptionsInitialized: false,
  }))

  function isTuiMode(): boolean {
    return process.env.OPENCODE_TUI === "1"
  }

  function generateToken(): string {
    return Identifier.ascending("terminal")
  }

  function waitForAck(token: string, timeoutMs: number, operation: "suspend" | "resume"): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        state().pendingAcks.delete(token)
        log.warn(`${operation}: timeout waiting for TUI ack`, { token, timeoutMs })
        resolve()
      }, timeoutMs)

      state().pendingAcks.set(token, {
        token,
        timer,
        resolve: () => {
          clearTimeout(timer)
          state().pendingAcks.delete(token)
          log.debug(`${operation}: received ack`, { token })
          resolve()
        },
      })
    })
  }

  function cleanupPendingAck(token: string): void {
    const handler = state().pendingAcks.get(token)
    if (handler) {
      clearTimeout(handler.timer)
      state().pendingAcks.delete(token)
    }
  }

  export async function suspend(
    options?: {
      sessionID?: string
      callID?: string
      reason?: string
    },
    timeout = isTuiMode() ? DEFAULT_SUSPEND_TIMEOUT_MS : 0,
  ): Promise<string> {
    ensureSubscriptions()
    const token = generateToken()

    if (timeout === 0) {
      log.debug("suspend: headless mode, skipping wait", { token })
      return token
    }

    await Bus.publish(TuiEvent.RendererSuspendRequest, {
      token,
      sessionID: options?.sessionID,
      callID: options?.callID,
      reason: options?.reason,
    })

    await waitForAck(token, timeout, "suspend")
    return token
  }

  export async function resume(token: string, shouldWaitForAck = false): Promise<void> {
    ensureSubscriptions()
    cleanupPendingAck(token)

    await Bus.publish(TuiEvent.RendererResumeRequest, { token })

    if (shouldWaitForAck && isTuiMode()) {
      await waitForAck(token, DEFAULT_RESUME_TIMEOUT_MS, "resume")
    }
  }

  function handleAck(token: string): void {
    const handler = state().pendingAcks.get(token)
    handler?.resolve()
  }

  function ensureSubscriptions(): void {
    const s = state()
    if (s.subscriptionsInitialized) return
    s.subscriptionsInitialized = true

    Bus.subscribe(TuiEvent.RendererSuspendAck, (event) => {
      handleAck(event.properties.token)
    })

    Bus.subscribe(TuiEvent.RendererResumeAck, (event) => {
      handleAck(event.properties.token)
    })

    log.debug("Bus subscriptions initialized", { directory: Instance.directory })
  }
}
