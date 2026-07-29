import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Npm } from "@opencode-ai/util/npm"
import { Config } from "../src/config"
import { Formatter } from "../src/formatter"
import { Location } from "../src/location"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
type ConfigInput = typeof Config.Info.Encoded

function formatterLayer(directory: string, configured?: ConfigInput["formatter"]) {
  const entries =
    configured === undefined
      ? []
      : [
          new Config.Document({
            type: "document",
            info: Schema.decodeUnknownSync(Config.Info)({ formatter: configured }),
          }),
        ]
  return AppNodeBuilder.build(Formatter.node, [
    [
      Config.node,
      Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.succeed(entries),
          changes: () => Stream.empty,
        }),
      ),
    ],
    [
      Location.node,
      Layer.succeed(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
      ),
    ],
    [Npm.node, Layer.mock(Npm.Service, { which: () => Effect.succeed(undefined) })],
  ])
}

function withTemp<A, E, R>(body: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => body(tmp.path),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )
}

describe("Formatter", () => {
  it.live("status() returns empty list when no formatters are configured", () =>
    withTemp((directory) =>
      Formatter.Service.use((formatter) => formatter.status()).pipe(Effect.provide(formatterLayer(directory))),
    ),
  )

  it.live("status() returns built-in formatters when formatter is true", () =>
    withTemp((directory) =>
      Formatter.Service.use((formatter) =>
        Effect.gen(function* () {
          const statuses = yield* formatter.status()
          const gofmt = statuses.find((item) => item.name === "gofmt")
          expect(gofmt).toBeDefined()
          expect(gofmt?.extensions).toContain(".go")
        }),
      ).pipe(Effect.provide(formatterLayer(directory, true))),
    ),
  )

  it.live("status() keeps built-in formatters when config object is provided", () =>
    withTemp((directory) =>
      Formatter.Service.use((formatter) =>
        Effect.gen(function* () {
          const statuses = yield* formatter.status()
          expect(statuses.find((item) => item.name === "gofmt")?.extensions).toContain(".go")
          expect(statuses.find((item) => item.name === "mix")).toBeDefined()
        }),
      ).pipe(Effect.provide(formatterLayer(directory, { gofmt: {} }))),
    ),
  )

  it.live("status() excludes formatters marked as disabled in config", () =>
    withTemp((directory) =>
      Formatter.Service.use((formatter) =>
        Effect.gen(function* () {
          const statuses = yield* formatter.status()
          expect(statuses.find((item) => item.name === "gofmt")).toBeUndefined()
          expect(statuses.find((item) => item.name === "mix")).toBeDefined()
        }),
      ).pipe(Effect.provide(formatterLayer(directory, { gofmt: { disabled: true } }))),
    ),
  )

  it.live("service initializes without error", () =>
    withTemp((directory) =>
      Formatter.Service.use((formatter) => formatter.init()).pipe(Effect.provide(formatterLayer(directory))),
    ),
  )

  it.live("file() returns false when no formatter runs", () =>
    withTemp((directory) =>
      Effect.gen(function* () {
        const file = path.join(directory, "test.txt")
        yield* Effect.promise(() => fs.writeFile(file, "x"))
        expect(yield* Formatter.Service.use((formatter) => formatter.file(file))).toBe(false)
      }).pipe(Effect.provide(formatterLayer(directory, false))),
    ),
  )

  it.live("status() initializes formatter state per directory", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([off, on]) =>
        Effect.gen(function* () {
          const disabled = yield* Formatter.Service.use((formatter) => formatter.status()).pipe(
            Effect.provide(formatterLayer(off.path, false)),
          )
          const enabled = yield* Formatter.Service.use((formatter) => formatter.status()).pipe(
            Effect.provide(formatterLayer(on.path, true)),
          )
          expect(disabled).toEqual([])
          expect(enabled.find((item) => item.name === "gofmt")).toBeDefined()
        }),
      (directories) =>
        Effect.promise(() => Promise.all(directories.map((tmp) => tmp[Symbol.asyncDispose]())).then(() => undefined)),
    ),
  )

  it.live("stops after the first matching formatter succeeds", () =>
    withTemp((directory) =>
      Effect.gen(function* () {
        const file = path.join(directory, "test.seq")
        yield* Effect.promise(() => fs.writeFile(file, "x"))
        expect(yield* Formatter.Service.use((formatter) => formatter.file(file))).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("xA")
      }).pipe(
        Effect.provide(
          formatterLayer(directory, {
            first: {
              command: [
                process.execPath,
                "-e",
                "const fs = require('fs'); const file = process.argv.at(-1); fs.appendFileSync(file, 'A')",
                "$FILE",
              ],
              extensions: [".seq"],
            },
            second: {
              command: [
                process.execPath,
                "-e",
                "const fs = require('fs'); const file = process.argv.at(-1); fs.appendFileSync(file, 'B')",
                "$FILE",
              ],
              extensions: [".seq"],
            },
          }),
        ),
      ),
    ),
  )

  it.live("tries the next matching formatter when the first fails", () =>
    withTemp((directory) =>
      Effect.gen(function* () {
        const file = path.join(directory, "test.fallback")
        yield* Effect.promise(() => fs.writeFile(file, "x"))
        expect(yield* Formatter.Service.use((formatter) => formatter.file(file))).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("xB")
      }).pipe(
        Effect.provide(
          formatterLayer(directory, {
            first: {
              command: [process.execPath, "-e", "process.exit(1)", "$FILE"],
              extensions: [".fallback"],
            },
            second: {
              command: [
                process.execPath,
                "-e",
                "const fs = require('fs'); const file = process.argv.at(-1); fs.appendFileSync(file, 'B')",
                "$FILE",
              ],
              extensions: [".fallback"],
            },
          }),
        ),
      ),
    ),
  )
})
