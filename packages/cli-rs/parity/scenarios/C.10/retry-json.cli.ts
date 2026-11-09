// `retry` with `--format json`: a `retry` event, and one `step_start`.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"
import { retry } from "./retry.cli"

export default defineCli({
  args: ["run", "--format", "json", "hello"],
  server: server({ events: () => [textStep("ignored")[0], retry, ...textStep("Recovered.")] }),
})
