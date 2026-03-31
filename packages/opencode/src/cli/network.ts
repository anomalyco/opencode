import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"
import { AppRuntime } from "@/effect/app-runtime"
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
  "web-mode": {
    type: "string" as const,
    describe: "web UI delivery mode: proxy (default) serves frontend through server, direct loads from CDN",
    choices: ["proxy", "direct"] as const,
  },
  "web-url": {
    type: "string" as const,
    describe: "URL for the web frontend (CDN origin for direct mode, proxy target for proxy mode)",
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const mdnsDomainExplicitlySet = process.argv.includes("--mdns-domain")
  const webModeExplicitlySet = process.argv.includes("--web-mode")
  const webUrlExplicitlySet = process.argv.includes("--web-url")

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  const webMode = webModeExplicitlySet ? args["web-mode"] : (config?.server?.webMode ?? "proxy")
  const webUrl = webUrlExplicitlySet
    ? args["web-url"]
    : (Flag.OPENCODE_WEB_URL ?? config?.server?.webUrl ?? "https://app.opencode.ai")

  return { hostname, port, mdns, mdnsDomain, cors, webMode, webUrl }
}
