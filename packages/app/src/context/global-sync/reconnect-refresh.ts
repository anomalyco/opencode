import { directoryKey } from "./utils"

export function planReconnectRefresh(input: {
  directories: string[]
  forceSessions: boolean
  hasSessionMeta: (directoryKey: string) => boolean
}) {
  return {
    refreshGlobal: true,
    bootstrapDirectories: input.directories,
    forceSessionDirectories: input.forceSessions
      ? input.directories.filter((directory) => input.hasSessionMeta(directoryKey(directory))).map(directoryKey)
      : [],
  }
}
