import { describe, expect, mock, test } from "bun:test"

mock.module("open", () => ({
  default: async () => {},
}))

import { activateSession, resolveSession } from "../../src/cli/cmd/run"

describe("run session selection", () => {
  test("returns an existing root session and marks it for resume", async () => {
    const list = mock(async () => ({
      data: [
        { id: "ses_child", parentID: "ses_root" },
        { id: "ses_root", parentID: undefined },
      ],
    }))
    const fork = mock(async () => ({ data: { id: "ses_fork" } }))
    const create = mock(async () => ({ data: { id: "ses_new" } }))
    const sdk = {
      session: {
        list,
        fork,
        create,
      },
    } as unknown as Parameters<typeof resolveSession>[0]["sdk"]

    const result = await resolveSession({
      args: { continue: true, fork: false },
      sdk,
      title: "hi",
      rules: [],
    })

    expect(result).toEqual({ id: "ses_root", resume: true })
    expect(list).toHaveBeenCalledTimes(1)
    expect(fork).toHaveBeenCalledTimes(0)
    expect(create).toHaveBeenCalledTimes(0)
  })

  test("forks the selected session without resuming it", async () => {
    const fork = mock(async () => ({ data: { id: "ses_fork" } }))
    const create = mock(async () => ({ data: { id: "ses_new" } }))
    const sdk = {
      session: {
        list: mock(async () => ({ data: [] })),
        fork,
        create,
      },
    } as unknown as Parameters<typeof resolveSession>[0]["sdk"]

    const result = await resolveSession({
      args: { continue: false, fork: true, session: "ses_base" },
      sdk,
      title: "hi",
      rules: [],
    })

    expect(result).toEqual({ id: "ses_fork", resume: false })
    expect(fork).toHaveBeenCalledWith({ sessionID: "ses_base" })
    expect(create).toHaveBeenCalledTimes(0)
  })

  test("creates a new session when no base session exists", async () => {
    const rules = [{ permission: "question", action: "deny", pattern: "*" }] as const
    const create = mock(async () => ({ data: { id: "ses_new" } }))
    const sdk = {
      session: {
        list: mock(async () => ({ data: [] })),
        fork: mock(async () => ({ data: { id: "ses_fork" } })),
        create,
      },
    } as unknown as Parameters<typeof resolveSession>[0]["sdk"]

    const result = await resolveSession({
      args: { continue: false, fork: false },
      sdk,
      title: "picked title",
      rules: [...rules],
    })

    expect(result).toEqual({ id: "ses_new", resume: false })
    expect(create).toHaveBeenCalledWith({ title: "picked title", permission: [...rules] })
  })
})

describe("run session activation", () => {
  test("resumes existing sessions before use", async () => {
    const resume = mock(async () => true)
    const sdk = {
      session: { resume },
    } as unknown as Parameters<typeof activateSession>[0]["sdk"]

    const sessionID = await activateSession({
      sdk,
      result: { id: "ses_root", resume: true },
    })

    expect(sessionID).toBe("ses_root")
    expect(resume).toHaveBeenCalledWith({ sessionID: "ses_root" })
  })

  test("does not resume new sessions", async () => {
    const resume = mock(async () => true)
    const sdk = {
      session: { resume },
    } as unknown as Parameters<typeof activateSession>[0]["sdk"]

    const sessionID = await activateSession({
      sdk,
      result: { id: "ses_new", resume: false },
    })

    expect(sessionID).toBe("ses_new")
    expect(resume).toHaveBeenCalledTimes(0)
  })
})
