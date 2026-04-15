import { describe, expect, test } from "bun:test"
import { expand, has } from "../../../../src/cli/cmd/tui/component/prompt/skill"

const get = (name: string) =>
  ({
    "git-release": {
      name: "git-release",
      content: "Create consistent releases and changelogs.",
    },
    "pr-review": {
      name: "pr-review",
      content: "Review pull requests.",
    },
  })[name]

describe("prompt skill", () => {
  test("detects raw skill markers", () => {
    expect(has("use $git-release now")).toBe(true)
  })

  test("ignores markers embedded in words", () => {
    expect(has("use$git-release now")).toBe(false)
  })

  test("ignores numeric dollar amounts", () => {
    expect(has("budget is $100 now")).toBe(false)
  })

  test("expands raw skill markers in place", () => {
    const result = expand("hi $git-release now", get)

    expect(result).toBe("hi \n## Skill: git-release\n\nCreate consistent releases and changelogs. now")
  })

  test("leaves text unchanged when the skill is missing", () => {
    expect(expand("hi $missing now", get)).toBe("hi $missing now")
  })

  test("expands multiple raw skill markers", () => {
    const result = expand("$git-release and $pr-review", get)

    expect(result).toBe(
      "## Skill: git-release\n\nCreate consistent releases and changelogs. and \n## Skill: pr-review\n\nReview pull requests.",
    )
  })

  test("skips markers embedded in a word", () => {
    expect(expand("hi$git-release now", get)).toBe("hi$git-release now")
  })
})
