/**
 * End-to-end exerciser for the legacy Hono instance routes and the Effect HttpApi routes.
 *
 * The goal is not to be a normal unit test file. This is a route-coverage and parity
 * harness we can run while deleting Hono: every public route should eventually have a
 * small scenario that proves the Effect route decodes requests, uses the right instance
 * context, mutates storage when expected, and returns a compatible response shape.
 *
 * The script intentionally isolates `OPENCODE_DB` before importing modules that touch
 * storage. Scenarios may create/delete sessions and reset the database after each run,
 * so this must never point at a developer's real session database.
 *
 * DSL shape:
 * - `http.get/post/...` starts a scenario for one OpenAPI route key.
 * - `.seeded(...)` creates typed per-scenario state using Effect helpers on `ctx`.
 * - `.at(...)` builds the request from that typed state.
 * - `.json(...)` / `.jsonEffect(...)` assert response shape and optional side effects.
 * - `.mutating()` tells parity mode to run Effect and Hono in separate isolated contexts
 *   so destructive routes compare equivalent fresh setups instead of sharing one DB.
 */
import { Cause, ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { Flag } from "@opencode-ai/core/flag/flag"
import { TestLLMServer } from "../test/lib/llm-server"
import type { Config } from "../src/config/config"
import { MessageID, PartID, type SessionID } from "../src/session/schema"
import { ModelID, ProviderID } from "../src/provider/schema"
import type { MessageV2 } from "../src/session/message-v2"
import type { Worktree } from "../src/worktree"
import type { Project } from "../src/project/project"
import path from "path"

const preserveExerciseGlobalRoot = !!process.env.OPENCODE_HTTPAPI_EXERCISE_GLOBAL
const exerciseGlobalRoot =
  process.env.OPENCODE_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `opencode-httpapi-global-${process.pid}`)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
process.env.OPENCODE_DISABLE_SHARE = "true"
const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "opencode")
const exerciseDataDirectory = path.join(exerciseGlobalRoot, "data", "opencode")

const preserveExerciseDatabase = !!process.env.OPENCODE_HTTPAPI_EXERCISE_DB
const exerciseDatabasePath =
  process.env.OPENCODE_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `opencode-httpapi-exercise-${process.pid}.db`)
process.env.OPENCODE_DB = exerciseDatabasePath
Flag.OPENCODE_DB = exerciseDatabasePath

void (await import("@opencode-ai/core/util/log")).init({ print: false })

const OpenApiMethods = ["get", "post", "put", "delete", "patch"] as const
const Methods = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const
const color = {
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
}

type Method = (typeof Methods)[number]
type OpenApiMethod = (typeof OpenApiMethods)[number]
type Mode = "effect" | "parity" | "coverage"
type Backend = "effect" | "legacy"
type Comparison = "none" | "status" | "json"
type CaptureMode = "full" | "stream"
type ProjectOptions = { git?: boolean; config?: Partial<Config.Info>; llm?: boolean }
type OpenApiSpec = { paths?: Record<string, Partial<Record<OpenApiMethod, unknown>>> }
type JsonObject = Record<string, unknown>

type Options = {
  mode: Mode
  include: string | undefined
  failOnMissing: boolean
  failOnSkip: boolean
}

type RequestSpec = {
  path: string
  headers?: Record<string, string>
  body?: unknown
}

type CallResult = {
  status: number
  contentType: string
  body: unknown
  text: string
}

type BackendApp = {
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

/** Effect-native helpers available while setting up and asserting a scenario. */
type ScenarioContext = {
  directory: string | undefined
  headers: (extra?: Record<string, string>) => Record<string, string>
  file: (name: string, content: string) => Effect.Effect<void>
  session: (input?: { title?: string; parentID?: SessionID }) => Effect.Effect<SessionInfo>
  sessionGet: (sessionID: SessionID) => Effect.Effect<SessionInfo | undefined>
  project: () => Effect.Effect<Project.Info>
  message: (sessionID: SessionID, input?: { text?: string }) => Effect.Effect<MessageSeed>
  messages: (sessionID: SessionID) => Effect.Effect<MessageV2.WithParts[]>
  todos: (sessionID: SessionID, todos: TodoInfo[]) => Effect.Effect<void>
  worktree: (input?: { name?: string }) => Effect.Effect<Worktree.Info>
  worktreeRemove: (directory: string) => Effect.Effect<void>
  llmText: (value: string) => Effect.Effect<void>
  llmWait: (count: number) => Effect.Effect<void>
  tuiRequest: (request: { path: string; body: unknown }) => Effect.Effect<void>
}

/** Scenario context after `.seeded(...)`; `state` preserves the seed return type in the DSL. */
type SeededContext<S> = ScenarioContext & {
  state: S
}

type Scenario = ActiveScenario | TodoScenario
type ActiveScenario = {
  kind: "active"
  method: Method
  path: string
  name: string
  project: ProjectOptions | undefined
  seed: (ctx: ScenarioContext) => Effect.Effect<unknown>
  request: (ctx: ScenarioContext, state: unknown) => RequestSpec
  expect: (ctx: ScenarioContext, state: unknown, result: CallResult) => Effect.Effect<void>
  compare: Comparison
  capture: CaptureMode
  mutates: boolean
  reset: boolean
}

/** Internal builder state stays generic until `.json(...)` erases it into `ActiveScenario`. */
type BuilderState<S> = {
  method: Method
  path: string
  name: string
  project: ProjectOptions | undefined
  seed: (ctx: ScenarioContext) => Effect.Effect<S>
  request: (ctx: SeededContext<S>) => RequestSpec
  capture: CaptureMode
  mutates: boolean
  reset: boolean
}
type TodoScenario = {
  kind: "todo"
  method: Method
  path: string
  name: string
  reason: string
}
type Result =
  | { status: "pass"; scenario: ActiveScenario }
  | { status: "fail"; scenario: ActiveScenario; message: string }
  | { status: "skip"; scenario: TodoScenario }

type SessionInfo = { id: SessionID; title: string; parentID?: SessionID }
type TodoInfo = { content: string; status: string; priority: string }
type MessageSeed = { info: MessageV2.User; part: MessageV2.TextPart }

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}

type Runtime = {
  PublicApi: (typeof import("../src/server/routes/instance/httpapi/public"))["PublicApi"]
  ExperimentalHttpApiServer: (typeof import("../src/server/routes/instance/httpapi/server"))["ExperimentalHttpApiServer"]
  Server: (typeof import("../src/server/server"))["Server"]
  AppLayer: (typeof import("../src/effect/app-runtime"))["AppLayer"]
  InstanceRef: (typeof import("../src/effect/instance-ref"))["InstanceRef"]
  Instance: (typeof import("../src/project/instance"))["Instance"]
  InstanceStore: (typeof import("../src/project/instance-store"))["InstanceStore"]
  Session: (typeof import("../src/session/session"))["Session"]
  Todo: (typeof import("../src/session/todo"))["Todo"]
  Worktree: (typeof import("../src/worktree"))["Worktree"]
  Project: (typeof import("../src/project/project"))["Project"]
  Tui: typeof import("../src/server/shared/tui-control")
  disposeAllInstances: (typeof import("../test/fixture/fixture"))["disposeAllInstances"]
  tmpdir: (typeof import("../test/fixture/fixture"))["tmpdir"]
  resetDatabase: (typeof import("../test/fixture/db"))["resetDatabase"]
}

let runtimePromise: Promise<Runtime> | undefined

function runtime() {
  return (runtimePromise ??= (async () => {
    const publicApi = await import("../src/server/routes/instance/httpapi/public")
    const httpApiServer = await import("../src/server/routes/instance/httpapi/server")
    const server = await import("../src/server/server")
    const appRuntime = await import("../src/effect/app-runtime")
    const instanceRef = await import("../src/effect/instance-ref")
    const instance = await import("../src/project/instance")
    const instanceStore = await import("../src/project/instance-store")
    const session = await import("../src/session/session")
    const todo = await import("../src/session/todo")
    const worktree = await import("../src/worktree")
    const project = await import("../src/project/project")
    const tui = await import("../src/server/shared/tui-control")
    const fixture = await import("../test/fixture/fixture")
    const db = await import("../test/fixture/db")
    return {
      PublicApi: publicApi.PublicApi,
      ExperimentalHttpApiServer: httpApiServer.ExperimentalHttpApiServer,
      Server: server.Server,
      AppLayer: appRuntime.AppLayer,
      InstanceRef: instanceRef.InstanceRef,
      Instance: instance.Instance,
      InstanceStore: instanceStore.InstanceStore,
      Session: session.Session,
      Todo: todo.Todo,
      Worktree: worktree.Worktree,
      Project: project.Project,
      Tui: tui,
      disposeAllInstances: fixture.disposeAllInstances,
      tmpdir: fixture.tmpdir,
      resetDatabase: db.resetDatabase,
    }
  })())
}

class ScenarioBuilder<S = undefined> {
  private readonly state: BuilderState<S>

  constructor(method: Method, path: string, name: string) {
    this.state = {
      method,
      path,
      name,
      project: { git: true },
      seed: () => Effect.succeed(undefined as S),
      request: (ctx) => ({ path, headers: ctx.headers() }),
      capture: "full",
      mutates: false,
      reset: true,
    }
  }

  global() {
    return this.clone({ project: undefined, request: () => ({ path: this.state.path }) })
  }

  inProject(project: ProjectOptions = { git: true }) {
    return this.clone({ project })
  }

  withLlm() {
    return this.clone({ project: { ...(this.state.project ?? { git: true }), llm: true } })
  }

  at(request: BuilderState<S>["request"]) {
    return this.clone({ request })
  }

  mutating() {
    return this.clone({ mutates: true })
  }

  preserveDatabase() {
    return this.clone({ reset: false })
  }

  stream() {
    return this.clone({ capture: "stream" })
  }

  /** Assert a non-JSON or shape-only response. */
  ok(status = 200, compare: Comparison = "status") {
    return this.done(compare, (_ctx, result) =>
      Effect.sync(() => {
        if (result.status !== status) throw new Error(`expected ${status}, got ${result.status}: ${result.text}`)
      }),
    )
  }

  status(
    status = 200,
    inspect?: (ctx: SeededContext<S>, result: CallResult) => Effect.Effect<void>,
    compare: Comparison = "status",
  ) {
    return this.done(compare, (ctx, result) =>
      Effect.gen(function* () {
        if (result.status !== status) throw new Error(`expected ${status}, got ${result.status}: ${result.text}`)
        if (inspect) yield* inspect(ctx, result)
      }),
    )
  }

  /** Assert JSON status/content-type plus an optional synchronous body check. */
  json(status = 200, inspect?: (body: unknown, ctx: SeededContext<S>) => void, compare: Comparison = "json") {
    return this.jsonEffect(status, inspect ? (body, ctx) => Effect.sync(() => inspect(body, ctx)) : undefined, compare)
  }

  /** Assert JSON status/content-type plus optional Effect assertions, e.g. DB side effects. */
  jsonEffect(
    status = 200,
    inspect?: (body: unknown, ctx: SeededContext<S>) => Effect.Effect<void>,
    compare: Comparison = "json",
  ) {
    return this.done(compare, (ctx, result) =>
      Effect.gen(function* () {
        if (result.status !== status) throw new Error(`expected ${status}, got ${result.status}: ${result.text}`)
        if (!looksJson(result))
          throw new Error(`expected JSON response, got ${result.contentType || "no content-type"}`)
        if (inspect) yield* inspect(result.body, ctx)
      }),
    )
  }

  private clone(next: Partial<BuilderState<S>>) {
    const builder = new ScenarioBuilder<S>(this.state.method, this.state.path, this.state.name)
    Object.assign(builder.state, this.state, next)
    return builder
  }

  /**
   * Seed typed state before the HTTP request. The returned value becomes `ctx.state`
   * for `.at(...)` and assertions, giving stateful route tests type-safe setup.
   */
  seeded<Next>(seed: (ctx: ScenarioContext) => Effect.Effect<Next>) {
    const builder = new ScenarioBuilder<Next>(this.state.method, this.state.path, this.state.name)
    Object.assign(builder.state, this.state, { seed })
    return builder
  }

  private done(
    compare: Comparison,
    expect: (ctx: SeededContext<S>, result: CallResult) => Effect.Effect<void>,
  ): ActiveScenario {
    const state = this.state
    return {
      kind: "active",
      method: state.method,
      path: state.path,
      name: state.name,
      project: state.project,
      seed: state.seed,
      request: (ctx, seeded) => state.request({ ...ctx, state: seeded as S }),
      expect: (ctx, seeded, result) => expect({ ...ctx, state: seeded as S }, result),
      compare,
      capture: state.capture,
      mutates: state.mutates,
      reset: state.reset,
    }
  }
}

const http = {
  get: (path: string, name: string) => new ScenarioBuilder("GET", path, name),
  post: (path: string, name: string) => new ScenarioBuilder("POST", path, name),
  put: (path: string, name: string) => new ScenarioBuilder("PUT", path, name),
  patch: (path: string, name: string) => new ScenarioBuilder("PATCH", path, name),
  delete: (path: string, name: string) => new ScenarioBuilder("DELETE", path, name),
}

const pending = (method: Method, path: string, name: string, reason: string): TodoScenario => ({
  kind: "todo",
  method,
  path,
  name,
  reason,
})

function route(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce(
    (next, [key, value]) => next.replaceAll(`{${key}}`, value).replaceAll(`:${key}`, value),
    template,
  )
}

const scenarios: Scenario[] = [
  http
    .get("/global/health", "global.health")
    .global()
    .json(200, (body) => {
      object(body)
      check(body.healthy === true, "server should report healthy")
    }),
  http
    .get("/global/event", "global.event")
    .global()
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "global event should be an SSE stream")
          check(result.text.includes("server.connected"), "global event should emit initial connection event")
        }),
      "status",
    ),
  http.get("/global/config", "global.config.get").global().json(),
  http
    .patch("/global/config", "global.config.update")
    .global()
    .seeded(() =>
      Effect.promise(() =>
        Bun.write(
          path.join(exerciseConfigDirectory, "opencode.jsonc"),
          JSON.stringify({ username: "httpapi-global" }, null, 2),
        ),
      ),
    )
    .at(() => ({ path: "/global/config", body: { username: "httpapi-global" } }))
    .jsonEffect(
      200,
      (body) =>
        Effect.gen(function* () {
          object(body)
          check(body.username === "httpapi-global", "global config update should return patched config")
          const text = yield* Effect.promise(() =>
            Bun.file(path.join(exerciseConfigDirectory, "opencode.jsonc")).text(),
          )
          check(text.includes('"username": "httpapi-global"'), "global config update should write isolated config file")
        }),
      "status",
    ),
  http
    .post("/global/dispose", "global.dispose")
    .global()
    .mutating()
    .json(
      200,
      (body) => {
        check(body === true, "global dispose should return true")
      },
      "status",
    ),
  http.get("/path", "path.get").json(200, (body, ctx) => {
    object(body)
    check(body.directory === ctx.directory, "directory should resolve from x-opencode-directory")
    check(body.worktree === ctx.directory, "worktree should resolve from x-opencode-directory")
  }),
  http.get("/vcs", "vcs.get").json(),
  http
    .get("/vcs/diff", "vcs.diff")
    .at((ctx) => ({ path: "/vcs/diff?mode=git", headers: ctx.headers() }))
    .json(200, array),
  http.get("/command", "command.list").json(200, array, "status"),
  http.get("/agent", "app.agents").json(200, array, "status"),
  http.get("/skill", "app.skills").json(200, array, "status"),
  http.get("/lsp", "lsp.status").json(200, array),
  http.get("/formatter", "formatter.status").json(200, array),
  http.get("/config", "config.get").json(200, undefined, "status"),
  http
    .patch("/config", "config.update")
    .mutating()
    .at((ctx) => ({ path: "/config", headers: ctx.headers(), body: { username: "httpapi-local" } }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.username === "httpapi-local", "local config update should return patched config")
      },
      "status",
    ),
  http
    .patch("/config", "config.update.invalid")
    .at((ctx) => ({ path: "/config", headers: ctx.headers(), body: { username: 1 } }))
    .status(400),
  http.get("/config/providers", "config.providers").json(),
  http.get("/project", "project.list").json(200, array, "status"),
  http.get("/project/current", "project.current").json(
    200,
    (body, ctx) => {
      object(body)
      check(body.worktree === ctx.directory, "current project should resolve from scenario directory")
    },
    "status",
  ),
  http
    .patch("/project/{projectID}", "project.update")
    .mutating()
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/project/{projectID}", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: { name: "HTTP API Project", commands: { start: "bun --version" } },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.name === "HTTP API Project", "project update should return patched name")
        check(
          isRecord(body.commands) && body.commands.start === "bun --version",
          "project update should return patched command",
        )
      },
      "status",
    ),
  http
    .post("/project/git/init", "project.initGit")
    .mutating()
    .inProject({ git: false })
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.worktree === ctx.directory, "git init should return current project")
        check(body.vcs === "git", "git init should mark the project as git-backed")
      },
      "status",
    ),
  http.get("/provider", "provider.list").json(),
  http.get("/provider/auth", "provider.auth").json(),
  http
    .post("/provider/{providerID}/oauth/authorize", "provider.oauth.authorize")
    .at((ctx) => ({
      path: route("/provider/{providerID}/oauth/authorize", { providerID: "httpapi" }),
      headers: ctx.headers(),
      body: { method: "bad" },
    }))
    .status(400),
  http
    .post("/provider/{providerID}/oauth/callback", "provider.oauth.callback")
    .at((ctx) => ({
      path: route("/provider/{providerID}/oauth/callback", { providerID: "httpapi" }),
      headers: ctx.headers(),
      body: { method: "bad" },
    }))
    .status(400),
  http.get("/permission", "permission.list").json(200, array),
  http
    .post("/permission/{requestID}/reply", "permission.reply.invalid")
    .at((ctx) => ({
      path: route("/permission/{requestID}/reply", { requestID: "per_httpapi" }),
      headers: ctx.headers(),
      body: { reply: "bad" },
    }))
    .status(400),
  http
    .post("/permission/{requestID}/reply", "permission.reply")
    .at((ctx) => ({
      path: route("/permission/{requestID}/reply", { requestID: "per_httpapi" }),
      headers: ctx.headers(),
      body: { reply: "once" },
    }))
    .json(200, (body) => {
      check(body === true, "permission reply should return true even when request is no longer pending")
    }),
  http.get("/question", "question.list").json(200, array),
  http
    .post("/question/{requestID}/reply", "question.reply.invalid")
    .at((ctx) => ({
      path: route("/question/{requestID}/reply", { requestID: "que_httpapi_reply" }),
      headers: ctx.headers(),
      body: { answers: "Yes" },
    }))
    .status(400),
  http
    .post("/question/{requestID}/reply", "question.reply")
    .at((ctx) => ({
      path: route("/question/{requestID}/reply", { requestID: "que_httpapi_reply" }),
      headers: ctx.headers(),
      body: { answers: [["Yes"]] },
    }))
    .json(200, (body) => {
      check(body === true, "question reply should return true even when request is no longer pending")
    }),
  http
    .post("/question/{requestID}/reject", "question.reject")
    .at((ctx) => ({
      path: route("/question/{requestID}/reject", { requestID: "que_httpapi_reject" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === true, "question reject should return true even when request is no longer pending")
    }),
  http
    .get("/file", "file.list")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/file?${new URLSearchParams({ path: "." })}`, headers: ctx.headers() }))
    .json(200, array),
  http
    .get("/file/content", "file.read")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/file/content?${new URLSearchParams({ path: "hello.txt" })}`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.content === "hello", `content should match seeded file: ${JSON.stringify(body)}`)
    }),
  http
    .get("/file/content", "file.read.missing")
    .at((ctx) => ({ path: `/file/content?${new URLSearchParams({ path: "missing.txt" })}`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.type === "text" && body.content === "", "missing file content should return an empty text result")
    }),
  http.get("/file/status", "file.status").json(200, array),
  http
    .get("/find", "find.text")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/find?${new URLSearchParams({ pattern: "hello" })}`, headers: ctx.headers() }))
    .json(200, array),
  http
    .get("/find/file", "find.files")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({
      path: `/find/file?${new URLSearchParams({ query: "hello", dirs: "false" })}`,
      headers: ctx.headers(),
    }))
    .json(200, array),
  http
    .get("/find/symbol", "find.symbols")
    .seeded((ctx) => ctx.file("hello.ts", "export const hello = 1\n"))
    .at((ctx) => ({ path: `/find/symbol?${new URLSearchParams({ query: "hello" })}`, headers: ctx.headers() }))
    .json(200, array),
  http
    .get("/event", "event.stream")
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "event should be an SSE stream")
          check(result.text.includes("server.connected"), "event should emit initial connection event")
        }),
      "status",
    ),
  http.get("/mcp", "mcp.status").json(),
  http
    .post("/mcp", "mcp.add")
    .mutating()
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-disabled", config: { type: "local", command: ["bun", "--version"], enabled: false } },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body["httpapi-disabled"])
        check(body["httpapi-disabled"].status === "disabled", "disabled MCP server should be added without spawning")
      },
      "status",
    ),
  http
    .post("/mcp", "mcp.add.invalid")
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-invalid", config: { type: "invalid" } },
    }))
    .status(400),
  http
    .post("/mcp/{name}/auth", "mcp.auth.start")
    .at((ctx) => ({ path: route("/mcp/{name}/auth", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(
      400,
      (body) => {
        object(body)
        check(typeof body.error === "string", "unsupported MCP OAuth response should include error")
      },
      "status",
    ),
  http
    .delete("/mcp/{name}/auth", "mcp.auth.remove")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/auth", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.success === true, "MCP auth removal should return success")
    }),
  http
    .post("/mcp/{name}/auth/authenticate", "mcp.auth.authenticate")
    .at((ctx) => ({
      path: route("/mcp/{name}/auth/authenticate", { name: "httpapi-missing" }),
      headers: ctx.headers(),
    }))
    .json(
      400,
      (body) => {
        object(body)
        check(typeof body.error === "string", "unsupported MCP OAuth authenticate response should include error")
      },
      "status",
    ),
  http
    .post("/mcp/{name}/auth/callback", "mcp.auth.callback")
    .at((ctx) => ({
      path: route("/mcp/{name}/auth/callback", { name: "httpapi-missing" }),
      headers: ctx.headers(),
      body: { code: 1 },
    }))
    .status(400),
  http
    .post("/mcp/{name}/connect", "mcp.connect")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/connect", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(200, (body) => {
      check(body === true, "missing MCP connect should remain a no-op success")
    }),
  http
    .post("/mcp/{name}/disconnect", "mcp.disconnect")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/disconnect", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(200, (body) => {
      check(body === true, "missing MCP disconnect should remain a no-op success")
    }),
  http.get("/pty/shells", "pty.shells").json(200, array),
  http.get("/pty", "pty.list").json(200, array),
  http
    .post("/pty", "pty.create")
    .mutating()
    .at((ctx) => ({ path: "/pty", headers: ctx.headers(), body: controlledPtyInput("HTTP API PTY") }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.title === "HTTP API PTY", "PTY create should return requested title")
        check(body.command === "/bin/sh", "PTY create should use controlled shell command")
        check(body.cwd === ctx.directory, "PTY create should default cwd to scenario directory")
      },
      "status",
    ),
  http
    .post("/pty", "pty.create.invalid")
    .at((ctx) => ({ path: "/pty", headers: ctx.headers(), body: { command: 1 } }))
    .status(400),
  http
    .get("/pty/{ptyID}", "pty.get")
    .at((ctx) => ({ path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .status(404),
  http
    .put("/pty/{ptyID}", "pty.update")
    .mutating()
    .at((ctx) => ({
      path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
      body: { size: { rows: 0, cols: 0 } },
    }))
    .status(400),
  http
    .delete("/pty/{ptyID}", "pty.remove")
    .mutating()
    .at((ctx) => ({ path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(200, (body) => {
      check(body === true, "PTY remove should return true")
    }),
  http
    .get("/pty/{ptyID}/connect", "pty.connect")
    .at((ctx) => ({ path: route("/pty/{ptyID}/connect", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .status(404, undefined, "none"),
  http.get("/experimental/console", "experimental.console.get").json(),
  http.get("/experimental/console/orgs", "experimental.console.listOrgs").json(),
  http
    .post("/experimental/console/switch", "experimental.console.switchOrg")
    .at((ctx) => ({
      path: "/experimental/console/switch",
      headers: ctx.headers(),
      body: { accountID: "httpapi-account", orgID: "httpapi-org" },
    }))
    .status(400, undefined, "none"),
  http.get("/experimental/workspace/adapter", "experimental.workspace.adapter.list").json(200, array),
  http.get("/experimental/workspace", "experimental.workspace.list").json(200, array),
  http.get("/experimental/workspace/status", "experimental.workspace.status").json(200, array),
  http
    .post("/experimental/workspace", "experimental.workspace.create")
    .at((ctx) => ({ path: "/experimental/workspace", headers: ctx.headers(), body: {} }))
    .status(400),
  http
    .delete("/experimental/workspace/{id}", "experimental.workspace.remove")
    .mutating()
    .at((ctx) => ({
      path: route("/experimental/workspace/{id}", { id: "wrk_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(200),
  http
    .post("/experimental/workspace/warp", "experimental.workspace.warp")
    .at((ctx) => ({
      path: "/experimental/workspace/warp",
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http
    .get("/experimental/tool", "tool.list")
    .at((ctx) => ({
      path: `/experimental/tool?${new URLSearchParams({ provider: "opencode", model: "test" })}`,
      headers: ctx.headers(),
    }))
    .json(200, array, "status"),
  http.get("/experimental/tool/ids", "tool.ids").json(200, array),
  http.get("/experimental/worktree", "worktree.list").json(200, array),
  http
    .post("/experimental/worktree", "worktree.create")
    .mutating()
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { name: "api-dsl" } }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(typeof body.directory === "string", "created worktree should include directory")
          yield* ctx.worktreeRemove(body.directory)
        }),
      "status",
    ),
  http
    .post("/experimental/worktree", "worktree.create.invalid")
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { name: 1 } }))
    .status(400),
  http
    .delete("/experimental/worktree", "worktree.remove")
    .mutating()
    .seeded((ctx) => ctx.worktree({ name: "api-remove" }))
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { directory: ctx.state.directory } }))
    .json(200, (body) => {
      check(body === true, "worktree remove should return true")
    }),
  http
    .post("/experimental/worktree/reset", "worktree.reset")
    .mutating()
    .seeded((ctx) => ctx.worktree({ name: "api-reset" }))
    .at((ctx) => ({
      path: "/experimental/worktree/reset",
      headers: ctx.headers(),
      body: { directory: ctx.state.directory },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "worktree reset should return true")
        yield* ctx.worktreeRemove(ctx.state.directory)
      }),
    ),
  http.get("/experimental/session", "experimental.session.list").json(200, array),
  http.get("/experimental/resource", "experimental.resource.list").json(),
  http
    .post("/sync/history", "sync.history.list")
    .at((ctx) => ({ path: "/sync/history", headers: ctx.headers(), body: {} }))
    .json(200, array),
  http
    .post("/sync/replay", "sync.replay")
    .at((ctx) => ({ path: "/sync/replay", headers: ctx.headers(), body: { directory: ctx.directory, events: [] } }))
    .status(400),
  http
    .post("/sync/start", "sync.start")
    .mutating()
    .preserveDatabase()
    .json(200, (body) => {
      check(body === true, "sync start should return true when no workspace sessions exist")
    }),
  http
    .post("/instance/dispose", "instance.dispose")
    .mutating()
    .json(200, (body) => {
      check(body === true, "instance dispose should return true")
    }),
  http
    .post("/log", "app.log")
    .global()
    .at(() => ({ path: "/log", body: { service: "httpapi-exercise", level: "info", message: "route coverage" } }))
    .json(200, (body) => {
      check(body === true, "log route should return true")
    }),
  http
    .put("/auth/{providerID}", "auth.set")
    .global()
    .at(() => ({ path: route("/auth/{providerID}", { providerID: "test" }), body: { type: "api", key: "test-key" } }))
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(body === true, "auth set should return true")
        const auth = yield* Effect.promise(() => Bun.file(path.join(exerciseDataDirectory, "auth.json")).json())
        object(auth)
        check(isRecord(auth.test) && auth.test.key === "test-key", "auth set should write isolated auth file")
      }),
    ),
  http
    .delete("/auth/{providerID}", "auth.remove")
    .global()
    .seeded(() =>
      Effect.promise(() =>
        Bun.write(
          path.join(exerciseDataDirectory, "auth.json"),
          JSON.stringify({ test: { type: "api", key: "remove-me" } }),
        ),
      ),
    )
    .at(() => ({ path: route("/auth/{providerID}", { providerID: "test" }) }))
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(body === true, "auth remove should return true")
        const auth = yield* Effect.promise(() => Bun.file(path.join(exerciseDataDirectory, "auth.json")).json())
        object(auth)
        check(auth.test === undefined, "auth remove should delete provider from isolated auth file")
      }),
    ),
  http
    .get("/session", "session.list")
    .seeded((ctx) => ctx.session({ title: "List me" }))
    .at((ctx) => ({ path: "/session?roots=true", headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.id && item.title === "List me"),
        "seeded session should be listed",
      )
    }),
  http
    .get("/session/status", "session.status")
    .seeded((ctx) => ctx.session({ title: "Status session" }))
    .json(200, object),
  http
    .post("/session", "session.create")
    .mutating()
    .at((ctx) => ({ path: "/session", headers: ctx.headers(), body: { title: "Created session" } }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.title === "Created session", "created session should use requested title")
        check(body.directory === ctx.directory, "created session should use scenario directory")
      },
      "status",
    ),
  http
    .get("/session/{sessionID}", "session.get")
    .seeded((ctx) => ctx.session({ title: "Get me" }))
    .at((ctx) => ({ path: route("/session/{sessionID}", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "should return requested session")
      check(body.title === "Get me", "should preserve seeded title")
    }),
  http
    .get("/session/{sessionID}", "session.get.missing")
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http
    .patch("/session/{sessionID}", "session.update")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Before rename" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { title: "After rename" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.title === "After rename", "updated session should use new title")
      },
      "status",
    ),
  http
    .patch("/session/{sessionID}", "session.update.invalid")
    .mutating()
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
      body: { title: 1 },
    }))
    .status(400),
  http
    .delete("/session/{sessionID}", "session.delete")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Delete me" }))
    .at((ctx) => ({ path: route("/session/{sessionID}", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete should return true")
        check((yield* ctx.sessionGet(ctx.state.id)) === undefined, "deleted session should not remain in storage")
      }),
    ),
  http
    .get("/session/{sessionID}/children", "session.children")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const parent = yield* ctx.session({ title: "Parent" })
        const child = yield* ctx.session({ title: "Child", parentID: parent.id })
        return { parent, child }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/children", { sessionID: ctx.state.parent.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.child.id && item.parentID === ctx.state.parent.id),
        "children should include seeded child",
      )
    }),
  http
    .get("/session/{sessionID}/todo", "session.todo")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Todo session" })
        const todos = [{ content: "cover session todo", status: "pending", priority: "high" }]
        yield* ctx.todos(session.id, todos)
        return { session, todos }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/todo", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      check(stable(body) === stable(ctx.state.todos), "todos should match seeded state")
    }),
  http
    .get("/session/{sessionID}/diff", "session.diff")
    .seeded((ctx) => ctx.session({ title: "Diff session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/diff", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, array),
  http
    .get("/session/{sessionID}/message", "session.messages")
    .seeded((ctx) => ctx.session({ title: "Messages session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/message", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 0, "new session should have no messages")
    }),
  http
    .get("/session/{sessionID}/message/{messageID}", "session.message")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Message get session" })
        const message = yield* ctx.message(session.id, { text: "read me" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
      }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(isRecord(body.info) && body.info.id === ctx.state.message.info.id, "should return requested message")
      check(
        Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.id === ctx.state.message.part.id),
        "message should include seeded part",
      )
    }),
  http
    .patch("/session/{sessionID}/message/{messageID}/part/{partID}", "part.update")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Part update session" })
        const message = yield* ctx.message(session.id, { text: "before" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}/part/{partID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
        partID: ctx.state.message.part.id,
      }),
      headers: ctx.headers(),
      body: { ...ctx.state.message.part, text: "after" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.type === "text" && body.text === "after", "updated part should be returned")
      },
      "status",
    ),
  http
    .delete("/session/{sessionID}/message/{messageID}/part/{partID}", "part.delete")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Part delete session" })
        const message = yield* ctx.message(session.id, { text: "delete part" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}/part/{partID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
        partID: ctx.state.message.part.id,
      }),
      headers: ctx.headers(),
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete part should return true")
        const messages = yield* ctx.messages(ctx.state.session.id)
        check(messages[0]?.parts.length === 0, "deleted part should not remain on message")
      }),
    ),
  http
    .delete("/session/{sessionID}/message/{messageID}", "session.deleteMessage")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Message delete session" })
        const message = yield* ctx.message(session.id, { text: "delete message" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
      }),
      headers: ctx.headers(),
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete message should return true")
        check((yield* ctx.messages(ctx.state.session.id)).length === 0, "deleted message should not remain")
      }),
    ),
  http
    .post("/session/{sessionID}/fork", "session.fork")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Fork source" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/fork", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.id === "string", "fork should return a session")
      },
      "status",
    ),
  http
    .post("/session/{sessionID}/abort", "session.abort")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Abort session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/abort", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body) => {
      check(body === true, "abort should return true")
    }),
  http
    .post("/session/{sessionID}/abort", "session.abort.missing")
    .at((ctx) => ({
      path: route("/session/{sessionID}/abort", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === true, "missing session abort should remain a no-op success")
    }),
  http
    .post("/session/{sessionID}/init", "session.init")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Init session" })
        const message = yield* ctx.message(session.id, { text: "initialize" })
        yield* ctx.llmText("initialized")
        yield* ctx.llmText("initialized")
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/init", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
      body: { providerID: "test", modelID: "test-model", messageID: ctx.state.message.info.id },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "init should return true")
        yield* ctx.llmWait(1)
      }),
    ),
  http
    .post("/session/{sessionID}/message", "session.prompt")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "LLM prompt session" })
        yield* ctx.llmText("fake assistant")
        yield* ctx.llmText("fake assistant")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        parts: [{ type: "text", text: "hello llm" }],
      },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(isRecord(body.info) && body.info.role === "assistant", "prompt should return assistant message")
          check(
            Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.text === "fake assistant"),
            "assistant message should use fake LLM text",
          )
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http
    .post("/session/{sessionID}/prompt_async", "session.prompt_async")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Async prompt session" })
        yield* ctx.llmText("fake async assistant")
        yield* ctx.llmText("fake async assistant")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/prompt_async", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        parts: [{ type: "text", text: "hello async" }],
      },
    }))
    .status(204, (ctx) =>
      Effect.gen(function* () {
        yield* ctx.llmWait(1)
      }),
    ),
  http
    .post("/session/{sessionID}/command", "session.command")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Command session" })
        yield* ctx.llmText("command done")
        yield* ctx.llmText("command done")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/command", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { command: "init", arguments: "", model: "test/test-model" },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(isRecord(body.info) && body.info.role === "assistant", "command should return assistant message")
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http
    .post("/session/{sessionID}/shell", "session.shell")
    .preserveDatabase()
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Shell session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/shell", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { agent: "build", model: { providerID: "test", modelID: "test-model" }, command: "printf shell-ok" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(isRecord(body.info) && body.info.role === "assistant", "shell should return assistant message")
        check(
          Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.type === "tool"),
          "shell should return a tool part",
        )
      },
      "status",
    ),
  http
    .post("/session/{sessionID}/summarize", "session.summarize")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Summarize session" })
        yield* ctx.message(session.id, { text: "summarize this work" })
        const summary = [
          "## Goal",
          "- Exercise session summarize.",
          "",
          "## Constraints & Preferences",
          "- Use fake LLM.",
          "",
          "## Progress",
          "### Done",
          "- Summary generated.",
          "",
          "### In Progress",
          "- (none)",
          "",
          "### Blocked",
          "- (none)",
          "",
          "## Key Decisions",
          "- Keep route local.",
          "",
          "## Next Steps",
          "- (none)",
          "",
          "## Critical Context",
          "- Test fixture.",
          "",
          "## Relevant Files",
          "- script/httpapi-exercise.ts: scenario",
        ].join("\n")
        yield* ctx.llmText(summary)
        yield* ctx.llmText(summary)
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/summarize", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { providerID: "test", modelID: "test-model", auto: false },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          check(body === true, "summarize should return true")
          const messages = yield* ctx.messages(ctx.state.id)
          check(
            messages.some((message) => message.info.role === "assistant" && message.info.summary === true),
            "summarize should create a summary assistant message",
          )
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http
    .post("/session/{sessionID}/revert", "session.revert")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Revert session" })
        const message = yield* ctx.message(session.id, { text: "revert me" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/revert", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
      body: { messageID: ctx.state.message.info.id },
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.session.id, "revert should return the session")
        check(
          isRecord(body.revert) && body.revert.messageID === ctx.state.message.info.id,
          "revert should record reverted message",
        )
      },
      "status",
    ),
  http
    .post("/session/{sessionID}/unrevert", "session.unrevert")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Unrevert session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/unrevert", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "unrevert should return the session")
      },
      "status",
    ),
  http
    .post("/session/{sessionID}/permissions/{permissionID}", "permission.respond")
    .seeded((ctx) => ctx.session({ title: "Deprecated permission session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/permissions/{permissionID}", {
        sessionID: ctx.state.id,
        permissionID: "per_httpapi_deprecated",
      }),
      headers: ctx.headers(),
      body: { response: "once" },
    }))
    .json(200, (body) => {
      check(body === true, "deprecated permission response should return true")
    }),
  http
    .post("/session/{sessionID}/share", "session.share")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Share session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/share", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "share should return the session")
      },
      "status",
    ),
  http
    .delete("/session/{sessionID}/share", "session.unshare")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Unshare session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/share", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "unshare should return the session")
      },
      "status",
    ),
  http
    .post("/tui/append-prompt", "tui.appendPrompt")
    .at((ctx) => ({ path: "/tui/append-prompt", headers: ctx.headers(), body: { text: "hello" } }))
    .json(200, boolean, "status"),
  http
    .post("/tui/select-session", "tui.selectSession.invalid")
    .at((ctx) => ({ path: "/tui/select-session", headers: ctx.headers(), body: { sessionID: "invalid" } }))
    .status(400),
  http.post("/tui/open-help", "tui.openHelp").json(200, boolean, "status"),
  http.post("/tui/open-sessions", "tui.openSessions").json(200, boolean, "status"),
  http.post("/tui/open-themes", "tui.openThemes").json(200, boolean, "status"),
  http.post("/tui/open-models", "tui.openModels").json(200, boolean, "status"),
  http.post("/tui/submit-prompt", "tui.submitPrompt").json(200, boolean, "status"),
  http.post("/tui/clear-prompt", "tui.clearPrompt").json(200, boolean, "status"),
  http
    .post("/tui/execute-command", "tui.executeCommand")
    .at((ctx) => ({ path: "/tui/execute-command", headers: ctx.headers(), body: { command: "agent_cycle" } }))
    .json(200, boolean, "status"),
  http
    .post("/tui/show-toast", "tui.showToast")
    .at((ctx) => ({
      path: "/tui/show-toast",
      headers: ctx.headers(),
      body: { title: "Exercise", message: "covered", variant: "info", duration: 1000 },
    }))
    .json(200, boolean, "status"),
  http
    .post("/tui/publish", "tui.publish")
    .at((ctx) => ({
      path: "/tui/publish",
      headers: ctx.headers(),
      body: { type: "tui.prompt.append", properties: { text: "published" } },
    }))
    .json(200, boolean, "status"),
  http
    .post("/tui/select-session", "tui.selectSession")
    .seeded((ctx) => ctx.session({ title: "TUI select" }))
    .at((ctx) => ({ path: "/tui/select-session", headers: ctx.headers(), body: { sessionID: ctx.state.id } }))
    .json(200, boolean, "status"),
  http
    .post("/tui/control/response", "tui.control.response")
    .at((ctx) => ({ path: "/tui/control/response", headers: ctx.headers(), body: { ok: true } }))
    .json(200, boolean, "status"),
  http
    .get("/tui/control/next", "tui.control.next")
    .mutating()
    .seeded((ctx) => ctx.tuiRequest({ path: "/tui/exercise", body: { text: "queued" } }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.path === "/tui/exercise", "control next should return queued path")
        object(body.body)
        check(body.body.text === "queued", "control next should return queued body")
      },
      "status",
    ),
  http
    .post("/global/upgrade", "global.upgrade")
    .global()
    .at(() => ({ path: "/global/upgrade", body: { target: 1 } }))
    .status(400),
]

const main = Effect.gen(function* () {
  yield* Effect.addFinalizer(() => cleanupExercisePaths)
  const options = parseOptions(Bun.argv.slice(2))
  const modules = yield* Effect.promise(() => runtime())
  const effectRoutes = routeKeys(OpenApi.fromApi(modules.PublicApi))
  const honoRoutes = routeKeys(yield* Effect.promise(() => modules.Server.openapiHono()))
  const selected = scenarios.filter((scenario) => matches(options, scenario))
  const missing = effectRoutes.filter((route) => !scenarios.some((scenario) => route === routeKey(scenario)))
  const extra = scenarios.filter((scenario) => !effectRoutes.includes(routeKey(scenario)))

  printHeader(options, effectRoutes, honoRoutes, selected, missing, extra)

  const results =
    options.mode === "coverage"
      ? selected.map(coverageResult)
      : yield* Effect.forEach(selected, runScenario(options), { concurrency: 1 })
  printResults(results, missing, extra)

  if (results.some((result) => result.status === "fail"))
    return yield* Effect.fail(new Error("one or more scenarios failed"))
  if (options.failOnSkip && results.some((result) => result.status === "skip"))
    return yield* Effect.fail(new Error("one or more scenarios are skipped"))
  if (options.failOnMissing && missing.length > 0)
    return yield* Effect.fail(new Error("one or more routes have no scenario"))
})

function runScenario(options: Options) {
  return (scenario: Scenario) => {
    if (scenario.kind === "todo") return Effect.succeed({ status: "skip", scenario } as Result)
    return runActive(options, scenario).pipe(
      Effect.as({ status: "pass", scenario } as Result),
      Effect.catchCause((cause) => Effect.succeed({ status: "fail" as const, scenario, message: Cause.pretty(cause) })),
      Effect.scoped,
    )
  }
}

function runActive(options: Options, scenario: ActiveScenario) {
  if (options.mode === "parity" && scenario.mutates && scenario.compare !== "none") {
    return Effect.gen(function* () {
      const effect = yield* runBackend("effect", scenario)
      const legacy = yield* runBackend("legacy", scenario)
      yield* compare(scenario, effect, legacy)
    })
  }

  return withContext(scenario, (ctx) =>
    Effect.gen(function* () {
      const effect = yield* call("effect", scenario, ctx)
      yield* scenario.expect(ctx, ctx.state, effect)
      if (options.mode === "parity" && scenario.compare !== "none") {
        const legacy = yield* call("legacy", scenario, ctx)
        yield* scenario.expect(ctx, ctx.state, legacy)
        yield* compare(scenario, effect, legacy)
      }
    }),
  )
}

function runBackend(backend: "effect" | "legacy", scenario: ActiveScenario) {
  return withContext(scenario, (ctx) =>
    Effect.gen(function* () {
      const result = yield* call(backend, scenario, ctx)
      yield* scenario.expect(ctx, ctx.state, result)
      return result
    }),
  )
}

function withContext<A, E>(scenario: ActiveScenario, use: (ctx: SeededContext<unknown>) => Effect.Effect<A, E>) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const llm = scenario.project?.llm ? yield* TestLLMServer : undefined
      const project = scenario.project
      const dir = project
        ? yield* Effect.promise(async () => (await runtime()).tmpdir(projectOptions(project, llm?.url)))
        : undefined
      return { dir, llm }
    }),
    (ctx) => Effect.promise(async () => void (await ctx.dir?.[Symbol.asyncDispose]())).pipe(Effect.ignore),
  ).pipe(
    Effect.flatMap((context) =>
      Effect.gen(function* () {
        const modules = yield* Effect.promise(() => runtime())
        const path = context.dir?.path
        const instance = path
          ? yield* modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
              Effect.provide(modules.AppLayer),
              Effect.catchCause((cause) =>
                Effect.sleep("100 millis").pipe(
                  Effect.andThen(
                    modules.InstanceStore.Service.use((store) => store.load({ directory: path })).pipe(
                      Effect.provide(modules.AppLayer),
                    ),
                  ),
                  Effect.catchCause(() => Effect.failCause(cause)),
                ),
              ),
            )
          : undefined
        const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(Effect.provideService(modules.InstanceRef, instance), Effect.provide(modules.AppLayer))
        const directory = () => {
          if (!context.dir?.path) throw new Error("scenario needs a project directory")
          return context.dir.path
        }
        const llm = () => {
          if (!context.llm) throw new Error("scenario needs fake LLM")
          return context.llm
        }
        const base: ScenarioContext = {
          directory: context.dir?.path,
          headers: (extra) => ({
            ...(context.dir?.path ? { "x-opencode-directory": context.dir.path } : {}),
            ...extra,
          }),
          file: (name, content) =>
            Effect.promise(() => {
              return Bun.write(`${directory()}/${name}`, content)
            }).pipe(Effect.asVoid),
          session: (input) =>
            run(modules.Session.Service.use((svc) => svc.create({ title: input?.title, parentID: input?.parentID }))),
          sessionGet: (sessionID) =>
            run(modules.Session.Service.use((svc) => svc.get(sessionID))).pipe(
              Effect.catchCause(() => Effect.succeed(undefined)),
            ),
          project: () =>
            Effect.sync(() => {
              if (!instance) throw new Error("scenario needs a project directory")
              return instance.project
            }),
          message: (sessionID, input) =>
            Effect.gen(function* () {
              const info: MessageV2.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: "build",
                model: {
                  providerID: ProviderID.opencode,
                  modelID: ModelID.make("test"),
                },
              }
              const part: MessageV2.TextPart = {
                id: PartID.ascending(),
                sessionID,
                messageID: info.id,
                type: "text",
                text: input?.text ?? "hello",
              }
              yield* run(
                modules.Session.Service.use((svc) =>
                  Effect.gen(function* () {
                    yield* svc.updateMessage(info)
                    yield* svc.updatePart(part)
                  }),
                ),
              )
              return { info, part }
            }),
          messages: (sessionID) => run(modules.Session.Service.use((svc) => svc.messages({ sessionID }))),
          todos: (sessionID, todos) => run(modules.Todo.Service.use((svc) => svc.update({ sessionID, todos }))),
          worktree: (input) => run(modules.Worktree.Service.use((svc) => svc.create(input))),
          worktreeRemove: (directory) =>
            run(modules.Worktree.Service.use((svc) => svc.remove({ directory })).pipe(Effect.ignore)),
          llmText: (value) => Effect.suspend(() => llm().text(value)),
          llmWait: (count) => Effect.suspend(() => llm().wait(count)),
          tuiRequest: (request) => Effect.sync(() => modules.Tui.submitTuiRequest(request)),
        }
        const state = yield* scenario.seed(base)
        return yield* use({ ...base, state })
      }).pipe(Effect.ensuring(context.llm ? context.llm.reset : Effect.void)),
    ),
    Effect.ensuring(scenario.reset ? resetState : Effect.void),
  )
}

function projectOptions(
  project: ProjectOptions,
  llmUrl: string | undefined,
): { git?: boolean; config?: Partial<Config.Info> } {
  if (!project.llm || !llmUrl) return { git: project.git, config: project.config }
  const fake = fakeLlmConfig(llmUrl)
  return {
    git: project.git,
    config: {
      ...fake,
      ...project.config,
      provider: {
        ...fake.provider,
        ...project.config?.provider,
      },
    },
  }
}

function fakeLlmConfig(url: string): Partial<Config.Info> {
  return {
    model: "test/test-model",
    small_model: "test/test-model",
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
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
  }
}

function controlledPtyInput(title: string | undefined) {
  return {
    command: "/bin/sh",
    args: ["-c", "sleep 30"],
    ...(title ? { title } : {}),
  }
}

function call(backend: Backend, scenario: ActiveScenario, ctx: SeededContext<unknown>) {
  return Effect.promise(async () =>
    capture(await app(await runtime(), backend).request(toRequest(scenario, ctx)), scenario.capture),
  )
}

const appCache: Partial<Record<Backend, BackendApp>> = {}

function app(modules: Runtime, backend: Backend) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = backend === "effect"
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  Flag.OPENCODE_SERVER_USERNAME = undefined
  if (appCache[backend]) return appCache[backend]
  if (backend === "legacy") {
    const legacy = modules.Server.Legacy().app
    return (appCache.legacy = {
      request: (input, init) => legacy.request(input, init),
    })
  }

  const handler = HttpRouter.toWebHandler(
    modules.ExperimentalHttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: undefined, OPENCODE_SERVER_USERNAME: undefined }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return (appCache.effect = {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        modules.ExperimentalHttpApiServer.context,
      )
    },
  })
}

function toRequest(scenario: ActiveScenario, ctx: SeededContext<unknown>) {
  const spec = scenario.request(ctx, ctx.state)
  return new Request(new URL(spec.path, "http://localhost"), {
    method: scenario.method,
    headers: spec.body === undefined ? spec.headers : { "content-type": "application/json", ...spec.headers },
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
  })
}

async function capture(response: Response, mode: CaptureMode): Promise<CallResult> {
  const text = mode === "stream" ? await captureStream(response) : await response.text()
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
    body: parse(text),
  }
}

async function captureStream(response: Response) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const read = reader.read().then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  )
  const winner = await Promise.race([read, Bun.sleep(1_000).then(() => ({ timeout: true }))])
  if ("timeout" in winner) {
    await reader.cancel("timed out waiting for stream chunk").catch(() => undefined)
    throw new Error("timed out waiting for stream chunk")
  }
  if ("error" in winner) throw winner.error
  await reader.cancel().catch(() => undefined)
  if (winner.result.done) return ""
  return new TextDecoder().decode(winner.result.value)
}

const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
})

function compare(scenario: ActiveScenario, effect: CallResult, legacy: CallResult) {
  return Effect.sync(() => {
    if (effect.status !== legacy.status)
      throw new Error(`legacy returned ${legacy.status}, effect returned ${effect.status}`)
    if (scenario.compare === "status") return
    if (stable(effect.body) !== stable(legacy.body))
      throw new Error(`JSON parity mismatch\nlegacy: ${stable(legacy.body)}\neffect: ${stable(effect.body)}`)
  })
}

const resetState = Effect.promise(async () => {
  const modules = await runtime()
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await modules.disposeAllInstances()
  await modules.resetDatabase()
  await Bun.sleep(25)
})

function routeKeys(spec: OpenApiSpec) {
  return Object.entries(spec.paths ?? {})
    .flatMap(([path, item]) =>
      OpenApiMethods.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

function routeKey(scenario: Scenario) {
  return `${scenario.method} ${scenario.path}`
}

function coverageResult(scenario: Scenario): Result {
  if (scenario.kind === "todo") return { status: "skip", scenario }
  return { status: "pass", scenario }
}

function parseOptions(args: string[]): Options {
  const mode = option(args, "--mode") ?? "effect"
  if (mode !== "effect" && mode !== "parity" && mode !== "coverage") throw new Error(`invalid --mode ${mode}`)
  return {
    mode,
    include: option(args, "--include"),
    failOnMissing: args.includes("--fail-on-missing"),
    failOnSkip: args.includes("--fail-on-skip"),
  }
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function matches(options: Options, scenario: Scenario) {
  if (!options.include) return true
  return (
    scenario.name.includes(options.include) ||
    scenario.path.includes(options.include) ||
    scenario.method.includes(options.include.toUpperCase())
  )
}

function printHeader(
  options: Options,
  effectRoutes: string[],
  honoRoutes: string[],
  selected: Scenario[],
  missing: string[],
  extra: Scenario[],
) {
  console.log(`${color.cyan}HttpApi exerciser${color.reset}`)
  console.log(`${color.dim}db=${exerciseDatabasePath}${color.reset}`)
  console.log(`${color.dim}global=${exerciseGlobalRoot}${color.reset}`)
  console.log(
    `${color.dim}mode=${options.mode} selected=${selected.length} effectRoutes=${effectRoutes.length} missing=${missing.length} extra=${extra.length} onlyEffect=${effectRoutes.filter((route) => !honoRoutes.includes(route)).length} onlyHono=${honoRoutes.filter((route) => !effectRoutes.includes(route)).length}${color.reset}`,
  )
  console.log("")
}

function printResults(results: Result[], missing: string[], extra: Scenario[]) {
  for (const result of results) {
    if (result.status === "pass") {
      console.log(
        `${color.green}PASS${color.reset} ${pad(result.scenario.method, 6)} ${pad(result.scenario.path, 48)} ${result.scenario.name}`,
      )
      continue
    }
    if (result.status === "skip") {
      console.log(
        `${color.yellow}SKIP${color.reset} ${pad(result.scenario.method, 6)} ${pad(result.scenario.path, 48)} ${result.scenario.name} ${color.dim}${result.scenario.reason}${color.reset}`,
      )
      continue
    }
    console.log(
      `${color.red}FAIL${color.reset} ${pad(result.scenario.method, 6)} ${pad(result.scenario.path, 48)} ${result.scenario.name}`,
    )
    console.log(`${color.red}${indent(result.message)}${color.reset}`)
  }
  if (missing.length > 0) {
    console.log("\nMissing scenarios")
    for (const route of missing) console.log(`${color.red}MISS${color.reset} ${route}`)
  }
  if (extra.length > 0) {
    console.log("\nExtra scenarios")
    for (const scenario of extra)
      console.log(`${color.yellow}EXTRA${color.reset} ${routeKey(scenario)} ${scenario.name}`)
  }
  console.log(
    `\n${color.dim}summary pass=${results.filter((result) => result.status === "pass").length} fail=${results.filter((result) => result.status === "fail").length} skip=${results.filter((result) => result.status === "skip").length} missing=${missing.length} extra=${extra.length}${color.reset}`,
  )
}

function parse(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function looksJson(result: CallResult) {
  return result.contentType.includes("application/json") || result.text.startsWith("{") || result.text.startsWith("[")
}

function stable(value: unknown): string {
  return JSON.stringify(sort(value))
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort(item)]),
  )
}

function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error("expected array")
}

function object(value: unknown): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object")
}

function boolean(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error("expected boolean")
}

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function check(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message)
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function pad(value: string, size: number) {
  return value.length >= size ? value : value + " ".repeat(size - value.length)
}

function indent(value: string) {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")
}

Effect.runPromise(main.pipe(Effect.provide(TestLLMServer.layer), Effect.scoped)).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`${color.red}${message(error)}${color.reset}`)
    process.exit(1)
  },
)
