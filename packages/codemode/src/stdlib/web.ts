import { fn, methods } from "../interpreter/native.js"
import { typeError } from "../interpreter/model.js"
import { Bytes, Obj, coerceToString } from "../interpreter/objects.js"
import { describeValue } from "../interpreter/references.js"
import type { Interpreter } from "../interpreter/interpreter.js"

// WebIDL DOMString conversion: a missing argument is a TypeError, anything else stringifies. Invalid input is a
// TypeError as well; browsers throw a DOMException named InvalidCharacterError, which CodeMode does not have.
export const base64Global = <R>(ctx: Interpreter<R>, name: "atob" | "btoa") =>
  fn<R>(ctx.builtins, name, 1, (_, args) => {
    if (args.length === 0) throw typeError(`${name} requires 1 argument (a string)`)
    const input = coerceToString(args[0])
    try {
      return name === "atob" ? atob(input) : btoa(input)
    } catch {
      throw typeError("The string contains invalid characters.")
    }
  })

export const cryptoGlobal = <R>(ctx: Interpreter<R>) => {
  const object = new Obj(ctx.builtins.Object)
  methods(ctx.builtins, object, [
    ["randomUUID", 0, () => crypto.randomUUID()],
    [
      "getRandomValues",
      1,
      (_, args) => {
        if (!(args[0] instanceof Bytes)) {
          throw typeError(`crypto.getRandomValues expects a Uint8Array, received ${describeValue(args[0])}.`)
        }
        crypto.getRandomValues(args[0].bytes)
        return args[0]
      },
    ],
  ])
  return object
}
