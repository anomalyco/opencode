import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { $ } from "bun"
import { Deferred, Effect, Fiber } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Info } from "@opencode/schema/config"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Formatter } from "../src/formatter"
import { Location } from "../src/location"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node, Global.node]),
    [Global.node.replace(tempGlobalLayer), offlineModels],
  ),
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
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
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

function append(expression: string) {
  return [process.execPath, "-e", `require('fs').appendFileSync(process.argv.at(-1), ${expression})`, "$FILE"]
}

const markdown = { command: append("'md'"), extensions: [".md"] }
const project = { command: append("'project'"), extensions: [".project"] }

// Writes formatter config layers from lowest to highest priority: global, project, then project .opencode.
function withLayers<A, E, R>(
  layers: ConfigInput["formatter"][],
  body: (formatter: Formatter.Interface, directory: string) => Effect.Effect<A, E, R>,
) {
  return withTemp((directory) =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(directory, ".opencode"))
        const files = [
          path.join(global.config, "opencode.jsonc"),
          path.join(directory, "opencode.json"),
          path.join(directory, ".opencode", "opencode.jsonc"),
        ]
        await Promise.all(layers.map((formatter, index) => fs.writeFile(files[index], JSON.stringify({ formatter }))))
      })
      return yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        return yield* body(yield* Formatter.Service, directory)
      }).pipe(
        Effect.scoped,
        Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
      )
    }),
  )
}

const layered: { name: string; layers: ConfigInput["formatter"][]; expected: Record<string, string | false> }[] = [
  {
    name: "keeps lower formatters when a higher config adds another",
    layers: [{ markdown }, undefined, { project }],
    expected: { "test.md": "md", "test.project": "project" },
  },
  {
    name: "inherits omitted fields and replaces supplied arrays",
    layers: [
      { markdown: { command: append("'A'"), extensions: [".md", ".project"] } },
      { markdown: { command: append("'B'"), extensions: [".project"] } },
    ],
    expected: { "test.md": false, "test.project": "B" },
  },
  {
    name: "merges environment variables by key",
    layers: [
      {
        markdown: {
          ...markdown,
          command: append("process.env.FIRST + process.env.SECOND"),
          environment: { FIRST: "global", SECOND: "global" },
        },
      },
      { markdown: { environment: { SECOND: "project" } } },
    ],
    expected: { "test.md": "globalproject" },
  },
  {
    name: "keeps a lower disable through overrides that omit it",
    layers: [{ markdown: { ...markdown, disabled: true } }, { markdown: { command: append("'override'") }, project }],
    expected: { "test.md": false, "test.project": "project" },
  },
  {
    name: "re-enables a lower disabled formatter",
    layers: [{ markdown: { ...markdown, disabled: true } }, { markdown: { disabled: false } }],
    expected: { "test.md": "md" },
  },
  {
    name: "keeps lower formatters through an empty object",
    layers: [{ markdown }, {}],
    expected: { "test.md": "md" },
  },
  {
    name: "clears lower formatters when a higher config is false",
    layers: [{ markdown }, false],
    expected: { "test.md": false },
  },
  {
    name: "clears lower formatters before a later object when a higher config is true",
    layers: [{ markdown }, true, { project }],
    expected: { "test.md": false, "test.project": "project" },
  },
  {
    name: "enables only formatters configured after false",
    layers: [{ markdown }, false, { project }],
    expected: { "test.md": false, "test.project": "project" },
  },
]

describe("Formatter", () => {
  layered.forEach((entry) =>
    it.live(entry.name, () =>
      withLayers(entry.layers, (formatter, directory) =>
        Effect.forEach(Object.entries(entry.expected), ([name, expected]) =>
          Effect.gen(function* () {
            const file = path.join(directory, name)
            yield* Effect.promise(() => fs.writeFile(file, ""))
            const formatted = yield* formatter.file(file)
            expect(formatted && (yield* Effect.promise(() => fs.readFile(file, "utf8")))).toBe(expected)
          }),
        ),
      ),
    ),
  )
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
  ;[
    { dependency: "require", directory: "." },
    { dependency: "require", directory: "app" },
    { dependency: "require-dev", directory: "app" },
  ].forEach((entry) =>
    it.live(`runs Pint declared in ${entry.dependency} from ${entry.directory}`, () =>
      withTemp((temporary) =>
        Effect.gen(function* () {
          const project = AbsolutePath.make(path.join(temporary, "php project"))
          const directory = AbsolutePath.make(path.join(project, entry.directory))
          const file = path.join(directory, "Example.php")
          const executable = path.join(project, "vendor", "bin", process.platform === "win32" ? "pint.cmd" : "pint")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(executable), { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await $`git init`.cwd(project).quiet()
            await fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ formatter: true }))
            await fs.writeFile(
              path.join(project, "composer.json"),
              JSON.stringify({ [entry.dependency]: { "laravel/pint": "^1.0" } }),
            )
            await fs.writeFile(file, "<?php\n")
            await fs.writeFile(
              executable,
              process.platform === "win32"
                ? '@echo off\r\necho formatted>>"%~1"\r\n'
                : '#!/bin/sh\nprintf "formatted\\n" >> "$1"\n',
              { mode: 0o755 },
            )
          })
          yield* Effect.gen(function* () {
            const plugins = yield* Plugin.Service
            yield* plugins.awaitActivation
            const location = yield* Location.Service
            expect(location.directory).toBe(directory)
            expect(location.project.directory).toBe(project)
            const formatter = yield* Formatter.Service
            expect(yield* formatter.file(file)).toBe(true)
            expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toContain("formatted")
          }).pipe(Effect.scoped, Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory }))))
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
        yield* formatter.transform((editor) => {
          const suffix = command.suffix
          editor.set({
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
        yield* formatter.transform((editor) => {
          const suffix = command.suffix
          const resolved = [
            process.execPath,
            "-e",
            `const fs = require('fs'); const file = process.argv.at(-1); fs.appendFileSync(file, '${suffix}')`,
            "$FILE",
          ]
          editor.set({
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
