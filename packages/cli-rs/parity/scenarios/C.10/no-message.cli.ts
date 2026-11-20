// Only white space, a BOM included, and empty stdin: an error, exit 1, nothing created.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({ args: ["run", " \uFEFF\u3000 "], server: server() })
