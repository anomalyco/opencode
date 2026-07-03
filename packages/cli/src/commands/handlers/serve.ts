import { NodeHttpServer } from "@effect/platform-node"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Global } from "@opencode-ai/core/global"
import { Context, FileSystem, Layer, Option, Schedule, Schema } from "effect"
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createServer } from "node:http"
import { createRoutes } from "@opencode-ai/server/routes"
import { ServerAuth } from "@opencode-ai/server/auth"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServiceConfig } from "../../services/service-config"
import { Updater } from "../../services/updater"
import { randomBytes, randomUUID } from "crypto"
import path from "path"

export default Runtime.handler(
  Commands.commands.serve,
  Effect.fn("cli.serve")(function* (input) {
    if (input.service) yield* Effect.sync(() => process.chdir(Global.Path.home))
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const standalonePassword = process.env.OPENCODE_SERVER_PASSWORD
        if (input.stdio) delete process.env.OPENCODE_SERVER_PASSWORD
        const config = input.service ? yield* ServiceConfig.read() : {}
        const password = input.service
          ? yield* ServiceConfig.password()
          : standalonePassword || randomBytes(32).toString("base64url")
        if (!password) return yield* Effect.fail(new Error("Missing server password"))
        const hostname = Option.getOrUndefined(input.hostname) ?? config.hostname ?? "127.0.0.1"
        const port = Option.isSome(input.port)
          ? input.port
          : config.port === undefined
            ? Option.none<number>()
            : Option.some(config.port)
        const address = yield* listen(hostname, port, password)
        yield* Effect.tryPromise(() =>
          createOpencodeClient({
            baseUrl: HttpServer.formatAddress(address),
            headers: ServerAuth.headers({ password }),
          }).v2.health.get({}),
        )
        if (input.service) yield* register(address)
        const url = HttpServer.formatAddress(address)
        console.log(input.stdio ? JSON.stringify({ url }) : `server listening on ${url}`)
        if (!input.service && !input.stdio && !standalonePassword) console.log(`server password ${password}`)
        const updater = yield* Updater.Service
        yield* updater.check().pipe(Effect.schedule(Schedule.spaced("10 minutes")), Effect.forkScoped)
        return yield* (input.stdio ? waitForStdinClose() : Effect.never)
      }).pipe(Effect.annotateLogs({ role: "server" })),
    )
  }),
)

// Server-side half of the registration protocol. The registration embeds the
// password so the file alone is enough for any client to discover and
// authenticate. The file arbitrates ownership after concurrent starts; it is
// not a startup lock: the atomic rename elects the latest writer, the watcher
// self-evicts losers, and the finalizer id-guard keeps an exiting server from
// deleting its successor's registration.
const RegistrationId = Schema.Struct({ id: Schema.optional(Schema.String) })
const decodeRegistrationId = Schema.decodeUnknownEffect(Schema.fromJsonString(RegistrationId))

const register = Effect.fnUntraced(function* (address: HttpServer.Address) {
  const fs = yield* FileSystem.FileSystem
  const { file } = yield* ServiceConfig.options()
  const id = randomUUID()
  const secret = yield* ServiceConfig.password()
  const temp = file + "." + id + ".tmp"
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  yield* fs.writeFileString(
    temp,
    JSON.stringify({
      id,
      version: InstallationVersion,
      url: HttpServer.formatAddress(address),
      pid: process.pid,
      password: secret,
    }),
    { mode: 0o600 },
  )
  yield* fs.rename(temp, file)
  const currentID = fs.readFileString(file).pipe(
    Effect.flatMap(decodeRegistrationId),
    Effect.map((info) => info.id),
    Effect.orElseSucceed(() => undefined),
  )
  yield* currentID.pipe(
    Effect.flatMap((current) =>
      current === id
        ? Effect.void
        : Effect.try({ try: () => process.kill(process.pid, "SIGTERM"), catch: (cause) => cause }).pipe(Effect.ignore),
    ),
    Effect.repeat(Schedule.spaced("10 seconds")),
    Effect.forkScoped,
  )
  yield* Effect.addFinalizer(() =>
    currentID.pipe(
      Effect.flatMap((current) => (current === id ? fs.remove(file) : Effect.void)),
      Effect.ignore,
    ),
  )
})

function waitForStdinClose() {
  return Effect.callback<void>((resume) => {
    const close = () => resume(Effect.void)
    process.stdin.once("end", close)
    process.stdin.once("close", close)
    process.stdin.resume()
    if (process.stdin.readableEnded || process.stdin.destroyed) close()
    return Effect.sync(() => {
      process.stdin.off("end", close)
      process.stdin.off("close", close)
      process.stdin.pause()
    })
  })
}

function listen(hostname: string, port: Option.Option<number>, password: string) {
  if (Option.isSome(port)) return bind(hostname, port.value, password)
  const next = (port: number): ReturnType<typeof bind> =>
    bind(hostname, port, password).pipe(
      Effect.catch((error) => (port === 65_535 ? Effect.fail(error) : next(port + 1))),
    )
  return next(4096)
}

function bind(hostname: string, port: number, password: string) {
  const server = createServer()
  return Layer.build(
    HttpRouter.serve(createRoutes(password), { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => server, { port, host: hostname })),
      Layer.provide(AppNodeBuilder.build(LayerNode.group([Credential.node, PermissionSaved.node]))),
    ),
  ).pipe(
    Effect.tap(() => Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))),
    Effect.map((context) => Context.get(context, HttpServer.HttpServer).address),
  )
}
