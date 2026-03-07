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
      replace: (match: string, p1: string) => `${p1}Get-ChildItem`,
      description: "List directory contents",
    },
    // ls -la
    {
      pattern: /(^|\s|;|\|\||&&)ls\s+(-[a-zA-Z]+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}Get-ChildItem ${p2}`,
      description: "List directory with options",
    },
    // rm -rf
    {
      pattern: /(^|\s|;|\|\||&&)rm\s+-rf\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}Remove-Item -Recurse -Force ${p2}`,
      description: "Remove directory recursively and forcefully",
    },
    // rm
    {
      pattern: /(^|\s|;|\|\||&&)rm\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}Remove-Item ${p2}`,
      description: "Remove item",
    },
    // mkdir -p
    {
      pattern: /(^|\s|;|\|\||&&)mkdir\s+-p\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}New-Item -ItemType Directory -Force ${p2}`,
      description: "Create directory with parent directories",
    },
    // mkdir
    {
      pattern: /(^|\s|;|\|\||&&)mkdir\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}New-Item -ItemType Directory ${p2}`,
      description: "Create directory",
    },
    // touch
    {
      pattern: /(^|\s|;|\|\||&&)touch\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}New-Item -ItemType File ${p2}`,
      description: "Create empty file",
    },
    // cat
    {
      pattern: /(^|\s|;|\|\||&&)cat\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}Get-Content ${p2}`,
      description: "Display file contents",
    },
    // cp src dst
    {
      pattern: /(^|\s|;|\|\||&&)cp\s+(\S+)\s+(\S+)/,
      replace: (match: string, p1: string, p2: string, p3: string) => `${p1}Copy-Item ${p2} ${p3}`,
      description: "Copy file",
    },
    // cp src
    {
      pattern: /(^|\s|;|\|\||&&)cp\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}Copy-Item ${p2}`,
      description: "Copy item",
    },
    // mv src dst
    {
      pattern: /(^|\s|;|\|\||&&)mv\s+(\S+)\s+(\S+)/,
      replace: (match: string, p1: string, p2: string, p3: string) => `${p1}Move-Item ${p2} ${p3}`,
      description: "Move item",
    },
    // mv src
    {
      pattern: /(^|\s|;|\|\||&&)mv\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}Move-Item ${p2}`,
      description: "Move item",
    },
    // grep pattern file
    {
      pattern: /(^|\s|;|\|\||&&)grep\s+(\S+)\s+(\S+)/,
      replace: (match: string, p1: string, p2: string, p3: string) => `${p1}Select-String -Pattern ${p2} -Path ${p3}`,
      description: "Search for pattern in file",
    },
    // grep pattern
    {
      pattern: /(^|\s|;|\|\||&&)grep\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}Select-String -Pattern ${p2}`,
      description: "Search for pattern",
    },
    // which
    {
      pattern: /(^|\s|;|\|\||&&)which\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) =>
        `${p1}Get-Command ${p2} | Select-Object -ExpandProperty Source`,
      description: "Find command location",
    },
    // pwd
    {
      pattern: /(^|\s|;|\|\||&&)pwd\b/,
      replace: (match: string, p1: string) => `${p1}Get-Location`,
      description: "Print working directory",
    },
    // echo (preserve for compatibility)
    {
      pattern: /(^|\s|;|\|\||&&)echo\s+(.+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}Write-Output ${p2}`,
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
      replace: (match: string, p1: string) => `${p1}dir`,
      description: "List directory contents",
    },
    // ls -la
    {
      pattern: /(^|\s|;|\|\||&&)ls\s+(-[a-zA-Z]+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}dir ${p2}`,
      description: "List directory with options",
    },
    // rm -rf
    {
      pattern: /(^|\s|;|\|\||&&)rm\s+-rf\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}rmdir /s /q ${p2}`,
      description: "Remove directory recursively and quietly",
    },
    // rm
    {
      pattern: /(^|\s|;|\|\||&&)rm\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}del ${p2}`,
      description: "Delete file",
    },
    // mkdir -p
    {
      pattern: /(^|\s|;|\|\||&&)mkdir\s+-p\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}mkdir ${p2}`,
      description: "Create directory",
    },
    // mkdir
    {
      pattern: /(^|\s|;|\|\||&&)mkdir\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}mkdir ${p2}`,
      description: "Create directory",
    },
    // touch
    {
      pattern: /(^|\s|;|\|\||&&)touch\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}type nul > ${p2}`,
      description: "Create empty file",
    },
    // cat
    {
      pattern: /(^|\s|;|\|\||&&)cat\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}type ${p2}`,
      description: "Display file contents",
    },
    // cp src dst
    {
      pattern: /(^|\s|;|\|\||&&)cp\s+(\S+)\s+(\S+)/,
      replace: (match: string, p1: string, p2: string, p3: string) => `${p1}copy ${p2} ${p3}`,
      description: "Copy file",
    },
    // cp src
    {
      pattern: /(^|\s|;|\|\||&&)cp\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}copy ${p2}`,
      description: "Copy item",
    },
    // mv src dst
    {
      pattern: /(^|\s|;|\|\||&&)mv\s+(\S+)\s+(\S+)/,
      replace: (match: string, p1: string, p2: string, p3: string) => `${p1}move ${p2} ${p3}`,
      description: "Move item",
    },
    // mv src
    {
      pattern: /(^|\s|;|\|\||&&)mv\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}move ${p2}`,
      description: "Move item",
    },
    // grep pattern file
    {
      pattern: /(^|\s|;|\|\||&&)grep\s+(\S+)\s+(\S+)/,
      replace: (match: string, p1: string, p2: string, p3: string) => `${p1}findstr ${p2} ${p3}`,
      description: "Search for pattern in file",
    },
    // grep pattern
    {
      pattern: /(^|\s|;|\|\||&&)grep\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}findstr ${p2}`,
      description: "Search for pattern",
    },
    // which
    {
      pattern: /(^|\s|;|\|\||&&)which\s+(\S+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}where ${p2}`,
      description: "Find command location",
    },
    // pwd
    {
      pattern: /(^|\s|;|\|\||&&)pwd\b/,
      replace: (match: string, p1: string) => `${p1}cd`,
      description: "Print working directory",
    },
    // echo (preserve for compatibility)
    {
      pattern: /(^|\s|;|\|\||&&)echo\s+(.+)/,
      replace: (match: string, p1: string, p2: string) => `${p1}echo ${p2}`,
      description: "Output text",
    },
  ]

  static getShellType(shellPath: string): "bash" | "powershell" | "cmd" | "unknown" {
    const name = path.win32.basename(shellPath).toLowerCase()

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

    // Check for bash (including various forms)
    if (
      name === "bash.exe" ||
      name === "sh.exe" ||
      name === "zsh.exe" ||
      name === "bash" ||
      name === "sh" ||
      name === "zsh" ||
      name.includes("bash") ||
      name.includes("zsh")
    ) {
      return "bash"
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
