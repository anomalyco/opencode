import { defineCli } from "../../cli/run"

// `--header` belongs to remote servers.
// The TS error escapes with a stack trace; only its first line is compared (C40-handler-errors).
export default defineCli({
  stderrLines: 1,
  args: ["mcp", "add", "x", "--header", "A=1", "--", "node"],
})
