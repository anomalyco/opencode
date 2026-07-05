import { describe, expect, test } from "bun:test"
import { mergeInteractiveInput, mergeNonInteractiveInput, pickRunModel } from "../src/mini"

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: new URL("..", import.meta.url).pathname,
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

  test("keeps run as mini's non-interactive input mode", () => {
    expect(mergeNonInteractiveInput("from args", "from stdin")).toBe("from args\nfrom stdin")
    expect(mergeNonInteractiveInput(undefined, "from stdin")).toBe("from stdin")
  })

  test("applies a variant to a resumed session's model", () => {
    expect(
      pickRunModel(
        undefined,
        "high",
        { providerID: "session-provider", modelID: "session-model" },
        { providerID: "default-provider", modelID: "default-model" },
      ),
    ).toEqual({ providerID: "session-provider", modelID: "session-model" })
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
    expect(result.stdout).not.toContain("--attach")
    expect(result.stdout).not.toContain("--command")
  })

  test("keeps option-like prompt text after the argument separator", async () => {
    const result = await cli(["run", "--server", "http://127.0.0.1:1", "--", "--foo"])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain("You must provide a message")
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
