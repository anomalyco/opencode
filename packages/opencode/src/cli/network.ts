import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>
export type ServerAuth = { username: string; password: string; source: "env" | "config" | "generated" }
export type ServerOptions = {
  hostname: string
  port: number
  mdns: boolean
  cors: string[]
  random: boolean
  auth: ServerAuth
}

function resolveNetwork(args: NetworkOptions, config?: Config.Info) {
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const configPort = config?.server?.port
  const port = portExplicitlySet ? args.port : (configPort ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, cors, portExplicitlySet, configPort }
}

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await Config.global()
  const network = resolveNetwork(args, config)
  return {
    hostname: network.hostname,
    port: network.port,
    mdns: network.mdns,
    cors: network.cors,
  }
}

export async function resolveServerOptions(args: NetworkOptions): Promise<ServerOptions> {
  const config = await Config.global()
  const network = resolveNetwork(args, config)
  const username = Flag.OPENCODE_SERVER_USERNAME ?? config?.server?.username ?? "opencode"
  const password = Flag.OPENCODE_SERVER_PASSWORD ?? config?.server?.password ?? crypto.randomUUID()
  const source = Flag.OPENCODE_SERVER_PASSWORD ? "env" : config?.server?.password ? "config" : "generated"
  const random = network.port === 0 && (network.portExplicitlySet || !network.configPort)

  return {
    hostname: network.hostname,
    port: network.port,
    mdns: network.mdns,
    cors: network.cors,
    random,
    auth: {
      username,
      password,
      source,
    },
  }
}
