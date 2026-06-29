import fs from "fs/promises"
import { realpathSync } from "node:fs"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AppProcess } from "@opencode-ai/core/process"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Shell } from "@opencode-ai/core/shell"
import { ShellTool } from "@opencode-ai/core/tool/shell"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_shell_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let denyAction: string | undefined
let afterPermission = (_input: PermissionV2.AssertInput): Effect.Effect<void> => Effect.void

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(Effect.suspend(() => afterPermission(input))),
        Effect.andThen(
          input.action === denyAction ? Effect.fail(new PermissionV2.DeniedError({ rules: [] })) : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const reset = () => {
  assertions.length = 0
  denyAction = undefined
  afterPermission = () => Effect.void
}

const withTool = <A, E, R>(
  data: string,
  directory: string,
  body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>,
) => {
  const filesystem = FSUtil.defaultLayer
  const location = Location.layer(Location.Ref.make({ directory: AbsolutePath.make(directory) })).pipe(
    Layer.provide(Project.defaultLayer),
  )
  const global = Global.layerWith({ data, config: path.join(data, "config") })
  const mutation = LocationMutation.layer.pipe(Layer.provide(filesystem), Layer.provide(location))
  const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
  const shellService = Shell.layer.pipe(
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(location),
    Layer.provide(Config.locationLayer.pipe(Layer.provide(location), Layer.provide(filesystem), Layer.provide(global))),
    Layer.provide(global),
    Layer.provide(filesystem),
    Layer.provide(AppProcess.defaultLayer),
  )
  const shell = ShellTool.layer.pipe(
    Layer.provide(registry),
    Layer.provide(permission),
    Layer.provide(mutation),
    Layer.provide(filesystem),
    Layer.provide(shellService),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(Effect.provide(Layer.mergeAll(registry, shell, filesystem)))
}

const call = (input: typeof ShellTool.Input.Type, id = "call-shell") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "shell", input },
})

const isWindows = process.platform === "win32"
const cwdCommand = isWindows ? "(Get-Location).Path; Start-Sleep -Milliseconds 100" : "pwd"
const helloCommand = isWindows ? "[Console]::Out.Write('hello'); Start-Sleep -Milliseconds 100" : "printf hello"
const idleCommand = isWindows ? "Start-Sleep -Seconds 60" : "sleep 60"
const bodyExitCommand = isWindows
  ? "[Console]::Out.Write('body'); Start-Sleep -Milliseconds 100; exit 7"
  : "printf body && exit 7"
const overflowCommand = (bytes: number) =>
  isWindows
    ? `[Console]::Out.Write(('x' * ${bytes})); Start-Sleep -Milliseconds 100`
    : `head -c ${bytes} /dev/zero | tr '\\0' 'x'`

const it = testEffect(Layer.empty)

describe("ShellTool", () => {
  it.live("registers and returns real successful output from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([data, tmp]) => {
        reset()
        return withTool(data.path, tmp.path, (registry) =>
          Effect.gen(function* () {
            const definitions = yield* toolDefinitions(registry)
            expect(definitions.map((tool) => tool.name)).toEqual(["shell"])
            expect(definitions[0]?.outputSchema).not.toHaveProperty("properties.output")
            expect(yield* toolDefinitions(registry, [{ action: "shell", resource: "*", effect: "deny" }])).toEqual([])

            const settled = yield* settleTool(registry, call({ command: helloCommand }))
            expect(settled.output?.structured).toMatchObject({ exit: 0, truncated: false })
            expect(settled.output?.content[0]).toEqual({ type: "text", text: "hello" })
            expect(settled.output?.content[1]).toMatchObject({
              type: "text",
              text: expect.stringContaining("Command exited with code 0."),
            })
            expect(assertions).toMatchObject([{ sessionID, action: "shell", resources: [helloCommand] }])
          }),
        )
      },
      ([data, tmp]) =>
        Effect.promise(() =>
          Promise.all([data[Symbol.asyncDispose](), tmp[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("resolves a relative workdir from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([data, tmp]) => {
        reset()
        return Effect.promise(() => fs.mkdir(path.join(tmp.path, "src"))).pipe(
          Effect.andThen(
            withTool(data.path, tmp.path, (registry) =>
              settleTool(registry, call({ command: cwdCommand, workdir: "src" })),
            ),
          ),
          Effect.andThen((settled) =>
            Effect.sync(() =>
              expect(settled.output?.content[0]).toMatchObject({
                type: "text",
                text: expect.stringContaining(realpathSync(path.join(tmp.path, "src"))),
              }),
            ),
          ),
        )
      },
      ([data, tmp]) =>
        Effect.promise(() =>
          Promise.all([data[Symbol.asyncDispose](), tmp[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("rejects a workdir that stops being a directory during approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([data, tmp]) => {
        reset()
        const workdir = path.join(tmp.path, "src")
        afterPermission = (input) =>
          input.action === "shell"
            ? Effect.promise(async () => {
                await fs.rm(workdir, { recursive: true })
                await fs.writeFile(workdir, "not a directory")
              }).pipe(Effect.orDie)
            : Effect.void
        return Effect.promise(() => fs.mkdir(workdir)).pipe(
          Effect.andThen(
            withTool(data.path, tmp.path, (registry) =>
              executeTool(registry, call({ command: cwdCommand, workdir: "src" })),
            ),
          ),
          Effect.andThen(Effect.sync(() => expect(assertions.map((input) => input.action)).toEqual(["shell"]))),
        )
      },
      ([data, tmp]) =>
        Effect.promise(() =>
          Promise.all([data[Symbol.asyncDispose](), tmp[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("approves an explicit external workdir before shell execution", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir(), tmpdir()])),
      ([data, active, outside]) => {
        reset()
        return withTool(data.path, active.path, (registry) =>
          executeTool(registry, call({ command: cwdCommand, workdir: outside.path })),
        ).pipe(
          Effect.andThen(
            Effect.sync(() => {
              expect(assertions.map((item) => item.action)).toEqual(["external_directory", "shell"])
              expect(assertions[0]).toMatchObject({
                resources: [path.join(realpathSync(outside.path), "*").replaceAll("\\", "/")],
              })
            }),
          ),
        )
      },
      ([data, active, outside]) =>
        Effect.promise(() =>
          Promise.all([
            data[Symbol.asyncDispose](),
            active[Symbol.asyncDispose](),
            outside[Symbol.asyncDispose](),
          ]).then(() => undefined),
        ),
    ),
  )

  it.live("does not execute after external-directory or shell denial", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir(), tmpdir()])),
      ([data, active, outside]) =>
        Effect.gen(function* () {
          reset()
          denyAction = "external_directory"
          yield* withTool(data.path, active.path, (registry) =>
            executeTool(registry, call({ command: cwdCommand, workdir: outside.path })),
          )
          expect(assertions.map((item) => item.action)).toEqual(["external_directory"])

          reset()
          denyAction = "shell"
          yield* withTool(data.path, active.path, (registry) => executeTool(registry, call({ command: cwdCommand })))
          expect(assertions.map((item) => item.action)).toEqual(["shell"])
        }),
      ([data, active, outside]) =>
        Effect.promise(() =>
          Promise.all([
            data[Symbol.asyncDispose](),
            active[Symbol.asyncDispose](),
            outside[Symbol.asyncDispose](),
          ]).then(() => undefined),
        ),
    ),
  )

  it.live("reports external command arguments as advisory warnings without enforcing approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir(), tmpdir()])),
      ([data, active, outside]) => {
        reset()
        denyAction = "external_directory"
        const target = path.join(outside.path, "secret.txt")
        return withTool(data.path, active.path, (registry) =>
          settleTool(registry, call({ command: `cat ${target}` })),
        ).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(assertions.map((item) => item.action)).toEqual(["shell"])
              expect(settled.output?.structured).not.toHaveProperty("warnings")
              expect(settled.output?.content[1]).toMatchObject({
                type: "text",
                text: expect.stringContaining("Warnings:"),
              })
            }),
          ),
        )
      },
      ([data, active, outside]) =>
        Effect.promise(() =>
          Promise.all([
            data[Symbol.asyncDispose](),
            active[Symbol.asyncDispose](),
            outside[Symbol.asyncDispose](),
          ]).then(() => undefined),
        ),
    ),
  )

  it.live("keeps non-zero exits useful", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([data, tmp]) => {
        reset()
        return withTool(data.path, tmp.path, (registry) =>
          settleTool(registry, call({ command: bodyExitCommand }, "call-nonzero")),
        ).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.output?.structured).toMatchObject({ exit: 7, truncated: false })
              expect(settled.output?.content[0]).toEqual({ type: "text", text: "body" })
              expect(settled.output?.content[1]).toMatchObject({
                type: "text",
                text: expect.stringContaining("Command exited with code 7"),
              })
            }),
          ),
        )
      },
      ([data, tmp]) =>
        Effect.promise(() =>
          Promise.all([data[Symbol.asyncDispose](), tmp[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("truncates the model view and points at the saved output file when output overflows", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([data, tmp]) => {
        reset()
        const bytes = ShellTool.MAX_CAPTURE_BYTES + 1024
        return withTool(data.path, tmp.path, (registry) =>
          settleTool(registry, call({ command: overflowCommand(bytes) }, "call-overflow")),
        ).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.output?.structured).toMatchObject({ exit: 0, truncated: true })
              expect(settled.output?.content[0]).toMatchObject({
                type: "text",
                text: expect.stringContaining("output truncated; full output saved to:"),
              })
            }),
          ),
        )
      },
      ([data, tmp]) =>
        Effect.promise(() =>
          Promise.all([data[Symbol.asyncDispose](), tmp[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("returns a useful timeout settlement", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([data, tmp]) => {
        reset()
        return withTool(data.path, tmp.path, (registry) =>
          settleTool(registry, call({ command: idleCommand, timeout: 50 })),
        ).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.output?.structured).toMatchObject({ timeout: true, truncated: false })
              expect(settled.output?.content[1]).toMatchObject({
                type: "text",
                text: expect.stringContaining("Command timed out"),
              })
            }),
          ),
        )
      },
      ([data, tmp]) =>
        Effect.promise(() =>
          Promise.all([data[Symbol.asyncDispose](), tmp[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )
})

test("keeps locked deferred parity TODOs visible", async () => {
  const source = await fs.readFile(new URL("../src/tool/shell.ts", import.meta.url), "utf8")
  for (const todo of [
    "Port tree-sitter bash / PowerShell parser-based approval reduction.",
    "Port BashArity reusable command-prefix approvals.",
    "Replace token-based command-argument external-directory advisories with parser-based detection.",
    "Restore PowerShell and cmd-specific invocation/path handling on Windows.",
    "Add plugin shell.env environment augmentation once V2 plugin hooks exist.",
    "Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.",
    "Persist background job status and define restart recovery before exposing remote observation.",
    "Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.",
    "Revisit binary output handling if stdout/stderr decoding is text-only.",
    "Stream full shell output into managed storage while retaining only a bounded in-memory preview.",
  ]) {
    expect(source).toContain(`TODO: ${todo}`)
  }
})
