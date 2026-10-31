import { NodeServices } from "@effect/platform-node"
import { expect } from "bun:test"
import { Effect, FileSystem, PlatformError } from "effect"
import { realpathSync, statSync } from "node:fs"
import path from "node:path"
import { RetainedImage } from "../src/services/retained-image"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)
// Hard links to a running image are a Windows concern, and /tmp is often another filesystem elsewhere.
const windows = process.platform === "win32" ? it.live : it.live.skip

windows("retain hard-links the running image for the scope and sweeps only links of exited processes", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-retained-" })
    // pid 999999999 does not exist; pid 4 is System, alive but not openable (EPERM).
    const kept = ["opencode-service-4-aa.exe", `opencode-service-${process.pid}-bb.exe`, "unrelated.exe"]
    yield* Effect.forEach([...kept, "opencode-upgrade-999999999-cc.exe"], (name) =>
      fs.writeFileString(path.join(directory, name), name),
    )
    const image = statSync(realpathSync(process.execPath))
    yield* Effect.scoped(
      Effect.gen(function* () {
        const link = yield* RetainedImage.retain(directory, "upgrade")
        if (!link) return yield* Effect.die("Expected a link")
        expect(path.basename(link)).toMatch(new RegExp(`^opencode-upgrade-${process.pid}-[0-9a-f]{8}\\.exe$`))
        expect(statSync(link).ino).toBe(image.ino)
        expect(statSync(link).nlink).toBe(image.nlink + 1)
        expect((yield* fs.readDirectory(directory)).sort()).toEqual([...kept, path.basename(link)].sort())
      }),
    )
    // The running test process does not lock the image's other links, so the release removes it.
    expect((yield* fs.readDirectory(directory)).sort()).toEqual(kept.sort())
  }),
)

windows("retain tolerates a directory it cannot link into", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-retained-" })
    const file = path.join(root, "not-a-directory")
    yield* fs.writeFileString(file, "")
    expect(yield* Effect.scoped(RetainedImage.retain(file, "service"))).toBeUndefined()
  }),
)

windows("relocate moves only retained links out of a directory", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-retained-" })
    const cache = path.join(root, "cache")
    const tmp = path.join(root, "tmp")
    yield* fs.makeDirectory(cache)
    yield* fs.writeFileString(path.join(cache, "opencode-upgrade-1-ab.exe"), "link")
    yield* fs.writeFileString(path.join(cache, "models.json"), "{}")
    yield* RetainedImage.relocate(cache, tmp)
    expect(yield* fs.readDirectory(cache)).toEqual(["models.json"])
    expect(yield* fs.readDirectory(tmp)).toEqual(["opencode-upgrade-1-ab.exe"])
  }),
)

windows("installed accepts package-manager and curl binaries only", () =>
  Effect.gen(function* () {
    const home = path.join("C:", "Users", "someone")
    const original = process.execPath
    yield* Effect.addFinalizer(() => Effect.sync(() => (process.execPath = original)))
    const cases = [
      [path.join(home, ".bun", "install", "global", "node_modules", "@opencode", "cli", "bin", "opencode.exe"), true],
      [path.join(home, ".opencode", "bin", "opencode.exe"), true],
      [
        path.join(
          home,
          "AppData",
          "Local",
          "Microsoft",
          "WinGet",
          "Packages",
          "Anomaly.OpenCode_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "opencode.exe",
        ),
        true,
      ],
      [path.join(home, "AppData", "Local", "Programs", "OpenCode", "resources", "opencode-cli.exe"), false],
      [path.join(home, "node_modules", "bun", "bin", "bun.exe"), false],
    ] as const
    const results = cases.map(([executable]) => {
      process.execPath = executable
      return RetainedImage.installed(home)
    })
    expect(results).toEqual(cases.map(([, expected]) => expected))
  }),
)

// A second physical volume is not available on every Windows runner. Only inject EXDEV;
// the fallback still creates a real hard link and uses the real cleanup implementation.
const packageImage = (nested = false) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-package-image-" })
    const owner = path.join(root, "node_modules", "@opencode", "cli")
    const executable = nested
      ? path.join(owner, "node_modules", "@opencode", "cli-windows-x64", "bin", "opencode.exe")
      : path.join(owner, "bin", "opencode.exe")
    const cache = path.join(root, "cache")
    yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
    yield* fs.writeFileString(executable, "running image")
    return {
      root,
      executable,
      cache,
      fs,
      filesystem: {
        ...fs,
        realPath: (input: string) => fs.realPath(input === process.execPath ? executable : input),
        link: (source: string, target: string) =>
          target.startsWith(cache + path.sep)
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "Unknown",
                  module: "FileSystem",
                  method: "link",
                  cause: Object.assign(new Error("cross-device link"), { code: "EXDEV" }),
                }),
              )
            : fs.link(source, target),
      },
    }
  })

;[false, true].forEach((nested) => {
  windows(`retain keeps a cross-volume package image outside the entire install tree: nested=${nested}`, () =>
    Effect.gen(function* () {
      const test = yield* packageImage(nested)
      const retained = path.join(test.root, ".opencode", "retained-images")
      yield* test.fs.makeDirectory(retained, { recursive: true })
      yield* test.fs.writeFileString(path.join(retained, "opencode-service-999999999-aa.exe"), "stale")
      yield* test.fs.writeFileString(path.join(retained, "unrelated.txt"), "keep")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const link = yield* RetainedImage.retain(test.cache, "service")
          if (!link) return yield* Effect.die("Expected a same-volume fallback link")
          expect(path.dirname(link)).toBe(retained)
          expect(statSync(link).ino).toBe(statSync(test.executable).ino)
          expect(statSync(link).nlink).toBe(2)
          yield* test.fs.remove(path.join(test.root, "node_modules"), { recursive: true })
          expect(yield* test.fs.readFileString(link)).toBe("running image")
          expect((yield* test.fs.readDirectory(retained)).sort()).toEqual([path.basename(link), "unrelated.txt"].sort())
        }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, test.filesystem))
      expect(yield* test.fs.readDirectory(retained)).toEqual(["unrelated.txt"])
    }),
  )
})

windows("retain still permits service startup when both cross-volume and fallback retention fail", () =>
  Effect.gen(function* () {
    const test = yield* packageImage()
    yield* test.fs.writeFileString(path.join(test.root, ".opencode"), "not a directory")
    const link = yield* Effect.scoped(RetainedImage.retain(test.cache, "service")).pipe(
      Effect.provideService(FileSystem.FileSystem, test.filesystem),
    )
    expect(link).toBeUndefined()
    expect(yield* test.fs.readFileString(test.executable)).toBe("running image")
  }),
)

windows("retain does not create fallback storage for unrelated directory failures", () =>
  Effect.gen(function* () {
    const test = yield* packageImage()
    yield* test.fs.writeFileString(test.cache, "not a directory")
    const link = yield* Effect.scoped(RetainedImage.retain(test.cache, "service")).pipe(
      Effect.provideService(FileSystem.FileSystem, {
        ...test.filesystem,
        link: test.fs.link,
      }),
    )
    expect(link).toBeUndefined()
    expect(yield* test.fs.exists(path.join(test.root, ".opencode"))).toBe(false)
  }),
)
