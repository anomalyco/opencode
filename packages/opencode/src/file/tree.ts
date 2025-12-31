// File tree utilities
import path from "path"
import { $ } from "bun"
import { Log } from "@/util/log"

export namespace FileTree {
  const log = Log.create({ service: "file.tree" })

  /**
   * Generates a tree structure of files in a git repository.
   *
   * We use `git ls-files` instead of ripgrep for file discovery because ripgrep
   * performs a full filesystem scan before applying any limits. In large repositories
   * (40k+ files), this causes multi-second delays even when we only need 200 files
   * for the tree output.
   *
   * `git ls-files --cached --others --exclude-standard` leverages git's index,
   * which is essentially a pre-built file list. This makes it nearly instantaneous
   * regardless of repository size (~1ms vs ~8s for 42k files).
   *
   * The flags ensure we get both tracked (--cached) and untracked (--others) files
   * while respecting .gitignore rules (--exclude-standard).
   */
  export async function tree(input: { cwd: string; limit?: number }) {
    log.info("tree", input)
    const limit = input.limit ?? 200

    const git = await $`git ls-files --cached --others --exclude-standard`.cwd(input.cwd).quiet().nothrow()
    if (git.exitCode !== 0) {
      return ""
    }
    const files = git.text().trim().split(/\r?\n/).filter(Boolean).slice(0, limit * 10)

    interface Node {
      path: string[]
      children: Node[]
    }

    function getPath(node: Node, parts: string[], create: boolean) {
      if (parts.length === 0) return node
      let current = node
      for (const part of parts) {
        let existing = current.children.find((x) => x.path.at(-1) === part)
        if (!existing) {
          if (!create) return
          existing = {
            path: current.path.concat(part),
            children: [],
          }
          current.children.push(existing)
        }
        current = existing
      }
      return current
    }

    const root: Node = {
      path: [],
      children: [],
    }
    for (const file of files) {
      if (file.includes(".opencode")) continue
      const parts = file.split(path.sep)
      getPath(root, parts, true)
    }

    function sort(node: Node) {
      node.children.sort((a, b) => {
        if (!a.children.length && b.children.length) return 1
        if (!b.children.length && a.children.length) return -1
        return a.path.at(-1)!.localeCompare(b.path.at(-1)!)
      })
      for (const child of node.children) {
        sort(child)
      }
    }
    sort(root)

    let current = [root]
    const result: Node = {
      path: [],
      children: [],
    }

    let processed = 0
    while (current.length > 0) {
      const next = []
      for (const node of current) {
        if (node.children.length) next.push(...node.children)
      }
      const max = Math.max(...current.map((x) => x.children.length))
      for (let i = 0; i < max && processed < limit; i++) {
        for (const node of current) {
          const child = node.children[i]
          if (!child) continue
          getPath(result, child.path, true)
          processed++
          if (processed >= limit) break
        }
      }
      if (processed >= limit) {
        for (const node of [...current, ...next]) {
          const compare = getPath(result, node.path, false)
          if (!compare) continue
          if (compare?.children.length !== node.children.length) {
            const diff = node.children.length - compare.children.length
            compare.children.push({
              path: compare.path.concat(`[${diff} truncated]`),
              children: [],
            })
          }
        }
        break
      }
      current = next
    }

    const lines: string[] = []

    function render(node: Node, depth: number) {
      const indent = "\t".repeat(depth)
      lines.push(indent + node.path.at(-1) + (node.children.length ? "/" : ""))
      for (const child of node.children) {
        render(child, depth + 1)
      }
    }
    result.children.map((x) => render(x, 0))

    return lines.join("\n")
  }
}
