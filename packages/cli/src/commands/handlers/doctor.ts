import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"

export interface Result {
  name: string
  ok: boolean
  detail: string
  fix?: string
}

export function render(results: Result[]) {
  return results
    .map((result) => {
      const marker = result.ok ? UI.Style.TEXT_SUCCESS + "✓" : UI.Style.TEXT_DANGER_BOLD + "✗"
      const line = `${marker} ${UI.Style.TEXT_NORMAL}${result.name}: ${result.detail}`
      if (result.ok || !result.fix) return line
      return `${line}\n  ${UI.Style.TEXT_DIM}fix: ${result.fix}${UI.Style.TEXT_NORMAL}`
    })
    .join("\n")
}

export const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "check binary, config, credentials, gateway reachability, and disk state",
  instance: false,
  handler: Effect.fn("Cli.doctor")(function* () {
    const { InstallationVersion } = yield* Effect.promise(() => import("@bolt-ai/core/installation/version"))
    const { Installation } = yield* Effect.promise(() => import("@/installation"))
    const { Global } = yield* Effect.promise(() => import("@bolt-ai/core/global"))
    const { Flag } = yield* Effect.promise(() => import("@bolt-ai/core/flag/flag"))
    const results: Result[] = []

    // Binary: where bolt runs from and how it was installed.
    const method = yield* Effect.promise(() => Installation.method())
    results.push({
      name: "binary",
      ok: method !== "unknown",
      detail: `${InstallationVersion} via ${method} at ${process.execPath}`,
      fix: "install method not detected; upgrades need a manual reinstall (see bolt upgrade --method)",
    })

    // Config: parse the global config the way every command would.
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* Config.Service.use((cfg) => cfg.getGlobal()).pipe(
      Effect.map(() => ({ name: "config", ok: true, detail: `loaded from ${Global.Path.config}` })),
      Effect.catch((error) =>
        Effect.succeed({
          name: "config",
          ok: false,
          detail: String(error),
          fix: `check the JSON syntax of the config files under ${Global.Path.config}`,
        }),
      ),
    )
    results.push(config)

    // Credentials: stored provider auth entries.
    const { Auth } = yield* Effect.promise(() => import("@/auth"))
    const keys = Object.keys(process.env).filter((name) => name.endsWith("_API_KEY") && process.env[name])
    const credentials = yield* Auth.Service.use((auth) => auth.all()).pipe(
      Effect.map((all) => {
        const providers = Object.keys(all)
        const parts = [
          providers.length ? `${providers.length} stored: ${providers.join(", ")}` : undefined,
          keys.length ? `${keys.length} env key(s): ${keys.join(", ")}` : undefined,
        ].filter((part) => part !== undefined)
        return {
          name: "credentials",
          ok: providers.length > 0 || keys.length > 0,
          detail: parts.length ? parts.join("; ") : "none stored and no *_API_KEY in the environment",
          fix: "run `bolt providers login` (or set a provider API key in the environment)",
        }
      }),
      Effect.catch((error) =>
        Effect.succeed({
          name: "credentials",
          ok: false,
          detail: String(error),
          fix: "auth storage is unreadable; re-run `bolt providers login`",
        }),
      ),
    )
    results.push(credentials)

    // Gateway: the models catalog endpoint every prompt path depends on.
    const gateway = Flag.BOLT_MODELS_URL || "https://models.bolt.ai"
    const reachable = yield* Effect.promise(() =>
      fetch(gateway, { method: "HEAD", signal: AbortSignal.timeout(5000) })
        .then((response) => response.ok || response.status < 500)
        .catch(() => false),
    )
    results.push({
      name: "gateway",
      ok: reachable,
      detail: reachable ? `${gateway} reachable` : `${gateway} unreachable`,
      fix: "check your network connection, proxy settings, and BOLT_MODELS_URL",
    })

    // Disk: every state directory must exist and be writable.
    for (const [label, dir] of [
      ["data dir", Global.Path.data],
      ["cache dir", Global.Path.cache],
      ["config dir", Global.Path.config],
      ["state dir", Global.Path.state],
    ] as const) {
      const probe = path.join(dir, `.doctor-${process.pid}`)
      const writable = yield* Effect.promise(async () => {
        await Bun.write(probe, "ok")
        fs.rmSync(probe, { force: true })
        return true
      }).pipe(Effect.catch(() => Effect.succeed(false)))
      results.push({
        name: label,
        ok: writable,
        detail: writable ? `${dir} writable` : `${dir} not writable`,
        fix: `create the directory or fix its permissions: ${dir}`,
      })
    }

    // Log file growth is the most common disk-state surprise.
    const log = path.join(Global.Path.log, "bolt.log")
    const size = fs.existsSync(log) ? fs.statSync(log).size : 0
    results.push({
      name: "log file",
      ok: size < 100 * 1024 * 1024,
      detail: size ? `${(size / 1024 / 1024).toFixed(1)} MB at ${log}` : "no log file yet",
      fix: `log file is very large; truncate it: rm ${log}`,
    })

    UI.println(render(results))
    const failed = results.filter((result) => !result.ok)
    UI.empty()
    if (failed.length === 0) {
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "all checks passed" + UI.Style.TEXT_NORMAL)
      return
    }
    UI.println(UI.Style.TEXT_DANGER_BOLD + `${failed.length} check(s) failed` + UI.Style.TEXT_NORMAL)
    process.exitCode = 1
  }),
})
