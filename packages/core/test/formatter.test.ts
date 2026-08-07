import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Npm } from "@opencode-ai/util/npm"
import { Document, Info } from "@opencode-ai/schema/config"
import { Config } from "../src/config"
import { Formatter } from "../src/formatter"
import { Location } from "../src/location"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
type ConfigInput = typeof Info.Encoded

function formatterLayer(directory: string, configured?: ConfigInput["formatter"]) {
  const entries =
    configured === undefined
      ? []
      : [
          new Document({
            type: "document",
            info: Schema.decodeUnknownSync(Info)({ formatter: configured }),
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
  it.live("does not run formatters marked as disabled in config", () =>
    withTemp((directory) =>
      Effect.gen(function* () {
        const file = path.join(directory, "test.disabled")
        expect(yield* Formatter.Service.use((formatter) => formatter.file(file))).toBe(false)
      }).pipe(
        Effect.provide(
          formatterLayer(directory, {
            disabled: {
              disabled: true,
              command: [process.execPath, "-e", "process.exit(0)", "$FILE"],
              extensions: [".disabled"],
            },
          }),
        ),
      ),
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

  it.live("loads formatter state per directory", () =>
    withTemp((off) =>
      withTemp((on) =>
        Effect.gen(function* () {
          const offFile = path.join(off, "test.isolated")
          const onFile = path.join(on, "test.isolated")
          const disabled = yield* Formatter.Service.use((formatter) => formatter.file(offFile)).pipe(
            Effect.provide(formatterLayer(off, false)),
          )
          const enabled = yield* Formatter.Service.use((formatter) => formatter.file(onFile)).pipe(
            Effect.provide(
              formatterLayer(on, {
                isolated: {
                  command: [process.execPath, "-e", "process.exit(0)", "$FILE"],
                  extensions: [".isolated"],
                },
              }),
            ),
          )
          expect(disabled).toBe(false)
          expect(enabled).toBe(true)
        }),
      ),
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
