// What the main process already knows when it creates a window, handed to the renderer through the
// preload's argv so the shell can mount before the IPC port exists. Undefined means "ask over IPC".
export type WindowBootstrap = {
  id: string
  firstLaunchPending?: boolean
  defaultServerUrl?: string | null
}

const prefix = "--opencode-window="

export function windowBootstrapArgument(bootstrap: WindowBootstrap) {
  return prefix + encodeURIComponent(JSON.stringify(bootstrap))
}

export function windowBootstrapFromArguments(args: readonly string[]): WindowBootstrap {
  const value = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  if (!value) throw new Error("Window bootstrap argument not found")
  return JSON.parse(decodeURIComponent(value))
}
