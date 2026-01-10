import { describe, expect, test } from "bun:test"
import { displayProjectStats } from "../../src/cli/cmd/projects"
import type { Project } from "../../src/project/project"
import { Locale } from "../../src/util/locale"

describe("cli projects", () => {
  test("renders full path with wrapping and aligned frame", () => {
    const lines: string[] = []
    const collect = (...message: string[]) => {
      lines.push(...message)
    }

    const lastActive = Date.UTC(2024, 0, 1, 12, 30)
    const longPath = "/very/long/path/to/a/project/that/should/wrap/without/ellipsis/because/we/want/full/visibility"
    const project: Project.Info = {
      id: "proj-1",
      worktree: longPath,
      vcs: "git",
      sandboxes: [],
      time: {
        created: lastActive,
        updated: lastActive,
      },
    }

    displayProjectStats(
      [
        {
          project,
          sessionCount: 3,
          lastActive,
          worktreeExists: true,
        },
      ],
      {},
      collect,
      { width: 90 },
    )

    const headerWidth = lines[0]?.length ?? 0
    const formattedTime = Locale.todayTimeOrDateTime(lastActive)

    // Frame alignment: all bordered lines share the same width
    const borderedLines = lines.filter(
      (line) => line.startsWith("┌") || line.startsWith("└") || line.startsWith("├") || line.startsWith("│"),
    )
    expect(borderedLines.every((line) => line.length === headerWidth)).toBe(true)

    // No ellipsis truncation
    expect(lines.some((line) => line.includes("..."))).toBe(false)

    // Last active uses shared Locale formatting
    expect(lines.some((line) => line.includes(formattedTime))).toBe(true)

    // Path appears fully (start and end segments present across wrapped lines)
    expect(lines.join("")).toContain(longPath.slice(0, 20))
    expect(lines.join("")).toContain(longPath.slice(-20))
  })
})
