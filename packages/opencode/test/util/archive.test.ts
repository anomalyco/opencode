import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Archive } from "@/util/archive"
import { Process } from "@/util/process"
import { tmpdir } from "../fixture/fixture"

test("extractZip handles literal Windows paths", async () => {
  if (process.platform !== "win32") return

  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source.txt")
  const archive = path.join(tmp.path, "archive.zip")
  await Bun.write(source, "content")
  await Process.run(
    [
      "powershell",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Compress-Archive -LiteralPath $env:OPENCODE_TEST_SOURCE -DestinationPath $env:OPENCODE_TEST_ARCHIVE -Force",
    ],
    {
      env: {
        OPENCODE_TEST_SOURCE: source,
        OPENCODE_TEST_ARCHIVE: archive,
      },
    },
  )

  const literal = path.join(tmp.path, "archive's [copy].zip")
  const destination = path.join(tmp.path, "destination's [copy]")
  await fs.rename(archive, literal)
  await Archive.extractZip(literal, destination)

  expect(await Bun.file(path.join(destination, "source.txt")).text()).toBe("content")
})
