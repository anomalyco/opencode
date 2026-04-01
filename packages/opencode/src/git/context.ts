import { Instance } from "../project/instance"

/** Cached git context — refreshed every 60 seconds per directory */
const cache = new Map<string, { text: string; at: number }>()
const TTL = 60_000

async function run(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed`)
  return out.trim()
}

async function fetch(dir: string): Promise<string> {
  const [branch, status, log] = await Promise.all([
    run(["rev-parse", "--abbrev-ref", "HEAD"], dir).catch(() => ""),
    run(["status", "--short"], dir).catch(() => ""),
    run(["log", "--oneline", "-5"], dir).catch(() => ""),
  ])

  if (!branch) return ""

  const parts = [`Branch: ${branch}`]
  if (status) parts.push(`Status:\n${status}`)
  if (log) parts.push(`Recent commits:\n${log}`)
  return parts.join("\n")
}

export namespace GitContext {
  /** Get cached git context for the current Instance directory. Returns empty string if not a git repo. */
  export async function get(): Promise<string> {
    const dir = Instance.directory
    const now = Date.now()
    const entry = cache.get(dir)
    if (entry && now - entry.at < TTL) return entry.text

    const text = await fetch(dir).catch(() => "")
    cache.set(dir, { text, at: now })
    return text
  }

  /** Invalidate the cache for the current directory (e.g. after a commit) */
  export function invalidate(dir?: string) {
    cache.delete(dir ?? Instance.directory)
  }

  /** Format git context as a system prompt section */
  export async function section(): Promise<string | undefined> {
    const text = await get()
    if (!text) return undefined
    return `<git_context>\n${text}\n</git_context>`
  }
}
