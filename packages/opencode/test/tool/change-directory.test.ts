import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Exit, Layer, Ref, Schema } from "effect"
import { describe, expect } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { ChangeDirectoryTool, Parameters } from "../../src/tool/change-directory"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const calls = Ref.makeUnsafe<MoveSession.Input[]>([])
const failure = Ref.makeUnsafe<MoveSession.Error | undefined>(undefined)

const moveSessionLayer = Layer.mock(MoveSession.Service)({
  moveSession: (input: MoveSession.Input) =>
    Effect.gen(function* () {
      yield* Ref.update(calls, (arr) => [...arr, input])
      const err = yield* Ref.get(failure)
      if (err) yield* Effect.fail(err)
    }),
})

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])),
    moveSessionLayer,
  ),
)

function makeCtx(): Tool.Context {
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

describe("tool.change_directory", () => {
  it.effect("is registered with id 'change_directory'", () =>
    Effect.gen(function* () {
      expect(ChangeDirectoryTool.id).toBe("change_directory")
    }),
  )

  it.effect("has a non-empty description", () =>
    Effect.gen(function* () {
      const info = yield* ChangeDirectoryTool
      const def = yield* Tool.init(info)
      expect(def.description.length).toBeGreaterThan(0)
    }),
  )

  it.effect("Parameters schema accepts a directory field", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(Parameters)({ directory: "/some/path" })
      expect(decoded.directory).toBe("/some/path")
    }),
  )

  it.effect("calls moveSession with session ID and target directory on valid input", () =>
    Effect.gen(function* () {
      yield* Ref.set(calls, [])
      yield* Ref.set(failure, undefined)

      const info = yield* ChangeDirectoryTool
      const tool = yield* Tool.init(info)
      const result = yield* tool.execute({ directory: "/new/directory" }, makeCtx())

      const input = (yield* Ref.get(calls))[0]
      expect(input.sessionID).toBe(SessionID.make("ses_test"))
      expect(input.destination.directory).toBe(AbsolutePath.make(path.resolve("/new/directory")))
      expect(result.output).toContain(path.resolve("/new/directory"))
    }),
  )

  it.effect("returns error when directory parameter is missing", () =>
    Effect.gen(function* () {
      const info = yield* ChangeDirectoryTool
      const tool = yield* Tool.init(info)
      const exit = yield* tool.execute({}, makeCtx()).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("returns error when moveSession fails with DestinationProjectMismatchError", () =>
    Effect.gen(function* () {
      yield* Ref.set(calls, [])
      yield* Ref.set(
        failure,
        new MoveSession.DestinationProjectMismatchError({
          expected: ProjectV2.ID.make("proj_a"),
          actual: ProjectV2.ID.make("proj_b"),
        }),
      )

      const info = yield* ChangeDirectoryTool
      const tool = yield* Tool.init(info)
      const exit = yield* tool.execute({ directory: "/wrong/project" }, makeCtx()).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
