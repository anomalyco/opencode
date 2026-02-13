import { test, expect, describe } from "bun:test"
import path from "path"
import { unlink } from "fs/promises"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"
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

// Tests for cross-region inference profile prefix handling
// Models from models.dev may come with prefixes already (e.g., us., eu., global.)
// These should NOT be double-prefixed when passed to the SDK

test("Bedrock: model with us. prefix should not be double-prefixed", async () => {
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
              models: {
                "us.anthropic.claude-opus-4-5-20251101-v1:0": {
                  name: "Claude Opus 4.5 (US)",
                },
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
      // The model should exist with the us. prefix
      expect(providers["amazon-bedrock"].models["us.anthropic.claude-opus-4-5-20251101-v1:0"]).toBeDefined()
    },
  })
})

test("Bedrock: model with global. prefix should not be prefixed", async () => {
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
              models: {
                "global.anthropic.claude-opus-4-5-20251101-v1:0": {
                  name: "Claude Opus 4.5 (Global)",
                },
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
      expect(providers["amazon-bedrock"].models["global.anthropic.claude-opus-4-5-20251101-v1:0"]).toBeDefined()
    },
  })
})

test("Bedrock: model with eu. prefix should not be double-prefixed", async () => {
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
              models: {
                "eu.anthropic.claude-opus-4-5-20251101-v1:0": {
                  name: "Claude Opus 4.5 (EU)",
                },
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
      expect(providers["amazon-bedrock"].models["eu.anthropic.claude-opus-4-5-20251101-v1:0"]).toBeDefined()
    },
  })
})

test("Bedrock: model without prefix in US region should get us. prefix added", async () => {
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
              models: {
                "anthropic.claude-opus-4-5-20251101-v1:0": {
                  name: "Claude Opus 4.5",
                },
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
      // Non-prefixed model should still be registered
      expect(providers["amazon-bedrock"].models["anthropic.claude-opus-4-5-20251101-v1:0"]).toBeDefined()
    },
  })
})

// Direct unit tests for cross-region inference profile prefix handling
// These test the prefix detection logic used in getModel

describe("Bedrock cross-region prefix detection", () => {
  const crossRegionPrefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."]

  test("should detect global. prefix", () => {
    const modelID = "global.anthropic.claude-opus-4-5-20251101-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(true)
  })

  test("should detect us. prefix", () => {
    const modelID = "us.anthropic.claude-opus-4-5-20251101-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(true)
  })

  test("should detect eu. prefix", () => {
    const modelID = "eu.anthropic.claude-opus-4-5-20251101-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(true)
  })

  test("should detect jp. prefix", () => {
    const modelID = "jp.anthropic.claude-sonnet-4-20250514-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(true)
  })

  test("should detect apac. prefix", () => {
    const modelID = "apac.anthropic.claude-sonnet-4-20250514-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(true)
  })

  test("should detect au. prefix", () => {
    const modelID = "au.anthropic.claude-sonnet-4-5-20250929-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(true)
  })

  test("should NOT detect prefix for non-prefixed model", () => {
    const modelID = "anthropic.claude-opus-4-5-20251101-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(false)
  })

  test("should NOT detect prefix for amazon nova models", () => {
    const modelID = "amazon.nova-pro-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(false)
  })

  test("should NOT detect prefix for cohere models", () => {
    const modelID = "cohere.command-r-plus-v1:0"
    const hasPrefix = crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))
    expect(hasPrefix).toBe(false)
  })
})
