import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function tmpdir() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-cli-test-"))
  return {
    path: directory,
    async [Symbol.asyncDispose]() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}
