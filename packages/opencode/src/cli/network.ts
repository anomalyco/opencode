import { Effect } from "effect"
import { hasArg, resolveNetworkOptionsNoConfig, withNetworkOptions } from "./network-options"
import type { NetworkOptions } from "./network-options"

export { hasArg, resolveNetworkOptionsNoConfig, withNetworkOptions, type NetworkOptions }

export const resolveNetworkOptions = Effect.fn("Cli.resolveNetworkOptions")(function* (args: NetworkOptions) {
  const { Config } = yield* Effect.promise(() => import("@/config/config"))
  const config = yield* Config.Service.use((cfg) => cfg.getGlobal())
  return resolveNetworkOptionsNoConfig(args, config)
})
