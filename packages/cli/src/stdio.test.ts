import { describe, expect, test } from "bun:test"

const size = 600_000
const stdio = new URL("./stdio.ts", import.meta.url).pathname

// A slow consumer keeps the pipe full, so part of the write is still pending when the writer exits.
const reader = `
  let total = 0
  for await (const chunk of process.stdin) {
    total += chunk.length
    await Bun.sleep(5)
  }
  console.log(total)
`

async function pipedBytes(write: string) {
  const writer = `
    import { writeStdout } from ${JSON.stringify(stdio)}
    const text = "x".repeat(${size})
    ${write}
    process.exit(0)
  `
  const exe = JSON.stringify(process.execPath)
  const child = Bun.spawn(["sh", "-c", `${exe} -e "$WRITER" | ${exe} -e "$READER"`], {
    env: { ...process.env, WRITER: writer, READER: reader },
    stdout: "pipe",
    stderr: "inherit",
  })
  const output = await new Response(child.stdout).text()
  await child.exited
  return Number(output.trim())
}

describe.skipIf(process.platform === "win32")("writeStdout", () => {
  test("delivers a large piped write in full before process.exit", async () => {
    expect(await pipedBytes("await writeStdout(text)")).toBe(size)
  })

  test("a plain process.stdout.write is truncated by process.exit", async () => {
    expect(await pipedBytes("process.stdout.write(text)")).toBeLessThan(size)
  })
})
