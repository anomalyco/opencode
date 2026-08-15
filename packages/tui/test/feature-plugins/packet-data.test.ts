import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { loadPacket } from "../../src/feature-plugins/sidebar/packet-data"

const hiringFixture = path.resolve(import.meta.dir, "../../../moks/src/product/fixtures/hiring")

describe("loadPacket", () => {
  test("lists both reqs at a company root", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-packet-"))
    await writeFile(path.join(dir, "HIRING.md"), "# Northline\n")
    await mkdir(path.join(dir, "senior-backend"), { recursive: true })
    await mkdir(path.join(dir, "staff-platform"), { recursive: true })
    await writeFile(path.join(dir, "senior-backend", "HIRING.md"), "# Senior Backend\n")
    await writeFile(path.join(dir, "staff-platform", "HIRING.md"), "# Staff Platform\n")

    const packet = await loadPacket(dir)
    expect(packet?.companyTitle).toBe("Northline")
    expect(packet?.reqs.map((req) => req.slug)).toEqual(["senior-backend", "staff-platform"])
    expect(packet?.reqs.every((req) => !req.focused)).toBe(true)
    expect(packet?.packet).toBeUndefined()
  })

  test("hiring fixture shows Jordan Lee as sourced", async () => {
    const packet = await loadPacket(hiringFixture)
    expect(packet?.companyTitle).toBe("Senior Backend Engineer")
    expect(packet?.reqs).toEqual([
      { slug: "hiring", title: "Senior Backend Engineer", focused: true },
    ])
    expect(packet?.packet?.title).toBe("Senior Backend Engineer")
    expect(packet?.packet?.candidates[0]?.id).toBe("jordan-lee")
    expect(packet?.packet?.candidates[0]?.stage).toBe("sourced")
  })

  test("empty focused req has no candidates", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "moks-packet-"))
    await writeFile(path.join(dir, "HIRING.md"), "# Northline\n")
    await mkdir(path.join(dir, "new-req", "candidates"), { recursive: true })
    await writeFile(path.join(dir, "new-req", "HIRING.md"), "# New Role\n")
    await writeFile(path.join(dir, "new-req", "candidates", ".gitkeep"), "")
    await mkdir(path.join(dir, ".moks"), { recursive: true })
    await writeFile(path.join(dir, ".moks", "focus"), "new-req\n")

    const packet = await loadPacket(dir)
    expect(packet?.reqs.map((req) => ({ slug: req.slug, focused: req.focused }))).toEqual([
      { slug: "new-req", focused: true },
    ])
    expect(packet?.packet?.title).toBe("New Role")
    expect(packet?.packet?.candidates).toEqual([])
  })
})
