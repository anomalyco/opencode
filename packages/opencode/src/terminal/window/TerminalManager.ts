import { enableVT } from "../utils/enable-vt"
import { AnsiCodes } from "../utils/AnsiCodes"
import { detectCapabilities, type TerminalCapabilities } from "../utils/TerminalFeatures"

export class TerminalManager {
  private running = false
  private cleanupRegistered = false
  private capabilities: TerminalCapabilities | null = null

  get isRunning(): boolean {
    return this.running
  }

  startup(): void {
    if (this.running) return

    try {
      enableVT()
      this.capabilities = detectCapabilities()

      this.registerCleanupHandlers()
      this.writeStartupSequence()

      this.running = true
    } catch (err) {
      this._emergencyRestore()
      console.error("[TerminalManager] Startup failed:", err)
    }
  }

  shutdown(): void {
    if (!this.running) return
    this.running = false
    this.writeShutdownSequence()
  }

  _emergencyRestore(): void {
    try {
      process.stdout.write(AnsiCodes.SHUTDOWN)
    } catch (err) {
      console.error("[TerminalManager] Emergency restore failed:", String(err))
    }
  }

  private writeStartupSequence(): void {
    if (this.capabilities?.altScreen) {
      process.stdout.write(AnsiCodes.STARTUP)
    }
  }

  private writeShutdownSequence(): void {
    if (this.capabilities?.altScreen) {
      process.stdout.write(AnsiCodes.SHUTDOWN)
    }
  }

  private registerCleanupHandlers(): void {
    if (this.cleanupRegistered) return
    this.cleanupRegistered = true

    const cleanup = () => this.shutdown()

    process.on("exit", cleanup)
    process.on("SIGINT", () => { cleanup(); process.exit(0) })
    process.on("SIGTERM", () => { cleanup(); process.exit(0) })
    process.on("uncaughtException", (err) => {
      cleanup()
      console.error("[TerminalManager] Uncaught exception:", err)
      process.exit(1)
    })
    process.on("unhandledRejection", (reason) => {
      cleanup()
      console.error("[TerminalManager] Unhandled rejection:", reason)
      process.exit(1)
    })
  }
}
