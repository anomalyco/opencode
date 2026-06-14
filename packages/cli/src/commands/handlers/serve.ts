import { NodeHttpServer } from "@effect/platform-node"
import { Credential } from "@opencode-ai/core/credential"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Context, Layer, Option } from "effect"
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createServer } from "node:http"
import { createRoutes } from "@opencode-ai/server/routes"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Daemon } from "../../services/daemon"

export default Runtime.handler(
  Commands.commands.serve,
  Effect.fn("cli.serve")(function* (input) {
    const providerURL = Option.isSome(input["provider-url"]) ? input["provider-url"].value : undefined
    const model = Option.isSome(input.model) ? input.model.value : undefined
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const daemon = yield* Daemon.Service
        // Передаём пустую строку вместо daemon.password(), чтобы отключить аутентификацию
        const address = yield* listen(input.hostname, input.port, "", providerURL, model)
        if (input.register) yield* daemon.register(address)
        console.log(`server listening on ${HttpServer.formatAddress(address)}`)
        return yield* Effect.never
      }),
    )
  }),
)

function listen(hostname: string, port: Option.Option<number>, password: string, providerURL?: string, model?: string) {
  if (Option.isSome(port)) return bind(hostname, port.value, password, providerURL, model)
  return bind(hostname, 4096, password, providerURL, model).pipe(Effect.catch(() => bind(hostname, 0, password, providerURL, model)))
}

function bind(hostname: string, port: number, password: string, providerURL?: string, model?: string) {
  return Layer.build(
    HttpRouter.serve(createRoutes(password, providerURL, model), { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port, host: hostname })),
      Layer.provide(Credential.defaultLayer),
      Layer.provide(PermissionSaved.defaultLayer),
    ),
  ).pipe(Effect.map((context) => Context.get(context, HttpServer.HttpServer).address))
}
