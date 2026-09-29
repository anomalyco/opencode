import { ConfigHitlV1 } from "@opencode-ai/core/v1/config/hitl"
import { ShellID } from "@/tool/shell/id"

export const ORDER: ConfigHitlV1.Risk[] = ["readonly", "routine", "moderate", "destructive"]

const READONLY_OPERATIONS = new Set(["read", "glob", "grep", "list", "lsp", "websearch"])
const ROUTINE_OPERATIONS = new Set(["task", "skill", "todowrite", "question", "doom_loop", "webfetch"])

const READONLY = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "egrep",
  "fgrep",
  "find",
  "fd",
  "which",
  "whereis",
  "type",
  "pwd",
  "wc",
  "stat",
  "file",
  "du",
  "df",
  "ps",
  "id",
  "whoami",
  "uname",
  "env",
  "printenv",
  "hostname",
  "date",
  "tree",
  "diff",
  "jq",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "realpath",
  "readlink",
  "basename",
  "dirname",
  "man",
])

// Non-destructive, reversible workflow commands. Builds, tests, and package
// installs live here so BALANCED stays usable for day-to-day development.
const ROUTINE = new Set([
  "mkdir",
  "touch",
  "cp",
  "mv",
  "ln",
  "tar",
  "unzip",
  "zip",
  "gzip",
  "gunzip",
  "echo",
  "printf",
  "sleep",
  "cd",
  "export",
  "alias",
  "history",
  "jest",
  "vitest",
  "eslint",
  "prettier",
  "tsc",
  "biome",
  "pytest",
  "mocha",
  "rspec",
  "ruff",
  "black",
  "mypy",
  "flake8",
  "gofmt",
  "shellcheck",
  "shfmt",
  "markdownlint",
])

// Package-manager subcommands are routine because they run scripts declared in
// the project itself; interpreters running arbitrary code stay moderate.
const SUBCOMMAND_ROUTINE: Record<string, Set<string>> = {
  npm: new Set([
    "install",
    "i",
    "ci",
    "add",
    "test",
    "run",
    "build",
    "start",
    "lint",
    "typecheck",
    "check",
    "pack",
    "list",
    "ls",
    "view",
    "info",
    "audit",
    "update",
    "outdated",
    "docs",
    "init",
    "version",
    "link",
    "unlink",
  ]),
  yarn: new Set([
    "install",
    "add",
    "test",
    "build",
    "start",
    "lint",
    "run",
    "list",
    "why",
    "upgrade",
    "link",
    "unlink",
  ]),
  pnpm: new Set(["install", "i", "add", "test", "build", "start", "lint", "run", "list", "update", "link", "unlink"]),
  bun: new Set([
    "install",
    "add",
    "test",
    "run",
    "build",
    "typecheck",
    "lint",
    "link",
    "pm",
    "upgrade",
    "outdated",
    "init",
  ]),
  deno: new Set(["install", "add", "test", "lint", "fmt", "check", "cache", "info"]),
  cargo: new Set([
    "build",
    "check",
    "test",
    "fmt",
    "clippy",
    "add",
    "update",
    "doc",
    "bench",
    "clean",
    "init",
    "new",
    "search",
    "tree",
    "fix",
    "audit",
  ]),
  go: new Set(["build", "test", "mod", "get", "vet", "fmt", "list", "version", "env"]),
  pip: new Set(["install", "list", "show", "freeze", "check", "download"]),
  mvn: new Set(["build", "test", "compile", "package", "install", "clean", "verify", "validate"]),
  gradle: new Set(["build", "test", "assemble", "check", "clean"]),
}

const GIT_READONLY = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "rev-parse",
  "rev-list",
  "remote",
  "blame",
  "describe",
  "grep",
  "ls-files",
  "ls-remote",
  "shortlog",
  "reflog",
  "help",
  "count-objects",
  "name-rev",
])

const GIT_ROUTINE = new Set([
  "add",
  "commit",
  "checkout",
  "switch",
  "pull",
  "fetch",
  "clone",
  "init",
  "mv",
  "restore",
  "cherry-pick",
  "push",
  "tag",
  "stash",
  "config",
  "worktree",
  "archive",
  "merge",
  "revert",
  "gc",
  "submodule",
  "apply",
])

// Irreversible or history-rewriting operations. Matched against each command
// segment before token lookup so `ls && rm -rf out` classifies as destructive.
const DESTRUCTIVE = [
  /^rm\s/,
  /^rmdir\s/,
  /^unlink\s/,
  /^shred\s/,
  /^dd\s/,
  /^mkfs/,
  /^format\s/,
  /^del\s/,
  /^rd\s/,
  /^sudo\s/,
  /^su\s/,
  /^chown\s+-R/,
  /^chmod\s+(-R\s+)?(777|000)/,
  /^diskutil\s+(erase|partition)/,
  /^terraform\s+destroy/,
  /^tofu\s+destroy/,
  /^kubectl\s+(delete|drain)/,
  /^docker\s+(rm|rmi|prune)/,
  /^helm\s+uninstall/,
  /^(npm|pnpm|yarn)\s+publish/,
  /^twine\s+upload/,
  /^gh\s+release\s+delete/,
  /^git\s+push\s+.*(--force|-f[\s"']|-f$)/,
  /^git\s+push\s+.*--delete/,
  /^git\s+reset\s+.*--hard/,
  /^git\s+clean\b/,
  /^git\s+branch\s+-D/,
  /^git\s+filter-branch/,
  /^git\s+stash\s+(drop|clear)/,
  /^drop\s+(table|database|schema|index)\b/i,
  /^truncate\b/,
]

export function classify(permission: string, command?: string): ConfigHitlV1.Risk {
  if (permission === ShellID.ToolID) return classifyCommand(command ?? "")
  if (READONLY_OPERATIONS.has(permission)) return "readonly"
  if (ROUTINE_OPERATIONS.has(permission)) return "routine"
  // edit, external_directory, and unknown operations (MCP tools, workflow
  // approvals) default to moderate so BALANCED confirms them.
  return "moderate"
}

function classifyCommand(command: string): ConfigHitlV1.Risk {
  return command
    .split(/&&|\|\||;|\|/)
    .map(classifySegment)
    .reduce(maxRisk, "readonly")
}

function classifySegment(segment: string): ConfigHitlV1.Risk {
  const text = segment.trim()
  if (DESTRUCTIVE.some((pattern) => pattern.test(text))) return "destructive"
  const risk = tokenRisk(text)
  if (risk === "moderate" || risk === "destructive") return risk
  // Output redirection writes files even from read-only commands.
  return /(?<!\d)>/.test(text) ? "moderate" : risk
}

function tokenRisk(text: string): ConfigHitlV1.Risk {
  const tokens = text.toLowerCase().split(/\s+/)
  const head = tokens[0] ?? ""
  const argument = tokens[1] ?? ""
  if (head === "git") return gitRisk(argument)
  const subcommands = SUBCOMMAND_ROUTINE[head]
  if (subcommands) return subcommands.has(argument) ? "routine" : "moderate"
  if (READONLY.has(head)) return "readonly"
  if (ROUTINE.has(head)) return "routine"
  return "moderate"
}

function gitRisk(subcommand: string): ConfigHitlV1.Risk {
  if (GIT_READONLY.has(subcommand)) return "readonly"
  if (GIT_ROUTINE.has(subcommand)) return "routine"
  return "moderate"
}

function maxRisk(a: ConfigHitlV1.Risk, b: ConfigHitlV1.Risk): ConfigHitlV1.Risk {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b
}

export * as Risk from "./risk"
