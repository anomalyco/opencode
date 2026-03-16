import whichPkg from "which"

/**
 * Locates the path to a command executable.
 *
 * Searches for the command in the system PATH and returns
 * the full path if found, or null if not found.
 *
 * @param cmd The command to locate
 * @param env Optional environment variables to use for path lookup
 * @returns Full path to the command or null if not found
 */
export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return typeof result === "string" ? result : null
}
