import { Flag } from "@opencode-ai/core/flag/flag"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { parse } from "./assertions"
import { runtime, type Runtime } from "./runtime"
import type { ActiveScenario, Backend, BackendApp, CallResult, CaptureMode, SeededContext } from "./types"

export function call(backend: Backend, scenario: ActiveScenario, ctx: SeededContext<unknown>) {
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
