import path from "node:path"

/** Where SIGUSR2 writes heap snapshots while memory diagnostics are on: a caller-chosen absolute folder, or none. */
export function snapshotDirectory(env: NodeJS.ProcessEnv) {
  const directory = env.OPENCODE_DESKTOP_HEAP_DIRECTORY

  return directory && path.isAbsolute(directory) ? directory : undefined
}

/** Server heap serialization blocks all of its sessions; signal captures require a separate opt-in. */
export function signalIncludesServer(env: NodeJS.ProcessEnv) {
  return env.OPENCODE_DESKTOP_HEAP_INCLUDE_SERVER === "1"
}
