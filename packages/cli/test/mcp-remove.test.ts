import { expect, test } from "bun:test"
import path from "node:path"
import { parse } from "jsonc-parser"
import { removeMcpConfig } from "../src/commands/handlers/mcp/remove"

test("removes a server from the mcp.servers shape without replacing unrelated settings", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "opencode.jsonc")
  await Bun.write(
    file,
    '{\n  // retained\n  "model": "provider/model",\n  "mcp": {\n    "servers": {\n      // docs\n      "remove-me": { "type": "remote", "url": "https://example.com/mcp" },\n      "keep-me": { "type": "local", "command": ["npx"] }\n    }\n  }\n}\n',
  )

  try {
    expect(await removeMcpConfig(file, "remove-me")).toBe(true)
    expect(await removeMcpConfig(file, "remove-me")).toBe(false)
    const text = await Bun.file(file).text()
    expect(text).toContain("// retained")
    expect(parse(text)).toEqual({
      model: "provider/model",
      mcp: { servers: { "keep-me": { type: "local", command: ["npx"] } } },
    })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("removes a server from the legacy flat mcp shape", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "opencode.json")
  await Bun.write(
    file,
    '{\n  // retained\n  "mcp": {\n    "remove-me": { "type": "remote", "url": "https://example.com/mcp" },\n    "keep-me": { "type": "local", "command": ["npx"] }\n  }\n}\n',
  )

  try {
    expect(await removeMcpConfig(file, "remove-me")).toBe(true)
    expect(await removeMcpConfig(file, "remove-me")).toBe(false)
    const text = await Bun.file(file).text()
    expect(text).toContain("// retained")
    expect(parse(text)).toEqual({
      mcp: { "keep-me": { type: "local", command: ["npx"] } },
    })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("returns false for missing files and configs without the server", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const missing = path.join(directory, "missing.json")
  const file = path.join(directory, "opencode.json")
  await Bun.write(file, '{ "model": "provider/model" }')

  try {
    expect(await removeMcpConfig(missing, "some-server")).toBe(false)
    expect(await removeMcpConfig(file, "some-server")).toBe(false)
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})
