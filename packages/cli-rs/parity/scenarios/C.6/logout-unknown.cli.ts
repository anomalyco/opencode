import { defineCli } from "../../cli/run"
import { mcpRoute } from "./fixture"

// `mcp logout` of an unknown server.
// The TS error escapes with a stack trace; only its first line is compared (C40-handler-errors).
export default defineCli({
  stderrLines: 1,
  args: ["mcp", "logout", "nope"],
  server: { routes: [mcpRoute()] },
})
