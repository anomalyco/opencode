import { describe, expect } from "bun:test"
import { CodeMode } from "@opencode/codemode"
import { Agent } from "@opencode/core/agent"
import { CodeModeJob } from "@opencode/core/codemode/job"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Job } from "@opencode/core/job"
import type { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { ToolOutput } from "@opencode/core/tool-output"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, DateTime, Deferred, Effect, Fiber, Layer, Schema, Scope } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([Job.node, Database.node, Global.node])),
    Flag.testLayer([], { overrides: "full_codemode" }),
    Layer.mock(ToolOutput.Service, { truncate: (result) => Effect.succeed(result) }),
  ),
)

const tool = (full: boolean, rawText = false) =>
  CodeModeTool.create(
    { tools: new Map(), namespaces: new Map() },
    () => Effect.die("unused"),
    {} as Permission.Interface,
    full ? (Context.empty() as never) : undefined,
    undefined,
    rawText,
  )

const context = (sessionID: string): Tool.Context => ({
  sessionID: Session.ID.make(sessionID),
  agent: Agent.ID.make("build"),
  messageID: "msg_test" as never,
  id: Tool.CallID.make("call_test"),
  progress: () => Effect.void,
})

const script = (ms: number) => () =>
  Effect.sleep(ms).pipe(
    Effect.as<Tool.NormalizedResult>({ content: [{ type: "text", text: "done" }], output: "done", metadata: {} }),
  )

const harness = Effect.gen(function* () {
  const jobs = yield* Job.Service
  const notices: Array<{ text: string; metadata?: Record<string, unknown> }> = []
  const notified = yield* Deferred.make<void>()
  const blocking = yield* Deferred.make<void>()
  const run = yield* CodeModeJob.make(
    // Resolves once the call starts its blocking wait, whose timeout is forked in the same step.
    { ...jobs, block: (input) => Deferred.succeed(blocking, undefined).pipe(Effect.andThen(jobs.block(input))) },
    (input) =>
      Effect.sync(() => notices.push(input)).pipe(
        Effect.andThen(Deferred.succeed(notified, undefined)),
        Effect.as({
          type: "synthetic" as const,
          payload: { text: input.text, description: input.description, metadata: input.metadata },
          delivery: "queue" as const,
          id: input.id ?? SessionMessage.ID.create(),
          sessionID: input.sessionID,
          time: { created: DateTime.makeUnsafe(0) },
        }),
      ),
    yield* Scope.make(),
  )
  if (!run) throw new Error("no job runner")
  return { jobs, run, notices, notified, blocking }
})

describe("execute timeout and background", () => {
  it.effect("has only code without full_codemode", () =>
    Effect.sync(() => {
      expect(tool(false).input).toBe(CodeMode.Input)
      expect(Object.keys(tool(false).input.fields)).toEqual(["code"])
      expect(tool(false).description).not.toContain("background")
      expect(() =>
        Schema.decodeUnknownSync(tool(false).input, { onExcessProperty: "error" })({ code: "1", background: true }),
      ).toThrow()
    }),
  )

  it.effect("adds timeout and background with full_codemode", () =>
    Effect.sync(() => {
      expect(Object.keys(tool(true).input.fields)).toEqual(["code", "timeout", "background"])
      expect(Schema.decodeUnknownSync(CodeModeTool.FullInput)({ code: "1", timeout: 3000, background: true })).toEqual({
        code: "1",
        timeout: 3000,
        background: true,
      })
      expect(() => Schema.decodeUnknownSync(CodeModeTool.FullInput)({ code: "1", timeout: 0 })).toThrow()
      expect(() => Schema.decodeUnknownSync(CodeModeTool.FullInput)({ code: "1", timeout: 1.5 })).toThrow()
      expect(tool(true).description).toContain("do not poll")
    }),
  )

  it.effect("takes raw code with an optional options line when the model takes raw-text tools", () =>
    Effect.sync(() => {
      expect(tool(true, true).input).toBe(CodeMode.Input)
      expect(tool(true, true).freeform).toEqual({ type: "text" })
      expect(tool(true, true).description).toContain("start the code with one line `// @options: <JSON object>`")
      expect(Object.keys(tool(true).input.fields)).toEqual(["code", "timeout", "background"])
      expect(tool(true).description).not.toContain("// @options:")
      // Without full_codemode there are no options, so the line isn't offered.
      expect(tool(false, true).description).toBe(tool(false).description)
    }),
  )

  it.effect("moves a leading options line into timeout and background, and reports one it can't apply", () =>
    Effect.sync(() => {
      const split = (code: string) => CodeModeTool.prepare({ code })
      const ok = (input: unknown) => ({ input })
      expect(split('// @options: {"timeout": 5000, "background": true}\nreturn 1')).toEqual(
        ok({ code: "return 1", timeout: 5000, background: true }),
      )
      expect(split('  // @options: {"background":true}\r\nreturn 1')).toEqual(
        ok({ code: "return 1", background: true }),
      )
      // Keys execute doesn't take are dropped, as they are from JSON input.
      expect(split('// @options: {"yield_time_ms": 10000, "timeout": 5}\nx()')).toEqual(ok({ code: "x()", timeout: 5 }))
      expect(split("x()")).toEqual(ok({ code: "x()" }))
      expect(CodeModeTool.prepare("x()")).toEqual(ok("x()"))
      // A line that can't be applied fails the call, as an invalid JSON field would.
      for (const code of [
        "// @options: {timeout}\nx()",
        '// @options: {"timeout": -1}\nx()',
        '// @options: ["x"]\nx()',
      ])
        expect(split(code)).toEqual({ error: expect.stringContaining("must be followed by a JSON object") })
      for (const code of ['// @options: {"timeout": 5}', '// @options: {"timeout": 5}\n'])
        expect(split(code)).toEqual({ error: expect.stringContaining("Put the program") })
    }),
  )

  it.live("background returns a job ID at once and notifies on completion", () =>
    Effect.gen(function* () {
      const h = yield* harness
      const result = yield* h.run(context("ses_bg"), script(300), { background: true })
      const jobID = String(result.metadata?.jobID)
      expect(jobID).toStartWith("cm_")
      expect((yield* h.jobs.get(jobID))?.status).toBe("running")
      yield* Deferred.await(h.notified)
      expect(h.notices[0]?.metadata).toMatchObject({ jobID, state: "completed" })
    }),
  )

  it.effect("a foreground timeout moves the script to the background, where it finishes and notifies", () =>
    Effect.gen(function* () {
      const h = yield* harness
      const fiber = yield* h.run(context("ses_fg"), script(600), { timeout: 150 }).pipe(Effect.forkChild)
      yield* Deferred.await(h.blocking)
      yield* TestClock.adjust("149 millis")
      expect(fiber.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 millis")
      const result = yield* Fiber.join(fiber)
      expect(result.metadata?.jobID).toBeDefined()
      expect((yield* h.jobs.get(String(result.metadata?.jobID)))?.status).toBe("running")
      yield* TestClock.adjust("600 millis")
      yield* Deferred.await(h.notified)
      expect(h.notices[0]?.metadata).toMatchObject({ jobID: result.metadata?.jobID, state: "completed" })
      expect(h.notices[0]?.text).toContain("done")
    }),
  )

  it.live("a foreground script that finishes within its timeout returns its result", () =>
    Effect.gen(function* () {
      const h = yield* harness
      const result = yield* h.run(context("ses_fast"), script(20), { timeout: 1000 })
      expect(result.metadata?.jobID).toBeUndefined()
      expect(result.content).toEqual([{ type: "text", text: "done" }])
    }),
  )

  it.live("a background script with a timeout returns at once and is not stopped", () =>
    Effect.gen(function* () {
      const h = yield* harness
      const result = yield* h.run(context("ses_bg_timeout"), script(300), { background: true, timeout: 50 })
      expect((yield* h.jobs.get(String(result.metadata?.jobID)))?.status).toBe("running")
      yield* Deferred.await(h.notified)
      expect(h.notices[0]?.metadata).toMatchObject({ jobID: result.metadata?.jobID, state: "completed" })
      expect(h.notices[0]?.text).toContain("done")
    }),
  )
})
