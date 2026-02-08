import { describe, test, expect } from "bun:test"
import path from "path"

const root = path.join(__dirname, "../../..")
const entry = path.join(root, "src/index.ts")

function spawn(args: string[]) {
  return Bun.spawn(["bun", "run", "--conditions=browser", entry, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("signal handling", () => {
  test.skipIf(process.platform === "win32")("serve exits on SIGHUP", async () => {
    const proc = spawn(["serve", "--port", "0"])
    await Bun.sleep(3000)
    expect(await alive(proc.pid)).toBe(true)

    process.kill(proc.pid, "SIGHUP")
    await proc.exited

    expect(await alive(proc.pid)).toBe(false)
  })

  test("serve exits on SIGTERM", async () => {
    const proc = spawn(["serve", "--port", "0"])
    await Bun.sleep(3000)
    expect(await alive(proc.pid)).toBe(true)

    process.kill(proc.pid, "SIGTERM")
    await proc.exited

    expect(await alive(proc.pid)).toBe(false)
  })
})
