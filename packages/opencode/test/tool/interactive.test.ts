import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { buildLocationServiceMap, LocationServiceMap } from "@opencode-ai/core/location-services"
import { InteractiveTool } from "@opencode-ai/core/tool/interactive"
import { InteractiveProcess } from "@opencode-ai/core/tool/interactive/runtime"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MessageID, SessionID } from "@/session/schema"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { fakeProcess, type Step } from "../../../core/test/fixture/interactive-process"
import { TestConfig } from "../fixture/config"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Scripted PTY fake from the core test tree (spec R34): children replay
// (bytes, delay) events so settle boundaries stay deterministic. `respond` is
// mutable per test; children without a reaction simply stay quiet.
const script: { respond: (input: string) => Step | undefined } = { respond: () => undefined }
const fake = fakeProcess({ schedule: [{ bytes: "banner\n> ", delayMs: 20 }], respond: (input) => script.respond(input) })

const configLayer = TestConfig.layer()

// The same bridge the server uses: the V1 registry graph gets a
// LocationServiceMap whose location graph runs the fake interactive runtime.
const it = testEffect(
  LayerNode.compile(LayerNode.group([ToolRegistry.node, Agent.node]), [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [LocationServiceMap.node, buildLocationServiceMap([[InteractiveProcess.node, fake.layer]])],
  ]),
)

const NAMES = [InteractiveTool.START, InteractiveTool.WRITE, InteractiveTool.WAIT, InteractiveTool.CANCEL]

const makeCtx = () => {
  const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
  const ctx: Tool.Context = {
    sessionID: SessionID.make("ses_interactive_v1"),
    messageID: MessageID.make("msg_interactive_v1"),
    callID: "call_interactive_v1",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: (req) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  return { requests, ctx }
}

const registryTool = (registry: ToolRegistry.Interface, id: string) =>
  Effect.gen(function* () {
    const found = (yield* registry.all()).find((tool) => tool.id === id)
    if (!found) throw new Error(`${id} was not loaded into the V1 registry`)
    return found
  })

const lastChild = () => {
  const spawned = fake.spawned.at(-1)
  if (!spawned) throw new Error("fake runtime spawned no child")
  return spawned
}

afterEach(async () => {
  script.respond = () => undefined
  await disposeAllInstances()
})

describe("tool.interactive", () => {
  it.instance("registers the four interactive siblings with the shared R33 guidance", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      for (const name of NAMES) expect(ids).toContain(name)

      const agents = yield* Agent.Service
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: yield* agents.defaultInfo(),
      })
      const family = tools.filter((tool) => NAMES.includes(tool.id))
      expect(family.map((tool) => tool.id)).toEqual(NAMES)
      for (const tool of family) {
        expect(tool.description).toContain("Use the interactive tools only for processes that need a conversation")
        expect(tool.description).toContain("Never send an empty write")
        expect(tool.description).toContain("Finish every job with exactly one terminal action")
      }
      expect(family[0]?.description).toContain("interactive_start spawns the process as a job")
      expect(family[3]?.description).toContain("interactive_cancel kills the job's process group")

      // the shared core input schema doubles as the provider-facing schema
      expect(ToolJsonSchema.fromTool(family[0])).toMatchObject({
        properties: { command: { type: "string" } },
        required: ["command"],
      })
    }),
  )

  it.instance("start/write/cancel run through the V2 job store and encode the shared R4 result", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const { requests, ctx } = makeCtx()

      const start = yield* registryTool(registry, InteractiveTool.START)
      const result = yield* start.execute({ command: "fake-repl" }, ctx)
      const child = lastChild()
      expect(child.command).toBe("fake-repl")

      // start settled at quiescence on the scheduled banner: R4 status line in
      // the model text, structured R3 fields in metadata
      expect(result.title).toBe("fake-repl")
      expect(result.output).toContain("banner\n> ")
      expect(result.output).toMatch(/\[interactive ijob_\w+ status=waiting exchanges=1\/20\]/)
      const jobID = result.metadata.jobID as string
      expect(result.metadata).toMatchObject({
        jobID,
        status: "waiting",
        exchanges: 1,
        exchangesRemaining: 19,
        truncated: false,
      })
      expect(typeof result.metadata.outputPath).toBe("string")
      yield* Effect.promise(() => fs.stat(result.metadata.outputPath as string))
      expect(requests).toEqual([
        {
          permission: "interactive",
          patterns: ["fake-repl"],
          always: ["fake-repl"],
          metadata: { command: "fake-repl" },
        },
      ])

      // write settles at quiescence on the scripted echo; the write itself
      // never asks for permission (spec R27/I7)
      script.respond = (input) => (input === "hi\n" ? { bytes: "got: hi\n> " } : undefined)
      const write = yield* registryTool(registry, InteractiveTool.WRITE)
      const written = yield* write.execute({ jobID, input: "hi\n" }, ctx)
      expect(child.child.writes).toEqual(["hi\n"])
      expect(written.output).toContain("got: hi\n> ")
      expect(written.output).toContain(`[interactive ${jobID} status=waiting exchanges=2/20]`)
      expect(requests).toHaveLength(1)

      // cancel is final, never asks, and does not consume an exchange
      const cancel = yield* registryTool(registry, InteractiveTool.CANCEL)
      const cancelled = yield* cancel.execute({ jobID }, ctx)
      expect(child.child.kills.length).toBeGreaterThan(0)
      expect(cancelled.metadata).toMatchObject({ jobID, status: "cancelled", reason: "model", exchanges: 2 })
      expect(cancelled.output).toContain("Job cancelled (reason: model).")
      expect(requests).toHaveLength(1)
    }),
  )

  it.instance("start asks external_directory for a workdir outside the instance and passes it to the store", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const { requests, ctx } = makeCtx()
      const start = yield* registryTool(registry, InteractiveTool.START)
      yield* Effect.exit(start.execute({ command: "fake-repl", workdir: "../outside" }, ctx))
      expect(requests[0]?.permission).toBe("external_directory")
      expect(requests[1]?.permission).toBe("interactive")
      expect(lastChild().cwd.endsWith("outside")).toBe(true)
    }),
  )

  it.instance("model-facing store errors surface as ordinary tool errors", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const { ctx } = makeCtx()
      const write = yield* registryTool(registry, InteractiveTool.WRITE)
      const message = yield* write
        .execute({ jobID: "ijob_does_not_exist", input: "hi\n" }, ctx)
        .pipe(
          // the V1 wrap orDies tool failures, so the store's model-facing prose
          // arrives as the defect's message
          Effect.catchDefect((defect) => Effect.succeed(defect instanceof Error ? defect.message : String(defect))),
        )
      expect(message).toContain("Unknown interactive job: ijob_does_not_exist")
      expect(message).toContain("Jobs do not survive runtime restarts")
    }),
  )
})
