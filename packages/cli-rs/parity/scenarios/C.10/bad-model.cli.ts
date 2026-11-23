// An invalid `-m` fails before anything is created.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({ args: ["run", "-m", "nomodel", "hi"], server: server() })
