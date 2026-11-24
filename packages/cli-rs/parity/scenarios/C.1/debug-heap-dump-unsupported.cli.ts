// `debug heap-dump` against a server without the route (404): the update hint on stderr, exit 1.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["debug", "heap-dump"],
  server: { routes: [] },
})
