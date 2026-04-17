import { describe, expect, test } from "bun:test"
import * as DateTime from "effect/DateTime"
import * as FastCheck from "effect/testing/FastCheck"
import { SessionEntry } from "../../src/v2/session-entry"
import { SessionEvent } from "../../src/v2/session-event"

const time = (n: number) => DateTime.makeUnsafe(n)

const word = FastCheck.string({ minLength: 1, maxLength: 8 })
const text = FastCheck.string({ maxLength: 16 })
const texts = FastCheck.array(text, { maxLength: 8 })
const val = FastCheck.oneof(FastCheck.boolean(), FastCheck.integer(), FastCheck.string({ maxLength: 12 }))
const dict = FastCheck.dictionary(word, val, { maxKeys: 4 })
const files = FastCheck.array(
  word.map((x) => SessionEvent.FileAttachment.create({ uri: `file://${encodeURIComponent(x)}`, mime: "text/plain" })),
  { maxLength: 2 },
)

function maybe<A>(arb: FastCheck.Arbitrary<A>) {
  return FastCheck.oneof(FastCheck.constant(undefined), arb)
}

function assistant() {
  return new SessionEntry.Assistant({
    id: SessionEvent.ID.create(),
    type: "assistant",
    time: { created: time(0) },
    content: [],
  })
}

function history() {
  const state: SessionEntry.History = {
    entries: [],
    pending: [],
  }
  return state
}

function active() {
  const state: SessionEntry.History = {
    entries: [assistant()],
    pending: [],
  }
  return state
}

function run(events: SessionEvent.Event[], state = history()) {
  return events.reduce<SessionEntry.History>((state, event) => SessionEntry.step(state, event), state)
}

function last(state: SessionEntry.History) {
  const entry = [...state.pending, ...state.entries].reverse().find((x) => x.type === "assistant")
  expect(entry?.type).toBe("assistant")
  return entry?.type === "assistant" ? entry : undefined
}

function texts_of(state: SessionEntry.History) {
  const entry = last(state)
  if (!entry) return []
  return entry.content.filter((x): x is SessionEntry.AssistantText => x.type === "text")
}

function reasons(state: SessionEntry.History) {
  const entry = last(state)
  if (!entry) return []
  return entry.content.filter((x): x is SessionEntry.AssistantReasoning => x.type === "reasoning")
}

function tools(state: SessionEntry.History) {
  const entry = last(state)
  if (!entry) return []
  return entry.content.filter((x): x is SessionEntry.AssistantTool => x.type === "tool")
}

function tool(state: SessionEntry.History, callID: string) {
  return tools(state).find((x) => x.callID === callID)
}

describe("session-entry step", () => {
  describe("seeded pending assistant", () => {
    test("stores prompts in entries when no assistant is pending", () => {
      FastCheck.assert(
        FastCheck.property(word, (body) => {
          const next = SessionEntry.step(history(), SessionEvent.Prompt.create({ text: body, timestamp: time(1) }))
          expect(next.entries).toHaveLength(1)
          expect(next.entries[0]?.type).toBe("user")
          if (next.entries[0]?.type !== "user") return
          expect(next.entries[0].text).toBe(body)
        }),
        { numRuns: 50 },
      )
    })

    test("stores prompts in pending when an assistant is pending", () => {
      FastCheck.assert(
        FastCheck.property(word, (body) => {
          const next = SessionEntry.step(active(), SessionEvent.Prompt.create({ text: body, timestamp: time(1) }))
          expect(next.pending).toHaveLength(1)
          expect(next.pending[0]?.type).toBe("user")
          if (next.pending[0]?.type !== "user") return
          expect(next.pending[0].text).toBe(body)
        }),
        { numRuns: 50 },
      )
    })

    test("accumulates text deltas on the latest text part", () => {
      FastCheck.assert(
        FastCheck.property(texts, (parts) => {
          const next = parts.reduce(
            (state, part, i) =>
              SessionEntry.step(state, SessionEvent.Text.Delta.create({ delta: part, timestamp: time(i + 2) })),
            SessionEntry.step(active(), SessionEvent.Text.Started.create({ timestamp: time(1) })),
          )

          expect(texts_of(next)).toEqual([
            {
              type: "text",
              text: parts.join(""),
            },
          ])
        }),
        { numRuns: 100 },
      )
    })

    test("routes later text deltas to the latest text segment", () => {
      FastCheck.assert(
        FastCheck.property(texts, texts, (a, b) => {
          const next = run(
            [
              SessionEvent.Text.Started.create({ timestamp: time(1) }),
              ...a.map((x, i) => SessionEvent.Text.Delta.create({ delta: x, timestamp: time(i + 2) })),
              SessionEvent.Text.Started.create({ timestamp: time(a.length + 2) }),
              ...b.map((x, i) => SessionEvent.Text.Delta.create({ delta: x, timestamp: time(i + a.length + 3) })),
            ],
            active(),
          )

          expect(texts_of(next)).toEqual([
            { type: "text", text: a.join("") },
            { type: "text", text: b.join("") },
          ])
        }),
        { numRuns: 50 },
      )
    })

    test("reasoning.ended replaces buffered reasoning text", () => {
      FastCheck.assert(
        FastCheck.property(texts, text, (parts, end) => {
          const next = run(
            [
              SessionEvent.Reasoning.Started.create({ timestamp: time(1) }),
              ...parts.map((x, i) => SessionEvent.Reasoning.Delta.create({ delta: x, timestamp: time(i + 2) })),
              SessionEvent.Reasoning.Ended.create({ text: end, timestamp: time(parts.length + 2) }),
            ],
            active(),
          )

          expect(reasons(next)).toEqual([
            {
              type: "reasoning",
              text: end,
            },
          ])
        }),
        { numRuns: 100 },
      )
    })

    test("tool.success completes the latest running tool", () => {
      FastCheck.assert(
        FastCheck.property(
          word,
          word,
          dict,
          maybe(text),
          maybe(dict),
          maybe(files),
          texts,
          (callID, title, input, output, metadata, attachments, parts) => {
            const next = run(
              [
                SessionEvent.Tool.Input.Started.create({ callID, name: "bash", timestamp: time(1) }),
                ...parts.map((x, i) =>
                  SessionEvent.Tool.Input.Delta.create({ callID, delta: x, timestamp: time(i + 2) }),
                ),
                SessionEvent.Tool.Called.create({
                  callID,
                  tool: "bash",
                  input,
                  provider: { executed: true },
                  timestamp: time(parts.length + 2),
                }),
                SessionEvent.Tool.Success.create({
                  callID,
                  title,
                  output,
                  metadata,
                  attachments,
                  provider: { executed: true },
                  timestamp: time(parts.length + 3),
                }),
              ],
              active(),
            )

            const match = tool(next, callID)
            expect(match?.state.status).toBe("completed")
            if (match?.state.status !== "completed") return

            expect(match.time.ran).toEqual(time(parts.length + 2))
            expect(match.state.input).toEqual(input)
            expect(match.state.output).toBe(output ?? "")
            expect(match.state.title).toBe(title)
            expect(match.state.metadata).toEqual(metadata ?? {})
            expect(match.state.attachments).toEqual(attachments ?? [])
          },
        ),
        { numRuns: 50 },
      )
    })

    test("tool.error completes the latest running tool with an error", () => {
      FastCheck.assert(
        FastCheck.property(word, dict, word, maybe(dict), (callID, input, error, metadata) => {
          const next = run(
            [
              SessionEvent.Tool.Input.Started.create({ callID, name: "bash", timestamp: time(1) }),
              SessionEvent.Tool.Called.create({
                callID,
                tool: "bash",
                input,
                provider: { executed: true },
                timestamp: time(2),
              }),
              SessionEvent.Tool.Error.create({
                callID,
                error,
                metadata,
                provider: { executed: true },
                timestamp: time(3),
              }),
            ],
            active(),
          )

          const match = tool(next, callID)
          expect(match?.state.status).toBe("error")
          if (match?.state.status !== "error") return

          expect(match.time.ran).toEqual(time(2))
          expect(match.state.input).toEqual(input)
          expect(match.state.error).toBe(error)
          expect(match.state.metadata).toEqual(metadata ?? {})
        }),
        { numRuns: 50 },
      )
    })

    test("tool.success is ignored before tool.called promotes the tool to running", () => {
      FastCheck.assert(
        FastCheck.property(word, word, (callID, title) => {
          const next = run(
            [
              SessionEvent.Tool.Input.Started.create({ callID, name: "bash", timestamp: time(1) }),
              SessionEvent.Tool.Success.create({
                callID,
                title,
                provider: { executed: true },
                timestamp: time(2),
              }),
            ],
            active(),
          )
          const match = tool(next, callID)
          expect(match?.state).toEqual({
            status: "pending",
            input: "",
          })
        }),
        { numRuns: 50 },
      )
    })

    test("step.ended copies completion fields onto the pending assistant", () => {
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 1, max: 1000 }), (n) => {
          const event = SessionEvent.Step.Ended.create({
            reason: "stop",
            cost: 1,
            tokens: {
              input: 1,
              output: 2,
              reasoning: 3,
              cache: {
                read: 4,
                write: 5,
              },
            },
            timestamp: time(n),
          })
          const next = SessionEntry.step(active(), event)
          const entry = last(next)
          expect(entry).toBeDefined()
          if (!entry) return

          expect(entry.time.completed).toEqual(event.timestamp)
          expect(entry.cost).toBe(event.cost)
          expect(entry.tokens).toEqual(event.tokens)
        }),
        { numRuns: 50 },
      )
    })
  })

  describe("known reducer gaps", () => {
    test("prompt appends immutably when no assistant is pending", () => {
      FastCheck.assert(
        FastCheck.property(word, (body) => {
          const old = history()
          const next = SessionEntry.step(old, SessionEvent.Prompt.create({ text: body, timestamp: time(1) }))
          expect(old).not.toBe(next)
          expect(old.entries).toHaveLength(0)
          expect(next.entries).toHaveLength(1)
        }),
        { numRuns: 50 },
      )
    })

    test("prompt appends immutably when an assistant is pending", () => {
      FastCheck.assert(
        FastCheck.property(word, (body) => {
          const old = active()
          const next = SessionEntry.step(old, SessionEvent.Prompt.create({ text: body, timestamp: time(1) }))
          expect(old).not.toBe(next)
          expect(old.pending).toHaveLength(0)
          expect(next.pending).toHaveLength(1)
        }),
        { numRuns: 50 },
      )
    })

    test("step.started creates an assistant consumed by follow-up events", () => {
      FastCheck.assert(
        FastCheck.property(texts, (parts) => {
          const next = run([
            SessionEvent.Step.Started.create({
              model: {
                id: "model",
                providerID: "provider",
              },
              timestamp: time(1),
            }),
            SessionEvent.Text.Started.create({ timestamp: time(2) }),
            ...parts.map((x, i) => SessionEvent.Text.Delta.create({ delta: x, timestamp: time(i + 3) })),
            SessionEvent.Step.Ended.create({
              reason: "stop",
              cost: 1,
              tokens: {
                input: 1,
                output: 2,
                reasoning: 3,
                cache: {
                  read: 4,
                  write: 5,
                },
              },
              timestamp: time(parts.length + 3),
            }),
          ])
          const entry = last(next)

          expect(entry).toBeDefined()
          if (!entry) return

          expect(entry.content).toEqual([
            {
              type: "text",
              text: parts.join(""),
            },
          ])
          expect(entry.time.completed).toEqual(time(parts.length + 3))
        }),
        { numRuns: 100 },
      )
    })

    test("replays prompt -> step -> text -> step.ended", () => {
      FastCheck.assert(
        FastCheck.property(word, texts, (body, parts) => {
          const next = run([
            SessionEvent.Prompt.create({ text: body, timestamp: time(0) }),
            SessionEvent.Step.Started.create({
              model: {
                id: "model",
                providerID: "provider",
              },
              timestamp: time(1),
            }),
            SessionEvent.Text.Started.create({ timestamp: time(2) }),
            ...parts.map((x, i) => SessionEvent.Text.Delta.create({ delta: x, timestamp: time(i + 3) })),
            SessionEvent.Step.Ended.create({
              reason: "stop",
              cost: 1,
              tokens: {
                input: 1,
                output: 2,
                reasoning: 3,
                cache: {
                  read: 4,
                  write: 5,
                },
              },
              timestamp: time(parts.length + 3),
            }),
          ])

          expect(next.entries).toHaveLength(2)
          expect(next.entries[0]?.type).toBe("user")
          expect(next.entries[1]?.type).toBe("assistant")
          if (next.entries[1]?.type !== "assistant") return

          expect(next.entries[1].content).toEqual([
            {
              type: "text",
              text: parts.join(""),
            },
          ])
          expect(next.entries[1].time.completed).toEqual(time(parts.length + 3))
        }),
        { numRuns: 50 },
      )
    })

    test("replays prompt -> step -> reasoning -> tool -> success -> step.ended", () => {
      FastCheck.assert(
        FastCheck.property(
          word,
          texts,
          text,
          dict,
          word,
          maybe(text),
          maybe(dict),
          maybe(files),
          (body, reason, end, input, title, output, metadata, attachments) => {
            const callID = "call"
            const next = run([
              SessionEvent.Prompt.create({ text: body, timestamp: time(0) }),
              SessionEvent.Step.Started.create({
                model: {
                  id: "model",
                  providerID: "provider",
                },
                timestamp: time(1),
              }),
              SessionEvent.Reasoning.Started.create({ timestamp: time(2) }),
              ...reason.map((x, i) => SessionEvent.Reasoning.Delta.create({ delta: x, timestamp: time(i + 3) })),
              SessionEvent.Reasoning.Ended.create({ text: end, timestamp: time(reason.length + 3) }),
              SessionEvent.Tool.Input.Started.create({ callID, name: "bash", timestamp: time(reason.length + 4) }),
              SessionEvent.Tool.Called.create({
                callID,
                tool: "bash",
                input,
                provider: { executed: true },
                timestamp: time(reason.length + 5),
              }),
              SessionEvent.Tool.Success.create({
                callID,
                title,
                output,
                metadata,
                attachments,
                provider: { executed: true },
                timestamp: time(reason.length + 6),
              }),
              SessionEvent.Step.Ended.create({
                reason: "stop",
                cost: 1,
                tokens: {
                  input: 1,
                  output: 2,
                  reasoning: 3,
                  cache: {
                    read: 4,
                    write: 5,
                  },
                },
                timestamp: time(reason.length + 7),
              }),
            ])

            expect(next.entries.at(-1)?.type).toBe("assistant")
            const entry = next.entries.at(-1)
            if (entry?.type !== "assistant") return

            expect(entry.content).toHaveLength(2)
            expect(entry.content[0]).toEqual({
              type: "reasoning",
              text: end,
            })
            expect(entry.content[1]?.type).toBe("tool")
            if (entry.content[1]?.type !== "tool") return
            expect(entry.content[1].state.status).toBe("completed")
            expect(entry.time.completed).toEqual(time(reason.length + 7))
          },
        ),
        { numRuns: 50 },
      )
    })

    test("starting a new step completes the old assistant and appends a new active assistant", () => {
      const next = run(
        [
          SessionEvent.Step.Started.create({
            model: {
              id: "model",
              providerID: "provider",
            },
            timestamp: time(1),
          }),
        ],
        active(),
      )
      expect(next.entries).toHaveLength(2)
      expect(next.entries[0]?.type).toBe("assistant")
      expect(next.entries[1]?.type).toBe("assistant")
      if (next.entries[0]?.type !== "assistant" || next.entries[1]?.type !== "assistant") return

      expect(next.entries[0].time.completed).toEqual(time(1))
      expect(next.entries[1].time.created).toEqual(time(1))
      expect(next.entries[1].time.completed).toBeUndefined()
    })

    test("handles sequential tools independently", () => {
      FastCheck.assert(
        FastCheck.property(dict, dict, word, word, (a, b, title, error) => {
          const next = run(
            [
              SessionEvent.Tool.Input.Started.create({ callID: "a", name: "bash", timestamp: time(1) }),
              SessionEvent.Tool.Called.create({
                callID: "a",
                tool: "bash",
                input: a,
                provider: { executed: true },
                timestamp: time(2),
              }),
              SessionEvent.Tool.Success.create({
                callID: "a",
                title,
                output: "done",
                provider: { executed: true },
                timestamp: time(3),
              }),
              SessionEvent.Tool.Input.Started.create({ callID: "b", name: "grep", timestamp: time(4) }),
              SessionEvent.Tool.Called.create({
                callID: "b",
                tool: "bash",
                input: b,
                provider: { executed: true },
                timestamp: time(5),
              }),
              SessionEvent.Tool.Error.create({
                callID: "b",
                error,
                provider: { executed: true },
                timestamp: time(6),
              }),
            ],
            active(),
          )

          const first = tool(next, "a")
          const second = tool(next, "b")

          expect(first?.state.status).toBe("completed")
          if (first?.state.status !== "completed") return
          expect(first.state.input).toEqual(a)
          expect(first.state.output).toBe("done")
          expect(first.state.title).toBe(title)

          expect(second?.state.status).toBe("error")
          if (second?.state.status !== "error") return
          expect(second.state.input).toEqual(b)
          expect(second.state.error).toBe(error)
        }),
        { numRuns: 50 },
      )
    })

    test.failing("records synthetic events", () => {
      FastCheck.assert(
        FastCheck.property(word, (body) => {
          const next = SessionEntry.step(history(), SessionEvent.Synthetic.create({ text: body, timestamp: time(1) }))
          expect(next.entries).toHaveLength(1)
          expect(next.entries[0]?.type).toBe("synthetic")
          if (next.entries[0]?.type !== "synthetic") return
          expect(next.entries[0].text).toBe(body)
        }),
        { numRuns: 50 },
      )
    })

    test.failing("records compaction events", () => {
      FastCheck.assert(
        FastCheck.property(FastCheck.boolean(), maybe(FastCheck.boolean()), (auto, overflow) => {
          const next = SessionEntry.step(
            history(),
            SessionEvent.Compacted.create({ auto, overflow, timestamp: time(1) }),
          )
          expect(next.entries).toHaveLength(1)
          expect(next.entries[0]?.type).toBe("compaction")
          if (next.entries[0]?.type !== "compaction") return
          expect(next.entries[0].auto).toBe(auto)
          expect(next.entries[0].overflow).toBe(overflow)
        }),
        { numRuns: 50 },
      )
    })
  })
})
