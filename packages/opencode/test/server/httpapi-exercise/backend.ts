import { Flag } from "@opencode-ai/core/flag/flag"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { parse } from "./assertions"
import { runtime, type Runtime } from "./runtime"
import type { ActiveScenario, Backend, BackendApp, CallResult, CaptureMode, SeededContext } from "./types"

type CallOptions = {
  auth?: {
    password?: string
    username?: string
  }
}

export function call(
  backend: Backend,
  scenario: ActiveScenario,
  ctx: SeededContext<unknown>,
  options: CallOptions = {},
) {
  return Effect.promise(async () =>
    capture(await app(await runtime(), backend, options).request(toRequest(scenario, ctx)), scenario.capture),
  )
}

export function callAuthProbe(
  backend: Backend,
  scenario: ActiveScenario,
  credentials: "missing" | "valid" = "missing",
) {
  return Effect.promise(async () => {
    const controller = new AbortController()
    return Promise.race([
      Promise.resolve(
        app(await runtime(), backend, { auth: { password: "secret" } }).request(
          toAuthProbeRequest(scenario, credentials, controller.signal),
        ),
      ).then((response) => capture(response, scenario.capture)),
      Bun.sleep(1_000).then(() => {
        controller.abort("auth probe timed out")
        return {
          status: 0,
          contentType: "",
          text: "auth probe timed out",
          body: undefined,
          timedOut: true,
        }
      }),
    ])
  })
}

const appCache: Partial<Record<string, BackendApp>> = {}

function app(modules: Runtime, backend: Backend, options: CallOptions) {
  const username = options.auth?.username
  const password = options.auth?.password
  const cacheKey = `${backend}:${username ?? ""}:${password ?? ""}`
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = backend === "effect"
  Flag.OPENCODE_SERVER_PASSWORD = password
  Flag.OPENCODE_SERVER_USERNAME = username
  if (appCache[cacheKey]) return appCache[cacheKey]
  if (backend === "legacy") {
    const legacy = modules.Server.Legacy().app
    return (appCache[cacheKey] = {
      request: (input, init) => legacy.request(input, init),
    })
  }

  const handler = HttpRouter.toWebHandler(
    modules.ExperimentalHttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: username }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return (appCache[cacheKey] = {
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

function toAuthProbeRequest(scenario: ActiveScenario, credentials: "missing" | "valid", signal: AbortSignal) {
  const spec = scenario.authProbe ?? {
    path: authProbePath(scenario.path),
    body: scenario.method === "GET" ? undefined : {},
  }
  const headers = {
    ...(spec.body === undefined ? {} : { "content-type": "application/json" }),
    ...spec.headers,
    ...(credentials === "valid" ? { authorization: basic("opencode", "secret") } : {}),
  }
  return new Request(new URL(spec.path, "http://localhost"), {
    method: scenario.method,
    headers,
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
    signal,
  })
}

function basic(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function authProbePath(path: string) {
  return path
    .replace(/\{([^}]+)\}/g, (_match, key: string) => `auth_${key}`)
    .replace(/:([^/]+)/g, (_match, key: string) => `auth_${key}`)
}

async function capture(response: Response, mode: CaptureMode): Promise<CallResult> {
  const text = mode === "stream" ? await captureStream(response) : await response.text()
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
    body: parse(text),
    timedOut: false,
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
