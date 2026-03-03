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

  test("converts concealed file URL format to markdown link", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, ".agents")
    await Bun.write(target, "")

    const result = localLink(`Path .agents/ (file://${target})`, tmp.path)
    expect(result).toBe(`Path [.agents/](file://${target})`)
  })

  test("converts concealed file URL format in multiline lists", async () => {
    await using tmp = await tmpdir()
    const root = tmp.path
    const dir = path.join(root, ".agents")
    await Bun.write(dir, "")
    const input = `Here are files in ${root} (file://${root}):\n- .agents/ (file://${dir})\n- README.md`
    const result = localLink(input, root)
    expect(result).toContain(`[${root}](file://${root})`)
    expect(result).toContain(`- [.agents/](file://${dir})`)
  })
})
