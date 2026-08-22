import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

const opaque = ["$COMMAND hidden", "$(printf command) hidden", 'printf "unterminated'] as const
const contexts = [
  (source: string) => source,
  (source: string) => `${source}; printf visible`,
  (source: string) => `printf visible; ${source}`,
  (source: string) => `${source} && printf visible`,
  (source: string) => `printf visible || ${source}`,
  (source: string) => `printf "$(${source})"`,
  (source: string) => `X=$(${source}) printf visible`,
  (source: string) => `printf visible >$(${source})`,
] as const

describe("ShellScan recursive structural opacity", () => {
  for (const seed of opaque) {
    for (const outer of contexts) {
      for (const inner of contexts.slice(0, 5)) {
        const source = outer(inner(seed))
        test(source, () => expect(ShellScan.scan(source).kind).toBe("opaque"))
      }
    }
  }
})

describe("ShellScan quote suppression", () => {
  test.each([...opaque])("single quotes suppress active syntax: %s", (source) => {
    expect(ShellScan.scan(`printf '%s' '${source.replaceAll("'", "")}'`).kind).toBe("scanned")
  })
})
