import { defineCli } from "../../cli/run"

// `mcp add` with both a URL and a command fails.
// The TS error escapes with a stack trace; only its first line is compared (C40-handler-errors).
export default defineCli({
  stderrLines: 1,
  args: ["mcp", "add", "x", "--url", "https://a.test", "--", "node"],
  collect: ["work/opencode.json"],
})
