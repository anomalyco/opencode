import fs from "fs/promises"
import { tmpdir as osTmpdir } from "os"
import path from "path"

export const tmpdir = async () => {
  const dir = await fs.mkdtemp(path.join(osTmpdir(), "opencode-core-test-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}
