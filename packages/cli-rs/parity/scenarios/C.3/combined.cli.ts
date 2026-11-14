// `stats --days 3 --all`: rejected before any request, with the bare message and exit 1.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["stats", "--days", "3", "--all"],
  server: { routes: [] },
})
