import { describe, expect, test } from "bun:test"
import {
  createProjectSettingsState,
  selectProjectSettingsView,
  transitionProjectSettings,
  type ProjectSettingsEffect,
  type ProjectSettingsEvent,
  type ProjectSettingsState,
  type ProjectSettingsTransition,
  type ProjectSnapshot,
} from "./project-machine"

const alpha: ProjectSnapshot = {
  id: "project-a",
  worktree: "/work/alpha",
  name: "Alpha",
  color: undefined,
  iconOverride: undefined,
  startup: undefined,
}

function replay(state: ProjectSettingsState, events: ProjectSettingsEvent[]) {
  const initial: ProjectSettingsTransition = { state, effects: [] }

  return events.reduce((current, event) => transitionProjectSettings(current.state, event), initial)
}

const saves = (effects: readonly ProjectSettingsEffect[]) => effects.filter((effect) => effect.type === "run-save")

describe("project settings autosave", () => {
  test("a timed out or failed save marks its field and the queue moves on to the next one", () => {
    const start = createProjectSettingsState(alpha)
    const sent = replay(start, [{ type: "name.edited", value: "Beta" }, { type: "name.committed" }])
    expect(saves(sent.effects)).toEqual([
      {
        type: "run-save",
        saveAttempt: 1,
        target: { id: "project-a", worktree: "/work/alpha" },
        patch: { name: "Beta" },
      },
    ])

    const queued = replay(sent.state, [
      { type: "color.selected", color: "pink" },
      { type: "startup.edited", value: "bun dev" },
      { type: "startup.committed" },
    ])

    expect(queued.effects).toEqual([])
    expect(selectProjectSettingsView(queued.state).busy).toBe(true)

    const timedOut = transitionProjectSettings(queued.state, {
      type: "save.timed-out",
      saveAttempt: 1,
      error: "Request failed",
    })

    expect(timedOut.effects).toEqual([
      { type: "toast-error", error: "Request failed" },
      {
        type: "run-save",
        saveAttempt: 2,
        target: { id: "project-a", worktree: "/work/alpha" },
        patch: { icon: { color: "pink", override: "" }, commands: { start: "bun dev" } },
      },
    ])
    expect(selectProjectSettingsView(timedOut.state).failed).toEqual({ name: true, icon: false, startup: false })
    // The hung request answers after its timeout: too late to count.
    expect(transitionProjectSettings(timedOut.state, { type: "save.succeeded", saveAttempt: 1 }).state).toBe(
      timedOut.state,
    )

    const failed = transitionProjectSettings(timedOut.state, { type: "save.failed", saveAttempt: 2, error: "500" })
    expect(failed.state.status).toBe("idle")
    expect(selectProjectSettingsView(failed.state)).toMatchObject({
      busy: false,
      name: "Beta",
      color: "pink",
      startup: "bun dev",
      failed: { name: true, icon: true, startup: true },
    })
  })

  test("a failed color can be sent again, and a later success clears the error", () => {
    const failed = replay(createProjectSettingsState(alpha), [
      { type: "color.selected", color: "blue" },
      { type: "save.failed", saveAttempt: 1, error: "Offline" },
    ])

    expect(selectProjectSettingsView(failed.state)).toMatchObject({ color: "blue", failed: { icon: true } })

    const retried = transitionProjectSettings(failed.state, { type: "field.retried", field: "icon" })
    expect(saves(retried.effects)).toEqual([
      {
        type: "run-save",
        saveAttempt: 2,
        target: { id: "project-a", worktree: "/work/alpha" },
        patch: { icon: { color: "blue", override: "" } },
      },
    ])
    expect(selectProjectSettingsView(retried.state).failed.icon).toBe(false)

    const saved = transitionProjectSettings(retried.state, { type: "save.succeeded", saveAttempt: 2 })
    expect(saved.state).toMatchObject({ status: "idle", saved: { icon: { color: "blue", override: "" } }, failed: [] })
    expect(transitionProjectSettings(saved.state, { type: "field.retried", field: "icon" }).state).toBe(saved.state)
  })

  test("reverting a name while its save is in flight still queues the revert", () => {
    const reverted = replay(createProjectSettingsState(alpha), [
      { type: "name.edited", value: "Beta" },
      { type: "name.committed" },
      { type: "name.edited", value: "Alpha" },
      { type: "name.committed" },
      { type: "save.succeeded", saveAttempt: 1 },
    ])

    expect(saves(reverted.effects)).toEqual([
      {
        type: "run-save",
        saveAttempt: 2,
        target: { id: "project-a", worktree: "/work/alpha" },
        patch: { name: "Alpha" },
      },
    ])
  })

  test("colors picked during a save merge into one queued write", () => {
    const picked = replay(createProjectSettingsState(alpha), [
      { type: "name.edited", value: "Beta" },
      { type: "name.committed" },
      { type: "color.selected", color: "pink" },
      { type: "color.selected", color: "blue" },
      { type: "color.selected", color: "mint" },
      { type: "save.succeeded", saveAttempt: 1 },
    ])

    expect(saves(picked.effects)).toEqual([
      {
        type: "run-save",
        saveAttempt: 2,
        target: { id: "project-a", worktree: "/work/alpha" },
        patch: { icon: { color: "mint", override: "" } },
      },
    ])
  })

  test("committing an unchanged field sends nothing", () => {
    const start = createProjectSettingsState(alpha)

    expect(transitionProjectSettings(start, { type: "name.committed" }).state).toBe(start)
    expect(transitionProjectSettings(start, { type: "startup.committed" }).state).toBe(start)
  })

  test("a name equal to the folder name is saved as no name", () => {
    const folder = replay(createProjectSettingsState(alpha), [
      { type: "name.edited", value: " alpha " },
      { type: "name.committed" },
    ])

    expect(saves(folder.effects)[0]).toMatchObject({ patch: { name: "" } })
  })

  test("moving to another project drops the previous project's drafts and late results", () => {
    const file = new File(["x"], "icon.png", { type: "image/png" })

    const busy = replay(createProjectSettingsState(alpha), [
      { type: "name.edited", value: "Beta" },
      { type: "name.committed" },
      { type: "icon.file-selected", file },
    ])

    expect(busy.effects).toEqual([{ type: "read-icon", attempt: 2, file }])

    const moved = transitionProjectSettings(busy.state, {
      type: "project.synced",
      project: { ...alpha, id: "project-b", worktree: "/work/bravo", name: undefined },
    })

    expect(moved.effects).toEqual([{ type: "abort-icon-read" }])
    expect(moved.state).toMatchObject({ status: "idle", target: { id: "project-b" }, draft: { name: "bravo" } })

    const late = replay(moved.state, [
      { type: "save.succeeded", saveAttempt: 1 },
      { type: "save.failed", saveAttempt: 1, error: "500" },
      { type: "icon.file-loaded", attempt: 2, dataUrl: "data:image/png;base64,eA==" },
    ])

    expect(late.state).toBe(moved.state)
  })

  test("moving to another project still sends the previous project's queued commits to it", () => {
    const queued = replay(createProjectSettingsState(alpha), [
      { type: "name.edited", value: "Beta" },
      { type: "name.committed" },
      { type: "startup.edited", value: "bun dev" },
      { type: "startup.committed" },
    ])

    const moved = transitionProjectSettings(queued.state, {
      type: "project.synced",
      project: { ...alpha, id: "project-b", worktree: "/work/bravo" },
    })

    expect(moved.effects).toEqual([
      {
        type: "flush",
        target: { id: "project-a", worktree: "/work/alpha" },
        patch: { commands: { start: "bun dev" } },
      },
    ])
    expect(moved.state).toMatchObject({ status: "idle", target: { id: "project-b" } })
  })

  test("the same project syncing again keeps the drafts", () => {
    const edited = transitionProjectSettings(createProjectSettingsState(alpha), { type: "name.edited", value: "Beta" })

    expect(transitionProjectSettings(edited.state, { type: "project.synced", project: alpha }).state).toBe(edited.state)
  })

  test("a custom icon read after it was cleared is dropped", () => {
    const file = new File(["x"], "icon.png", { type: "image/png" })

    const cleared = replay(createProjectSettingsState({ ...alpha, iconOverride: "data:old" }), [
      { type: "icon.file-selected", file },
      { type: "icon.cleared" },
    ])

    expect(cleared.effects).toEqual([
      { type: "abort-icon-read" },
      {
        type: "run-save",
        saveAttempt: 2,
        target: { id: "project-a", worktree: "/work/alpha" },
        patch: { icon: { color: "", override: "" } },
      },
    ])

    const late = transitionProjectSettings(cleared.state, { type: "icon.file-loaded", attempt: 1, dataUrl: "data:new" })
    expect(late.state).toBe(cleared.state)
  })

  test("a loaded image becomes the icon and is saved", () => {
    const file = new File(["x"], "icon.png", { type: "image/png" })

    const loaded = replay(createProjectSettingsState(alpha), [
      { type: "icon.drag-over" },
      { type: "icon.file-selected", file },
      { type: "icon.file-loaded", attempt: 1, dataUrl: "data:new" },
    ])

    expect(selectProjectSettingsView(loaded.state)).toMatchObject({ iconOverride: "data:new", dragOver: false })
    expect(saves(loaded.effects)[0]).toMatchObject({ patch: { icon: { color: "", override: "data:new" } } })
  })

  test("closing the page with commits queued flushes them after the save in flight", () => {
    const closed = replay(createProjectSettingsState(alpha), [
      { type: "name.edited", value: "Beta" },
      { type: "name.committed" },
      { type: "startup.edited", value: "bun dev" },
      { type: "startup.committed" },
      { type: "disposed" },
    ])

    expect(closed.state).toEqual({ status: "disposed" })
    expect(closed.effects).toEqual([
      {
        type: "flush",
        target: { id: "project-a", worktree: "/work/alpha" },
        patch: { commands: { start: "bun dev" } },
      },
    ])
    expect(transitionProjectSettings(closed.state, { type: "save.succeeded", saveAttempt: 1 }).state).toBe(closed.state)
  })

  test("editing a failed field clears its error until the next commit", () => {
    const failed = replay(createProjectSettingsState(alpha), [
      { type: "name.edited", value: "Beta" },
      { type: "name.committed" },
      { type: "save.failed", saveAttempt: 1, error: "500" },
      { type: "name.edited", value: "Beta 2" },
    ])

    expect(selectProjectSettingsView(failed.state).failed.name).toBe(false)
  })
})
