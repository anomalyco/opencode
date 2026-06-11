import { Shell } from "./shell"

const DEFAULT_NONINTERACTIVE_ENV: Record<string, string> = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  HOMEBREW_NO_AUTO_UPDATE: "1",
  GIT_EDITOR: ":",
  EDITOR: ":",
  VISUAL: "",
  GIT_SEQUENCE_EDITOR: ":",
  GIT_MERGE_AUTOEDIT: "no",
  GIT_PAGER: "cat",
  PAGER: "cat",
  npm_config_yes: "true",
  PIP_NO_INPUT: "1",
  YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
}

const POWERSHELL_ENV_PREFIX =
  /(?:\$env:[A-Za-z_][A-Za-z0-9_]*=(?:(?:'[^']*')|(?:[^\s;]+));\s*)+/gi

function quote(value: string) {
  if (!/[ "'\\$`!]/.test(value)) return value
  return `'${value.replaceAll("'", "''")}'`
}

export function defaultNonInteractiveEnv() {
  return { ...DEFAULT_NONINTERACTIVE_ENV }
}

export function formatCommandEnvPrefix(shell: string, env: Record<string, string>) {
  const entries = Object.entries(env).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return ""

  if (Shell.ps(shell)) {
    return entries.map(([key, value]) => `$env:${key}=${quote(value)}`).join("; ") + "; "
  }

  if (Shell.name(shell) === "cmd") {
    return entries.map(([key, value]) => `set ${key}=${value}`).join(" && ") + " && "
  }

  return entries.map(([key, value]) => `export ${key}=${quote(value)}`).join("; ") + "; "
}

export function stripIncompatibleEnvPrefix(command: string, shell: string) {
  if (process.platform !== "win32" || Shell.ps(shell)) return command
  return command.replace(POWERSHELL_ENV_PREFIX, "").trimStart()
}

export * as ShellEnv from "./env"
