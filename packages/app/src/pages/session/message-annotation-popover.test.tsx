import { describe, test } from "bun:test"

const cwd = new URL("../../../", import.meta.url).pathname

const run = () =>
  Bun.spawnSync(
    ["bun", "test", "--preload", "./happydom.ts", "./src/pages/session/message-annotation-popover.cases.tsx"],
    {
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    },
  )

const text = (buf: Uint8Array<ArrayBufferLike>) => new TextDecoder().decode(buf)

describe("MessageAnnotationPopover", () => {
  test("runs isolated browser bundle coverage", () => {
    const out = run()
    if (out.exitCode === 0) return

    throw new Error(`${text(out.stdout)}\n${text(out.stderr)}`.trim())
  })
})
