import { rangeError } from "./model.js"

// The timeout only fires between interpreter steps, so a single built-in must not be able to materialize an
// unbounded value. These bound what one call may build; programs cannot reach such sizes any other way.

/** Longest string a built-in or operator may produce. */
export const MAX_STRING_LENGTH = 1 << 24
/** Longest array a built-in may create or grow to. */
export const MAX_ARRAY_LENGTH = 10_000_000
/** Most arguments one call may receive, including a bound function's bound arguments. */
export const MAX_ARGUMENTS = 250_000
/** Most promises that may be pending at once. */
export const MAX_PENDING_PROMISES = 10_000
/** Deepest nesting a value may have when it crosses to or from the host. */
export const MAX_VALUE_DEPTH = 32

export const checkStringLength = (length: number): void => {
  if (length > MAX_STRING_LENGTH) throw rangeError("Invalid string length")
}

/** A string the host already built, after checking its length; for outputs at most nine times a capped input. */
export const boundedString = (value: string): string => {
  checkStringLength(value.length)
  return value
}

export const checkArgumentCount = (count: number): void => {
  if (count > MAX_ARGUMENTS) throw rangeError(`Too many arguments: a call may pass at most ${MAX_ARGUMENTS}.`)
}

export const checkArrayLength = (length: number): void => {
  if (length > MAX_ARRAY_LENGTH) throw rangeError("Invalid array length")
}
