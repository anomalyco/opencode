import type { ServerAuthConfig } from "./config"

export function decode(input: string) {
  try {
    const parts = Buffer.from(input, "base64").toString("utf8").split(":")
    if (parts.length !== 2) return
    return { username: parts[0], password: parts[1] }
  } catch {
    return
  }
}

export function verify(config: ServerAuthConfig.Basic, authorization?: string | null, authToken?: string | null) {
  const header = authorization?.startsWith("Basic ") ? authorization.slice("Basic ".length) : authToken
  if (!header) return false
  const credential = decode(header)
  if (!credential) return false
  return credential.username === config.username && credential.password === config.password
}

export function header(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export * as ServerAuthBasic from "./basic"
