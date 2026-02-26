import { describe, expect, test } from "bun:test"
import { projectIconStatus, projectSelected, projectTileActive } from "./sidebar-project-helpers"

describe("projectSelected", () => {
  test("matches direct worktree", () => {
    expect(projectSelected("/tmp/root", "/tmp/root")).toBe(true)
  })

  test("matches sandbox worktree", () => {
    expect(projectSelected("/tmp/branch", "/tmp/root", ["/tmp/branch"])).toBe(true)
    expect(projectSelected("/tmp/other", "/tmp/root", ["/tmp/branch"])).toBe(false)
  })
})

describe("projectTileActive", () => {
  test("menu state always wins", () => {
    expect(
      projectTileActive({
        menu: true,
        preview: false,
        open: false,
        overlay: false,
        worktree: "/tmp/root",
      }),
    ).toBe(true)
  })

  test("preview mode uses open state", () => {
    expect(
      projectTileActive({
        menu: false,
        preview: true,
        open: true,
        overlay: true,
        hoverProject: "/tmp/other",
        worktree: "/tmp/root",
      }),
    ).toBe(true)
  })

  test("overlay mode uses hovered project", () => {
    expect(
      projectTileActive({
        menu: false,
        preview: false,
        open: false,
        overlay: true,
        hoverProject: "/tmp/root",
        worktree: "/tmp/root",
      }),
    ).toBe(true)
    expect(
      projectTileActive({
        menu: false,
        preview: false,
        open: false,
        overlay: true,
        hoverProject: "/tmp/other",
        worktree: "/tmp/root",
      }),
    ).toBe(false)
  })
})

describe("projectIconStatus", () => {
  test("defaults to idle", () => {
    expect(projectIconStatus({ pending: false, errored: false, completed: false, running: false })).toBe("idle")
  })

  test("returns running when only running exists", () => {
    expect(projectIconStatus({ pending: false, errored: false, completed: false, running: true })).toBe("running")
  })

  test("returns completed over running", () => {
    expect(projectIconStatus({ pending: false, errored: false, completed: true, running: true })).toBe("completed")
  })

  test("returns errored over completed and running", () => {
    expect(projectIconStatus({ pending: false, errored: true, completed: true, running: true })).toBe("errored")
  })

  test("returns pending above all other states", () => {
    expect(projectIconStatus({ pending: true, errored: true, completed: true, running: true })).toBe("pending")
  })
})
