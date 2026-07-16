// Message shapes shared between the aube C ABI worker and its client.

// Same schema as the Node-API transport (docs/embedding/ffi.md, "Events and
// results"); the C ABI delivers these as JSON strings.
export type InstallEvent =
  | { kind: "phase"; phase: "resolving" | "fetching" | "linking" | "complete" }
  | {
      kind: "progress"
      resolved: number
      total: number
      reused: number
      downloaded: number
      downloadedBytes: number
      estimatedBytes?: number
    }
  | {
      kind: "output"
      level: "info" | "warning" | "error"
      code?: string
      message: string
    }

export type InstallOptions = {
  projectDir: string
  ignoreScripts?: boolean
  offline?: boolean
  prodOnly?: boolean
  omitOptional?: boolean
  bufferEvents?: boolean
}

export type AddOptions = {
  saveExact?: boolean
  ignoreScripts?: boolean
  offline?: boolean
  prodOnly?: boolean
  omitOptional?: boolean
  bufferEvents?: boolean
}

export type FfiOperation =
  | { kind: "install"; options: InstallOptions }
  | { kind: "add"; projectDir: string; packages: string[]; options: AddOptions }

export type FfiResult = {
  ok: boolean
  code?: string
  message?: string
}

export type HostProfile = {
  name: string
  version: string
}

export type WorkerRequest = {
  host: HostProfile
  op: FfiOperation
}

export type WorkerResponse = { kind: "started"; handle: bigint | number } | { kind: "result"; result: FfiResult }
