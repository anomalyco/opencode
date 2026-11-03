import { describe, expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { DoomLoopPlugin } from "@opencode/core/plugin/doom-loop"
import { DoomLoopDetector } from "@opencode/core/plugin/doom-loop/detector"
import { DoomLoopFold } from "@opencode/core/plugin/doom-loop/fold"
import { Permission } from "@opencode/core/permission"
import { Provider } from "@opencode/core/provider"
import { RelativePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { toSessionError } from "@opencode/core/session/to-session-error"
import type { AssertInput } from "@opencode/plugin/permission"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { Event } from "@opencode/schema/event"
import { Money } from "@opencode/schema/money"
import { Shell } from "@opencode/schema/shell"
import { Tool } from "@opencode/schema/tool"
import { Cause, DateTime, Effect, Exit, Option, Queue, Stream } from "effect"
import type { Schema } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_doom_loop")
const agent = Agent.ID.make("build")

type BeforeHook = (input: ToolHooks["execute.before"]) => Effect.Effect<void, Tool.Error>
type AfterHook = (input: ToolHooks["execute.after"]) => Effect.Effect<void>
type Outcome = (input: AssertInput) => Effect.Effect<void, Tool.Error>

type Published =
  | SessionEvent.Deleted
  | SessionEvent.InboxEnqueued
  | SessionEvent.Step.Ended
  | SessionEvent.Compaction.Ended
  | SessionEvent.Execution.Succeeded
  | SessionEvent.Execution.Failed
  | SessionEvent.Execution.Interrupted

interface Harness {
  readonly before: BeforeHook
  readonly after: AfterHook
  readonly asserted: AssertInput[]
  readonly interrupts: () => number
  readonly setOutcome: (outcome: Outcome) => void
  readonly publish: (event: Published) => Effect.Effect<void, Error>
}

interface HarnessOptions {
  /** Durable history a restarted process would fold on first touch. */
  readonly history?: ReadonlyArray<SessionMessage.Info>
  /** Per-session histories, for multi-session scenarios; falls back to `history`. */
  readonly histories?: Readonly<Record<string, ReadonlyArray<SessionMessage.Info>>>
  /** Simulate a history read failure: the plugin must fall back to a fresh state. */
  readonly contextFails?: boolean
  /** Durable plugin KV; share one map across harness instances to simulate a restart. */
  readonly storage?: Map<string, Schema.Json>
  /** Factory-injected session cap (no global seam). */
  readonly maxTrackedSessions?: number
}

/** Boots the plugin against stubbed domains and returns its registered hooks plus spies. */
const run = Effect.fnUntraced(function* (options?: HarnessOptions) {
  const base = host()
  const kv = options?.storage ?? new Map<string, Schema.Json>()
  let beforeHook: BeforeHook | undefined
  let afterHook: AfterHook | undefined
  const asserted: AssertInput[] = []
  const outcome: { current: Outcome } = { current: () => Effect.void }
  let interrupts = 0
  const queue = yield* Queue.unbounded<Published>()
  yield* DoomLoopPlugin.makePlugin({ maxTrackedSessions: options?.maxTrackedSessions }).effect(
    host({
      permission: {
        ...base.permission,
        assert: (input) => {
          asserted.push(input)
          return outcome.current(input)
        },
      },
      tool: {
        ...base.tool,
        hook: (name, callback) => {
          if (name === "execute.before") {
            // Hook names and callbacks are correlated, but TypeScript does not narrow this generic registration API.
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            beforeHook = callback as unknown as BeforeHook
          }
          if (name === "execute.after") {
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            afterHook = callback as unknown as AfterHook
          }
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      event: {
        subscribe: () => Stream.fromQueue(queue),
      },
      storage: {
        get: (key) => Effect.succeed(kv.get(key)),
        set: (key, value) => Effect.sync(() => void kv.set(key, value)),
        remove: (key) => Effect.sync(() => void kv.delete(key)),
        scan: () => Effect.die("unused storage.scan"),
      },
      session: {
        interrupt: () =>
          Effect.sync(() => {
            interrupts++
            return { interrupted: true }
          }),
        context: (input) =>
          options?.contextFails === true
            ? Effect.die(new Error("history read failed"))
            : Effect.succeed(options?.histories?.[input.sessionID] ?? options?.history ?? []),
      },
    }),
  )
  if (!beforeHook || !afterHook) return yield* Effect.die("doom loop plugin did not register tool hooks")
  const publish = (event: Published) =>
    Effect.gen(function* () {
      yield* Queue.offer(queue, event)
      // Wait until the subscription fiber has applied the event before assertions run.
      yield* drained(queue)
    })
  return {
    before: beforeHook,
    after: afterHook,
    asserted,
    interrupts: () => interrupts,
    setOutcome: (next: Outcome) => {
      outcome.current = next
    },
    publish,
  } satisfies Harness
})

const beforeEvent = (
  tool: string,
  input: unknown,
  messageID: string,
  asSession: Session.ID = sessionID,
): ToolHooks["execute.before"] => ({
  tool,
  input,
  sessionID: asSession,
  agent,
  messageID: SessionMessage.ID.make(`msg_${messageID}`),
  id: Tool.CallID.make(`call_${messageID}`),
})

const completedEvent = (
  tool: string,
  input: unknown,
  messageID: string,
  result: Tool.Result,
  asSession: Session.ID = sessionID,
): ToolHooks["execute.after"] => ({
  ...beforeEvent(tool, input, messageID, asSession),
  status: "completed",
  result,
})

type ToolErrorEvent = Extract<ToolHooks["execute.after"], { readonly status: "error" }>

const errorEvent = (tool: string, input: unknown, messageID: string, error: Tool.Error): ToolErrorEvent => ({
  ...beforeEvent(tool, input, messageID),
  status: "error",
  error,
})

const durable = { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) }

const inboxEnqueued = (item: SessionInbox.Item): SessionEvent.InboxEnqueued => ({
  id: Event.ID.create(),
  created: 0,
  durable,
  type: "session.inbox.enqueued",
  data: { inboxID: SessionMessage.ID.make("msg_inb_doom"), sessionID, item },
})

const stepEnded = (files?: string[]): SessionEvent.Step.Ended => ({
  id: Event.ID.create(),
  created: 0,
  durable,
  type: "session.step.ended",
  data: {
    sessionID,
    assistantMessageID: SessionMessage.ID.make("msg_doom_step"),
    finish: "stop",
    cost: Money.USD.make(0),
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(files === undefined ? {} : { files: files.map((file) => RelativePath.make(file)) }),
  },
})

const compactionEnded: SessionEvent.Compaction.Ended = {
  id: Event.ID.create(),
  created: 0,
  durable,
  type: "session.compaction.ended",
  data: { sessionID, reason: "auto", text: "compacted" },
}

const executionSucceeded = (id: Session.ID): SessionEvent.Execution.Succeeded => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: id, seq: Event.Seq.make(0), version: Event.Version.make(1) },
  type: "session.execution.succeeded",
  data: { sessionID: id },
})

const sessionDeleted = (id: Session.ID): SessionEvent.Deleted => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: id, seq: Event.Seq.make(0), version: Event.Version.make(1) },
  type: "session.deleted",
  data: { sessionID: id },
})

// History fixtures: what SessionHistory.load("latest") would hand a restarted process.
const foldedAt = DateTime.makeUnsafe(0)
const foldedModel = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }

const foldedAssistant = (index: string, part: SessionMessage.AssistantTool): SessionMessage.Info =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make(`msg_fold_${index}`),
    type: "assistant",
    agent,
    model: foldedModel,
    content: [part],
    time: { created: foldedAt },
  })

const foldedCall = (
  index: string,
  tool: string,
  input: Record<string, unknown>,
  output: string,
  warning?: string,
): SessionMessage.Info =>
  foldedAssistant(
    index,
    SessionMessage.AssistantTool.make({
      type: "tool",
      id: `call_fold_${index}`,
      name: tool,
      state: SessionMessage.ToolStateCompleted.make({
        status: "completed",
        input,
        // A warning injected by the live after hook persists as a leading text part.
        content:
          warning === undefined
            ? [{ type: "text" as const, text: output }]
            : [
                { type: "text" as const, text: warning },
                { type: "text" as const, text: output },
              ],
      }),
      time: { created: foldedAt },
    }),
  )

const foldedFailure = (
  index: string,
  tool: string,
  input: Record<string, unknown>,
  message: string,
  options?: { readonly type?: string; readonly metadata?: Record<string, string> },
): SessionMessage.Info =>
  foldedAssistant(
    index,
    SessionMessage.AssistantTool.make({
      type: "tool",
      id: `call_fold_${index}`,
      name: tool,
      state: SessionMessage.ToolStateError.make({
        status: "error",
        input,
        // Real execution failures persist as "tool.execution" (to-session-error.ts).
        error: { type: options?.type ?? "tool.execution", message },
        ...(options?.metadata === undefined ? {} : { metadata: options.metadata }),
      }),
      time: { created: foldedAt },
    }),
  )

// A user-run shell command (Session.shell), which the fold must NOT count as a model tool call.
const foldedUserShell = (index: string, command: string): SessionMessage.Info =>
  SessionMessage.Shell.make({
    id: SessionMessage.ID.make(`msg_fold_shell_${index}`),
    type: "shell",
    shellID: Shell.ID.make(`sh_fold_${index}`),
    command,
    status: "exited",
    exit: 0,
    time: { created: foldedAt },
  })

// The model's background shell: a completed "shell" tool part whose receipt metadata says running.
const foldedBackgroundShell = (index: string, input: Record<string, unknown>): SessionMessage.Info =>
  foldedAssistant(
    index,
    SessionMessage.AssistantTool.make({
      type: "tool",
      id: `call_fold_${index}`,
      name: "shell",
      state: SessionMessage.ToolStateCompleted.make({
        status: "completed",
        input,
        content: [{ type: "text", text: "running" }],
        metadata: { status: "running" },
      }),
      time: { created: foldedAt },
    }),
  )

// Volatile-token normalization collapses digits to placeholders, so distinct fixture lines
// encode their index in letters.
const LETTERS = "abcdefghijklmnopqrstuvwxyz"
const lineTag = (i: number) =>
  `line-${LETTERS[Math.floor(i / 676) % 26]}${LETTERS[Math.floor(i / 26) % 26]}${LETTERS[i % 26]}`

const text = (value: string): Tool.Result => ({ content: [{ type: "text", text: value }] })

const findToolError = (exit: Exit.Exit<void, Tool.Error>) => Option.getOrUndefined(Exit.findErrorOption(exit))

const appendedText = (event: ToolHooks["execute.after"]): string => {
  if (event.status !== "completed" || !Array.isArray(event.result.content)) return ""
  return event.result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
}

const settle = (predicate: () => boolean, remaining = 1000): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (predicate()) return
    if (remaining === 0) return yield* Effect.fail(new Error("timed out waiting for async plugin work"))
    yield* Effect.promise(() => Bun.sleep(1))
    yield* settle(predicate, remaining - 1)
  })

// Polls until the plugin's forked subscription fiber takes the published event: the take →
// filter → runForEach chain runs synchronously per element, so a drained queue means the event
// has been applied. Bounded, and fails on timeout instead of trusting a fixed number of yields.
const drained = (queue: Queue.Queue<Published>, remaining = 1000): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if ((yield* Queue.size(queue)) === 0) return
    if (remaining === 0) return yield* Effect.fail(new Error("timed out waiting for the plugin event subscription"))
    yield* Effect.promise(() => Bun.sleep(1))
    yield* drained(queue, remaining - 1)
  })

// Drives one full emission through the hook pair: the after hook only runs when the before
// hook let the call through, mirroring how a blocked call never executes.
const emit = (
  h: Harness,
  tool: string,
  input: unknown,
  messageID: string,
  result: Tool.Result,
  asSession: Session.ID = sessionID,
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(h.before(beforeEvent(tool, input, messageID, asSession)))
    if (Exit.isSuccess(exit)) yield* h.after(completedEvent(tool, input, messageID, result, asSession))
    return exit
  })

describe("doom loop plugin", () => {
  it.effect("stacks the block copy on the mapped permission error at the A block tier", () =>
    Effect.gen(function* () {
      const h = yield* run()
      h.setOutcome(() => Effect.fail(new Tool.Error({ message: "Permission denied: doom_loop" })))
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      for (let i = 1; i <= 6; i++) {
        yield* emit(h, "grep", input, `blk_${i}`, text(out))
      }
      expect(h.asserted).toEqual([])
      const exit = yield* Effect.exit(h.before(beforeEvent("grep", input, "blk_7")))
      const error = findToolError(exit)
      expect(error).toBeInstanceOf(Tool.Error)
      expect(error?.message).toContain("blocked as a suspected repetition loop")
      expect(error?.message).toContain("Permission denied: doom_loop")
      // The bare resource string (no signal suffix) backs the always-save escape hatch.
      const sig = DoomLoopDetector.signature("grep", input)
      expect(h.asserted[0]?.action).toBe("doom_loop")
      expect(h.asserted[0]?.resources).toEqual([`grep:${sig}`])
      expect(h.asserted[0]?.save).toEqual([`grep:${sig}`])
    }),
  )

  it.effect(
    "keeps the stacked block copy model-visible through toSessionError for blocked and corrected outcomes",
    () =>
      Effect.gen(function* () {
        const input = { pattern: "TODO", path: "src" }
        const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
        // Simulate the host mapping (host.ts:438-449): a deny rule arrives as the generic denied
        // message, a rejection with feedback as the feedback text. Our hook must survive the
        // toSessionError chain with both its block copy and the host reason intact — attaching the
        // host error as the inner `error` of our Tool.Error would make toSessionError recurse to the
        // innermost message and drop our copy.
        const outcomes: Array<{ name: string; host: Tool.Error }> = [
          {
            name: "blocked",
            host: new Tool.Error({
              message: "Permission denied: doom_loop",
              error: new Permission.BlockedError({ rules: [], permission: "doom_loop", resources: ["*"] }),
            }),
          },
          {
            name: "corrected",
            host: new Tool.Error({
              message: "Use staging instead",
              error: new Permission.CorrectedError({ feedback: "Use staging instead" }),
            }),
          },
        ]
        for (const outcome of outcomes) {
          const h = yield* run()
          h.setOutcome(() => Effect.fail(outcome.host))
          for (let i = 1; i <= 6; i++) {
            yield* emit(h, "grep", input, `vis_${outcome.name}_${i}`, text(out))
          }
          const exit = yield* Effect.exit(h.before(beforeEvent("grep", input, `vis_${outcome.name}_7`)))
          const error = findToolError(exit)
          expect(error).toBeInstanceOf(Tool.Error)
          const sessionError = toSessionError(error)
          expect(sessionError.message).toContain("blocked as a suspected repetition loop")
          expect(sessionError.message).toContain(outcome.host.message)
        }
      }),
  )

  it.effect("allows the call on approval and keeps counting afterwards", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      for (let i = 1; i <= 7; i++) {
        const exit = yield* emit(h, "grep", input, `alw_${i}`, text(out))
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      // One ask at the 7th emission (A streak 6); approval does not clear the counters, so the
      // 8th identical emission asks again.
      expect(h.asserted).toHaveLength(1)
      const exit = yield* emit(h, "grep", input, "alw_8", text(out))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(2)
    }),
  )

  it.effect("lets a plain rejection stay a die defect instead of a Tool.Error", () =>
    Effect.gen(function* () {
      const h = yield* run()
      h.setOutcome(() => Effect.die(new Permission.DeclinedError()))
      const input = { filePath: "log.txt" }
      const out = "one\ntwo\nthree"
      yield* emit(h, "read", input, "dec_msg", text(out))
      yield* emit(h, "read", input, "dec_msg", text(out))
      const exit = yield* Effect.exit(h.before(beforeEvent("read", input, "dec_msg")))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(findToolError(exit)).toBeUndefined()
      if (!Exit.isFailure(exit)) return yield* Effect.die("expected the hook to fail")
      expect(
        exit.cause.reasons.some(
          (reason) => Cause.isDieReason(reason) && reason.defect instanceof Permission.DeclinedError,
        ),
      ).toBe(true)
    }),
  )

  it.effect("prepends the A warning to result.content without disturbing the original content", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      yield* emit(h, "grep", input, "app_1", text(out))
      yield* emit(h, "grep", input, "app_2", text(out))
      const third = completedEvent("grep", input, "app_3", text(out))
      yield* h.before(beforeEvent("grep", input, "app_3"))
      yield* h.after(third)
      expect(appendedText(third)).toContain("byte-identical output 3 times")
      if (third.status !== "completed") return yield* Effect.die("unreachable")
      const content = third.result.content
      if (!Array.isArray(content)) return yield* Effect.die("unreachable")
      // The warning leads the content: the runner's ToolOutput.truncate keeps the head of
      // oversized outputs, so a tail warning would be cut on huge outputs.
      if (content[0]?.type !== "text") return yield* Effect.die("unreachable")
      expect(content[0].text).toContain("byte-identical output 3 times")
      expect(content[1]).toEqual({ type: "text", text: out })
      // Hashing happened before the prepend: the 4th identical emission is accounted as
      // streak 4, so A does not warn a second time.
      const fourth = completedEvent("grep", input, "app_4", text(out))
      yield* h.before(beforeEvent("grep", input, "app_4"))
      yield* h.after(fourth)
      expect(appendedText(fourth)).not.toContain("byte-identical")
    }),
  )

  it.effect("appends the C warning to the error message of a failed call", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { filePath: "a.ts", oldString: "x" }
      const failure = () => new Tool.Error({ message: "String not found in document" })
      for (let i = 1; i <= 3; i++) {
        yield* Effect.exit(h.before(beforeEvent("edit", input, `err_${i}`)))
        yield* h.after(errorEvent("edit", input, `err_${i}`, failure()))
      }
      const event = errorEvent("edit", input, "err_4", failure())
      yield* h.before(beforeEvent("edit", input, "err_4"))
      yield* h.after(event)
      expect(event.error.message.startsWith("String not found in document")).toBe(true)
      expect(event.error.message).toContain("failed 4 times in a row")
      // C's warn tier is text-only: no permission ask has happened yet.
      expect(h.asserted).toEqual([])
    }),
  )

  it.effect("counts only the unobserved layer for background shells and asks once at the 7th emission", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { command: "nohup long-build &" }
      const running: Tool.Result = { content: [{ type: "text", text: "running" }], metadata: { status: "running" } }
      for (let i = 1; i <= 6; i++) {
        const exit = yield* emit(h, "shell", input, `bg_${i}`, running)
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      expect(h.asserted).toEqual([])
      const exit = yield* Effect.exit(h.before(beforeEvent("shell", input, "bg_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(1)
      const sig = DoomLoopDetector.signature("shell", input)
      expect(h.asserted[0]?.resources).toEqual([`shell:${sig}:unobserved`])
      // Decision ⑦: the save string carries the same per-signal suffix as resources, so an
      // "always" answer on the unobserved prompt never exempts another signal's prompt.
      expect(h.asserted[0]?.save).toEqual([`shell:${sig}:unobserved`])
      // One-shot: further emissions pass without asking again.
      const exit8 = yield* Effect.exit(h.before(beforeEvent("shell", input, "bg_8")))
      expect(Exit.isSuccess(exit8)).toBe(true)
      expect(h.asserted).toHaveLength(1)
      // The six background receipts fed none of A/B/C: foreground calls of the same tool with
      // identical output now feed A normally and warn at the 3rd accounting.
      const foreground = "build finished\nwith output\nin three lines"
      for (let i = 9; i <= 10; i++) {
        const exitN = yield* emit(h, "shell", input, `bg_${i}`, text(foreground))
        expect(Exit.isSuccess(exitN)).toBe(true)
      }
      const third = completedEvent("shell", input, "bg_11", text(foreground))
      yield* h.before(beforeEvent("shell", input, "bg_11"))
      yield* h.after(third)
      expect(appendedText(third)).toContain("byte-identical output 3 times")
      expect(h.asserted).toHaveLength(1)
    }),
  )

  it.effect("asks once for the guard at the 3rd emission and once for the unobserved tier at the 7th", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { command: "nohup build &" }
      const running: Tool.Result = { content: [{ type: "text", text: "running" }], metadata: { status: "running" } }
      for (let i = 1; i <= 8; i++) {
        const exit = yield* Effect.exit(h.before(beforeEvent("shell", input, "combo")))
        expect(Exit.isSuccess(exit)).toBe(true)
        yield* h.after(completedEvent("shell", input, "combo", running))
      }
      const sig = DoomLoopDetector.signature("shell", input)
      expect(h.asserted.map((input) => input.resources)).toEqual([[`shell:${sig}:repeat`], [`shell:${sig}:unobserved`]])
      // Decision ⑦: each signal's save string carries its own suffix; allowing the guard prompt
      // must not silently allow the unobserved prompt for the same signature.
      expect(h.asserted.map((input) => input.save)).toEqual([[`shell:${sig}:repeat`], [`shell:${sig}:unobserved`]])
    }),
  )

  it.effect("skips the outer execute call entirely", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { task: "run tests" }
      for (let i = 1; i <= 3; i++) {
        const exit = yield* emit(h, "execute", input, "exec_msg", text("executed"))
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      expect(h.asserted).toEqual([])
      // The identical receipts of the skipped calls fed no detector: a fresh foreground tool
      // sequence reaches its own block tier exactly on schedule.
      const input2 = { command: "git status" }
      const out2 = "on branch main\nnothing to commit\nclean tree"
      for (let i = 1; i <= 6; i++) {
        yield* emit(h, "shell", input2, `post_${i}`, text(out2))
      }
      expect(h.asserted).toEqual([])
      const exit = yield* Effect.exit(h.before(beforeEvent("shell", input2, "post_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      // The A block tier fired exactly at the 7th shell emission — the skipped execute
      // receipts fed none of the counters.
      expect(h.asserted).toHaveLength(1)
      expect(h.asserted[0]?.resources).toEqual([`shell:${DoomLoopDetector.signature("shell", input2)}`])
    }),
  )

  it.effect("hard-stops with a Tool.Error and interrupts the session at the circuit tier", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { command: "probe" }
      // Raw output changes every call (so A never blocks) while the normalized lines stay
      // identical (so every call after the first is zero-gain for B).
      const out = (i: number) => `probe ${i}\nstatic line one\nstatic line two`
      for (let i = 1; i <= 13; i++) {
        const exit = yield* emit(h, "shell", input, `ci_${i}`, text(out(i)))
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      h.setOutcome(() => Effect.fail(new Tool.Error({ message: "Permission denied: doom_loop" })))
      const exit = yield* Effect.exit(h.before(beforeEvent("shell", input, "ci_14")))
      const error = findToolError(exit)
      expect(error).toBeInstanceOf(Tool.Error)
      expect(error?.message).toContain("Stop making tool calls entirely")
      // The denied circuit asks once through doom_loop, then becomes sticky without re-asking.
      expect(h.asserted).toHaveLength(1)
      yield* settle(() => h.interrupts() === 1)
      // A retry during circuit hits the same hard stop and never reaches the repeat guard.
      const retry = yield* Effect.exit(h.before(beforeEvent("shell", input, "ci_14")))
      expect(findToolError(retry)?.message).toContain("Stop making tool calls entirely")
      expect(h.asserted).toHaveLength(1)
      yield* settle(() => h.interrupts() === 2)
    }),
  )

  it.effect("resets B and lets the run continue when the circuit ask is allowed", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { command: "probe" }
      const out = (i: number) => `probe ${i}\nstatic line one\nstatic line two`
      for (let i = 1; i <= 13; i++) {
        yield* emit(h, "shell", input, `al_${i}`, text(out(i)))
      }
      // Default outcome allows the circuit ask: no interrupt, and B resets so the run continues.
      const exit = yield* Effect.exit(h.before(beforeEvent("shell", input, "al_14")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(1)
      const next = yield* Effect.exit(h.before(beforeEvent("shell", input, "al_15")))
      expect(Exit.isSuccess(next)).toBe(true)
    }),
  )

  it.effect("re-arms the circuit breaker only on real user messages, not synthetic ones", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { command: "probe" }
      const out = (i: number) => `probe ${i}\nstatic line one\nstatic line two`
      for (let i = 1; i <= 13; i++) {
        yield* emit(h, "shell", input, `ev_${i}`, text(out(i)))
      }
      h.setOutcome(() => Effect.fail(new Tool.Error({ message: "Permission denied: doom_loop" })))
      const circuits = () =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(h.before(beforeEvent("shell", input, "ev_live")))
          return findToolError(exit)?.message.includes("Stop making tool calls entirely") === true
        })
      expect(yield* circuits()).toBe(true)
      // A synthetic inbox item (our own injection channel) must not re-arm the breaker.
      yield* h.publish(inboxEnqueued({ type: "synthetic", payload: { text: "keep going" }, delivery: "steer" }))
      expect(yield* circuits()).toBe(true)
      // A real user message clears bStreak and re-arms the breaker.
      yield* h.publish(inboxEnqueued({ type: "user", payload: { text: "stop that" }, delivery: "queue" }))
      const exit = yield* Effect.exit(h.before(beforeEvent("shell", input, "ev_live")))
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect("maps step.ended file changes to a bStreak reset", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { command: "git status" }
      const seed = "fresh seed\nstatic one\nstatic two\nstatic three"
      const zero = "static one\nstatic two\nstatic three"
      // Seed the line store, then climb to bStreak 2 with zero-gain calls.
      yield* emit(h, "shell", input, "sf_1", text(seed))
      yield* emit(h, "shell", input, "sf_2", text(zero))
      yield* emit(h, "shell", input, "sf_3", text(zero))
      // A real file change resets the streak: the next zero-gain call stays silent.
      yield* h.publish(stepEnded(["src/a.ts"]))
      const calm = completedEvent("shell", input, "sf_4", text(zero))
      yield* h.before(beforeEvent("shell", input, "sf_4"))
      yield* h.after(calm)
      expect(appendedText(calm)).not.toContain("no new information")
      // An empty file list is not a file change: the streak keeps climbing and warns at 3.
      const h2 = yield* run()
      yield* emit(h2, "shell", input, "se_1", text(seed))
      yield* emit(h2, "shell", input, "se_2", text(zero))
      yield* emit(h2, "shell", input, "se_3", text(zero))
      yield* h2.publish(stepEnded([]))
      const warned = completedEvent("shell", input, "se_4", text(zero))
      yield* h2.before(beforeEvent("shell", input, "se_4"))
      yield* h2.after(warned)
      expect(appendedText(warned)).toContain("no new information")
    }),
  )

  it.effect("zeroes A streaks when compaction ends", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      for (let i = 1; i <= 3; i++) {
        yield* emit(h, "grep", input, `cp_${i}`, text(out))
      }
      yield* h.publish(compactionEnded)
      // A's streak was zeroed: three identical emissions after compaction warn again at the
      // 3rd accounting instead of moving towards the block tier.
      yield* emit(h, "grep", input, "cp2_1", text(out))
      yield* emit(h, "grep", input, "cp2_2", text(out))
      expect(h.asserted).toEqual([])
      const third = completedEvent("grep", input, "cp2_3", text(out))
      yield* h.before(beforeEvent("grep", input, "cp2_3"))
      yield* h.after(third)
      expect(appendedText(third)).toContain("byte-identical output 3 times")
      expect(h.asserted).toEqual([])
    }),
  )

  it.effect("tightens the line store to the newest 1000 lines when an execution ends", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { command: "flood" }
      const flood = Array.from({ length: 1100 }, (_, i) => lineTag(i)).join("\n")
      yield* emit(h, "shell", input, "tn_1", text(flood))
      yield* h.publish(executionSucceeded(sessionID))
      // The execution-end tighten evicted the oldest lines: re-emitting only those reads as
      // novel again, so three identical accountings stay silent. Without the tighten the third
      // zero-gain accounting would warn "no new information".
      const old = [lineTag(0), lineTag(1), lineTag(2)].join("\n")
      for (let i = 2; i <= 4; i++) {
        const event = completedEvent("shell", input, `tn_${i}`, text(old))
        yield* h.before(beforeEvent("shell", input, `tn_${i}`))
        yield* h.after(event)
        expect(appendedText(event)).not.toContain("no new information")
      }
    }),
  )

  it.effect("tightens the folded line store to the newest 1000 lines, matching the live steady state", () =>
    Effect.gen(function* () {
      const flood = Array.from({ length: 1100 }, (_, i) => lineTag(i)).join("\n")
      const state = DoomLoopDetector.state()
      DoomLoopFold.fold(state, [foldedCall("fold_tn_1", "shell", { command: "flood" }, flood)])
      expect(state.lines.order.length).toBe(1000)
      expect(state.lines.set.size).toBe(1000)
      expect(state.lines.order[0]).toBe(lineTag(100))
    }),
  )

  it.effect("evicts the least recently touched session past the cap and re-folds it from history", () =>
    Effect.gen(function* () {
      const sesA = Session.ID.make("ses_lru_a")
      const sesB = Session.ID.make("ses_lru_b")
      const sesC = Session.ID.make("ses_lru_c")
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      const h = yield* run({
        histories: { [sesA]: [foldedCall("lru_a1", "grep", input, out), foldedCall("lru_a2", "grep", input, out)] },
        maxTrackedSessions: 2,
      })
      // A folds its two historical calls; the third identical accounting warns.
      const a3 = completedEvent("grep", input, "lru_a3", text(out), sesA)
      yield* h.before(beforeEvent("grep", input, "lru_a3", sesA))
      yield* h.after(a3)
      expect(appendedText(a3)).toContain("byte-identical output 3 times")
      // B builds a live streak of two.
      yield* emit(h, "grep", { pattern: "b" }, "lru_b1", text("b one"), sesB)
      yield* emit(h, "grep", { pattern: "b" }, "lru_b2", text("b one"), sesB)
      // C's first touch pushes the map past the cap and evicts A, the oldest entry.
      yield* emit(h, "grep", { pattern: "c" }, "lru_c1", text("c one"), sesC)
      // B was touched after A and survives: its third identical accounting warns.
      const b3 = completedEvent("grep", { pattern: "b" }, "lru_b3", text("b one"), sesB)
      yield* h.before(beforeEvent("grep", { pattern: "b" }, "lru_b3", sesB))
      yield* h.after(b3)
      expect(appendedText(b3)).toContain("byte-identical output 3 times")
      // A re-folds from history on its next touch: the rebuilt streak of two plus this
      // accounting warns at three — a continued live streak would be four and stay silent.
      const a4 = completedEvent("grep", input, "lru_a4", text(out), sesA)
      yield* h.before(beforeEvent("grep", input, "lru_a4", sesA))
      yield* h.after(a4)
      expect(appendedText(a4)).toContain("byte-identical output 3 times")
    }),
  )

  it.effect("keeps a tripped breaker across a cache eviction via plugin KV", () =>
    Effect.gen(function* () {
      const sesA = Session.ID.make("ses_lru_circuit_a")
      const sesB = Session.ID.make("ses_lru_circuit_b")
      const sesC = Session.ID.make("ses_lru_circuit_c")
      const h = yield* run({ maxTrackedSessions: 2 })
      const input = { command: "probe" }
      const out = (i: number) => `probe ${i}\nstatic line one\nstatic line two`
      for (let i = 1; i <= 13; i++) {
        yield* emit(h, "shell", input, `lc_${i}`, text(out(i)), sesA)
      }
      // A denied circuit trips the sticky stop.
      h.setOutcome(() => Effect.fail(new Tool.Error({ message: "Permission denied: doom_loop" })))
      const tripped = yield* Effect.exit(h.before(beforeEvent("shell", input, "lc_14", sesA)))
      expect(findToolError(tripped)?.message).toContain("Stop making tool calls entirely")
      yield* settle(() => h.interrupts() === 1)
      // Two other sessions push A out of the cache.
      yield* emit(h, "grep", { pattern: "b" }, "lc_b1", text("b one"), sesB)
      yield* emit(h, "grep", { pattern: "c" }, "lc_c1", text("c one"), sesC)
      // A's in-memory entry is gone, but the breaker survives in KV: the re-folded state still
      // hard-stops the next call.
      const again = yield* Effect.exit(h.before(beforeEvent("shell", input, "lc_15", sesA)))
      expect(findToolError(again)?.message).toContain("Stop making tool calls entirely")
      expect(h.asserted).toHaveLength(1)
      yield* settle(() => h.interrupts() === 2)
    }),
  )

  it.effect("folds durable history into A on first touch and challenges the 7th identical emission", () =>
    Effect.gen(function* () {
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      const history = Array.from({ length: 6 }, (_, i) => foldedCall(`a_${i}`, "grep", input, out))
      // A restarted process has done no live accounting, but the fold rebuilds the streak.
      const h = yield* run({ history })
      const exit = yield* Effect.exit(h.before(beforeEvent("grep", input, "fold_a_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(1)
      expect(h.asserted[0]?.resources).toEqual([`grep:${DoomLoopDetector.signature("grep", input)}`])
    }),
  )

  it.effect("folds durable failures into C so the next failure warns at the 4th accounting", () =>
    Effect.gen(function* () {
      const input = { filePath: "a.ts", oldString: "x" }
      const history = Array.from({ length: 3 }, (_, i) =>
        foldedFailure(`c_${i}`, "edit", input, "String not found in document"),
      )
      const h = yield* run({ history })
      const event = errorEvent("edit", input, "fold_c_4", new Tool.Error({ message: "String not found in document" }))
      yield* h.before(beforeEvent("edit", input, "fold_c_4"))
      yield* h.after(event)
      expect(event.error.message).toContain("failed 4 times in a row")
    }),
  )

  it.effect("skips blocked and declined calls persisted as error parts when folding", () =>
    Effect.gen(function* () {
      const input = { filePath: "a.ts", oldString: "x" }
      // Six before-hook rejections (marked) plus two declines: none executed, none may feed C.
      const history = [
        ...Array.from({ length: 6 }, (_, i) =>
          foldedFailure(`blk_${i}`, "edit", input, DoomLoopDetector.copy.blockA("edit", 6 + i), {
            metadata: { doom_loop: "blocked" },
          }),
        ),
        foldedFailure("dec_1", "edit", input, "The user declined this tool call", { type: "aborted" }),
        foldedFailure("dec_2", "edit", input, "The user declined this tool call", { type: "aborted" }),
      ]
      const h = yield* run({ history })
      // Had the fold counted them, C would already sit past the block tier and this call — with
      // entirely different arguments — would be challenged before executing.
      const exit = yield* Effect.exit(h.before(beforeEvent("edit", { filePath: "b.ts" }, "sk_probe")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toEqual([])
      // Real failures count from zero: the first three stay silent, the fourth warns.
      for (let i = 1; i <= 3; i++) {
        const event = errorEvent("edit", input, `sk_f${i}`, new Tool.Error({ message: "String not found in document" }))
        yield* h.before(beforeEvent("edit", input, `sk_f${i}`))
        yield* h.after(event)
        expect(event.error.message).toBe("String not found in document")
      }
      const fourth = errorEvent("edit", input, "sk_f4", new Tool.Error({ message: "String not found in document" }))
      yield* h.before(beforeEvent("edit", input, "sk_f4"))
      yield* h.after(fourth)
      expect(fourth.error.message).toContain("failed 4 times in a row")
    }),
  )

  it.effect("strips injected warnings so the rebuilt A streak matches live accounting", () =>
    Effect.gen(function* () {
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      // The 3rd identical call carried the A warning in its persisted content; live hashed the
      // output before the prepend, so the fold must strip it to rebuild the full streak.
      const history = Array.from({ length: 6 }, (_, i) =>
        foldedCall(`w_${i}`, "grep", input, out, i === 2 ? DoomLoopDetector.copy.warnA("grep", 3) : undefined),
      )
      const h = yield* run({ history })
      const exit = yield* Effect.exit(h.before(beforeEvent("grep", input, "w_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(1)
      expect(h.asserted[0]?.resources).toEqual([`grep:${DoomLoopDetector.signature("grep", input)}`])
    }),
  )

  it.effect("strips the injected C warning from folded failures so the block tier stays on schedule", () =>
    Effect.gen(function* () {
      const input = { filePath: "a.ts", oldString: "x" }
      const failure = "String not found in document"
      // Five consecutive failures; the 4th carried the C warning in its persisted message.
      const history = Array.from({ length: 5 }, (_, i) =>
        foldedFailure(
          `cw_${i}`,
          "edit",
          input,
          i === 3 ? `${failure}${DoomLoopDetector.injectedFailureSuffix("edit")}` : failure,
        ),
      )
      const h = yield* run({ history })
      // The rebuilt streak is 5: the 6th accounting stays silent (the warning fired only at 4)...
      const event = errorEvent("edit", input, "cw_6", new Tool.Error({ message: failure }))
      yield* h.before(beforeEvent("edit", input, "cw_6"))
      yield* h.after(event)
      expect(event.error.message).toBe(failure)
      // ...and the next emission hits the C block tier exactly on schedule. Had the injected
      // warning been hashed, the rebuilt streak would be 2 and this block would be lost.
      const exit = yield* Effect.exit(h.before(beforeEvent("edit", input, "cw_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(1)
      expect(h.asserted[0]?.action).toBe("doom_loop")
    }),
  )

  it.effect("folds background shell receipts into the unobserved layer but ignores user shell messages", () =>
    Effect.gen(function* () {
      const input = { command: "nohup long-build &" }
      const history = [
        foldedBackgroundShell("u_1", input),
        foldedUserShell("u_1", "ls"),
        foldedBackgroundShell("u_2", input),
        foldedUserShell("u_2", "pwd"),
        foldedBackgroundShell("u_3", input),
        foldedUserShell("u_3", "git status"),
      ]
      const h = yield* run({ history })
      const running: Tool.Result = { content: [{ type: "text", text: "running" }], metadata: { status: "running" } }
      // The fold counted only the three model receipts: two more stay under the prompt tier.
      for (let i = 4; i <= 5; i++) {
        const exit = yield* emit(h, "shell", input, `fu_${i}`, running)
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      expect(h.asserted).toEqual([])
      // The sixth accounting arms the one-time prompt, which fires at the next emission.
      yield* emit(h, "shell", input, "fu_6", running)
      const exit = yield* Effect.exit(h.before(beforeEvent("shell", input, "fu_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(1)
      const sig = DoomLoopDetector.signature("shell", input)
      expect(h.asserted[0]?.resources).toEqual([`shell:${sig}:unobserved`])
    }),
  )

  it.effect("falls back to a fresh state when the history read fails", () =>
    Effect.gen(function* () {
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      // This history would rebuild a block-tier streak, but the read fails: detection restarts
      // from zero rather than failing the tool call.
      const history = Array.from({ length: 6 }, (_, i) => foldedCall(`f_${i}`, "grep", input, out))
      const h = yield* run({ history, contextFails: true })
      for (let i = 1; i <= 6; i++) {
        const exit = yield* emit(h, "grep", input, `ff_${i}`, text(out))
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      expect(h.asserted).toEqual([])
      const exit = yield* Effect.exit(h.before(beforeEvent("grep", input, "ff_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(1)
    }),
  )

  it.effect("persists the circuit breaker across a restart and re-arms on a real user message", () =>
    Effect.gen(function* () {
      const storage = new Map<string, Schema.Json>()
      const h1 = yield* run({ storage })
      const input = { command: "probe" }
      // Raw output changes every call (A never blocks) while the normalized lines stay identical
      // (every call after the first is zero-gain for B).
      const out = (i: number) => `probe ${i}\nstatic line one\nstatic line two`
      for (let i = 1; i <= 13; i++) {
        yield* emit(h1, "shell", input, `rs_${i}`, text(out(i)))
      }
      h1.setOutcome(() => Effect.fail(new Tool.Error({ message: "Permission denied: doom_loop" })))
      const tripped = yield* Effect.exit(h1.before(beforeEvent("shell", input, "rs_14")))
      expect(findToolError(tripped)?.message).toContain("Stop making tool calls entirely")
      yield* settle(() => h1.interrupts() === 1)
      expect(storage.has(`circuit:${sessionID}`)).toBe(true)
      // A restarted process (fresh plugin, same durable KV) restores the breaker with no history
      // at all: the very first call is hard-stopped again.
      const h2 = yield* run({ storage })
      const blocked = yield* Effect.exit(h2.before(beforeEvent("shell", input, "rs_15")))
      expect(findToolError(blocked)?.message).toContain("Stop making tool calls entirely")
      yield* settle(() => h2.interrupts() === 1)
      // A real user message re-arms the breaker in both the state and the durable key.
      yield* h2.publish(inboxEnqueued({ type: "user", payload: { text: "stop that" }, delivery: "queue" }))
      yield* settle(() => !storage.has(`circuit:${sessionID}`))
      const exit = yield* Effect.exit(h2.before(beforeEvent("shell", input, "rs_16")))
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect("clears a persisted circuit when the session is deleted", () =>
    Effect.gen(function* () {
      const storage = new Map<string, Schema.Json>()
      const h = yield* run({ storage })
      const input = { command: "probe" }
      const out = (i: number) => `probe ${i}\nstatic line one\nstatic line two`
      for (let i = 1; i <= 13; i++) {
        yield* emit(h, "shell", input, `dc_${i}`, text(out(i)))
      }
      h.setOutcome(() => Effect.fail(new Tool.Error({ message: "Permission denied: doom_loop" })))
      const tripped = yield* Effect.exit(h.before(beforeEvent("shell", input, "dc_14")))
      expect(findToolError(tripped)?.message).toContain("Stop making tool calls entirely")
      expect(storage.has(`circuit:${sessionID}`)).toBe(true)
      yield* h.publish(sessionDeleted(sessionID))
      yield* settle(() => !storage.has(`circuit:${sessionID}`))
      // Deletion dropped both the entry and the persisted breaker: the next call folds the empty
      // history into a fresh state and passes.
      const exit = yield* Effect.exit(h.before(beforeEvent("shell", input, "dc_15")))
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect("forgets a session wholesale on session.deleted and restarts its counters from zero", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { pattern: "TODO", path: "src" }
      const out = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      for (let i = 1; i <= 6; i++) {
        yield* emit(h, "grep", input, `del_${i}`, text(out))
      }
      yield* h.publish(sessionDeleted(sessionID))
      // The deleted session's state is gone: the 7th identical emission is not challenged...
      const exit = yield* Effect.exit(h.before(beforeEvent("grep", input, "del_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toEqual([])
      // ...and counting restarts from zero: the 3rd identical accounting after deletion warns.
      yield* emit(h, "grep", input, "del_8", text(out))
      yield* emit(h, "grep", input, "del_9", text(out))
      const third = completedEvent("grep", input, "del_10", text(out))
      yield* h.before(beforeEvent("grep", input, "del_10"))
      yield* h.after(third)
      expect(appendedText(third)).toContain("byte-identical output 3 times")
      expect(h.asserted).toEqual([])
    }),
  )

  it.effect("routes the question tool through the unobserved layer and asks once at the 7th emission", () =>
    Effect.gen(function* () {
      const h = yield* run()
      const input = { question: "Continue?" }
      for (let i = 1; i <= 6; i++) {
        const exit = yield* emit(h, "question", input, `q_${i}`, text("approved"))
        expect(Exit.isSuccess(exit)).toBe(true)
      }
      expect(h.asserted).toEqual([])
      const exit = yield* Effect.exit(h.before(beforeEvent("question", input, "q_7")))
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(h.asserted).toHaveLength(1)
      const sig = DoomLoopDetector.signature("question", input)
      expect(h.asserted[0]?.resources).toEqual([`question:${sig}:unobserved`])
      expect(h.asserted[0]?.save).toEqual([`question:${sig}:unobserved`])
    }),
  )
})
