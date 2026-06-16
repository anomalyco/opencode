import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { Config, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { createServer } from "node:http"
import { Ingest } from "./ingest"
import { Routes } from "./router"
import { registerShutdownSignalHandlers } from "./shutdown"

registerShutdownSignalHandlers()

const ServerLive = NodeHttpServer.layerConfig(
  () => createServer(),
  Config.all({
    port: Config.number("PORT").pipe(Config.withDefault(3000)),
    host: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
  }),
)

const runtimeLayer = Ingest.layer
const programLayer = Routes.pipe(Layer.provide(runtimeLayer))
const main = Layer.launch(
  HttpRouter.serve(programLayer, {
    disableLogger: true,
  }).pipe(Layer.provideMerge(ServerLive)),
)

NodeRuntime.runMain(main, { disableErrorReporting: true })
