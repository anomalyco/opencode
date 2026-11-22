// `session delete <id>`: one DELETE, then the confirmation.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["session", "delete", "ses_aaaaaaaa0001"],
  server: { routes: [{ method: "DELETE", path: "/api/session/:id", status: 204 }] },
})
