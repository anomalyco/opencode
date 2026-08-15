import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { countCards, formatReqStatus, readReqTitle } from "../../src/component/prompt/req-status"

describe("req-status", () => {
  test("reads the first HIRING.md H1", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-req-"))
    await writeFile(path.join(dir, "HIRING.md"), "# Senior Backend Engineer\n\n## Role\n")
    expect(await readReqTitle(dir)).toBe("Senior Backend Engineer")
  })

  test("falls back to the directory name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-req-"))
    expect(await readReqTitle(dir)).toBe(path.basename(dir))
  })

  test("counts candidate cards and skips .gitkeep", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-req-"))
    await mkdir(path.join(dir, "candidates"))
    await writeFile(path.join(dir, "candidates", "jordan-lee.md"), "")
    await writeFile(path.join(dir, "candidates", "alex.md"), "")
    await writeFile(path.join(dir, "candidates", ".gitkeep"), "")
    expect(await countCards(dir)).toBe(2)
  })

  test("formats the session footer line", () => {
    expect(
      formatReqStatus({ title: "Senior Backend Engineer", cards: 3, unpushed: 1, agent: "recruit" }),
    ).toBe("Senior Backend Engineer · 3 cards · 1 unpushed · recruit")
    expect(formatReqStatus({ title: "Senior Backend Engineer", cards: 3, agent: "recruit" })).toBe(
      "Senior Backend Engineer · 3 cards · recruit",
    )
    expect(formatReqStatus({ title: "Senior Backend Engineer", cards: 1, unpushed: 0, agent: "recruit" })).toBe(
      "Senior Backend Engineer · 1 card · 0 unpushed · recruit",
    )
  })
})
