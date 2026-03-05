import { Flag } from "../flag/flag"

export function getAuthorizationHeader(
  password = Flag.OPENCODE_SERVER_PASSWORD,
  username = Flag.OPENCODE_SERVER_USERNAME,
) {
  if (!password) return undefined
  return `Basic ${btoa(`${username ?? "opencode"}:${password}`)}`
}
