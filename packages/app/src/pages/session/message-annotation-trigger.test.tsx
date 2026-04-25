import { describe, test } from "bun:test"

const cwd = new URL("../../../", import.meta.url).pathname

const run = () =>
  Bun.spawnSync(
    ["bun", "test", "--preload", "./happydom.ts", "./src/pages/session/message-annotation-trigger.cases.tsx"],
    {
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    },
  )

const text = (buf: Uint8Array<ArrayBufferLike>) => new TextDecoder().decode(buf)

describe("MessageAnnotationTrigger", () => {
  test("runs isolated browser coverage for the icon, toolbar, and mini trigger contracts", () => {
    const out = run()
    if (out.exitCode === 0) return

    throw new Error(`${text(out.stdout)}\n${text(out.stderr)}`.trim())
  })
})
