import { mkdtemp, realpath, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

export async function tmpdir() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "opencode-tui-test-")))
  return {
    path: directory,
    async [Symbol.asyncDispose]() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}
