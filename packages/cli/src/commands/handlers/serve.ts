import { NodeHttpServer } from "@effect/platform-node"
import { Credential } from "@bolt-ai/core/credential"
import { AppNodeBuilder } from "@bolt-ai/core/effect/app-node-builder"
import { LayerNode } from "@bolt-ai/core/effect/layer-node"
import { PermissionSaved } from "@bolt-ai/core/permission/saved"
import { Context, Layer, Option } from "effect"
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createServer } from "node:http"
import { createRoutes } from "@bolt-ai/server/routes"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerProcess } from "../../server-process"

export default Runtime.handler(
  Commands.commands.serve,
  Effect.fnUntraced(function* (input) {
    if (input.service && input.stdio) return yield* Effect.fail(new Error("--service and --stdio cannot be combined"))
    return yield* ServerProcess.run({
      mode: input.service ? "service" : input.stdio ? "stdio" : "default",
      hostname: Option.getOrUndefined(input.hostname),
      port: Option.getOrUndefined(input.port),
      cors: input.cors.length > 0 ? input.cors : undefined,
    })
  }),
)

function listen(hostname: string, port: Option.Option<number>, password: string) {
  if (Option.isSome(port)) return bind(hostname, port.value, password)
  // Only walk to the next port when the current one is taken; other bind errors
  // (bad hostname, permissions) should surface immediately instead of after ~61k retries.
  const next = (port: number): ReturnType<typeof bind> =>
    bind(hostname, port, password).pipe(
      Effect.catch((error) =>
        port !== 65_535 && errorCode(error) === "EADDRINUSE" ? next(port + 1) : Effect.fail(error),
      ),
    )
  return next(4096)
}

function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.code === "string") return record.code
  return errorCode(record.cause)
}

function bind(hostname: string, port: number, password: string) {
  return Layer.build(
    HttpRouter.serve(createRoutes(password), { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port, host: hostname })),
      Layer.provide(AppNodeBuilder.build(LayerNode.group([Credential.node, PermissionSaved.node]))),
    ),
  ).pipe(Effect.map((context) => Context.get(context, HttpServer.HttpServer).address))
}
