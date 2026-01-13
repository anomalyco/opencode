import { allocatePort, PortAllocatorConfig } from "./port-allocator"
import { SshInvocationBuilder } from "./invocation-builder"
import { SshCommandResult, SshErrorBucket, SshInvocationParams, SshTunnelHandle } from "./types"
import { classifySshError } from "./error-classifier"
import { discoverServer, ServerDiscoveryConfig, ServerDiscoveryResult } from "./server-discovery"

export interface TunnelProcess {
  pid: number
  exitCode: number | null
  stdout: ReadableStream<Uint8Array> | null
  stderr: ReadableStream<Uint8Array> | null
  killed?: boolean
  kill: (signal?: string) => void
  exited: Promise<number>
}

export interface TunnelSpawnResult {
  success: true
  process: TunnelProcess
}

export interface TunnelSpawnError {
  success: false
  message: string
  details?: string
}

export type TunnelSpawner = (command: SshCommandResult) => Promise<TunnelSpawnResult | TunnelSpawnError>

export interface TunnelConnectionConfig {
  sshParams: SshInvocationParams & {
    host: string
    remotePort: number
  }
  portAllocator?: PortAllocatorConfig
  connectTimeoutMs?: number
  discovery?: Omit<ServerDiscoveryConfig, "baseUrl">
  spawn?: TunnelSpawner
}

export interface TunnelConnectionResult {
  success: true
  handle: SshTunnelHandle
  command: SshCommandResult
  process: TunnelProcess
  baseUrl: string
  discovery?: ServerDiscoveryResult
}

export interface TunnelConnectionError {
  success: false
  phase: "port-allocation" | "command-build" | "spawn" | "discovery"
  message: string
  details?: string
  bucket?: SshErrorBucket
  stderr?: string
}

const builder = new SshInvocationBuilder()

export async function createTunnelConnection(
  config: TunnelConnectionConfig,
): Promise<TunnelConnectionResult | TunnelConnectionError> {
  const allocation = await allocatePort(config.portAllocator)
    .then((value) => ({ value } as { value: Awaited<ReturnType<typeof allocatePort>> }))
    .catch((error) => ({ error } as { error: unknown }))

  if ("error" in allocation) {
    return {
      success: false,
      phase: "port-allocation",
      message: "Failed to allocate local port",
      details: allocation.error instanceof Error ? allocation.error.message : String(allocation.error),
    }
  }

  const timeout = config.connectTimeoutMs ?? 5000
  const seconds = Math.max(1, Math.ceil(timeout / 1000))
  const options = {
    ...config.sshParams.options,
    ConnectTimeout: String(seconds),
  }

  const params: SshInvocationParams = {
    ...config.sshParams,
    localPort: allocation.value.port,
    options,
  }

  const command = await Promise.resolve()
    .then(() => builder.buildTunnel(params))
    .then((value) => ({ value } as { value: SshCommandResult }))
    .catch((error) => ({ error } as { error: unknown }))

  if ("error" in command) {
    return {
      success: false,
      phase: "command-build",
      message: "Failed to build SSH command",
      details: command.error instanceof Error ? command.error.message : String(command.error),
    }
  }

  const spawn = config.spawn ?? defaultSpawn
  const spawned = await spawn(command.value)

  if (!spawned.success) {
    const classified = classifySshError(spawned.message, spawned.details)
    return {
      success: false,
      phase: "spawn",
      message: spawned.message,
      details: spawned.details,
      bucket: classified.bucket,
      stderr: classified.stderr,
    }
  }

  const handle: SshTunnelHandle = {
    pid: spawned.process.pid,
    localPort: allocation.value.port,
    remotePort: config.sshParams.remotePort,
  }

  const baseUrl = `http://127.0.0.1:${handle.localPort}`

  if (!config.discovery) {
    return {
      success: true,
      handle,
      command: command.value,
      process: spawned.process,
      baseUrl,
    }
  }

  const discovery = await discoverServer({ ...config.discovery, baseUrl })

  if (!discovery.success) {
    return {
      success: false,
      phase: "discovery",
      message: discovery.message,
      details: discovery.details,
    }
  }

  if (!discovery.compatible) {
    return {
      success: false,
      phase: "discovery",
      message: "Incompatible server version",
      details: discovery.reason,
    }
  }

  return {
    success: true,
    handle,
    command: command.value,
    process: spawned.process,
    baseUrl,
    discovery,
  }
}

async function defaultSpawn(command: SshCommandResult): Promise<TunnelSpawnResult | TunnelSpawnError> {
  const spawned = await Promise.resolve()
    .then(() =>
      Bun.spawn([command.executable, ...command.args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }),
    )
    .then((process) => ({ process } as { process: TunnelProcess }))
    .catch((error) => ({ error } as { error: unknown }))

  if ("error" in spawned) {
    return {
      success: false,
      message: "Failed to spawn SSH process",
      details: spawned.error instanceof Error ? spawned.error.message : String(spawned.error),
    }
  }

  const process = spawned.process

  if (!process.pid) {
    return {
      success: false,
      message: "SSH process did not provide a PID",
    }
  }

  return {
    success: true,
    process,
  }
}
