import { execFile, spawn, type ExecFileOptions, type SpawnOptions } from "node:child_process"

export function hiddenExecFileOptions(options: ExecFileOptions = {}): ExecFileOptions {
  if (process.platform !== "win32" || Object.prototype.hasOwnProperty.call(options, "windowsHide")) {
    return options
  }
  return { ...options, windowsHide: true }
}

export function hiddenSpawnOptions<T extends SpawnOptions>(options: T = {} as T): T {
  if (process.platform !== "win32" || Object.prototype.hasOwnProperty.call(options, "windowsHide")) {
    return options
  }
  return { ...options, windowsHide: true }
}

export function hiddenExecFile(
  file: string,
  args: readonly string[] | null | undefined,
  options: ExecFileOptions,
  callback: Parameters<typeof execFile>[3],
) {
  return execFile(file, args, hiddenExecFileOptions(options), callback)
}

export function hiddenSpawn(command: string, args: readonly string[], options?: SpawnOptions) {
  return spawn(command, args, hiddenSpawnOptions(options))
}
