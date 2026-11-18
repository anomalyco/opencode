import { describe, expect, it } from "bun:test"
import { ChildProcess } from "effect/process"
import { sandboxCommand, sanitizeEnv } from "../src/environment/sandbox"

describe("sandbox execution", () => {
  it("drops credential-like variables and keeps ordinary ones", () => {
    expect(
      sanitizeEnv({
        PATH: "/bin",
        OPENCODE_TERMINAL: "1",
        ANTHROPIC_API_KEY: "secret",
        AWS_SECRET_ACCESS_KEY: "secret",
        GITHUB_TOKEN: "secret",
      }),
    ).toEqual({ PATH: "/bin", OPENCODE_TERMINAL: "1" })
  })

  it("pins cwd and scrubs every stage of a pipeline", () => {
    const command = ChildProcess.pipeTo(
      ChildProcess.make("echo", ["hi"], { env: { PATH: "/bin", OPENAI_API_KEY: "secret" } }),
      ChildProcess.make("cat", [], { env: { GITHUB_TOKEN: "secret", TERM: "xterm" } }),
    )
    const result = sandboxCommand(command, "/project")
    if (result._tag !== "PipedCommand") throw new Error("expected a piped command")
    if (result.left._tag !== "StandardCommand" || result.right._tag !== "StandardCommand")
      throw new Error("expected standard commands")
    expect(result.left.options.cwd).toBe("/project")
    expect(result.left.options.env).toEqual({ PATH: "/bin" })
    expect(result.left.options.extendEnv).toBe(false)
    expect(result.right.options.cwd).toBe("/project")
    expect(result.right.options.env).toEqual({ TERM: "xterm" })
  })
})
