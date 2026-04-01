import z from "zod"
import { Log } from "@/util/log"
import { Config } from "@/config/config"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"

const log = Log.create({ service: "sandbox" })

// Default read-only paths to expose inside the sandbox
const DEFAULT_READ = ["/usr", "/lib", "/lib64", "/lib32", "/bin", "/sbin", "/etc", "/proc", "/dev", "/sys"]

export namespace Sandbox {
  export interface Interface {
    readonly isAvailable: () => boolean
    readonly isEnabled: () => Effect.Effect<boolean>
    readonly wrap: (cmd: string, cwd: string) => Effect.Effect<string>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Sandbox") {}

  export const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cfg = yield* Config.Service

      // Detect bwrap once at startup — it never changes at runtime
      const available = Boolean(Bun.which("bwrap"))
      if (!available) log.info("bwrap not found — sandbox unavailable")

      return Service.of({
        isAvailable: () => available,

        isEnabled: () =>
          Effect.gen(function* () {
            if (!available) return false
            const info = yield* cfg.get()
            return info.sandbox?.enabled ?? false
          }),

        wrap: (cmd, cwd) =>
          Effect.gen(function* () {
            if (!available) return cmd
            const info = yield* cfg.get()
            const sc = info.sandbox
            if (!sc?.enabled) return cmd

            const read = sc.read ?? DEFAULT_READ
            // Always include cwd and /tmp writable; merge with user config
            const write = sc.write ? [...new Set([...sc.write, cwd, "/tmp"])] : [cwd, "/tmp"]
            const network = sc.network ?? true

            const args: string[] = [
              "bwrap",
              "--unshare-pid",
              "--unshare-ipc",
              "--unshare-uts",
              "--unshare-cgroup",
              "--proc",
              "/proc",
              "--dev",
              "/dev",
            ]

            if (!network) args.push("--unshare-net")

            for (const p of read) args.push("--ro-bind-try", p, p)
            for (const p of write) args.push("--bind-try", p, p)

            args.push("--chdir", cwd)
            args.push("--")
            args.push("sh", "-c", cmd)

            log.info("sandbox wrap", { cwd, read, write, network })
            return args.join(" ")
          }),
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

  const { runPromise, runSync } = makeRuntime(Service, defaultLayer)

  /** Returns true if bwrap is installed on this machine. */
  export const isAvailable = () => runSync((s) => Effect.succeed(s.isAvailable()))

  /** Returns true if bwrap is installed AND the config has sandbox.enabled=true. */
  export const isEnabled = () => runPromise((s) => s.isEnabled())

  /** Wraps a shell command string in a bwrap invocation. Returns cmd unchanged when sandbox is off. */
  export const wrap = (cmd: string, cwd: string) => runPromise((s) => s.wrap(cmd, cwd))
}
