import { expect, it } from "@effect/vitest"
import { Deferred, Effect } from "effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import * as ToolController from "../../src/tool/controller.js"
import { Failure } from "../../src/tool/index.js"
import plugin from "../../src/tool/plugin.js"
import type { OpenCodeConfig } from "../../src/script/types.js"

interface RegisteredTool {
  readonly name: string
  readonly execute: (
    input: unknown,
    context: { readonly sessionID: string; readonly id: string },
  ) => Effect.Effect<{
    readonly structured: unknown
    readonly content: ReadonlyArray<{ readonly type: string; readonly text: string }>
  }, unknown>
}

it.effect("streams progress before shell success and failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make((tools) => {
        tools.handle("shell", ({ id, input, index, progress }) =>
          Effect.gen(function* () {
            yield* progress(`running ${id}/${index}: ${input.command}\n`)
            if (input.command === "fail")
              return yield* new Failure({ message: "controlled failure" })
            return { output: "controlled success\n", exit: 7 }
          }),
        )
      })
      const config: OpenCodeConfig = { plugins: ["existing-plugin"] }
      controller.configure(config)
      const plugins = config.plugins as Array<unknown>
      expect(plugins[0]).toBe("existing-plugin")
      const injected = plugins[1] as {
        package: string
        options: { endpoint: string; token: string; tools: string[] }
      }
      expect(injected.package.startsWith("/")).toBe(true)
      expect(injected.options.tools).toEqual(["shell"])

      const invoke = (command: string) =>
        Effect.promise(async () => {
          const response = await fetch(`${injected.options.endpoint}/execute/shell`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${injected.options.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              input: { command },
              context: { callID: `call_${command}` },
            }),
          })
          return (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
        })

      expect(yield* invoke("succeed")).toEqual([
        { type: "progress", result: { output: "running call_succeed/0: succeed\n" } },
        { type: "success", result: { output: "controlled success\n", exit: 7 } },
      ])
      expect(yield* invoke("fail")).toEqual([
        { type: "progress", result: { output: "running call_fail/1: fail\n" } },
        { type: "failure", message: "controlled failure" },
      ])
    }),
  ),
)

it.effect("does not inject a plugin without handlers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make()
      const config: OpenCodeConfig = {}
      controller.configure(config)
      expect(ToolController.composeSetup(controller, undefined)).toBeUndefined()
      expect(config).toEqual({})
    }),
  ),
)

it.effect("controls parallel calls independently by tool call ID", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make(["shell"])
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const shells = yield* controller.controls.control("shell")
      const invoke = (id: string, command: string) =>
        Effect.promise(async () => {
          const response = await fetch(`${injected.options.endpoint}/execute/shell`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${injected.options.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ input: { command }, context: { callID: id } }),
          })
          return (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
        })

      const buildResponse = yield* invoke("call_build", "bun run build").pipe(Effect.forkScoped)
      const testResponse = yield* invoke("call_test", "bun run test").pipe(Effect.forkScoped)
      const test = yield* shells.take("call_test")
      const build = yield* shells.take("call_build")

      expect(test).toMatchObject({ id: "call_test", input: { command: "bun run test" } })
      expect(build).toMatchObject({ id: "call_build", input: { command: "bun run build" } })
      expect([build.index, test.index].sort((left, right) => left - right)).toEqual([0, 1])
      expect(yield* shells.take("call_test").pipe(Effect.flip)).toMatchObject({
        _tag: "OpenCodeDrive.ToolControlError",
        message: "shell tool call already claimed: call_test",
      })

      yield* test.progress("testing\n")
      yield* build.progress("building\n")
      yield* test.succeed({ output: "tests passed\n", exit: 0 })
      yield* build.fail("build failed")

      expect(yield* Fiber.join(testResponse)).toEqual([
        { type: "progress", result: { output: "testing\n" } },
        { type: "success", result: { output: "tests passed\n", exit: 0 } },
      ])
      expect(yield* Fiber.join(buildResponse)).toEqual([
        { type: "progress", result: { output: "building\n" } },
        { type: "failure", message: "build failed" },
      ])
      expect(yield* test.fail("late failure").pipe(Effect.flip)).toMatchObject({
        _tag: "OpenCodeDrive.ToolControlError",
        operation: "fail",
        reason: "already-settled",
        message: "shell tool call call_test is settled",
      })
      expect(yield* test.progress("late progress\n").pipe(Effect.flip)).toMatchObject({
        _tag: "OpenCodeDrive.ToolControlError",
        operation: "progress",
        reason: "already-settled",
      })
      const repeatedResponse = yield* invoke("call_test", "bun run test again").pipe(Effect.forkScoped)
      const repeated = yield* shells.take("call_test")
      expect(repeated).toMatchObject({ id: "call_test", input: { command: "bun run test again" } })
      yield* repeated.succeed({ output: "tests passed again\n", exit: 0 })
      expect(yield* Fiber.join(repeatedResponse)).toEqual([
        { type: "success", result: { output: "tests passed again\n", exit: 0 } },
      ])
    }),
  ),
)

it.effect("retains call ID ownership while rejecting concurrent duplicates", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make(["shell"])
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const shells = yield* controller.controls.control("shell")
      const invoke = (command: string) =>
        Effect.promise(async () => {
          const response = await fetch(`${injected.options.endpoint}/execute/shell`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${injected.options.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              input: { command },
              context: { callID: "call_same" },
            }),
          })
          return (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
        })

      const firstResponse = yield* invoke("first").pipe(Effect.forkScoped)
      const first = yield* shells.take("call_same")
      expect(yield* invoke("second")).toEqual([
        { type: "failure", message: "duplicate shell tool call ID: call_same" },
      ])
      expect(yield* shells.take("call_same").pipe(Effect.flip)).toMatchObject({
        reason: "already-claimed",
        callID: "call_same",
      })
      expect(yield* invoke("third")).toEqual([
        { type: "failure", message: "duplicate shell tool call ID: call_same" },
      ])

      yield* first.succeed({ output: "first complete\n", exit: 0 })
      yield* Fiber.join(firstResponse)
      const reusedResponse = yield* invoke("reused").pipe(Effect.forkScoped)
      const reused = yield* shells.take("call_same")
      expect(reused.input.command).toBe("reused")
      yield* reused.succeed({ output: "reused complete\n", exit: 0 })
      yield* Fiber.join(reusedResponse)
    }),
  ),
)

it.effect("gives an exact call ID waiter precedence over a generic waiter", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make(["shell"])
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const shells = yield* controller.controls.control("shell")
      const generic = yield* shells.take().pipe(Effect.forkScoped)
      const exact = yield* shells.take("call_b").pipe(Effect.forkScoped)
      const invoke = (id: string) =>
        Effect.promise(async () => {
          const response = await fetch(`${injected.options.endpoint}/execute/shell`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${injected.options.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ input: { command: id }, context: { callID: id } }),
          })
          return (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
        })
      const responseB = yield* invoke("call_b").pipe(Effect.forkScoped)
      const responseA = yield* invoke("call_a").pipe(Effect.forkScoped)

      const callB = yield* Fiber.join(exact)
      const callA = yield* Fiber.join(generic)
      expect(callB.id).toBe("call_b")
      expect(callA.id).toBe("call_a")
      yield* callB.succeed({ output: "b\n" })
      yield* callA.succeed({ output: "a\n" })
      yield* Fiber.join(responseB)
      yield* Fiber.join(responseA)
    }),
  ),
)

it.effect("accepts exactly one concurrent terminal operation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make(["shell"])
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const shells = yield* controller.controls.control("shell")
      const response = yield* Effect.promise(async () => {
        const request = fetch(`${injected.options.endpoint}/execute/shell`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${injected.options.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ input: { command: "race" }, context: { callID: "call_race" } }),
        }).then((response) => response.text())
        return { request }
      })
      const call = yield* shells.take("call_race")
      const start = yield* Deferred.make<void>()
      const attempts = yield* Effect.all([
        Deferred.await(start).pipe(
          Effect.andThen(call.succeed({ output: "won\n" })),
          Effect.exit,
        ),
        Deferred.await(start).pipe(
          Effect.andThen(call.fail("lost")),
          Effect.exit,
        ),
      ], { concurrency: "unbounded" }).pipe(
        Effect.forkChild,
      )
      yield* Deferred.succeed(start, undefined)
      const exits = yield* Fiber.join(attempts)
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(1)
      const events = (yield* Effect.promise(() => response.request)).trim().split("\n").map((line) => JSON.parse(line))
      expect(events).toHaveLength(1)
      expect(["success", "failure"]).toContain(events[0]?.type)
    }),
  ),
)

it.effect("releases an interrupted waiter and reports transport interruption", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make(["shell"])
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const shells = yield* controller.controls.control("shell")
      const abandoned = yield* shells.take("call_wait").pipe(Effect.forkScoped)
      yield* Fiber.interrupt(abandoned)

      const request = new AbortController()
      const response = fetch(`${injected.options.endpoint}/execute/shell`, {
        method: "POST",
        signal: request.signal,
        headers: {
          authorization: `Bearer ${injected.options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: { command: "wait" },
          context: { callID: "call_wait" },
        }),
      }).catch(() => undefined)
      const call = yield* shells.take("call_wait")
      request.abort()
      yield* call.awaitInterrupted()
      yield* Effect.promise(() => response)

      expect(yield* call.succeed({ output: "late\n" }).pipe(Effect.flip)).toMatchObject({
        _tag: "OpenCodeDrive.ToolControlError",
        message: "shell tool call call_wait is interrupted",
      })
    }),
  ),
)

it.effect("rejects runtime control for tools not declared by name", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make((tools) => {
        tools.handle("shell", () => Effect.succeed({ output: "legacy handler\n" }))
      })
      expect(yield* controller.controls.control("shell").pipe(Effect.flip)).toMatchObject({
        _tag: "OpenCodeDrive.ToolControlError",
        message: "tool is not configured for runtime control: shell",
      })
    }),
  ),
)

it.effect("closes blocked runtime controls with the controller scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const controller = yield* ToolController.make(["shell"]).pipe(Scope.provide(scope))
    const shells = yield* controller.controls.control("shell")
    const waiting = yield* shells.take("call_never").pipe(Effect.forkChild)

    yield* Scope.close(scope, Exit.void)

    expect(yield* Fiber.join(waiting).pipe(Effect.flip)).toMatchObject({
      _tag: "OpenCodeDrive.ToolControlError",
      operation: "take",
      reason: "controller-closed",
      name: "shell",
    })
    expect(yield* controller.controls.control("shell").pipe(Effect.flip)).toMatchObject({
      _tag: "OpenCodeDrive.ToolControlError",
      operation: "control",
      reason: "controller-closed",
      name: "shell",
    })
  }),
)

it.effect("interrupts claimed calls when the controller scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const controller = yield* ToolController.make(["shell"]).pipe(Scope.provide(scope))
    const config: OpenCodeConfig = {}
    controller.configure(config)
    const injected = (config.plugins as Array<{
      options: { endpoint: string; token: string }
    }>)[0]!
    const shells = yield* controller.controls.control("shell")
    const response = fetch(`${injected.options.endpoint}/execute/shell`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${injected.options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: { command: "wait" },
        context: { callID: "call_shutdown" },
      }),
    }).catch(() => undefined)
    const call = yield* shells.take("call_shutdown")
    const interrupted = yield* call.awaitInterrupted().pipe(Effect.forkChild)

    yield* Scope.close(scope, Exit.void)
    yield* Fiber.join(interrupted)
    yield* Effect.promise(() => response)

    expect(yield* call.succeed({ output: "late\n" }).pipe(Effect.flip)).toMatchObject({
      _tag: "OpenCodeDrive.ToolControlError",
      operation: "succeed",
      reason: "controller-closed",
      name: "shell",
      callID: "call_shutdown",
    })
  }),
)

it.effect("routes typed webfetch, websearch, and write handlers independently", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make((tools) => {
        tools.handle("webfetch", ({ input, index }) =>
          Effect.succeed({ output: `${index}:${input.format}:${input.url}` }),
        )
        tools.handle("websearch", ({ input, index }) =>
          Effect.succeed({ output: `${index}:${input.query}`, provider: "exa" }),
        )
        tools.handle("write", ({ input, index }) =>
          Effect.succeed({ output: `${index}:${input.path}:${input.content}` }),
        )
      })
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string; tools: string[] }
      }>)[0]!
      expect(injected.options.tools).toEqual(["webfetch", "websearch", "write"])

      const invoke = (name: string, input: unknown) =>
        Effect.promise(async () => {
          const response = await fetch(`${injected.options.endpoint}/execute/${name}`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${injected.options.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              input,
              context: { callID: `call_${name}` },
            }),
          })
          return (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
        })

      expect(yield* invoke("webfetch", { url: "https://example.com" })).toEqual([
        {
          type: "success",
          result: { output: "0:markdown:https://example.com" },
        },
      ])
      expect(yield* invoke("websearch", { query: "effect typescript" })).toEqual([
        {
          type: "success",
          result: { output: "0:effect typescript", provider: "exa" },
        },
      ])
      expect(yield* invoke("write", { path: "src/a.ts", content: "export const a = 1\n" })).toEqual([
        {
          type: "success",
          result: { output: "0:src/a.ts:export const a = 1\n" },
        },
      ])
    }),
  ),
)

it.effect("settles background shells immediately and retains their completion", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const release = Promise.withResolvers<void>()
      let interrupted = false
      const controller = yield* ToolController.make((tools) => {
        tools.handle("shell", ({ input, progress }) =>
          Effect.gen(function* () {
            yield* progress("still running\n")
            yield* Effect.promise(() => release.promise)
            return { output: `${input.command} complete\n`, exit: 0 }
          }).pipe(
            Effect.onInterrupt(() => Effect.sync(() => (interrupted = true))),
          ),
        )
      })
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const headers = {
        authorization: `Bearer ${injected.options.token}`,
        "content-type": "application/json",
      }
      const started = yield* Effect.promise(async () => {
        const response = await fetch(`${injected.options.endpoint}/execute/shell`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: { command: "compile", background: true },
            context: { callID: "call_background" },
          }),
        })
        return (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
      })
      expect(started).toEqual([
        {
          type: "success",
          result: {
            output: "The command was moved to the background.",
            shellID: "call_background",
            status: "running",
          },
        },
      ])
      expect(interrupted).toBe(false)

      const completion = fetch(`${injected.options.endpoint}/background/call_background`, { headers })
        .then((response) => response.json())
      release.resolve()
      expect(yield* Effect.promise(() => completion)).toEqual({
        shellID: "call_background",
        command: "compile",
        state: "completed",
        output: "compile complete\n",
      })
    }),
  ),
)

it.effect("controls a background shell after its launch response", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make(["shell"])
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const headers = {
        authorization: `Bearer ${injected.options.token}`,
        "content-type": "application/json",
      }
      const shells = yield* controller.controls.control("shell")
      const started = yield* Effect.promise(async () => {
        const response = await fetch(`${injected.options.endpoint}/execute/shell`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: { command: "compile", background: true },
            context: { callID: "call_controlled_background" },
          }),
        })
        return (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
      })
      expect(started).toEqual([
        {
          type: "success",
          result: {
            output: "The command was moved to the background.",
            shellID: "call_controlled_background",
            status: "running",
          },
        },
      ])

      const shell = yield* shells.take("call_controlled_background")
      yield* shell.progress("compiling\n")
      const completion = fetch(
        `${injected.options.endpoint}/background/call_controlled_background`,
        { headers },
      ).then((response) => response.json())
      yield* shell.succeed({ output: "compile complete\n", exit: 0 })
      expect(yield* Effect.promise(() => completion)).toEqual({
        shellID: "call_controlled_background",
        command: "compile",
        state: "completed",
        output: "compile complete\n",
      })
    }),
  ),
)

it.effect("reports background failures with retained progress output", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make((tools) => {
        tools.handle("shell", ({ progress }) =>
          Effect.gen(function* () {
            yield* progress("partial output\n")
            return yield* new Failure({ message: "controlled background failure" })
          }),
        )
      })
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const headers = {
        authorization: `Bearer ${injected.options.token}`,
        "content-type": "application/json",
      }
      yield* Effect.promise(() =>
        fetch(`${injected.options.endpoint}/execute/shell`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: { command: "fail", background: true },
            context: { callID: "call_failure" },
          }),
        }).then((response) => response.text()),
      )
      const completion = yield* Effect.promise(() =>
        fetch(`${injected.options.endpoint}/background/call_failure`, { headers }).then((response) => response.json()),
      )
      expect(completion).toEqual({
        shellID: "call_failure",
        command: "fail",
        state: "error",
        output: "partial output\ncontrolled background failure",
      })
    }),
  ),
)

it.effect("bounds retained background output", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolController.make((tools) => {
        tools.handle("shell", ({ progress }) =>
          Effect.gen(function* () {
            yield* progress("x".repeat(1024 * 1024))
            return { output: "unreachable" }
          }),
        )
      })
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const headers = {
        authorization: `Bearer ${injected.options.token}`,
        "content-type": "application/json",
      }
      yield* Effect.promise(() =>
        fetch(`${injected.options.endpoint}/execute/shell`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: { command: "verbose", background: true },
            context: { callID: "call_verbose" },
          }),
        }).then((response) => response.text()),
      )
      const completion = yield* Effect.promise(() =>
        fetch(`${injected.options.endpoint}/background/call_verbose`, { headers }).then((response) => response.json()),
      )
      expect(completion).toEqual({
        shellID: "call_verbose",
        command: "verbose",
        state: "error",
        output: "Drive tool event exceeds 1048576 bytes",
      })
    }),
  ),
)

it.effect("notifies OpenCode when a registered background shell completes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const release = Promise.withResolvers<void>()
      const notified = Promise.withResolvers<unknown>()
      const controller = yield* ToolController.make((tools) => {
        tools.handle("shell", () =>
          Effect.gen(function* () {
            yield* Effect.promise(() => release.promise)
            return { output: "plugin completion\n", exit: 0 }
          }),
        )
      })
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const options = (config.plugins as Array<{ options: unknown }>)[0]!.options
      let shell: RegisteredTool | undefined
      yield* plugin.effect({
        options,
        tool: {
          transform: (register: (tools: { add: (tool: RegisteredTool) => void }) => void) =>
            Effect.sync(() =>
              register({
                add: (tool) => {
                  if (tool.name === "shell") shell = tool
                },
              }),
            ),
        },
        session: {
          synthetic: (input: unknown) => Effect.sync(() => notified.resolve(input)),
        },
      })
      if (shell === undefined) return yield* Effect.die(new Error("shell tool was not registered"))

      const started = yield* shell.execute(
        { command: "plugin", background: true },
        { sessionID: "ses_plugin", id: "call_plugin" },
      )
      expect(started).toEqual({
        output: {
          output: "The command was moved to the background.",
          shellID: "call_plugin",
          status: "running",
        },
        content: [
          { type: "text", text: "The command was moved to the background." },
          {
            type: "text",
            text: "You will be notified automatically when the command finishes. DO NOT sleep, poll, or proactively check on its progress.",
          },
        ],
      })

      release.resolve()
      expect(yield* Effect.promise(() => notified.promise)).toEqual({
        id: "msg_call_plugin_completion",
        sessionID: "ses_plugin",
        text: '<shell id="call_plugin" state="completed" command="plugin">\nplugin completion\n\n</shell>',
        description: "plugin",
        metadata: { source: "shell", state: "completed" },
      })
    }),
  ),
)

it.effect("cancels retained background shells when the controller stops", () =>
  Effect.gen(function* () {
    const started = Promise.withResolvers<void>()
    const interrupted = Promise.withResolvers<void>()
    const scope = yield* Scope.make()
    const controller = yield* ToolController.make((tools) => {
      tools.handle("shell", () =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Effect.sync(() => interrupted.resolve())),
        ),
      )
    }).pipe(Scope.provide(scope))
    const config: OpenCodeConfig = {}
    controller.configure(config)
    const injected = (config.plugins as Array<{
      options: { endpoint: string; token: string }
    }>)[0]!
    yield* Effect.promise(() =>
      fetch(`${injected.options.endpoint}/execute/shell`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${injected.options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: { command: "wait", background: true },
          context: { callID: "call_shutdown" },
        }),
      }).then((response) => response.text()),
    )
    yield* Effect.promise(() => started.promise)
    yield* Scope.close(scope, Exit.void)
    yield* Effect.promise(() => interrupted.promise)
  }),
)

it.effect("waits for foreground handler finalizers when the controller stops", () =>
  Effect.gen(function* () {
    const started = Promise.withResolvers<void>()
    const finalizing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let finalized = false
    const scope = yield* Scope.make()
    const controller = yield* ToolController.make((tools) => {
      tools.handle("shell", () =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => finalizing.resolve()).pipe(
              Effect.andThen(Effect.promise(() => release.promise)),
              Effect.andThen(Effect.sync(() => {
                finalized = true
              })),
            ),
          ),
        ),
      )
    }).pipe(Scope.provide(scope))
    const config: OpenCodeConfig = {}
    controller.configure(config)
    const injected = (config.plugins as Array<{
      options: { endpoint: string; token: string }
    }>)[0]!
    const response = fetch(`${injected.options.endpoint}/execute/shell`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${injected.options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: { command: "wait" },
        context: { callID: "call_foreground_shutdown" },
      }),
    }).then((response) => response.text()).catch(() => undefined)
    yield* Effect.promise(() => started.promise)
    let closed = false
    const close = Effect.runPromise(Scope.close(scope, Exit.void)).then(() => {
      closed = true
    })
    yield* Effect.promise(() => finalizing.promise)
    expect(closed).toBe(false)
    expect(finalized).toBe(false)
    release.resolve()
    yield* Effect.promise(() => close)
    yield* Effect.promise(() => response)
    expect(closed).toBe(true)
    expect(finalized).toBe(true)
  }),
)

it.effect("interrupts a handler when its transport disconnects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      const interrupted = Promise.withResolvers<void>()
      const controller = yield* ToolController.make((tools) => {
        tools.handle("shell", () =>
          Effect.sync(() => started.resolve()).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Effect.sync(() => interrupted.resolve())),
          ),
        )
      })
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const injected = (config.plugins as Array<{
        options: { endpoint: string; token: string }
      }>)[0]!
      const request = new AbortController()
      const response = fetch(`${injected.options.endpoint}/execute/shell`, {
        method: "POST",
        signal: request.signal,
        headers: {
          authorization: `Bearer ${injected.options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: { command: "wait" },
          context: { callID: "call_disconnect" },
        }),
      }).catch(() => undefined)
      yield* Effect.promise(() => started.promise)
      request.abort()
      yield* Effect.promise(() => interrupted.promise)
      yield* Effect.promise(() => response)
    }),
  ),
)

it.effect("interrupts a handler with its plugin execution", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      const interrupted = Promise.withResolvers<void>()
      const controller = yield* ToolController.make((tools) => {
        tools.handle("shell", () =>
          Effect.sync(() => started.resolve()).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Effect.sync(() => interrupted.resolve())),
          ),
        )
      })
      const config: OpenCodeConfig = {}
      controller.configure(config)
      const options = (config.plugins as Array<{ options: unknown }>)[0]!.options
      let shell: RegisteredTool | undefined
      yield* plugin.effect({
        options,
        tool: {
          transform: (register: (tools: { add: (tool: RegisteredTool) => void }) => void) =>
            Effect.sync(() =>
              register({
                add: (tool) => {
                  if (tool.name === "shell") shell = tool
                },
              }),
            ),
        },
        session: {
          synthetic: () => Effect.void,
        },
      })
      if (shell === undefined) return yield* Effect.die(new Error("shell tool was not registered"))

      const execution = yield* shell.execute(
        { command: "wait" },
        { sessionID: "ses_interrupt", id: "call_interrupt" },
      ).pipe(Effect.forkScoped)
      yield* Effect.promise(() => started.promise)
      yield* Fiber.interrupt(execution)
      yield* Effect.promise(() => interrupted.promise)
    }),
  ),
)
