import { describe, expect, test } from "bun:test"
import path from "node:path"

// The snapshot build id hashes only the package's own bytecode, codecs, and built-ins, so it is the same in every
// process, whatever it imported first.

const root = path.join(import.meta.dir, "../..")

const output = async (command: Array<string>) => {
  const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ code: await child.exited, stderr }).toMatchObject({ code: 0 })
  return stdout
}

describe("build id", () => {
  test("the build id is the same whatever a process imported first", async () => {
    const fixture = path.join(import.meta.dir, "../fixtures/build-id.ts")
    const ids = await Promise.all(
      [[], ["--preload", "./test/test262/run.ts"], ["--preload", "./src/index.ts"]].map((preload) =>
        output(["bun", ...preload, fixture]),
      ),
    )
    expect(ids[0]).toMatch(/\+[0-9a-f]+\n$/)
    expect(ids[1]).toBe(ids[0]!)
    expect(ids[2]).toBe(ids[0]!)
  })

  // A process with the test262 harness loaded saves the run; the child that resumes it has not loaded it.
  test("a run saved with the test262 harness loaded resumes in another process", async () => {
    await output(["bun", "test", "--preload", "./test/test262/run.ts", "test/vm/suspend.test.ts", "-t", "another process"])
  }, 15_000)
})
