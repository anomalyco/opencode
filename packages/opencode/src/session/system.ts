import { App } from "../app/app"
import { Ripgrep } from "../external/ripgrep"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import path from "path"
import os from "os"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_SUMMARIZE from "./prompt/summarize.txt"
import PROMPT_TITLE from "./prompt/title.txt"

export namespace SystemPrompt {
  export function provider(providerID: string) {
    const result = []
    switch (providerID) {
      case "anthropic":
        result.push(PROMPT_ANTHROPIC_SPOOF.trim())
        result.push(PROMPT_ANTHROPIC)
        break
      default:
        result.push(PROMPT_ANTHROPIC)
        break
    }
    return result
  }

  export async function environment() {
    const app = App.info()

    ;async () => {
      const files = await Ripgrep.files({
        cwd: app.path.cwd,
      })
      type Node = {
        children: Record<string, Node>
      }
      const root: Node = {
        children: {},
      }
      for (const file of files) {
        const parts = file.split("/")
        let node = root
        for (const part of parts) {
          const existing = node.children[part]
          if (existing) {
            node = existing
            continue
          }
          node.children[part] = {
            children: {},
          }
          node = node.children[part]
        }
      }

      function render(path: string[], node: Node): string {
        // if (path.length === 3) return "\t".repeat(path.length) + "..."
        const lines: string[] = []
        const entries = Object.entries(node.children).sort(([a], [b]) =>
          a.localeCompare(b),
        )

        for (const [name, child] of entries) {
          const currentPath = [...path, name]
          const indent = "\t".repeat(path.length)
          const hasChildren = Object.keys(child.children).length > 0
          lines.push(`${indent}${name}` + (hasChildren ? "/" : ""))

          if (hasChildren) lines.push(render(currentPath, child))
        }

        return lines.join("\n")
      }
      const result = render([], root)
      return result
    }

    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${app.path.cwd}`,
        `  Is directory a git repo: ${app.git ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        // `<project>`,
        // `  ${app.git ? await tree() : ""}`,
        // `</project>`,
      ].join("\n"),
    ]
  }

  const CUSTOM_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    path.join(".github", "copilot-instructions.md"),
    "CONTEXT.md", // deprecated
  ]
  export async function custom() {
    const { cwd, root } = App.info().path
    const found = []
    for (const item of CUSTOM_FILES) {
      const matches = await Filesystem.findUp(item, cwd, root)
      found.push(...matches.map((x) => Bun.file(x).text()))
    }
    found.push(
      Bun.file(path.join(Global.Path.config, "AGENTS.md"))
        .text()
        .catch(() => ""),
    )
    found.push(
      Bun.file(path.join(os.homedir(), ".claude", "CLAUDE.md"))
        .text()
        .catch(() => ""),
    )
    return Promise.all(found).then((result) => result.filter(Boolean))
  }

  export function summarize(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_SUMMARIZE]
      default:
        return [PROMPT_SUMMARIZE]
    }
  }

  export function title(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_TITLE]
      default:
        return [PROMPT_TITLE]
    }
  }
}
