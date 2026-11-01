import { createHash } from "node:crypto"
import path from "path"
import { Context, Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { which } from "../util/which.js"

export namespace RipgrepBinary {
  export const VERSION = "15.2.0"
  // SHA-256 of each release asset, from the `<asset>.sha256` files published with ripgrep 15.2.0. Release assets
  // can be replaced after publication, so a download is only written and run when it matches the pinned hash.
  // Linux uses the statically linked musl builds, which run on both glibc and musl (Alpine) systems.
  const PLATFORM = {
    "arm64-darwin": {
      platform: "aarch64-apple-darwin",
      extension: "tar.gz",
      sha256: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
    },
    "arm64-linux": {
      platform: "aarch64-unknown-linux-musl",
      extension: "tar.gz",
      sha256: "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915",
    },
    "x64-darwin": {
      platform: "x86_64-apple-darwin",
      extension: "tar.gz",
      sha256: "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1",
    },
    "x64-linux": {
      platform: "x86_64-unknown-linux-musl",
      extension: "tar.gz",
      sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c",
    },
    "arm64-win32": {
      platform: "aarch64-pc-windows-msvc",
      extension: "zip",
      sha256: "e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f",
    },
    "ia32-win32": {
      platform: "i686-pc-windows-msvc",
      extension: "zip",
      sha256: "9bf73bdb3fda9ad4b0235e1295b02c717031c986afa4d7c05dd0af8b74010a95",
    },
    "x64-win32": {
      platform: "x86_64-pc-windows-msvc",
      extension: "zip",
      sha256: "71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5",
    },
  } as const

  interface Interface {
    readonly filepath: Effect.Effect<string, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/RipgrepBinary") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const spawner = yield* ChildProcessSpawner
      const global = yield* Global.Service

      const run = Effect.fnUntraced(function* (command: string, args: string[], cwd: string) {
        const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd, extendEnv: true, stdin: "ignore" }))
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

      const install = Effect.fnUntraced(function* (
        bytes: Uint8Array,
        filename: string,
        config: (typeof PLATFORM)[keyof typeof PLATFORM],
        target: string,
      ) {
        // Everything is staged in a temp dir inside global.bin, so the final rename stays on one filesystem.
        const dir = yield* fs.makeTempDirectoryScoped({ directory: global.bin, prefix: "ripgrep-" })
        const archive = path.join(dir, filename)
        yield* fs.writeWithDirs(archive, bytes)

        // Windows zips go through the bsdtar in System32 (Windows 10 1803+), not PowerShell, which policy can block.
        // Git's GNU tar can come first on PATH and cannot read zip, so the system copy is called by path. bsdtar
        // decodes its arguments in the ANSI code page, so it runs inside the temp dir and only sees the ASCII
        // archive name: a profile path such as C:\Users\用户 would otherwise reach it as C:\Users\??.
        const result = yield* config.extension === "zip"
          ? run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", filename], dir)
          : run("tar", ["-xzf", archive, "-C", dir], dir)
        if (result.code !== 0)
          throw new Error(
            result.stderr.trim() || result.stdout.trim() || `ripgrep extraction failed with code ${result.code}`,
          )

        const extracted = path.join(
          dir,
          `ripgrep-${VERSION}-${config.platform}`,
          process.platform === "win32" ? "rg.exe" : "rg",
        )
        if (!(yield* fs.isFile(extracted))) throw new Error(`ripgrep archive did not contain executable: ${extracted}`)
        if (process.platform !== "win32") yield* fs.chmod(extracted, 0o755)

        // The target only ever appears through this rename, so an interrupted install never leaves a truncated binary
        // that later runs would trust. If another process won the race (Windows refuses to replace a running .exe),
        // its copy is the same verified build.
        yield* fs
          .rename(extracted, target)
          .pipe(
            Effect.catch((error) =>
              fs.isFile(target).pipe(Effect.flatMap((exists) => (exists ? Effect.void : Effect.fail(error)))),
            ),
          )
      }, Effect.scoped)

      return Service.of({
        filepath: yield* Effect.cached(
          Effect.gen(function* () {
            const system = yield* Effect.sync(() => which(process.platform === "win32" ? "rg.exe" : "rg"))
            if (system && (yield* fs.isFile(system).pipe(Effect.orDie))) return system

            // The managed copy is named by version so a version bump installs fresh instead of reusing an older build.
            const target = path.join(global.bin, `rg-${VERSION}${process.platform === "win32" ? ".exe" : ""}`)
            if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

            const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
            const config = PLATFORM[platformKey]
            if (!config) throw new Error(`unsupported platform for ripgrep: ${platformKey}`)

            const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
            const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`

            yield* Effect.logInfo("downloading ripgrep", { url })
            yield* fs.ensureDir(global.bin).pipe(Effect.orDie)
            const bytes = yield* HttpClientRequest.get(url).pipe(
              http.execute,
              Effect.flatMap((response) => response.arrayBuffer),
              Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
            )
            if (bytes.byteLength === 0) throw new Error(`failed to download ripgrep from ${url}`)
            verify(new Uint8Array(bytes), filename, config.sha256)

            yield* install(new Uint8Array(bytes), filename, config, target)
            return target
          }),
        ),
      })
    }),
  )

  export function verify(bytes: Uint8Array, filename: string, expected: string) {
    const actual = createHash("sha256").update(bytes).digest("hex")
    if (actual !== expected)
      throw new Error(`ripgrep download ${filename} failed SHA-256 verification: expected ${expected}, got ${actual}`)
  }

  export const node = makeGlobalNode({
    service: Service,
    layer: layer,
    deps: [FSUtil.node, Global.node, httpClient, CrossSpawnSpawner.node],
  })
}
