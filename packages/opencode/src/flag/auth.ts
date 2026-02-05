import { Flag } from "@/flag/flag"

export function getAuthorizationHeader(options?: {
  passwordFromCli?: string
  usernameFromCli?: string
}): string | undefined {
  const password = options?.passwordFromCli ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = options?.usernameFromCli ?? Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${btoa(`${username}:${password}`)}`
}
