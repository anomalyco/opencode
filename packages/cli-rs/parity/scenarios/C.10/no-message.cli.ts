// No words and empty stdin: an error, exit 1, nothing created.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({ args: ["run", "   "], server: server() })
