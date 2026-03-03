import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { localLink } from "../../../src/cli/cmd/tui/util/local-link"

describe("localLink", () => {
  test("links existing relative file paths in code spans", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "plan_a/data/live_jobs_all.csv")
    await Bun.write(target, "id\n1\n")

    const result = localLink("Use `plan_a/data/live_jobs_all.csv`.", tmp.path)

    expect(result).toContain("[`plan_a/data/live_jobs_all.csv`](file://")
    expect(result).toContain("live_jobs_all.csv)")
  })

  test("does not link missing paths", async () => {
    await using tmp = await tmpdir()
    const result = localLink("Use `plan_a/data/live_jobs_all.csv`.", tmp.path)
    expect(result).toBe("Use `plan_a/data/live_jobs_all.csv`.")
  })

  test("does not relink existing markdown links", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "plan_a/data/live_jobs_all.csv")
    await Bun.write(target, "id\n1\n")
    const source = "Use [`plan_a/data/live_jobs_all.csv`](file:///tmp/live_jobs_all.csv)."
    const result = localLink(source, tmp.path)
    expect(result).toBe(source)
  })
})
