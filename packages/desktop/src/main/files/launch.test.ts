import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { launchDetached } from "./launch"

test("external apps preserve arguments and survive their launcher exiting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-launch-"))
  const file = join(directory, "child.txt")
  const target = 'project with spaces & symbols %PATH% ! ^ (日本語) "quoted"'

  const child = `
    const fs = require("node:fs")
    fs.writeFileSync(${JSON.stringify(file + ".tmp")}, process.pid + "\\n" + JSON.stringify(process.argv.slice(1)))
    fs.renameSync(${JSON.stringify(file + ".tmp")}, ${JSON.stringify(file)})
    setTimeout(() => {}, 30_000)
  `

  const parent = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { launchDetached } from ${JSON.stringify(fileURLToPath(new URL("./launch.ts", import.meta.url)))};
       await launchDetached(process.execPath, ${JSON.stringify(["-e", child, target])})`,
    ],
    // The launcher must exit naturally. A missing unref must fail, not hang the suite.
    { stdout: "ignore", stderr: "pipe", timeout: 5_000 },
  )

  try {
    const deadline = Date.now() + 5_000

    while (!(await Bun.file(file).exists())) {
      if (Date.now() >= deadline) throw new Error("External app did not write its startup file")
      await Bun.sleep(10)
    }

    const message = (await Bun.file(file).text()).split("\n")

    expect(await new Response(parent.stderr).text()).toBe("")
    expect(await parent.exited).toBe(0)
    expect(message[1]).toBe(JSON.stringify([target]))
    expect(process.kill(Number(message[0]), 0)).toBe(true)
  } finally {
    parent.kill()
    await parent.exited
    const message = await Bun.file(file).text().catch(() => "")

    if (message) process.kill(Number(message.split("\n")[0]))
    await rm(directory, { recursive: true, force: true })
  }
})

test("missing external applications reject at launch", async () => {
  const missing = `opencode-missing-editor-${crypto.randomUUID()}`

  await expect(launchDetached(missing, ["project with spaces"])).rejects.toThrow(missing)
})
