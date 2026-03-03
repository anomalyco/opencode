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
  spawnOptions?: { command: string; args: string[] }
}

export class ActivationController {
  private process: AcpProcess | null = null
  private client: AcpClient | null = null
  private connection: JsonRpcConnection | null = null
  private activeSessions = 0
  private state: ActivationState = ActivationState.INACTIVE
  private stopTimer: NodeJS.Timeout | null = null
  private disposed = false
  private startPromise: Promise<AcpClient> | null = null
  private stamp = 0
  private config: Required<ActivationControllerConfig>

  constructor(
    private context: vscode.ExtensionContext,
    private output: vscode.OutputChannel,
    config: ActivationControllerConfig = {},
  ) {
    this.config = {
      stopDelayMs: config.stopDelayMs ?? 30000,
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

    const stamp = ++this.stamp
    this.startPromise = this.activate(stamp)

    this.startPromise = this.startPromise
      .then((client) => {
        this.startPromise = null
        return client
      })
      .catch((error) => {
        this.startPromise = null
        throw error
      })

    return this.startPromise
  }

  private async activate(stamp: number): Promise<AcpClient> {
    if (this.isStale(stamp)) {
      throw new Error("Activation canceled after disposal")
    }

    this.state = ActivationState.STARTING

    try {
      await this.startAcp(stamp)
      if (this.isStale(stamp)) {
        await this.stopAcp()
        throw new Error("Activation canceled after disposal")
      }
      this.state = ActivationState.ACTIVE
      return this.client!
    } catch (error) {
      if (this.isStale(stamp)) {
        throw error
      }
      this.state = ActivationState.ERROR
      this.showStartFailureMessage(error)
      throw error
    }
  }

  private async startAcp(stamp: number): Promise<void> {
    const { spawnOptions } = this.config
    this.output.appendLine(`OpenCode ACP spawn: ${spawnOptions.command} ${spawnOptions.args.join(" ")}`)

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
          maxRestarts: 0,
        })

        this.setupProcessEventHandlers()

        try {
          await this.process.start({
            command: spawnOptions.command,
            args: spawnOptions.args,
          })
          if (this.isStale(stamp)) {
            throw new Error("Activation canceled after disposal")
          }
          this.output.appendLine("OpenCode ACP process started")

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
          if (this.isStale(stamp)) {
            throw new Error("Activation canceled after disposal")
          }
          this.output.appendLine("OpenCode ACP client initialized")

          progress.report({ message: "Ready", increment: 100 })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.output.appendLine(`OpenCode ACP start failure: ${message}`)
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`OpenCode extension version read failure: ${message}`)
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

    this.state = ActivationState.ERROR
    void this.cleanup().catch((cleanupError) => {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      this.output.appendLine(`OpenCode ACP cleanup failure: ${message}`)
    })
    this.output.appendLine("OpenCode ACP process crashed.")
    vscode.window.showWarningMessage("OpenCode process crashed and has been stopped.")
  }

  private handleProcessError(error: Error): void {
    if (this.disposed) return

    if (this.process?.getState() !== ProcessState.FAILED) {
      this.output.appendLine(`OpenCode ACP process error: ${error.message}`)
      return
    }

    this.state = ActivationState.ERROR
    void this.cleanup().catch((cleanupError) => {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      this.output.appendLine(`OpenCode ACP cleanup failure: ${message}`)
    })
    this.output.appendLine(`OpenCode ACP process failed: ${error.message}`)
    vscode.window.showWarningMessage("OpenCode process failed and has been stopped.")
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

    this.stopTimer = setTimeout(() => {
      if (this.activeSessions !== 0) return
      if (this.disposed) return
      if (this.state !== ActivationState.ACTIVE && this.state !== ActivationState.ERROR) return

      void this.stopAcp().catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.output.appendLine(`OpenCode ACP scheduled stop failure: ${message}`)
      })
    }, this.config.stopDelayMs)
  }

  private isStale(stamp: number): boolean {
    return this.disposed || this.state === ActivationState.DISPOSED || stamp !== this.stamp
  }

  private async stopAcp(): Promise<void> {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }

    const client = this.client
    const connection = this.connection
    const proc = this.process

    this.client = null
    this.connection = null
    this.process = null

    if (client) {
      try {
        await client.dispose()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.output.appendLine(`OpenCode ACP client teardown failure: ${message}`)
      }
    }

    if (connection) {
      try {
        connection.dispose()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.output.appendLine(`OpenCode ACP connection teardown failure: ${message}`)
      }
    }

    if (proc) {
      try {
        await proc.stop()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.output.appendLine(`OpenCode ACP process teardown failure: ${message}`)
      }
    }

    if (this.state === ActivationState.ACTIVE) {
      this.state = ActivationState.INACTIVE
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
    this.stamp++

    if (this.startPromise) {
      this.startPromise = null
    }

    await this.cleanup()
  }
}

export default ActivationController
