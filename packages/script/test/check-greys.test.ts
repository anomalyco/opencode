import { afterEach, describe, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("check-greys", () => {
  test("honors declared path exceptions with Windows separators", async () => {
    const result = await runChecker(
      {
        "services/site/src/component/font-share/share.css": ".share { color: #777777; }\n",
        "services/site/src/style/token/color.css": ":root { --neutral: #777777; }\n",
      },
      ["--json"],
    )

    expect(result.exitCode).toBe(0)
    expect(
      JSON.parse(result.stdout.toString())
        .entries.map((entry: { outcome: string }) => entry.outcome)
        .sort(),
    ).toEqual(
      [
        "exception: Font share cards: exported images",
        "exception: Legacy tokens: to remove when the dropdown, language picker, 404 and limits graph move to site tokens",
      ].sort(),
    )
  })

  test("still rejects greys outside declared path exceptions", async () => {
    const result = await runChecker({
      "services/site/src/component/site/regular.css": ".regular { color: #777777; }\n",
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("#777777  not on the scale")
  })
})

async function runChecker(stylesheets: Record<string, string>, args: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-greys-"))
  directories.push(directory)

  const checker = path.join(directory, "script", "check-greys.ts")
  await mkdir(path.dirname(checker), { recursive: true })
  await copyFile(path.resolve(import.meta.dir, "../../../script/check-greys.ts"), checker)

  for (const [file, source] of Object.entries(stylesheets)) {
    const target = path.join(directory, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source)
  }

  const home = path.join(directory, "home")
  const temp = path.join(directory, "temp")
  await Promise.all([mkdir(home), mkdir(temp)])

  return Bun.spawnSync({
    cmd: [process.execPath, checker, ...args],
    cwd: directory,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      TMP: temp,
      TEMP: temp,
      TMPDIR: temp,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
}
