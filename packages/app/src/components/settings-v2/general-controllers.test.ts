import { beforeAll, describe, expect, mock, test, vi } from "bun:test"
import { createRoot } from "solid-js"
import { createShellOptions, createSoundPreviewController } from "./general-controller-behavior"

let createPermissionScopeController: typeof import("./general-controllers").createPermissionScopeController

const autoAcceptDirectories = new Set<string>()
const autoAcceptSessions = new Map<string, boolean>()
const toggledDirectories: string[] = []
const enabledSessions: Array<{ sessionID: string; directory: string }> = []
const disabledSessions: Array<{ sessionID: string; directory: string }> = []

beforeAll(async () => {
  mock.module("@/context/permission", () => ({
    usePermission: () => ({
      isAutoAcceptingDirectory: (directory: string) => autoAcceptDirectories.has(directory),
      isAutoAccepting: (sessionID: string, directory?: string) => autoAcceptSessions.get(`${sessionID}/${directory}`) ?? false,
      toggleAutoAcceptDirectory: (directory: string) => {
        toggledDirectories.push(directory)
        if (autoAcceptDirectories.has(directory)) autoAcceptDirectories.delete(directory)
        else autoAcceptDirectories.add(directory)
      },
      enableAutoAccept: (sessionID: string, directory: string) => {
        enabledSessions.push({ sessionID, directory })
        autoAcceptSessions.set(`${sessionID}/${directory}`, true)
      },
      disableAutoAccept: (sessionID: string, directory: string) => {
        disabledSessions.push({ sessionID, directory })
        autoAcceptSessions.set(`${sessionID}/${directory}`, false)
      },
    }),
  }))

  createPermissionScopeController = (await import("./general-controllers")).createPermissionScopeController
})

describe("createPermissionScopeController", () => {
  test("is disabled and no-ops when no directory is in scope", () => {
    createRoot((dispose) => {
      const controller = createPermissionScopeController(
        () => undefined,
        () => undefined,
      )
      expect(controller.enabled()).toBe(false)
      expect(controller.accepting()).toBe(false)
      controller.set(true)
      expect(enabledSessions).toEqual([])
      dispose()
    })
  })

  test("falls back to directory-level auto-accept when no session is in scope", () => {
    // Regression test for https://github.com/anomalyco/opencode/issues/49721:
    // opening Settings without an active session (e.g. via the global keybind)
    // previously left the toggle permanently disabled because directory scope
    // was only ever derived from a session's lineage.
    createRoot((dispose) => {
      const directory = () => "/repo/main"
      expect(createPermissionScopeController(() => undefined, directory).enabled()).toBe(true)
      expect(createPermissionScopeController(() => undefined, directory).accepting()).toBe(false)

      createPermissionScopeController(() => undefined, directory).set(true)
      expect(toggledDirectories).toEqual(["/repo/main"])
      expect(createPermissionScopeController(() => undefined, directory).accepting()).toBe(true)

      dispose()
    })
  })

  test("scopes auto-accept to the session when one is in scope", () => {
    createRoot((dispose) => {
      const sessionID = () => "session-1"
      const directory = () => "/repo/other"

      createPermissionScopeController(sessionID, directory).set(true)
      expect(enabledSessions).toEqual([{ sessionID: "session-1", directory: "/repo/other" }])
      expect(createPermissionScopeController(sessionID, directory).accepting()).toBe(true)

      createPermissionScopeController(sessionID, directory).set(false)
      expect(disabledSessions).toEqual([{ sessionID: "session-1", directory: "/repo/other" }])
      expect(createPermissionScopeController(sessionID, directory).accepting()).toBe(false)

      dispose()
    })
  })
})

describe("settings v2 controllers", () => {
  test("normalizes shell names and preserves an unavailable configured shell", () => {
    expect(
      createShellOptions({
        shells: [
          { path: "/bin/bash", name: "bash", acceptable: true },
          { path: "/opt/bash", name: "bash", acceptable: false },
          { path: "/bin/zsh", name: "zsh", acceptable: true },
        ],
        current: "fish",
      }),
    ).toEqual([
      { id: "auto", value: "", name: "", terminalOnly: false },
      { id: "/bin/bash", value: "/bin/bash", name: "/bin/bash", terminalOnly: false },
      { id: "/opt/bash", value: "/opt/bash", name: "/opt/bash", terminalOnly: true },
      { id: "/bin/zsh", value: "zsh", name: "zsh", terminalOnly: false },
      { id: "fish", value: "fish", name: "fish", terminalOnly: false },
    ])
  })

  test("debounces previews and stops owned audio on disposal", async () => {
    vi.useFakeTimers()
    try {
      const played: string[] = []
      const stopped: string[] = []
      const owned = createRoot((dispose) => ({
        dispose,
        preview: createSoundPreviewController(async (id) => {
          played.push(id ?? "")
          return () => stopped.push(id ?? "")
        }),
      }))

      owned.preview.play("first")
      vi.advanceTimersByTime(99)
      expect(played).toEqual([])

      owned.preview.play("second")
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(played).toEqual(["second"])

      owned.dispose()
      expect(stopped).toEqual(["second"])
    } finally {
      vi.useRealTimers()
    }
  })
})
