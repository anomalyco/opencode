// `plugin remove` of a package that no config lists: nothing is written.
import { defineCli } from "../../cli/run"
import { env } from "./ts"

export default defineCli({ args: ["plugin", "remove", "not-configured"], env })
