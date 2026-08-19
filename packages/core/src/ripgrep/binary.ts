import path from "path"
import { Context, Effect, Layer, Option, Ref, Semaphore, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "../cross-spawn-spawner"
import { makeGlobalNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { which } from "../util/which"

export namespace RipgrepBinary {
  const VERSION = "15.1.0"
  const PLATFORM = {
    "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
    "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
    "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
    "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
    "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
    "ia32-win32": { platform: "i686-pc-windows-msvc", extension: "zip" },
    "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
  } as const

  interface Interface {
    readonly filepath: Effect.Effect<string, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/RipgrepBinary") {}

  // Unlike Effect.cached, only successful results are memoized: a failed resolution
  // must be retried on the next call in the same process.
  export const memoizeSuccess = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const resolved = yield* Ref.make(Option.none<A>())
      const singleFlight = Semaphore.makeUnsafe(1).withPermit
      return singleFlight(
        Effect.gen(function* () {
          const hit = yield* Ref.get(resolved)
          if (Option.isSome(hit)) return hit.value
          const value = yield* effect
          yield* Ref.set(resolved, Option.some(value))
          return value
        }),
      )
    })

  // Windows PowerShell 5.1 inherits PSModulePath from the launching process. When opencode
  // is started from the MSIX (Microsoft Store) build of PowerShell 7, that variable points at
  // the Core-edition modules first, so Expand-Archive autoload fails inside the 5.1 child.
  // Pinning the child to the inbox 5.1 module directory avoids the polluted lookup.
  export const windowsPowerShell5ModulePath = (systemRoot: string | undefined = process.env.SystemRoot) =>
    path.join(systemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules")

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const spawner = yield* ChildProcessSpawner

      const run = Effect.fnUntraced(function* (command: string, args: string[], env?: Record<string, string>) {
        const handle = yield* spawner.spawn(
          ChildProcess.make(command, args, { extendEnv: true, stdin: "ignore", env }),
        )
        const [stdout, stderr, code] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(handle.stdout)),
            Stream.mkString(Stream.decodeText(handle.stderr)),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        )
        return { stdout, stderr, code }
      }, Effect.scoped)

      const extract = Effect.fnUntraced(function* (
        archive: string,
        config: (typeof PLATFORM)[keyof typeof PLATFORM],
        target: string,
      ) {
        const dir = yield* fs.makeTempDirectoryScoped({ directory: Global.Path.bin, prefix: "ripgrep-" })

        if (config.extension === "zip") {
          const shell = (yield* Effect.sync(() => which("powershell.exe") ?? which("pwsh.exe"))) ?? "powershell.exe"
          const env =
            path.basename(shell).toLowerCase() === "powershell.exe"
              ? { PSModulePath: windowsPowerShell5ModulePath() }
              : undefined
          const result = yield* run(
            shell,
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${dir.replaceAll("'", "''")}' -Force`,
            ],
            env,
          )
          if (result.code !== 0)
            throw new Error(
              result.stderr.trim() || result.stdout.trim() || `ripgrep extraction failed with code ${result.code}`,
            )
        }

        if (config.extension === "tar.gz") {
          const result = yield* run("tar", ["-xzf", archive, "-C", dir])
          if (result.code !== 0)
            throw new Error(
              result.stderr.trim() || result.stdout.trim() || `ripgrep extraction failed with code ${result.code}`,
            )
        }

        const extracted = path.join(
          dir,
          `ripgrep-${VERSION}-${config.platform}`,
          process.platform === "win32" ? "rg.exe" : "rg",
        )
        if (!(yield* fs.isFile(extracted))) throw new Error(`ripgrep archive did not contain executable: ${extracted}`)

        yield* fs.copyFile(extracted, target)
        if (process.platform !== "win32") yield* fs.chmod(target, 0o755)
      }, Effect.scoped)

      const resolve = Effect.gen(function* () {
        const system = yield* Effect.sync(() => which(process.platform === "win32" ? "rg.exe" : "rg"))
        if (system && (yield* fs.isFile(system).pipe(Effect.orDie))) return system

        const target = path.join(Global.Path.bin, `rg${process.platform === "win32" ? ".exe" : ""}`)
        if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

        const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
        const config = PLATFORM[platformKey]
        if (!config) throw new Error(`unsupported platform for ripgrep: ${platformKey}`)

        const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
        const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`
        const archive = path.join(Global.Path.bin, filename)

        yield* Effect.logInfo("downloading ripgrep", { url })
        yield* fs.ensureDir(Global.Path.bin).pipe(Effect.orDie)
        const bytes = yield* HttpClientRequest.get(url).pipe(
          http.execute,
          Effect.flatMap((response) => response.arrayBuffer),
          Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
        )
        if (bytes.byteLength === 0) throw new Error(`failed to download ripgrep from ${url}`)

        yield* fs.writeWithDirs(archive, new Uint8Array(bytes))
        yield* extract(archive, config, target)
        yield* fs.remove(archive, { force: true }).pipe(Effect.ignore)
        return target
      })

      const filepath = yield* memoizeSuccess(resolve)

      return Service.of({ filepath })
    }),
  )

  export const node = makeGlobalNode({
    service: Service,
    layer: layer,
    deps: [FSUtil.node, httpClient, CrossSpawnSpawner.node],
  })
}
