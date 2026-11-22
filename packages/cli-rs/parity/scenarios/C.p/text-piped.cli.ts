// Keys from a pipe drive the prompt as typed keys do; the frames keep their cursor movements and
// carry no colors. `\r` submits (a piped `\n` would only end readline's line, as in Clack).
import { defineCli } from "../../cli/run"
import { demo } from "./demo"

export default defineCli({ args: [], command: demo("text"), stdin: "Ad\x7fda\r" })
