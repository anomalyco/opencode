// `uninstall --dry-run` lists what it would remove from the sandbox's roots and changes nothing.
import { defineCli } from "../../cli/run"
import { env } from "./ts"

export default defineCli({ args: ["uninstall", "--dry-run"], env })
