import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { SessionPrompt } from "../../../src/session/prompt"
import { tmpdir } from "../../fixture/fixture"
import { startSession } from "./tmux-harness"

const skip = !Bun.which("tmux") || process.env.OPENCODE_TUI_E2E !== "1"
const pkg = path.resolve(import.meta.dir, "../../..")

function quote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function command(input: {
  project: string
  route?: unknown
}) {
  const vars = [
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_STATE_HOME",
    "OPENCODE_TEST_HOME",
    "OPENCODE_TEST_MANAGED_CONFIG_DIR",
    "OPENCODE_MODELS_PATH",
  ]
  const env = [
    `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT=1`,
    input.route ? `OPENCODE_ROUTE=${quote(JSON.stringify(input.route))}` : undefined,
    ...vars.flatMap((key) => (process.env[key] ? [`${key}=${quote(process.env[key]!)}`] : [])),
  ].filter((x) => x !== undefined)
  return `${env.join(" ")} ${quote(process.execPath)} run dev -- ${quote(input.project)}`
}

describe("tui tmux e2e", () => {
  test.skipIf(skip)("renders the home screen and opens the command palette", async () => {
    await using tmp = await tmpdir({ git: true })
    const tmux = startSession({
      cwd: pkg,
    })

    try {
      tmux.sendKeys(
        command({
          project: tmp.path,
        }),
        "Enter",
      )
      await tmux.waitForText("commands", { timeout: 25_000 })
      tmux.sendKeys("C-p")
      const pane = await tmux.waitForText("tips", { timeout: 5_000 })
      expect(pane.includes("Hide tips") || pane.includes("Show tips")).toBe(true)
    } finally {
      tmux.cleanup()
    }
  })

  test.skipIf(skip)("renders a pre-seeded session route from OPENCODE_ROUTE", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    const text = "tmux seeded user message"
    const sessionID = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text }],
        })
        return session.id
      },
    })

    const tmux = startSession({
      cwd: pkg,
    })

    try {
      tmux.sendKeys(
        command({
          project: tmp.path,
          route: {
            type: "session",
            sessionID,
          },
        }),
        "Enter",
      )
      const pane = await tmux.waitForText(text, { timeout: 25_000 })
      expect(pane).toContain(text)
    } finally {
      tmux.cleanup()
    }
  })
})
