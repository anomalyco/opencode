// `api post /api/thing?x=1 -d ... -H ...`: a raw method and path, the body sent as given, JSON by default,
// and a text reply without a final newline gets one.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["api", "POST", "/api/thing?x=1", "-d", '{"name":"value"}', "-H", " X-Test : one "],
  server: { routes: [{ method: "POST", path: "/api/thing", status: 201, body: "created" }] },
})
