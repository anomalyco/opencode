import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"

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
  basePath: {
    type: "string" as const,
    describe: "base path prefix for all routes (e.g., /opencode)",
    default: "",
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

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await Config.global()
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const basePathExplicitlySet = process.argv.some(
    (arg) =>
      arg === "--base-path" ||
      arg.startsWith("--base-path=") ||
      arg === "--basePath" ||
      arg.startsWith("--basePath="),
  )
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const corsExplicitlySet = process.argv.includes("--cors")

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const basePath = normalizeBasePath(basePathExplicitlySet ? args.basePath : config?.server?.basePath)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, cors, basePath }
}

export function normalizeBasePath(path: string | undefined): string {
  if (!path) return ""
  let normalized = path.trim()
  if (!normalized) return ""
  if (!normalized.startsWith("/")) normalized = "/" + normalized
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }
  return normalized === "/" ? "" : normalized
}
