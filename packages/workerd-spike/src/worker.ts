import { DurableObject } from "cloudflare:workers"
import { Effect, Scope } from "effect"
import type { DurableObjectStorage } from "@opencode-ai/core/database/sqlite.workerd"
import { ServerWorkerd } from "@opencode-ai/server/workerd"

export interface Env {
  OPENCODE: DurableObjectNamespace<OpencodeDurableObject>
}

export const PASSWORD = "spike-secret"
export const FAKE_LLM_ORIGIN = "https://fake-llm.spike.test"
// A second provider on its own origin, so eviction tests can hold one turn
// open with a delayed interceptor without affecting the fast provider's mocks.
export const SLOW_LLM_ORIGIN = "https://slow-llm.spike.test"

const model = (name: string) => ({
  name,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  limit: { context: 128_000, output: 8_192 },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
})

// A minimal opencode config declaring fake providers on the native
// openai-compatible chat route. The apiKey marks the provider available
// without a stored credential; the baseURL points at the fetch-mocked
// endpoint so no real network is reached.
const CONFIG_CONTENT = JSON.stringify({
  model: "fake/spike-model",
  providers: {
    fake: {
      name: "Fake",
      package: "aisdk:@ai-sdk/openai-compatible",
      settings: { apiKey: "spike-key", baseURL: `${FAKE_LLM_ORIGIN}/v1` },
      models: { "spike-model": model("Spike Model") },
    },
    slow: {
      name: "Slow",
      package: "aisdk:@ai-sdk/openai-compatible",
      settings: { apiKey: "spike-key", baseURL: `${SLOW_LLM_ORIGIN}/v1` },
      models: { "slow-model": model("Slow Model") },
    },
  },
})

export class OpencodeDurableObject extends DurableObject<Env> {
  // The application layer builds eagerly into a scope that is never closed: a
  // Durable Object is evicted without teardown, so the instance's lifetime is
  // the scope's lifetime. Every request the instance serves shares one handler.
  private readonly handler: Promise<(request: Request) => Promise<Response>>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const scope = Effect.runSync(Scope.make())
    this.handler = ServerWorkerd.create({
      storage: ctx.storage as unknown as DurableObjectStorage,
      password: PASSWORD,
      app: { version: "workerd-spike" },
      config: { content: CONFIG_CONTENT },
      // The bundled models.dev snapshot is the catalog floor; the providers
      // under test come entirely from config content, so nothing needs the network.
      models: { fetch: false },
    }).pipe(Scope.provide(scope), Effect.runPromise)
  }

  override async fetch(request: Request) {
    return (await this.handler)(request)
  }
}

export default {
  fetch(request, env) {
    return env.OPENCODE.getByName("spike").fetch(request)
  },
} satisfies ExportedHandler<Env>
