import path from "path"
import { inflateRawSync } from "node:zlib"
import { Context, Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "../cross-spawn-spawner"
import { makeGlobalNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { EffectFlock } from "../util/effect-flock"
import { which } from "../util/which"

const ZIP_EOCD = 0x06054b50
const ZIP_CENTRAL_HEADER = 0x02014b50
const ZIP_LOCAL_HEADER = 0x04034b50

function extractZipEntry(archive: Uint8Array, expected: string) {
  const bytes = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength)
  const eocdStart = Math.max(0, bytes.length - 22 - 0xffff)
  let eocd = -1
  for (let cursor = bytes.length - 22; cursor >= eocdStart; cursor--) {
    if (bytes.readUInt32LE(cursor) !== ZIP_EOCD) continue
    eocd = cursor
    break
  }
  if (eocd < 0) throw new Error("ripgrep zip end-of-central-directory record not found")

  const entries = bytes.readUInt16LE(eocd + 10)
  let cursor = bytes.readUInt32LE(eocd + 16)
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_HEADER) {
      throw new Error("invalid ripgrep zip central directory")
    }

    const flags = bytes.readUInt16LE(cursor + 8)
    const method = bytes.readUInt16LE(cursor + 10)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > bytes.length) throw new Error("truncated ripgrep zip central directory")

    const name = bytes
      .toString("utf8", cursor + 46, cursor + 46 + nameLength)
      .replaceAll("\\", "/")
    if (name === expected) {
      if ((flags & 1) !== 0) throw new Error("encrypted ripgrep zip entries are not supported")
      if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== ZIP_LOCAL_HEADER) {
        throw new Error("invalid ripgrep zip local header")
      }

      const localNameLength = bytes.readUInt16LE(localOffset + 26)
      const localExtraLength = bytes.readUInt16LE(localOffset + 28)
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength
      const dataEnd = dataOffset + compressedSize
      if (dataEnd > bytes.length) throw new Error("truncated ripgrep zip entry")

      const compressed = bytes.subarray(dataOffset, dataEnd)
      const output = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : undefined
      if (!output) throw new Error(`unsupported ripgrep zip compression method: ${method}`)
      if (output.byteLength !== uncompressedSize) throw new Error("ripgrep zip entry size mismatch")
      return Uint8Array.from(output)
    }

    cursor = next
  }

  throw new Error(`ripgrep zip archive did not contain ${expected}`)
}

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

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
      const spawner = yield* ChildProcessSpawner
      const flock = yield* EffectFlock.Service

      const run = Effect.fnUntraced(function* (command: string, args: string[]) {
        const handle = yield* spawner.spawn(ChildProcess.make(command, args, { extendEnv: true, stdin: "ignore" }))
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
        if (config.extension === "zip") {
          const expected = `ripgrep-${VERSION}-${config.platform}/rg.exe`
          const binary = yield* fs.readFile(archive).pipe(
            Effect.flatMap((bytes) =>
              Effect.try({
                try: () => extractZipEntry(bytes, expected),
                catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
              }),
            ),
          )
          yield* fs.writeWithDirs(target, binary)
          return
        }

        const dir = yield* fs.makeTempDirectoryScoped({ directory: Global.Path.bin, prefix: "ripgrep-" })
        const result = yield* run("tar", ["-xzf", archive, "-C", dir])
        if (result.code !== 0)
          throw new Error(
            result.stderr.trim() || result.stdout.trim() || `ripgrep extraction failed with code ${result.code}`,
          )

        const extracted = path.join(dir, `ripgrep-${VERSION}-${config.platform}`, "rg")
        if (!(yield* fs.isFile(extracted))) throw new Error(`ripgrep archive did not contain executable: ${extracted}`)

        yield* fs.copyFile(extracted, target)
        yield* fs.chmod(target, 0o755)
      }, Effect.scoped)

      return Service.of({
        filepath: yield* Effect.cached(
          Effect.gen(function* () {
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

            return yield* flock.withLock(
              Effect.gen(function* () {
                // Different service layers can initialize concurrently in tests and
                // separate OpenCode processes can start at the same time. Recheck
                // after taking the filesystem lock so only one caller downloads and
                // extracts the shared binary.
                if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

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
                return target
              }).pipe(Effect.ensuring(fs.remove(archive, { force: true }).pipe(Effect.ignore))),
              `ripgrep-binary:${VERSION}:${platformKey}`,
            )
          }),
        ),
      })
    }),
  )

  export const node = makeGlobalNode({
    service: Service,
    layer: layer,
    deps: [FSUtil.node, httpClient, CrossSpawnSpawner.node, EffectFlock.node],
  })
}
