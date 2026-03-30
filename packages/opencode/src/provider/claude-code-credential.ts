import os from "os"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

const log = Log.create({ service: "claude-code-credential" })

const CACHE_TTL_MS = 5 * 60 * 1000

export namespace ClaudeCodeCredential {
  export interface Token {
    accessToken: string
    refreshToken: string
    expiresAt: number
  }

  export type Status = "valid" | "expired" | "missing" | "error"

  type Result =
    | { token: Token; status: "valid" | "expired" }
    | { token: undefined; status: "missing" | "error" }

  let cache: { value: Token; readAt: number } | undefined

  export async function get(): Promise<Result> {
    const now = Date.now()

    if (cache && now - cache.readAt < CACHE_TTL_MS) {
      const status = now < cache.value.expiresAt ? "valid" : "expired"
      if (status === "expired") {
        log.warn("Claude Code OAuth token has expired. Run `claude` to re-authenticate.")
      }
      return { token: cache.value, status }
    }

    const credPath = path.join(os.homedir(), ".claude", ".credentials.json")

    try {
      const data = await Filesystem.readJson<Record<string, any>>(credPath)
      const oauth = data?.claudeAiOauth
      if (!oauth?.accessToken) {
        return { token: undefined, status: "missing" }
      }

      const token: Token = {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken ?? "",
        expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : 0,
      }

      cache = { value: token, readAt: now }

      const status = now < token.expiresAt ? "valid" : "expired"
      if (status === "expired") {
        log.warn("Claude Code OAuth token has expired. Run `claude` to re-authenticate.")
      }
      return { token, status }
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        return { token: undefined, status: "missing" }
      }
      log.warn("Failed to read Claude Code credentials", { error: e?.message })
      return { token: undefined, status: "error" }
    }
  }
}
