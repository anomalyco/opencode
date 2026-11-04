// `debug --wizard` with nothing on stdin: the subcommand select meets the end of input, so the wizard is
// cancelled with exit 0 and nothing runs.
import { defineCli } from "../../cli/run"

export default defineCli({ args: ["debug", "--wizard"], stdin: "" })
