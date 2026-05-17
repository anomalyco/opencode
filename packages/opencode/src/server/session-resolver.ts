import { fixedSessionResolver, workosSessionResolver, type SessionResolver } from "@veritly/auth-shared"
import { isOpencodeWorkosEnabled } from "./workos-env"

export function opencodeSessionResolver(): SessionResolver | undefined {
  const e2e = process.env["OPENCODE_E2E_USER_ID"]?.trim()
  if (e2e) return fixedSessionResolver(e2e)
  if (!isOpencodeWorkosEnabled()) return
  return workosSessionResolver()
}
