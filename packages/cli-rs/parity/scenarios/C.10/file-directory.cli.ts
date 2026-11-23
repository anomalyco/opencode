// A directory cannot be attached.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({
  args: ["run", "hi", "-f", "sub"],
  files: { "sub/x": "x" },
  server: server(),
})
