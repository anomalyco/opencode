import { describe, expect, test } from "bun:test"
import { createJobList, mergeJobList } from "./background"

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

describe("createJobList", () => {
  const setup = () => {
    let jobs: ReadonlyMap<string, { id: string; status: string }> = new Map()

    return {
      list: createJobList<{ id: string; status: string }>((next) => (jobs = next)),
      jobs: () => [...jobs.keys()],
    }
  }

  test("a reload after a reconnect drops a job whose settled event was missed", async () => {
    const state = setup()
    await state.list.load(async () => [job("job_a", "running")])
    expect(state.jobs()).toEqual(["job_a"])

    await state.list.load(async () => [])
    expect(state.jobs()).toEqual([])
  })

  test("an event during the reload wins over its stale response", async () => {
    const state = setup()
    await state.list.load(async () => [job("job_a", "running")])

    const { promise, resolve } = Promise.withResolvers<{ id: string; status: string }[]>()
    const reload = state.list.load(() => promise)
    state.list.update(job("job_a", "completed"))
    state.list.update(job("job_b", "running"))
    resolve([job("job_a", "running")])
    await reload

    expect(state.jobs()).toEqual(["job_b"])
  })
})
