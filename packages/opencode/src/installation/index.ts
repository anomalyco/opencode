import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer, Schema, Context, Stream } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { errorMessage } from "@/util/error"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/core/process"
import path from "path"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { NpmConfig } from "@opencode-ai/core/npm-config"
import { InstallationEvent } from "@opencode-ai/schema/installation-event"

export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export const Event = InstallationEvent

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `opencode/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

// OpenCode 1 only updates within its own major version. OpenCode 2 is offered separately through
// upgradeMajor, so package sources that already publish 2.x (such as Homebrew Core) must not be
// reported as a normal update.
export function isUpdate(current: string, latest: string) {
  if (!semver.valid(latest)) return false
  if (!semver.valid(current)) return semver.major(latest) === 1
  return semver.major(latest) === semver.major(current) && semver.gt(latest, current)
}

// Every install method discovers OpenCode 1 releases from npm. opencode-ai only contains OpenCode 1;
// OpenCode 2 ships as @opencode/cli. Preview builds follow their own dist-tag, source builds follow latest.
const NPM_TAG = InstallationChannel === "local" ? "latest" : InstallationChannel

// Response schemas for external version APIs
const NpmPackage = Schema.Struct({ version: Schema.String })
const BrewInfoV2 = Schema.Struct({
  formulae: Schema.Array(Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })),
})
const ChocoPackage = Schema.Struct({
  d: Schema.Struct({ results: Schema.Array(Schema.Struct({ Version: Schema.String })) }),
})

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
  readonly upgradeMajor: (method: Method) => Effect.Effect<void, UpgradeFailedError>
}

// OpenCode 2 ships under different package names but the same `opencode` binary, so package
// manager installs remove V1 first and restore it if the V2 install fails.
const MAJOR_INSTALL: Partial<Record<Method, { remove: string[]; install: string[]; restore: string[] }>> = {
  npm: {
    remove: ["npm", "uninstall", "-g", "opencode-ai"],
    install: ["npm", "install", "-g", "@opencode/cli"],
    restore: ["npm", "install", "-g", `opencode-ai@${InstallationVersion}`],
  },
  pnpm: {
    remove: ["pnpm", "remove", "-g", "opencode-ai"],
    install: ["pnpm", "add", "-g", "--allow-build=@opencode/cli", "@opencode/cli"],
    restore: ["pnpm", "add", "-g", `opencode-ai@${InstallationVersion}`],
  },
  bun: {
    remove: ["bun", "remove", "-g", "opencode-ai"],
    install: ["bun", "install", "-g", "--trust", "@opencode/cli"],
    restore: ["bun", "install", "-g", `opencode-ai@${InstallationVersion}`],
  },
  yarn: {
    remove: ["yarn", "global", "remove", "opencode-ai"],
    install: ["yarn", "global", "add", "@opencode/cli"],
    restore: ["yarn", "global", "add", `opencode-ai@${InstallationVersion}`],
  },
}

export const MAJOR_INSTRUCTIONS = "https://opencode.ai/v2/docs"

export class Service extends Context.Service<Service, Interface>()("@opencode/Installation") {}

export const use = serviceUse(Service)

const layer: Layer.Layer<Service, never, HttpClient.HttpClient | AppProcess.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
    const appProcess = yield* AppProcess.Service

    const text = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return result.stdout.toString("utf8")
      },
      Effect.catch(() => Effect.succeed("")),
    )

    const run = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      },
      Effect.catch((err) => Effect.succeed({ code: 1, stdout: "", stderr: errorMessage(err) })),
    )

    const getBrewFormula = Effect.fnUntraced(function* () {
      const tapFormula = yield* text(["brew", "list", "--formula", "anomalyco/tap/opencode"])
      if (tapFormula.includes("opencode")) return "anomalyco/tap/opencode"
      const coreFormula = yield* text(["brew", "list", "--formula", "opencode"])
      if (coreFormula.includes("opencode")) return "opencode"
      return "opencode"
    })

    const upgradeFailure = (method: Method, result?: { code: number; stdout: string; stderr: string }) => {
      if (method === "choco") return "not running from an elevated command shell"
      if (result) return `Upgrade failed for ${method} (exit code ${result.code}).`
      return `Upgrade failed for ${method}.`
    }

    const upgradeScriptShell = Effect.fnUntraced(function* () {
      const bashVersion = yield* text(["bash", "--version"])
      if (bashVersion) return "bash"
      return "sh"
    })

    const upgradeCurl = Effect.fnUntraced(
      function* (target: string) {
        const response = yield* httpOk.execute(HttpClientRequest.get("https://opencode.ai/install"))
        const body = yield* response.text
        const bodyBytes = new TextEncoder().encode(body)
        const shell = yield* upgradeScriptShell()
        const result = yield* appProcess.run(
          ChildProcess.make(shell, [], {
            stdin: Stream.make(bodyBytes),
            env: { VERSION: target },
            extendEnv: true,
          }),
        )
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      },
      Effect.mapError(() => new UpgradeFailedError({ stderr: upgradeFailure("curl") })),
    )

    const majorUpgrade = Effect.fnUntraced(function* (m: Method) {
      if (m === "curl") {
        // The V2 installer writes to the same ~/.opencode/bin/opencode path, replacing V1 in place.
        const response = yield* httpOk
          .execute(HttpClientRequest.get("https://opencode.ai/v2/install"))
          .pipe(Effect.mapError(() => new UpgradeFailedError({ stderr: upgradeFailure("curl") })))
        const body = yield* response.text.pipe(
          Effect.mapError(() => new UpgradeFailedError({ stderr: upgradeFailure("curl") })),
        )
        return yield* run([yield* upgradeScriptShell(), "-c", body])
      }

      if (m === "brew") {
        const formula = yield* getBrewFormula()
        const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
        const removed = yield* run(["brew", "uninstall", formula], { env })
        if (removed.code !== 0) return removed
        const installed = yield* run(["brew", "install", "anomalyco/tap/opencode-v2"], { env })
        if (installed.code !== 0) yield* run(["brew", "install", formula], { env })
        return installed
      }

      const steps = MAJOR_INSTALL[m]
      if (!steps)
        return yield* new UpgradeFailedError({
          stderr: `OpenCode 2 can't be installed automatically with ${m}. See ${MAJOR_INSTRUCTIONS}`,
        })
      const removed = yield* run(steps.remove)
      if (removed.code !== 0) return removed
      const installed = yield* run(steps.install)
      if (installed.code !== 0) yield* run(steps.restore)
      return installed
    })

    const npmLatest = Effect.fnUntraced(function* () {
      const response = yield* httpOk.execute(
        HttpClientRequest.get(`${yield* NpmConfig.registry(process.cwd())}/opencode-ai/${NPM_TAG}`).pipe(
          HttpClientRequest.acceptJson,
        ),
      )
      const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
      return data.version
    })

    // Chocolatey can only install versions its moderated community feed has published.
    const chocoHas = Effect.fnUntraced(function* (version: string) {
      const response = yield* httpOk.execute(
        HttpClientRequest.get(
          `https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27opencode%27%20and%20Version%20eq%20%27${encodeURIComponent(version)}%27&$select=Version`,
        ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json;odata=verbose" })),
      )
      const data = yield* HttpClientResponse.schemaBodyJson(ChocoPackage)(response)
      return data.d.results.length > 0
    })

    const tapVersion = Effect.fnUntraced(
      function* (formula: string) {
        const infoJson = yield* text(["brew", "info", "--json=v2", formula])
        const info = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BrewInfoV2))(infoJson)
        return info.formulae[0].versions.stable
      },
      Effect.orElseSucceed(() => undefined),
    )

    const result: Interface = {
      info: Effect.fn("Installation.info")(function* () {
        return {
          version: InstallationVersion,
          latest: yield* result.latest(),
        }
      }),
      method: Effect.fn("Installation.method")(function* () {
        if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl" as Method
        if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
        const exec = process.execPath.toLowerCase()

        const checks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
          { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
          { name: "yarn", command: () => text(["yarn", "global", "list"]) },
          { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
          { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
          { name: "brew", command: () => text(["brew", "list", "--formula", "opencode"]) },
          { name: "scoop", command: () => text(["scoop", "list", "opencode"]) },
          { name: "choco", command: () => text(["choco", "list", "--limit-output", "opencode"]) },
        ]

        checks.sort((a, b) => {
          const aMatches = exec.includes(a.name)
          const bMatches = exec.includes(b.name)
          if (aMatches && !bMatches) return -1
          if (!aMatches && bMatches) return 1
          return 0
        })

        for (const check of checks) {
          const output = yield* check.command()
          const installedName =
            check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "opencode" : "opencode-ai"
          if (output.includes(installedName)) {
            return check.name
          }
        }

        return "unknown" as Method
      }),
      // Reports the installed version when there's no OpenCode 1 update this install method can deliver,
      // so callers offer OpenCode 2 through the major upgrade instead.
      latest: Effect.fn("Installation.latest")(function* (installMethod?: Method) {
        const method = installMethod || (yield* result.method())
        // Homebrew Core's opencode formula is OpenCode 2, so `brew upgrade` can't deliver an OpenCode 1 update.
        if (method === "brew" && !(yield* getBrewFormula()).includes("/")) return InstallationVersion
        return yield* Effect.gen(function* () {
          const found = yield* npmLatest()
          if (!isUpdate(InstallationVersion, found)) return InstallationVersion
          if (method === "choco" && !(yield* chocoHas(found))) return InstallationVersion
          return found
        }).pipe(Effect.timeout("10 seconds"))
      }, Effect.orDie),
      upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
        if (semver.valid(target) && semver.major(target) >= 2)
          return yield* new UpgradeFailedError({
            stderr: `OpenCode ${target} is OpenCode 2. Upgrade with \`opencode upgrade --major\` or see ${MAJOR_INSTRUCTIONS}`,
          })
        let upgradeResult: { code: number; stdout: string; stderr: string } | undefined
        switch (m) {
          case "curl":
            upgradeResult = yield* upgradeCurl(target)
            break
          case "npm":
            upgradeResult = yield* run(["npm", "install", "-g", `opencode-ai@${target}`])
            break
          case "pnpm":
            upgradeResult = yield* run(["pnpm", "install", "-g", `opencode-ai@${target}`])
            break
          case "bun":
            upgradeResult = yield* run(["bun", "install", "-g", `opencode-ai@${target}`])
            break
          case "yarn":
            upgradeResult = yield* run(["yarn", "global", "add", `opencode-ai@${target}`])
            break
          case "brew": {
            const formula = yield* getBrewFormula()
            const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
            if (!formula.includes("/"))
              return yield* new UpgradeFailedError({
                stderr: `Homebrew Core's opencode formula is OpenCode 2, so Homebrew can't install OpenCode ${target}. Upgrade with \`opencode upgrade --major\`, or reinstall from anomalyco/tap/opencode to stay on OpenCode 1.`,
              })
            const tap = yield* run(["brew", "tap", "anomalyco/tap"], { env })
            if (tap.code !== 0) {
              upgradeResult = tap
              break
            }
            const repo = yield* text(["brew", "--repo", "anomalyco/tap"])
            const dir = repo.trim()
            if (dir) {
              const pull = yield* run(["git", "pull", "--ff-only"], { cwd: dir, env })
              if (pull.code !== 0) {
                upgradeResult = pull
                break
              }
            }
            // The tap is updated shortly after npm, so a just-published release may not be installable yet.
            const available = yield* tapVersion(formula)
            if (!available || semver.major(available) !== semver.major(target) || semver.lt(available, target))
              return yield* new UpgradeFailedError({
                stderr: `Homebrew can't install OpenCode ${target} yet: ${formula} is at ${available ?? "an unknown version"}. Try again in a few minutes.`,
              })
            upgradeResult = yield* run(["brew", "upgrade", formula], { env })
            break
          }
          case "choco":
            upgradeResult = yield* run(["choco", "upgrade", "opencode", `--version=${target}`, "-y"])
            break
          case "scoop":
            upgradeResult = yield* run(["scoop", "install", `opencode@${target}`])
            break
          default:
            return yield* new UpgradeFailedError({ stderr: `Unknown installation method: ${m}` })
        }
        if (!upgradeResult || upgradeResult.code !== 0) {
          return yield* new UpgradeFailedError({ stderr: upgradeFailure(m, upgradeResult) })
        }
        yield* Effect.logInfo("upgraded", {
          method: m,
          target,
          stdout: upgradeResult.stdout,
          stderr: upgradeResult.stderr,
        })
        yield* text([process.execPath, "--version"])
      }),
      upgradeMajor: Effect.fn("Installation.upgradeMajor")(function* (m: Method) {
        const outcome = yield* majorUpgrade(m)
        if (outcome.code !== 0) return yield* new UpgradeFailedError({ stderr: upgradeFailure(m, outcome) })
        yield* Effect.logInfo("upgraded major", { method: m, stdout: outcome.stdout, stderr: outcome.stderr })
      }),
    }

    return Service.of(result)
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [httpClient, AppProcess.node] })

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((s) => s.latest(...args))
export const method = () => runPromise((s) => s.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((s) => s.upgrade(...args))
export const upgradeMajor = (...args: Parameters<Interface["upgradeMajor"]>) =>
  runPromise((s) => s.upgradeMajor(...args))

export * as Installation from "."
