// `--session ses_x --server <url>` (C01): the root command looks the session up before the TUI starts; a
// failing lookup ends the command with the error and exit 1.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["--session", "ses_x"],
  server: { routes: [{ path: "/api/session/ses_x", status: 500, json: { message: "boom" } }] },
})
