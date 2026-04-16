// Vercel-backed implementation of `Process.spawn` from util/process.
//
// Process.spawn is sync and returns a Node ChildProcess-like object.
// VercelBackend.execStream is async (WebSocket handshake). We bridge by
// returning PassThrough streams immediately; writes queue until the
// socket is ready, reads start flowing once the exec channel opens.
//
// The workspace/* module graph is NOT touched at top-level here — it
// transitively pulls in @/global, which has a top-level `await`. That
// TLA cannot be loaded during util/process's eval phase. Dynamic
// `import()` inside the async setup defers the load until first call,
// breaking the cycle.

import { PassThrough, type Readable, type Writable } from "stream"
import type { Process } from "../util/process"

const POSIX_SHELL_ALLOWLIST: ReadonlySet<string> = new Set(["/bin/bash", "/bin/sh"])
const remapShell = (shell: Process.Shell | undefined): string | undefined => {
  if (shell === undefined || shell === false) return undefined
  if (shell === true) return "/bin/bash"
  return POSIX_SHELL_ALLOWLIST.has(shell) ? shell : "/bin/bash"
}

const buildEnv = (envOpt: Process.Options["env"]): Record<string, string> | undefined => {
  if (envOpt === null) return {}
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) base[k] = v
  if (envOpt) for (const [k, v] of Object.entries(envOpt)) if (typeof v === "string") base[k] = v
  return base
}

type RuntimeHandle = {
  run: <A>(eff: unknown) => Promise<A>
  fork: (eff: unknown) => void
}

// Lazy module-wide runtime factory. First spawn call triggers the
// dynamic imports; subsequent calls reuse the runtime. Returning the
// shape as `any`-typed Effect handles keeps the top of this file free
// of effect type imports.
let runtimePromise: Promise<RuntimeHandle> | null = null
const getRuntime = (): Promise<RuntimeHandle> => {
  if (runtimePromise) return runtimePromise
  runtimePromise = (async () => {
    const { Layer, ManagedRuntime } = await import("effect")
    const { Workspace } = await import("./index")
    const rt = ManagedRuntime.make(Layer.mergeAll(Workspace.Primitives.defaultLayer))
    return {
      run: (eff: unknown) => rt.runPromise(eff as never) as Promise<any>,
      fork: (eff: unknown) => {
        rt.runFork(eff as never)
      },
    }
  })()
  return runtimePromise
}

export function spawnViaVercel(cmd: string[], opts: Process.Options = {}): Process.Child {
  if (cmd.length === 0) throw new Error("Command is required")
  opts.abort?.throwIfAborted()

  const shellPath = remapShell(opts.shell)
  const spawnCmd = shellPath ?? cmd[0]
  const spawnArgs = shellPath ? ["-c", cmd.join(" ")] : cmd.slice(1)
  const cwd = typeof opts.cwd === "string" ? opts.cwd : undefined
  const env = buildEnv(opts.env)

  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()

  let exitCode: number | null = null
  let signalCode: string | null = null
  let pid: number | undefined
  const killerBox: { current: (() => void) | null } = { current: null }
  let resolveExited!: (code: number) => void
  let rejectExited!: (err: unknown) => void
  const exited = new Promise<number>((resolve, reject) => {
    resolveExited = resolve
    rejectExited = reject
  })
  exited.catch(() => undefined)

  ;(async () => {
    try {
      const { Effect, Scope } = await import("effect")
      const { Workspace } = await import("./index")
      const { streamToNodeReadable, sinkToNodeWritable } = await import("./node-stream-adapters")

      const rt = await getRuntime()
      const scope = (Effect as any).runSync((Scope as any).make())
      killerBox.current = () =>
        rt.fork(
          (Scope as any).close(scope, { _tag: "Success", value: undefined }),
        )

      const handle: any = await rt.run(
        (Workspace.Primitives.Service.use as any)((ws: any) =>
          ws.execStream(spawnCmd, spawnArgs, { cwd, env }).pipe(
            (Effect as any).provideService((Scope as any).Scope, scope),
          ),
        ),
      )

      const outNode: Readable = streamToNodeReadable(handle.stdout, rt as any, scope)
      const errNode: Readable = streamToNodeReadable(handle.stderr, rt as any, scope)
      const inNode: Writable = sinkToNodeWritable(handle.stdin, rt as any, scope)

      outNode.pipe(stdout)
      errNode.pipe(stderr)
      stdin.pipe(inNode)
      outNode.on("error", (err) => stdout.destroy(err))
      errNode.on("error", (err) => stderr.destroy(err))
      inNode.on("error", (err) => stdin.destroy(err))

      const code: number | null = await rt.run(
        (Effect as any).catch((handle.exitCode as unknown), () => (Effect as any).succeed(null)),
      )
      exitCode = code ?? 0
      resolveExited(code ?? 0)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      stdout.destroy(error)
      stderr.destroy(error)
      stdin.destroy(error)
      rejectExited(error)
    }
  })()

  const childLike = {
    stdin,
    stdout,
    stderr,
    exited,
    get exitCode() {
      return exitCode
    },
    get signalCode() {
      return signalCode
    },
    get pid() {
      return pid
    },
    kill: (_signal?: any) => {
      killerBox.current && killerBox.current()
      return true
    },
  }

  if (opts.abort) {
    opts.abort.addEventListener("abort", () => killerBox.current && killerBox.current(), { once: true })
    if (opts.abort.aborted) killerBox.current && killerBox.current()
  }

  return childLike as unknown as Process.Child
}
