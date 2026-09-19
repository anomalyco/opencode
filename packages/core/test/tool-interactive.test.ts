import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { InteractiveJob } from "@opencode-ai/core/tool/interactive/job"
import { InteractiveJobs } from "@opencode-ai/core/tool/interactive/store"
import { InteractiveTool } from "@opencode-ai/core/tool/interactive"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { configLayer } from "./fixture/config"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, toolDefinitions, settleTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_interactive_tool")

const result = (overrides: { jobID: string } & Partial<InteractiveJob.Result>): InteractiveJob.Result => ({
  status: "waiting",
  output: "",
  truncated: false,
  outputPath: "/managed/tool-output/tool_ijob_1",
  exchanges: 1,
  exchangesRemaining: 19,
  ...overrides,
})

/** Scripted InteractiveJobs fake: records which methods the tool executed and replays scripted results. */
const fakeJobs = (script: ReadonlyArray<InteractiveJob.Result>, state: { calls: string[]; starts: InteractiveJobs.StartRequest[] }) => {
  const queue = [...script]
  const shift = () => {
    const next = queue.shift()
    if (!next) throw new Error("fake interactive store script exhausted")
    return next
  }
  const record = (call: string) => Effect.sync(() => state.calls.push(call))
  return Layer.succeed(
    InteractiveJobs.Service,
    InteractiveJobs.Service.of({
      start: (request) =>
        record("interactive_start").pipe(
          Effect.andThen(
            Effect.sync(() => {
              state.starts.push(request)
              return shift()
            }),
          ),
        ),
      write: () => record("interactive_write").pipe(Effect.andThen(Effect.sync(shift))),
      wait: () => record("interactive_wait").pipe(Effect.andThen(Effect.sync(shift))),
      cancel: () => record("interactive_cancel").pipe(Effect.andThen(Effect.sync(shift))),
      cancelInFlight: () => Effect.void,
      killAll: () => Effect.void,
    }),
  )
}

const withTools = <A, E, R>(
  body: (
    registry: ToolRegistry.Interface,
    harness: {
      readonly assertions: PermissionV2.AssertInput[]
      readonly calls: string[]
      readonly starts: InteractiveJobs.StartRequest[]
      deny: boolean
    },
  ) => Effect.Effect<A, E, R>,
  script: ReadonlyArray<InteractiveJob.Result> = [],
) => {
  const assertions: PermissionV2.AssertInput[] = []
  const harness = { assertions, calls: new Array<string>(), starts: new Array<InteractiveJobs.StartRequest>(), deny: false }
  const permission = Layer.succeed(
    PermissionV2.Service,
    PermissionV2.Service.of({
      assert: (input) =>
        Effect.sync(() => assertions.push(input)).pipe(
          Effect.andThen(Effect.suspend(() => (harness.deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void))),
        ),
      ask: () => Effect.die("unused"),
      reply: () => Effect.die("unused"),
      get: () => Effect.die("unused"),
      forSession: () => Effect.die("unused"),
      list: () => Effect.die("unused"),
    }),
  )
  return Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const graph = AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, LocationMutation.node, InteractiveTool.node]),
        [
          [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })))],
          [PermissionV2.node, permission],
          [Config.node, configLayer()],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
          [InteractiveJobs.node, fakeJobs(script, harness)],
        ],
      )
      return Effect.gen(function* () {
        return yield* body(yield* ToolRegistry.Service, harness)
      }).pipe(Effect.provide(graph))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )
}

const call = (name: string, input: unknown) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call-${name}`, name, input },
})

const it = testEffect(Layer.empty)

describe("InteractiveTool", () => {
  it.live("registers the four siblings in order and a blanket interactive deny hides the family", () =>
    withTools((registry) =>
      Effect.gen(function* () {
        const definitions = yield* toolDefinitions(registry)
        expect(definitions.map((definition) => definition.name)).toEqual([
          InteractiveTool.START,
          InteractiveTool.WRITE,
          InteractiveTool.WAIT,
          InteractiveTool.CANCEL,
        ])
        expect(
          yield* toolDefinitions(registry, [{ action: "interactive", resource: "*", effect: "deny" }]),
        ).toEqual([])
        expect(yield* toolDefinitions(registry, [{ action: "*", resource: "*", effect: "deny" }])).toEqual([])
      }),
    ))

  it.live("descriptions carry the shared R33 guidance block and per-method supplements", () =>
    withTools((registry) =>
      Effect.gen(function* () {
        const definitions = yield* toolDefinitions(registry)
        for (const definition of definitions) {
          expect(definition.description).toContain(
            "Use the interactive tools only for processes that need a conversation",
          )
          expect(definition.description).toContain("Never send an empty write")
          expect(definition.description).toContain("Finish every job with exactly one terminal action")
          expect(definition.description).toContain("jobs are limited to 20 exchanges and 3 concurrent jobs per session")
        }
        expect(definitions[0]?.description).toContain("interactive_start spawns the process as a job")
        expect(definitions[1]?.description).toContain("interactive_write appends input to the job's stdin")
        expect(definitions[2]?.description).toContain("interactive_wait blocks until the job exits")
        expect(definitions[3]?.description).toContain("interactive_cancel kills the job's process group")
      }),
    ))

  it.live("start asserts the interactive permission on the full command text before any side effect", () =>
    withTools(
      (registry, harness) =>
        Effect.gen(function* () {
          yield* Effect.exit(settleTool(registry, call(InteractiveTool.START, { command: "python3 -i" })))
          expect(harness.assertions).toHaveLength(1)
          expect(harness.assertions[0]).toMatchObject({
            sessionID,
            action: "interactive",
            resources: ["python3 -i"],
            save: ["python3 -i"],
          })
          expect(harness.calls).toEqual(["interactive_start"])
        }),
      [result({ jobID: "ijob_1" })],
    ))

  it.live("a declined start performs no job side effects", () =>
    withTools((registry, harness) =>
      Effect.gen(function* () {
        harness.deny = true
        yield* Effect.exit(settleTool(registry, call(InteractiveTool.START, { command: "python3 -i" })))
        expect(harness.assertions.map((input) => input.action)).toEqual(["interactive"])
        expect(harness.calls).toEqual([])
      }),
    ))

  it.live("start passes the model-supplied timeout through to the job store (spec R7)", () =>
    withTools(
      (registry, harness) =>
        Effect.gen(function* () {
          yield* Effect.exit(settleTool(registry, call(InteractiveTool.START, { command: "gdb ./a.out", timeout: 45_000 })))
          yield* Effect.exit(settleTool(registry, call(InteractiveTool.START, { command: "python3 -i" })))
          expect(harness.starts).toHaveLength(2)
          expect(harness.starts[0]?.timeout).toBe(45_000)
          expect(harness.starts[1]?.timeout).toBeUndefined()
        }),
      [result({ jobID: "ijob_1" }), result({ jobID: "ijob_2" })],
    ))

  it.live("toModelOutput renders the output, status line, exit, reason, and truncation marker", () =>
    withTools(
      (registry) =>
        Effect.gen(function* () {
          const waiting = yield* settleTool(
            registry,
            call(InteractiveTool.START, { command: "gdb ./a.out" }),
          )
          expect(waiting.output?.structured).toMatchObject({ jobID: "ijob_1", status: "waiting", exchanges: 1 })
          expect(waiting.result).toEqual({
            type: "content",
            value: [
              { type: "text", text: "gdb banner\n> " },
              { type: "text", text: "[interactive ijob_1 status=waiting exchanges=1/20]" },
            ],
          })

          const terminal = yield* settleTool(registry, call(InteractiveTool.WRITE, { jobID: "ijob_1", input: "x\n" }))
          expect(terminal.result).toEqual({
            type: "content",
            value: [
              { type: "text", text: "[interactive ijob_1 status=failed exchanges=2/20]" },
              { type: "text", text: "Process exited with code 3." },
              {
                type: "text",
                text: "... output truncated; full output saved to /managed/tool-output/tool_ijob_1 ...",
              },
            ],
          })

          const cancelled = yield* settleTool(registry, call(InteractiveTool.CANCEL, { jobID: "ijob_1" }))
          expect(cancelled.result).toEqual({
            type: "content",
            value: [
              { type: "text", text: "last words\n" },
              { type: "text", text: "[interactive ijob_1 status=cancelled exchanges=2/20]" },
              { type: "text", text: "Job cancelled (reason: exchanges)." },
            ],
          })
        }),
      [
        result({ jobID: "ijob_1", output: "gdb banner\n> " }),
        result({
          jobID: "ijob_1",
          status: "failed",
          truncated: true,
          exit: 3,
          exchanges: 2,
          exchangesRemaining: 18,
        }),
        result({
          jobID: "ijob_1",
          status: "cancelled",
          reason: "exchanges",
          output: "last words\n",
          exchanges: 2,
          exchangesRemaining: 18,
        }),
      ],
    ))
})
