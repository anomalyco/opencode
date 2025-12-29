import { test, expect } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"

test("Bedrock: config region takes precedence over AWS_REGION env var", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "amazon-bedrock": {
              options: {
                region: "eu-west-1",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("AWS_REGION", "us-east-1")
      Env.set("AWS_PROFILE", "default")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["amazon-bedrock"]).toBeDefined()
      // Region from config should be used (not env var)
      expect(providers["amazon-bedrock"].options?.region).toBe("eu-west-1")
    },
  })
})

test("Bedrock: falls back to AWS_REGION env var when no config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("AWS_REGION", "eu-west-1")
      Env.set("AWS_PROFILE", "default")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["amazon-bedrock"]).toBeDefined()
      expect(providers["amazon-bedrock"].options?.region).toBe("eu-west-1")
    },
  })
})

test("Bedrock: without explicit region config, uses AWS_REGION env or defaults", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("AWS_PROFILE", "default")
      // AWS_REGION might be set in the environment, use that or default
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["amazon-bedrock"]).toBeDefined()
      // Should have some region set (either from env or default)
      expect(providers["amazon-bedrock"].options?.region).toBeDefined()
      expect(typeof providers["amazon-bedrock"].options?.region).toBe("string")
    },
  })
})

test("Bedrock: uses config region in provider options", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "amazon-bedrock": {
              options: {
                region: "eu-north-1",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("AWS_PROFILE", "default")
    },
    fn: async () => {
      const providers = await Provider.list()
      const bedrockProvider = providers["amazon-bedrock"]
      expect(bedrockProvider).toBeDefined()
      expect(bedrockProvider.options?.region).toBe("eu-north-1")
    },
  })
})

test("Bedrock: respects config region for different instances", async () => {
  // First instance with EU config
  await using tmp1 = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "amazon-bedrock": {
              options: {
                region: "eu-west-1",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp1.path,
    init: async () => {
      Env.set("AWS_PROFILE", "default")
      Env.set("AWS_REGION", "us-east-1")
    },
    fn: async () => {
      const providers1 = await Provider.list()
      expect(providers1["amazon-bedrock"].options?.region).toBe("eu-west-1")
    },
  })

  // Second instance with US config
  await using tmp2 = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "amazon-bedrock": {
              options: {
                region: "us-west-2",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp2.path,
    init: async () => {
      Env.set("AWS_PROFILE", "default")
      Env.set("AWS_REGION", "eu-west-1")
    },
    fn: async () => {
      const providers2 = await Provider.list()
      expect(providers2["amazon-bedrock"].options?.region).toBe("us-west-2")
    },
  })
})

test("Bedrock: loads when bearer token from auth.json is present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "amazon-bedrock": {
              options: {
                region: "eu-west-1",
              },
            },
          },
        }),
      )
    },
  })

  // Setup auth.json with bearer token for amazon-bedrock
  const authPath = path.join(Global.Path.data, "auth.json")
  await Bun.write(
    authPath,
    JSON.stringify({
      "amazon-bedrock": {
        type: "api",
        key: "test-bearer-token",
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      // Clear env vars so only auth.json should trigger autoload
      Env.set("AWS_PROFILE", "")
      Env.set("AWS_ACCESS_KEY_ID", "")
      Env.set("AWS_BEARER_TOKEN_BEDROCK", "")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["amazon-bedrock"]).toBeDefined()
      expect(providers["amazon-bedrock"].options?.region).toBe("eu-west-1")
    },
  })
})
