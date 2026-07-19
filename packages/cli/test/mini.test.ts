import { describe, expect, test } from "bun:test"
import { ClientError, OpenCode } from "@opencode-ai/client/promise"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import path from "node:path"
import { createMiniConnection, mergeInput as mergeInteractiveInput, resolveMiniTarget } from "../src/mini"
import { mergeInput as mergeNonInteractiveInput, parseRunModel } from "../src/run/run"
import { parseSessionTargetModel } from "../src/session-target"

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

describe("mini command", () => {
  test("uses piped stdin as the initial prompt", () => {
    expect(mergeInteractiveInput("from stdin", undefined)).toBe("from stdin")
    expect(mergeInteractiveInput("from stdin", "from flag")).toBe("from stdin\nfrom flag")
  })

  test("constructs a fresh authenticated client for a replacement endpoint", async () => {
    const authorization: Array<string | null> = []
    const initial = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ healthy: true, version: InstallationVersion, pid: process.pid })
      },
    })
    const replacement = Bun.serve({
      port: 0,
      fetch(request) {
        authorization.push(request.headers.get("authorization"))
        return Response.json({ healthy: true, version: InstallationVersion, pid: process.pid })
      },
    })
    const controller = new AbortController()
    let signal: AbortSignal | undefined

    try {
      const connection = createMiniConnection({
        endpoint: { url: initial.url.toString() },
        reconnect: async (next) => {
          signal = next
          return {
            url: replacement.url.toString(),
            auth: { type: "basic", username: "replacement", password: "secret" },
          }
        },
      })
      const client = await connection.reconnect?.(controller.signal)
      if (!client) throw new Error("Expected a replacement client")
      await client.health.get()

      expect(client).not.toBe(connection.sdk)
      expect(signal).toBe(controller.signal)
      expect(authorization).toEqual([`Basic ${btoa("replacement:secret")}`])
      expect(createMiniConnection({ endpoint: { url: initial.url.toString() } }).reconnect).toBeUndefined()
    } finally {
      initial.stop(true)
      replacement.stop(true)
    }
  })

  test("re-resolves a managed target when the endpoint moves before transport construction", async () => {
    const initial = OpenCode.make({ baseUrl: "https://initial.opencode.test" })
    const replacement = OpenCode.make({ baseUrl: "https://replacement.opencode.test" })
    const controller = new AbortController()
    const seen: (typeof initial)[] = []
    let reconnects = 0

    const result = await resolveMiniTarget({
      sdk: initial,
      reconnect: async (signal) => {
        expect(signal).toBe(controller.signal)
        reconnects++
        if (reconnects === 1) throw new Error("service still moving")
        return replacement
      },
      signal: controller.signal,
      resolve: async (sdk) => {
        seen.push(sdk)
        if (sdk === initial) throw new ClientError("Transport")
        return "ses-replacement"
      },
    })

    expect(seen).toEqual([initial, replacement])
    expect(reconnects).toBe(2)
    expect(result).toEqual({ sdk: replacement, value: "ses-replacement" })
  })

  test("merges non-interactive argument and stdin input", () => {
    expect(mergeNonInteractiveInput("from args", "from stdin")).toBe("from args\nfrom stdin")
    expect(mergeNonInteractiveInput(undefined, "from stdin")).toBe("from stdin")
  })

  test("parses model variants from the model reference", () => {
    expect(JSON.stringify(parseRunModel("openrouter/openai/gpt-5#high"))).toBe(
      JSON.stringify({ model: { providerID: "openrouter", modelID: "openai/gpt-5" }, variant: "high" }),
    )
    expect(parseSessionTargetModel("openrouter/openai/gpt-5#high")).toEqual({
      providerID: "openrouter",
      id: "openai/gpt-5",
      variant: "high",
    })
  })

  test("is registered in the preview CLI", async () => {
    const result = await cli(["--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("mini       Start the minimal interactive interface")
    expect(result.stdout).toContain("run        Run OpenCode with a message")
  })

  test("exposes run without legacy attach or command modes", async () => {
    const result = await cli(["run", "--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("--server string")
    expect(result.stdout).not.toContain("--variant")
    expect(result.stdout).not.toContain("--attach")
    expect(result.stdout).not.toContain("--command")
  })

  test("keeps option-like prompt text after the argument separator", async () => {
    const result = await cli(["run", "--server", "http://127.0.0.1:1", "--", "--foo"])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain("You must provide a message")
  })

  test("preserves a run failure exit code", async () => {
    let modelRequests = 0
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/api/health")
          return Response.json({ healthy: true, version: InstallationVersion, pid: process.pid })
        if (url.pathname === "/api/location")
          return Response.json({ directory: process.cwd(), project: { id: "global", directory: process.cwd() } })
        if (url.pathname === "/api/model") {
          modelRequests++
          return Response.json({
            location: { directory: process.cwd(), project: { id: "global", directory: process.cwd() } },
            data: modelRequests === 1 ? [{ id: "missing", providerID: "definitely" }] : [],
          })
        }
        return new Response(undefined, { status: 404 })
      },
    })

    try {
      const result = await cli(["run", "--server", server.url.toString(), "--model", "definitely/missing", "hi"])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("Model unavailable: definitely/missing")
    } finally {
      server.stop(true)
    }
  })

  test("reports pre-admission errors as JSON", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/api/session") return new Response("boom", { status: 500 })
        return Response.json({ healthy: true, version: "incompatible", pid: process.pid })
      },
    })

    try {
      const result = await cli(["run", "--format", "json", "--server", server.url.toString(), "hi"])

      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        type: "error",
        sessionID: "",
        error: { type: "unknown", message: "UnexpectedStatus" },
      })
    } finally {
      server.stop(true)
    }
  })

  test("uses the shared V2 server option instead of an attach command", async () => {
    const result = await cli(["mini", "--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("--server string")
    expect(result.stdout).not.toContain("SUBCOMMANDS")
  })

  test("routes local and explicit-server invocations into mini", async () => {
    for (const args of [["mini"], ["mini", "--server", "http://127.0.0.1:1"]]) {
      const result = await cli(args)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("opencode mini requires a TTY stdout")
    }
  })
})
