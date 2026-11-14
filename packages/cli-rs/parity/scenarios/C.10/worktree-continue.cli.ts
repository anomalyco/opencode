// `-w` starts a new session, so it cannot be combined with `-c`.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({ args: ["run", "-w", "-c", "hi"], server: server() })
