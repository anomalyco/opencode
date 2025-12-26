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
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export function resolveNetworkOptions(args: NetworkOptions) {
  const mdns = args.mdns
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const hostname = mdns && !hostnameExplicitlySet ? "0.0.0.0" : args.hostname
  const port = args.port
  return { hostname, port, mdns }
}
