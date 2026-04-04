declare global {
  const XCSH_VERSION: string
  const XCSH_CHANNEL: string
}

export const VERSION = typeof XCSH_VERSION === "string" ? XCSH_VERSION : "local"
export const CHANNEL = typeof XCSH_CHANNEL === "string" ? XCSH_CHANNEL : "local"
