import { defineCli } from "../../cli/run"

// `mcp add` with neither a URL nor a command fails.
// The TS error escapes with a stack trace; only its first line is compared (C40-handler-errors).
export default defineCli({
  stderrLines: 1,
  args: ["mcp", "add", "x"],
  collect: ["work/opencode.json"],
})
