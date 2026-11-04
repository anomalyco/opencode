// `api --wizard`: a text flag, a repeatable flag (a count, then each value), a skipped key=value flag, and the
// variadic positional (a count, then each word). Runs the request against the fake server.
import { definePty } from "../../pty/run"
import { enter, first, press } from "../C.5/keys"

export default definePty({
  args: ["api", "--wizard"],
  server: { routes: [{ method: "POST", path: "/api/thing", status: 201, body: "created" }] },
  steps: [
    first("Set Request body (--data)?", "data"),
    press("y", "data-text", "Request body (--data) ›"),
    press(`{"name":"it's"}`, "data-typed"),
    press(enter, "header-count", "Header (--header) count"),
    press("k", "header-count-up"),
    press(enter, "header", "(--header) ›"),
    press("X-Test: one" + enter, "param", "(--param)?"),
    press("n", "request-count", "Operation | method path count"),
    press("\x152", "request-count-typed"),
    press(enter, "request", "Operation | method path ›"),
    press("POST" + enter, "request-path"),
    press("/api/thing" + enter, "ready", "Run this command?"),
    press(enter, "ran", "created"),
  ],
  exits: true,
  requests: true,
})
