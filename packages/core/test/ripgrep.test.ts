import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Ripgrep } from "@opencode/core/ripgrep"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
import { RelativePath } from "@opencode/core/schema"
import { tmpdirScoped, withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { tempLocationLayer } from "./fixture/location"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Ripgrep.node, Environment.node]), [Location.node.replace(tempLocationLayer)]),
)

describe("Ripgrep", () => {
  // Creating a file symlink can require elevated privileges on Windows.
  describe.skipIf(process.platform === "win32")("partial results", () => {
    it.live("keeps matching files when an ignore glob is malformed and a symlink is broken", () =>
      withTempDir((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => Bun.write(path.join(tmp.path, "visible.ts"), "needle\n"))
          yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".ignore"), "[z-a]\n"))
          yield* Effect.promise(() => fs.symlink("missing", path.join(tmp.path, "broken")))
          const environment = yield* Environment.Service
          const ripgrep = yield* Ripgrep.Service
          const files = yield* ripgrep.glob({ environment, cwd: tmp.path, pattern: "*.ts", follow: true, limit: 10 })
          expect(files.map((file) => file.path)).toEqual([RelativePath.make("visible.ts")])
        }),
      ),
    )
  })

  for (const hidden of [undefined, false, true]) {
    for (const limit of hidden ? [10] : [1]) {
      it.live(`glob honors hidden=${hidden} before limit=${limit}`, () =>
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          yield* Effect.promise(() =>
            Promise.all(
              ["src/visible.ts", ".hidden.ts", "src/.hidden.ts", ".hidden/nested.ts", ".git/config.ts"].map((file) =>
                Bun.write(path.join(tmp.path, file), "needle\n"),
              ),
            ),
          )
          const environment = yield* Environment.Service
          const ripgrep = yield* Ripgrep.Service
          const files = yield* ripgrep.glob({
            environment,
            cwd: tmp.path,
            pattern: "**/*.ts",
            limit,
            ...(hidden === undefined ? {} : { hidden }),
          })

          expect(files.map((item) => item.path).sort()).toEqual(
            (hidden ? [".hidden.ts", ".hidden/nested.ts", "src/.hidden.ts", "src/visible.ts"] : ["src/visible.ts"]).map(
              (file) => RelativePath.make(file),
            ),
          )
        }),
      )
    }
  }

  it.live("greps files with include filtering", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "match.ts"), "needle\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "skip.txt"), "needle\n"))

        const environment = yield* Environment.Service
        const ripgrep = yield* Ripgrep.Service
        const result = yield* ripgrep.grep({
          environment,
          cwd: tmp.path,
          pattern: "needle",
          include: "*.ts",
          limit: 10,
        })
        expect(result).toHaveLength(1)
        expect(result[0]?.entry.path).toBe(RelativePath.make("src/match.ts"))
        expect(result[0]?.submatches[0]?.text).toBe("needle")
      }),
    ),
  )

  it.live("greps lines that are not valid UTF-8", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "utf8.txt"), "needle\n"))
        yield* Effect.promise(() =>
          fs.writeFile(path.join(tmp.path, "latin1.txt"), Buffer.from("needle café\n", "latin1")),
        )

        const environment = yield* Environment.Service
        const ripgrep = yield* Ripgrep.Service
        const result = yield* ripgrep.grep({ environment, cwd: tmp.path, pattern: "needle", limit: 10 })
        expect(result.map((match) => [match.entry.path, match.text, match.submatches[0]?.text]).sort()).toEqual([
          [RelativePath.make("latin1.txt"), "needle caf\uFFFD\n", "needle"],
          [RelativePath.make("utf8.txt"), "needle\n", "needle"],
        ])
      }),
    ),
  )

  it.live("keeps ignored files out of catch-all find results", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "node_modules", "pkg"), { recursive: true }))
        yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src")))
        yield* Effect.promise(() => Bun.$`git init -q ${tmp.path}`)
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".gitignore"), "node_modules/\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "node_modules", "pkg", "index.js"), "ignored\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "index.js"), "included\n"))

        const environment = yield* Environment.Service
        const ripgrep = yield* Ripgrep.Service
        const files = yield* ripgrep.find({ environment, cwd: tmp.path, pattern: "*", limit: 10 })
        expect(files.map((item) => item.path)).toContain(RelativePath.make("src/index.js"))
        expect(files.map((item) => item.path)).not.toContain(RelativePath.make("node_modules/pkg/index.js"))
      }),
    ),
  )

  it.live("never includes git metadata", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".opencode")))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".opencode", "config"), "needle\n"))
        yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".git")))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".git", "config"), "needle\n"))
        const environment = yield* Environment.Service
        const ripgrep = yield* Ripgrep.Service

        const files = yield* ripgrep.find({ environment, cwd: tmp.path, pattern: "**/*", limit: 10 })
        expect(files.map((item) => item.path)).toContain(RelativePath.make(".opencode/config"))
        expect(files.map((item) => item.path)).not.toContain(RelativePath.make(".git/config"))

        const observed: string[] = []
        const limited = yield* ripgrep.find({
          environment,
          cwd: tmp.path,
          pattern: "**/*",
          limit: 1,
          onEntry: (entry) => Effect.sync(() => observed.push(entry.path)),
        })
        expect(observed).toEqual(limited.map((item) => item.path))

        const matches = yield* ripgrep.grep({
          environment,
          cwd: tmp.path,
          pattern: "needle",
          include: "config",
          limit: 10,
        })
        expect(matches.map((item) => item.entry.path)).toContain(RelativePath.make(".opencode/config"))
        expect(matches.map((item) => item.entry.path)).not.toContain(RelativePath.make(".git/config"))
      }),
    ),
  )

  it.live("excludes protected directory trees from catch-all find results", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "Pictures")))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "Pictures", "private.jpg"), "private\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "visible.txt"), "visible\n"))

        const environment = yield* Environment.Service
        const ripgrep = yield* Ripgrep.Service
        const files = yield* ripgrep.find({
          environment,
          cwd: tmp.path,
          pattern: "*",
          limit: 10,
          exclude: ["Pictures/**"],
        })

        expect(files.map((item) => item.path)).toContain(RelativePath.make("visible.txt"))
        expect(files.map((item) => item.path)).not.toContain(RelativePath.make("Pictures/private.jpg"))
      }),
    ),
  )

  it.live("returns a bounded preview for matches on oversized lines", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(tmp.path, "generated.ts"),
            `Cloudflare${"x".repeat(70 * 1024)}\n${"y".repeat(35 * 1024)}Cloudflare${"y".repeat(35 * 1024)}\n`,
          ),
        )

        const environment = yield* Environment.Service
        const ripgrep = yield* Ripgrep.Service
        const matches = yield* ripgrep.grep({
          environment,
          cwd: tmp.path,
          pattern: "Cloudflare",
          limit: 10,
        })

        expect(matches).toHaveLength(2)
        expect(matches[0]?.entry.path).toBe(RelativePath.make("generated.ts"))
        expect(matches[0]?.text).toBe(`Cloudflare${"x".repeat(1_990)}…`)
        expect(matches[0]?.submatches).toEqual([{ text: "Cloudflare", start: 0, end: 10 }])
        expect(matches[1]?.text).toBe(`…${"y".repeat(1_000)}Cloudflare${"y".repeat(990)}…`)
      }),
    ),
  )

  it.live("cuts oversized line previews on whole characters", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(tmp.path, "emoji.txt"),
            `${"x".repeat(1_999)}😀${"x".repeat(999)}tail${"x".repeat(2_000)}\n${"x".repeat(2_000)}tail${"x".repeat(995)}😀${"x".repeat(2_000)}\n`,
          ),
        )

        const environment = yield* Environment.Service
        const ripgrep = yield* Ripgrep.Service
        const matches = yield* ripgrep.grep({ environment, cwd: tmp.path, pattern: "tail", limit: 10 })

        expect(matches.map((match) => match.text)).toEqual([
          `…${"x".repeat(999)}tail${"x".repeat(997)}…`,
          `…${"x".repeat(1_000)}tail${"x".repeat(995)}…`,
        ])
      }),
    ),
  )
})

describe("RipgrepBinary.verify", () => {
  const bytes = new TextEncoder().encode("ripgrep archive")
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

  test("accepts a download matching the pinned hash", () => {
    expect(() => RipgrepBinary.verify(bytes, "ripgrep.tar.gz", hash)).not.toThrow()
  })

  test("refuses a download whose hash does not match", () => {
    expect(() => RipgrepBinary.verify(bytes, "ripgrep.tar.gz", "0".repeat(64))).toThrow(
      "ripgrep download ripgrep.tar.gz failed SHA-256 verification",
    )
  })
})
