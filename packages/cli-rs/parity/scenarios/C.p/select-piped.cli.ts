import { defineCli } from "../../cli/run"
import { demo } from "./demo"

export default defineCli({ args: [], command: demo("select"), stdin: "jj\r" })
