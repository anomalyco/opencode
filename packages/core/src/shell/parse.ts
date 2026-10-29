export * as ShellParse from "./parse.js"

import { Effect } from "effect"
import os from "os"
import path from "path"
import { ShellScan } from "./scan.js"
import { ShellSelect } from "./select.js"
import { Wildcard } from "../util/wildcard.js"

type Part = { type: string; text: string; unquotedTilde?: boolean }
const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const POWERSHELL_PATH_FLAG_RE =
  /^-(?:p(?:ath|at|a)?|lp|l(?:i(?:t(?:e(?:r(?:a(?:l(?:p(?:a(?:t(?:h)?)?)?)?)?)?)?)?)?)?|psp(?:a(?:t(?:h)?)?)?):?$/i

export type Result = {
  commands: Array<{ resource: string; save: string }>
  directories: string[]
}

const ARITY: Record<string, number> = {
  cat: 1,
  cd: 1,
  chmod: 1,
  chown: 1,
  cp: 1,
  echo: 1,
  env: 1,
  export: 1,
  grep: 1,
  kill: 1,
  killall: 1,
  ln: 1,
  ls: 1,
  mkdir: 1,
  mv: 1,
  ps: 1,
  pwd: 1,
  rm: 1,
  rmdir: 1,
  sleep: 1,
  source: 1,
  tail: 1,
  touch: 1,
  unset: 1,
  which: 1,
  aws: 3,
  az: 3,
  bazel: 2,
  brew: 2,
  bun: 2,
  "bun run": 3,
  "bun x": 3,
  cargo: 2,
  "cargo add": 3,
  "cargo run": 3,
  cdk: 2,
  cf: 2,
  cmake: 2,
  composer: 2,
  consul: 2,
  "consul kv": 3,
  crictl: 2,
  deno: 2,
  "deno task": 3,
  doctl: 3,
  docker: 2,
  "docker builder": 3,
  "docker compose": 3,
  "docker container": 3,
  "docker image": 3,
  "docker network": 3,
  "docker volume": 3,
  eksctl: 2,
  "eksctl create": 3,
  firebase: 2,
  flyctl: 2,
  gcloud: 3,
  gh: 3,
  git: 2,
  "git config": 3,
  "git remote": 3,
  "git stash": 3,
  go: 2,
  gradle: 2,
  helm: 2,
  heroku: 2,
  hugo: 2,
  ip: 2,
  "ip addr": 3,
  "ip link": 3,
  "ip netns": 3,
  "ip route": 3,
  kind: 2,
  "kind create": 3,
  kubectl: 2,
  "kubectl kustomize": 3,
  "kubectl rollout": 3,
  kustomize: 2,
  make: 2,
  mc: 2,
  "mc admin": 3,
  minikube: 2,
  mongosh: 2,
  mysql: 2,
  mvn: 2,
  ng: 2,
  npm: 2,
  "npm exec": 3,
  "npm init": 3,
  "npm run": 3,
  "npm view": 3,
  npx: 2,
  nvm: 2,
  nx: 2,
  openssl: 2,
  "openssl req": 3,
  "openssl x509": 3,
  pip: 2,
  pipenv: 2,
  pnpm: 2,
  "pnpm dlx": 3,
  "pnpm exec": 3,
  "pnpm run": 3,
  poetry: 2,
  podman: 2,
  "podman container": 3,
  "podman image": 3,
  psql: 2,
  pulumi: 2,
  "pulumi stack": 3,
  python: 2,
  pyenv: 2,
  rake: 2,
  rbenv: 2,
  "redis-cli": 2,
  rustup: 2,
  serverless: 2,
  sfdx: 3,
  skaffold: 2,
  sls: 2,
  sst: 2,
  swift: 2,
  systemctl: 2,
  terraform: 2,
  "terraform workspace": 3,
  tmux: 2,
  turbo: 2,
  ufw: 2,
  vault: 2,
  "vault auth": 3,
  "vault kv": 3,
  vercel: 2,
  volta: 2,
  wp: 2,
  yarn: 2,
  "yarn dlx": 3,
  "yarn run": 3,
}
const PREFIX_LENGTH = Math.max(...Object.values(ARITY))

export function scan(command: string, shell: string, cwd: string): Effect.Effect<Result, Error> {
  return Effect.suspend(() => {
    const powershell = ShellSelect.ps(shell)
    const shellName = ShellSelect.name(shell)
    const scanned = powershell
      ? ShellScan.scanPowerShell(command)
      : ShellScan.scan(command, shellName === "bash" || shellName === "zsh" ? shellName : "posix")
    if (scanned.kind === "opaque")
      return Effect.fail(new Error(`Portable shell scanner cannot analyze command: ${scanned.reason}`))

    const output: Result = { commands: [], directories: [] }
    for (const item of scanned.commands) {
      // Declarations are skipped as standalone permission resources, while nested substitutions remain.
      if (item.declaration) continue
      const words = item.redirectWordCount === undefined ? item.rawWords : item.rawWords.slice(0, item.redirectWordCount)
      // Bare statement-head foreach blocks act as PowerShell control flow rather than cmdlet invocations.
      if (
        powershell &&
        item.statementHead &&
        /^foreach(?:-|$)/i.test(words[0] ?? "") &&
        words.length > 1 &&
        words.slice(1).every((word) => word.startsWith("{"))
      )
        continue
      const parts = powershell
        ? words.flatMap((raw, index): Part[] => {
            const text =
              !raw.includes("`$") && /['"`]/.test(raw) ? (item.words[index] ?? raw) : raw.replaceAll("`$", "\0")
            if (!/^-[A-Za-z_?][\w?-]*(?::|$)/.test(raw)) return [{ type: "word", text }]
            const colon = text.indexOf(":")
            if (colon >= 0)
              return colon + 1 < text.length
                ? [
                    { type: "command_parameter", text: text.slice(0, colon) },
                    { type: "word", text: text.slice(colon + 1) },
                  ]
                : [{ type: "command_parameter", text: text.slice(0, colon) }]
            return [{ type: "command_parameter", text }]
          })
        : item.rawWords.map((raw, index): Part => {
            const word = item.words[index] ?? raw
            return {
              type: "word",
              text: isStaticBashWord(raw) ? word.replaceAll("$", "\0") : "$",
              unquotedTilde: raw.startsWith("~"),
            }
          })
      const directoryCommand = unwrapDirectoryCommand(words, parts, powershell)
      if (directoryCommand) {
        output.directories.push(...directoryArgs(directoryCommand, powershell, cwd, shell))
        if (directoryCommand === parts) continue
      }
      const selected = prefix(words.slice(0, PREFIX_LENGTH))
      const conventional = `${selected.join(" ")} *`
      const end = item.wordEnds?.[selected.length - 1]
      // Keep existing grants stable unless normalized spacing loses the original source boundary.
      const save =
        !powershell || end === undefined || Wildcard.match(item.resource, conventional)
          ? conventional
          : (() => {
              const boundary =
                item.wordEnds?.find(
                  (value) => value >= end && (value >= item.resource.length || /\s/.test(item.resource[value])),
                ) ?? end
              const separator = /^\s+(?:`(?:\r\n|\r|\n)\s*)?/.exec(item.resource.slice(boundary))?.[0]
              return `${item.resource.slice(0, boundary)}${separator ?? " "}*`
            })()
      output.commands.push({
        resource: item.resource,
        save,
      })
    }
    return Effect.succeed(output)
  })
}

export const scanPortable = scan

function unwrapDirectoryCommand(rawWords: string[], parts: Part[], powershell: boolean) {
  const head = powershell ? rawWords[0]?.toLowerCase() : rawWords[0]
  if (CWD.has(head ?? "")) return parts
  if (powershell) return
  let index = 0
  while (rawWords[index] === "builtin" || rawWords[index] === "command") {
    const wrapper = rawWords[index]
    index++
    while (rawWords[index]?.startsWith("-")) {
      const flag = rawWords[index]
      index++
      if (flag === "--") break
      if (wrapper === "command" && /^-[p]*[vV]/.test(flag)) return
    }
  }
  return index > 0 && CWD.has(rawWords[index] ?? "") ? parts.slice(index) : undefined
}

function isStaticBashWord(raw: string) {
  let quote: "'" | '"' | "$'" | undefined
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    const next = raw[index + 1] ?? ""
    if (quote === "'") {
      if (char === "'") quote = undefined
      continue
    }
    if (quote === "$'") {
      if (char === "\\") {
        index++
        continue
      }
      if (char === "'") quote = undefined
      continue
    }
    if (quote === '"') {
      if (char === "\\" && '$`"\\\n'.includes(next)) {
        index++
        continue
      }
      if (char === '"') {
        quote = undefined
        continue
      }
      if (char === "`" || (char === "$" && (/[A-Za-z_0-9@*#?$!({[-]/.test(next) || raw.startsWith("\\\n", index + 1))))
        return false
      continue
    }
    if (char === "\\") {
      index++
      continue
    }
    if (char === "'") {
      quote = "'"
      continue
    }
    if (char === '"') {
      quote = '"'
      continue
    }
    if (char === "$" && next === "'") {
      quote = "$'"
      index++
      continue
    }
    if (char === "$" && next === '"') {
      quote = '"'
      index++
      continue
    }
    if (
      char === "`" ||
      ((char === "<" || char === ">" || char === "=") && next === "(") ||
      (char === "$" && (/[A-Za-z_0-9@*#?$!({[-]/.test(next) || raw.startsWith("\\\n", index + 1)))
    )
      return false
  }
  return quote === undefined
}

function directoryArgs(command: Part[], powershell: boolean, cwd: string, shell: string) {
  if (!powershell) {
    let endOfOptions = false
    return command
      .slice(1)
      .filter((part) => {
        if (endOfOptions) return true
        if (part.text === "--") {
          endOfOptions = true
          return false
        }
        return !part.text.startsWith("-")
      })
      .map((part) => directoryArgument(part.text, powershell, cwd, shell, part.unquotedTilde))
      .filter((part) => part !== undefined)
  }

  const directories: string[] = []
  let path = false
  let endOfParameters = false
  for (const part of command.slice(1)) {
    if (!endOfParameters && part.text === "--") {
      endOfParameters = true
      continue
    }
    if (path) {
      const value = directoryArgument(part.text, powershell, cwd, shell)
      if (value) directories.push(value)
      path = false
      continue
    }
    if (!endOfParameters && part.type === "command_parameter") {
      path = POWERSHELL_PATH_FLAG_RE.test(part.text)
      continue
    }
    const value = directoryArgument(part.text, powershell, cwd, shell)
    if (value) directories.push(value)
  }
  return directories
}

function directoryArgument(value: string, powershell: boolean, cwd: string, shell: string, unquotedTilde = false) {
  if (!powershell) return expandKnownDirectory(value, false, unquotedTilde)
  const quote = value[0]
  const text = (quote === '"' || quote === "'") && value.at(-1) === quote ? value.slice(1, -1) : value

  // PowerShell exposes environment variables through $env:NAME and provides these
  // automatic directory variables. Expand only values we can determine without executing code.
  return expandKnownDirectory(
    text
      .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => environment(key) ?? "")
      .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => environment(key) ?? "")
      .replace(/\$(?:\{(HOME|PWD|PSHOME)\}|(HOME|PWD|PSHOME)(?=$|[\\/]))/gi, (_, braced?: string, bare?: string) => {
        const key = (braced ?? bare ?? "").toUpperCase()
        if (key === "HOME") return os.homedir()
        if (key === "PWD") return cwd
        return path.dirname(shell)
      }),
    true,
  )
}

function expandKnownDirectory(value: string, powershell: boolean, unquotedTilde = false) {
  // Unknown shell expressions cannot be resolved safely during permission analysis.
  if (value.includes("$") || value.includes("`") || (powershell && value.startsWith("("))) return
  const resolved = value.replaceAll("\0", "$")
  if (resolved === "~") return os.homedir()
  if (resolved.startsWith("~/") || (process.platform === "win32" && resolved.startsWith("~\\"))) {
    return path.join(os.homedir(), resolved.slice(2))
  }
  if (unquotedTilde && process.platform !== "win32") {
    const userMatch = /^~([A-Za-z0-9._-]+)(?=$|\/)/.exec(resolved)
    if (userMatch) {
      const user = userMatch[1]
      const home =
        user === "root"
          ? process.platform === "darwin"
            ? "/var/root"
            : "/root"
          : path.join(process.platform === "darwin" ? "/Users" : "/home", user)
      return path.join(home, resolved.slice(user.length + 1))
    }
  }
  return resolved
}

function environment(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function prefix(tokens: string[]) {
  for (let length = tokens.length; length > 0; length--) {
    const arity = ARITY[tokens.slice(0, length).join(" ")]
    if (arity !== undefined) return tokens.slice(0, arity)
  }
  return tokens.slice(0, 1)
}
