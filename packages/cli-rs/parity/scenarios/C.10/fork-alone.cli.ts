// `--fork` needs `--continue` or `--session`.
import { defineCli } from "../../cli/run"
import { nowMask, server } from "./fixture"

export default defineCli({ args: ["run", "--fork", "--format", "json", "hi"], server: server(), masks: [nowMask] })
