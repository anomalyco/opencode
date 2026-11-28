// The Durable Objects script/workerd-machine-link.ts runs in Miniflare: `ServerWorkerd` behind a password, with machines
// on unless the request asks `?machines=off`, each in a Durable Object of its own, and `?home=hibernating` one that takes
// machine links with WebSocket Hibernation.
import { Context, Effect, Scope } from "effect"
import { ChildProcess } from "effect/process"
import type { DurableObjectStorage } from "@opencode/core/database/sqlite.workerd"
import { Environment } from "@opencode/core/environment/index"
import { Machines } from "@opencode/core/machine/machines"
import { ServerFetch } from "../src/fetch"
import { ServerWorkerd } from "../src/workerd"
import type { WorkerdMachineLink } from "../src/workerd-machine-link"

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

type Ctx = State & WorkerdMachineLink.State & { abort(reason?: string): void }

/**
 * A home whose machine links hibernate: `ctx` is passed as `state` and its WebSocket methods are forwarded. Routes
 * under `/__probe/` exist only for the probe. workerd evicts an idle object after ten seconds, but OpenCode's server
 * holds Effect timers that keep it from ever being idle, so `wake` stands in: it forgets this wake's server without
 * closing anything, as hibernation does, and boots the next over the same storage and sockets through a fresh `ctx`, as
 * each wake has. `abort` resets the object as a crash or deploy does, which drops its sockets. `roundtrip` writes a
 * file on `gpu` and reads it back, which no HTTP route does, so frames cross the link both ways; `spawn` starts a
 * process on `gpu` and leaves it running.
 */
export class HibernatingHome {
  private readonly work = Scope.makeUnsafe()
  private wake: ReturnType<HibernatingHome["boot"]>

  constructor(private readonly ctx: Ctx & { blockConcurrencyWhile<T>(f: () => Promise<T>): Promise<T> }) {
    // Once per instance, before any event reaches it, as `ServerWorkerd.Options.state` asks.
    this.wake = ctx.blockConcurrencyWhile(() => this.boot())
  }

  private boot() {
    const ctx = this.ctx
    const options = {
      storage: ctx.storage,
      state: {
        acceptWebSocket: (socket, tags) => ctx.acceptWebSocket(socket, tags),
        getWebSockets: (tag) => ctx.getWebSockets(tag),
      } satisfies WorkerdMachineLink.State,
      app: { version: "workerd-machine-link" },
      password: "secret",
      config: { content: JSON.stringify({ experimental: { machines: true } }) },
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* ServerFetch.build(ServerWorkerd.routes(options))
        const handler = yield* ServerWorkerd.serve(context, options)
        return { handler, machines: Context.get(context, Machines.Service) }
      }).pipe(Scope.provide(Scope.makeUnsafe())),
    )
  }

  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (path === "/__probe/wake") {
      this.wake = this.boot()
      await this.wake
      return new Response(null, { status: 204 })
    }
    if (path === "/__probe/abort") this.ctx.abort("probe")
    const wake = await this.wake
    const gpu = Environment.ID.make("gpu")
    if (path === "/__probe/spawn") {
      await Effect.runPromise(
        Effect.flatMap(wake.machines.get(gpu), (environment) =>
          environment.spawner.spawn(ChildProcess.make("sleep", ["100"], { cwd: "/home/worker" })),
        ).pipe(Scope.provide(this.work)),
      )
      return new Response(null, { status: 204 })
    }
    if (path !== "/__probe/roundtrip") return wake.handler(request)
    const bytes = crypto.getRandomValues(new Uint8Array(65_536))
    const read = await Effect.runPromise(
      Effect.gen(function* () {
        const files = (yield* wake.machines.get(gpu)).files
        // Larger than one frame each way.
        const large = new Uint8Array(200_000).map((_, index) => bytes[index % bytes.length])
        yield* files.write("/roundtrip", large)
        return (yield* files.read("/roundtrip")).bytes.every((byte, index) => byte === large[index])
      }),
    )
    return Response.json({ read })
  }

  async webSocketMessage(socket: WorkerdMachineLink.HibernatableSocket, message: ArrayBuffer | string) {
    ;(await this.wake).handler.webSocketMessage(socket, message)
  }

  async webSocketClose(socket: WorkerdMachineLink.HibernatableSocket, code: number, reason: string, clean: boolean) {
    ;(await this.wake).handler.webSocketClose(socket, code, reason, clean)
  }

  async webSocketError(socket: WorkerdMachineLink.HibernatableSocket, error: unknown) {
    ;(await this.wake).handler.webSocketError(socket, error)
  }
}

export default {
  fetch(request: Request, env: { readonly HOME: Namespace; readonly HIBERNATING: Namespace }) {
    const url = new URL(request.url)
    if (url.searchParams.get("home") === "hibernating")
      return env.HIBERNATING.get(env.HIBERNATING.idFromName("hibernating")).fetch(request)
    const machines = url.searchParams.get("machines") ?? "on"
    const forwarded = new Request(request, { headers: new Headers(request.headers) })
    forwarded.headers.set("x-machines", machines)
    return env.HOME.get(env.HOME.idFromName(machines)).fetch(forwarded)
  },
}
