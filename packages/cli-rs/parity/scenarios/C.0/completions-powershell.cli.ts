import { defineCli } from "../../cli/run"
import { ownFlags } from "./own-flags"

export default defineCli({ args: ["--completions", "powershell"], masks: ownFlags })
