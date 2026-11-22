import { defineCli } from "../../cli/run"
import { commented } from "./fixture"

// `mcp add --url` with headers edits the existing commented `.opencode/opencode.jsonc` and keeps its comments.
export default defineCli({
  args: [
    "mcp",
    "add",
    "docs",
    "--url",
    "https://mcp.example.test/mcp",
    "--header",
    "Authorization=Bearer x",
    "--header",
    "X-Team=core",
  ],
  files: { ".opencode/opencode.jsonc": commented },
  collect: ["work/.opencode/opencode.jsonc", "work/opencode.json"],
})
