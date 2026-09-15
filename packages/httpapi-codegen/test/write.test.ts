import { describe, expect } from "bun:test"
import { Effect, FileSystem, Option } from "effect"
import { write, type Output } from "../src"
import { it } from "./effect"

describe("HttpApiCodegen.write", () => {
  it.effect("writes compiled files beneath the output directory", () => {
    const writes: Array<{ readonly path: string; readonly content: string }> = []
    const output: Output = {
      operations: [],
      files: [{ path: "session.ts", content: "export const session = {}" }],
    }

    return Effect.gen(function* () {
      yield* write(output, "/generated")

      expect(writes).toEqual([
        { path: "/generated/session.ts", content: "export const session = {}\n" },
        { path: "/generated/.httpapi-codegen.json", content: '[\n  "session.ts"\n]\n' },
      ])
    }).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          exists: () => Effect.succeed(false),
          makeDirectory: () => Effect.void,
          writeFileString: (path, content) => {
            writes.push({ path, content })
            return Effect.void
          },
        }),
      ),
    )
  })

  it.effect("removes only stale files owned by the previous manifest", () => {
    const removed: Array<string> = []
    return write(
      {
        operations: [],
        files: [{ path: "session.ts", content: "" }],
      },
      "/generated",
    ).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          exists: (path) => Effect.succeed(path.endsWith(".httpapi-codegen.json")),
          makeDirectory: () => Effect.void,
          readFileString: () => Effect.succeed('["old.ts", "session.ts"]'),
          remove: (path) => {
            removed.push(path)
            return Effect.void
          },
          writeFileString: () => Effect.void,
        }),
      ),
      Effect.tap(() => Effect.sync(() => expect(removed).toEqual(["/generated/old.ts"]))),
    )
  })

  it.effect("rejects unsafe and duplicate output paths before writing", () => {
    const writes: Array<string> = []
    return Effect.gen(function* () {
      const error = yield* write(
        {
          operations: [],
          files: [
            { path: "../outside.ts", content: "" },
            { path: "client.ts", content: "" },
            { path: "CLIENT.ts", content: "" },
          ],
        },
        "/generated",
      ).pipe(Effect.flip)

      expect(error._tag).toBe("GenerationError")
      expect(writes).toEqual([])
    }).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          writeFileString: (path) => {
            writes.push(path)
            return Effect.void
          },
        }),
      ),
    )
  })

  it.effect("rejects case-insensitive duplicate output paths", () => {
    const writes: Array<string> = []
    return Effect.gen(function* () {
      const error = yield* write(
        {
          operations: [],
          files: [
            { path: "client.ts", content: "" },
            { path: "CLIENT.ts", content: "" },
          ],
        },
        "/generated",
      ).pipe(Effect.flip)

      expect(error._tag).toBe("GenerationError")
      expect(error.reason).toBe("Duplicate output path: CLIENT.ts")
      expect(writes).toEqual([])
    }).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          writeFileString: (path) => {
            writes.push(path)
            return Effect.void
          },
        }),
      ),
    )
  })

  it.effect("reserves the private manifest path", () =>
    write({ operations: [], files: [{ path: ".httpapi-codegen.json", content: "" }] }, "/generated").pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason).toContain("Unsafe output path"))),
      Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
    ),
  )

  it.effect("rejects existing symbolic-link output targets", () =>
    write({ operations: [], files: [{ path: "session.ts", content: "" }] }, "/generated").pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => expect(error.reason).toBe("Unsafe output path: session.ts"))),
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          exists: (path) => Effect.succeed(path.endsWith("session.ts")),
          makeDirectory: () => Effect.void,
          stat: () =>
            Effect.succeed({
              type: "SymbolicLink",
              mtime: Option.none(),
              atime: Option.none(),
              birthtime: Option.none(),
              dev: 0,
              ino: Option.none(),
              mode: 0,
              nlink: Option.none(),
              uid: Option.none(),
              gid: Option.none(),
              rdev: Option.none(),
              size: FileSystem.Size(0),
              blksize: Option.none(),
              blocks: Option.none(),
            }),
        }),
      ),
    ),
  )
})
