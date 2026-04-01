import { Log } from "@/util/log"

const log = Log.create({ service: "bash-dangerous" })

/**
 * Dangerous bash command patterns.
 * These patterns require explicit approval regardless of permission mode
 * (except bypassPermissions mode).
 *
 * Categories:
 * - Interpreters: python, node, ruby, perl, php, lua, deno
 * - Package runners: npx, bunx, npm run, yarn run, pnpm run, bun run
 * - Shells/eval: bash -c, sh -c, eval, exec, xargs
 * - Privilege: sudo, su, doas
 * - Network: ssh, scp, rsync, curl, wget (when piping to shell)
 * - Filesystem: rm -rf on root/home, dd, mkfs
 */

/**
 * Interpreter commands that can execute arbitrary code.
 * Pattern matches the command name at the start of a command.
 */
export const INTERPRETER_PATTERNS: RegExp[] = [
  // Python interpreters
  /^(python|python3|python2|py)\b/i,

  // Node.js (but not bun run which is caught by package runners)
  /^(node|nodejs)\b/i,

  // Deno (standalone execution)
  /^(deno\s+run|deno\s+eval)\b/i,

  // Bun (but not bun run which is caught by package runners)
  /^bun\s+(test|build|eval)\b/i,

  // Ruby
  /^(ruby|rbx|jruby)\b/i,

  // Perl
  /^(perl|perl5)\b/i,

  // PHP
  /^(php|hhvm)\b/i,

  // Lua
  /^(lua|lua5[\d]*|luajit)\b/i,

  // Other interpreters
  /^(perl6|raku)\b/i,
  /^(scheme|guile|chicken)\b/i,
  /^(r|Rscript)\b/i,
  /^(scala|scalac)\b/i,
  /^(groovy|groovyc)\b/i,
  /^(clojure|clj)\b/i,
]

/**
 * Package runner commands that can execute scripts.
 * These download and run code, or run project scripts.
 */
export const PACKAGE_RUNNER_PATTERNS: RegExp[] = [
  // npm/yarn/pnpm run scripts
  /^(npm\s+run|npm\s+exec|npm\s+start|npm\s+test|npm\s+build)\b/i,
  /^(yarn\s+run|yarn\s+exec|yarn\s+start|yarn\s+test|yarn\s+build)\b/i,
  /^(pnpm\s+run|pnpm\s+exec|pnpm\s+start|pnpm\s+test|pnpm\s+build)\b/i,
  /^(bun\s+run|bun\s+start|bun\s+test|bun\s+build)\b/i,

  // npx/bunx - execute packages directly
  /^(npx|bunx)\b/i,

  // pip installed scripts
  /^(pipx|pipx\s+run)\b/i,
]

/**
 * Shell and eval patterns that can execute arbitrary code.
 */
export const SHELL_EVAL_PATTERNS: RegExp[] = [
  // Shell execution with -c flag
  /^(bash\s+-c|sh\s+-c|zsh\s+-c|fish\s+-c)\b/i,

  // Eval/exec commands
  /^(eval|exec)\b/i,

  // xargs can execute arbitrary commands
  /^(xargs\s+-I|find\s+.*\|\s*xargs)\b/i,

  // source/dot commands
  /^(source|\\.)\s+/i,
]

/**
 * Privilege escalation commands.
 */
export const PRIVILEGE_PATTERNS: RegExp[] = [
  /^(sudo|sudoers)\b/i,
  /^(su|su\s+-)\b/i,
  /^(doas|doas\s+-)\b/i,
  /^(pkexec|polkit)\b/i,
]

/**
 * Network commands that can download/execute remote code.
 * Flagged when combined with shell execution patterns.
 */
export const NETWORK_EXEC_PATTERNS: RegExp[] = [
  // curl/wget piped to shell
  /(\bcurl\b|\bwget\b).*\|\s*(bash|sh|zsh|fish|python|node|ruby|perl|php)/i,

  // ssh commands
  /^(ssh|scp|rsync)\s+/i,

  // nc/netcat can be used for reverse shells
  /^(nc|netcat|socat)\s+.*\b-e\b/i,
]

/**
 * Dangerous filesystem operations.
 * These are especially dangerous patterns for rm/dd/mkfs.
 */
export const FILESYSTEM_DANGER_PATTERNS: RegExp[] = [
  // rm -rf /, rm -rf /*, rm -rf ~, rm -rf $HOME
  // Matches destructive targets but not subdirectories like /home
  /\brm\s+(-[rf]+\s+)?(\/\s*$|\/\s*\*|~|\$HOME)/,

  // dd if=/dev/zero or /dev/urandom
  /\bdd\s+.*\bif=\/dev\/(zero|urandom)/i,

  // mkfs on devices
  /\bmkfs\b/i,
]

/**
 * All dangerous patterns combined.
 * Used for checking if a command matches any dangerous pattern.
 */
export const ALL_DANGEROUS_PATTERNS: RegExp[] = [
  ...INTERPRETER_PATTERNS,
  ...PACKAGE_RUNNER_PATTERNS,
  ...SHELL_EVAL_PATTERNS,
  ...PRIVILEGE_PATTERNS,
  ...NETWORK_EXEC_PATTERNS,
  ...FILESYSTEM_DANGER_PATTERNS,
]

/**
 * Result of checking a command for dangerous patterns.
 */
export interface DangerousPatternResult {
  isDangerous: boolean
  pattern?: string
  category?: string
  reason?: string
}

/**
 * Check if a command matches any dangerous pattern.
 * Returns the first matching pattern and its category.
 *
 * @param command - The command string to check
 * @returns DangerousPatternResult with match details
 */
export function checkDangerousPattern(command: string): DangerousPatternResult {
  const trimmed = command.trim()

  // Check interpreter patterns
  for (const pattern of INTERPRETER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isDangerous: true,
        pattern: pattern.source,
        category: "interpreter",
        reason: "Command uses an interpreter that can execute arbitrary code",
      }
    }
  }

  // Check package runner patterns
  for (const pattern of PACKAGE_RUNNER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isDangerous: true,
        pattern: pattern.source,
        category: "package-runner",
        reason: "Command uses a package runner that can download and execute code",
      }
    }
  }

  // Check shell/eval patterns
  for (const pattern of SHELL_EVAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isDangerous: true,
        pattern: pattern.source,
        category: "shell-eval",
        reason: "Command uses shell execution or eval that can run arbitrary code",
      }
    }
  }

  // Check privilege patterns
  for (const pattern of PRIVILEGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isDangerous: true,
        pattern: pattern.source,
        category: "privilege",
        reason: "Command attempts privilege escalation",
      }
    }
  }

  // Check network exec patterns
  for (const pattern of NETWORK_EXEC_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isDangerous: true,
        pattern: pattern.source,
        category: "network-exec",
        reason: "Command downloads and executes remote code",
      }
    }
  }

  // Check filesystem danger patterns
  for (const pattern of FILESYSTEM_DANGER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isDangerous: true,
        pattern: pattern.source,
        category: "filesystem",
        reason: "Command performs destructive filesystem operation",
      }
    }
  }

  return { isDangerous: false }
}

/**
 * Check if a command is a destructive removal targeting critical paths.
 * This is separate from pattern matching because it needs path resolution.
 *
 * @param command - The command string to check
 * @param cwd - Current working directory for path resolution
 * @returns true if the command attempts dangerous removal
 */
export function checkDangerousRemoval(command: string, cwd: string): DangerousPatternResult {
  // Check for rm -rf / or rm -rf /*
  if (/\brm\s+(-[rf]+\s+)?\/\s*$/.test(command) || /\brm\s+(-[rf]+\s+)?\/\*/.test(command)) {
    return {
      isDangerous: true,
      pattern: "rm -rf /",
      category: "destructive-removal",
      reason: "Command attempts to remove root directory",
    }
  }

  // Check for rm -rf ~ or rm -rf $HOME
  if (/\brm\s+(-[rf]+\s+)?~\s*$/.test(command) || /\brm\s+(-[rf]+\s+)?\$HOME\b/.test(command)) {
    return {
      isDangerous: true,
      pattern: "rm -rf ~",
      category: "destructive-removal",
      reason: "Command attempts to remove home directory",
    }
  }

  // Check for rm -rf . (current directory inside home/root)
  // This is contextual - only dangerous in certain locations
  const homeDir = process.env.HOME || ""
  const isCriticalLocation = cwd === "/" || cwd === homeDir || cwd.startsWith("/etc") || cwd.startsWith("/usr")

  if (isCriticalLocation && /\brm\s+(-[rf]+\s+)?\.\s*$/.test(command)) {
    return {
      isDangerous: true,
      pattern: "rm -rf .",
      category: "destructive-removal",
      reason: "Command attempts to remove current directory in a critical location",
    }
  }

  return { isDangerous: false }
}

/**
 * Check all dangerous command conditions.
 * Combines pattern matching and removal path checking.
 *
 * @param command - The command string to check
 * @param cwd - Current working directory
 * @returns DangerousPatternResult with match details if dangerous
 */
export function checkAllDangerous(command: string, cwd: string): DangerousPatternResult {
  // First check dangerous patterns
  const patternResult = checkDangerousPattern(command)
  if (patternResult.isDangerous) {
    log.warn("dangerous command detected", {
      command: command.slice(0, 100),
      category: patternResult.category,
      reason: patternResult.reason,
    })
    return patternResult
  }

  // Then check dangerous removal paths
  const removalResult = checkDangerousRemoval(command, cwd)
  if (removalResult.isDangerous) {
    log.warn("dangerous removal detected", {
      command: command.slice(0, 100),
      category: removalResult.category,
      reason: removalResult.reason,
    })
    return removalResult
  }

  return { isDangerous: false }
}
