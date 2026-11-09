import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { ClaudeSessions } from "@opencode/core/plugin/provider/claude-agent/claude/sessions"
import { it } from "../../../../lib/effect"
import { FakeClaude } from "../lib/fake-claude"
import { TestSessions } from "../lib/sessions"
import { TestTools } from "../lib/tools"
import { Recorder } from "../lib/recorder"

describe("Claude tool steps", () => {
  it.effect("two tool steps keep one turn alive past the idle timeout and match every result to its call", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make(FakeClaude.replay("tools"))
      const test = yield* TestSessions.start(claude)
      const prompt = TestTools.prompt()
      const steps = []
      for (let i = 0; i < 3; i++) {
        // Subagents and unanswered permission prompts can keep OpenCode's tools running this long.
        yield* TestClock.adjust(ClaudeSessions.IDLE_MS * 2)
        const parts = yield* TestTools.step(test.model, prompt)
        steps.push(parts)
        TestTools.append(prompt, parts, TestTools.output)
      }
      expect(steps[0]!.filter((part) => part.type === "tool-call")).toHaveLength(2)
      expect(steps[1]!.find((part) => part.type === "tool-call")?.toolName).toBe("confirm")
      expect(TestSessions.text(steps[2]!)).toBe("COPPER-OTTER")
      expect(claude.runs).toHaveLength(1)
      const received = claude.runs[0]!.received
      expect(received.filter((message) => message.type === "user")).toHaveLength(1)
      expect(received.some((message) => message.request?.subtype === "interrupt")).toBe(false)
      const outputs = received
        .filter((message) => message.response?.response?.mcp_response)
        .map((message) => message.response.response.mcp_response.result)
      expect(outputs.map((result) => result.content[0].text)).toEqual(["LILAC-HERON", "LEMON-IBIS", "COPPER-OTTER"])
      const usage = Recorder.load("tools").filter(
        (line) =>
          line.from === "claude" && line.message.type === "stream_event" && line.message.event.type === "message_delta",
      )
      for (let i = 0; i < steps.length; i++) {
        const recorded = usage[i]!
        if (recorded.from !== "claude") throw new Error("Expected Claude usage")
        expect(steps[i]!.find((part) => part.type === "finish")?.usage.outputTokens.total).toBe(
          recorded.message.event.usage.output_tokens,
        )
      }
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("plugin reload hands over the process with its pending handlers; without a reload it shuts down", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make(FakeClaude.replay("tools"))
      const base = yield* TestSessions.start(FakeClaude.make([]))
      const input = { ...base.input, io: { ...base.input.io, spawn: claude.spawn } }
      const registry = ClaudeSessions.registry()
      yield* Effect.addFinalizer(() => registry.close())
      const scope = yield* Scope.make()
      const old = yield* registry.attach(input).pipe(Effect.provideService(Scope.Scope, scope))
      const prompt = TestTools.prompt()
      TestTools.append(prompt, yield* TestTools.step(yield* TestSessions.model(old), prompt), TestTools.output)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust(ClaudeSessions.HANDOVER_MS - 1)
      const next = yield* Scope.make()
      const fresh = yield* TestSessions.model(
        yield* registry.attach(input).pipe(Effect.provideService(Scope.Scope, next)),
      )
      TestTools.append(prompt, yield* TestTools.step(fresh, prompt), TestTools.output)
      expect(TestSessions.text(yield* TestTools.step(fresh, prompt))).toBe("COPPER-OTTER")
      expect(claude.runs).toHaveLength(1)
      yield* Scope.close(next, Exit.void)
      yield* TestClock.adjust(ClaudeSessions.HANDOVER_MS)
      yield* Effect.promise(() => claude.runs[0]!.closed)
      claude.check()
    }),
  )

  it.effect("closing the registry waits for a running tool call to drain, without answering it", () =>
    Effect.gen(function* () {
      const cancel = FakeClaude.replay("tools-waiting-cancel")
      const nextUser = cancel.findIndex(
        (step, index) => index > 1 && step.type === "exchange" && step.input.type === "user",
      )
      const steps = cancel.slice(0, nextUser)
      const drain = Promise.withResolvers<void>()
      const terminal = steps.findIndex(
        (step) => step.type === "exchange" && step.replies.some((message) => message.type === "result"),
      )
      const ending = steps[terminal]!
      if (ending.type !== "exchange") throw new Error("Missing interrupt result recording")
      steps[terminal] = { ...ending, beforeResult: drain.promise }
      const claude = FakeClaude.make(steps)
      const test = yield* TestSessions.start(claude)
      yield* Effect.addFinalizer(() => Effect.sync(() => drain.resolve()))
      const prompt = TestTools.prompt()
      yield* TestTools.step(test.model, prompt)
      let stopped = false
      const close = yield* test.registry.close().pipe(
        Effect.andThen(
          Effect.sync(() => {
            stopped = true
          }),
        ),
        Effect.forkChild,
      )
      yield* Effect.promise(() => claude.started(steps[terminal]!))
      yield* Effect.yieldNow
      expect(stopped).toBe(false)
      const call = Recorder.load("tools-waiting-cancel").find(
        (line) => line.from === "claude" && line.message.request?.message?.method === "tools/call",
      )
      if (!call || call.from !== "claude") throw new Error("Missing recorded MCP call")
      expect(claude.runs[0]!.received.some((message) => message.response?.request_id === call.message.request_id)).toBe(
        false,
      )
      drain.resolve()
      yield* Fiber.join(close)
      expect(claude.runs[0]!.received.filter((message) => message.request?.subtype === "interrupt")).toHaveLength(1)
      claude.check()
    }),
  )

  it.effect("a turn left waiting for tool results stops IDLE_MS after OpenCode stops running the session", () =>
    Effect.gen(function* () {
      const cancel = FakeClaude.replay("tools-waiting-cancel")
      const nextUser = cancel.findIndex(
        (step, index) => index > 1 && step.type === "exchange" && step.input.type === "user",
      )
      const claude = FakeClaude.make(cancel.slice(0, nextUser))
      const test = yield* TestSessions.start(claude)
      yield* TestTools.step(test.model, TestTools.prompt())
      yield* test.sessions.idle("session-a")
      yield* TestClock.adjust(ClaudeSessions.IDLE_MS)
      yield* Effect.promise(() => claude.runs[0]!.closed)
      claude.check()
    }),
  )

  it.effect("a process exit while OpenCode runs tools resumes with their saved results", () =>
    Effect.gen(function* () {
      const steps = FakeClaude.replay("tools-cancel")
      const interrupt = steps.findIndex(
        (step) => step.type === "exchange" && step.input.request?.subtype === "interrupt",
      )
      // The first process exits instead of receiving an orderly interrupt. Keep the recorded resume.
      const claude = FakeClaude.make([...steps.slice(0, interrupt), ...steps.slice(interrupt + 1)])
      const test = yield* TestSessions.start(claude)
      const prompt = TestTools.prompt()
      TestTools.append(prompt, yield* TestTools.step(test.model, prompt), TestTools.output)
      yield* Effect.promise(() => claude.runs[0]!.exit(1))
      expect(TestSessions.text(yield* TestTools.step(test.model, prompt))).toContain("CANCELLED-OTTER")
      const resumed = claude.runs[1]!
      const user = resumed.received.find((message) => message.type === "user")
      expect(JSON.stringify(user.message.content)).toContain("LILAC-HERON")
      expect(JSON.stringify(user.message.content)).toContain("LEMON-IBIS")
      expect(resumed.args.some((arg) => arg.startsWith("--resume="))).toBe(true)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("results that do not answer every waiting call stop the turn and rebuild from the full history", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make(FakeClaude.replay("tools-cancel"))
      const test = yield* TestSessions.start(claude)
      const prompt = TestTools.prompt()
      TestTools.append(prompt, yield* TestTools.step(test.model, prompt), TestTools.output)
      const results = prompt.at(-1)!
      if (results.role !== "tool") throw new Error("Expected tool results")
      // Drop the second lookup's result, so one waiting call has no answer.
      results.content.pop()
      prompt.push({
        role: "user",
        content: [{ type: "text", text: "Do not call any tools. Reply only with CANCELLED-OTTER." }],
      })
      expect(TestSessions.text(yield* TestTools.step(test.model, prompt))).toContain("CANCELLED-OTTER")
      expect(claude.runs).toHaveLength(2)
      expect(claude.runs[0]!.received.filter((message) => message.request?.subtype === "interrupt")).toHaveLength(1)
      const rebuilt = claude.runs[1]!
      expect(rebuilt.args.some((arg) => arg.startsWith("--resume="))).toBe(false)
      const user = JSON.stringify(rebuilt.received.find((message) => message.type === "user").message.content)
      expect(user).toContain("<conversation-checkpoint>")
      expect(user).toContain("LILAC-HERON")
      expect(user).not.toContain("LEMON-IBIS")
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("active-turn steering delivers tool feedback and new input through the SDK queue", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make(FakeClaude.replay("tools-continue"))
      const test = yield* TestSessions.start(claude)
      const prompt = TestTools.prompt()
      TestTools.append(prompt, yield* TestTools.step(test.model, prompt), () => ({
        type: "execution-denied",
        reason: "Cancelled by user.",
      }))
      prompt.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "The calls were cancelled. Do not call any more tools. Reply only with CONTINUED-OTTER.",
          },
        ],
      })
      expect(TestSessions.text(yield* TestTools.step(test.model, prompt)).trim()).toBe("CONTINUED-OTTER")
      expect(claude.runs).toHaveLength(1)
      const messages = claude.runs[0]!.received
      expect(messages.some((message) => message.request?.subtype === "interrupt")).toBe(false)
      expect(messages.filter((message) => message.type === "user").at(-1).priority).toBe("next")
      expect(messages.filter((message) => message.type === "user").at(-1).message.content).toEqual(
        prompt.at(-1)!.content,
      )
      const results = messages.filter((message) => message.response?.response?.mcp_response?.result)
      expect(results).toHaveLength(2)
      for (const message of results)
        expect(message.response.response.mcp_response.result).toEqual({
          isError: true,
          content: [{ type: "text", text: "Cancelled by user." }],
        })
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("an aborted tool drains the old turn before sending a fresh user message on the same process", () =>
    Effect.gen(function* () {
      const steps = FakeClaude.replay("tools-abort")
      const drain = Promise.withResolvers<void>()
      const terminal = steps.findIndex(
        (step) => step.type === "exchange" && step.replies.some((message) => message.type === "result"),
      )
      const ending = steps[terminal]!
      if (ending.type !== "exchange") throw new Error("Missing interrupt result recording")
      steps[terminal] = { ...ending, beforeResult: drain.promise }
      const claude = FakeClaude.make(steps)
      const test = yield* TestSessions.start(claude)
      yield* Effect.addFinalizer(() => Effect.sync(() => drain.resolve()))
      const prompt = TestTools.prompt()
      const first = yield* TestTools.step(test.model, prompt)
      TestTools.append(prompt, first, () => ({ type: "execution-denied", reason: "Cancelled by user." }), {
        "claude-agent": { toolError: true, toolAborted: true },
      })
      prompt.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "The calls were cancelled. Do not call any more tools. Reply only with CONTINUED-OTTER.",
          },
        ],
      })
      const next = yield* TestTools.step(test.model, prompt).pipe(Effect.forkChild)
      yield* Effect.promise(() => claude.started(steps[terminal]!))
      const messages = claude.runs[0]!.received
      // The interrupt receipt is insufficient: no new input until the terminal result flushes.
      expect(messages.filter((message) => message.type === "user")).toHaveLength(1)
      expect(messages.some((message) => message.response?.response?.mcp_response?.result?.content)).toBe(false)
      drain.resolve()
      expect(TestSessions.text(yield* Fiber.join(next)).trim()).toBe("CONTINUED-OTTER")
      expect(claude.runs).toHaveLength(1)
      expect(messages.filter((message) => message.request?.subtype === "interrupt")).toHaveLength(1)
      const user = messages.filter((message) => message.type === "user").at(-1)
      expect(user.priority).toBeUndefined()
      expect(JSON.stringify(user.message.content)).toContain("Cancelled by user.")
      expect(user.message.content.at(-1)).toEqual(prompt.at(-1)!.content[0])
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("tool images and PDFs reach Claude as image and document content", () =>
    Effect.gen(function* () {
      // Only the first process: the recording goes on to change the tool list.
      const steps = FakeClaude.replay("tools-media")
      const restart = steps.findIndex((step, index) => index > 0 && step.type === "startup")
      const claude = FakeClaude.make(steps.slice(0, restart))
      const test = yield* TestSessions.start(claude)
      const tools = [
        { ...TestTools.tools[0]!, name: "attachment", inputSchema: { type: "object" as const, properties: {} } },
      ]
      const prompt = TestSessions.prompt("Call attachment once. Report the image color and the marker from its PDF.")
      TestTools.append(prompt, yield* TestTools.step(test.model, prompt, tools), () => ({
        type: "text",
        value: "Read the attached image and PDF.",
      }))
      const image = yield* Effect.promise(() => Bun.file(new URL("../fixtures/red.png", import.meta.url)).bytes())
      const pdf = yield* Effect.promise(() => Bun.file(new URL("../fixtures/marker.pdf", import.meta.url)).bytes())
      prompt.push({
        role: "user",
        content: [
          { type: "text", text: "Attached media from tool result:" },
          { type: "file", mediaType: "image/png", data: image },
          { type: "file", mediaType: "application/pdf", data: pdf },
        ],
      })
      yield* TestTools.step(test.model, prompt, tools)
      const replacement = claude.runs[0]!.received.find(
        (message) => message.response?.response?.hookSpecificOutput?.updatedMCPToolOutput,
      )
      expect(replacement.response.response.hookSpecificOutput.updatedMCPToolOutput).toEqual([
        { type: "text", text: "Read the attached image and PDF." },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: Buffer.from(image).toString("base64") },
        },
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") },
        },
      ])
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a last step without tools stops the parked turn and resumes with the saved result", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make(FakeClaude.replay("max-steps"))
      const test = yield* TestSessions.start(claude)
      const lookup = [{ ...TestTools.tools[0]!, inputSchema: { type: "object" as const, properties: {} } }]
      const prompt = TestSessions.prompt("Call lookup once, then call it again, then report the marker.")
      TestTools.append(prompt, yield* TestTools.step(test.model, prompt, lookup), () => ({
        type: "text",
        value: "STEP-OTTER",
      }))
      prompt.push({ role: "user", content: [{ type: "text", text: "MAXIMUM STEPS REACHED. Respond with text only." }] })
      yield* TestTools.step(test.model, prompt, [])
      expect(claude.runs).toHaveLength(2)
      const final = claude.runs[1]!
      expect(final.args.some((arg) => arg.startsWith("--resume="))).toBe(true)
      const init = final.received.find((message) => message.request?.subtype === "initialize").request
      expect(init.sdkMcpServers).toBeUndefined()
      expect(JSON.stringify(final.received.find((message) => message.type === "user").message.content)).toContain(
        "STEP-OTTER",
      )
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("an unavailable OpenCode server fails closed", () =>
    Effect.gen(function* () {
      const turn = FakeClaude.expectTurn()
      const init = turn.replies.find((message) => message.type === "system" && message.subtype === "init")
      init.mcp_servers = [{ name: "opencode", status: "failed" }]
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        turn,
        FakeClaude.expectInterrupt(),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const error = yield* TestTools.step(test.model, TestTools.prompt()).pipe(Effect.flip)
      expect(String(error.cause)).toContain("OpenCode tool server did not connect")
      expect(claude.runs).toHaveLength(1)
      yield* test.registry.close()
      claude.check()
    }),
  )
})
