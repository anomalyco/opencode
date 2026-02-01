import { Flag } from "@/flag/flag"

export function getAuthorizationHeader(options?: { passwordFromCli?: string }): string | undefined {
  const password = options?.passwordFromCli ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${btoa(`${username}:${password}`)}`
}
