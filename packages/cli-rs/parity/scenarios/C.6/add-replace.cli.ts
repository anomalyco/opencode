import { defineCli } from "../../cli/run"
import { commented } from "./fixture"

// `mcp add` over an existing name replaces that server in place.
export default defineCli({
  args: ["mcp", "add", "existing", "--url", "https://mcp.example.test/"],
  files: { "opencode.json": commented },
  collect: ["work/opencode.json"],
})
