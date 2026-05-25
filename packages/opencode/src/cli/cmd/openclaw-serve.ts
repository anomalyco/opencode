import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { OpenClawBridge } from "@/openclaw/bridge"

export const OpenClawServeCommand = effectCmd({
  command: "openclaw-serve",
  describe: "start an OpenClaw gateway adapter server",
  instance: false,
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("gateway-url", {
        type: "string",
        describe: "OpenClaw gateway websocket or http url",
      })
      .option("gateway-host", {
        type: "string",
        describe: "OpenClaw gateway host",
        default: "127.0.0.1",
      })
      .option("gateway-port", {
        type: "number",
        describe: "OpenClaw gateway port",
        default: 18789,
      })
      .option("gateway-token", {
        type: "string",
        describe: "OpenClaw gateway token",
      }),
  handler: Effect.fn("Cli.openclawServe")(function* (args) {
    const net = yield* resolveNetworkOptions(args)
    const url = args.gatewayUrl || `ws://${args.gatewayHost}:${args.gatewayPort}`
    const token = args.gatewayToken || process.env.OPENCLAW_GATEWAY_TOKEN
    const server = OpenClawBridge.listen({
      hostname: net.hostname,
      port: net.port,
      cors: net.cors,
      gateway: {
        url,
        token,
      },
    })
    console.log(`openclaw adapter listening on http://${server.hostname}:${server.port}`)
    yield* Effect.never.pipe(Effect.ensuring(Effect.promise(() => server.stop())))
  }),
})
