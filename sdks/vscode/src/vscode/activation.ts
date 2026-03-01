import * as vscode from "vscode"
import { AcpProcess, ProcessState } from "../acp/process"
import { AcpClient, AcpClientConfig, AcpClientState } from "../acp/client"
import { JsonRpcConnection } from "../acp/connection"

export enum ActivationState {
  INACTIVE = "inactive",
  STARTING = "starting",
  ACTIVE = "active",
  ERROR = "error",
  DISPOSED = "disposed",
}

export interface ActivationControllerConfig {
  stopDelayMs?: number
  restartDelayMs?: number
  maxRestarts?: number
  spawnOptions?: { command: string; args: string[] }
}

export class ActivationController {
  private process: AcpProcess | null = null
  private client: AcpClient | null = null
  private connection: JsonRpcConnection | null = null
  private activeSessions = 0
  private state: ActivationState = ActivationState.INACTIVE
  private stopTimer: NodeJS.Timeout | null = null
  private restartCount = 0
  private disposed = false
  private startPromise: Promise<AcpClient> | null = null
  private config: Required<ActivationControllerConfig>

  constructor(
    private context: vscode.ExtensionContext,
    config: ActivationControllerConfig = {},
  ) {
    this.config = {
      stopDelayMs: config.stopDelayMs ?? 30000,
      restartDelayMs: config.restartDelayMs ?? 1000,
      maxRestarts: config.maxRestarts ?? 5,
      spawnOptions: config.spawnOptions ?? { command: "opencode", args: ["acp"] },
    }

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    this.context.subscriptions.push({
      dispose: () => {
        this.dispose()
      },
    })
  }

  getState(): ActivationState {
    return this.state
  }

  getActiveSessions(): number {
    return this.activeSessions
  }

  getRestartCount(): number {
    return this.restartCount
  }

  getStopDelay(): number {
    return this.config.stopDelayMs
  }

  isProcessRunning(): boolean {
    return this.process?.getState() === ProcessState.RUNNING
  }

  async ensureActivated(): Promise<AcpClient> {
    if (this.disposed) {
      throw new Error("ActivationController has been disposed")
    }

    if (this.state === ActivationState.DISPOSED) {
      throw new Error("Cannot activate disposed controller")
    }

    if (this.client?.getState() === AcpClientState.INITIALIZED) {
      return this.client
    }

    if (this.startPromise) {
      return this.startPromise
    }

    this.startPromise = this.activate()

    try {
      const client = await this.startPromise
      return client
    } finally {
      this.startPromise = null
    }
  }

  private async activate(): Promise<AcpClient> {
    this.state = ActivationState.STARTING

    try {
      await this.startAcp()
      this.state = ActivationState.ACTIVE
      this.restartCount = 0
      return this.client!
    } catch (error) {
      this.state = ActivationState.ERROR
      this.showStartFailureMessage(error)
      throw error
    }
  }

  private async startAcp(): Promise<void> {
    const { spawnOptions } = this.config

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Starting OpenCode...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Spawning ACP process..." })

        this.process = new AcpProcess({
          cwd: this.getWorkspacePath(),
          maxRestarts: this.config.maxRestarts,
          restartDelay: this.config.restartDelayMs,
        })

        this.setupProcessEventHandlers()

        try {
          await this.process.start({
            command: spawnOptions.command,
            args: spawnOptions.args,
          })

          progress.report({ message: "Initializing connection...", increment: 50 })

          const proc = this.process.getProcess()
          if (!proc?.stdin || !proc?.stdout) {
            throw new Error("Process stdio not available")
          }

          this.connection = new JsonRpcConnection(proc.stdin, proc.stdout)

          const clientConfig: AcpClientConfig = {
            connection: this.connection,
            clientInfo: {
              name: "vscode-opencode",
              version: this.getExtensionVersion(),
            },
            clientCapabilities: {},
          }

          this.client = new AcpClient(clientConfig)

          progress.report({ message: "Initializing client...", increment: 75 })

          await this.client.initialize()

          progress.report({ message: "Ready", increment: 100 })
        } catch (error) {
          await this.cleanup()
          throw error
        }
      },
    )
  }

  private getExtensionVersion(): string {
    try {
      const extension = vscode.extensions.getExtension("sst-dev.opencode")
      return extension?.packageJSON?.version ?? "1.0.0"
    } catch {
      return "1.0.0"
    }
  }

  private setupProcessEventHandlers(): void {
    if (!this.process) return

    this.process.onCrash(() => {
      this.handleProcessCrash()
    })

    this.process.onError((error) => {
      this.handleProcessError(error)
    })
  }

  private handleProcessCrash(): void {
    if (this.disposed || this.state === ActivationState.DISPOSED) {
      return
    }

    // Treat any crash as a hard failure: move to ERROR and clean up resources.
    this.state = ActivationState.ERROR
    this.cleanup()

    vscode.window.showWarningMessage("OpenCode process crashed and has been stopped.")
  }

  private handleProcessError(error: Error): void {
    if (this.disposed) return

    console.error("ACP process error:", error)
  }

  private showStartFailureMessage(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Failed to start OpenCode: ${message}`)
  }

  onSessionStarted(): void {
    if (this.disposed) return

    this.activeSessions++

    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
  }

  onSessionEnded(): void {
    if (this.disposed) return

    this.activeSessions--

    if (this.activeSessions <= 0) {
      this.activeSessions = 0
      this.scheduleStop()
    }
  }

  private scheduleStop(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
    }

    this.stopTimer = setTimeout(async () => {
      if (this.activeSessions === 0 && !this.disposed && this.state === ActivationState.ACTIVE) {
        await this.stopAcp()
        this.state = ActivationState.INACTIVE
      }
    }, this.config.stopDelayMs)
  }

  private async stopAcp(): Promise<void> {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }

    if (this.client) {
      await this.client.dispose()
      this.client = null
    }

    if (this.connection) {
      this.connection.dispose()
      this.connection = null
    }

    if (this.process) {
      await this.process.stop()
      this.process = null
    }
  }

  private async cleanup(): Promise<void> {
    await this.stopAcp()
  }

  private getWorkspacePath(): string {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders
      if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath
      }
    } catch {
      // Fall through to cwd
    }
    return process.cwd()
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.state = ActivationState.DISPOSED

    if (this.startPromise) {
      this.startPromise = null
    }

    await this.cleanup()
  }

  reset(): void {
    if (this.disposed) return

    if (this.state === ActivationState.ERROR) {
      this.state = ActivationState.INACTIVE
      this.restartCount = 0
    }
  }
}

export default ActivationController
