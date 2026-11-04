// As `reconcile`, in JSON: step_start, text, tool_use and step_finish built from the projected message.
import { defineCli } from "../../cli/run"
import { assistant, server } from "./fixture"
import { content } from "./reconcile.cli"

export default defineCli({
  args: ["run", "--format", "json", "--thinking", "hello"],
  server: server({ messages: [assistant(content, { snapshot: { start: "s1", end: "s2" } })] }),
})
