// A plugin that prints, for the pipe's tests (P7, review F4): its own module, a module of its own it imports, and a
// dependency from `node_modules` (`chatty`, which the test writes there) print at import, in setup and in a command,
// through every console method and `process.stdout`. None of it may reach the protocol. Its log is a hidden file beside
// it; a write's callback is logged once it ran.

import { appendFileSync } from "node:fs"
import path from "node:path"
import { shout } from "./loud"
import chatty from "chatty"

console.log("the printer's module prints as it loads")

export default {
  id: "example.printer",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    const log = (entry: unknown) => appendFileSync(path.join(import.meta.dir, ".log.jsonl"), JSON.stringify(entry) + "\n")
    shout("setup")
    chatty("setup")
    carrier.command({ name: "printer.print", title: "printer.print" }, () => {
      console.log("log", { nested: [1, 2] })
      console.info("info")
      console.warn("warn")
      console.error("error")
      console.debug("debug")
      console.trace("trace")
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
