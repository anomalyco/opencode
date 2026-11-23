import { defineCli } from "../../cli/run"

// `mcp add --global` in a home without `~/.config/opencode`: the directory is created, as TS's
// `Global.Service` does, and the server goes into a new `opencode.json`.
export default defineCli({
  args: ["mcp", "add", "remote", "--global", "--url", "https://mcp.example.test/mcp"],
  collect: ["home/.config/opencode/opencode.json", "work/opencode.json"],
})
