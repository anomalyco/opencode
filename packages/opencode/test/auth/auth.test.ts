import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Auth } from "../../src/auth"
import type { Auth as AuthType } from "../../src/auth"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs/promises"

function asApiAuth(info: AuthType.Info | undefined): { key: string } | undefined {
  return info as any
}

describe("auth multi-account", () => {
  let testAuthPath: string

  beforeEach(async () => {
    testAuthPath = path.join(Global.Path.data, "auth.json")
    await fs.rm(testAuthPath, { force: true }).catch(() => {})
  })

  afterEach(async () => {
    await fs.rm(testAuthPath, { force: true }).catch(() => {})
  })

  test("add creates first account as active", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const accountId = await Auth.add("openai", {
          type: "api",
          key: "sk-test-key",
        })

        const accounts = await Auth.list("openai")
        expect(accounts).toContain(accountId)
        expect(await Auth.getActiveAccount("openai")).toBe(accountId)
      },
    })
  })

  test("add second account does not change active account", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        const firstActive = await Auth.getActiveAccount("openai")

        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-2",
          },
          "work",
        )

        expect(await Auth.getActiveAccount("openai")).toBe(firstActive)
      },
    })
  })

  test("use changes active account", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-2",
          },
          "work",
        )

        await Auth.use("openai", "work")
        expect(await Auth.getActiveAccount("openai")).toBe("work")

        const creds = asApiAuth(await Auth.get("openai"))
        expect(creds?.key).toBe("sk-key-2")
      },
    })
  })

  test("remove non-active account preserves active", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-2",
          },
          "work",
        )

        await Auth.remove("openai", "work")
        expect(await Auth.getActiveAccount("openai")).toBe("default")
      },
    })
  })

  test("remove active account promotes another", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-2",
          },
          "work",
        )

        await Auth.use("openai", "work")
        await Auth.remove("openai", "work")

        const active = await Auth.getActiveAccount("openai")
        expect(active).toBeDefined()
        expect(active).toBe("default")
      },
    })
  })

  test("remove last account removes provider", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        await Auth.remove("openai", "default")

        const accounts = await Auth.list("openai")
        expect(accounts).toHaveLength(0)
      },
    })
  })

  test("get returns credentials for active account", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        const creds = asApiAuth(await Auth.get("openai"))
        expect(creds?.key).toBe("sk-key-1")
      },
    })
  })

  test("get accepts explicit account parameter", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-2",
          },
          "work",
        )

        await Auth.use("openai", "default")

        const creds = asApiAuth(await Auth.get("openai", "work"))
        expect(creds?.key).toBe("sk-key-2")
      },
    })
  })

  test("setEnabled can disable and enable accounts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-2",
          },
          "work",
        )

        await Auth.setEnabled("openai", "work", false)

        const creds = asApiAuth(await Auth.get("openai"))
        expect(creds?.key).toBe("sk-key-1")

        await Auth.setEnabled("openai", "work", true)
        await Auth.use("openai", "work")

        const creds2 = asApiAuth(await Auth.get("openai"))
        expect(creds2?.key).toBe("sk-key-2")
      },
    })
  })

  test("getAccounts returns all accounts for provider", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "default",
        )

        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-2",
          },
          "work",
        )

        const accounts = await Auth.getAccounts("openai")
        expect(Object.keys(accounts)).toHaveLength(2)
      },
    })
  })

  test("set with account parameter stores credentials under that account", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-key-1",
          },
          "work",
        )

        const creds = asApiAuth(await Auth.get("openai", "work"))
        expect(creds?.key).toBe("sk-key-1")
        expect(await Auth.getActiveAccount("openai")).toBe("work")
      },
    })
  })

  test("all returns all providers and accounts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Auth.set(
          "openai",
          {
            type: "api",
            key: "sk-openai",
          },
          "default",
        )

        await Auth.set(
          "anthropic",
          {
            type: "api",
            key: "sk-anthropic",
          },
          "default",
        )

        const all = await Auth.all()
        expect(all.openai).toBeDefined()
        expect(all.anthropic).toBeDefined()
        expect(Object.keys(all.openai.accounts)).toHaveLength(1)
        expect(Object.keys(all.anthropic.accounts)).toHaveLength(1)
      },
    })
  })
})

describe("auth legacy migration", () => {
  let testAuthPath: string

  beforeEach(async () => {
    testAuthPath = path.join(Global.Path.data, "auth.json")
    await fs.rm(testAuthPath, { force: true }).catch(() => {})
  })

  afterEach(async () => {
    await fs.rm(testAuthPath, { force: true }).catch(() => {})
  })

  test("migrates legacy format on read", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(
          testAuthPath,
          JSON.stringify({
            openai: {
              type: "api",
              key: "sk-legacy-key",
            },
          }),
        )

        const creds = asApiAuth(await Auth.get("openai"))
        expect(creds?.key).toBe("sk-legacy-key")

        const all = await Auth.all()
        expect(all.openai.accounts.default).toBeDefined()
        expect(all.openai.activeAccount).toBe("default")
      },
    })
  })
})
