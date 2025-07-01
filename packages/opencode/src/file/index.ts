import { z } from "zod"
import { Bus } from "../bus"
import { $ } from "bun"
import { createPatch } from "diff"
import path from "path"

export namespace File {
  export const Event = {
    Edited: Bus.event(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  export async function read(file: string) {
    const content = await Bun.file(file).text()
    const gitDiff = await $`git diff HEAD -- ${file}`
      .cwd(path.dirname(file))
      .quiet()
      .nothrow()
      .text()
    if (gitDiff.trim()) {
      const relativePath = path.relative(process.cwd(), file)
      const originalContent = await $`git show HEAD:./${relativePath}`
        .cwd(process.cwd())
        .quiet()
        .nothrow()
        .text()
      if (originalContent.trim()) {
        const patch = createPatch(file, originalContent, content)
        return patch
      }
    }
    return content.trim()
  }
}
