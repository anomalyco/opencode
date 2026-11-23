import { defineCli } from "../../cli/run"
import { demo } from "./demo"

export default defineCli({ args: [], command: demo("autocomplete"), stdin: "item 2\x1b[B\r" })
