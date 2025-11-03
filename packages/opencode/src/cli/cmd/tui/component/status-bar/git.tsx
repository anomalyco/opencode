import { createSignal, createEffect, onCleanup } from "solid-js"
import { $ } from "bun"
import { watch } from "fs"

export function useGitBranch() {
  const [branch, setBranch] = createSignal<string>("")

  createEffect(async () => {
    const gitCheck = await $`git rev-parse --is-inside-work-tree`
      .cwd(process.cwd())
      .quiet()
      .nothrow()
    if (gitCheck.exitCode === 0) {
      const b = await $`git branch --show-current`.cwd(process.cwd()).quiet().nothrow().text()
      setBranch(b.trim())

      // Set up watcher for .git/HEAD
      const gitHeadPath = `${process.cwd()}/.git/HEAD`
      const watcher = watch(gitHeadPath, { persistent: false }, async () => {
        const newBranch = await $`git branch --show-current`
          .cwd(process.cwd())
          .quiet()
          .nothrow()
          .text()
        setBranch(newBranch.trim())
      })
      onCleanup(() => watcher.close())
    }
  })

  return { branch }
}
