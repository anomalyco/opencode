import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { checkPennylaneHealth, resetPennylaneHealthCache } from "../../src/server/routes/plugin"
import { Config } from "../../src/config/config"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const env = {
  bin: process.env.PENNYLANE_CLI_BIN,
  count: process.env.PENNYLANE_COUNT_FILE,
}

async function dir(name: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), `opencode-pennylane-${name}-`))
}

async function cli(name: string, body: string) {
  const root = await dir("cli")
  const file = path.join(root, name)
  await fs.writeFile(file, body)
  await fs.chmod(file, 0o755)
  return file
}

async function project(plugin = false) {
  const root = await dir("project")
  if (!plugin) return root
  await fs.writeFile(
    path.join(root, "opencode.json"),
    JSON.stringify({
      plugin: ["pennylane"],
    }),
  )
  return root
}

async function health(root: string) {
  return Instance.provide({
    directory: root,
    fn: async () => {
      const app = Server.App()
      const response = await app.request("/plugin/pennylane/health")
      expect(response.status).toBe(200)
      return response.json()
    },
  })
}

beforeEach(() => {
  resetPennylaneHealthCache()
  delete process.env.PENNYLANE_CLI_BIN
  delete process.env.PENNYLANE_COUNT_FILE
})

afterEach(() => {
  resetPennylaneHealthCache()
  if (env.bin) process.env.PENNYLANE_CLI_BIN = env.bin
  else delete process.env.PENNYLANE_CLI_BIN
  if (env.count) process.env.PENNYLANE_COUNT_FILE = env.count
  else delete process.env.PENNYLANE_COUNT_FILE
})

describe("plugin.pennylane.health", () => {
  test("returns not configured when pennylane plugin is absent", async () => {
    const get = Config.get
    Config.get = async () => ({ plugin: [] }) as Awaited<ReturnType<typeof Config.get>>

    try {
      const body = await health(await project())

      expect(body).toMatchObject({
        healthy: false,
        configured: false,
        code: "not_configured",
        error: "not configured",
      })
    } finally {
      Config.get = get
    }
  })

  test("returns structured auth errors from the Pennylane CLI", async () => {
    process.env.PENNYLANE_CLI_BIN = await cli(
      "auth-error.sh",
      [
        "#!/bin/sh",
        "printf '%s\\n' '{\"code\":\"auth_error\",\"message\":\"PENNYLANE_API_KEY is not set\"}' >&2",
        "exit 2",
      ].join("\n"),
    )

    const body = await health(await project(true))

    expect(body).toMatchObject({
      healthy: false,
      configured: true,
      code: "auth_error",
      error: "PENNYLANE_API_KEY is not set",
    })
  })

  test("parses structured Pennylane errors from stdout too", async () => {
    const result = await checkPennylaneHealth({
      bin: await cli(
        "stdout-error.sh",
        [
          "#!/bin/sh",
          "printf '%s\\n' '{\"code\":\"api_error\",\"message\":\"Pennylane request failed\",\"details\":{\"path\":\"/me\",\"reason\":\"boom\"}}'",
          "exit 3",
        ].join("\n"),
      ),
      cwd: process.cwd(),
      env: process.env,
      request_timeout_ms: 50,
      process_timeout_ms: 300,
    })

    expect(result).toMatchObject({
      healthy: false,
      configured: true,
      code: "api_error",
      error: "Pennylane request failed",
      details: {
        path: "/me",
        reason: "boom",
      },
    })
  })

  test("times out hung Pennylane CLI processes", async () => {
    const result = await checkPennylaneHealth({
      bin: await cli(
        "timeout.sh",
        [
          "#!/bin/sh",
          "sleep 1",
          "exit 0",
        ].join("\n"),
      ),
      cwd: process.cwd(),
      env: process.env,
      request_timeout_ms: 50,
      process_timeout_ms: 20,
    })

    expect(result).toMatchObject({
      healthy: false,
      configured: true,
      code: "timeout",
    })
  })

  test("caches health results briefly to avoid repeated CLI calls", async () => {
    const count = path.join(await dir("count"), "count.txt")
    process.env.PENNYLANE_COUNT_FILE = count
    process.env.PENNYLANE_CLI_BIN = await cli(
      "count.sh",
      [
        "#!/bin/sh",
        "count=0",
        "if [ -f \"$PENNYLANE_COUNT_FILE\" ]; then count=$(cat \"$PENNYLANE_COUNT_FILE\"); fi",
        "count=$((count + 1))",
        "printf '%s' \"$count\" > \"$PENNYLANE_COUNT_FILE\"",
        "exit 0",
      ].join("\n"),
    )

    const root = await project(true)
    await health(root)
    await health(root)

    expect(await fs.readFile(count, "utf8")).toBe("1")
  })
})
