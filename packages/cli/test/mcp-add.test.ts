import { expect, test } from "bun:test"
import path from "node:path"
import { parse } from "jsonc-parser"
import { writeMcpConfig } from "../src/commands/handlers/mcp/add"
import { tmpdir } from "./fixture/tmpdir"

const local = { type: "local", command: ["echo", "ok"] }

test("writes new MCP configs using the native servers map", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")

  await writeMcpConfig(file, "probe", local)

  expect(parse(await Bun.file(file).text())).toEqual({
    mcp: { servers: { probe: local } },
  })
})

test("preserves an existing legacy flat MCP map", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.jsonc")
  await Bun.write(
    file,
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        github: { type: "local", command: ["gh", "mcp"] },
      },
    }),
  )

  await writeMcpConfig(file, "probe", local)

  expect(parse(await Bun.file(file).text())).toEqual({
    $schema: "https://opencode.ai/config.json",
    mcp: {
      github: { type: "local", command: ["gh", "mcp"] },
      probe: local,
    },
  })
})

test("keeps native MCP configs nested", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.jsonc")
  await Bun.write(
    file,
    JSON.stringify({
      mcp: {
        servers: {
          github: { type: "local", command: ["gh", "mcp"] },
        },
      },
    }),
  )

  await writeMcpConfig(file, "probe", local)

  expect(parse(await Bun.file(file).text())).toEqual({
    mcp: {
      servers: {
        github: { type: "local", command: ["gh", "mcp"] },
        probe: local,
      },
    },
  })
})
