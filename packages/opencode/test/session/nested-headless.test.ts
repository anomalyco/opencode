import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { afterEach, describe, expect } from "bun:test"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { SubagentLimits } from "@/session/subagent-limits"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer, reply } from "../lib/llm-server"

// Issue 8 (followups): a full HEADLESS end-to-end against the REAL server
// prompt loop — the same entrypoint `opencode run`/`opencode serve` reach via
// the HTTP API, NOT the in-process `SessionPrompt.loop` seam the T7 suite
// (nested-task.test.ts) drives. Every scenario boots the real instance HTTP
// server, drives `sdk.session.prompt` over the wire against a deterministic
// TestLLMServer (no real model, no network), and reads back the session tree
// + the per-level request bodies. The prompt call blocks until the whole
// foreground chain has run through the loop, so the persisted tree and the
// recorded wire requests are the ground truth.

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

// In-process instance HTTP server (the same routes `opencode serve` exposes),
// reachable via the SDK over a fetch shim — mirrors test/server/httpapi-layer.ts.
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

const it = testEffect(
  Layer.mergeAll(
    FSUtil.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
    Database.defaultLayer,
    httpApiLayer,
    TestLLMServer.layer,
  ),
)

// SDK client bound to the in-process server, scoped to a project directory.
const sdkFor = (directory: string) =>
  HttpServer.HttpServer.use((server) =>
    Effect.sync(() => {
      const baseUrl = HttpServer.formatAddress(server.address)
      const fetch = Object.assign(
        async (request: RequestInfo | URL, init?: RequestInit) => {
          const source = request instanceof Request ? request : new Request(request, init)
          const url = new URL(source.url)
          return globalThis.fetch(new Request(new URL(`${url.pathname}${url.search}`, baseUrl), source))
        },
        { preconnect: globalThis.fetch.preconnect },
      ) satisfies typeof globalThis.fetch
      return createOpencodeClient({ baseUrl: "http://localhost", directory, fetch })
    }),
  )

type Sdk = ReturnType<typeof createOpencodeClient>

// The test provider, plus the per-scenario config knobs (depth + permission).
function configFor(url: string, extra?: Partial<ConfigV1.Info>): Partial<ConfigV1.Info> {
  return {
    formatter: false,
    lsp: false,
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100_000, output: 10_000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
    ...extra,
  }
}

// Provision a project dir + the SDK against the booted server, with the LLM
// already wired into the config.
const withHeadless = <A, E>(
  extra: (url: string) => Partial<ConfigV1.Info> | undefined,
  run: (input: { sdk: Sdk; llm: TestLLMServer["Service"] }) => Effect.Effect<A, E, HttpServer.HttpServer>,
) =>
  Effect.gen(function* () {
    const llm = yield* TestLLMServer
    const directory = yield* tmpdirScoped({ git: true, config: configFor(llm.url, extra(llm.url)) })
    const sdk = (yield* sdkFor(directory)) as Sdk
    return yield* run({ sdk, llm })
  })

const model = { providerID: "test", modelID: "test-model" }

function task(prompt: string, extra?: Record<string, unknown>) {
  return { description: "delegate work", prompt, subagent_type: "general", ...extra }
}

type Hit = { url: URL; body: Record<string, unknown> }

const isTitle = (hit: Hit) => JSON.stringify(hit.body).includes("Generate a title for this conversation")

// The task prompt becomes the child's user message and ONLY the child's, so a
// unique marker pins the requesting level's wire request unambiguously.
function userTexts(hit: Hit): string {
  const messages = (hit.body.messages as { role?: string; content?: unknown }[] | undefined) ?? []
  return messages
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")))
    .join("\n")
}

const requestOf = (hits: Hit[], marker: string): Hit => {
  const hit = hits.find((h) => !isTitle(h) && userTexts(h).includes(marker))
  expect(hit).toBeDefined()
  return hit!
}

function toolNames(hit: Hit): string[] {
  const tools = (hit.body.tools as { function?: { name?: string } }[] | undefined) ?? []
  return tools.map((tool) => tool.function?.name).filter((name): name is string => typeof name === "string")
}

// SDK helpers (the wire shape is loosely typed across the frozen v2 SDK; pull
// values defensively the same way httpapi-sdk.test.ts does).
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const create = (sdk: Sdk, input: Record<string, unknown>) =>
  Effect.promise(() => sdk.session.create(input as never)).pipe(Effect.map((r) => String(record(r.data).id)))

const promptSession = (sdk: Sdk, sessionID: string, text: string) =>
  Effect.promise(() =>
    sdk.session.prompt({ sessionID, agent: "build", model, parts: [{ type: "text", text }] } as never),
  )

const children = (sdk: Sdk, sessionID: string) =>
  Effect.promise(() => sdk.session.children({ sessionID } as never)).pipe(Effect.map((r) => array(r.data)))

const messageParts = (sdk: Sdk, sessionID: string) =>
  Effect.promise(() => sdk.session.messages({ sessionID } as never)).pipe(
    Effect.map((r) => array(r.data).flatMap((m) => array(record(m).parts))),
  )

// Walks the (single-chain) tree top-down via the REST children route, asserting
// each generation exists — the persisted tree is the ground truth that the real
// loop actually nested this deep.
const walkChain = (sdk: Sdk, rootID: string, levels: number) =>
  Effect.gen(function* () {
    const chain: string[] = []
    let current = rootID
    for (let i = 0; i < levels; i++) {
      const kids = yield* children(sdk, current)
      expect(kids.length).toBeGreaterThan(0)
      current = String(record(kids[0]).id)
      chain.push(current)
    }
    return chain
  })

// The completed `task` tool part's output for a session (the <task> envelope).
const taskOutput = (sdk: Sdk, sessionID: string) =>
  messageParts(sdk, sessionID).pipe(
    Effect.map((parts) => {
      const part = parts.find(
        (p) => record(p).type === "tool" && record(p).tool === "task" && record(record(p).state).status === "completed",
      )
      return String(record(record(part).state).output ?? "")
    }),
  )

const taskErrorOf = (sdk: Sdk, sessionID: string) =>
  messageParts(sdk, sessionID).pipe(
    Effect.map((parts) => {
      const part = parts.find(
        (p) => record(p).type === "tool" && record(p).tool === "task" && record(record(p).state).status === "error",
      )
      return String(record(record(part).state).error ?? "")
    }),
  )

describe("session.nested-headless", () => {
  // ===========================================================================
  // Issue 8: depth-3 chain through the real server loop + tool removal at the
  // limit, verified at the wire.
  // ===========================================================================
  it.live(
    "drives a depth-3 spawn chain through the real loop: tree nests, results bubble up, level-4 (=maxDepth) loses task+workflow",
    () =>
      // maxDepth=4 → levels 1-3 may spawn, level 4 is the work floor that loses
      // the delegation tools. A foreground chain: each parent prompt blocks on
      // its task tool, so one root prompt drives the whole chain to completion.
      withHeadless(
        () => ({ permission: { task: "allow" }, experimental: { subagent_max_depth: 4 } }),
        ({ sdk, llm }) =>
          Effect.gen(function* () {
            yield* llm.push(
              reply().tool("task", task("marker-l2 do the L2 share")),
              reply().tool("task", task("marker-l3 do the L3 share")),
              reply().tool("task", task("marker-l4 do the L4 share")),
              reply().text("L4-RESULT").stop(),
              reply().text("L3-RESULT").stop(),
              reply().text("L2-RESULT").stop(),
              reply().text("ROOT-RESULT").stop(),
            )

            const root = yield* create(sdk, { title: "CEO", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
            const result = yield* awaitWithTimeout(
              promptSession(sdk, root, "marker-root start the chain"),
              "headless depth-3 chain never completed",
              "40 seconds",
            )

            // The blocking prompt returns the root's final assistant message.
            const finalText = array(record(result.data).parts)
              .filter((p) => record(p).type === "text")
              .map((p) => String(record(p).text))
              .findLast(() => true)
            expect(finalText).toBe("ROOT-RESULT")

            // The persisted tree nested three levels below the root.
            const [l2, l3, l4] = yield* walkChain(sdk, root, 3)
            expect(yield* children(sdk, l4)).toHaveLength(0)

            // Result propagation: every hop's completed task part wraps its
            // child's final text in the <task ...> envelope, all the way down.
            expect(yield* taskOutput(sdk, root)).toContain(`<task id="${l2}" state="completed">`)
            expect(yield* taskOutput(sdk, root)).toContain("L2-RESULT")
            expect(yield* taskOutput(sdk, l2)).toContain("L3-RESULT")
            expect(yield* taskOutput(sdk, l3)).toContain("L4-RESULT")

            // Wire assertions: levels 1-3 carry the task tool; level 4
            // (=maxDepth) carries NEITHER task NOR workflow but is still a full
            // work level (read survives).
            const hits = (yield* llm.hits) as Hit[]
            for (const marker of ["marker-root", "marker-l2", "marker-l3"]) {
              expect(toolNames(requestOf(hits, marker))).toContain("task")
            }
            const l4Hit = requestOf(hits, "marker-l4")
            expect(toolNames(l4Hit)).not.toContain("task")
            expect(toolNames(l4Hit)).not.toContain("workflow")
            expect(toolNames(l4Hit)).toContain("read")
          }),
      ),
    60_000,
  )

  // ===========================================================================
  // Issue 8: SubagentResumeError at the wire through the real loop — the
  // headless analog of the deadlock regression (design-final §4.4). A level-3
  // child that resumes its grand-ancestor (task_id = root) must fail typed in
  // its transcript rather than silently adopting the ancestor and deadlocking.
  // The task tool is PRESENT at depth 3 (< maxDepth), so the guard path that
  // surfaces typed errors as a task tool-error part is exercised for real.
  // ===========================================================================
  it.live(
    "a level-3 task_id resume of the root fails with the typed SubagentResumeError at the wire instead of hanging",
    () =>
      withHeadless(
        () => ({ permission: { task: "allow" } }),
        ({ sdk, llm }) =>
          Effect.gen(function* () {
            const root = yield* create(sdk, { title: "CEO", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
            yield* llm.push(
              reply().tool("task", task("marker-l2 delegate further")),
              reply().tool("task", task("marker-l3 attempt the resume")),
              // L3 tries to resume its grand-ancestor — the pre-fix behavior was
              // a silent adoption that deadlocked (child waiting on an ancestor).
              reply().tool("task", task("resume the root session", { task_id: root })),
              reply().text("L3-RESULT").stop(),
              reply().text("L2-RESULT").stop(),
              reply().text("ROOT-RESULT").stop(),
            )

            const result = yield* awaitWithTimeout(
              promptSession(sdk, root, "marker-root start"),
              "headless loop hung on the ancestor resume (deadlock regression)",
              "30 seconds",
            )
            const finalText = array(record(result.data).parts)
              .filter((p) => record(p).type === "text")
              .map((p) => String(record(p).text))
              .findLast(() => true)
            expect(finalText).toBe("ROOT-RESULT")

            const [l2, l3] = yield* walkChain(sdk, root, 2)
            // The typed SubagentResumeError surfaces as the task tool's error
            // output in L3's transcript; no session was adopted or created.
            const error = yield* taskErrorOf(sdk, l3)
            expect(error).toContain(`Cannot resume task ${root}`)
            expect(yield* children(sdk, l3)).toHaveLength(0)
            expect(yield* children(sdk, l2)).toHaveLength(1)
          }),
      ),
    45_000,
  )

  // ===========================================================================
  // Issue 8: SubagentTreeLimitError at the wire through the real loop. The
  // in-process server shares the task tool's tree counter, so the test seam
  // drives the lifetime cap deterministically (mirrors T7.8).
  // ===========================================================================
  it.live(
    "the tree lifetime cap surfaces SubagentTreeLimitError at the wire once exhausted",
    () =>
      withHeadless(
        () => ({ permission: { task: "allow" } }),
        ({ sdk, llm }) =>
          Effect.gen(function* () {
            SubagentLimits.__testHooks.treeLimit = 2
            // Three sequential spawn attempts from the root: 1-2 pass the cap,
            // the third fails the gate before any session is created.
            yield* llm.push(
              reply().tool("task", task("marker-a first delegation")),
              reply().text("A-RESULT").stop(),
              reply().tool("task", task("marker-b second delegation")),
              reply().text("B-RESULT").stop(),
              reply().tool("task", task("marker-c third delegation")),
              reply().text("ROOT-RESULT").stop(),
            )

            const root = yield* create(sdk, { title: "CEO", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
            const result = yield* awaitWithTimeout(
              promptSession(sdk, root, "marker-root delegate three times"),
              "headless tree-cap run never completed",
              "30 seconds",
            )
            const finalText = array(record(result.data).parts)
              .filter((p) => record(p).type === "text")
              .map((p) => String(record(p).text))
              .findLast(() => true)
            expect(finalText).toBe("ROOT-RESULT")

            // Exactly two children survived the cap; the third was refused typed.
            expect(yield* children(sdk, root)).toHaveLength(2)
            const error = yield* taskErrorOf(sdk, root)
            expect(error).toContain("Subagent limit reached")
            expect(error).toContain("2 of 2")
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                SubagentLimits.__testHooks.treeLimit = undefined
              }),
            ),
          ),
      ),
    45_000,
  )
})
