// Writes from import, setup and a command to check stdout attribution, including dependency output.

import { appendFileSync } from "node:fs"
import path from "node:path"
import { shout } from "./loud"
import chatty from "chatty"

console.log("the printer's module prints as it loads")

export default {
  id: "example.printer",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    const log = (entry: unknown) => appendFileSync(path.join(import.meta.dir, "..", ".printer.log.jsonl"), JSON.stringify(entry) + "\n")
    shout("setup")
    chatty("setup")
    carrier.command({ name: "printer.print", title: "printer.print" }, () => {
      console.log("log", { nested: [1, 2] })
      console.info("info")
      console.warn("warn")
      console.error("error")
      console.debug("debug")
      console.trace("trace")
      // Bun writes these methods directly to stdout.
      console.dir({ dir: true })
      console.table([{ table: 1 }])
      console.count("count")
      console.time("time")
      console.timeEnd("time")
      process.stdout.write("a string\n")
      process.stdout.write(Buffer.from("a buffer\n"), () => log({ written: true }))
      process.stdout.write("with an encoding\n", "utf8")
      shout("command")
      chatty("command")
      log({ printed: true })
    })
    carrier.surface("printed", { type: "slot", kind: "prepend", path: "home.footer" }, () => ({
      type: "text",
      spans: [{ text: "the printer is here" }],
    }))
  },
}
