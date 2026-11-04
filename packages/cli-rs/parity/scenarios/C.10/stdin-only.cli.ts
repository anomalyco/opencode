// With no words, stdin alone is the message.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"

export default defineCli({
  args: ["run"],
  stdin: "only stdin",
  server: server({ events: () => textStep("ok") }),
})
