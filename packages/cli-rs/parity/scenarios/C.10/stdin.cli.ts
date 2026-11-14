// Piped stdin follows the message words after a newline.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"

export default defineCli({
  args: ["run", "summarize", "this file"],
  stdin: "line one\nline two\n",
  server: server({ events: () => textStep("Summary.") }),
})
