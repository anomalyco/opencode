import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Info } from "@opencode-ai/schema/config"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Formatter } from "../src/formatter"
import { Location } from "../src/location"
import { tempGlobalLayer } from "./fixture/global"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    [Global.node, tempGlobalLayer],
  ]),
)
type ConfigInput = typeof Info.Encoded

function withTemp<A, E, R>(body: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => body(tmp.path),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )
}

function withFormatter<A, E, R>(
  configured: ConfigInput["formatter"],
  body: (formatter: Formatter.Interface, directory: string) => Effect.Effect<A, E, R>,
) {
  return withTemp((directory) =>
    Effect.promise(() =>
      fs.writeFile(path.join(directory, "opencode.json"), JSON.stringify({ formatter: configured })),
    ).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const plugins = yield* PluginSupervisor.Service
          yield* plugins.flush
          return yield* body(yield* Formatter.Service, directory)
        }).pipe(
          Effect.scoped,
          Effect.provide(
            LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(directory) })),
          ),
        ),
      ),
    ),
  )
}

describe("Formatter", () => {
  ;[
    { file: "test.match", extension: ".match", matches: true },
    { file: "test.other", extension: ".match", matches: false },
    { file: "test.MATCH", extension: ".match", matches: false },
    { file: "test.MATCH", extension: ".MATCH", matches: true },
    { file: ".match", extension: ".match", matches: false },
    { file: ".match", extension: "", matches: true },
    { file: "README", extension: ".match", matches: false },
    { file: "README", extension: "", matches: true },
    { file: "test.part.match", extension: ".match", matches: true },
    { file: "test.part.match", extension: ".part.match", matches: false },
  ].forEach((entry) =>
    it.live(`matches ${entry.file} against ${JSON.stringify(entry.extension)}: ${entry.matches}`, () =>
      withFormatter(
        {
          matching: {
            command: [process.execPath, "-e", "process.exit(0)", "$FILE"],
            extensions: [entry.extension],
          },
        },
        (formatter, directory) =>
          Effect.gen(function* () {
            expect(yield* formatter.file(path.join(directory, entry.file))).toBe(entry.matches)
          }),
      ),
    ),
  )

  it.live("does not run formatters marked as disabled in config", () =>
    withFormatter(
      {
        disabled: {
          disabled: true,
          command: [process.execPath, "-e", "process.exit(0)", "$FILE"],
          extensions: [".disabled"],
        },
      },
      (formatter, directory) =>
        Effect.gen(function* () {
          const file = path.join(directory, "test.disabled")
          expect(yield* formatter.file(file)).toBe(false)
        }),
    ),
  )

  it.live("file() returns false when no formatter runs", () =>
    withFormatter(false, (formatter, directory) =>
      Effect.gen(function* () {
        const file = path.join(directory, "test.txt")
        yield* Effect.promise(() => fs.writeFile(file, "x"))
        expect(yield* formatter.file(file)).toBe(false)
      }),
    ),
  )

  it.live("loads formatter state per directory", () =>
    withFormatter(false, (disabledFormatter, off) =>
      withFormatter(
        {
          isolated: {
            command: [process.execPath, "-e", "process.exit(0)", "$FILE"],
            extensions: [".isolated"],
          },
        },
        (enabledFormatter, on) =>
          Effect.gen(function* () {
            const offFile = path.join(off, "test.isolated")
            const onFile = path.join(on, "test.isolated")
            const disabled = yield* disabledFormatter.file(offFile)
            const enabled = yield* enabledFormatter.file(onFile)
            expect(disabled).toBe(false)
            expect(enabled).toBe(true)
          }),
      ),
    ),
  )

  it.live("stops after the first matching formatter succeeds", () =>
    withFormatter(
      {
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
      },
      (formatter, directory) =>
        Effect.gen(function* () {
          const file = path.join(directory, "test.seq")
          yield* Effect.promise(() => fs.writeFile(file, "x"))
          expect(yield* formatter.file(file)).toBe(true)
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("xA")
        }),
    ),
  )

  it.live("tries the next matching formatter when the first fails", () =>
    withFormatter(
      {
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
      },
      (formatter, directory) =>
        Effect.gen(function* () {
          const file = path.join(directory, "test.fallback")
          yield* Effect.promise(() => fs.writeFile(file, "x"))
          expect(yield* formatter.file(file)).toBe(true)
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("xB")
        }),
    ),
  )

  it.live("rebuilds formatter state and clears resolved commands", () =>
    withFormatter(false, (formatter, directory) =>
      Effect.gen(function* () {
        const command = { suffix: "A" }
        yield* formatter.transform((draft) => {
          const suffix = command.suffix
          draft.set({
            name: "reload",
            extensions: [".reload"],
            enabled: Effect.succeed([
              process.execPath,
              "-e",
              `const fs = require('fs'); const file = process.argv.at(-1); fs.appendFileSync(file, '${suffix}')`,
              "$FILE",
            ]),
          })
        })
        const file = path.join(directory, "test.reload")
        yield* Effect.promise(() => fs.writeFile(file, "x"))
        expect(yield* formatter.file(file)).toBe(true)

        command.suffix = "B"
        yield* formatter.reload()

        expect(yield* formatter.file(file)).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("xAB")
      }),
    ),
  )

  it.live("does not cache a command resolved before reload", () =>
    withFormatter(false, (formatter, directory) =>
      Effect.gen(function* () {
        const resolving = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const command = { suffix: "A" }
        yield* formatter.transform((draft) => {
          const suffix = command.suffix
          const resolved = [
            process.execPath,
            "-e",
            `const fs = require('fs'); const file = process.argv.at(-1); fs.appendFileSync(file, '${suffix}')`,
            "$FILE",
          ]
          draft.set({
            name: "reload-race",
            extensions: [".race"],
            enabled:
              suffix === "A"
                ? Deferred.succeed(resolving, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.as(resolved),
                  )
                : Effect.succeed(resolved),
          })
        })
        const file = path.join(directory, "test.race")
        yield* Effect.promise(() => fs.writeFile(file, "x"))
        const first = yield* formatter.file(file).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(resolving)

        command.suffix = "B"
        yield* formatter.reload()
        yield* Deferred.succeed(release, undefined)
        expect(yield* Fiber.join(first)).toBe(true)

        expect(yield* formatter.file(file)).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("xAB")
      }),
    ),
  )
})
