export * as ShellSafety from "./safety"

const destructive = new Set(["dd", "mkfs", "parted", "rmdir", "rm", "shred", "truncate", "unlink", "wipefs"])
const git = new Set(["clean", "push", "rebase", "reset", "restore"])
const publish = new Set(["bun", "npm", "pnpm", "yarn"])
const interpreters = new Set(["bash", "cmd", "dash", "eval", "fish", "pwsh", "powershell", "sh", "xargs", "zsh"])
const wrappers = new Set(["busybox", "command", "env", "exec", "nice", "nohup", "setsid", "stdbuf", "timeout", "toybox"])
const inlineRuntimes = new Set(["bun", "deno", "node", "python", "python3", "ruby"])
const database = new Set(["createdb", "dropdb", "mysql", "mariadb", "pg_restore", "psql", "sqlite3"])
const gitOptionsWithValue = new Set(["-C", "-c", "--exec-path", "--git-dir", "--index-file", "--namespace", "--super-prefix", "--work-tree"])
const secretPath = /(?:^|[/\\])(?:\.netrc|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|\.env(?:\.[^/\\]+)?)(?:$|[/\\])|(?:^|[/\\])\.ssh(?:[/\\]|$)|(?:^|[/\\])\.config[/\\]gh(?:[/\\]|$)/i
const sensitiveEnvironment = /(?:api[_-]?key|authorization|connection|credential|database|mongo|mysql|password|postgres|private|redis|secret|session|supabase|token|(?:^|_)key$|cookie|^opencode_server_)/i
const writeSql = /\b(?:alter|create|delete|drop|grant|insert|revoke|truncate|update)\b/i

function executable(token: string | undefined) {
  return token?.split(/[\\/]/).at(-1)?.toLowerCase()
}

function gitSubcommand(tokens: readonly string[]) {
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index]
    if (gitOptionsWithValue.has(token)) {
      index++
      continue
    }
    if (token.startsWith("-")) continue
    return { command: token.toLowerCase(), index }
  }
  return undefined
}

function firstArgument(tokens: readonly string[], index: number) {
  return tokens.slice(index).find((token) => !token.startsWith("-"))?.toLowerCase()
}

function mutatesGit(tokens: readonly string[]) {
  const subcommand = gitSubcommand(tokens)
  if (!subcommand) return false
  if (git.has(subcommand.command)) return true
  if (subcommand.command === "branch") return tokens.slice(subcommand.index + 1).some((token) => /^(?:-d|-D|-m|-M|--delete|--move)$/i.test(token))
  if (subcommand.command === "tag") return tokens.slice(subcommand.index + 1).some((token) => /^(?:-d|--delete)$/i.test(token))
  if (subcommand.command !== "worktree") return false
  const action = firstArgument(tokens, subcommand.index + 1)
  return action !== undefined && action !== "list"
}

function mutatesDatabase(tokens: readonly string[], command: string) {
  if (!database.has(command)) return false
  if (command === "createdb" || command === "dropdb" || command === "pg_restore") return true
  const statement = tokens.find((token, index) => tokens[index - 1] === "-c" || tokens[index - 1] === "--command")
  return !statement || writeSql.test(statement)
}

function runsInlineProgram(tokens: readonly string[], command: string) {
  return inlineRuntimes.has(command) && tokens.some((token) => /^(?:-c|-e|-p|--eval)$/.test(token))
}

export function shellEnvironment(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !sensitiveEnvironment.test(key)))
}

export function requiresConfirmation(tokens: readonly string[]) {
  const command = executable(tokens[0])
  if (!command) return false
  if (destructive.has(command)) return true
  if (command === "cp" || command === "mv") return true
  if (interpreters.has(command)) return true
  if (wrappers.has(command)) return true
  if (runsInlineProgram(tokens, command)) return true
  if (tokens.some((token) => secretPath.test(token))) return true
  if (command === "find" && tokens.includes("-delete")) return true
  if ((command === "perl" || command === "sed") && tokens.some((token) => /^-i(?:\.|$)/.test(token))) return true
  if (command === "git" && mutatesGit(tokens)) return true
  if (mutatesDatabase(tokens, command)) return true
  if (publish.has(command) && tokens[1]?.toLowerCase() === "publish") return true
  return command === "sudo"
}
