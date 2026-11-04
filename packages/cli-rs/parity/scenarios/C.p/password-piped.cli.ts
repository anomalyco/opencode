import { defineCli } from "../../cli/run"
import { demo } from "./demo"

export default defineCli({ args: [], command: demo("password"), stdin: "\rkey\r" })
