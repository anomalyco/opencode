/**
 * Destructive Command Check Plugin for OpenCode
 *
 * Automatically checks for destructive commands before any tool/bash call.
 * This plugin runs for all sessions and agents, protecting against potentially
 * harmful operations by asking for user permission.
 *
 * Destructive patterns detected:
 * - rm -rf, rm -fr, rm -r with dangerous paths
 * - git push --force, git reset (--hard/--soft/--mixed) moving HEAD
 * - DROP TABLE, DELETE FROM, TRUNCATE
 * - chmod 777, chown on system dirs
 * - dd commands
 * - format/mkfs commands
 * - sudo rm, sudo chmod, sudo chown
 * - kubectl delete, docker rm -f
 * - aws s3 rm --recursive
 * - echo/cat/printf > ~/.env (file overwrite via shell redirect)
 *
 * The plugin will:
 * 1. Detect destructive patterns in bash commands
 * 2. Detect destructive file operations (deleting important files)
 * 3. Ask for user permission before executing dangerous operations
 *
 * Installation:
 * Add to your opencode.json config:
 * {
 *   "plugin": ["file:///path/to/.opencode/plugins/destructive-check.ts"]
 * }
 */

import type { Plugin } from "@opencode-ai/plugin"

// Destructive command patterns to check
const DESTRUCTIVE_PATTERNS = {
  // File deletion - dangerous patterns
  rmDangerous: [
    /\brm\s+(-[rRf]+\s+)*[\/~]\s*$/i, // rm / or rm ~
    /\brm\s+(-[rRf]+\s+)*\/\*/, // rm /*
    /\brm\s+(-[rRf]+\s+)*~\/\*/, // rm ~/*
    /\brm\s+(-[rRf]+\s+)*\$HOME\b/i, // rm $HOME
    /\brm\s+(-[rRf]+\s+)*\/home\b/i, // rm /home
    /\brm\s+(-[rRf]+\s+)*\/etc\b/i, // rm /etc
    /\brm\s+(-[rRf]+\s+)*\/var\b/i, // rm /var
    /\brm\s+(-[rRf]+\s+)*\/usr\b/i, // rm /usr
    /\brm\s+(-[rRf]+\s+)*\/bin\b/i, // rm /bin
    /\brm\s+(-[rRf]+\s+)*\/sbin\b/i, // rm /sbin
    /\brm\s+(-[rRf]+\s+)*\/boot\b/i, // rm /boot
    /\brm\s+(-[rRf]+\s+)*\/lib\b/i, // rm /lib
    /\brm\s+(-[rRf]+\s+)*\/opt\b/i, // rm /opt
    /\brm\s+(-[rRf]+\s+)*\/root\b/i, // rm /root
    /\brm\s+(-[rRf]+\s+)*\/sys\b/i, // rm /sys
    /\brm\s+(-[rRf]+\s+)*\/proc\b/i, // rm /proc
    /\brm\s+(-[rRf]+\s+)*\/dev\b/i, // rm /dev
    /\brm\s+(-[rRf]+\s+)*\/mnt\b/i, // rm /mnt
    /\brm\s+(-[rRf]+\s+)*\/tmp\b/i, // rm /tmp
    /\brm\s+(-[rRf]+\s+)*\.git\b/i, // rm .git
    /\brm\s+(-[rRf]+\s+)*node_modules\b/i, // rm node_modules (dangerous in wrong dir)
  ],

  // Git destructive operations
  git: [
    /\bgit\s+push\s+.*--force\b/i, // git push --force
    /\bgit\s+push\s+.*-f\b/i, // git push -f
    // git reset patterns: catch both HEAD movement (rewrites history) and --hard (discards changes)
    /\bgit\s+reset\s+(--hard|--soft|--mixed)?\s*(HEAD|@)[\~\^]/i, // git reset moving HEAD (rewrites commit history)
    /\bgit\s+reset\s+--hard\b/i, // git reset --hard (discards working directory changes)
    /\bgit\s+clean\s+.*-f/i, // git clean -f
    /\bgit\s+checkout\s+--\s+\./i, // git checkout -- .
    /\bgit\s+stash\s+drop/i, // git stash drop
    /\bgit\s+branch\s+.*-D\b/i, // git branch -D
    /\bgit\s+reflog\s+expire/i, // git reflog expire
    /\bgit\s+gc\s+--prune/i, // git gc --prune
  ],

  // Database destructive operations
  database: [
    /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bDELETE\s+FROM\s+\S+\s*(;|\s*$)/i, // DELETE without WHERE
    /\bALTER\s+TABLE\s+\S+\s+DROP\b/i,
  ],

  // System destructive operations
  system: [
    /\bchmod\s+(-R\s+)?777\s+\//i, // chmod 777 /
    /\bchown\s+(-R\s+)?\S+\s+\//i, // chown on root
    /\bdd\s+.*of=\/dev\//i, // dd to device
    /\bmkfs\b/i, // Format filesystem
    /\bformat\s+[a-z]:/i, // Windows format
    /\bfdisk\b/i, // Partition tool
    /\bparted\b/i, // Partition tool
  ],

  // Elevated privileges with destructive commands
  sudo: [
    /\bsudo\s+rm\s+(-[rRf]+\s+)*\//i, // sudo rm on root
    /\bsudo\s+chmod\b/i, // sudo chmod
    /\bsudo\s+chown\b/i, // sudo chown
    /\bsudo\s+dd\b/i, // sudo dd
    /\bsudo\s+mkfs\b/i, // sudo mkfs
  ],

  // Container/cloud destructive operations
  container: [
    /\bkubectl\s+delete\s+(namespace|ns|pod|deployment|service)\b/i,
    /\bdocker\s+rm\s+.*-f/i, // docker rm -f
    /\bdocker\s+system\s+prune\s+.*-a/i, // docker system prune -a
    /\bdocker\s+volume\s+rm\b/i, // docker volume rm
    /\baws\s+s3\s+rm\s+.*--recursive\b/i, // aws s3 rm --recursive
    /\baws\s+ec2\s+terminate-instances\b/i, // terminate EC2
    /\bgcloud\s+.*delete\b/i, // gcloud delete operations
  ],

  // Package manager destructive operations
  packages: [
    /\bnpm\s+cache\s+clean\s+--force\b/i, // npm cache clean --force
    /\byarn\s+cache\s+clean\b/i, // yarn cache clean
    /\bpip\s+uninstall\s+.*-y\b/i, // pip uninstall -y (auto-confirm)
    /\bbrew\s+uninstall\s+--force\b/i, // brew uninstall --force
  ],

  // Network destructive operations
  network: [
    /\biptables\s+.*-F\b/i, // Flush iptables
    /\biptables\s+.*--flush\b/i, // Flush iptables
    /\bufw\s+reset\b/i, // Reset firewall
  ],

  // File overwrite via shell redirection (> to sensitive files, NOT >>)
  // These patterns catch ANY command redirecting to sensitive files
  // Uses negative lookbehind (?<!>) to exclude >> (append)
  fileOverwrite: [
    // .env files (credentials, secrets)
    /(?<!>)>\s*~\/\.env\b/i, // > ~/.env (not >>)
    /(?<!>)>\s*\$HOME\/\.env\b/i, // > $HOME/.env
    /(?<!>)>\s*\.env\b/i, // > .env (current directory)
    /(?<!>)>\s*[^\s>]*\/\.env\b/i, // > any/path/.env

    // SSH keys and config
    /(?<!>)>\s*~\/\.ssh\//i, // > ~/.ssh/*
    /(?<!>)>\s*\$HOME\/\.ssh\//i, // > $HOME/.ssh/*
    /(?<!>)>\s*[^\s>]*\/\.ssh\//i, // > any/path/.ssh/*

    // Shell config files
    /(?<!>)>\s*~\/\.bashrc\b/i, // > ~/.bashrc
    /(?<!>)>\s*~\/\.zshrc\b/i, // > ~/.zshrc
    /(?<!>)>\s*~\/\.profile\b/i, // > ~/.profile
    /(?<!>)>\s*~\/\.bash_profile\b/i, // > ~/.bash_profile
    /(?<!>)>\s*~\/\.zprofile\b/i, // > ~/.zprofile
    /(?<!>)>\s*\$HOME\/\.(bashrc|zshrc|profile|bash_profile|zprofile)\b/i, // > $HOME/.shellconfig

    // System directories
    /(?<!>)>\s*\/etc\//i, // > /etc/*
    /(?<!>)>\s*\/usr\//i, // > /usr/*
    /(?<!>)>\s*\/bin\//i, // > /bin/*
    /(?<!>)>\s*\/sbin\//i, // > /sbin/*
    /(?<!>)>\s*\/var\//i, // > /var/*

    // Git config
    /(?<!>)>\s*~\/\.gitconfig\b/i, // > ~/.gitconfig
    /(?<!>)>\s*\.git\//i, // > .git/*

    // Credentials and tokens
    /(?<!>)>\s*[^\s>]*credentials\b/i, // > *credentials*
    /(?<!>)>\s*[^\s>]*\.pem\b/i, // > *.pem
    /(?<!>)>\s*[^\s>]*\.key\b/i, // > *.key
    /(?<!>)>\s*[^\s>]*\.crt\b/i, // > *.crt
    /(?<!>)>\s*[^\s>]*id_rsa\b/i, // > *id_rsa*
    /(?<!>)>\s*[^\s>]*id_ed25519\b/i, // > *id_ed25519*
    /(?<!>)>\s*[^\s>]*\.secrets?\b/i, // > *.secret or *.secrets

    // Config files in home directory
    /(?<!>)>\s*~\/\.[a-z]/i, // > ~/.* (any dotfile in home)
    /(?<!>)>\s*\$HOME\/\.[a-z]/i, // > $HOME/.* (any dotfile in home)
  ],
}

// File paths that are dangerous to delete/modify
const DANGEROUS_PATHS = [
  "/",
  "/*",
  "/home",
  "/etc",
  "/var",
  "/usr",
  "/bin",
  "/sbin",
  "/boot",
  "/lib",
  "/opt",
  "/root",
  "/sys",
  "/proc",
  "/dev",
  "~",
  "~/",
  "$HOME",
  ".git",
  ".env",
  ".ssh",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
]

type DestructiveMatch = {
  category: string
  pattern: string
  severity: "critical" | "high" | "medium"
  command: string
}

// Check if a command matches any destructive pattern
function checkCommand(command: string): DestructiveMatch | null {
  for (const [category, patterns] of Object.entries(DESTRUCTIVE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(command)) {
        const severity = getSeverity(category)
        return {
          category,
          pattern: pattern.toString(),
          severity,
          command,
        }
      }
    }
  }
  return null
}

// Determine severity based on category
function getSeverity(category: string): "critical" | "high" | "medium" {
  if (category === "rmDangerous" || category === "sudo" || category === "system") {
    return "critical"
  }
  if (category === "git" || category === "database" || category === "container" || category === "fileOverwrite") {
    return "high"
  }
  return "medium"
}

// Get human-readable label for category
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    rmDangerous: "Dangerous File Deletion",
    git: "Destructive Git Operation",
    database: "Database Modification",
    system: "System-Level Change",
    sudo: "Elevated Privilege Operation",
    container: "Container/Cloud Operation",
    packages: "Package Management",
    network: "Network Configuration",
    fileOverwrite: "File Overwrite via Redirect",
  }
  return labels[category] || category
}

// Check if a file path is dangerous
function isDangerousPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase()
  return DANGEROUS_PATHS.some((dangerous) => {
    const normalizedDangerous = dangerous.toLowerCase()
    return (
      normalized === normalizedDangerous ||
      normalized.startsWith(normalizedDangerous + "/") ||
      normalized.endsWith("/" + normalizedDangerous)
    )
  })
}

// Statistics tracking
type Stats = {
  checked: number
  permissionsRequested: number
  lastMatch?: DestructiveMatch
}

// Plugin state per session
const sessions: Record<string, Stats> = {}

function getStats(sessionID: string): Stats {
  if (!sessions[sessionID]) {
    sessions[sessionID] = { checked: 0, permissionsRequested: 0 }
  }
  return sessions[sessionID]
}

// Global stats
const global: Stats = { checked: 0, permissionsRequested: 0 }

/**
 * Destructive Command Check Plugin
 */
async function destructiveCheck(_input: {
  client: any
  project: any
  worktree: string
  directory: string
  serverUrl: any
  $: any
}) {
  return {
    // Tool for checking plugin status
    tool: {
      "destructive-check-status": {
        description: "Get the status of the destructive command check plugin",
        args: {},
        async execute(_args: {}, ctx: { sessionID: string }) {
          const stats = getStats(ctx.sessionID)
          return JSON.stringify(
            {
              enabled: true,
              session: {
                id: ctx.sessionID,
                ...stats,
              },
              global: global,
              patterns: {
                categories: Object.keys(DESTRUCTIVE_PATTERNS),
                total: Object.values(DESTRUCTIVE_PATTERNS).flat().length,
              },
              dangerousPaths: DANGEROUS_PATHS.length,
            },
            null,
            2,
          )
        },
      },
    },

    // Check before any tool executes - logs warnings for awareness
    async ["tool.execute.before"](
      hookInput: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> {
      const stats = getStats(hookInput.sessionID)
      stats.checked++
      global.checked++

      const tool = hookInput.tool.toLowerCase()
      const args = output.args

      // Check bash/shell commands
      if (tool === "bash" || tool === "shell" || tool === "execute") {
        const command = (args?.command as string) || ""
        if (command) {
          const match = checkCommand(command)
          if (match) {
            console.warn(
              `[destructive-check] Detected ${match.severity.toUpperCase()} destructive command - permission will be requested`,
            )
            console.warn(`  Category: ${match.category}`)
            console.warn(`  Command: ${match.command.slice(0, 100)}${match.command.length > 100 ? "..." : ""}`)
          }
        }
      }

      // Check file write/delete operations
      if (tool === "write" || tool === "edit" || tool === "delete" || tool === "remove") {
        const filePath = (args?.filePath as string) || (args?.path as string) || ""
        if (filePath && isDangerousPath(filePath)) {
          console.warn(`[destructive-check] Dangerous file operation detected - permission will be requested`)
          console.warn(`  Tool: ${tool}`)
          console.warn(`  Path: ${filePath}`)
        }
      }

      // Check git operations via tool
      if (tool === "git") {
        const subcommand = (args?.subcommand as string) || (args?.command as string) || ""
        const fullCommand = `git ${subcommand}`
        const match = checkCommand(fullCommand)
        if (match) {
          console.warn(`[destructive-check] Destructive git operation detected - permission will be requested`)
          console.warn(`  Severity: ${match.severity.toUpperCase()}`)
          console.warn(`  Command: ${fullCommand}`)
        }
      }
    },

    // Permission hook to require user confirmation for destructive operations
    async ["permission.ask"](
      input: {
        id: string
        // Old permission system uses 'type', new system uses 'permission'
        type?: string
        permission?: string
        pattern?: string | string[]
        patterns?: string[]
        sessionID: string
        messageID?: string
        callID?: string
        title?: string
        metadata: Record<string, unknown>
        time?: { created: number }
      },
      output: { status: "ask" | "deny" | "allow"; metadata?: Record<string, unknown> },
    ): Promise<void> {
      const stats = getStats(input.sessionID)

      // Get permission type from either old or new system
      const permissionType = input.permission || input.type || ""

      // Check if this is a bash/command execution permission
      if (permissionType === "bash" || permissionType === "command" || permissionType === "shell") {
        // Get commands from patterns (new system) or metadata/title (old system)
        const patterns =
          input.patterns || (Array.isArray(input.pattern) ? input.pattern : input.pattern ? [input.pattern] : [])

        // Check each pattern individually for destructive commands
        for (const pattern of patterns) {
          const match = checkCommand(pattern)
          if (match) {
            stats.permissionsRequested++
            global.permissionsRequested++
            stats.lastMatch = match

            // Add metadata to the permission request for UI display
            const severityEmoji = match.severity === "critical" ? "🔴" : match.severity === "high" ? "🟠" : "🟡"
            const categoryLabel = getCategoryLabel(match.category)

            // Enhance metadata with destructive command information
            if (!output.metadata) output.metadata = {}
            output.metadata.destructive = {
              severity: match.severity,
              category: match.category,
              categoryLabel,
              command: pattern,
              warning: `${severityEmoji} ${match.severity.toUpperCase()}: ${categoryLabel}`,
            }

            console.warn(
              `[destructive-check] ${severityEmoji} ${match.severity.toUpperCase()} destructive command detected`,
            )
            console.warn(`  Category: ${categoryLabel}`)
            console.warn(`  Command: ${pattern.slice(0, 100)}${pattern.length > 100 ? "..." : ""}`)
            console.warn(`  ⚠️  This operation could cause data loss or system damage!`)

            // Ask for permission for all severity levels
            output.status = "ask"
            return
          }
        }

        // Also check joined patterns and metadata as fallback
        const command = patterns.join(" ") || (input.metadata?.command as string) || input.title || ""
        if (command && patterns.length === 0) {
          const match = checkCommand(command)
          if (match) {
            stats.permissionsRequested++
            global.permissionsRequested++
            stats.lastMatch = match

            // Add metadata to the permission request for UI display
            const severityEmoji = match.severity === "critical" ? "🔴" : match.severity === "high" ? "🟠" : "🟡"
            const categoryLabel = getCategoryLabel(match.category)

            // Enhance metadata with destructive command information
            if (!output.metadata) output.metadata = {}
            output.metadata.destructive = {
              severity: match.severity,
              category: match.category,
              categoryLabel,
              command,
              warning: `${severityEmoji} ${match.severity.toUpperCase()}: ${categoryLabel}`,
            }

            console.warn(
              `[destructive-check] ${severityEmoji} ${match.severity.toUpperCase()} destructive command detected`,
            )
            console.warn(`  Category: ${categoryLabel}`)
            console.warn(`  Command: ${command.slice(0, 100)}${command.length > 100 ? "..." : ""}`)
            console.warn(`  ⚠️  This operation could cause data loss or system damage!`)

            // Ask for permission for all severity levels
            output.status = "ask"
            return
          }
        }
      }

      // Check file operations
      if (permissionType === "write" || permissionType === "edit" || permissionType === "delete") {
        const patterns =
          input.patterns || (Array.isArray(input.pattern) ? input.pattern : input.pattern ? [input.pattern] : [])
        for (const p of patterns) {
          if (isDangerousPath(p)) {
            stats.permissionsRequested++
            global.permissionsRequested++

            // Add metadata for dangerous file operations
            if (!output.metadata) output.metadata = {}
            output.metadata.destructive = {
              severity: "critical",
              category: "file",
              categoryLabel: "Dangerous File Operation",
              path: p,
              warning: "🔴 CRITICAL: Dangerous file operation",
            }

            console.warn(`[destructive-check] 🔴 CRITICAL: Dangerous file operation detected`)
            console.warn(`  Operation: ${permissionType}`)
            console.warn(`  Path: ${p}`)
            console.warn(`  ⚠️  This operation could cause data loss or system damage!`)

            // Ask for permission for dangerous file operations
            output.status = "ask"
            return
          }
        }
      }
    },

    // After tool execution - log results for destructive operations
    async ["tool.execute.after"](
      hookInput: { tool: string; sessionID: string; callID: string },
      result: { title: string; output: string; metadata: Record<string, unknown> },
    ): Promise<void> {
      const tool = hookInput.tool.toLowerCase()

      // Log completion of potentially dangerous operations
      if (tool === "bash" || tool === "shell") {
        const output = result.output || ""
        // Check for error messages that might indicate dangerous operation attempted
        if (
          output.includes("Permission denied") ||
          output.includes("Operation not permitted") ||
          output.includes("cannot remove") ||
          output.includes("rm: refusing")
        ) {
          console.log(`[destructive-check] Dangerous operation was blocked by system`)
        }
      }
    },
  }
}

export default destructiveCheck
