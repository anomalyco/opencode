import { describe, expect, test } from "bun:test"
import { literalReplace } from "@opencode-ai/core/util/template"

describe("literalReplace", () => {
  test("inserts plain values unchanged", () => {
    expect(literalReplace("prettier --write $FILE", "$FILE", "/tmp/main.ts")).toBe("prettier --write /tmp/main.ts")
    expect(literalReplace("review ${path}", "${path}", "/home/user/repo")).toBe("review /home/user/repo")
  })

  test("does not expand $-sequences in the inserted value", () => {
    // With a string replacer these expand: $& inserts the matched placeholder,
    // $' / $` insert the text after / before the match, $$ collapses to $.
    expect(literalReplace("fmt $FILE", "$FILE", "/tmp/a$&b.ts")).toBe("fmt /tmp/a$&b.ts")
    expect(literalReplace("fmt $FILE", "$FILE", "/tmp/a$'b.ts")).toBe("fmt /tmp/a$'b.ts")
    expect(literalReplace("fmt $FILE", "$FILE", "/tmp/a$`b.ts")).toBe("fmt /tmp/a$`b.ts")
    expect(literalReplace("fmt $FILE", "$FILE", "/tmp/a$$b.ts")).toBe("fmt /tmp/a$$b.ts")
    expect(literalReplace("read ${path}", "${path}", "/x/$'$`$$")).toBe("read /x/$'$`$$")
  })

  test("matches the placeholder literally even though it contains $", () => {
    expect(literalReplace("$FILE and $FILE", "$FILE", "a.ts")).toBe("a.ts and $FILE")
  })

  test("replaces only the first occurrence", () => {
    // First-match semantics keep values that contain the placeholder text
    // from being re-replaced by a later fill of the same template.
    expect(literalReplace("$FILE $FILE", "$FILE", "lit($FILE)")).toBe("lit($FILE) $FILE")
  })

  test("returns the template unchanged when the placeholder is absent", () => {
    expect(literalReplace("no placeholder here", "$FILE", "a.ts")).toBe("no placeholder here")
  })
})
