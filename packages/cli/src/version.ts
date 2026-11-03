import pkg from "../package.json"

declare const OPENCODE_VERSION: string
declare const OPENCODE_CHANNEL: string
declare const OPENCODE_ARTIFACT: string

const version =
  typeof OPENCODE_VERSION === "string" && OPENCODE_VERSION !== "local"
    ? OPENCODE_VERSION
    : (process.env.OPENCODE_VERSION ?? pkg.version)
const channel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : (process.env.OPENCODE_CHANNEL ?? "local")
const artifact = typeof OPENCODE_ARTIFACT === "string" ? OPENCODE_ARTIFACT : (process.env.OPENCODE_ARTIFACT ?? "cli")

export { version as OPENCODE_VERSION, channel as OPENCODE_CHANNEL, artifact as OPENCODE_ARTIFACT }
export const OPENCODE_LOCAL = channel === "local"
