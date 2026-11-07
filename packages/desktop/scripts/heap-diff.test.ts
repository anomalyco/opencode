import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { compare, summarize } from "./heap-diff"

test("streams real Node heaps and reports added constructors and self-size", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-heap-diff-"))

  try {
    const before = path.join(directory, "before.heapsnapshot")
    const after = path.join(directory, "after.heapsnapshot")

    const child = Bun.spawn(
      [
        "node",
        "--input-type=module",
        "-e",
        `
      import { writeHeapSnapshot } from 'node:v8';
      class MémoireFixture { constructor() { this.payload = new Array(10).fill(42) } }
      const retained = [new MémoireFixture(), new MémoireFixture()];
      writeHeapSnapshot(process.argv[1]);
      retained.push(...Array.from({length: 25}, () => new MémoireFixture()));
      writeHeapSnapshot(process.argv[2]);
      console.log(retained.length);
    `,
        before,
        after,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )

    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
    expect((await new Response(child.stdout).text()).trim()).toBe("27")
    const a = await summarize(before)
    const b = await summarize(after)
    expect(a.get("object: MémoireFixture")?.count).toBe(2)
    expect(b.get("object: MémoireFixture")?.count).toBe(27)
    const delta = compare(a, b).find((row) => row.name === "object: MémoireFixture")
    expect(delta?.count).toBe(25)
    expect(delta?.bytes).toBeGreaterThan(0)
    expect(compare(b, a).find((row) => row.name === "object: MémoireFixture")?.count).toBe(-25)
    expect([...b.values()].reduce((sum, row) => sum + row.detached, 0)).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

test("detached DOM flags and legacy names survive chunk boundaries; truncated heaps fail", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-heap-dom-"))

  try {
    const file = path.join(directory, "dom.heapsnapshot")

    const fixture = JSON.stringify({
      snapshot: {
        node_count: 3,
        meta: {
          node_fields: ["name", "self_size", "type", "detachedness"],
          node_types: ["string", "number", ["native"], "number"],
        },
      },
      nodes: [1, 32, 0, 2, 2, 64, 0, 0, 3, 16, 0, 0],
      edges: [],
      strings: ["unused source \\".repeat(20_000), 'HTMLDivElement"é', "Detached HTMLSpanElement", "HTMLBodyElement"],
    })

    await Bun.write(file, fixture)
    const summary = await summarize(file)
    expect(summary.get('native: HTMLDivElement"é')).toEqual({ count: 1, bytes: 32, detached: 1 })
    expect(summary.get("native: Detached HTMLSpanElement")).toEqual({ count: 1, bytes: 64, detached: 1 })
    expect(summary.get("native: HTMLBodyElement")?.detached).toBe(0)
    await Bun.write(file, fixture.slice(0, -10))
    await expect(summarize(file)).rejects.toThrow("Incomplete heap string table")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
