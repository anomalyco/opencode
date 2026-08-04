export * as ShellSafety from "./safety"

const destructive = new Set(["dd", "mkfs", "parted", "rmdir", "rm", "shred", "truncate", "unlink", "wipefs"])
const git = new Set(["clean", "push", "rebase", "reset", "restore"])
const publish = new Set(["bun", "npm", "pnpm", "yarn"])

export function requiresConfirmation(tokens: readonly string[]) {
  const command = tokens[0]?.toLowerCase()
  if (!command) return false
  if (destructive.has(command)) return true
  if (command === "find" && tokens.includes("-delete")) return true
  if ((command === "perl" || command === "sed") && tokens.some((token) => /^-i(?:\.|$)/.test(token))) return true
  if (command === "git" && git.has(tokens[1]?.toLowerCase() ?? "")) return true
  if (publish.has(command) && tokens[1]?.toLowerCase() === "publish") return true
  return command === "sudo"
}
