import { describe, expect, test } from "vitest"
import { effectScriptHint } from "../../src/cli/check.js"

const promiseDiagnostic = (line: number) =>
  `/tmp/drive.ts:${line}:10 - error TS2322: Type 'Promise<void>' is not assignable to type 'Effect<void>'.`

describe("Effect script check hints", () => {
  test.each([
    [
      'defineScript({ run: async ({ ui }) => { await ui.submit("Hello") } })',
      "run: ({ ui }) =>",
    ],
    [
      'defineScript({ setup: () => Promise.resolve() })',
      "setup: ({ fs }) => fs.writeFile",
    ],
    [
      'defineScript({ run: ({ ui }) => ui.waitFor(() => Promise.resolve(false)) })',
      "ui.waitFor((state) => Effect.succeed",
    ],
  ])("describes the failing Promise callback", (callback, expected) => {
    const source = `import { defineScript } from "opencode-drive"\n${callback}\n`
    expect(effectScriptHint(source, promiseDiagnostic(2))).toContain(expected)
  })

  test("ignores Promise diagnostics on unrelated source lines", () => {
    const source = [
      'import { defineScript } from "opencode-drive"',
      "// run: async () => {}",
      "const value: Effect.Effect<void> = Promise.resolve()",
      "defineScript({ run: () => Effect.void })",
    ].join("\n")
    expect(effectScriptHint(source, promiseDiagnostic(3))).toBeUndefined()
  })
})
