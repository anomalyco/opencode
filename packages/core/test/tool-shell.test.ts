import fs from "fs/promises"
import { realpathSync } from "node:fs"
import os from "os"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Fiber, Layer, Scope, Stream } from "effect"
import { Money } from "@opencode-ai/schema/money"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { filesystem } from "@opencode-ai/util/effect/app-node-platform"
import { Database } from "@opencode-ai/core/database/database"
import { Bus } from "@opencode-ai/core/bus"
import { Config } from "@opencode-ai/core/config"
import { Environment } from "@opencode-ai/core/environment/index"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Agent } from "@opencode-ai/core/agent"
import { Job } from "@opencode-ai/core/job"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Permission } from "@opencode-ai/core/permission"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Shell } from "@opencode-ai/core/shell"
import { Shell as ShellSchema } from "@opencode-ai/schema/shell"
import { ShellTool } from "@opencode-ai/core/tool/plugin/shell"
import { ToolOutput } from "@opencode-ai/core/tool-output"
import { Tool } from "@opencode-ai/core/tool"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin, toolDefinitions } from "./lib/tool"

const sessionID = Session.ID.make("ses_shell_tool_test")
const sessionModel = Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") })
const assertions: Permission.AssertInput[] = []
const allowedActions = new Set<string>()
let denyAction: string | undefined
let afterPermission = (_input: Permission.AssertInput): Effect.Effect<void> => Effect.void

const permission = permissionLayer({
  allowsAll: (input) => Effect.succeed(allowedActions.has(input.action)),
  assert: (input) =>
    Effect.sync(() => assertions.push(input)).pipe(
      Effect.andThen(Effect.suspend(() => afterPermission(input))),
      Effect.andThen(
        input.action === denyAction
          ? Effect.fail(
              new Permission.BlockedError({
                rules: [],
                permission: input.action,
                resources: input.resources,
              }),
            )
          : Effect.void,
      ),
    ),
})

const reset = () => {
  assertions.length = 0
  allowedActions.clear()
  denyAction = undefined
  afterPermission = () => Effect.void
}

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const complete = Effect.fn("ShellTest.complete")(function* (id: Session.ID) {
        const session = yield* store.get(id)
        if (!session) return
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID: id,
          assistantMessageID,
          agent: session.agent ?? Agent.ID.make("code"),
          model: sessionModel,
        })
        yield* bus.publish(SessionEvent.Text.Started, {
          sessionID: id,
          assistantMessageID,
          ordinal: 0,
        })
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID: id,
          assistantMessageID,
          ordinal: 0,
          text: "ok",
        })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID: id,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
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
  deps: [Bus.node, SessionStore.node],
})

const shellPluginSupervisor = makeLocationNode({
  service: PluginSupervisor.Service,
  layer: Layer.effect(
    PluginSupervisor.Service,
    registerToolPlugin(ShellTool.Plugin).pipe(Effect.as(PluginSupervisor.Service.of({ flush: Effect.void }))),
  ),
  deps: [
    Config.node,
    Environment.node,
    LocationMutation.node,
    Permission.node,
    PluginRuntime.node,
    Shell.node,
    Tool.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  PluginRuntime.providerNode,
  LocationServiceMap.node,
  filesystem,
  FSUtil.node,
  Global.node,
])
const replacements = [
  [SessionExecution.node, executionNode],
  [Permission.node, permission],
  [Global.node, tempGlobalLayer],
] satisfies LayerNode.Replacements
const productionIt = testEffect(AppNodeBuilder.build(nodes, replacements))
const it = testEffect(AppNodeBuilder.build(nodes, [...replacements, [PluginSupervisor.node, shellPluginSupervisor]]))

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
const timeoutOutputCommand = isWindows
  ? "[Console]::Out.Write('before timeout'); Start-Sleep -Seconds 60"
  : "printf 'before timeout'; sleep 60"
const bodyExitCommand = isWindows
  ? "[Console]::Out.Write('body'); Start-Sleep -Milliseconds 100; exit 7"
  : "printf body && exit 7"
const overflowCommand = (bytes: number) =>
  isWindows
    ? `[Console]::Out.Write('output-start' + ('x' * ${bytes}) + 'output-end'); Start-Sleep -Milliseconds 100`
    : `printf output-start; head -c ${bytes} /dev/zero | tr '\\0' 'x'; printf output-end`
const lineOverflowCommand = isWindows
  ? "[Console]::Out.Write('one' + [Environment]::NewLine + 'two' + [Environment]::NewLine + 'three')"
  : "printf 'one\\ntwo\\nthree'"
const progressOverflowCommand = (bytes: number, release: string) =>
  isWindows
    ? `[Console]::Out.Write(('x' * ${bytes})); while (!(Test-Path -LiteralPath '${release}')) { Start-Sleep -Milliseconds 50 }`
    : `head -c ${bytes} /dev/zero | tr '\\0' 'x'; while [ ! -e '${release}' ]; do sleep 0.05; done`

const withSession = <A, E, R>(directory: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    yield* sessions.create({
      id: sessionID,
      title: "shell test",
      location,
      model: sessionModel,
    })
    const locations = yield* LocationServiceMap.Service
    const locationLayer = locations.get(location)
    return yield* Effect.gen(function* () {
      yield* (yield* PluginSupervisor.Service).flush
      const registry = yield* Tool.Service
      return yield* body(registry)
    }).pipe(Effect.provide(locationLayer), Effect.ensuring(locations.invalidate(location)))
  })

describe("ShellTool", () => {
  productionIt.live(
    "registers and returns real successful output from the active Location",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          return withSession(tmp.path, (registry) =>
            Effect.gen(function* () {
              const definitions = yield* toolDefinitions(registry)
              const definition = definitions.find((tool) => tool.name === "shell")
              expect(definition?.description).toStartWith("Execute a shell command and return its output.")
              expect(definition?.inputSchema).not.toHaveProperty("properties.timeout.maximum")
              // Code Mode receives the declared output schema, including the command output text.
              expect(definition?.outputSchema).toHaveProperty("properties.output")
              expect(
                (yield* toolDefinitions(registry, [{ action: "shell", resource: "*", effect: "deny" }])).map(
                  (tool) => tool.name,
                ),
              ).not.toContain("shell")

              const settled = yield* executeTool(registry, call({ command: helloCommand }))
              expect(settled.status).toBe("completed")
              expect(settled.metadata).toMatchObject({ exit: 0, truncated: false })
              expect(settled.content?.[0]).toEqual({ type: "text", text: "hello" })
              expect(settled.content?.[1]).toMatchObject({
                type: "text",
                text: expect.stringContaining("Command exited with code 0."),
              })
              expect(assertions).toMatchObject([
                {
                  sessionID,
                  action: "shell",
                  resources: [isWindows ? "Start-Sleep -Milliseconds 100" : helloCommand],
                },
              ])
              expect(assertions[0]?.save).toEqual([isWindows ? "Start-Sleep *" : "printf *"])
            }),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
      ),
    { timeout: 15_000 },
  )

  it.live("resolves a relative workdir from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return Effect.promise(() => fs.mkdir(path.join(tmp.path, "src"))).pipe(
          Effect.andThen(
            withSession(tmp.path, (registry) => executeTool(registry, call({ command: cwdCommand, workdir: "src" }))),
          ),
          Effect.andThen((settled) =>
            Effect.sync(() =>
              expect(settled.content?.[0]).toMatchObject({
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

  it.live("reports a missing workdir", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
          executeTool(registry, call({ command: cwdCommand, workdir: "missing" })),
        ).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() =>
              expect(settled).toEqual({
                status: "error",
                error: {
                  type: "unknown",
                  message: `Working directory does not exist: ${path.join(tmp.path, "missing")}`,
                },
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live(
    "permissions compound commands separately",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          return withSession(tmp.path, (registry) =>
            executeTool(registry, call({ command: "printf one && printf two" }, "call-compound")),
          ).pipe(
            Effect.andThen(
              Effect.sync(() => {
                expect(assertions).toHaveLength(1)
                expect(assertions[0]).toMatchObject({
                  resources: ["printf one", "printf two"],
                  save: ["printf *", "printf *"],
                })
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
      ),
    { timeout: 15_000 },
  )

  it.live(
    "skips command decomposition when shell and external directories are unrestricted",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          allowedActions.add("shell")
          allowedActions.add("external_directory")
          return withSession(tmp.path, (registry) =>
            executeTool(registry, call({ command: "printf one && printf two" }, "call-unrestricted")),
          ).pipe(
            Effect.andThen(
              Effect.sync(() => {
                expect(assertions).toEqual([])
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
      ),
    { timeout: 15_000 },
  )

  it.live(
    "captures stderr-only and mixed stdout/stderr output",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          return withSession(tmp.path, (registry) =>
            Effect.gen(function* () {
              const stderr = yield* executeTool(registry, call({ command: stderrCommand }, "call-stderr"))
              expect(stderr.metadata).toMatchObject({ exit: 0, truncated: false })
              expect(stderr.content?.[0]).toEqual({ type: "text", text: "stderr only" })

              const mixed = yield* executeTool(registry, call({ command: mixedOutputCommand }, "call-mixed"))
              expect(mixed.metadata).toMatchObject({ exit: 0, truncated: false })
              const output = mixed.content?.[0]?.type === "text" ? mixed.content[0].text : ""
              expect(output).toContain("stdout")
              expect(output).toContain("stderr")
            }),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
      ),
    { timeout: 15_000 },
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

  it.live(
    "approves an explicit external workdir before shell execution",
    () =>
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
    { timeout: 15_000 },
  )

  it.live(
    "approves an external directory used by a directory-change command",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
        ([active, outside]) => {
          reset()
          const command = isWindows
            ? `Set-Location -LiteralPath '${outside.path}'; (Get-Location).Path`
            : `cd '${outside.path}' && pwd`
          return withSession(active.path, (registry) =>
            executeTool(registry, call({ command }, "call-external-cd")),
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
    { timeout: 15_000 },
  )

  it.live("approves an expanded external home directory", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const command = isWindows ? "Set-Location $HOME; (Get-Location).Path" : "cd ~ && pwd"
        return withSession(tmp.path, (registry) => executeTool(registry, call({ command }, "call-external-home"))).pipe(
          Effect.andThen(
            Effect.sync(() => {
              expect(assertions.map((item) => item.action)).toEqual(["external_directory", "shell"])
              expect(assertions[0]?.resources[0]).toStartWith(os.homedir().replaceAll("\\", "/"))
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live(
    "does not execute after external-directory or shell denial",
    () =>
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
    { timeout: 15_000 },
  )

  it.live("keeps non-zero exits useful", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
          executeTool(registry, call({ command: bodyExitCommand }, "call-nonzero")),
        ).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.status).toBe("completed")
              expect(settled.metadata).toMatchObject({ exit: 7, truncated: false })
              expect(settled.content?.[0]).toEqual({ type: "text", text: "body" })
              expect(settled.content?.[1]).toMatchObject({
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

  it.live(
    "truncates the model view and points at the saved output file when output overflows",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          const bytes = ToolOutput.MAX_BYTES + 1024
          return withSession(tmp.path, (registry) =>
            executeTool(registry, call({ command: overflowCommand(bytes) }, "call-overflow")),
          ).pipe(
            Effect.andThen((settled) =>
              Effect.sync(() => {
                expect(settled.metadata).toMatchObject({ exit: 0, truncated: true })
                const content = settled.content?.[0]
                if (!content || content.type !== "text") throw new Error("Expected text content")
                expect(content.text.includes("output-start")).toBe(false)
                expect(content.text.includes("output-end")).toBe(true)
                expect(content).toMatchObject({
                  type: "text",
                  text: expect.stringContaining("output truncated; full output saved to:"),
                })
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
      ),
    { timeout: 15_000 },
  )

  it.live("uses configured line limits", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(tmp.path, "opencode.json"),
              JSON.stringify({ tool_output: { max_lines: 2, max_bytes: 1_000 } }),
            ),
          )
          const settled = yield* withSession(tmp.path, (registry) =>
            executeTool(registry, call({ command: lineOverflowCommand }, "call-line-overflow")),
          )
          expect(settled.metadata).toMatchObject({ exit: 0, truncated: true })
          const content = settled.content?.[0]
          if (!content || content.type !== "text") throw new Error("Expected text content")
          expect(content.text).not.toContain("one")
          // Windows shells emit CRLF; the assertion targets line limits, not line endings.
          expect(content.text.replaceAll("\r\n", "\n")).toStartWith("two\nthree")
          expect(content.text).toContain("output truncated; full output saved to:")
        })
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live(
    "reports the shell ID for a running command",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          const release = "shell-progress-release"
          const releasePath = path.join(tmp.path, release)
          return withSession(tmp.path, (registry) =>
            Effect.gen(function* () {
              const observed = yield* Deferred.make<string>()
              yield* executeTool(registry, {
                ...call({ command: progressOverflowCommand(ToolOutput.MAX_BYTES + 1024, release) }, "call-progress"),
                progress: (update) =>
                  Effect.gen(function* () {
                    if (typeof update.shellID !== "string") return
                    yield* Deferred.succeed(observed, update.shellID)
                    yield* Effect.promise(() => fs.writeFile(releasePath, ""))
                  }),
              })

              expect(yield* Deferred.await(observed)).toMatch(/^sh_/)
            }).pipe(Effect.ensuring(Effect.promise(() => fs.writeFile(releasePath, "")).pipe(Effect.ignore))),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
      ),
    { timeout: 15_000 },
  )

  it.live(
    "reports shell ID progress once",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          return withSession(tmp.path, (registry) =>
            Effect.gen(function* () {
              const updates: Tool.Metadata[] = []
              yield* executeTool(registry, {
                ...call({ command: helloCommand }, "call-shell-id-progress"),
                progress: (update) => Effect.sync(() => updates.push(update)),
              })
              expect(updates).toHaveLength(1)
              expect(updates[0]?.shellID).toMatch(/^sh_/)
            }),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
      ),
    { timeout: 15_000 },
  )

  it.live(
    "returns a useful timeout outcome",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          return withSession(tmp.path, (registry) =>
            executeTool(registry, call({ command: timeoutOutputCommand, timeout: isWindows ? 3_000 : 500 })),
          ).pipe(
            Effect.andThen((settled) =>
              Effect.sync(() => {
                expect(settled.metadata).toMatchObject({ timeout: true, truncated: false })
                expect(settled.content?.[0]).toMatchObject({
                  type: "text",
                  text: expect.stringContaining("before timeout"),
                })
                expect(settled.content?.[1]).toMatchObject({
                  type: "text",
                  text: expect.stringContaining("Command timed out"),
                })
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
      ),
    { timeout: 15_000 },
  )

  it.live("returns the shell id for a background command", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            const bus = yield* Bus.Service
            const admitted = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
              Stream.filter((event) => event.data.sessionID === sessionID && event.data.item.type === "synthetic"),
              Stream.runHead,
              Effect.forkScoped({ startImmediately: true }),
            )
            const settled = yield* executeTool(registry, call({ command: idleCommand, timeout: 50, background: true }))
            const shellID = typeof settled.metadata?.shellID === "string" ? settled.metadata.shellID : undefined
            expect(settled.metadata).toMatchObject({ truncated: false })
            expect(shellID).toStartWith("sh_")

            const shell = yield* Shell.Service
            if (!shellID) return
            const id = ShellSchema.ID.make(shellID)
            expect((yield* shell.list()).map((info) => info.id)).toContain(id)
            expect((yield* shell.wait(id)).status).toBe("timeout")
            expect((yield* Fiber.join(admitted)).valueOrUndefined?.data.item.payload).toMatchObject({
              description: idleCommand,
              metadata: {
                source: "shell",
                state: "completed",
              },
            })
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("updates and clears a running shell timeout", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            const shell = yield* Shell.Service
            const timed = yield* executeTool(
              registry,
              call({ command: idleCommand, background: true }, "call-updated-timeout"),
            )
            const timedID = timed.metadata?.shellID
            expect(typeof timedID).toBe("string")
            if (typeof timedID !== "string") return
            const timedShellID = ShellSchema.ID.make(timedID)
            yield* shell.timeout(timedShellID, 50)
            expect((yield* shell.wait(timedShellID)).status).toBe("timeout")

            const cleared = yield* executeTool(
              registry,
              call({ command: idleCommand, timeout: 50, background: true }, "call-cleared-timeout"),
            )
            const clearedID = cleared.metadata?.shellID
            expect(typeof clearedID).toBe("string")
            if (typeof clearedID !== "string") return
            const clearedShellID = ShellSchema.ID.make(clearedID)
            yield* shell.timeout(clearedShellID, 0)
            yield* Effect.sleep(Duration.millis(100))
            expect((yield* shell.get(clearedShellID)).status).toBe("running")
            yield* shell.remove(clearedShellID)
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("backgrounds a foreground command when the session is signaled", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withSession(tmp.path, (registry) =>
          Effect.gen(function* () {
            const jobs = yield* Job.Service
            const scope = yield* Scope.Scope
            const waiting = yield* executeTool(
              registry,
              call({ command: idleCommand, timeout: 50 }, "call-background-signal"),
            ).pipe(Effect.forkIn(scope, { startImmediately: true }))

            const backgroundWhenReady = (remaining = 1000): Effect.Effect<Job.Info[], Error> =>
              Effect.gen(function* () {
                const backgrounded = yield* jobs.backgroundAll({ sessionID })
                if (backgrounded.length > 0) return backgrounded
                if (remaining <= 0) return yield* Effect.fail(new Error("Timed out waiting for foreground shell job"))
                yield* Effect.promise(() => Bun.sleep(1))
                return yield* backgroundWhenReady(remaining - 1)
              })
            expect(yield* backgroundWhenReady()).toMatchObject([{ id: "call-background-signal", type: "shell" }])
            const settled = yield* Fiber.join(waiting)
            const shellID = typeof settled.metadata?.shellID === "string" ? settled.metadata.shellID : undefined
            expect(settled.metadata).toMatchObject({ truncated: false })
            expect(settled.content?.[0]).toEqual({
              type: "text",
              text: "The command was moved to the background.",
            })
            expect(settled.content?.[1]).toMatchObject({
              type: "text",
              text: expect.stringContaining("DO NOT sleep, poll"),
            })
            expect(shellID).toStartWith("sh_")

            const shell = yield* Shell.Service
            if (!shellID) return
            const id = ShellSchema.ID.make(shellID)
            yield* Effect.sleep(Duration.millis(100))
            expect((yield* shell.get(id)).status).toBe("running")
            expect((yield* shell.list()).map((info) => info.id)).toContain(id)
            yield* shell.remove(id)
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )
})
