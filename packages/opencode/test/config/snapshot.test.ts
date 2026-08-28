import { expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { snapshot } from "./snapshot"

test("config snapshots ignore JSON formatting", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "output.json")
  await Bun.write(file, '{ "command": ["server", "--stdio"] }\n')
  await snapshot(file, JSON.stringify({ command: ["server", "--stdio"] }, null, 2))
})

test("config snapshots support JSONC comments and trailing commas", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "output.jsonc")
  await Bun.write(file, '{\n  // Expected config\n  "enabled": true,\n}\n')
  await snapshot(file, '{ /* Actual config */ "enabled": true }')
})

test("config snapshots reject different values", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "output.json")
  await Bun.write(file, '{ "enabled": true }')
  await expect(snapshot(file, '{ "enabled": false }')).rejects.toThrow()
})

test("config snapshots reject malformed JSONC", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "output.jsonc")
  await Bun.write(file, '{ "enabled": }')
  await expect(snapshot(file, '{ "enabled": }')).rejects.toThrow()
})
