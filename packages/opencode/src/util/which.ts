import whichPkg from "which"

/**
 * Resolves the path to an executable command in the system PATH.
 *
 * Searches for the given command in the directories specified by the PATH
 * environment variable and returns the absolute path if found.
 *
 * @param cmd - The command name to search for
 * @param env - Optional environment variables object (defaults to process.env)
 * @returns The absolute path to the executable, or null if not found
 * @example
 * ```typescript
 * const gitPath = which("git")
 * // Returns: "/usr/bin/git" or null
 * ```
 */
export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return typeof result === "string" ? result : null
}
