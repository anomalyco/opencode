declare const OPENCODE_VERSION: string
declare const OPENCODE_CHANNEL: string
declare const OPENCODE_ARTIFACT: string

const version = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
const channel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
const artifact = typeof OPENCODE_ARTIFACT === "string" ? OPENCODE_ARTIFACT : "cli"

export { version as OPENCODE_VERSION, channel as OPENCODE_CHANNEL, artifact as OPENCODE_ARTIFACT }
export const OPENCODE_LOCAL = channel === "local"
