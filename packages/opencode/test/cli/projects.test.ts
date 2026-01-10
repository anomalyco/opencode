import { describe, expect, test } from "bun:test"
import { displayProjectStats } from "../../src/cli/cmd/projects"
import type { Project } from "../../src/project/project"
import { Locale } from "../../src/util/locale"

describe("cli projects", () => {
  const createProject = (id: string, worktree: string, timestamp?: number): Project.Info => {
    const timeValue = timestamp ?? Date.UTC(2024, 0, 1, 12, 30)
    return {
      id,
      worktree,
      vcs: "git",
      sandboxes: [],
      time: {
        created: timeValue,
        updated: timeValue,
      },
    }
  }

  test("renders full path with wrapping and aligned frame", () => {
    const lines: string[] = []
    const collect = (...message: string[]) => {
      lines.push(...message)
    }

    const lastActive = Date.UTC(2024, 0, 1, 12, 30)
    const longPath = "/very/long/path/to/a/project/that/should/wrap/without/ellipsis/because/we/want/full/visibility"
    const project = createProject("proj-1", longPath, lastActive)

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

    expect(lines.length).toBeGreaterThan(0)
    const headerWidth = lines[0].length
    const formattedTime = Locale.todayTimeOrDateTime(lastActive)

    const borderedLines = lines.filter(
      (line) => line.startsWith("┌") || line.startsWith("└") || line.startsWith("├") || line.startsWith("│"),
    )
    expect(borderedLines.every((line) => line.length === headerWidth)).toBe(true)

    expect(lines.some((line) => line.includes("..."))).toBe(false)
    expect(lines.some((line) => line.includes(formattedTime))).toBe(true)
    expect(lines.join("")).toContain(longPath.slice(0, 20))
    expect(lines.join("")).toContain(longPath.slice(-20))
  })

  test("renders empty state when no projects", () => {
    const lines: string[] = []
    const collect = (...message: string[]) => {
      lines.push(...message)
    }

    displayProjectStats([], {}, collect, { width: 90 })

    const headerWidth = lines[0].length
    const borderedLines = lines.filter(
      (line) => line.startsWith("┌") || line.startsWith("└") || line.startsWith("├") || line.startsWith("│"),
    )

    expect(lines.some((line) => line.includes("No projects found"))).toBe(true)
    expect(lines.some((line) => line.startsWith("Total:"))).toBe(false)
    expect(borderedLines.every((line) => line.length === headerWidth)).toBe(true)
  })

  test("handles multiple projects with varied paths and totals", () => {
    const lines: string[] = []
    const collect = (...message: string[]) => {
      lines.push(...message)
    }

    const shortPath = "/short"
    const mediumPath = "/some/medium/path/that/stays/on_one_line"
    const longPath =
      "/projects/with/a/much/longer/path/that/should/wrap/to_multiple_lines/for_display/without_truncation"

    const firstActive = Date.UTC(2024, 0, 2, 10, 0)
    const secondActive = Date.UTC(2024, 0, 3, 15, 45)
    const thirdActive = Date.UTC(2024, 0, 4, 8, 15)

    displayProjectStats(
      [
        {
          project: createProject("proj-1", shortPath, firstActive),
          sessionCount: 1,
          lastActive: firstActive,
          worktreeExists: true,
        },
        {
          project: createProject("proj-2", mediumPath, secondActive),
          sessionCount: 5,
          lastActive: secondActive,
          worktreeExists: true,
        },
        {
          project: createProject("proj-3", longPath, thirdActive),
          sessionCount: 3,
          lastActive: thirdActive,
          worktreeExists: true,
        },
      ],
      {},
      collect,
      { width: 90 },
    )

    const joined = lines.join("")
    const totalLine = "Total: 3 projects, 9 sessions"

    expect(joined).toContain(shortPath)
    expect(joined).toContain(mediumPath)
    expect(joined).toContain(longPath.slice(0, 25))
    expect(joined).toContain(longPath.slice(-25))
    expect(joined).toContain(totalLine)
  })

  test("shows never when last active is missing", () => {
    const lines: string[] = []
    const collect = (...message: string[]) => {
      lines.push(...message)
    }

    const project = createProject("proj-4", "/no/sessions")

    displayProjectStats(
      [
        {
          project,
          sessionCount: 0,
          lastActive: null,
          worktreeExists: true,
        },
      ],
      {},
      collect,
      { width: 90 },
    )

    const joined = lines.join("")

    expect(joined).toContain("0")
    expect(joined).toContain("never")
  })

  test("clamps narrow widths and preserves frame", () => {
    const lines: string[] = []
    const collect = (...message: string[]) => {
      lines.push(...message)
    }

    const longPath = "/a/path/that/will/wrap/when/clamped"

    displayProjectStats(
      [
        {
          project: createProject("proj-5", longPath),
          sessionCount: 2,
          lastActive: Date.UTC(2024, 0, 5, 9, 0),
          worktreeExists: true,
        },
      ],
      {},
      collect,
      { width: 40 },
    )

    const headerWidth = lines[0].length
    const borderedLines = lines.filter(
      (line) => line.startsWith("┌") || line.startsWith("└") || line.startsWith("├") || line.startsWith("│"),
    )

    expect(headerWidth).toBe(80)
    expect(borderedLines.every((line) => line.length === headerWidth)).toBe(true)
    expect(lines.some((line) => line.includes("..."))).toBe(false)
  })
})
