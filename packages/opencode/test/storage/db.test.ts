import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"
import { Process } from "../../src/util/process"

function bun(script: string) {
  return [process.execPath, "-e", script]
}

describe("storage.db", () => {
  test("opens a preview channel database when the channel contains slashes", async () => {
    await using tmp = await tmpdir()
    const url = pathToFileURL(path.join(import.meta.dirname, "../../src/storage/db.ts")).href
    const env = {
      XDG_DATA_HOME: path.join(tmp.path, "share"),
      XDG_CACHE_HOME: path.join(tmp.path, "cache"),
      XDG_CONFIG_HOME: path.join(tmp.path, "config"),
      XDG_STATE_HOME: path.join(tmp.path, "state"),
      OPENCODE_TEST_HOME: path.join(tmp.path, "home"),
    }
    const out = await Process.run(
      bun(`
        void (async () => {
          globalThis.OPENCODE_CHANNEL = "foo/bar"
          globalThis.OPENCODE_VERSION = "0.0.0-foo/bar-202603061921"
          const { Database } = await import(${JSON.stringify(url)})
          Database.Client()
          process.stdout.write(Database.Path)
          Database.close()
        })().catch((err) => {
          console.error(err)
          process.exit(1)
        })
      `),
      { env },
    )
    const want = path.join(env.XDG_DATA_HOME, "opencode", "opencode-foo-bar.db")
    expect(out.stdout.toString()).toBe(want)
    expect(await Bun.file(want).exists()).toBe(true)
  })
})
