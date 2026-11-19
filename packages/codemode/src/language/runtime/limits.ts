import { rangeError } from "./model.js"

// The timeout only fires between interpreter steps, so a single built-in must not be able to materialize an
// unbounded value. These bound what one call may build; programs cannot reach such sizes any other way.

/** Longest string a built-in or operator may produce. */
export const MAX_STRING_LENGTH = 1 << 24
/** Longest array a built-in may create or grow to. */
export const MAX_ARRAY_LENGTH = 10_000_000
/** Most promises that may be pending at once. */
export const MAX_PENDING_PROMISES = 10_000
/** Deepest nesting a value may have when it crosses to or from the host. */
export const MAX_VALUE_DEPTH = 32

export const checkStringLength = (length: number): void => {
  if (length > MAX_STRING_LENGTH) throw rangeError("Invalid string length")
}

export const checkArrayLength = (length: number): void => {
  if (length > MAX_ARRAY_LENGTH) throw rangeError("Invalid array length")
}

/** Most locales one Intl call may take; the host canonicalizes them in one call the timeout cannot interrupt. */
export const MAX_LOCALES = 100
/** Longest locale tag one Intl call may take; the host's tag parsing grows faster than linearly with length. */
export const MAX_LOCALE_LENGTH = 256

// Checked before a locale list's elements are read.
export const checkLocaleCount = (count: number): void => {
  if (count > MAX_LOCALES) throw rangeError(`Too many locales: at most ${MAX_LOCALES} are supported`)
}

export const checkLocaleTag = (tag: unknown): void => {
  if (typeof tag === "string" && tag.length > MAX_LOCALE_LENGTH) {
    throw rangeError(`Locale tag is too long: at most ${MAX_LOCALE_LENGTH} characters are supported`)
  }
}
