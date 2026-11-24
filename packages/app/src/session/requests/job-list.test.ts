import { describe, expect, test } from "bun:test"
import type { JobInfo } from "@opencode/client/promise"
import { jobOutsideFamily, mergeJobList } from "./background"

const job = (id: string, status: string) => ({ id, status })

describe("mergeJobList", () => {
  test("drops a listed job that settled while the list loaded", () => {
    const jobs = mergeJobList([job("job_a", "running")], new Map([["job_a", job("job_a", "completed")]]))

    expect([...jobs.keys()]).toEqual([])
  })

  test("keeps a job that started while the list loaded", () => {
    const jobs = mergeJobList([job("job_a", "running")], new Map([["job_b", job("job_b", "running")]]))

    expect([...jobs.keys()]).toEqual(["job_a", "job_b"])
  })
})

describe("jobOutsideFamily", () => {
  const shell = (sessionID: string): JobInfo => ({
    kind: "shell",
    id: "sh_" + sessionID,
    sessionID,
    status: "running",
    time: { started: 0 },
    shellID: "sh_" + sessionID,
    command: "bun test",
  })

  const subagent = (sessionID: string, childSessionID: string): JobInfo => ({
    kind: "subagent",
    id: "job_" + childSessionID,
    sessionID,
    childSessionID,
    status: "running",
    time: { started: 0 },
    agent: "general",
    description: "Look at the file",
  })

  const family = ["root", "child"]
  const known = (sessionID: string) => sessionID !== "new"

  test.each([
    ["the open session's own job", shell("root"), false],
    ["a job of a session below it", shell("child"), false],
    ["a job of a known session of another family", shell("other"), true],
    ["a job of a session with no record yet", shell("new"), false],
    ["a subagent of another family", subagent("other", "elsewhere"), true],
    ["a subagent whose child is in the family", subagent("other", "child"), false],
    ["a subagent just made by the open session", subagent("root", "new"), false],
  ])("%s", (_name, job, outside) => {
    expect(jobOutsideFamily(job, family, known)).toBe(outside)
  })
})
