import { defineCli } from "../../cli/run"

// `--env` belongs to local servers.
// The TS error escapes with a stack trace; only its first line is compared (C40-handler-errors).
export default defineCli({
  stderrLines: 1,
  args: ["mcp", "add", "x", "--url", "https://a.test", "--env", "A=1"],
})
