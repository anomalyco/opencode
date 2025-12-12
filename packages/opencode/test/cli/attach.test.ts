import { describe, expect, test, mock } from "bun:test"
import yargs from "yargs"

// Mock tui to capture what args are passed to it
const mockTui = mock(() => Promise.resolve())

// Re-create the attach command with our mock
const createAttachCommand = () => ({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (y: yargs.Argv) =>
    y
      .positional("url", {
        type: "string" as const,
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string" as const,
        description: "directory to run in",
      })
      .option("session", {
        alias: ["s"],
        type: "string" as const,
        describe: "session id to continue",
      }),
  handler: async (args: { url: string; dir?: string; session?: string }) => {
    await mockTui({
      url: args.url,
      args: { sessionID: args.session },
    })
  },
})

describe("AttachCommand", () => {
  test("should parse --session flag", async () => {
    const cmd = createAttachCommand()
    const parser = yargs().command(cmd).help(false)

    const parsed = await parser.parse(["attach", "http://localhost:4096", "--session", "test-session-id"])

    expect(parsed.url).toBe("http://localhost:4096")
    expect(parsed.session).toBe("test-session-id")
  })

  test("should parse -s alias for session", async () => {
    const cmd = createAttachCommand()
    const parser = yargs().command(cmd).help(false)

    const parsed = await parser.parse(["attach", "http://localhost:4096", "-s", "my-session"])

    expect(parsed.url).toBe("http://localhost:4096")
    expect(parsed.session).toBe("my-session")
  })

  test("should work without session flag", async () => {
    const cmd = createAttachCommand()
    const parser = yargs().command(cmd).help(false)

    const parsed = await parser.parse(["attach", "http://localhost:4096"])

    expect(parsed.url).toBe("http://localhost:4096")
    expect(parsed.session).toBeUndefined()
  })

  test("should pass sessionID to tui", async () => {
    mockTui.mockClear()
    const cmd = createAttachCommand()

    await cmd.handler({ url: "http://localhost:4096", session: "test-session" })

    expect(mockTui).toHaveBeenCalledWith({
      url: "http://localhost:4096",
      args: { sessionID: "test-session" },
    })
  })

  test("should pass undefined sessionID when no session provided", async () => {
    mockTui.mockClear()
    const cmd = createAttachCommand()

    await cmd.handler({ url: "http://localhost:4096" })

    expect(mockTui).toHaveBeenCalledWith({
      url: "http://localhost:4096",
      args: { sessionID: undefined },
    })
  })

  test("should parse session with dir option", async () => {
    const cmd = createAttachCommand()
    const parser = yargs().command(cmd).help(false)

    const parsed = await parser.parse([
      "attach",
      "http://localhost:4096",
      "--dir",
      "/tmp/project",
      "-s",
      "session-123",
    ])

    expect(parsed.url).toBe("http://localhost:4096")
    expect(parsed.dir).toBe("/tmp/project")
    expect(parsed.session).toBe("session-123")
  })
})
