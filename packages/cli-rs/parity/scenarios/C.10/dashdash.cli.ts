// Words after `--` are message words, not flags.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"

export default defineCli({
  args: ["run", "a", "--server", "$SERVER", "--", "--model", "x", "-c"],
  server: server({ events: () => textStep("ok") }),
})
