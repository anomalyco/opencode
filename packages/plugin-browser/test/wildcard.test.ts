import { expect, test } from "bun:test"
import { Wildcard } from "../src/wildcard.js"

// The matcher is a copy of core's (`packages/core/src/util/wildcard.ts`). These are the cases core's permission tests
// rest on; a change ported from core that moves one of them shows here.
test.each([
  // `*` is any run of characters, the empty one and line breaks included.
  { input: "tabs.list", pattern: "*", matches: true },
  { input: "", pattern: "*", matches: true },
  { input: "tabs.list", pattern: "tabs.*", matches: true },
  { input: "tabs.", pattern: "tabs.*", matches: true },
  { input: "files.upload", pattern: "tabs.*", matches: false },
  { input: "a/b/c.env", pattern: "*.env", matches: true },
  { input: "first\nsecond", pattern: "first*", matches: true },
  // `?` is exactly one character.
  { input: "tabs.open", pattern: "tabs.ope?", matches: true },
  { input: "tabs.ope", pattern: "tabs.ope?", matches: false },
  { input: "tabs.opens", pattern: "tabs.ope?", matches: false },
  // A trailing " *" also matches nothing: "git push *" covers "git push" and "git push origin", not "git pushx".
  { input: "git push", pattern: "git push *", matches: true },
  { input: "git push origin dev", pattern: "git push *", matches: true },
  { input: "git pushx", pattern: "git push *", matches: false },
  { input: "git push", pattern: "git push*", matches: true },
  { input: "git pushx", pattern: "git push*", matches: true },
  // Backslashes count as slashes, in the input and in the pattern.
  { input: "C:\\Users\\x\\project\\a.ts", pattern: "C:/Users/x/project/*", matches: true },
  { input: "C:/Users/x/project/a.ts", pattern: "C:\\Users\\x\\*", matches: true },
  { input: "C:\\Users\\y\\a.ts", pattern: "C:/Users/x/*", matches: false },
  // Every other character is literal, the ones a regular expression gives a meaning to included.
  { input: "browser", pattern: "b.owser", matches: false },
  { input: "b.owser", pattern: "b.owser", matches: true },
  { input: "a+b(c)[d]{e}|f^g$h", pattern: "a+b(c)[d]{e}|f^g$h", matches: true },
  { input: "browsers", pattern: "browser", matches: false },
  { input: "a browser", pattern: "browser", matches: false },
  // Case counts unless the caller says the server runs on Windows.
  { input: ".OPENCODE/x", pattern: ".opencode/*", matches: false },
  { input: ".OPENCODE/x", pattern: ".opencode/*", ignoreCase: true, matches: true },
  { input: "Tabs.List", pattern: "tabs.list", matches: false },
  { input: "Tabs.List", pattern: "tabs.list", ignoreCase: true, matches: true },
])("$pattern on $input (ignoreCase: $ignoreCase) is $matches", (row) => {
  expect(Wildcard.match(row.input, row.pattern, row.ignoreCase ?? false)).toBe(row.matches)
})
