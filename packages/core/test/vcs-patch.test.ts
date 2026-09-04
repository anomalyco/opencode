import { describe, expect, test } from "bun:test"
import { VcsPatch } from "@opencode-ai/core/vcs/patch"

describe("streamed Git patches", () => {
  const first = [
    "diff --git a/first.txt b/first.txt",
    "index 1111111..2222222 100644",
    "--- a/first.txt",
    "+++ b/first.txt",
    "@@ -1 +1 @@",
    "-old\r",
    "+diff --git is content, not a header 🦊\r",
    "\\ No newline at end of file",
    "",
  ].join("\n")
  const second = 'diff --git "a/tab\\tname.txt" "b/tab\\tname.txt"\nold mode 100644\nnew mode 100755\n'
  const changedType =
    "diff --git a/first.txt b/first.txt\nnew file mode 120000\nindex 0000000..3333333\n--- /dev/null\n+++ b/first.txt\n@@ -0,0 +1 @@\n+target\n"
  const patch = first + second + changedType
  const expected = new Map([
    ["first.txt", first + changedType],
    ["tab\tname.txt", second],
  ])

  test("preserves patches across every two-chunk split", () => {
    for (let index = 0; index <= patch.length; index++) {
      const collector = VcsPatch.collectGitPatch()
      collector.write(patch.slice(0, index))
      collector.write(patch.slice(index))
      expect(collector.end()).toEqual(expected)
    }
  })

  test("handles small chunks, CRLF content, Unicode, and multiple chunks per file", () => {
    for (const size of [1, 2, 7, 12, 64]) {
      const collector = VcsPatch.collectGitPatch()
      for (let offset = 0; offset < patch.length; offset += size) collector.write(patch.slice(offset, offset + size))
      expect(collector.end()).toEqual(expected)
    }
  })

  test("accepts empty output and a final patch without a newline", () => {
    expect(VcsPatch.collectGitPatch().end()).toEqual(new Map())
    const collector = VcsPatch.collectGitPatch()
    collector.write(second.trimEnd())
    expect(collector.end()).toEqual(new Map([["tab\tname.txt", second.trimEnd()]]))
  })
})
