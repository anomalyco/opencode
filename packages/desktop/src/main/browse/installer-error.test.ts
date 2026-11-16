import { expect, test } from "bun:test"
import { installerError } from "./installer-error"

test.each([
  {
    name: "the last warning, not the hint printed after it",
    output:
      "✓ Added browse to OpenCode\nWaiting for browse to connect (up to 600s; Ctrl+C to skip)…\n! Not connected yet. If browse isn't connected after you add it, run `browse install` again, or `browse pair` for a code.\n",
    expected:
      "Not connected yet. If browse isn't connected after you add it, run `browse install` again, or `browse pair` for a code.",
  },
  {
    name: "the script's own failure, without its color codes",
    output: "\u001b[0;31mbrowse: unknown channel nightly (stable, beta or dev)\u001b[0m\n",
    expected: "unknown channel nightly (stable, beta or dev)",
  },
  { name: "no output", output: "\n\n", expected: undefined },
])("$name", ({ output, expected }) => {
  expect(installerError(output)).toBe(expected)
})
