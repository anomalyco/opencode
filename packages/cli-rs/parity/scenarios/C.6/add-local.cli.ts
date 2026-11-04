import { defineCli } from "../../cli/run"

// `mcp add` with a command after `--` writes a local server into a new `opencode.json`.
export default defineCli({
  args: [
    "mcp",
    "add",
    "files",
    "--env",
    "ROOT=/srv",
    "--env",
    "MODE=ro",
    "--",
    "npx",
    "-y",
    "@acme/files",
    "--root",
    ".",
  ],
  collect: ["work/opencode.json"],
})
