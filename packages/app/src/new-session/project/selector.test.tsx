import { describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { PromptProjectControls } from "./selector"

mock.module("@/runtime/i18n/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

const { createPromptProjectController } = await import("./selector")

describe("new session project selection", () => {
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
