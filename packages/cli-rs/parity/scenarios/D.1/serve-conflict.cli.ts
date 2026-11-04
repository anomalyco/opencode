// `serve --service --stdio` fails before it starts anything ("--service and --stdio cannot be combined").
import { defineCli } from "../../cli/run"
import { env } from "./ts"

export default defineCli({ args: ["serve", "--service", "--stdio"], env })
