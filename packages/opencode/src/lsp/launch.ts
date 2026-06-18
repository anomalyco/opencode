import type { ChildProcessWithoutNullStreams } from "child_process"
import { AsyncLocalStorage } from "node:async_hooks"
import { Process } from "@/util/process"

type Child = Process.Child & ChildProcessWithoutNullStreams
const envStorage = new AsyncLocalStorage<Record<string, string>>()
let fallbackEnv: Record<string, string> | undefined

export async function withEnv<T>(env: Record<string, string> | undefined, fn: () => Promise<T>): Promise<T> {
  if (!env || Object.keys(env).length === 0) return fn()
  const previous = fallbackEnv
  fallbackEnv = { ...fallbackEnv, ...env }
  try {
    return await envStorage.run(fallbackEnv, fn)
  } finally {
    fallbackEnv = previous
  }
}

export function spawn(cmd: string, args: string[], opts?: Process.Options): Child
export function spawn(cmd: string, opts?: Process.Options): Child
export function spawn(cmd: string, argsOrOpts?: string[] | Process.Options, opts?: Process.Options) {
  const args = Array.isArray(argsOrOpts) ? [...argsOrOpts] : []
  const cfg = Array.isArray(argsOrOpts) ? opts : argsOrOpts
  const env = envStorage.getStore() ?? fallbackEnv
  const proc = Process.spawn([cmd, ...args], {
    ...cfg,
    ...(env ? { env: { ...process.env, ...cfg?.env, ...env } } : {}),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }) as Child

  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")

  return proc
}
