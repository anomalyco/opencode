// The execution ends but the prompt never reaches the message list: "Prompt was not promoted", exit 1.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({
  args: ["run", "hello"],
  server: server({ listed: false }),
})
