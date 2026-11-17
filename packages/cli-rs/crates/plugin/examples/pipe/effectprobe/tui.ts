// A V2 plugin that imports the `effect` package, which the layer does not serve (O-170): its load fails, and the row
// checks the reason names the package. Its setup, did it run, would log what it computed with effect to the file its
// `log` option names.
import { Plugin } from "@opencode/plugin/tui"
import { Option, Schema } from "effect"
import { appendFileSync } from "node:fs"

export default Plugin.define({
  id: "example.effectprobe",
  setup(context) {
    const decoded = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }))({ name: "probe" })
    const log = (entry: unknown) => appendFileSync(String(context.options.log), JSON.stringify(entry) + "\n")
    log({ name: decoded.name, some: Option.getOrElse(Option.some(2), () => 0) })
  },
})
