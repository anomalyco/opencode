// A file over 10 MiB cannot be attached.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({
  args: ["run", "hi", "-f", "big.txt"],
  files: { "big.txt": "x".repeat(10 * 1024 * 1024 + 1) },
  server: server(),
})
