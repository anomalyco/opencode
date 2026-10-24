import { describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { SessionRecord } from "@opencode/core/claude-agent/sync/record"
import { RequestKind } from "@opencode/core/claude-agent/language-model/request-kind"
import { it } from "../../lib/effect"
import { FakeClaude } from "../lib/fake-claude"
import { TestSessions } from "../lib/sessions"
import { TestTools } from "../lib/tools"

const first = TestSessions.prompt("Remember the marker COPPER-OTTER. Reply only with that marker.")

describe("Claude history branches", () => {
  it.effect("a failed compaction deletes its temporary branch and keeps the unmodified primary history resumable", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "billing-error" }),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      yield* TestSessions.reply(test.model, first)
      const before = yield* SessionRecord.make(test.storage).get("session-a")
      const reply = yield* TestSessions.reply(test.model, TestSessions.followup("Summarize"), "session-a", "compaction")
      const error = reply.find((part) => part.type === "error")
      expect(String(error?.error)).toContain("extra usage")
      expect(claude.removed).toEqual([claude.forks[0]!.sessionID])
      expect(yield* SessionRecord.make(test.storage).get("session-a")).toEqual(before)
      expect(TestSessions.text(yield* TestSessions.reply(test.model, TestSessions.followup())).trim()).toBe(
        "COPPER-OTTER",
      )
      expect(claude.runs[2]!.args).toContain(`--resume=${before!.claudeSessionID}`)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("an unsupported attachment in changed history fails with its own message before forking", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      yield* TestSessions.reply(test.model, first)
      const edited = TestSessions.followup()
      edited[2] = { role: "assistant", content: [{ type: "text", text: "An edited reply" }] }
      edited[3] = { role: "user", content: [{ type: "file", mediaType: "image/svg+xml", data: "PHN2Zy8+" }] }
      const error = yield* TestSessions.reply(test.model, edited).pipe(Effect.flip)
      expect(String(error.cause)).toContain("Claude Code does not support image/svg+xml attachments")
      expect(claude.forks).toHaveLength(0)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a fork finds its source after reload and rebuilds safely if that transcript has disappeared", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectInterrupt(),
      ])
      const saved = TestSessions.storage()
      const old = yield* TestSessions.start(claude, saved)
      yield* TestSessions.reply(old.model, first)
      yield* TestSessions.reply(old.model, TestSessions.followup())
      const source = (yield* SessionRecord.make(saved).get("session-a"))!
      yield* old.registry.close()
      const next = yield* TestSessions.start(claude, saved)
      const fork = (sessionID: string) =>
        Effect.promise(async () => {
          const result = await next.model.doStream({
            prompt: TestSessions.followup("A forked question"),
            headers: {
              [RequestKind.HEADER]: "primary",
              [RequestKind.SESSION_HEADER]: sessionID,
              [RequestKind.FORK_HEADER]: "session-a",
            },
          })
          return TestSessions.collect(result.stream)
        })
      yield* fork("child-a")
      expect(claude.forks[0]!.source).toBe(source.claudeSessionID)
      expect(claude.runs[1]!.args).toContain(`--resume=${claude.forks[0]!.sessionID}`)
      claude.transcripts.delete(source.claudeSessionID)
      yield* fork("child-b")
      expect(claude.forks).toHaveLength(1)
      expect(claude.runs[2]!.args.some((arg) => arg.startsWith("--resume="))).toBe(false)
      const rebuilt = JSON.stringify(
        claude.runs[2]!.received.find((message) => message.type === "user").message.content,
      )
      expect(rebuilt).toContain("COPPER-OTTER")
      expect(rebuilt).toContain("A forked question")
      yield* next.registry.close()
      claude.check()
    }),
  )

  it.effect("undo resends an unchanged question, then branches again using remapped checkpoints", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      const records = SessionRecord.make(test.storage)
      yield* TestSessions.reply(test.model, first)
      yield* TestSessions.reply(test.model, TestSessions.followup())
      const original = (yield* records.get("session-a"))!
      yield* TestSessions.reply(test.model, TestSessions.followup())
      const branch = (yield* records.get("session-a"))!
      expect(claude.forks[0]!.boundary).toBe(original.history![1]!.claudeMessageID!)
      expect(claude.runs[1]!.received.find((message) => message.type === "user").message.content).toEqual([
        { type: "text", text: "What was the marker? Reply only with it." },
      ])
      expect(branch.claudeSessionID).not.toBe(original.claudeSessionID)
      expect(branch.history![1]!.claudeMessageID).not.toBe(original.history![1]!.claudeMessageID)
      const reply = yield* TestSessions.reply(test.model, TestSessions.followup("Another replacement"))
      expect(claude.forks).toHaveLength(2)
      expect(claude.forks[1]).toMatchObject({
        source: branch.claudeSessionID,
        boundary: branch.history![1]!.claudeMessageID,
      })
      expect(claude.runs[2]!.received.find((message) => message.type === "user").message.content).toEqual([
        { type: "text", text: "Another replacement" },
      ])
      expect(reply.find((part) => part.type === "text-end")?.providerMetadata?.["claude-agent"]?.sessionID).toBe(
        claude.forks[1]!.sessionID,
      )
      expect(claude.removed).toHaveLength(0)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("an edited earlier reply forks before it and sends the edited history", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      yield* TestSessions.reply(test.model, first)
      const prompt = TestSessions.followup()
      prompt[2] = { role: "assistant", content: [{ type: "text", text: "REVISED-MARKER" }] }
      yield* TestSessions.reply(test.model, prompt)
      expect(claude.forks).toHaveLength(1)
      expect(claude.runs[1]!.args).toContain(`--resume=${claude.forks[0]!.sessionID}`)
      const user = JSON.stringify(claude.runs[1]!.received.find((message) => message.type === "user").message.content)
      expect(user).toContain("REVISED-MARKER")
      expect(user).not.toContain("COPPER-OTTER")
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect(
    "cancelling one generate branch leaves another and the primary session usable, and deletes both temporary branches",
    () =>
      Effect.gen(function* () {
        const claude = FakeClaude.make([
          FakeClaude.expectStartup(),
          FakeClaude.expectTurn(),
          FakeClaude.expectStartup(),
          FakeClaude.expectTurn({ recording: "text-cancel" }),
          FakeClaude.expectStartup(),
          FakeClaude.expectTurn({ recording: "utility" }),
          FakeClaude.expectInterrupt(),
          FakeClaude.expectInterrupt({ recording: "text-cancel" }),
          FakeClaude.expectInterrupt(),
          FakeClaude.expectTurn({ index: 1 }),
          FakeClaude.expectInterrupt(),
        ])
        const test = yield* TestSessions.start(claude)
        yield* TestSessions.reply(test.model, first)
        const before = yield* SessionRecord.make(test.storage).get("session-a")
        const stream = yield* TestSessions.stream(
          test.model,
          TestSessions.followup("Write a long answer"),
          "session-a",
          "generate",
        )
        const reader = stream.stream.getReader()
        yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel().catch(() => {})))
        yield* Effect.promise(async () => {
          for (;;) {
            const part = await reader.read()
            if (part.done) throw new Error("Generate ended before cancellation")
            if (part.value.type === "text-delta") break
          }
        })
        const other = yield* TestSessions.reply(
          test.model,
          TestSessions.followup("Reply only LILAC-HERON"),
          "session-a",
          "generate",
        )
        expect(TestSessions.text(other).trim()).toBe("LILAC-HERON")
        expect(claude.forks).toHaveLength(2)
        yield* Effect.promise(() => reader.cancel())
        expect(new Set(claude.removed)).toEqual(new Set(claude.forks.map((fork) => fork.sessionID)))
        expect(yield* SessionRecord.make(test.storage).get("session-a")).toEqual(before)
        expect(claude.runs[0]!.received.some((message) => message.request?.subtype === "interrupt")).toBe(false)
        expect(TestSessions.text(yield* TestSessions.reply(test.model, TestSessions.followup())).trim()).toBe(
          "COPPER-OTTER",
        )
        yield* test.registry.close()
        claude.check()
      }),
  )

  it.effect("compaction drains a parked tool turn and the next primary request starts from the summary alone", () =>
    Effect.gen(function* () {
      const cancel = FakeClaude.replay("tools-waiting-cancel")
      const nextUser = cancel.findIndex((step, i) => i > 1 && step.type === "exchange" && step.input.type === "user")
      const steps = cancel.slice(0, nextUser)
      const terminal = steps.findIndex(
        (step) => step.type === "exchange" && step.replies.some((message) => message.type === "result"),
      )
      const ending = steps[terminal]!
      if (ending.type !== "exchange") throw new Error("Missing recorded terminal result")
      const drain = Promise.withResolvers<void>()
      steps[terminal] = { ...ending, beforeResult: drain.promise }
      const claude = FakeClaude.make([
        ...steps,
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "utility" }),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude)
      yield* Effect.addFinalizer(() => Effect.sync(() => drain.resolve()))
      const prompt = TestTools.prompt()
      TestTools.append(prompt, yield* TestTools.step(test.model, prompt), () => ({
        type: "execution-denied",
        reason: "Compacted",
      }))
      const summary = yield* TestSessions.reply(test.model, prompt, "session-a", "compaction").pipe(Effect.forkChild)
      yield* Effect.promise(() => claude.started(steps[terminal]!))
      expect(claude.forks).toHaveLength(0)
      expect(claude.runs).toHaveLength(1)
      drain.resolve()
      yield* Fiber.join(summary)
      expect(claude.forks).toHaveLength(1)
      expect(claude.removed).toEqual([claude.forks[0]!.sessionID])
      const compacted = TestSessions.prompt(
        "<conversation-checkpoint>Only SUMMARY-HERON remains.</conversation-checkpoint>",
      )
      yield* TestSessions.reply(test.model, compacted)
      expect(claude.runs[2]!.args.some((arg) => arg.startsWith("--resume="))).toBe(false)
      const input = JSON.stringify(claude.runs[2]!.received.find((message) => message.type === "user").message.content)
      expect(input).toContain("SUMMARY-HERON")
      expect(input).not.toContain("lookup")
      yield* test.registry.close()
      claude.check()
    }),
  )
})
