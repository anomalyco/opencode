import { describe, expect, test } from "bun:test"
import { mergeJobList } from "./background"

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
