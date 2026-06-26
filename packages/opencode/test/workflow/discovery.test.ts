import { describe, expect, it } from "bun:test"
import { discoverWorkflows, workflowTemplate } from "../../src/workflow/discovery"
import { tmpdir } from "../fixture/fixture"

describe("workflow discovery", () => {
  it("discovers workflow .js files from .opencode/workflows/", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const { mkdir, writeFile } = await import("node:fs/promises")
        const workflowsDir = `${dir}/.opencode/workflows`
        await mkdir(workflowsDir, { recursive: true })
        await writeFile(`${workflowsDir}/test-workflow.js`, "// test workflow\nreturn 'hello'", "utf-8")
        await writeFile(`${workflowsDir}/another.js`, "// another\nreturn 'world'", "utf-8")
      },
    })

    const results = await discoverWorkflows([tmp.path])
    expect(results.length).toBe(2)
    const names = results.map((r) => r.name).sort()
    expect(names).toEqual(["another", "test-workflow"])
  })

  it("extracts description from first comment line", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const { mkdir, writeFile } = await import("node:fs/promises")
        await mkdir(`${dir}/.opencode/workflows`, { recursive: true })
        await writeFile(`${dir}/.opencode/workflows/described.js`, "// My custom workflow\nreturn 'test'", "utf-8")
      },
    })

    const results = await discoverWorkflows([tmp.path])
    expect(results[0].description).toBe("My custom workflow")
  })

  it("uses default description when no comment present", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const { mkdir, writeFile } = await import("node:fs/promises")
        await mkdir(`${dir}/.opencode/workflows`, { recursive: true })
        await writeFile(`${dir}/.opencode/workflows/no-desc.js`, "return 'test'", "utf-8")
      },
    })

    const results = await discoverWorkflows([tmp.path])
    expect(results[0].description).toBe("workflow: no-desc")
  })

  it("workflowTemplate wraps script in XML tags", () => {
    const template = workflowTemplate("return 'hello'")
    expect(template).toContain("<workflow_script>")
    expect(template).toContain("</workflow_script>")
    expect(template).toContain("return 'hello'")
    expect(template).toContain("$ARGUMENTS")
  })

  it("handles empty workflows directory gracefully", async () => {
    await using tmp = await tmpdir()
    const results = await discoverWorkflows([tmp.path])
    expect(results).toEqual([])
  })

  it("deduplicates by name (project dir takes priority)", async () => {
    await using tmp1 = await tmpdir({
      init: async (dir) => {
        const { mkdir, writeFile } = await import("node:fs/promises")
        await mkdir(`${dir}/.opencode/workflows`, { recursive: true })
        await writeFile(`${dir}/.opencode/workflows/duplicate.js`, "// project version\nreturn 'project'", "utf-8")
      },
    })
    await using tmp2 = await tmpdir({
      init: async (dir) => {
        const { mkdir, writeFile } = await import("node:fs/promises")
        await mkdir(`${dir}/.opencode/workflows`, { recursive: true })
        await writeFile(`${dir}/.opencode/workflows/duplicate.js`, "// user version\nreturn 'user'", "utf-8")
      },
    })

    const results = await discoverWorkflows([tmp1.path, tmp2.path])
    expect(results.length).toBe(1)
    expect(results[0].script).toContain("project version")
  })
})
