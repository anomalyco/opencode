declare const OPENCODE_VERSION: string
declare const OPENCODE_CHANNEL: string

const version = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
const channel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"

export { version as OPENCODE_VERSION, channel as OPENCODE_CHANNEL }
export const OPENCODE_LOCAL = channel === "local"
