// A V2 plugin that imports the `effect` package, as TS's runtime serves it (CT-13): the root and a module of it by its
// subpath. Its setup logs what it computed with them to the file its `log` option names.
import { Plugin } from "@opencode/plugin/tui"
import { Option, Schema } from "effect"
import { reduce } from "effect/Array"
import { appendFileSync } from "node:fs"

export default Plugin.define({
  id: "example.effectprobe",
  setup(context) {
    const decoded = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }))({ name: "probe" })
    const log = (entry: unknown) => appendFileSync(String(context.options.log), JSON.stringify(entry) + "\n")
    log({ name: decoded.name, some: Option.getOrElse(Option.some(2), () => 0), sum: reduce([1, 2, 3], 0, (a, b) => a + b) })
  },
})
