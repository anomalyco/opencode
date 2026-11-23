// `mini` with stdout on a pipe fails before it connects.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["mini"],
  server: { routes: [] },
})
