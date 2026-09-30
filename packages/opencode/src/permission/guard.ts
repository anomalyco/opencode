import { Risk } from "@/permission/risk"
import { ShellID } from "@/tool/shell/id"

// Always-on protections for shell commands. The guard layer upgrades an
// allowed command to a confirmation; it never downgrades an explicit deny or
// ask, and trusted-* rules and session "always" approvals bypass it.

export type Verdict = "allow" | "ask"

// Dangerous commands the risk classifier does not already flag as
// destructive (rm, sudo, dd, mkfs, force-push, ... live there).
const DANGEROUS = [
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/, // fork bomb
  /^(shutdown|reboot|halt|poweroff)\b/,
  /^kill\s+(-9\s+|-KILL\s+)?1\b/,
  /^history\s+-c\b/,
  /^>\s*\/dev\/(sd[a-z]|nvme\d|disk\d)/,
  /^(deluser|userdel|chpasswd|visudo|passwd)\b/,
]

// Execution of scripts that arrive from the network or temporary locations.
const UNTRUSTED = [
  /\|\s*(sudo\s+)?(?:[\w./-]+\/)*(?:ba|z|k|da)?sh(?:\s|$|;|&)/i,
  /\|\s*(sudo\s+)?(?:pwsh|powershell)(?:\.exe)?(?:\s|$|;|&)/i,
  /\|\s*(?:python[0-9.]*|node|perl|ruby)(?:\s|$|;|&)/i,
  /\b(?:(?:ba|z|k|da)?sh|python[0-9.]*|node|perl|ruby)\s+[^;&|]*[\\/](?:tmp|temp|downloads)[\\/]/i,
  /\biex\s*\(?\s*(?:irm|iwr|invoke-webrequest|invoke-expression)\b/i,
]

// Example env files are documentation, not secrets.
const ENV_EXAMPLE = /\.(env\.(example|sample|template|dist))/g

const ENV_VERBS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "fgrep",
  "egrep",
  "source",
  ".",
  "awk",
  "sed",
  "jq",
  "cut",
  "sort",
  "uniq",
  "wc",
  "base64",
  "xxd",
  "type",
  "get-content",
])

const SECRET_SOURCE =
  /(^|[\s"'(=~/])(?:\.ssh[\\/]|\.aws[\\/]|\.gnupg[\\/]|\.kube[\\/]|\.docker[\\/]|\.config[\\/]gh[\\/]|\.netrc\b|\.npmrc\b|\.pgpass\b|\.htpasswd\b|credentials\b|[\w.-]*\.pem\b|[\w.-]*\.p12\b|[\w.-]*\.key\b|secrets?\.(?:json|ya?ml)\b|\.env\b|id_rsa\b|id_ed25519\b|id_ecdsa\b)/i

const NETWORK_SINK =
  /\b(?:curl|wget|nc|ncat|netcat|socat|scp|sftp|ftp|tftp|rsync|ssh)\b|\b(?:irm|iwr|invoke-webrequest|invoke-restmethod)\b|\bgit\s+push\b|--upload-file|--post-data|--data(?:-binary|-raw)?\s|-F\s+|--form\s/i

const SENSITIVE_PATH =
  /(^|[\s"'(=~/])(?:\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.azure|\.config[\\/]gh)(?:[\\/]|\s|"|'|$)|(^|[\s"'(=])(?:id_rsa|id_ed25519|id_ecdsa|\.netrc|\.npmrc|\.pgpass|\.bash_history|\.zsh_history)/i

const segments = (command: string) => command.split(/&&|\|\||;|\|/)

function dangerous(segment: string): boolean {
  return DANGEROUS.some((pattern) => pattern.test(segment.trim()))
}

function readsEnvFile(segment: string): boolean {
  const [verb, ...rest] = segment.trim().split(/\s+/)
  if (!verb || !ENV_VERBS.has(verb.toLowerCase())) return false
  return rest.join(" ").includes(".env")
}

function writesGitInternals(segment: string): boolean {
  const text = segment.trim()
  if (!text.includes(".git/")) return false
  return /(^|\s)>{1,2}\s*|\btee\s+|\b(?:cp|mv|install|rsync)\s+|\bsed\s+-i\b|\bperl\s+-i\b/.test(text)
}

// Write targets that always confirm: environment files and system account
// files. Example env docs (`.env.example`, ...) were stripped before
// segmentation, so they never match here.
const PROTECTED_TARGET = /(?:\.env\b)|(?:\/etc\/(?:passwd|shadow|sudoers(?:\.d)?|group)\b)/
const WRITE_OP = /(?:^|[\s;|&])(?:>{1,2}|\b(?:tee|cp|mv|install)\b|\bsed\s+-i\b|\bperl\s+-i\b)/

// Spec protection: writing `.env` and system account files confirms even when
// workspace rules allow the command. Reads are handled by readsEnvFile and
// SENSITIVE_PATH; this covers redirects, tee, copy/move, and in-place edits.
function writesProtectedFile(segment: string): boolean {
  const text = segment.trim()
  return PROTECTED_TARGET.test(text) && WRITE_OP.test(text)
}

export function evaluate(input: { permission: string; command?: string }): Verdict {
  if (input.permission !== ShellID.ToolID) return "allow"
  const command = input.command
  if (!command) return "allow"

  // rm destrutivo + comandos perigosos.
  if (Risk.classify(ShellID.ToolID, command) === "destructive") return "ask"
  const text = command.replace(ENV_EXAMPLE, " ")
  const parts = segments(text)
  // The fork bomb pattern contains a pipe, so it can only match the raw
  // command; the rest of the table matches per segment (`ls && reboot`).
  if (dangerous(text) || parts.some(dangerous)) return "ask"
  // execução de scripts não confiáveis.
  if (UNTRUSTED.some((pattern) => pattern.test(command))) return "ask"
  // leitura indevida de .env.
  if (parts.some(readsEnvFile)) return "ask"
  // escrita em .env ou ficheiros de contas do sistema (passwd, shadow, sudoers).
  if (parts.some(writesProtectedFile)) return "ask"
  // acesso indevido à home (chaves, credenciais, histórico).
  if (SENSITIVE_PATH.test(text)) return "ask"
  // exfiltração de secrets: uma fonte de segredo combinada com envio de rede.
  if (SECRET_SOURCE.test(text) && NETWORK_SINK.test(text)) return "ask"
  // alterações em arquivos protegidos: internals do .git.
  if (parts.some(writesGitInternals)) return "ask"
  return "allow"
}

export * as Guard from "./guard"
