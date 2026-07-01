import fs from "fs/promises"
import { realpathSync } from "node:fs"
import path from "path"
import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { filesystem } from "@opencode-ai/core/effect/app-node-platform"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Job } from "@opencode-ai/core/job"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionStore } from "@opencode-ai/core/session/store"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Shell } from "@opencode-ai/core/shell"
import { Shell as ShellSchema } from "@opencode-ai/schema/shell"
import { ShellTool } from "@opencode-ai/core/tool/shell"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions, waitForTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_shell_tool_test")
const sessionModel = ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") })
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

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const store = yield* SessionStore.Service
      const complete = Effect.fn("ShellTest.complete")(function* (id: SessionV2.ID) {
        const session = yield* store.get(id)
        if (!session) return
        const assistantMessageID = SessionMessage.ID.create()
        const textID = "text_shell_test"
        yield* events.publish(SessionEvent.Step.Started, {
          sessionID: id,
          assistantMessageID,
          timestamp: yield* DateTime.now,
          agent: session.agent ?? AgentV2.ID.make("code"),
          model: sessionModel,
        })
        yield* events.publish(SessionEvent.Text.Started, {
          sessionID: id,
          assistantMessageID,
          timestamp: yield* DateTime.now,
          textID,
        })
        yield* events.publish(SessionEvent.Text.Ended, {
          sessionID: id,
          assistantMessageID,
          timestamp: yield* DateTime.now,
          textID,
          text: "ok",
        })
        yield* events.publish(SessionEvent.Step.Ended, {
          sessionID: id,
          assistantMessageID,
          timestamp: yield* DateTime.now,
          finish: "stop",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        resume: complete,
        wake: () => Effect.void,
        interrupt: () => Effect.void,
        awaitIdle: (id) => complete(id).pipe(Effect.exit, Effect.asVoid),
      })
    }),
  ),
  deps: [EventV2.node, SessionStore.node],
})

const layer = AppNodeBuilder.build(
  LayerNode.bind(
    LayerNode.group([
      Database.node,
      EventV2.node,
      Job.node,
      ToolOutputStore.cleanupNode,
      SessionV2.node,
      PluginRuntime.providerNode,
      LocationServiceMap.node,
      filesystem,
      FSUtil.node,
      Global.node,
    ]),
    SessionExecution.node,
    executionNode,
  ),
  [LayerNode.replace(PermissionV2.layer, permission)],
)

const it = testEffect(layer)

const call = (input: typeof ShellTool.Input.Type, id = "call-shell") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "shell", input },
})

const isWindows = process.platform === "win32"
const cwdCommand = isWindows ? "(Get-Location).Path; Start-Sleep -Milliseconds 100" : "pwd"
const helloCommand = isWindows ? "[Console]::Out.Write('hello'); Start-Sleep -Milliseconds 100" : "printf hello"
const stderrCommand = isWindows
  ? "[Console]::Error.Write('stderr only'); Start-Sleep -Milliseconds 100"
  : "printf 'stderr only' >&2"
const mixedOutputCommand = isWindows
  ? "[Console]::Out.Write('stdout'); Start-Sleep -Milliseconds 50; [Console]::Error.Write('stderr'); Start-Sleep -Milliseconds 100"
  : "printf stdout; sleep 0.05; printf stderr >&2"
const idleCommand = isWindows ? "Start-Sleep -Seconds 60" : "sleep 60"
const bodyExitCommand = isWindows
  ? "[Console]::Out.Write('body'); Start-Sleep -Milliseconds 100; exit 7"
  : "printf body && exit 7"
const overflowCommand = (bytes: number) =>
  isWindows
    ? `[Console]::Out.Write(('x' * ${bytes})); Start-Sleep -Milliseconds 100`
    : `head -c ${bytes} /dev/zero | tr '\\0' 'x'`

const withSession = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    yield* sessions.create({
      id: sessionID,
      title: "shell test",
      location,
      model: sessionModel,
    })
    const locations = yield* LocationServiceMap.Service
    const locationLayer = locations.get(location)
    const registry = yield* ToolRegistry.Service.pipe(Effect.provide(locationLayer))
    yield* waitForTool(registry, ShellTool.name)
    return yield* body(registry).pipe(Effect.provide(locationLayer))
  })

describe("ShellTool", () => {
  it.live("registers and returns real successful output from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            const definitions = yield* toolDefinitions(registry)
            const shell = definitions.find((tool) => tool.name === "shell")
            expect(shell).toBeDefined()
            expect(shell?.outputSchema).not.toHaveProperty("properties.output")
            expect(
              (yield* toolDefinitions(registry, [{ action: "shell", resource: "*", effect: "deny" }])).map(
                (tool) => tool.name,
              ),
            ).not.toContain("shell")

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
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("resolves a relative workdir from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return Effect.promise(() => fs.mkdir(path.join(tmp.path, "src"))).pipe(
          Effect.andThen(
            withSession(tmp.path, (registry) => settleTool(registry, call({ command: cwdCommand, workdir: "src" }))),
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
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("captures stderr-only and mixed stdout/stderr output", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            const stderr = yield* settleTool(registry, call({ command: stderrCommand }, "call-stderr"))
            expect(stderr.output?.structured).toMatchObject({ exit: 0, truncated: false })
            expect(stderr.output?.content[0]).toEqual({ type: "text", text: "stderr only" })

            const mixed = yield* settleTool(registry, call({ command: mixedOutputCommand }, "call-mixed"))
            expect(mixed.output?.structured).toMatchObject({ exit: 0, truncated: false })
            const output = mixed.output?.content[0]?.type === "text" ? mixed.output.content[0].text : ""
            expect(output).toContain("stdout")
            expect(output).toContain("stderr")
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("rejects a workdir that stops being a directory during approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
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
            withSession(tmp.path, (registry) => executeTool(registry, call({ command: cwdCommand, workdir: "src" }))),
          ),
          Effect.andThen(Effect.sync(() => expect(assertions.map((input) => input.action)).toEqual(["shell"]))),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("approves an explicit external workdir before shell execution", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        return withSession(active.path, (registry) =>
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
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("does not execute after external-directory or shell denial", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) =>
        Effect.gen(function* () {
          reset()
          denyAction = "external_directory"
          yield* withSession(active.path, (registry) =>
            executeTool(registry, call({ command: cwdCommand, workdir: outside.path })),
          )
          expect(assertions.map((item) => item.action)).toEqual(["external_directory"])

          reset()
          denyAction = "shell"
          yield* withSession(active.path, (registry) => executeTool(registry, call({ command: cwdCommand })))
          expect(assertions.map((item) => item.action)).toEqual(["shell"])
        }),
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("reports external command arguments as advisory warnings without enforcing approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        denyAction = "external_directory"
        const target = path.join(outside.path, "secret.txt")
        return withSession(active.path, (registry) => settleTool(registry, call({ command: `cat ${target}` }))).pipe(
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
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("keeps non-zero exits useful", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
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
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("truncates the model view and points at the saved output file when output overflows", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const bytes = ShellTool.MAX_CAPTURE_BYTES + 1024
        return withSession(tmp.path, (registry) =>
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
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("returns a useful timeout settlement", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
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
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("returns the shell id for a background command", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            const settled = yield* settleTool(registry, call({ command: idleCommand, background: true }))
            const structured = settled.output?.structured as Record<string, unknown> | undefined
            const shellID = typeof structured?.shellID === "string" ? structured.shellID : undefined
            expect(settled.output?.structured).toMatchObject({ truncated: false })
            expect(shellID).toStartWith("sh_")

            const shell = yield* Shell.Service
            if (!shellID) return
            const id = ShellSchema.ID.make(shellID)
            expect((yield* shell.list()).map((info) => info.id)).toContain(id)
            yield* shell.remove(id)
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
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
    "Persist job status and define restart recovery before exposing remote observation.",
    "Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.",
    "Revisit binary output handling if stdout/stderr decoding is text-only.",
    "Stream full shell output into managed storage while retaining only a bounded in-memory preview.",
  ]) {
    expect(source).toContain(`TODO: ${todo}`)
  }
})
