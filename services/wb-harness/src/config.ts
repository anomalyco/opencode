import { readCredentials } from "./credentials"

export type WBConfig = {
  port: number
  hostname: string
  upstream: string
  auth: { token: string; userdata: string; source: "env" | "file" | "none"; expiresAt?: string }
  enrichment: { enabled: boolean; timeoutMs: number }
  session: { reuse: boolean }
}

export function loadConfig(): WBConfig {
  const token = process.env.WB_TOKEN ?? ""
  const userdata = process.env.WB_USERDATA ?? ""
  const stored = token && userdata ? undefined : readCredentials()

  return {
    port: Number(process.env.PORT ?? 3001),
    hostname: process.env.HOSTNAME ?? "127.0.0.1",
    upstream:
      process.env.WB_UPSTREAM ?? "https://ai-proxy.wildberries.ru/ai-proxy/api/chat/v5/message",
    auth: {
      token: token || stored?.token || "",
      userdata: userdata || stored?.userdata || "",
      source: token && userdata ? "env" : stored ? "file" : "none",
      expiresAt: stored?.expiresAt,
    },
    enrichment: {
      enabled: process.env.WB_ENRICH !== "false",
      timeoutMs: Number(process.env.WB_TOOL_TIMEOUT_MS ?? 4000),
    },
    session: {
      reuse: process.env.WB_SESSION_REUSE !== "false",
    },
  }
}
