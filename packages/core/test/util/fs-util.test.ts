import path from "path"
import { describe, expect } from "bun:test"
import { Effect, FileSystem, Layer, PlatformError } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const failure = (tag: "PermissionDenied" | "Unknown", code: string, method: string, path: string) =>
  PlatformError.systemError({
    _tag: tag,
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    cause: Object.assign(new Error(code), { code }),
  })

const denied = (tag: "PermissionDenied" | "Unknown", code: string) =>
  FSUtil.layer.pipe(
    Layer.provide(
      FileSystem.layerNoop({
        realPath: (path) => Effect.fail(failure(tag, code, "realPath", path)),
        readFileString: (path) => Effect.fail(failure(tag, code, "readFile", path)),
      }),
    ),
  )

describe("FSUtil", () => {
  for (const input of [
    { tag: "PermissionDenied", code: "EACCES" },
    // macOS sandbox and privacy denials arrive as Unknown with an EPERM cause.
    { tag: "Unknown", code: "EPERM" },
  ] as const) {
    it.effect(`treats ${input.code} as an unresolvable, unreadable path`, () =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        expect(yield* fs.resolve("/denied/.agents")).toBe(path.resolve("/denied/.agents"))
        expect(yield* fs.readFileStringSafe("/denied/AGENTS.md")).toBeUndefined()
      }).pipe(Effect.provide(denied(input.tag, input.code))),
    )
  }

  it.effect("keeps other realPath failures fatal", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const exit = yield* fs.resolve("/broken").pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }).pipe(Effect.provide(denied("Unknown", "EIO"))),
  )
})
