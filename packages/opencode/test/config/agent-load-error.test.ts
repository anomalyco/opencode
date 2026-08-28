import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ConfigAgent } from "@/config/agent"
import { tmpdir } from "../fixture/fixture"

async function writeAgent(dir: string, name: string, content: string) {
  const agentsDir = path.join(dir, "agents")
  await fs.mkdir(agentsDir, { recursive: true })
  await Bun.write(path.join(agentsDir, name), content)
  return path.join(agentsDir, name)
}

test("reports YAML frontmatter parse failures", async () => {
  await using tmp = await tmpdir()
  const file = await writeAgent(
    tmp.path,
    "broken.md",
    "---\nmodel: test/model\nextra: foo: bar\ndescription: |\n  line\n x\n---\nBody",
  )

  const { agents, errors } = await ConfigAgent.load(tmp.path)

  expect(Object.keys(agents)).toEqual([])
  expect(errors.length).toBe(1)
  expect(errors[0].path).toBe(file)
  expect(errors[0].message).toContain("Failed to parse frontmatter")
})

test("reports schema validation failures", async () => {
  await using tmp = await tmpdir()
  const file = await writeAgent(
    tmp.path,
    "invalid.md",
    "---\nmode: invalid-value\n---\nBody",
  )

  const { agents, errors } = await ConfigAgent.load(tmp.path)

  expect(Object.keys(agents)).toEqual([])
  expect(errors.length).toBe(1)
  expect(errors[0].path).toBe(file)
  expect(errors[0].message).toContain("mode")
})

test("loads a valid agent markdown file", async () => {
  await using tmp = await tmpdir()
  const file = await writeAgent(
    tmp.path,
    "good.md",
    "---\nmodel: test/model\nmode: subagent\n---\nA helpful agent",
  )

  const { agents, errors } = await ConfigAgent.load(tmp.path)

  expect(errors).toEqual([])
  expect(agents.good).toMatchObject({
    name: "good",
    model: "test/model",
    mode: "subagent",
    prompt: "A helpful agent",
  })
})
