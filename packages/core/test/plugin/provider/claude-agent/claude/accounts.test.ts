import { describe, expect, test } from "bun:test"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import os from "node:os"
import path from "node:path"
import { Effect, SubscriptionRef } from "effect"
import { ClaudeQueryOptions } from "@opencode/core/plugin/provider/claude-agent/claude/query-options"
import { RequestKind } from "@opencode/core/plugin/provider/claude-agent/language-model/request-kind"
import { it } from "../../../../lib/effect"
import { FakeClaude } from "../lib/fake-claude"
import { TestSessions } from "../lib/sessions"

const first = TestSessions.prompt("Remember the marker COPPER-OTTER. Reply only with that marker.")
// configDir is resolved to the platform's path form, so the tests name their folders the same way.
const a = path.resolve("/accounts/a")
const b = path.resolve("/accounts/b")
const c = path.resolve("/accounts/c")
const pool = { configDir: [a, b, c] }
const resetsAt = 1792800000

// A recorded failed turn, rewritten into the messages Claude Code sends when a subscription limit refuses it.
function limitTurn() {
  const turn = FakeClaude.expectTurn({ recording: "api-error" })
  const replies: SDKMessage[] = []
  for (const message of turn.replies as SDKMessage[]) {
    if (message.type === "assistant" && message.error) {
      replies.push({
        type: "rate_limit_event",
        uuid: crypto.randomUUID(),
        session_id: message.session_id,
        rate_limit_info: { status: "rejected", rateLimitType: "seven_day", resetsAt },
      })
      replies.push({ ...message, error: "rate_limit" as const })
      continue
    }
    if (message.type === "result" && message.subtype === "success") {
      const result = "You've hit your weekly limit · resets Mon 12:00am"
      replies.push({ ...message, is_error: true, result, api_error_status: 429 })
      continue
    }
    replies.push(message)
  }
  return { ...turn, replies }
}

// A normal reply whose turn still ends at a limit, after the text was shown.
function limitAfterText() {
  const turn = FakeClaude.expectTurn()
  const replies: SDKMessage[] = []
  for (const message of turn.replies as SDKMessage[]) {
    if (message.type === "result" && message.subtype === "success") {
      const reply = replies.findLast((item) => item.type === "assistant")!
      replies.push({ ...reply, error: "rate_limit" as const, message: { ...reply.message, content: [] } })
      replies.push({ ...message, is_error: true, result: "You've hit your limit", api_error_status: 429 })
      continue
    }
    replies.push(message)
  }
  return { ...turn, replies }
}

describe("Claude accounts", () => {
  test("configDir takes one folder or a list, expanding ~, and the login check uses the first", () => {
    const home = path.join(os.homedir(), ".claude-1")
    expect(ClaudeQueryOptions.configDirs("~/.claude-1")).toEqual([home])
    expect(ClaudeQueryOptions.configDirs(["~/.claude-1", "/tmp/claude-2"])).toEqual([
      home,
      path.resolve("/tmp/claude-2"),
    ])
    expect(ClaudeQueryOptions.configDirs("~")).toEqual([os.homedir()])
    // `~\` is a home path only on Windows.
    expect(ClaudeQueryOptions.configDirs("~\\.claude-1")).toEqual([
      process.platform === "win32" ? home : path.resolve("~\\.claude-1"),
    ])
    expect(ClaudeQueryOptions.configDirs(undefined)).toEqual([])
    const env = ClaudeQueryOptions.connectionEnv({ settings: { configDir: ["~/.claude-1", "/tmp/claude-2"] } })
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: home })
  })

  it.effect("a refused chat retries unseen on the next account and stays there", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        limitTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude, TestSessions.storage(), pool)
      const one = yield* TestSessions.reply(test.model, first)
      expect(TestSessions.text(one)).toBe("COPPER-OTTER")
      expect(one.some((part) => part.type === "error")).toBe(false)
      const two = yield* TestSessions.reply(test.model, TestSessions.followup())
      expect(TestSessions.text(two)).toBe("COPPER-OTTER")
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([a, b])
      expect(test.storage.data.get("accounts/session-a")).toBe(b)
      const status = yield* SubscriptionRef.get(test.input.status.state)
      expect(status.type === "ready" && status.configDir).toBe(b)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a new chat starts on the account that last worked", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        limitTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
      ])
      const saved = TestSessions.storage()
      const old = yield* TestSessions.start(claude, saved, pool)
      yield* TestSessions.reply(old.model, first)
      expect(saved.data.get("last-account")).toBe(b)
      // After a restart, a new chat skips the refused account.
      yield* old.registry.close()
      const test = yield* TestSessions.start(claude, saved, pool)
      const parts = yield* TestSessions.reply(test.model, first, "session-b")
      expect(TestSessions.text(parts)).toBe("COPPER-OTTER")
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([a, b, b])
      expect(saved.data.get("accounts/session-b")).toBe(b)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a side call starts on its chat's account and can rotate without moving the chat", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectStartup(),
        limitTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude, TestSessions.storage(), pool)
      yield* TestSessions.reply(test.model, first)
      const summary = yield* TestSessions.reply(
        test.model,
        TestSessions.followup("Summarize"),
        "session-a",
        "compaction",
      )
      expect(summary.some((part) => part.type === "error")).toBe(false)
      expect(claude.forks.map((fork) => fork.configDir)).toEqual([a])
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([a, a, b])
      expect(test.storage.data.get("accounts/session-a")).toBe(a)
      expect(test.storage.data.get("last-account")).toBe(b)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a limit after output is shown as an error, and the next turn moves", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        limitAfterText(),
        limitTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude, TestSessions.storage(), pool)
      const one = yield* TestSessions.reply(test.model, first)
      expect(TestSessions.text(one)).toBe("COPPER-OTTER")
      expect(one.at(-1)?.type).toBe("error")
      expect(test.storage.data.has("accounts/session-a")).toBe(false)
      // The next turn tries the first account again, which refuses unseen, then moves on.
      const two = yield* TestSessions.reply(test.model, TestSessions.followup())
      expect(two.some((part) => part.type === "error")).toBe(false)
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([a, b])
      expect(test.storage.data.get("accounts/session-a")).toBe(b)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("when every account refuses, the chat shows one error and keeps its account for the next request", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        limitTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        limitTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ index: 1 }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude, TestSessions.storage(), {
        configDir: [a, b],
      })
      yield* TestSessions.reply(test.model, first)
      // Like a model whose own limit is used up on every account.
      const refused = yield* TestSessions.reply(test.model, TestSessions.followup("Use the capped model"))
      const errors = refused.filter((part) => part.type === "error")
      expect(errors).toHaveLength(1)
      expect(String(errors[0]?.error)).toContain(new Date(resetsAt * 1000).toISOString())
      expect(test.storage.data.get("accounts/session-a")).toBe(a)
      expect(test.storage.data.get("last-account")).toBe(a)
      // Like switching to a model that still has room: it starts on the chat's own account and works.
      const two = yield* TestSessions.reply(test.model, TestSessions.followup())
      expect(TestSessions.text(two)).toBe("COPPER-OTTER")
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([a, b, a])
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a failure that is not a limit is shown without trying another account or moving the chat", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        limitTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn({ recording: "api-error" }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude, TestSessions.storage(), pool)
      const parts = yield* TestSessions.reply(test.model, first)
      expect(String(parts.find((part) => part.type === "error")?.error)).toContain("claude-does-not-exist")
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([a, b])
      expect(test.storage.data.has("accounts/session-a")).toBe(false)
      expect(test.storage.data.has("last-account")).toBe(false)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a logged-out account fails with the command to log in to its folder, without moving on", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup({ account: { tokenSource: "none", apiProvider: "firstParty" } }),
        FakeClaude.expectInterrupt(),
      ])
      const test = yield* TestSessions.start(claude, TestSessions.storage(), pool)
      const error = yield* TestSessions.reply(test.model, first).pipe(Effect.flip)
      expect(String(error.cause)).toContain(`"${a}"`)
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([a])
      expect(test.storage.data.has("accounts/session-a")).toBe(false)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a model with one configDir is pinned to it, even when it is refused", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([FakeClaude.expectStartup(), limitTurn(), FakeClaude.expectInterrupt()])
      const test = yield* TestSessions.start(claude, TestSessions.storage(), pool)
      const folder = path.resolve("/accounts/work")
      const work = yield* TestSessions.rotating(test.accounts, { configDir: folder })
      const parts = yield* TestSessions.reply(work, first)
      expect(String(parts.find((part) => part.type === "error")?.error)).toContain("Resets at")
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([folder])
      expect(test.storage.data.has("accounts/session-a")).toBe(false)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("an API key in settings skips rotation", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([FakeClaude.expectStartup(), limitTurn(), FakeClaude.expectInterrupt()])
      const test = yield* TestSessions.start(claude, TestSessions.storage(), pool)
      const keyed = yield* TestSessions.rotating(test.accounts, { ...pool, apiKey: "sk-test" })
      const parts = yield* TestSessions.reply(keyed, first, "session-key")
      expect(parts.some((part) => part.type === "error")).toBe(true)
      expect(claude.runs.map((run) => run.env.CLAUDE_CONFIG_DIR)).toEqual([a])
      expect(test.storage.data.has("accounts/session-key")).toBe(false)
      yield* test.registry.close()
      claude.check()
    }),
  )

  it.effect("a new fork starts on its parent's account and forks the parent's transcript", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        limitTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
      ])
      const saved = TestSessions.storage()
      const old = yield* TestSessions.start(claude, saved, pool)
      yield* TestSessions.reply(old.model, first)
      expect(saved.data.get("accounts/session-a")).toBe(b)
      // Move the newest account away, so only the parent's saved account can steer the fork there.
      saved.data.set("last-account", c)
      yield* old.registry.close()
      const test = yield* TestSessions.start(claude, saved, pool)
      const result = yield* Effect.promise(() =>
        test.model.doStream({
          prompt: TestSessions.followup("A forked question"),
          headers: {
            [RequestKind.HEADER]: "primary",
            [RequestKind.SESSION_HEADER]: "child-a",
            [RequestKind.FORK_HEADER]: "session-a",
          },
        }),
      )
      yield* Effect.promise(() => TestSessions.collect(result.stream))
      expect(claude.forks).toHaveLength(1)
      expect(claude.forks[0]!.configDir).toBe(b)
      expect(claude.runs.at(-1)!.env.CLAUDE_CONFIG_DIR).toBe(b)
      expect(test.storage.data.get("accounts/child-a")).toBe(b)
      yield* test.registry.close()
      claude.check()
    }),
  )
})
