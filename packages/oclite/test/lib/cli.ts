// Spawns the real `bun src/index.ts` with an isolated HOME/XDG (idea from packages/opencode/test/lib/cli-process.ts).
import path from "path"

const entry = path.resolve(import.meta.dir, "../../src/index.ts")

export function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_STATE_HOME: path.join(home, ".local/state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    NO_COLOR: "1",
  }
}

export async function oclite(args: string[], options: { cwd: string; home: string; env?: Record<string, string> }) {
  const proc = Bun.spawn([process.execPath, entry, ...args], {
    cwd: options.cwd,
    env: { ...isolatedEnv(options.home), ...options.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}
