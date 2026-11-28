// The Durable Object script/workerd-machine-link.ts runs in Miniflare: `ServerWorkerd` behind a password, with machines
// on unless the request asks `?machines=off`, each in a Durable Object of its own.
import { Effect, Scope } from "effect"
import type { DurableObjectStorage } from "@opencode/core/database/sqlite.workerd"
import { ServerWorkerd } from "../src/workerd"

interface State {
  readonly storage: DurableObjectStorage
}

interface Namespace {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(request: Request): Promise<Response> }
}

export class Home {
  private handler: Promise<ServerWorkerd.Handler> | undefined
  constructor(private readonly state: State) {}

  fetch(request: Request) {
    const machines = request.headers.get("x-machines") === "on"
    this.handler ??= Effect.runPromise(
      ServerWorkerd.create({
        storage: this.state.storage,
        app: { version: "workerd-machine-link" },
        password: "secret",
        config: { content: JSON.stringify({ experimental: { machines } }) },
      }).pipe(Scope.provide(Scope.makeUnsafe())),
    )
    return this.handler.then((handler) => handler(request))
  }
}

export default {
  fetch(request: Request, env: { readonly HOME: Namespace }) {
    const machines = new URL(request.url).searchParams.get("machines") ?? "on"
    const forwarded = new Request(request, { headers: new Headers(request.headers) })
    forwarded.headers.set("x-machines", machines)
    return env.HOME.get(env.HOME.idFromName(machines)).fetch(forwarded)
  },
}
