import { describe, expect, test } from "bun:test"
import { Auth } from "../../src/auth"
import { collectAuthListEntries } from "../../src/cli/cmd/auth"
import { Config } from "../../src/config/config"

async function withMocks<T>(
  mocks: {
    authAll: () => Promise<Record<string, Auth.Info>>
    configGet: () => Promise<Config.Info>
  },
  fn: () => Promise<T>,
): Promise<T> {
  const originalAuthAll = Auth.all
  const originalConfigGet = Config.get
  Auth.all = mocks.authAll
  Config.get = mocks.configGet
  try {
    return await fn()
  } finally {
    Auth.all = originalAuthAll
    Config.get = originalConfigGet
  }
}

describe("collectAuthListEntries", () => {
  test("includes config apiKey when no auth entry exists", async () => {
    const entries = await withMocks(
      {
        authAll: () => Promise.resolve({}),
        configGet: () =>
          Promise.resolve({
            provider: {
              avalai: {
                options: {
                  apiKey: "test-key",
                },
              },
            },
          } as Config.Info),
      },
      () => collectAuthListEntries(),
    )

    expect(entries).toEqual([{ providerID: "avalai", type: "config" }])
  })

  test("prefers auth entries over config apiKey", async () => {
    const entries = await withMocks(
      {
        authAll: () =>
          Promise.resolve({
            openai: {
              type: "api",
              key: "from-auth",
            },
          } as Record<string, Auth.Info>),
        configGet: () =>
          Promise.resolve({
            provider: {
              openai: {
                options: {
                  apiKey: "from-config",
                },
              },
            },
          } as Config.Info),
      },
      () => collectAuthListEntries(),
    )

    expect(entries).toEqual([{ providerID: "openai", type: "api" }])
  })

  test("ignores blank config apiKey values", async () => {
    const entries = await withMocks(
      {
        authAll: () => Promise.resolve({}),
        configGet: () =>
          Promise.resolve({
            provider: {
              openrouter: {
                options: {
                  apiKey: "   ",
                },
              },
            },
          } as Config.Info),
      },
      () => collectAuthListEntries(),
    )

    expect(entries).toEqual([])
  })
})
