// Message shapes shared between the aube C ABI worker and its client.

export type InstallOptions = {
  projectDir: string
  ignoreScripts?: boolean
  offline?: boolean
  prodOnly?: boolean
  omitOptional?: boolean
}

export type AddOptions = {
  saveExact?: boolean
  ignoreScripts?: boolean
  offline?: boolean
  prodOnly?: boolean
  omitOptional?: boolean
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
