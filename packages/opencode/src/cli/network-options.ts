import type { Argv, InferredOptionTypes } from "yargs"

// Pure yargs option metadata for the network flags shared by `$0`, `serve`,
// `web`, and `acp`. Kept in its own module — with zero Effect/Config imports —
// so the lazy CLI entrypoint can spread the spec into its synchronous default-
// command builder without dragging in the runtime resolver below.
export const networkOptions = {
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

export type NetworkOptions = InferredOptionTypes<typeof networkOptions>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(networkOptions)
}
