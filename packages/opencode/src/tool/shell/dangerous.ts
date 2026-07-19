import type { Node } from "web-tree-sitter"

type ShellType = "bash" | "ps" | "cmd"

interface BlockedEntry {
  commands: string[]
  reason: string
}

const BLOCKED: Record<ShellType, BlockedEntry[]> = {
  bash: [
    {
      commands: ["rm", "rmdir"],
      reason:
        "File/directory deletion via shell is irreversible. Use the dedicated Read/Edit tools.",
    },
    {
      commands: ["mv"],
      reason:
        "mv can overwrite files and delete the source, which is irreversible. Use cp instead.",
    },
    {
      commands: ["ren", "rename"],
      reason:
        "Renaming can overwrite existing files. Use cp instead.",
    },
    {
      commands: ["sed"],
      reason:
        "sed -i performs in-place file editing. Use the Edit tool instead.",
    },
    {
      commands: ["truncate", "tee"],
      reason:
        "File modification via shell is blocked. Use the dedicated Write/Edit tools.",
    },
    {
      commands: ["dd", "format", "mkfs", "fdisk", "parted", "diskpart"],
      reason:
        "Disk-level operations are blocked as they can cause irreversible data loss.",
    },
  ],
  ps: [
    {
      commands: ["remove-item", "ri", "rm", "del", "erase", "rd", "rmdir"],
      reason:
        "File/directory deletion via PowerShell is irreversible.",
    },
    {
      commands: ["move-item", "mi", "mv", "move"],
      reason:
        "Move operations can overwrite files and delete the source. Use Copy-Item instead.",
    },
    {
      commands: ["rename-item", "rni", "ren", "rename"],
      reason:
        "Renaming can overwrite existing files. Use Copy-Item instead.",
    },
    {
      commands: ["set-content", "sc", "add-content", "ac"],
      reason:
        "File content modification via PowerShell is blocked. Use the dedicated Write/Edit tools.",
    },
    {
      commands: ["clear-content", "clc", "clear-item", "cli"],
      reason:
        "Content clearing via PowerShell is blocked.",
    },
    {
      commands: ["format-volume", "format-disk"],
      reason:
        "Volume formatting is blocked as it causes irreversible data loss.",
    },
  ],
  cmd: [
    {
      commands: ["del", "erase", "rd", "rmdir"],
      reason:
        "File/directory deletion via cmd is irreversible.",
    },
    {
      commands: ["move", "ren", "rename"],
      reason:
        "Move/rename operations can overwrite files. Use copy instead.",
    },
    {
      commands: ["format"],
      reason:
        "Format operation is blocked as it causes irreversible data loss.",
    },
  ],
}

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

export function checkCommand(root: Node, ps: boolean, cmd: boolean): string | undefined {
  const shell: ShellType = cmd ? "cmd" : ps ? "ps" : "bash"
  const entries = BLOCKED[shell]

  for (const node of commands(root)) {
    const commandName = node.child(0)
    const name = commandName?.text.toLowerCase().trim()
    if (!name) continue

    for (const entry of entries) {
      if (!entry.commands.includes(name)) continue

      if (name === "sed") {
        if (!node.text.includes("-i")) continue
      }

      return `Command blocked: "${node.text.trim()}"
Reason: ${entry.reason}
Suggestion: Use the dedicated opencode tools (Write, Edit, Read) instead of shell commands for file operations.
Do not attempt to bypass this restriction using indirect methods like eval, exec, or scripts.`
    }
  }

  if (!ps) {
    const redirectStats = root.descendantsOfType("redirected_statement")
    for (const rs of redirectStats) {
      for (let i = 0; i < rs.childCount; i++) {
        const child = rs.child(i)
        if (!child || child.type !== "file_redirect") continue
        const op = child.child(0)?.text
        if (op === ">" || op === ">|" || op === ">>" || op === "&>") {
          return `Command blocked: shell redirect "${
            op
          }" writes to files
Reason: Writing to files via shell redirect is blocked. Use the Write tool for file creation and the Edit tool for modifications.
Suggestion: Use the dedicated opencode tools instead.`
        }
      }
    }
  }

  return undefined
}
