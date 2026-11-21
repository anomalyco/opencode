import { defineCli } from "../../cli/run"

// `mcp add` with a URL that does not parse fails.
// The TS error escapes with a stack trace; only its first line is compared (C40-handler-errors).
export default defineCli({
  stderrLines: 1,
  args: ["mcp", "add", "x", "--url", "not a url"],
  collect: ["work/opencode.json"],
})
