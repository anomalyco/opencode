export namespace Wildcard {
  export function match(str: string, pattern: string) {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
          .replace(/\*/g, ".*") // * becomes .*
          .replace(/\?/g, ".") + // ? becomes .
        "$",
      "s", // s flag enables multiline matching
    )
    return regex.test(str)
  }
}
