import { $ } from "bun"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import type { Config } from "../../src/config/config"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

let gitTemplatePromise: Promise<string> | undefined
async function getGitTemplate() {
  if (gitTemplatePromise) return gitTemplatePromise
  gitTemplatePromise = (async () => {
    const templatePath = path.join(
      os.tmpdir(),
      "opencode-git-template-" + process.pid + "-" + Math.random().toString(36).slice(2),
    )
    await fs.mkdir(templatePath, { recursive: true })

    // Retry logic to handle Windows CI resource exhaustion
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await $`git init`.cwd(templatePath).quiet()
        await $`git config core.longpaths true`.cwd(templatePath).quiet()
        await $`git config core.symlinks true`.cwd(templatePath).quiet()
        await $`git commit --allow-empty -m "root commit"`.cwd(templatePath).quiet()
        break // Success
      } catch (err) {
        if (attempt === 5) throw err
        // Wait before retrying to let other processes finish
        await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000))
      }
    }

    return templatePath
  })()
  return gitTemplatePromise
}

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<Config.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    const templatePath = await getGitTemplate()
    await fs.cp(templatePath, dirpath, { recursive: true })

    // Write a unique project ID to .git/opencode so that projects sharing the exact same
    // git template commit hash don't incorrectly collide in the test Database.
    await fs.writeFile(path.join(dirpath, ".git", "opencode"), "test-id-" + Math.random().toString(36).slice(2))
  }
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        ...options.config,
      }),
    )
  }
  const extra = await options?.init?.(dirpath)
  const realpath = sanitizePath(await fs.realpath(dirpath))
  const result = {
    [Symbol.asyncDispose]: async () => {
      await options?.dispose?.(dirpath)
      // await fs.rm(dirpath, { recursive: true, force: true })
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}
