import { test, expect, mock } from "bun:test"
import path from "path"
import { unlink } from "fs/promises"

// === Mocks ===
// These mocks are required because Provider.list() triggers:
// 1. BunProc.install("@aws-sdk/credential-providers") - in bedrock custom loader
// 2. Plugin.list() which calls BunProc.install() for default plugins
// Without mocks, these would attempt real package installations that timeout in tests.

mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string, _version?: string) => {
      // Return package name without version for mocking
      const lastAtIndex = pkg.lastIndexOf("@")
      return lastAtIndex > 0 ? pkg.substring(0, lastAtIndex) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

mock.module("@aws-sdk/credential-providers", () => ({
  fromNodeProviderChain: () => async () => ({
    accessKeyId: "mock-access-key-id",
    secretAccessKey: "mock-secret-access-key",
  }),
}))

const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))

// Import after mocks are set up
const { tmpdir } = await import("../fixture/fixture")
const { Instance } = await import("../../src/project/instance")
const { Provider } = await import("../../src/provider/provider")
const { Env } = await import("../../src/env")
const { Global } = await import("../../src/global")

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
      expect(providers["amazon-bedrock"].options?.region).toBe("eu-west-1")
    },
  })
})

test("Bedrock: falls back to AWS_REGION env var when no config region", async () => {
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

  const authPath = path.join(Global.Path.data, "auth.json")

  // Save original auth.json if it exists
  let originalAuth: string | undefined
  try {
    originalAuth = await Bun.file(authPath).text()
  } catch {
    // File doesn't exist, that's fine
  }

  try {
    // Write test auth.json
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
  } finally {
    // Restore original or delete
    if (originalAuth !== undefined) {
      await Bun.write(authPath, originalAuth)
    } else {
      try {
        await unlink(authPath)
      } catch {
        // Ignore errors if file doesn't exist
      }
    }
  }
})

test("Bedrock: config profile takes precedence over AWS_PROFILE env var", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "amazon-bedrock": {
              options: {
                profile: "my-custom-profile",
                region: "us-east-1",
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
      Env.set("AWS_ACCESS_KEY_ID", "test-key-id")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["amazon-bedrock"]).toBeDefined()
      expect(providers["amazon-bedrock"].options?.region).toBe("us-east-1")
    },
  })
})

test("Bedrock: includes custom endpoint in options when specified", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "amazon-bedrock": {
              options: {
                endpoint: "https://bedrock-runtime.us-east-1.vpce-xxxxx.amazonaws.com",
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
      expect(providers["amazon-bedrock"]).toBeDefined()
      expect(providers["amazon-bedrock"].options?.endpoint).toBe(
        "https://bedrock-runtime.us-east-1.vpce-xxxxx.amazonaws.com",
      )
    },
  })
})

test("Bedrock: autoloads when AWS_WEB_IDENTITY_TOKEN_FILE is present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "amazon-bedrock": {
              options: {
                region: "us-east-1",
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
      Env.set("AWS_WEB_IDENTITY_TOKEN_FILE", "/var/run/secrets/eks.amazonaws.com/serviceaccount/token")
      Env.set("AWS_ROLE_ARN", "arn:aws:iam::123456789012:role/my-eks-role")
      Env.set("AWS_PROFILE", "")
      Env.set("AWS_ACCESS_KEY_ID", "")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["amazon-bedrock"]).toBeDefined()
      expect(providers["amazon-bedrock"].options?.region).toBe("us-east-1")
    },
  })
})
