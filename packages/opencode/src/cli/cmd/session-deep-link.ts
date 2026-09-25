import { base64Encode } from "@opencode-ai/core/util/encode"

export function sessionDeepLink(serverUrl: string, sessionID: string) {
  const base = serverUrl.replace(/\/+$/, "")
  return `${base}/server/${base64Encode(base)}/session/${sessionID}`
}