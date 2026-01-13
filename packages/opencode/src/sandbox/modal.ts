import { Sandbox } from "./provider"

interface ModalClient {
  apps: {
    fromName(name: string, opts?: { createIfMissing?: boolean }): Promise<ModalApp>
  }
  sandboxes: {
    create(
      app: ModalApp,
      image: ModalImage,
      opts?: {
        timeout?: number
        workdir?: string
        env?: Record<string, string>
        cpu?: number
        memory?: number
        volumes?: Record<string, ModalVolume>
      },
    ): Promise<ModalSandbox>
    fromId(id: string): Promise<ModalSandbox>
  }
  images: {
    fromRegistry(name: string, opts?: Record<string, unknown>): ModalImage
    debianSlim(opts?: { pythonVersion?: string }): ModalImage
  }
  volumes: {
    fromName(name: string, opts?: { createIfMissing?: boolean }): Promise<ModalVolume>
  }
}

interface ModalApp {
  appId: string
}

interface ModalImage {
  pipInstall(...packages: string[]): ModalImage
  runCommands(...commands: string[]): ModalImage
}

interface ModalVolume {
  volumeId: string
}

interface ModalProcess {
  stdout: {
    readText(): Promise<string>
  }
  stderr: {
    readText(): Promise<string>
  }
  wait(): Promise<{ returncode: number }>
}

interface ModalSandbox {
  objectId: string
  exec(args: string[], opts?: { timeout?: number; workdir?: string; env?: Record<string, string> }): Promise<ModalProcess>
  terminate(): Promise<void>
  open(path: string, mode: string): Promise<ModalFile>
  ls(path: string): Promise<string[]>
  mkdir(path: string, opts?: { parents?: boolean }): Promise<void>
  rm(path: string, opts?: { recursive?: boolean }): Promise<void>
  snapshotFilesystem(opts?: { timeout?: number }): Promise<ModalImage>
}

interface ModalFile {
  read(): Promise<string>
  write(content: string): Promise<void>
  close(): Promise<void>
}

let modalClient: ModalClient | null = null

async function getModalClient(): Promise<ModalClient> {
  if (modalClient) return modalClient

  try {
    const moduleName = "modal"
    const modal = (await import(moduleName)) as { ModalClient: new () => ModalClient }
    modalClient = new modal.ModalClient()
    return modalClient
  } catch {
    throw new Sandbox.ProviderError({
      message: "Modal SDK not installed. Run: npm install modal",
      provider: "modal",
    })
  }
}

function generateId(): string {
  return `modal-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

class ModalSandboxInstance implements Sandbox.Instance {
  private modalSandbox: ModalSandbox

  constructor(
    public readonly info: Sandbox.Info,
    modalSandbox: ModalSandbox,
  ) {
    this.modalSandbox = modalSandbox
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: {
      cwd?: string
      env?: Record<string, string>
      timeout?: number
      stdin?: string
    },
  ): Promise<Sandbox.ExecResult> {
    const startTime = Date.now()

    try {
      const fullArgs = [command, ...args]
      const process = await this.modalSandbox.exec(fullArgs, {
        timeout: options?.timeout,
        workdir: options?.cwd,
        env: options?.env,
      })

      const [stdout, stderr, result] = await Promise.all([
        process.stdout.readText(),
        process.stderr.readText(),
        process.wait(),
      ])

      return Sandbox.ExecResult.parse({
        exitCode: result.returncode,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
      })
    } catch (err) {
      throw new Sandbox.ExecError({
        message: err instanceof Error ? err.message : String(err),
        command: `${command} ${args.join(" ")}`,
      })
    }
  }

  async readFile(path: string): Promise<string> {
    try {
      const file = await this.modalSandbox.open(path, "r")
      const content = await file.read()
      await file.close()
      return content
    } catch (err) {
      throw new Sandbox.FileError({
        message: err instanceof Error ? err.message : String(err),
        path,
        operation: "read",
      })
    }
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const content = await this.readFile(path)
    return new TextEncoder().encode(content)
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    try {
      const textContent = typeof content === "string" ? content : new TextDecoder().decode(content)
      const file = await this.modalSandbox.open(path, "w")
      await file.write(textContent)
      await file.close()
    } catch (err) {
      throw new Sandbox.FileError({
        message: err instanceof Error ? err.message : String(err),
        path,
        operation: "write",
      })
    }
  }

  async deleteFile(path: string, options?: { recursive?: boolean }): Promise<void> {
    try {
      await this.modalSandbox.rm(path, { recursive: options?.recursive })
    } catch (err) {
      throw new Sandbox.FileError({
        message: err instanceof Error ? err.message : String(err),
        path,
        operation: "delete",
      })
    }
  }

  async listFiles(path: string): Promise<Sandbox.FileInfo[]> {
    try {
      const entries = await this.modalSandbox.ls(path)
      return entries.map((name) =>
        Sandbox.FileInfo.parse({
          path: `${path}/${name}`,
          type: "file" as const,
        }),
      )
    } catch (err) {
      throw new Sandbox.FileError({
        message: err instanceof Error ? err.message : String(err),
        path,
        operation: "list",
      })
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.modalSandbox.ls(path)
      return true
    } catch {
      return false
    }
  }

  async snapshot(name?: string): Promise<Sandbox.Snapshot> {
    try {
      const image = await this.modalSandbox.snapshotFilesystem({ timeout: 300 })
      return Sandbox.Snapshot.parse({
        id: `snapshot-${Date.now()}`,
        sandboxId: this.info.id,
        name,
        createdAt: new Date().toISOString(),
        metadata: { imageId: (image as unknown as { imageId?: string }).imageId },
      })
    } catch (err) {
      throw new Sandbox.SnapshotError({
        message: err instanceof Error ? err.message : String(err),
        sandboxId: this.info.id,
      })
    }
  }

  async stop(): Promise<void> {
    await this.terminate()
  }

  async terminate(): Promise<void> {
    try {
      await this.modalSandbox.terminate()
    } catch (err) {
      throw new Sandbox.ProviderError({
        message: err instanceof Error ? err.message : String(err),
        provider: "modal",
      })
    }
  }

  async getStatus(): Promise<Sandbox.Status> {
    return "running"
  }

  async waitForStatus(status: Sandbox.Status, timeoutMs = 30000): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      const current = await this.getStatus()
      if (current === status) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Sandbox.TimeoutError({
      message: `Timed out waiting for status: ${status}`,
      timeoutMs,
    })
  }
}

export class ModalSandboxProvider implements Sandbox.Provider {
  readonly type: Sandbox.ProviderType = "modal"

  private appName: string
  private app: ModalApp | null = null
  private sandboxes = new Map<string, { info: Sandbox.Info; modalId: string }>()
  private snapshots = new Map<string, Sandbox.Snapshot>()

  constructor(appName = "opencode-sandboxes") {
    this.appName = appName
  }

  private async getApp(): Promise<ModalApp> {
    if (this.app) return this.app

    const client = await getModalClient()
    this.app = await client.apps.fromName(this.appName, { createIfMissing: true })
    return this.app
  }

  async create(config: Sandbox.Config): Promise<Sandbox.Instance> {
    try {
      const client = await getModalClient()
      const app = await this.getApp()

      const image = config.image
        ? client.images.fromRegistry(config.image)
        : client.images.debianSlim({ pythonVersion: "3.11" })

      const modalSandbox = await client.sandboxes.create(app, image, {
        timeout: config.timeout ?? 3600,
        workdir: config.workdir ?? "/workspace",
        env: config.env,
        cpu: config.cpu,
        memory: config.memory,
      })

      const info = Sandbox.Info.parse({
        id: config.id ?? generateId(),
        name: config.name ?? `sandbox-${Date.now()}`,
        status: "running" as const,
        provider: "modal" as const,
        workdir: config.workdir ?? "/workspace",
        createdAt: new Date().toISOString(),
        projectId: config.projectId,
        sessionId: config.sessionId,
        metadata: {
          modalId: modalSandbox.objectId,
          appName: this.appName,
        },
      })

      this.sandboxes.set(info.id, { info, modalId: modalSandbox.objectId })
      return new ModalSandboxInstance(info, modalSandbox)
    } catch (err) {
      if (err instanceof Sandbox.ProviderError) throw err
      throw new Sandbox.CreateError({
        message: err instanceof Error ? err.message : String(err),
        provider: "modal",
      })
    }
  }

  async get(id: string): Promise<Sandbox.Instance | undefined> {
    const entry = this.sandboxes.get(id)
    if (!entry) return undefined

    try {
      const client = await getModalClient()
      const modalSandbox = await client.sandboxes.fromId(entry.modalId)
      return new ModalSandboxInstance(entry.info, modalSandbox)
    } catch {
      return undefined
    }
  }

  async list(filter?: {
    projectId?: string
    sessionId?: string
    status?: Sandbox.Status
  }): Promise<Sandbox.Info[]> {
    let results = Array.from(this.sandboxes.values()).map((e) => e.info)

    if (filter?.projectId) {
      results = results.filter((s) => s.projectId === filter.projectId)
    }
    if (filter?.sessionId) {
      results = results.filter((s) => s.sessionId === filter.sessionId)
    }
    if (filter?.status) {
      results = results.filter((s) => s.status === filter.status)
    }

    return results
  }

  async terminate(id: string): Promise<void> {
    const instance = await this.get(id)
    if (!instance) {
      throw new Sandbox.NotFoundError({
        id,
        message: `Sandbox not found: ${id}`,
      })
    }
    await instance.terminate()
    this.sandboxes.delete(id)
  }

  async terminateAll(filter?: { projectId?: string; sessionId?: string }): Promise<number> {
    const toTerminate = await this.list(filter)
    let count = 0
    for (const info of toTerminate) {
      try {
        await this.terminate(info.id)
        count++
      } catch {}
    }
    return count
  }

  async restore(snapshotId: string, config?: Partial<Sandbox.Config>): Promise<Sandbox.Instance> {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) {
      throw new Sandbox.SnapshotError({
        message: `Snapshot not found: ${snapshotId}`,
        snapshotId,
      })
    }

    return this.create({
      ...config,
      image: (snapshot.metadata as { imageId?: string })?.imageId,
    } as Sandbox.Config)
  }

  async listSnapshots(filter?: { sandboxId?: string; projectId?: string }): Promise<Sandbox.Snapshot[]> {
    let results = Array.from(this.snapshots.values())

    if (filter?.sandboxId) {
      results = results.filter((s) => s.sandboxId === filter.sandboxId)
    }

    return results
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    if (!this.snapshots.has(snapshotId)) {
      throw new Sandbox.SnapshotError({
        message: `Snapshot not found: ${snapshotId}`,
        snapshotId,
      })
    }
    this.snapshots.delete(snapshotId)
  }

  async healthCheck(): Promise<boolean> {
    try {
      await getModalClient()
      return true
    } catch {
      return false
    }
  }
}

export function createModalProvider(appName?: string): ModalSandboxProvider {
  return new ModalSandboxProvider(appName)
}
