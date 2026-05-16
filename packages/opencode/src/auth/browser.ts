/** Safe identifier pattern — ULID chars only, prevents path traversal and shell injection */
const SAFE_RECORD_ID_RE = /^[A-Za-z0-9_-]+$/

export function isValidRecordId(recordId: string): boolean {
  return SAFE_RECORD_ID_RE.test(recordId) && recordId.length > 0 && recordId.length <= 128
}

export { AuthBrowser } from "./browser-session"
export type { OAuthTokens, BrowserSessionStatus } from "./browser-session"
