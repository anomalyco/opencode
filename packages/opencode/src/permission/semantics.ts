import { BashArity } from "./arity"

export namespace CommandSemantics {
  export type Category = "read" | "write" | "destructive" | "network" | "system"
  export type Action = "allow" | "deny" | "ask"
  export type Policy = {
    [key: string]: Action | undefined
    read?: Action
    write?: Action
    destructive?: Action
    network?: Action
    system?: Action
  }

  // Classification rules sorted by prefix length descending (longest match wins)
  const READ_COMMANDS = new Set([
    "git status",
    "git log",
    "git diff",
    "git show",
    "git branch",
    "npm list",
    "bun pm ls",
    "docker ps",
    "docker images",
    "docker logs",
    "kubectl get",
    "kubectl describe",
    "kubectl logs",
    "cat",
    "head",
    "tail",
    "less",
    "more",
    "grep",
    "rg",
    "find",
    "ls",
    "pwd",
    "which",
    "wc",
    "echo",
    "env",
    "printenv",
    "date",
    "uname",
    "whoami",
    "id",
    "file",
    "stat",
    "du",
    "df",
    "top",
    "ps",
    "lsof",
  ])

  const WRITE_COMMANDS = new Set([
    "git add",
    "git commit",
    "git checkout",
    "git switch",
    "git merge",
    "git rebase",
    "git cherry-pick",
    "git push",
    "npm install",
    "bun add",
    "cargo build",
    "pnpm add",
    "yarn add",
    "pip install",
    "docker build",
    "docker run",
    "kubectl apply",
    "touch",
    "mkdir",
    "cp",
    "mv",
    "tee",
    "write",
    "make",
  ])

  const DESTRUCTIVE_COMMANDS = new Set([
    "git push --force",
    "git push -f",
    "git reset --hard",
    "git clean",
    "git branch -D",
    "docker rm",
    "docker rmi",
    "docker system prune",
    "kubectl delete",
    "kill -9",
    "killall -9",
    "sudo rm",
    "rm",
    "rmdir",
    "shred",
    "truncate",
    "dd",
    "mkfs",
    "fdisk",
    "DROP",
    "DELETE",
  ])

  const NETWORK_COMMANDS = new Set([
    "npm publish",
    "docker pull",
    "docker push",
    "git fetch",
    "git pull",
    "git clone",
    "gh",
    "curl",
    "wget",
    "ssh",
    "scp",
    "rsync",
    "nc",
    "netcat",
    "ping",
    "traceroute",
    "dig",
    "nslookup",
    "host",
  ])

  const SYSTEM_COMMANDS = new Set([
    "sudo",
    "chown",
    "chmod",
    "chgrp",
    "systemctl",
    "service",
    "mount",
    "umount",
    "iptables",
    "ufw",
    "crontab",
    "useradd",
    "userdel",
    "groupadd",
  ])

  function hasForceFlag(tokens: string[]): boolean {
    // --force is always a force flag
    if (tokens.includes("--force")) return true

    // -f is only force when it appears after other flags or at the start
    // Commands like "git push -f" or "git push --force" are destructive
    // But "kubectl apply -f file.yaml" uses -f for filename
    // Heuristic: -f is force if preceded by another flag or appears early as the only flag
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === "-f") {
        // Check if previous token is a flag (starts with -)
        const prevToken = tokens[i - 1]
        if (prevToken && prevToken.startsWith("-")) {
          // -f after another flag is likely force
          return true
        }
        // For commands like "git push -f", -f at position 2 is force
        // For "kubectl apply -f file", -f at position 2 is filename
        // The difference: git push arity is 2, so tokens after are flags/args
        // kubectl apply arity is 2, so -f at position 2 could be either
        // Simple heuristic: if -f is at position 2 and next token doesn't start with -, it's likely a value
        if (i === 2 && tokens[i + 1] && !tokens[i + 1].startsWith("-")) {
          // Next token is a value, so -f is likely a flag taking that value
          // Check if common commands that use -f for filename
          const cmdPrefix = tokens.slice(0, 2).join(" ")
          const filenameFlags = ["kubectl apply", "kubectl create", "kubectl delete", "docker run", "docker build"]
          if (filenameFlags.some((f) => cmdPrefix.startsWith(f))) {
            continue // Not a force flag
          }
          return true
        }
        return true
      }
    }
    return false
  }

  export function classify(tokens: string[]): Category {
    if (tokens.length === 0) return "write"

    const commandStr = tokens.join(" ")

    // Check destructive commands first (including those with --force/-f)
    for (const cmd of DESTRUCTIVE_COMMANDS) {
      if (commandStr.startsWith(cmd)) {
        return "destructive"
      }
    }

    // Check for --force/-f escalation on write commands
    const prefix = BashArity.prefix(tokens)
    const prefixStr = prefix.join(" ")
    if (WRITE_COMMANDS.has(prefixStr) && hasForceFlag(tokens)) {
      return "destructive"
    }

    // Check other categories by prefix length (longest match wins)
    const allCommands = [...READ_COMMANDS, ...WRITE_COMMANDS, ...NETWORK_COMMANDS, ...SYSTEM_COMMANDS]

    // Sort by length descending to match longest prefix first
    const sortedCommands = [...allCommands].sort((a, b) => b.length - a.length)

    for (const cmd of sortedCommands) {
      if (commandStr.startsWith(cmd)) {
        if (READ_COMMANDS.has(cmd)) return "read"
        if (WRITE_COMMANDS.has(cmd)) return "write"
        if (NETWORK_COMMANDS.has(cmd)) return "network"
        if (SYSTEM_COMMANDS.has(cmd)) return "system"
      }
    }

    // Default for unknown commands
    return "write"
  }

  export function classifyCommand(command: string): Category {
    const tokens = command.trim().split(/\s+/)
    return classify(tokens)
  }

  export function defaultPolicy(): Policy {
    return {
      read: "allow",
      write: "ask",
      destructive: "ask",
      network: "ask",
      system: "ask",
    }
  }

  export function planAgentPolicy(): Policy {
    return {
      read: "allow",
      write: "deny",
      destructive: "deny",
      network: "ask",
      system: "deny",
    }
  }

  export function exploreAgentPolicy(): Policy {
    return {
      read: "allow",
      write: "ask",
      destructive: "deny",
      network: "allow",
      system: "deny",
    }
  }

  export function getPermissionAction(category: Category, policy: Policy, tokens?: string[]): Action {
    // Check for command-specific overrides using prefix
    if (tokens && tokens.length > 0) {
      const prefix = BashArity.prefix(tokens)
      const prefixStr = prefix.join(" ")
      if (policy[prefixStr] !== undefined) {
        return policy[prefixStr]
      }
    }

    // Fall back to category default
    return policy[category] ?? "ask"
  }

  export function label(category: Category): { text: string; emoji: string } {
    switch (category) {
      case "read":
        return { text: "READ", emoji: "📖" }
      case "write":
        return { text: "WRITE", emoji: "✏️" }
      case "destructive":
        return { text: "DESTRUCTIVE", emoji: "💥" }
      case "network":
        return { text: "NETWORK", emoji: "🌐" }
      case "system":
        return { text: "SYSTEM", emoji: "⚙️" }
    }
  }
}
