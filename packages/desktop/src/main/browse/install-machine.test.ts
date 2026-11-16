import { describe, expect, test } from "bun:test"
import { browseInstallJob, initialBrowseInstallState, transitionBrowseInstall } from "./install-machine"

describe("browse install machine", () => {
  test("a second request while the installer runs starts no second installer", () => {
    const installing = transitionBrowseInstall(initialBrowseInstallState(), { type: "install.requested" })
    expect(installing.commands).toEqual([{ type: "run-install", attempt: 1 }])
    expect(browseInstallJob(installing.state)).toEqual({ status: "installing" })

    const again = transitionBrowseInstall(installing.state, { type: "install.requested" })
    expect(again.state).toBe(installing.state)
    expect(again.commands).toEqual([])
  })

  test("a failure stays until the next attempt, whose result alone counts", () => {
    const failure = { reason: "installer", detail: "Not connected yet" } as const
    const first = transitionBrowseInstall(initialBrowseInstallState(), { type: "install.requested" }).state
    const failed = transitionBrowseInstall(first, { type: "install.failed", attempt: 1, failure })
    expect(browseInstallJob(failed.state)).toEqual({ status: "failed", failure })

    const retry = transitionBrowseInstall(failed.state, { type: "install.requested" })
    expect(retry.commands).toEqual([{ type: "run-install", attempt: 2 }])

    const stale = transitionBrowseInstall(retry.state, { type: "install.succeeded", attempt: 1 })
    expect(stale.state).toBe(retry.state)

    const done = transitionBrowseInstall(retry.state, { type: "install.succeeded", attempt: 2 })
    expect(browseInstallJob(done.state)).toEqual({ status: "idle" })
  })

  test("disposal ignores the interrupted installer's result and later requests", () => {
    const installing = transitionBrowseInstall(initialBrowseInstallState(), { type: "install.requested" }).state
    const disposed = transitionBrowseInstall(installing, { type: "disposed" }).state

    expect(
      transitionBrowseInstall(disposed, { type: "install.failed", attempt: 1, failure: { reason: "timeout" } }).state,
    ).toBe(disposed)
    expect(transitionBrowseInstall(disposed, { type: "install.requested" }).commands).toEqual([])
  })
})
