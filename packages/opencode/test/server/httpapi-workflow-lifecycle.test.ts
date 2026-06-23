import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import fs from "fs/promises"
import path from "path"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Session } from "@/session/session"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

// Full HTTP lifecycle through the REAL instance httpapi (the answer-route test
// only checks registration; this drives the actual request sequence). The
// fixtures use ONLY ctx.question (no ctx.agent), so no LLM/prompt-ops are needed:
// the question waits live and the answer route resolves it.
//
// Execution-time reconciliation (Task 3): the harness shape was copied from
// test/server/httpapi-session.test.ts — a LOCAL httpApiLayer built from
// HttpApiApp.routes + NodeHttpServer.layerTest, merged with the instance/session/
// db layers via testEffect (NOT testEffectShared). The response is an Effect
// HttpClientResponse: `response.status` is a property and `response.json` is an
// Effect (yield it). Directory is carried via the x-opencode-directory header
// (request() drops the query string by setting the URL to the pathname).
const instanceStoreLayer = InstanceStore.defaultLayer.pipe(
  Layer.provide(
    Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void })),
  ),
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(
  Layer.mergeAll(instanceStoreLayer, Project.defaultLayer, Session.defaultLayer, Database.defaultLayer, httpApiLayer),
)

function requestInDirectory(reqPath: string, directory: string, init: RequestInit = {}) {
  const url = new URL(reqPath, "http://localhost")
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpClientRequest.fromWeb(new Request(url, { ...init, headers })).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function bodyJson(response: HttpClientResponse.HttpClientResponse) {
  return response.json as Effect.Effect<Record<string, any>, unknown, never>
}

async function writeWorkflow(dir: string, name: string, source: string) {
  const workflows = path.join(dir, ".opencode", "workflows")
  await fs.mkdir(workflows, { recursive: true })
  await Bun.write(path.join(workflows, `${name}.ts`), source)
}

const LIVE_Q = `export const meta = { name: "http-live-q", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.question({ question: "deploy?", options: ["yes", "no"] })
  return { answer: a.answer }
}
`
const PARK_Q = `export const meta = { name: "http-park-q", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.question({ question: "deploy?", options: ["yes", "no"], timeout: 50 })
  return { answer: a.answer }
}
`

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("workflow HTTP lifecycle e2e", () => {
  it.live("start -> question -> answer (live) completes through the httpapi", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => writeWorkflow(directory, "http-live-q", LIVE_Q))

      const startRes = yield* requestInDirectory("/workflow/http-live-q/start", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(startRes.status).toBe(200)
      const started = yield* bodyJson(startRes)
      const id = started["id"] as string
      expect(id).toMatch(/^job/)

      // Poll GET until the pending question is live.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const res = yield* requestInDirectory(`/workflow/run/${id}`, directory)
          const run = yield* bodyJson(res)
          return run?.["pending_question"]?.question === "deploy?" ? run : undefined
        }),
        "pending question via GET",
      )

      // Answer it live.
      const answerRes = yield* requestInDirectory(`/workflow/run/${id}/answer`, directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: "yes" }),
      })
      expect(answerRes.status).toBe(200)
      const answered = yield* bodyJson(answerRes)
      // Live answer returns the SAME run id (resolved in place).
      expect(answered["id"]).toBe(id)

      // Poll GET until completed.
      const done = yield* pollWithTimeout(
        Effect.gen(function* () {
          const res = yield* requestInDirectory(`/workflow/run/${id}`, directory)
          const run = yield* bodyJson(res)
          return run?.["status"] === "completed" ? run : undefined
        }),
        "run completed via GET",
      )
      expect(done["result"]).toEqual({ answer: "yes" })
    }).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )

  it.live("start -> park (timeout) -> answer-as-resume -> completed through the httpapi", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => writeWorkflow(directory, "http-park-q", PARK_Q))

      const startRes = yield* requestInDirectory("/workflow/http-park-q/start", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const started = yield* bodyJson(startRes)
      const id = started["id"] as string

      // Poll GET until the 50ms-timeout parks it as paused with the question kept.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const res = yield* requestInDirectory(`/workflow/run/${id}`, directory)
          const run = yield* bodyJson(res)
          return run?.["status"] === "paused" && run?.["pending_question"]?.question === "deploy?" ? run : undefined
        }),
        "run parked paused via GET",
      )

      // answer() on a PARKED run returns a NEW resumed run (resume_of = parked id).
      const answerRes = yield* requestInDirectory(`/workflow/run/${id}/answer`, directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: "no" }),
      })
      expect(answerRes.status).toBe(200)
      const resumed = yield* bodyJson(answerRes)
      expect(resumed["id"]).not.toBe(id)
      expect(resumed["resume_of"]).toBe(id)
      const resumedId = resumed["id"] as string

      const done = yield* pollWithTimeout(
        Effect.gen(function* () {
          const res = yield* requestInDirectory(`/workflow/run/${resumedId}`, directory)
          const run = yield* bodyJson(res)
          return run?.["status"] === "completed" ? run : undefined
        }),
        "resumed run completed via GET",
      )
      expect(done["result"]).toEqual({ answer: "no" })
    }).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )

  it.live("start by name on a computed-meta file is a 400 through the httpapi", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      // Computed meta (globalThis lookup) is not statically analyzable: the
      // engine's meta gate must reject the NAME start before importing the
      // module, surfacing as a 400 WorkflowApiError on the HTTP start route.
      yield* Effect.promise(() =>
        writeWorkflow(
          directory,
          "http-computed-meta",
          `export const meta = { name: globalThis.__wfName ?? "computed" }
export async function run(args, ctx) { return { ok: true } }
`,
        ),
      )

      const startRes = yield* requestInDirectory("/workflow/http-computed-meta/start", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(startRes.status).toBe(400)
      const body = yield* bodyJson(startRes)
      expect(JSON.stringify(body)).toContain("statically analyzable")
    }).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )

  it.live("save -> file written + discoverable; duplicate is 409; bad name is 400", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const source = `export const meta = { name: "http-saved", description: "saved via http" }
export async function run(args, ctx) { return { ok: true } }
`
      // Save a brand-new workflow → 200 + the absolute path.
      const saveRes = yield* requestInDirectory("/workflow/save", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "http-saved", source }),
      })
      expect(saveRes.status).toBe(200)
      const saved = yield* bodyJson(saveRes)
      const expected = path.join(directory, ".opencode", "workflows", "http-saved.ts")
      expect(saved["path"]).toBe(expected)
      // The file really exists on disk with the exact source.
      const onDisk = yield* Effect.promise(() => Bun.file(expected).text())
      expect(onDisk).toBe(source)
      // It is now discoverable via the list route.
      const listRes = yield* requestInDirectory("/workflow", directory)
      const list = (yield* bodyJson(listRes)) as unknown as Array<{ name: string }>
      expect(list.some((info) => info.name === "http-saved")).toBe(true)

      // A duplicate save is a 409 (never overwrites).
      const dupRes = yield* requestInDirectory("/workflow/save", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "http-saved", source }),
      })
      expect(dupRes.status).toBe(409)

      // A bad name (path traversal) is a 400.
      const badRes = yield* requestInDirectory("/workflow/save", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "../escape", source }),
      })
      expect(badRes.status).toBe(400)
    }).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )

  it.live("source -> resolves on-disk file text, builtin string, and 404 for unknown through the httpapi", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const source = `export const meta = { name: "http-source", description: "source preview" }
export async function run(args, ctx) { return { ok: true } }
`
      yield* Effect.promise(() => writeWorkflow(directory, "http-source", source))

      // On-disk workflow: the source route returns the exact file text (NOT a raw
      // file.read of an absolute path, which failed before the fix).
      const onDiskRes = yield* requestInDirectory("/workflow/http-source/source", directory)
      expect(onDiskRes.status).toBe(200)
      const onDisk = yield* bodyJson(onDiskRes)
      expect(onDisk["name"]).toBe("http-source")
      expect(onDisk["source"]).toBe(source)
      expect(onDisk["source_kind"]).toBeUndefined()

      // Builtin: the source route returns the bundled string and flags it builtin,
      // even though its `path` is a synthetic `builtin:` marker (no real file).
      const { BUILTIN_WORKFLOWS } = yield* Effect.promise(() => import("@/workflow/builtin"))
      const builtinRes = yield* requestInDirectory("/workflow/deep-research/source", directory)
      expect(builtinRes.status).toBe(200)
      const builtin = yield* bodyJson(builtinRes)
      expect(builtin["source"]).toBe(BUILTIN_WORKFLOWS["deep-research"])
      expect(builtin["source_kind"]).toBe("builtin")

      // Unknown name → 404 (matching the *NotFound → 404 convention).
      const missingRes = yield* requestInDirectory("/workflow/does-not-exist-xyz/source", directory)
      expect(missingRes.status).toBe(404)
    }).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )

  // Item 15: the skip route's status contract. 404 for an unknown run id; 409
  // for a known live run whose addressed node is not skippable (a question node
  // is answered, never skipped; an unknown agent id has nothing to skip).
  it.live("skip route returns 404 for unknown runs and 409 for unskippable nodes", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => writeWorkflow(directory, "http-live-q", LIVE_Q))

      // Unknown run id → 404.
      const missing = yield* requestInDirectory("/workflow/run/job_does_not_exist/agent/1/skip", directory, {
        method: "POST",
      })
      expect(missing.status).toBe(404)

      // Live run parked on a QUESTION node: skipping it is a 409 (answer it
      // instead) — and an unknown agent id is a 409 too.
      const startRes = yield* requestInDirectory("/workflow/http-live-q/start", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const started = yield* bodyJson(startRes)
      const id = started["id"] as string
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const res = yield* requestInDirectory(`/workflow/run/${id}`, directory)
          const run = yield* bodyJson(res)
          return run?.["pending_question"]?.question === "deploy?" ? run : undefined
        }),
        "pending question via GET",
      )
      const questionSkip = yield* requestInDirectory(`/workflow/run/${id}/agent/1/skip`, directory, {
        method: "POST",
      })
      expect(questionSkip.status).toBe(409)
      const unknownAgent = yield* requestInDirectory(`/workflow/run/${id}/agent/99/skip`, directory, {
        method: "POST",
      })
      expect(unknownAgent.status).toBe(409)

      // Cleanup: stop the live run.
      const cancelRes = yield* requestInDirectory(`/workflow/run/${id}/cancel`, directory, { method: "POST" })
      expect(cancelRes.status).toBe(200)
    }).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )

  // Item 27: the export route. POST /workflow/run/:id/export materializes the
  // run's transcripts (run.json + one JSONL per agent node) and returns the
  // directory + file names; an unknown id is a 404.
  it.live("export route returns 200 with path+files for a known run and 404 for unknown", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => writeWorkflow(directory, "http-live-q", LIVE_Q))

      // Unknown run id → 404.
      const missing = yield* requestInDirectory("/workflow/run/job_does_not_exist/export", directory, {
        method: "POST",
      })
      expect(missing.status).toBe(404)

      // Run the question workflow to completion (no agents needed).
      const startRes = yield* requestInDirectory("/workflow/http-live-q/start", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const started = yield* bodyJson(startRes)
      const id = started["id"] as string
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const res = yield* requestInDirectory(`/workflow/run/${id}`, directory)
          const run = yield* bodyJson(res)
          return run?.["pending_question"]?.question === "deploy?" ? run : undefined
        }),
        "pending question via GET",
      )
      yield* requestInDirectory(`/workflow/run/${id}/answer`, directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: "yes" }),
      })
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const res = yield* requestInDirectory(`/workflow/run/${id}`, directory)
          const run = yield* bodyJson(res)
          return run?.["status"] === "completed" ? run : undefined
        }),
        "run completed via GET",
      )

      // Export → 200 with the transcripts directory + the written files
      // (run.json plus the question node's fallback JSONL).
      const exportRes = yield* requestInDirectory(`/workflow/run/${id}/export`, directory, { method: "POST" })
      expect(exportRes.status).toBe(200)
      const exported = yield* bodyJson(exportRes)
      expect(typeof exported["path"]).toBe("string")
      expect(exported["path"]).toContain(path.join("workflow", id, "transcripts"))
      expect(exported["files"]).toContain("run.json")
      expect(exported["files"]).toContain("1.jsonl")
      // The files really exist and parse.
      const runJson = JSON.parse(
        yield* Effect.promise(() => fs.readFile(path.join(exported["path"] as string, "run.json"), "utf8")),
      ) as { id: string }
      expect(runJson.id).toBe(id)

      // Cleanup the per-run export dir (the data dir is test-scoped, but leave
      // nothing behind locally).
      yield* Effect.promise(() =>
        fs.rm(path.dirname(exported["path"] as string), { recursive: true, force: true }),
      )
    }).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )

  it.live("start -> cancel (live-waiting question) transitions to cancelled through the httpapi", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => writeWorkflow(directory, "http-live-q", LIVE_Q))

      const startRes = yield* requestInDirectory("/workflow/http-live-q/start", directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const started = yield* bodyJson(startRes)
      const id = started["id"] as string

      yield* pollWithTimeout(
        Effect.gen(function* () {
          const res = yield* requestInDirectory(`/workflow/run/${id}`, directory)
          const run = yield* bodyJson(res)
          return run?.["pending_question"]?.question === "deploy?" ? run : undefined
        }),
        "pending question via GET",
      )

      const cancelRes = yield* requestInDirectory(`/workflow/run/${id}/cancel`, directory, { method: "POST" })
      expect(cancelRes.status).toBe(200)
      const cancelled = yield* bodyJson(cancelRes)
      expect(cancelled["status"]).toBe("cancelled")

      // 409 on answering a run with no open question (now terminal).
      const lateAnswer = yield* requestInDirectory(`/workflow/run/${id}/answer`, directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: "yes" }),
      })
      expect(lateAnswer.status).toBe(409)
    }).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )
})
