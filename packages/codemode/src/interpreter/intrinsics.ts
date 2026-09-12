import { ProgramError, ProgramObject, set } from "./objects.js"

export const errorTypes = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
] as const

export type ErrorType = (typeof errorTypes)[number]

export const isErrorType = (name: string): name is ErrorType => (errorTypes as ReadonlyArray<string>).includes(name)

/** The built-in prototype objects of one runtime. Constructors attach themselves as `constructor` when created. */
export type Intrinsics = {
  readonly errors: Readonly<Record<ErrorType, ProgramObject>>
}

export const createErrorValue = (prototype: ProgramObject, message: string | undefined): ProgramError => {
  const value = new ProgramError(prototype)
  if (message !== undefined) set(value, "message", message)
  return value
}

export const createIntrinsics = (): Intrinsics => {
  const error = new ProgramObject()
  set(error, "name", "Error")
  set(error, "message", "")
  const derived = (type: ErrorType) => {
    const proto = new ProgramObject(error)
    set(proto, "name", type)
    set(proto, "message", "")
    return proto
  }
  return {
    errors: {
      Error: error,
      TypeError: derived("TypeError"),
      RangeError: derived("RangeError"),
      SyntaxError: derived("SyntaxError"),
      ReferenceError: derived("ReferenceError"),
      EvalError: derived("EvalError"),
      URIError: derived("URIError"),
      AggregateError: derived("AggregateError"),
    },
  }
}
