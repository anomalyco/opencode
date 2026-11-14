// Without a terminal: the same lines, no colors.
import { defineCli } from "../../cli/run"
import { demo } from "./demo"

export default defineCli({ args: [], command: demo("messages") })
