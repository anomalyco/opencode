import { describe, expect } from "bun:test"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import path from "node:path"
import { Effect, Fiber, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { ClaudeSessions } from "@opencode/core/plugin/provider/claude-agent/claude/sessions"
import { ClaudeAgentLanguageModel } from "@opencode/core/plugin/provider/claude-agent/language-model/claude-agent-language-model"
import { RequestKind } from "@opencode/core/plugin/provider/claude-agent/language-model/request-kind"
import { ClaudeSystemPrompt } from "@opencode/core/plugin/provider/claude-agent/language-model/system-prompt"
import { SessionRecord } from "@opencode/core/plugin/provider/claude-agent/sync/record"
import { it } from "../../../../lib/effect"
import { FakeClaude } from "../lib/fake-claude"
import { TestSessions } from "../lib/sessions"
import { TestTools } from "../lib/tools"
import { Recorder } from "../lib/recorder"

const first = TestSessions.prompt("Remember the marker COPPER-OTTER. Reply only with that marker.")

function syntheticPlaceholder(template: Extract<SDKMessage, { type: "assistant" }>, uuid = crypto.randomUUID()) {
  const { error: _error, ...rest } = template
  return {
    ...rest,
    uuid,
    message: {
      ...template.message,
      id: `synthetic-${uuid}`,
      model: "<synthetic>",
      stop_reason: "stop_sequence" as const,
      usage: {
        ...template.message.usage,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [{ type: "text" as const, text: "No response requested.", citations: null }],
    },
  }
}

// A non-error synthetic placeholder turn, like Claude Code's "No response requested." with stop_sequence.
function syntheticTurn(uuid = crypto.randomUUID()) {
  const turn = FakeClaude.expectTurn({ recording: "api-error" })
  const replies: SDKMessage[] = []
  for (const message of turn.replies as SDKMessage[]) {
    if (message.type === "assistant") {
      replies.push(syntheticPlaceholder(message, uuid))
      continue
    }
    if (message.type === "result" && message.subtype === "success") {
      replies.push({
        ...message,
        is_error: false,
        api_error_status: null,
        stop_reason: "stop_sequence",
        result: "No response requested.",
        usage: {
          ...message.usage,
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      })
      continue
    }
    replies.push(message)
  }
  return { ...turn, replies }
}

// A real streamed text turn followed by a stray non-error synthetic placeholder right before result.
function turnWithTrailingSynthetic(uuid = crypto.randomUUID()) {
  const turn = FakeClaude.expectTurn()
  const replies: SDKMessage[] = []
  for (const message of turn.replies as SDKMessage[]) {
    if (message.type === "result") {
      const real = replies.findLast((item) => item.type === "assistant")!
      replies.push(syntheticPlaceholder(real, uuid))
    }
    replies.push(message)
  }
  return { ...turn, replies }
}

describe("Claude sessions", () => {
  it.effect("streams consecutive turns once, on one process, with per-turn usage", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const one = yield* TestSessions.reply(test.model, first)
      const two = yield* TestSessions.reply(test.model, TestSessions.followup())
      expect(TestSessions.text(one)).toBe("COPPER-OTTER")
      expect(TestSessions.text(two)).toBe("COPPER-OTTER")
      const finish = two.find((part) => part.type === "finish")!
      const usage = Recorder.result("text", 1).usage
      expect(finish.usage.inputTokens).toEqual({
        total: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        noCache: usage.input_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cacheWrite: usage.cache_creation_input_tokens,
      })
      expect(finish.usage.outputTokens.total).toBe(usage.output_tokens)
      expect(claude.runs).toHaveLength(1)
      const users = claude.runs[0]!.received.filter((message) => message.type === "user")
      expect(users).toHaveLength(2)
      expect(users[1].message.content).toEqual([{ type: "text", text: "What was the marker? Reply only with it." }])
      expect(users[0].client_composed).toBe(true)
      yield* test.registry.close()
      yield* Effect.promise(() => claude.runs[0]!.closed)
      claude.check()
    }),
  )

  it.effect("a missing Claude transcript is rebuilt from history, even after a rejected attachment", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      yield* TestSessions.reply(test.model, first)
      const before = (yield* SessionRecord.make(test.storage).get("session-a"))!
      yield* test.registry.close()
      const registry = ClaudeSessions.registry()
      yield* Effect.addFinalizer(() => registry.close())
      const sessions = yield* registry.attach({
        ...test.input,
        io: { ...test.input.io, sessionExists: async () => false },
      })
      const model = yield* TestSessions.model(sessions)
      const prompt = TestSessions.followup("Inspect this image")
      prompt.push({ role: "user", content: [{ type: "file", mediaType: "image/svg+xml", data: "PHN2Zy8+" }] })
      const error = yield* TestSessions.reply(model, prompt).pipe(Effect.flip)
      expect(String(error.cause)).toContain("Claude Code does not support image/svg+xml attachments")
      yield* TestSessions.reply(model, TestSessions.followup())
      expect(claude.runs).toHaveLength(2)
      expect(claude.runs[1]!.args.some((arg) => arg.startsWith("--resume="))).toBe(false)
      const user = claude.runs[1]!.received.find((message) => message.type === "user")
      expect(JSON.stringify(user.message.content)).toContain("<conversation-checkpoint>")
      expect(JSON.stringify(user.message.content)).toContain("COPPER-OTTER")
      expect(JSON.stringify(user.message.content)).not.toContain("image/svg+xml")
      const after = (yield* SessionRecord.make(test.storage).get("session-a"))!
      expect(after.claudeSessionID).not.toBe(before.claudeSessionID)
      yield* registry.close()
      claude.check()
    }),
  )

  it.effect("each Claude config folder keeps its own Claude session, and switching back catches up", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "text-resume" }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const folder = path.resolve("/claude-work")
      const work = yield* TestSessions.model(test.sessions, { configDir: folder })
      yield* TestSessions.reply(test.model, first)
      const id = claude.runs[0]!.args.find((arg) => arg.startsWith("--session-id="))!.split("=")[1]
      const prompt = TestSessions.followup()
      yield* TestSessions.reply(work, prompt)
      prompt.push(
        { role: "assistant", content: [{ type: "text", text: "COPPER-OTTER" }] },
        { role: "user", content: [{ type: "text", text: "And once more?" }] },
      )
      yield* TestSessions.reply(test.model, prompt)
      const user = (run: number) =>
        JSON.stringify(claude.runs[run]!.received.find((message) => message.type === "user").message.content)
      // The other folder cannot resume this login's transcript, so it starts its own from the whole history.
      expect(claude.runs[1]!.env.CLAUDE_CONFIG_DIR).toBe(folder)
      expect(claude.runs[1]!.args.some((arg) => arg.startsWith("--resume="))).toBe(false)
      expect(user(1)).toContain("Remember the marker COPPER-OTTER")
      const other = (yield* SessionRecord.make(test.storage).get("session-a", folder))!
      expect(other.claudeSessionID).not.toBe(id)
      expect(claude.runs[2]!.args).toContain(`--resume=${id}`)
      expect(user(2)).toContain("What was the marker?")
      expect(user(2)).not.toContain("Remember the marker COPPER-OTTER")
      expect((yield* SessionRecord.make(test.storage).get("session-a"))!.claudeSessionID).toBe(id)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a logged-out model folder fails with the command to log in to it, and leaves the provider's status", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup({ account: { tokenSource: "none", apiProvider: "firstParty" } }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const folder = path.resolve("/claude-work")
      const work = yield* TestSessions.model(test.sessions, { configDir: folder })
      const error = yield* TestSessions.reply(work, first).pipe(Effect.flip)
      expect(String(error.cause)).toContain(`"${folder}"`)
      expect((yield* SubscriptionRef.get(test.input.status.state)).type).toBe("checking")
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("cancellation drains past the interrupt receipt before accepting another turn", () =>
    Effect.gen(function* () {
      const drain = Promise.withResolvers<void>()
      const interrupt = FakeClaude.expectInterrupt({ recording: "text-cancel", beforeResult: drain.promise })
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "text-cancel" }),
        interrupt,
        FakeClaude.expectTurn({ recording: "text-cancel", index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const result = yield* TestSessions.stream(test.model, first)
      const reader = result.stream.getReader()
      // Wait for real partial text
      const partial = yield* Effect.promise(async () => {
        for (;;) {
          const part = await reader.read()
          if (part.done) throw new Error("Reply ended before any text")
          if (part.value.type === "text-delta") return part.value.delta
        }
      })
      const cancel = yield* Effect.promise(() => reader.cancel()).pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Effect.promise(() => claude.started(interrupt))
      const prompt = [
        ...first,
        { role: "assistant" as const, content: [{ type: "text" as const, text: partial }] },
        { role: "user" as const, content: [{ type: "text" as const, text: "Continue" }] },
      ]
      const next = yield* TestSessions.reply(test.model, prompt).pipe(Effect.forkScoped({ startImmediately: true }))
      expect(claude.runs[0]!.received.filter((message) => message.type === "user")).toHaveLength(1)
      drain.resolve()
      yield* Fiber.join(cancel)
      expect(TestSessions.text(yield* Fiber.join(next))).toBe("COPPER-OTTER")
      // Claude's transcript already holds the partial reply, so only the new input is sent on the same process.
      expect(claude.runs).toHaveLength(1)
      const users = claude.runs[0]!.received.filter((message) => message.type === "user")
      expect(users[1].message.content).toEqual([{ type: "text", text: "Continue" }])
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("cancelled history resumes after a registry restart without replaying the partial reply", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "text-cancel" }),
        FakeClaude.expectInterrupt({ recording: "text-cancel" }),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "text-cancel", index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const result = yield* TestSessions.stream(test.model, first)
      const reader = result.stream.getReader()
      yield* Effect.promise(async () => {
        for (;;) {
          const part = await reader.read()
          if (part.done) throw new Error("Reply ended before any text")
          if (part.value.type === "text-delta") break
        }
        await reader.cancel()
      })
      const saved = (yield* SessionRecord.make(test.storage).get("session-a"))!
      expect(saved.interrupted).toBe(true)
      yield* test.registry.close()
      const registry = ClaudeSessions.registry()
      yield* Effect.addFinalizer(() => registry.close())
      const sessions = yield* registry.attach(test.input)
      const model = yield* TestSessions.model(sessions)
      // OpenCode may save no assistant text when cancellation happens early.
      const prompt = [...first, { role: "user" as const, content: [{ type: "text" as const, text: "Continue" }] }]
      expect(TestSessions.text(yield* TestSessions.reply(model, prompt))).toBe("COPPER-OTTER")
      expect(claude.runs[1]!.args).toContain(`--resume=${saved.claudeSessionID}`)
      const user = claude.runs[1]!.received.find((message) => message.type === "user")
      expect(user.message.content).toEqual([{ type: "text", text: "Continue" }])
      const after = (yield* SessionRecord.make(test.storage).get("session-a"))!
      expect(after.interrupted).toBe(false)
      yield* registry.close()
      claude.check()
    }),
  )

  it.effect("chat keeps the Claude Code preset when OpenCode's built-in prompt changes", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      yield* TestSessions.reply(test.model, first)
      const prompt = TestSessions.followup()
      prompt[0] = { role: "system", content: "A changed OpenCode built-in agent prompt" }
      yield* TestSessions.reply(test.model, prompt)
      expect(claude.runs).toHaveLength(1)
      const run = claude.runs[0]!
      const init = run.received.find((message) => message.request?.subtype === "initialize").request
      expect(init.systemPrompt).toBeUndefined()
      expect(JSON.stringify(run.received)).not.toContain("A changed OpenCode built-in agent prompt")
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a turn arriving during idle shutdown waits for the old process, then resumes its session", () =>
    Effect.gen(function* () {
      const release = Promise.withResolvers<void>()
      const stop = FakeClaude.expectInterrupt({ hold: release.promise })
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        stop,
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "text-resume" }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      yield* TestSessions.reply(test.model, first)
      const id = claude.runs[0]!.args.find((arg) => arg.startsWith("--session-id="))!.split("=")[1]
      const timeout = yield* TestClock.adjust(ClaudeSessions.IDLE_MS).pipe(
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.promise(() => claude.started(stop))
      const next = yield* TestSessions.reply(test.model, TestSessions.followup()).pipe(
        Effect.forkScoped({ startImmediately: true }),
      )
      expect(claude.runs).toHaveLength(1)
      release.resolve()
      yield* Fiber.join(timeout)
      expect(TestSessions.text(yield* Fiber.join(next))).toBe("COPPER-OTTER")
      yield* Effect.promise(() => claude.runs[0]!.closed)
      expect(claude.runs).toHaveLength(2)
      expect(claude.runs[1]!.args).toContain(`--resume=${id}`)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("cancelling during startup closes it and does not save a nonexistent session", () =>
    Effect.gen(function* () {
      const startup = FakeClaude.expectStartup({ hold: new Promise(() => {}) })
      const claude = FakeClaude.make([
        startup,
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const stream = yield* TestSessions.stream(test.model, first)
      yield* Effect.promise(() => claude.started(startup))
      yield* Effect.promise(() => stream.stream.cancel())
      yield* Effect.promise(() => claude.runs[0]!.closed)
      expect(test.storage.data.size).toBe(0)
      expect(TestSessions.text(yield* TestSessions.reply(test.model, first))).toBe("COPPER-OTTER")
      expect(claude.runs[1]!.args.some((arg) => arg.startsWith("--resume="))).toBe(false)
      yield* test.registry.close()
      expect(() => claude.check()).toThrow("1 script steps did not finish")
    }),
  )

  it.effect("chat checks compatibility before sending a prompt", () =>
    Effect.gen(function* () {
      const startup = FakeClaude.expectStartup()
      startup.reply.claude_code_version = "2.1.247"
      const claude = FakeClaude.make([startup])
      const test = yield* TestSessions.start(claude)
      const error = yield* TestSessions.reply(test.model, first).pipe(Effect.flip)
      expect(String(error.cause)).toContain("claude update")
      expect(claude.runs[0]!.received.some((message) => message.type === "user")).toBe(false)
      yield* Effect.promise(() => claude.runs[0]!.closed)
      claude.check()
    }),
  )

  it.effect("changes model and effort live, and resumes when the output limit changes or is cleared", () =>
    Effect.gen(function* () {
      const controls = FakeClaude.replay("controls").filter(
        (step) =>
          step.type === "exchange" && ["set_model", "apply_flag_settings"].includes(step.input.request?.subtype),
      )
      const recorded = (index: number) => FakeClaude.expectTurn({ recording: "controls", index })
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        recorded(0),
        controls[0]!,
        recorded(1),
        controls[1]!,
        recorded(2),
        controls[2]!,
        controls[3]!,
        recorded(3),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        recorded(4),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        recorded(4),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const prompt = TestSessions.prompt("Remember CONTROL-OTTER. Reply only CONTROL-OTTER.")
      const settings = [
        { model: "haiku", effort: "low", maxOutputTokens: 2048 },
        { model: "haiku", effort: "high", maxOutputTokens: 2048 },
        { model: "haiku", maxOutputTokens: 2048 },
        { model: "sonnet", effort: "low", maxOutputTokens: 2048 },
        { model: "sonnet", effort: "low", maxOutputTokens: 4096 },
        { model: "sonnet", effort: "low" },
      ]
      for (const setting of settings) {
        const model = new ClaudeAgentLanguageModel.Model(setting.model, test.model.dependencies)
        const result = yield* Effect.promise(() =>
          model.doStream({
            prompt,
            maxOutputTokens: setting.maxOutputTokens,
            providerOptions: { "claude-agent": setting.effort ? { effort: setting.effort } : {} },
            headers: { [RequestKind.HEADER]: "primary", [RequestKind.SESSION_HEADER]: "session-a" },
          }),
        )
        expect(TestSessions.text(yield* Effect.promise(() => TestSessions.collect(result.stream)))).toBe(
          "CONTROL-OTTER",
        )
        prompt.push(
          { role: "assistant", content: [{ type: "text", text: "CONTROL-OTTER" }] },
          { role: "user", content: [{ type: "text", text: "What was the marker? Reply only with it." }] },
        )
      }
      expect(claude.runs).toHaveLength(3)
      const id = claude.runs[0]!.args.find((arg) => arg.startsWith("--session-id="))!.split("=")[1]
      const requests = claude.runs[0]!.received.map((message) => message.request)
      expect(requests).toContainEqual({ subtype: "set_model", model: "sonnet" })
      expect(requests).toContainEqual({ subtype: "apply_flag_settings", settings: { effortLevel: "high" } })
      expect(requests).toContainEqual({ subtype: "apply_flag_settings", settings: { effortLevel: null } })
      expect(claude.runs[0]!.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("2048")
      expect(claude.runs[1]!.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("4096")
      expect(claude.runs[2]!.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBeUndefined()
      for (const run of claude.runs.slice(1)) {
        expect(run.args).toContain("--model=sonnet")
        expect(run.args).toContain(`--resume=${id}`)
      }
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("titles use their own task prompt in a throwaway session that leaves the chat alone", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "utility" }),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      yield* TestSessions.reply(test.model, first)
      yield* TestSessions.reply(test.model, TestSessions.followup(), "session-a", "title")
      expect(TestSessions.text(yield* TestSessions.reply(test.model, TestSessions.followup()))).toBe("COPPER-OTTER")
      expect(claude.runs).toHaveLength(2)
      const title = claude.runs[1]!
      const init = title.received.find((message) => message.request?.subtype === "initialize").request
      expect(init.systemPrompt).toEqual(["You are a concise test assistant."])
      expect(title.args).toContain("--no-session-persistence")
      expect(test.storage.data.size).toBe(1)
      yield* test.registry.close()
      claude.check()
    }),
  )

  // Claude's prompt cache only matches when tools and system prompt are identical, so branches must not drop them.
  it.effect("conversation branches send the chat's tools and system prompt, and a tool call ends the branch", () =>
    Effect.gen(function* () {
      // The branch replays a recorded tool call that is stopped while waiting for its result.
      const waiting = FakeClaude.replay("tools-waiting-cancel")
      const resumed = waiting.findIndex(
        (step, index) => index > 1 && step.type === "exchange" && step.input.type === "user",
      )
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        ...waiting.slice(0, resumed),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      // OpenCode's session hooks set these on chats and branches alike.
      const settings = {
        "claude-agent": {
          [ClaudeSystemPrompt.AGENT_OPTION]: "AGENT-ROLE",
          [ClaudeSystemPrompt.INSTRUCTIONS_OPTION]: "OPENCODE-INSTRUCTIONS",
        },
      }
      yield* TestTools.step(test.model, first, TestTools.tools, "primary", settings)
      const parts = yield* TestTools.step(test.model, TestSessions.followup(), TestTools.tools, "generate", settings)
      const chat = claude.runs[0]!.received.find((message) => message.request?.subtype === "initialize").request
      const branch = claude.runs[1]!.received.find((message) => message.request?.subtype === "initialize").request
      expect(chat.sdkMcpServers).toEqual(["opencode"])
      expect(branch.sdkMcpServers).toEqual(chat.sdkMcpServers)
      expect(chat.appendSystemPrompt).toContain("AGENT-ROLE")
      expect(chat.appendSystemPrompt).toContain("OPENCODE-INSTRUCTIONS")
      expect(branch.appendSystemPrompt).toBe(chat.appendSystemPrompt)
      // The reply ends at the tool call, and the throwaway process and fork are cleaned up.
      expect(parts.filter((part) => part.type === "tool-call")).toHaveLength(2)
      yield* Effect.promise(() => claude.runs[1]!.closed)
      expect(claude.removed).toEqual([claude.forks[0]!.sessionID])
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("closing the registry interrupts and drains a running side call", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "text-cancel" }),
        FakeClaude.expectInterrupt({ recording: "text-cancel" }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const stream = yield* TestSessions.stream(test.model, first, "session-a", "generate")
      const reader = stream.stream.getReader()
      yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel().catch(() => {})))
      yield* Effect.promise(async () => {
        for (;;) {
          const part = await reader.read()
          if (part.done) throw new Error("Reply ended before shutdown could be tested")
          if (part.value.type === "text-delta") break
        }
      })
      yield* test.registry.close()
      yield* Effect.promise(() => claude.runs[0]!.closed)
      expect(test.storage.data.size).toBe(0)
      claude.check()
    }),
  )

  it.effect(
    "a synthetic-only placeholder turn fails without polluting text or checkpoints, and follow-up turns recover cleanly",
    () =>
      Effect.gen(function* () {
        const syntheticID = crypto.randomUUID()
        const claude = FakeClaude.make([
          FakeClaude.expectStartup(),
          FakeClaude.expectTurn(),
          syntheticTurn(syntheticID),
          FakeClaude.expectInterrupt(),
          FakeClaude.expectStartup(),
          FakeClaude.expectTurn({ index: 1 }),
          FakeClaude.expectTurn({ index: 1 }),
          FakeClaude.expectInterrupt(),
        ])
        const test = yield* TestSessions.start(claude)
        const records = SessionRecord.make(test.storage)

        const one = yield* TestSessions.reply(test.model, first)
        expect(TestSessions.text(one)).toBe("COPPER-OTTER")
        const afterOne = (yield* records.get("session-a"))!
        const realAssistantID = afterOne.history![1]!.claudeMessageID!

        const secondPrompt = TestSessions.followup("Status update please")
        const two = yield* TestSessions.reply(test.model, secondPrompt)
        expect(TestSessions.text(two)).toBe("")
        expect(two.some((part) => part.type === "finish")).toBe(false)
        const error = two.find((part) => part.type === "error")
        expect(String(error?.error)).toContain("Claude Code returned no response.")

        const afterTwo = (yield* records.get("session-a"))!
        expect(afterTwo.history).toHaveLength(3)
        expect(afterTwo.history!.map((checkpoint) => checkpoint.claudeMessageID)).not.toContain(syntheticID)

        // Follow-up after the failed synthetic turn omits the empty failed assistant message, forks before it, and recovers.
        const thirdPrompt = [
          ...secondPrompt,
          { role: "user" as const, content: [{ type: "text" as const, text: "I don't see your reply" }] },
        ]
        const three = yield* TestSessions.reply(test.model, thirdPrompt)
        expect(TestSessions.text(three)).toBe("COPPER-OTTER")
        expect(three.some((part) => part.type === "error")).toBe(false)
        expect(claude.forks).toHaveLength(1)
        expect(claude.forks[0]!.boundary).toBe(realAssistantID)
        expect(claude.runs[1]!.received.find((message) => message.type === "user").message.content).toEqual([
          { type: "text", text: "Status update please" },
          { type: "text", text: "I don't see your reply" },
        ])

        // The next turn stays in sync on the forked process without forking again.
        const fourthPrompt = [
          ...thirdPrompt,
          { role: "assistant" as const, content: [{ type: "text" as const, text: "COPPER-OTTER" }] },
          { role: "user" as const, content: [{ type: "text" as const, text: "One more time" }] },
        ]
        const four = yield* TestSessions.reply(test.model, fourthPrompt)
        expect(TestSessions.text(four)).toBe("COPPER-OTTER")
        expect(claude.forks).toHaveLength(1)
        expect(claude.runs).toHaveLength(2)
        expect(claude.runs[1]!.received.filter((message) => message.type === "user")[1].message.content).toEqual([
          { type: "text", text: "One more time" },
        ])

        yield* test.registry.close()
        claude.check()
      }),
  )

  it.effect("retrying the same prompt after a synthetic-only turn forks cleanly and resends it", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        syntheticTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const records = SessionRecord.make(test.storage)

      yield* TestSessions.reply(test.model, first)
      const realAssistantID = (yield* records.get("session-a"))!.history![1]!.claudeMessageID!

      const prompt = TestSessions.followup("Status update please")
      const failed = yield* TestSessions.reply(test.model, prompt)
      expect(TestSessions.text(failed)).toBe("")
      expect(String(failed.find((part) => part.type === "error")?.error)).toContain("Claude Code returned no response.")

      const retried = yield* TestSessions.reply(test.model, prompt)
      expect(TestSessions.text(retried)).toBe("COPPER-OTTER")
      expect(claude.forks).toHaveLength(1)
      expect(claude.forks[0]!.boundary).toBe(realAssistantID)
      expect(claude.runs[1]!.received.find((message) => message.type === "user").message.content).toEqual([
        { type: "text", text: "Status update please" },
      ])

      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect(
    "a trailing synthetic placeholder after real text keeps real text, usage, and checkpoints on one process",
    () =>
      Effect.gen(function* () {
        const syntheticID = crypto.randomUUID()
        const claude = FakeClaude.make([
          FakeClaude.expectStartup(),
          turnWithTrailingSynthetic(syntheticID),
          FakeClaude.expectTurn({ index: 1 }),
          FakeClaude.expectInterrupt(),
        ])
        const test = yield* TestSessions.start(claude)
        const records = SessionRecord.make(test.storage)

        const one = yield* TestSessions.reply(test.model, first)
        expect(TestSessions.text(one)).toBe("COPPER-OTTER")
        expect(one.some((part) => part.type === "error")).toBe(false)
        const finish = one.find((part) => part.type === "finish")!
        const usage = Recorder.result("text").usage
        expect(finish.usage.inputTokens).toEqual({
          total: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
          noCache: usage.input_tokens,
          cacheRead: usage.cache_read_input_tokens,
          cacheWrite: usage.cache_creation_input_tokens,
        })
        expect(finish.usage.outputTokens.total).toBe(usage.output_tokens)

        const saved = (yield* records.get("session-a"))!
        expect(saved.history).toHaveLength(2)
        expect(saved.history![1]!.claudeMessageID).not.toBe(syntheticID)

        const two = yield* TestSessions.reply(test.model, TestSessions.followup())
        expect(TestSessions.text(two)).toBe("COPPER-OTTER")
        expect(claude.runs).toHaveLength(1)
        expect(claude.forks).toHaveLength(0)

        yield* test.registry.close()
        claude.check()
      }),
  )
})
