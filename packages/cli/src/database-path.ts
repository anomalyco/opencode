import path from "node:path"
import { OPENCODE_CHANNEL } from "./version"

export function databasePath(data: string, env: Readonly<NodeJS.ProcessEnv> = process.env) {
  const filename =
    env.OPENCODE_DB ??
    (["latest", "dev", "beta", "next", "prod"].includes(OPENCODE_CHANNEL) ||
    env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    env.OPENCODE_DISABLE_CHANNEL_DB === "true"
      ? "opencode.db"
      : `opencode-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
