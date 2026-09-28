// Temp directories for tests (idea from packages/opencode/test/fixture/fixture.ts; not imported across packages).
import fs from "fs/promises"
import os from "os"
import path from "path"

export async function tmpdir(options: { git?: boolean; files?: Record<string, string> } = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "oclite-test-")))
  if (options.git) await fs.mkdir(path.join(dir, ".git"))
  await Promise.all(Object.entries(options.files ?? {}).map(([file, content]) => Bun.write(path.join(dir, file), content)))
  return {
    path: dir,
    write: (file: string, content: string) => Bun.write(path.join(dir, file), content),
    read: (file: string) => Bun.file(path.join(dir, file)).text(),
    [Symbol.asyncDispose]: () => fs.rm(dir, { recursive: true, force: true }),
  }
}
