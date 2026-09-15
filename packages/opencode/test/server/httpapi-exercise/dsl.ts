import { Effect } from "effect"
import { looksJson } from "./assertions"
import type {
  ActiveScenario,
  AuthPolicy,
  BuilderState,
  CallResult,
  Comparison,
  Method,
  ProjectOptions,
  RequestSpec,
  ScenarioContext,
  SeededContext,
  TodoScenario,
} from "./types"

class ScenarioBuilder<S = undefined> {
  private readonly state: BuilderState<S>

  constructor(method: Method, path: string, name: string, auth: AuthPolicy) {
    this.state = {
      method,
      path,
      name,
      project: { git: true },
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- The unseeded builder state is intentionally undefined until `.seeded(...)` narrows it.
      seed: () => Effect.succeed(undefined as S),
      request: (ctx) => ({ path, headers: ctx.headers() }),
      authProbe: undefined,
      capture: "full",
      mutates: false,
      reset: true,
      auth,
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

  probe(authProbe: RequestSpec) {
    return this.clone({ authProbe })
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

  protected() {
    return this.auth("protected")
  }

  public() {
    return this.auth("public")
  }

  publicBypass() {
    return this.auth("public-bypass")
  }

  ticketBypass() {
    return this.auth("ticket-bypass")
  }

  private auth(auth: AuthPolicy) {
    return this.clone({ auth })
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
    const builder = new ScenarioBuilder<S>(this.state.method, this.state.path, this.state.name, this.state.auth)
    Object.assign(builder.state, this.state, next)
    return builder
  }

  /**
   * Seed typed state before the HTTP request. The returned value becomes `ctx.state`
   * for `.at(...)` and assertions, giving stateful route tests type-safe setup.
   */
  seeded<Next>(seed: (ctx: ScenarioContext) => Effect.Effect<Next>) {
    const builder = new ScenarioBuilder<Next>(this.state.method, this.state.path, this.state.name, this.state.auth)
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
      authProbe: state.authProbe,
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `.seeded(...)` preserves the paired request/state type inside the builder.
      request: (ctx, seeded) => state.request({ ...ctx, state: seeded as S }),
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- `.seeded(...)` preserves the paired assertion/state type inside the builder.
      expect: (ctx, seeded, result) => expect({ ...ctx, state: seeded as S }, result),
      compare,
      capture: state.capture,
      mutates: state.mutates,
      reset: state.reset,
      auth: state.auth,
    }
  }
}

const routes = (auth: AuthPolicy) => ({
  get: (path: string, name: string) => new ScenarioBuilder("GET", path, name, auth),
  post: (path: string, name: string) => new ScenarioBuilder("POST", path, name, auth),
  put: (path: string, name: string) => new ScenarioBuilder("PUT", path, name, auth),
  patch: (path: string, name: string) => new ScenarioBuilder("PATCH", path, name, auth),
  delete: (path: string, name: string) => new ScenarioBuilder("DELETE", path, name, auth),
})

export const http = {
  protected: routes("protected"),
  public: routes("public"),
  publicBypass: routes("public-bypass"),
  ticketBypass: routes("ticket-bypass"),
}

export const pending = (method: Method, path: string, name: string, reason: string): TodoScenario => ({
  kind: "todo",
  method,
  path,
  name,
  reason,
})

export function route(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce(
    (next, [key, value]) => next.replaceAll(`{${key}}`, value).replaceAll(`:${key}`, value),
    template,
  )
}

export function controlledPtyInput(title: string | undefined) {
  return {
    command: "/bin/sh",
    args: ["-c", "sleep 30"],
    ...(title ? { title } : {}),
  }
}
