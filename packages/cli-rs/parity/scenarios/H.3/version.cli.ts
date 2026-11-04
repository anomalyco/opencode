// `--version` prints `<name> v<version>` and needs no server. Both sides run from source, so both
// report `local`.
import { defineCli } from "../../cli/run"

export default defineCli({ args: ["--version"] })
