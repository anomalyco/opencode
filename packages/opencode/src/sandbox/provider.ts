import z from "zod"
import { NamedError } from "@opencode-ai/util/error"

/**
 * Sandbox namespace provides types and interfaces for running isolated
 * execution environments for OpenCode sessions.
 *
 * Supports multiple providers:
 * - `local`: Uses git worktrees for local isolation
 * - `modal`: Uses Modal.com cloud VMs
 * - `kubernetes`: Uses Kubernetes pods
 *
 * @example
 * ```ts
 * import { Sandbox } from "@/sandbox"
 *
 * // Get a provider
 * const provider = Sandbox.getProvider("local")
 *
 * // Create a sandbox
 * const instance = await provider.create({
 *   sessionId: "session_123",
 *   workdir: "/path/to/project",
 * })
 *
 * // Execute commands
 * const result = await instance.exec("npm", ["test"])
 * ```
 */
export namespace Sandbox {
  export const Status = z.enum(["creating", "running", "stopped", "terminated", "error"]).meta({
    ref: "SandboxStatus",
  })

  export type Status = z.infer<typeof Status>

  export const ProviderType = z.enum(["local", "modal", "kubernetes"]).meta({
    ref: "SandboxProviderType",
  })

  export type ProviderType = z.infer<typeof ProviderType>

  export const Config = z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      provider: z.enum(["local", "modal", "kubernetes"]).default("local"),
      image: z.string().optional(),
      workdir: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      cpu: z.number().optional(),
      memory: z.number().optional(),
      timeout: z.number().optional(),
      gitRepo: z.string().optional(),
      gitBranch: z.string().optional(),
      projectId: z.string().optional(),
      sessionId: z.string().optional(),
    })
    .meta({
      ref: "SandboxConfig",
    })

  export type Config = z.infer<typeof Config>

  export const ExecResult = z
    .object({
      exitCode: z.number(),
      stdout: z.string(),
      stderr: z.string(),
      durationMs: z.number().optional(),
    })
    .meta({
      ref: "SandboxExecResult",
    })

  export type ExecResult = z.infer<typeof ExecResult>

  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      status: Status,
      provider: ProviderType,
      workdir: z.string(),
      createdAt: z.string(),
      lastActivityAt: z.string().optional(),
      projectId: z.string().optional(),
      sessionId: z.string().optional(),
      snapshotId: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .meta({
      ref: "SandboxInfo",
    })

  export type Info = z.infer<typeof Info>

  export const Snapshot = z
    .object({
      id: z.string(),
      sandboxId: z.string(),
      name: z.string().optional(),
      createdAt: z.string(),
      sizeBytes: z.number().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .meta({
      ref: "SandboxSnapshot",
    })

  export type Snapshot = z.infer<typeof Snapshot>

  export const FileInfo = z
    .object({
      path: z.string(),
      type: z.enum(["file", "directory", "symlink"]),
      size: z.number().optional(),
      mode: z.string().optional(),
      modifiedAt: z.string().optional(),
    })
    .meta({
      ref: "SandboxFileInfo",
    })

  export type FileInfo = z.infer<typeof FileInfo>

  export const CreateError = NamedError.create(
    "SandboxCreateError",
    z.object({
      message: z.string(),
      provider: ProviderType.optional(),
    }),
  )

  export const NotFoundError = NamedError.create(
    "SandboxNotFoundError",
    z.object({
      id: z.string(),
      message: z.string(),
    }),
  )

  export const ExecError = NamedError.create(
    "SandboxExecError",
    z.object({
      message: z.string(),
      command: z.string().optional(),
      exitCode: z.number().optional(),
    }),
  )

  export const FileError = NamedError.create(
    "SandboxFileError",
    z.object({
      message: z.string(),
      path: z.string().optional(),
      operation: z.enum(["read", "write", "delete", "list"]).optional(),
    }),
  )

  export const SnapshotError = NamedError.create(
    "SandboxSnapshotError",
    z.object({
      message: z.string(),
      sandboxId: z.string().optional(),
      snapshotId: z.string().optional(),
    }),
  )

  export const ProviderError = NamedError.create(
    "SandboxProviderError",
    z.object({
      message: z.string(),
      provider: ProviderType.optional(),
      cause: z.string().optional(),
    }),
  )

  export const TimeoutError = NamedError.create(
    "SandboxTimeoutError",
    z.object({
      message: z.string(),
      timeoutMs: z.number().optional(),
    }),
  )

  /**
   * A running sandbox instance that can execute commands and perform file operations.
   */
  export interface Instance {
    /** Sandbox metadata including id, provider type, and status */
    readonly info: Info

    /** Execute a command in the sandbox */
    exec(
      command: string,
      args?: string[],
      options?: {
        cwd?: string
        env?: Record<string, string>
        timeout?: number
        stdin?: string
      },
    ): Promise<ExecResult>

    readFile(path: string): Promise<string>
    readFileBuffer(path: string): Promise<Uint8Array>
    writeFile(path: string, content: string | Uint8Array): Promise<void>
    deleteFile(path: string, options?: { recursive?: boolean }): Promise<void>
    listFiles(path: string): Promise<FileInfo[]>
    exists(path: string): Promise<boolean>
    snapshot(name?: string): Promise<Snapshot>
    stop(): Promise<void>
    terminate(): Promise<void>
    getStatus(): Promise<Status>
    waitForStatus(status: Status, timeoutMs?: number): Promise<void>
  }

  /**
   * Sandbox provider interface for creating and managing sandboxes.
   * Implementations include LocalSandboxProvider, ModalSandboxProvider, and KubernetesSandboxProvider.
   */
  export interface Provider {
    /** The provider type identifier */
    readonly type: ProviderType

    /** Create a new sandbox with the given configuration */
    create(config: Config): Promise<Instance>
    get(id: string): Promise<Instance | undefined>
    list(filter?: { projectId?: string; sessionId?: string; status?: Status }): Promise<Info[]>
    terminate(id: string): Promise<void>
    terminateAll(filter?: { projectId?: string; sessionId?: string }): Promise<number>
    restore(snapshotId: string, config?: Partial<Config>): Promise<Instance>
    listSnapshots(filter?: { sandboxId?: string; projectId?: string }): Promise<Snapshot[]>
    deleteSnapshot(snapshotId: string): Promise<void>
    healthCheck(): Promise<boolean>
  }

  const providers = new Map<ProviderType, Provider>()

  /** Register a sandbox provider for use by the system */
  export function registerProvider(provider: Provider): void {
    providers.set(provider.type, provider)
  }

  /** Get a registered provider by type */
  export function getProvider(type: ProviderType): Provider | undefined {
    return providers.get(type)
  }

  /** Get the default (local) provider */
  export function getDefaultProvider(): Provider | undefined {
    return providers.get("local")
  }

  /** List all registered provider types */
  export function listProviders(): ProviderType[] {
    return Array.from(providers.keys())
  }
}
