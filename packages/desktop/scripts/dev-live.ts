import { Service } from "@opencode/client/service"
import { homedir } from "node:os"
import { join } from "node:path"

const endpoints = await Promise.all([
  Service.discover(),
  Service.discover({
    file: join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "service-local.json"),
  }),
])
const endpoint = endpoints.find((endpoint) => endpoint !== undefined)
if (!endpoint)
  throw new Error(
    "No running OpenCode service found. Use `bun run dev` from the repository root to start the terminal app with its tray companion.",
  )
process.env.OPENCODE_DESKTOP_SERVER_URL = endpoint.url
process.env.OPENCODE_DESKTOP_SERVER_PASSWORD = endpoint.auth?.password ?? ""
process.argv.push("--tray")
await import("./dev")
