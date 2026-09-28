// Shared bits for the Phase 7 failure tests: every run is a real `bun src/index.ts` subprocess (test/cli/harness.ts)
// against test/lib/local-server.ts, with test/fixture/mcp-everything.ts where MCP is involved.
import path from "path"
import type { setup } from "../cli/harness"

export type Env = Awaited<ReturnType<typeof setup>>

// Project trust (SECURITY F1): the test project's config sets providers, MCP servers and hooks, which an untrusted
// project layer may not. The env var trusts it for this run only; it is ignored by builds without the trust gate.
export const TRUST = { OCLITE_TRUST_PROJECT: "1" }

/** env.spawn with the test project trusted. */
export function spawn(env: Env, args: string[], options: Parameters<Env["spawn"]>[1] = {}) {
  return env.spawn(args, { ...options, env: { ...TRUST, ...options.env } })
}

export const fixture = path.resolve(import.meta.dir, "../fixture/mcp-everything.ts")

/** Merges `patch` into the project config the harness wrote. */
export async function patchConfig(env: Env, patch: Record<string, unknown>) {
  const config = JSON.parse(await env.project.read(".oclite/config.json"))
  await env.project.write(".oclite/config.json", JSON.stringify({ ...config, ...patch }))
}

export const withFixture = (env: Env, extra: Record<string, unknown> = {}) =>
  patchConfig(env, { mcp: { fixture: { type: "local", command: [process.execPath, fixture], ...extra } } })

export type Event = Record<string, unknown> & { type: string }

export const events = (stdout: string): Event[] =>
  stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

/** The session's JSONL records, read back through `oclite session export`. */
export async function exportSession(env: Env, id: string) {
  const result = await spawn(env, ["session", "export", id])
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown> & { type: string })
}

/** True while any process in the group led by `pid` is alive. */
export function groupAlive(pid: number) {
  return signal(-pid)
}

export function alive(pid: number) {
  return signal(pid)
}

function signal(target: number) {
  // kill(…, 0) only checks for existence; it throws ESRCH once the process (group) is gone.
  try {
    process.kill(target, 0)
    return true
  } catch {
    return false
  }
}

/** Polls until `check` passes or `ms` elapses; returns the last result. */
export async function until(check: () => boolean | Promise<boolean>, ms = 3000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return true
    await Bun.sleep(25)
  }
  return check()
}
