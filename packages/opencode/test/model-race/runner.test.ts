import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Effect, Exit, Logger, Stream } from "effect"
import { options } from "../../src/model-race/config"
import { ToolExecutionGate, ToolNotWinnerError, gateTools } from "../../src/model-race/gate"
import { stream } from "../../src/model-race/runner"
import type { Candidate } from "../../src/model-race/types"
import { jsonSchema, tool } from "ai"

const candidate = (id: string): Candidate => ({
  id,
  label: id,
  providerID: "test",
  modelID: id,
})

const configured = options({
  strategy: { firstToken: true, throughput: true, toolCall: true },
  throughput: { warmupTokens: 0, measurementWindowMs: 1000 },
  switch: { enabled: true },
})

const collect = <A, E>(input: Stream.Stream<A, E>) =>
  Effect.runPromise(Stream.runCollect(input).pipe(Effect.map((chunk) => [...chunk])))

describe("model race runner", () => {
  test("writes race lifecycle logs", async () => {
    const messages: unknown[] = []
    await Effect.runPromise(
      stream({
        raceID: "race-log",
        candidates: [candidate("a"), candidate("b")],
        options: configured,
        runCandidate: (item) =>
          item.id === "a"
            ? Stream.make(LLMEvent.textDelta({ id: "a-text", text: "a" }), LLMEvent.finish({ reason: "stop" }))
            : Stream.make(LLMEvent.textDelta({ id: "b-text", text: "b" }), LLMEvent.finish({ reason: "stop" })),
      }).pipe(
        Stream.runDrain,
        Effect.provide(
          Logger.layer([
            Logger.make<unknown, void>((options) => {
              messages.push(options.message)
            }),
          ]),
        ),
      ),
    )

    expect(JSON.stringify(messages)).toContain("model race started")
    expect(JSON.stringify(messages)).toContain("model race completed")
  })

  test("publishes snapshots for UI and logging", async () => {
    const updates: string[] = []
    const a = candidate("a")
    const b = candidate("b")
    await Effect.runPromise(
      stream({
        raceID: "race-test",
        candidates: [a, b],
        options: configured,
        onUpdate: (update) =>
          Effect.sync(() => {
            updates.push(`${update.phase}:${update.leader?.modelID ?? update.winner?.modelID ?? ""}`)
          }),
        runCandidate: (item) =>
          item.id === "a"
            ? Stream.make(LLMEvent.textDelta({ id: "a-text", text: "a" }), LLMEvent.finish({ reason: "stop" }))
            : Stream.make(LLMEvent.textDelta({ id: "b-text", text: "b" }), LLMEvent.finish({ reason: "stop" })),
      }).pipe(Stream.runDrain),
    )

    expect(updates[0]).toBe("dispatching:")
    expect(updates.at(-1)).toMatch(/^(completed|locked):/)
  })

  test("emits only the complete tool-call winner", async () => {
    const a = candidate("a")
    const b = candidate("b")
    const result = await collect(
      stream({
        candidates: [a, b],
        options: configured,
        runCandidate: (item) =>
          item.id === "a"
            ? Stream.make(
                LLMEvent.textStart({ id: "a-text" }),
                LLMEvent.textDelta({ id: "a-text", text: "partial" }),
                LLMEvent.toolInputStart({ id: "call-a", name: "read" }),
                LLMEvent.toolInputDelta({ id: "call-a", name: "read", text: "{" }),
              )
            : Stream.make(
                LLMEvent.textStart({ id: "b-text" }),
                LLMEvent.textDelta({ id: "b-text", text: "winner" }),
                LLMEvent.toolCall({ id: "call-b", name: "read", input: { filePath: "a" } }),
                LLMEvent.finish({ reason: "tool-calls" }),
              ),
      }),
    )

    expect(result.map((event) => event.type)).toEqual(["text-start", "text-delta", "tool-call", "finish"])
    expect(result[1]).toMatchObject({ text: "winner" })
  })

  test("prefers a complete tool call over a partial tool call", async () => {
    const a = candidate("a")
    const b = candidate("b")
    const result = await collect(
      stream({
        candidates: [a, b],
        options: configured,
        runCandidate: (item) =>
          item.id === "a"
            ? Stream.make(LLMEvent.toolInputDelta({ id: "call-a", name: "read", text: '{"filePath":' }))
            : Stream.make(
                LLMEvent.toolCall({ id: "call-b", name: "read", input: { filePath: "b" } }),
                LLMEvent.finish({ reason: "tool-calls" }),
              ),
      }),
    )

    expect(result).toMatchObject([
      { type: "tool-call", id: "call-b" },
      { type: "finish", reason: "tool-calls" },
    ])
  })

  test("falls back when a provisional candidate fails", async () => {
    const a = candidate("a")
    const b = candidate("b")
    const result = await collect(
      stream({
        candidates: [a, b],
        options: configured,
        runCandidate: (item) =>
          item.id === "a"
            ? Stream.concat(
                Stream.make(LLMEvent.textDelta({ id: "a-text", text: "partial" })),
                Stream.fail(new Error("candidate a failed")),
              )
            : Stream.make(LLMEvent.textDelta({ id: "b-text", text: "complete" }), LLMEvent.finish({ reason: "stop" })),
      }),
    )

    expect(result).toMatchObject([
      { type: "text-delta", text: "complete" },
      { type: "finish", reason: "stop" },
    ])
  })

  test("fails when every candidate fails", async () => {
    const result = await Effect.runPromise(
      Stream.runCollect(
        stream({
          candidates: [candidate("a"), candidate("b")],
          options: configured,
          runCandidate: () => Stream.fail(new Error("boom")),
        }),
      ).pipe(Effect.exit),
    )

    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBeInstanceOf(Error)
  })
})

describe("model race tool gate", () => {
  test("executes only the winner tool", async () => {
    const gate = new ToolExecutionGate(["a", "b"])
    const calls: string[] = []
    const base = {
      read: tool({
        inputSchema: jsonSchema({ type: "object" }),
        execute: async () => {
          calls.push("read")
          return "ok"
        },
      }),
    }
    const loser = gateTools(base, "a", gate)
    const winner = gateTools(base, "b", gate)

    gate.allowWinner("b")

    await expect(loser.read.execute!({}, { toolCallId: "a", messages: [] })).rejects.toBeInstanceOf(ToolNotWinnerError)
    await expect(winner.read.execute!({}, { toolCallId: "b", messages: [] })).resolves.toBe("ok")
    expect(calls).toEqual(["read"])
  })

  test("unblocks a winner tool that started before the race was locked", async () => {
    const gate = new ToolExecutionGate(["a", "b"])
    const base = {
      read: tool({
        inputSchema: jsonSchema({ type: "object" }),
        execute: async () => "ok",
      }),
    }
    const winner = gateTools(base, "b", gate)

    const execution = winner.read.execute!({}, { toolCallId: "b", messages: [] })
    gate.allowWinner("b")

    await expect(execution).resolves.toBe("ok")
  })
})
