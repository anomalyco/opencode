import type { Argv, InferredOptionTypes } from "yargs"

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
  "mdns-domain": {
    type: "string" as const,
    describe: "custom domain name for mDNS service (default: opencode.local)",
    default: "opencode.local",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export function resolveFrom(
  args: NetworkOptions,
  config: {
    server?: { port?: number; hostname?: string; mdns?: boolean; mdnsDomain?: string; cors?: string[] }
  } | null,
  argv: string[],
) {
  const explicit = {
    port: argv.includes("--port"),
    hostname: argv.includes("--hostname"),
    mdns: argv.includes("--mdns"),
    mdnsDomain: argv.includes("--mdns-domain"),
    cors: argv.includes("--cors"),
  }

  const mdns = explicit.mdns ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = explicit.mdnsDomain ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = explicit.port ? args.port : (config?.server?.port ?? args.port)
  const hostname = explicit.hostname
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, mdnsDomain, cors, explicit }
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const { Config } = await import("../config/config")
  const config = await Config.global()
  return resolveFrom(args, config, process.argv)
}
