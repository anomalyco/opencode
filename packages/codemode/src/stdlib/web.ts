import { HostNamespace, sync } from "../interpreter/host.js"
import { InterpreterRuntimeError } from "../interpreter/model.js"
import { coerceToString } from "./value.js"

// WebIDL DOMString conversion: a missing argument is a TypeError, anything else stringifies. Invalid input is a
// TypeError as well; browsers throw a DOMException named InvalidCharacterError, which CodeMode does not have.
const base64 = (name: "atob" | "btoa") =>
  sync(name, (args, node) => {
    if (args.length === 0) throw new InterpreterRuntimeError(`${name} requires 1 argument (a string)`, node)
    const input = coerceToString(args[0])
    try {
      return name === "atob" ? atob(input) : btoa(input)
    } catch {
      throw new InterpreterRuntimeError("The string contains invalid characters.", node)
    }
  })

export const atobGlobal = base64("atob")
export const btoaGlobal = base64("btoa")

export const cryptoGlobal = new HostNamespace("crypto", {
  randomUUID: sync("crypto.randomUUID", () => crypto.randomUUID()),
})
