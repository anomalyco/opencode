// `api put /api/thing -d text -H content-type:text/plain`: the caller's content type stays, and a reply that
// ends with a newline is printed as it is.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["api", "put", "/api/thing", "-d", "plain text", "-H", "Content-Type: text/plain"],
  server: { routes: [{ method: "PUT", path: "/api/thing", body: "ok\n" }] },
})
