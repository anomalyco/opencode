import { test, expect } from "bun:test"
import path from "path"
import { unlink } from "fs/promises"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"
import { Global } from "../../src/global"

test("Vertex Anthropic: autoloads with GOOGLE_CLOUD_PROJECT", async () => {
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
      Env.set("GOOGLE_CLOUD_PROJECT", "my-project")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["google-vertex-anthropic"]).toBeDefined()
      expect(providers["google-vertex-anthropic"].options?.project).toBe("my-project")
      expect(providers["google-vertex-anthropic"].options?.location).toBe("global")
    },
  })
})

test("Vertex Anthropic: does not autoload without project or token", async () => {
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
      Env.set("GOOGLE_CLOUD_PROJECT", "")
      Env.set("GCP_PROJECT", "")
      Env.set("GCLOUD_PROJECT", "")
      Env.set("VERTEX_ANTHROPIC_TOKEN", "")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["google-vertex-anthropic"]).toBeUndefined()
    },
  })
})

test("Vertex Anthropic: autoloads with VERTEX_ANTHROPIC_TOKEN even without project", async () => {
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
      Env.set("GOOGLE_CLOUD_PROJECT", "")
      Env.set("GCP_PROJECT", "")
      Env.set("GCLOUD_PROJECT", "")
      Env.set("VERTEX_ANTHROPIC_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["google-vertex-anthropic"]).toBeDefined()
      expect(providers["google-vertex-anthropic"].options?.googleAuthOptions).toBeDefined()
    },
  })
})

test("Vertex Anthropic: sets googleAuthOptions when VERTEX_ANTHROPIC_TOKEN is set", async () => {
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
      Env.set("GOOGLE_CLOUD_PROJECT", "my-project")
      Env.set("VERTEX_ANTHROPIC_TOKEN", "my-bearer-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      const opts = providers["google-vertex-anthropic"].options
      expect(opts?.googleAuthOptions).toBeDefined()
      const authClient = opts?.googleAuthOptions?.authClient
      expect(authClient).toBeDefined()
      const accessToken = await authClient.getAccessToken()
      expect(accessToken.token).toBe("my-bearer-token")
      const headers = await authClient.getRequestHeaders()
      expect(headers.Authorization).toBe("Bearer my-bearer-token")
    },
  })
})

test("Vertex Anthropic: does not set googleAuthOptions without token", async () => {
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
      Env.set("GOOGLE_CLOUD_PROJECT", "my-project")
      Env.set("VERTEX_ANTHROPIC_TOKEN", "")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["google-vertex-anthropic"]).toBeDefined()
      expect(providers["google-vertex-anthropic"].options?.googleAuthOptions).toBeUndefined()
    },
  })
})

test("Vertex Anthropic: loads bearer token from auth.json", async () => {
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

  const authPath = path.join(Global.Path.data, "auth.json")

  let originalAuth: string | undefined
  try {
    originalAuth = await Bun.file(authPath).text()
  } catch {
    // File doesn't exist
  }

  try {
    await Bun.write(
      authPath,
      JSON.stringify({
        "google-vertex-anthropic": {
          type: "api",
          key: "auth-json-token",
        },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GOOGLE_CLOUD_PROJECT", "my-project")
        Env.set("VERTEX_ANTHROPIC_TOKEN", "")
      },
      fn: async () => {
        const providers = await Provider.list()
        const opts = providers["google-vertex-anthropic"].options
        expect(opts?.googleAuthOptions).toBeDefined()
        const accessToken = await opts?.googleAuthOptions?.authClient.getAccessToken()
        expect(accessToken.token).toBe("auth-json-token")
      },
    })
  } finally {
    if (originalAuth !== undefined) {
      await Bun.write(authPath, originalAuth)
    } else {
      try {
        await unlink(authPath)
      } catch {
        // Ignore
      }
    }
  }
})

test("Vertex Anthropic: VERTEX_ANTHROPIC_TOKEN takes precedence over auth.json", async () => {
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

  const authPath = path.join(Global.Path.data, "auth.json")

  let originalAuth: string | undefined
  try {
    originalAuth = await Bun.file(authPath).text()
  } catch {
    // File doesn't exist
  }

  try {
    await Bun.write(
      authPath,
      JSON.stringify({
        "google-vertex-anthropic": {
          type: "api",
          key: "auth-json-token",
        },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GOOGLE_CLOUD_PROJECT", "my-project")
        Env.set("VERTEX_ANTHROPIC_TOKEN", "env-token")
      },
      fn: async () => {
        const providers = await Provider.list()
        const accessToken = await providers["google-vertex-anthropic"].options?.googleAuthOptions?.authClient.getAccessToken()
        expect(accessToken.token).toBe("env-token")
      },
    })
  } finally {
    if (originalAuth !== undefined) {
      await Bun.write(authPath, originalAuth)
    } else {
      try {
        await unlink(authPath)
      } catch {
        // Ignore
      }
    }
  }
})

test("Vertex Anthropic: respects VERTEX_LOCATION env var", async () => {
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
      Env.set("GOOGLE_CLOUD_PROJECT", "my-project")
      Env.set("GOOGLE_CLOUD_LOCATION", "")
      Env.set("VERTEX_LOCATION", "us-central1")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["google-vertex-anthropic"].options?.location).toBe("us-central1")
    },
  })
})
