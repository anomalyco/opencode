import { describe, expect, test } from "bun:test"
import { ShellPrompt } from "../../src/tool/shell/prompt"

describe("tool.shell prompt", () => {
  test("uses bounded parent directory verification for bash", () => {
    const description = ShellPrompt.render("bash", "linux", { maxLines: 2000, maxBytes: 50_000 }, 120_000).description

    expect(description).toContain('use a bounded check such as `test -d "foo"` or `stat "foo"`')
    expect(description).toContain('Use `ls "foo"` only when child names are materially needed')
    expect(description).not.toContain("first use `ls` to verify the parent directory")
  })
})
