import path from "path"
import { which } from "@/util/which"

export interface CommandMapping {
  pattern: RegExp
  replace: string | ((match: string, ...args: any[]) => string)
  description?: string
}

export interface ShellTransformer {
  name: string
  test: (shellPath: string) => boolean
  transform: (command: string) => string
}

export class CommandTransformer {
  private static readonly unixToPowerShell: CommandMapping[] = [
    // export VAR=value VAR2=value2
    {
      pattern: /(^|\s|;|\|\||&&)export\s+([^;&|]+)/,
      replace: (match: string, prefix: string, rest: string) => {
        const assignments = rest.trim().split(/\s+/).filter(Boolean)
        const psAssignments = assignments.map((a: string) => {
          const [varName, ...valParts] = a.split("=")
          const value = valParts.join("=")
          return `$env:${varName}=${value}`
        })
        return prefix + psAssignments.join("; ")
      },
      description: "Convert environment variable assignments to PowerShell syntax",
    },
    // ls
    {
      pattern: /(^|\s|;|\|\||&&)ls\b/,
      replace: "$1Get-ChildItem",
      description: "List directory contents",
    },
    // ls -la
    {
      pattern: /(^|\s|;|\|\||&&)ls\s+(-[a-zA-Z]+)/,
      replace: "$1Get-ChildItem $2",
      description: "List directory with options",
    },
    // rm -rf
    {
      pattern: /(^|\s|;|\|\||&&)rm\s+-rf\s+(\S+)/,
      replace: "$1Remove-Item -Recurse -Force $2",
      description: "Remove directory recursively and forcefully",
    },
    // rm
    {
      pattern: /(^|\s|;|\|\||&&)rm\s+(\S+)/,
      replace: "$1Remove-Item $2",
      description: "Remove item",
    },
    // mkdir -p
    {
      pattern: /(^|\s|;|\|\||&&)mkdir\s+-p\s+(\S+)/,
      replace: (match) => `${match[1]}New-Item -ItemType Directory -Force ${match[2]}`,
      description: "Create directory with parent directories",
    },
    // mkdir
    {
      pattern: /(^|\s|;|\|\||&&)mkdir\s+(\S+)/,
      replace: (match) => `${match[1]}New-Item -ItemType Directory ${match[2]}`,
      description: "Create directory",
    },
    // touch
    {
      pattern: /(^|\s|;|\|\||&&)touch\s+(\S+)/,
      replace: (match) => `${match[1]}New-Item -ItemType File ${match[2]}`,
      description: "Create empty file",
    },
    // cat
    {
      pattern: /(^|\s|;|\|\||&&)cat\s+(\S+)/,
      replace: (match) => `${match[1]}Get-Content ${match[2]}`,
      description: "Display file contents",
    },
    // cp src dst
    {
      pattern: /(^|\s|;|\|\||&&)cp\s+(\S+)\s+(\S+)/,
      replace: (match) => `${match[1]}Copy-Item ${match[2]} ${match[3]}`,
      description: "Copy file",
    },
    // cp src
    {
      pattern: /(^|\s|;|\|\||&&)cp\s+(\S+)/,
      replace: (match) => `${match[1]}Copy-Item ${match[2]}`,
      description: "Copy item",
    },
    // mv src dst
    {
      pattern: /(^|\s|;|\|\||&&)mv\s+(\S+)\s+(\S+)/,
      replace: (match) => `${match[1]}Move-Item ${match[2]} ${match[3]}`,
      description: "Move item",
    },
    // mv src
    {
      pattern: /(^|\s|;|\|\||&&)mv\s+(\S+)/,
      replace: (match) => `${match[1]}Move-Item ${match[2]}`,
      description: "Move item",
    },
    // grep pattern file
    {
      pattern: /(^|\s|;|\|\||&&)grep\s+(\S+)\s+(\S+)/,
      replace: (match) => `${match[1]}Select-String -Pattern ${match[2]} -Path ${match[3]}`,
      description: "Search for pattern in file",
    },
    // grep pattern
    {
      pattern: /(^|\s|;|\|\||&&)grep\s+(\S+)/,
      replace: (match) => `${match[1]}Select-String -Pattern ${match[2]}`,
      description: "Search for pattern",
    },
    // which
    {
      pattern: /(^|\s|;|\|\||&&)which\s+(\S+)/,
      replace: (match) => `${match[1]}Get-Command ${match[2]} | Select-Object -ExpandProperty Source`,
      description: "Find command location",
    },
    // pwd
    {
      pattern: /(^|\s|;|\|\||&&)pwd\b/,
      replace: (match) => `${match[1]}Get-Location`,
      description: "Print working directory",
    },
    // echo (preserve for compatibility)
    {
      pattern: /(^|\s|;|\|\||&&)echo\s+(.+)/,
      replace: (match) => `${match[1]}Write-Output ${match[2]}`,
      description: "Output text",
    },
  ]

  private static readonly unixToCmd: CommandMapping[] = [
    // export VAR=value VAR2=value2
    {
      pattern: /(^|\s|;|\|\||&&)export\s+([^;&|]+)/,
      replace: (match: string, prefix: string, rest: string) => {
        const assignments = rest.trim().split(/\s+/).filter(Boolean)
        const cmdAssignments = assignments.map((a: string) => {
          const [varName, ...valParts] = a.split("=")
          const value = valParts.join("=")
          return `set ${varName}=${value}`
        })
        return prefix + cmdAssignments.join(" && ")
      },
      description: "Convert environment variable assignments to CMD syntax",
    },
    // ls
    {
      pattern: /(^|\s|;|\|\||&&)ls\b/,
      replace: (match) => `${match[1]}dir`,
      description: "List directory contents",
    },
    // ls -la
    {
      pattern: /(^|\s|;|\|\||&&)ls\s+(-[a-zA-Z]+)/,
      replace: (match) => `${match[1]}dir ${match[2]}`,
      description: "List directory with options",
    },
    // rm -rf
    {
      pattern: /(^|\s|;|\|\||&&)rm\s+-rf\s+(\S+)/,
      replace: (match) => `${match[1]}rmdir /s /q ${match[2]}`,
      description: "Remove directory recursively and quietly",
    },
    // rm
    {
      pattern: /(^|\s|;|\|\||&&)rm\s+(\S+)/,
      replace: (match) => `${match[1]}del ${match[2]}`,
      description: "Delete file",
    },
    // mkdir -p
    {
      pattern: /(^|\s|;|\|\||&&)mkdir\s+-p\s+(\S+)/,
      replace: (match) => `${match[1]}mkdir ${match[2]}`,
      description: "Create directory",
    },
    // mkdir
    {
      pattern: /(^|\s|;|\|\||&&)mkdir\s+(\S+)/,
      replace: (match) => `${match[1]}mkdir ${match[2]}`,
      description: "Create directory",
    },
    // touch
    {
      pattern: /(^|\s|;|\|\||&&)touch\s+(\S+)/,
      replace: (match) => `${match[1]}type nul > ${match[2]}`,
      description: "Create empty file",
    },
    // cat
    {
      pattern: /(^|\s|;|\|\||&&)cat\s+(\S+)/,
      replace: (match) => `${match[1]}type ${match[2]}`,
      description: "Display file contents",
    },
    // cp src dst
    {
      pattern: /(^|\s|;|\|\||&&)cp\s+(\S+)\s+(\S+)/,
      replace: (match) => `${match[1]}copy ${match[2]} ${match[3]}`,
      description: "Copy file",
    },
    // cp src
    {
      pattern: /(^|\s|;|\|\||&&)cp\s+(\S+)/,
      replace: (match) => `${match[1]}copy ${match[2]}`,
      description: "Copy item",
    },
    // mv src dst
    {
      pattern: /(^|\s|;|\|\||&&)mv\s+(\S+)\s+(\S+)/,
      replace: (match) => `${match[1]}move ${match[2]} ${match[3]}`,
      description: "Move item",
    },
    // mv src
    {
      pattern: /(^|\s|;|\|\||&&)mv\s+(\S+)/,
      replace: (match) => `${match[1]}move ${match[2]}`,
      description: "Move item",
    },
    // grep pattern file
    {
      pattern: /(^|\s|;|\|\||&&)grep\s+(\S+)\s+(\S+)/,
      replace: (match) => `${match[1]}findstr ${match[2]} ${match[3]}`,
      description: "Search for pattern in file",
    },
    // grep pattern
    {
      pattern: /(^|\s|;|\|\||&&)grep\s+(\S+)/,
      replace: (match) => `${match[1]}findstr ${match[2]}`,
      description: "Search for pattern",
    },
    // which
    {
      pattern: /(^|\s|;|\|\||&&)which\s+(\S+)/,
      replace: (match) => `${match[1]}where ${match[2]}`,
      description: "Find command location",
    },
    // pwd
    {
      pattern: /(^|\s|;|\|\||&&)pwd\b/,
      replace: (match) => `${match[1]}cd`,
      description: "Print working directory",
    },
    // echo (preserve for compatibility)
    {
      pattern: /(^|\s|;|\|\||&&)echo\s+(.+)/,
      replace: (match) => `${match[1]}echo ${match[2]}`,
      description: "Output text",
    },
  ]

  static getShellType(shellPath: string): "bash" | "powershell" | "cmd" | "unknown" {
    const name = path.win32.basename(shellPath).toLowerCase()

    // Check for bash (including various forms)
    if (
      name === "bash.exe" ||
      name === "sh.exe" ||
      name === "zsh.exe" ||
      name === "bash" ||
      name === "sh" ||
      name === "zsh" ||
      name.includes("bash") ||
      name.includes("sh") ||
      name.includes("zsh")
    ) {
      return "bash"
    }

    // Check for PowerShell
    if (
      name === "powershell.exe" ||
      name === "pwsh.exe" ||
      name === "powershell" ||
      name === "pwsh" ||
      name.includes("powershell") ||
      name.includes("pwsh")
    ) {
      return "powershell"
    }

    // Check for CMD
    if (name === "cmd.exe" || name === "cmd" || name.includes("cmd")) {
      return "cmd"
    }

    return "unknown"
  }

  static transformCommand(command: string, shellPath: string): string {
    if (process.platform !== "win32") {
      return command
    }

    const shellType = this.getShellType(shellPath)

    if (shellType === "bash" || shellType === "unknown") {
      return command
    }

    let transformed = command
    const mappings = shellType === "powershell" ? this.unixToPowerShell : this.unixToCmd

    // Apply transformations in order
    for (const mapping of mappings) {
      if (typeof mapping.replace === "string") {
        transformed = transformed.replace(mapping.pattern, mapping.replace)
      } else {
        transformed = transformed.replace(mapping.pattern, mapping.replace)
      }
    }

    return transformed
  }

  static detectShell(): string {
    if (process.platform === "win32") {
      // Check for bash first
      const bash = which("bash")
      if (bash) return bash

      // Check for PowerShell
      const powershell = which("powershell") || which("pwsh")
      if (powershell) return powershell

      // Fallback to CMD
      return process.env.COMSPEC || "cmd.exe"
    }

    // Unix-like systems
    const shell = process.env.SHELL
    if (shell) return shell

    return which("bash") || "/bin/bash"
  }
}
