import { beforeEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"
import { McpAuth } from "../../src/mcp/auth"

const localAuth = path.join(Global.Path.data, "auth.json")
const legacyAuth = path.join(Global.Path.legacy.data, "auth.json")
const localMcpAuth = path.join(Global.Path.data, "mcp-auth.json")
const legacyMcpAuth = path.join(Global.Path.legacy.data, "mcp-auth.json")

beforeEach(async () => {
  await fs.mkdir(Global.Path.data, { recursive: true })
  await fs.mkdir(Global.Path.legacy.data, { recursive: true })
  await fs.rm(localAuth, { force: true })
  await fs.rm(legacyAuth, { force: true })
  await fs.rm(localMcpAuth, { force: true })
  await fs.rm(legacyMcpAuth, { force: true })
})

test("auth falls back to legacy opencode credentials", async () => {
  await Bun.write(
    legacyAuth,
    JSON.stringify(
      {
        openai: {
          type: "api",
          key: "legacy-key",
        },
      },
      null,
      2,
    ),
  )

  const creds = await Auth.all()

  expect(creds.openai).toBeDefined()
  expect(creds.openai?.type).toBe("api")
  if (creds.openai?.type === "api") {
    expect(creds.openai.key).toBe("legacy-key")
  }
})

test("local ohmycode credentials override legacy credentials", async () => {
  await Bun.write(
    legacyAuth,
    JSON.stringify(
      {
        openai: {
          type: "api",
          key: "legacy-key",
        },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    localAuth,
    JSON.stringify(
      {
        openai: {
          type: "api",
          key: "local-key",
        },
      },
      null,
      2,
    ),
  )

  const creds = await Auth.all()

  expect(creds.openai).toBeDefined()
  expect(creds.openai?.type).toBe("api")
  if (creds.openai?.type === "api") {
    expect(creds.openai.key).toBe("local-key")
  }
})

test("mcp auth falls back to legacy opencode credentials", async () => {
  await Bun.write(
    legacyMcpAuth,
    JSON.stringify(
      {
        github: {
          tokens: {
            accessToken: "legacy-token",
          },
        },
      },
      null,
      2,
    ),
  )

  const creds = await McpAuth.all()

  expect(creds.github).toBeDefined()
  expect(creds.github?.tokens?.accessToken).toBe("legacy-token")
})

test("local ohmycode mcp auth overrides legacy credentials", async () => {
  await Bun.write(
    legacyMcpAuth,
    JSON.stringify(
      {
        github: {
          tokens: {
            accessToken: "legacy-token",
          },
        },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    localMcpAuth,
    JSON.stringify(
      {
        github: {
          tokens: {
            accessToken: "local-token",
          },
        },
      },
      null,
      2,
    ),
  )

  const creds = await McpAuth.all()

  expect(creds.github).toBeDefined()
  expect(creds.github?.tokens?.accessToken).toBe("local-token")
})
