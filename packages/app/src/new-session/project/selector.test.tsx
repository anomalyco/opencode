import { describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { PromptProjectControls } from "./selector"

mock.module("@/runtime/i18n/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

const { createPromptProjectController } = await import("./selector")

describe("new session project selection", () => {
  test.each([
    { directory: "/repo/app-uat", worktree: "/repo/app-uat", canonical: "/repo/app-dev" },
    { directory: "C:\\repo\\app-uat", worktree: "C:/repo/app-uat", canonical: "C:/repo/app-dev" },
  ])("prefers an exact directory match over a shared sandbox for $directory", ({ directory, worktree, canonical }) => {
    const project = { id: "shared", worktree: canonical, sandboxes: [directory] }
    const sibling = { ...project, worktree }

    const controls: PromptProjectControls = {
      available: [project, sibling],
      directory,
      projectID: "shared",
      select() {},
      add() {},
    }

    createRoot((dispose) => {
      const controller = createPromptProjectController({ controls: () => controls, onDone() {} })
      expect(controller.selected()).toBe(sibling)
      dispose()
    })
  })

  test("falls back to a sandbox match when no directory matches exactly", () => {
    const generic = { id: "other", worktree: "/other" }
    const project = { id: "current", worktree: "/repo", sandboxes: ["/repo/feature"] }

    const controls: PromptProjectControls = {
      available: [generic, project],
      directory: "/repo/feature",
      select() {},
      add() {},
    }

    createRoot((dispose) => {
      const controller = createPromptProjectController({ controls: () => controls, onDone() {} })
      expect(controller.selected()).toBe(project)
      dispose()
    })
  })

  test("shows the current project's appearance before its worktree inventory loads", () => {
    const generic = { id: "other", worktree: "/other" }

    const current = {
      id: "current",
      worktree: "/repo",
      name: "My custom name",
      icon: { override: "data:image/png;base64,AAAA" },
    }

    const controls: PromptProjectControls = {
      available: [generic, current],
      directory: "/repo/.opencode/worktree/feature",
      projectID: "current",
      select() {},
      add() {},
    }

    createRoot((dispose) => {
      const controller = createPromptProjectController({ controls: () => controls, onDone() {} })
      expect(controller.selected()).toEqual(current)
      dispose()
    })
  })

  test("does not select a matching project ID from another server", () => {
    const remote = { id: "shared", worktree: "/remote", server: { key: "remote", name: "Remote" } }
    const local = { id: "shared", worktree: "/local", server: { key: "local", name: "Local" } }

    const controls: PromptProjectControls = {
      available: [remote, local],
      directory: "/local/feature",
      projectID: "shared",
      server: "local",
      select() {},
      add() {},
    }

    createRoot((dispose) => {
      const controller = createPromptProjectController({ controls: () => controls, onDone() {} })
      expect(controller.selected()).toEqual(local)
      dispose()
    })
  })
})
