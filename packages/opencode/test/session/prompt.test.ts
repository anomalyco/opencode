import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })


describe("shell", () => {
  test("provides AGENT environment variable", () => testShellCommand("echo $AGENT", "1\n"))
  test("provides OPENCODE environment variable", () => testShellCommand("echo $OPENCODE", "1\n"))
})

const testShellCommand = async (command: string, expectedOutput: string) => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const result = await SessionPrompt.shell({
        agent: "build",
        sessionID: session.id,
        command,
      })

      const output = result.parts.map((part) => {
        if (part.state.status === "completed") {
          return part.state.output
        }
      }).filter(Boolean).join("")

      expect(output).toBe(expectedOutput)
    },
  })

  expect.assertions(1)
}
