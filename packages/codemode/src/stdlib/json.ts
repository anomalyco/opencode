import { type AstNode, InterpreterRuntimeError, supportedSyntaxMessage } from "../interpreter/model.js"
import { typeofValue } from "../interpreter/references.js"
import { copyIn, copyOut } from "../tool-runtime.js"

export const invokeJsonMethod = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  switch (name) {
    case "stringify": {
      const replacer = args[1]
      if (Array.isArray(replacer) || typeofValue(replacer) === "function") {
        throw new InterpreterRuntimeError(
          "JSON.stringify replacers are not supported in CodeMode.",
          node,
          "UnsupportedSyntax",
          [supportedSyntaxMessage],
        )
      }
      const space = args[2]
      const indent = typeof space === "number" || typeof space === "string" ? space : undefined
      return JSON.stringify(copyOut(copyIn(args[0], "JSON.stringify value")), null, indent)
    }
    case "parse": {
      const text = args[0]
      if (typeof text !== "string") throw new InterpreterRuntimeError("JSON.parse expects a string.", node)
      if (typeofValue(args[1]) === "function") {
        throw new InterpreterRuntimeError(
          "JSON.parse revivers are not supported in CodeMode.",
          node,
          "UnsupportedSyntax",
          [supportedSyntaxMessage],
        )
      }
      try {
        return copyIn(JSON.parse(text), "JSON.parse result")
      } catch (error) {
        throw new InterpreterRuntimeError(
          `JSON.parse received invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          node,
        ).as("SyntaxError")
      }
    }
  }
  throw new InterpreterRuntimeError(`JSON.${name} is not available in CodeMode.`, node)
}
