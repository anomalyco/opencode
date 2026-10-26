import { realpathSync } from "node:fs"
import path from "node:path"

/**
 * The directory the CLI was invoked in.
 *
 * `process.cwd()` resolves symlinks, so a user who typed `cd /tmp/project` on
 * macOS sees `/private/tmp/project`. `$PWD` preserves the path they actually
 * typed, which is why it is preferred.
 *
 * But `$PWD` is a shell convention: shells set it on `cd`, and every child
 * process then inherits it verbatim. A parent that spawns the CLI with a
 * different working directory — CI, a test harness, an editor integration,
 * another agent — leaves a stale `$PWD` behind. Trusting it blindly roots the
 * session in the parent's project rather than the requested one, silently.
 *
 * So honor `$PWD` only while it still names the directory we are in.
 */
export function workingDirectory() {
  const cwd = process.cwd()
  const pwd = process.env.PWD
  if (!pwd) return cwd
  try {
    return realpathSync(pwd) === realpathSync(cwd) ? pwd : cwd
  } catch {
    return cwd
  }
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined

export function selfCommand() {
  const runtime = path.basename(process.execPath, path.extname(process.execPath)).toLowerCase()
  if (runtime !== "bun" && runtime !== "node" && runtime !== "nodejs") return [process.execPath]
  if (!entrypoint) throw new Error("Failed to resolve CLI entrypoint")
  if (runtime === "node" || runtime === "nodejs") return [process.execPath, ...nodeFlags(), entrypoint]
  return [process.execPath, entrypoint]
}

function nodeFlags() {
  return process.execArgv.flatMap((arg, index, args) => {
    if (index > 0 && args[index - 1] === "--conditions") return []
    if (arg === "--conditions") return args[index + 1] ? [arg, args[index + 1]] : []
    if (arg.startsWith("--conditions=")) return [arg]
    if (
      arg === "--experimental-ffi" ||
      arg === "--use-system-ca" ||
      arg === "--enable-source-maps" ||
      arg === "--no-addons"
    )
      return [arg]
    if (arg === "--no-warnings" || arg.startsWith("--disable-warning=")) return [arg]
    return []
  })
}
