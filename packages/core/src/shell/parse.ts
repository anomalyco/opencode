export * as ShellParse from "./parse.js"

import { Effect } from "effect"
import { fileURLToPath } from "url"
import path from "path"
import type { Node } from "web-tree-sitter"
import { shellParserWasm } from "#shell-parser-wasm"
import { ShellSelect } from "./select.js"

type Part = { type: string; text: string }
type SourceToken = { raw: string; value: string }
const CWD = new Set(["cd", "chdir", "popd", "pushd", "sl", "pop-location", "push-location", "set-location"])
const POWERSHELL_PATH_FLAGS = new Set(["-literalpath", "-path"])
const PORTABLE_BASH_SHELLS = new Set(["bash", "dash", "ksh", "sh", "zsh"])

export type Result = {
  commands: Array<{ resource: string; save: string }>
  directories: string[]
  analysis: "complete" | "opaque"
  directoryUnknown: boolean
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

export const scan = Effect.fnUntraced(function* (
  command: string,
  shell: string,
  cwd: string,
  options?: { portable?: boolean; env?: Record<string, string | undefined> },
) {
  if (options?.portable)
    return yield* Effect.promise(() => scanPortable(command, shell, cwd, options.env ?? process.env))
  return yield* scanLegacy(command, shell, cwd)
})

const scanLegacy = Effect.fnUntraced(function* (command: string, shell: string, cwd: string) {
  const parsers = yield* Effect.promise(load)
  const powershell = ShellSelect.ps(shell)
  const tree = (powershell ? parsers.ps : parsers.bash).parse(command)
  if (!tree) return yield* Effect.fail(new Error("Failed to parse shell command"))

  const result = yield* Effect.acquireUseRelease(
    Effect.succeed(tree),
    (tree) =>
      Effect.sync(() =>
        tree.rootNode.descendantsOfType("command").reduce(
          (result, node) => {
            if (!node) return result
            const command = parts(node)
            const tokens = command.map((part) => part.text)
            if (tokens.length === 0) return result
            const name = powershell ? tokens[0].toLowerCase() : tokens[0]
            if (CWD.has(name)) {
              result.directories.push(...directoryArgs(command, powershell, cwd, shell))
              return result
            }
            result.commands.push({
              resource: (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim(),
              save: `${prefix(tokens).join(" ")} *`,
            })
            return result
          },
          { commands: [] as Array<{ resource: string; save: string }>, directories: [] as string[] },
        ),
      ),
    (tree) => Effect.sync(() => tree.delete()),
  )
  return { ...result, analysis: "complete" as const, directoryUnknown: false }
})

async function scanPortable(
  command: string,
  shell: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<Result> {
  const { ShellScan } = await import("./scan.js")
  const powershell = ShellSelect.ps(shell)
  const supported = powershell || PORTABLE_BASH_SHELLS.has(ShellSelect.name(shell))
  const result = supported
    ? powershell
      ? ShellScan.scanPowerShell(command)
      : ShellScan.scan(command)
    : ({ kind: "opaque", reason: "invalid-structure" } as const)
  if (result.kind === "opaque")
    return {
      commands: [{ resource: command, save: command }],
      directories: [],
      analysis: "opaque" as const,
      directoryUnknown: true,
    }

  const parsed = result.commands.reduce(
    (output, item) => {
      const index = item[ShellScan.Nested] ? -1 : command.indexOf(item.resource, output.cursor)
      const offset = item[ShellScan.Nested]
        ? command.lastIndexOf(item.resource, output.cursor - 1)
        : index < 0
          ? command.indexOf(item.resource)
          : index
      if (index >= 0) output.cursor = index + item.resource.length
      const before = command.slice(0, Math.max(0, offset))
      const name = powershell ? powerShellCommandName(item.words[0]) : item.words[0]
      if (!name) return output
      if (powershell && name === "<") return output
      if (
        powershell &&
        name === "foreach-object" &&
        item.words.some((word) => word.startsWith("{")) &&
        !/\|\s*$/.test(before)
      )
        return output
      const tokens = powershell ? powerShellSourceTokens(item.resource) : sourceTokens(item.resource)
      const location = directoryCommand(item.words, powershell)
      if (location) {
        output.opaque ||= /[<>]/.test(item.resource)
        const directory = portableDirectoryArgs(location.words, tokens, powershell, cwd, shell, env, location.name)
        output.directories.push(...directory.values)
        output.directoryUnknown ||= directory.unknown || location.wrapped
        output.directoryChanges++
        return output
      }
      const save = powershell ? powerShellSourcePrefix(tokens, item.words) : bashSourcePrefix(tokens, item.words)
      output.commands.push({
        resource: powershell ? item.resource : bashResource(item.resource, before),
        save: `${save} *`,
      })
      return output
    },
    {
      commands: [] as Array<{ resource: string; save: string }>,
      directories: [] as string[],
      directoryUnknown: false,
      directoryChanges: 0,
      opaque: false,
      cursor: 0,
    },
  )
  const changesDirectoryEnvironment = !powershell && parsed.directoryChanges > 0 && /\b(?:CDPATH|HOME)\b/.test(command)
  if (parsed.opaque)
    return {
      commands: [{ resource: command, save: command }],
      directories: [],
      analysis: "opaque" as const,
      directoryUnknown: true,
    }
  return {
    commands: parsed.commands,
    directories: parsed.directories,
    analysis: "complete" as const,
    directoryUnknown: parsed.directoryUnknown || parsed.directoryChanges > 1 || changesDirectoryEnvironment,
  }
}

function bashResource(resource: string, before: string) {
  if (!/(?:&&|\|\||\|&)\s*$|\|\s*$/.test(before)) return resource
  const redirect = bashRedirect(resource)
  return redirect < 0 ? resource : resource.slice(0, redirect).replace(/\d+$/, "").trim()
}

function bashRedirect(resource: string) {
  let quote: "single" | "double" | undefined
  for (let index = 0; index < resource.length; index++) {
    const char = resource[index]
    if (quote === "single") {
      if (char === "'") quote = undefined
      continue
    }
    if (char === "\\") {
      index++
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (quote === "double") {
      if (char === "$" && resource[index + 1] === "(") index = bashParenthesizedEnd(resource, index + 1)
      else if (char === "`") index = bashBacktickEnd(resource, index)
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if ((char === "$" || char === "<" || char === ">") && resource[index + 1] === "(") {
      index = bashParenthesizedEnd(resource, index + 1)
      continue
    }
    if (char === "`") {
      index = bashBacktickEnd(resource, index)
      continue
    }
    if (char === "<" || char === ">" || (char === "&" && resource[index + 1] === ">")) return index
  }
  return -1
}

function bashParenthesizedEnd(resource: string, start: number) {
  let level = 1
  let quote: "single" | "double" | undefined
  for (let index = start + 1; index < resource.length; index++) {
    const char = resource[index]
    if (quote === "single") {
      if (char === "'") quote = undefined
      continue
    }
    if (char === "\\") {
      index++
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (quote === "double") continue
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === "(") level++
    if (char === ")" && --level === 0) return index
  }
  return resource.length - 1
}

function bashBacktickEnd(resource: string, start: number) {
  for (let index = start + 1; index < resource.length; index++) {
    if (resource[index] === "\\") index++
    else if (resource[index] === "`") return index
  }
  return resource.length - 1
}

function portableDirectoryArgs(
  command: string[],
  tokens: SourceToken[],
  powershell: boolean,
  cwd: string,
  shell: string,
  env: Record<string, string | undefined>,
  name: string,
) {
  if (["popd", "pushd", "pop-location", "push-location"].includes(name)) return { values: [], unknown: true }
  if (!powershell) {
    const start = tokens.findIndex((token) => token.value === command[0])
    if (start < 0) return { values: [], unknown: true }
    const args = tokens.slice(start + 1).filter((token) => token.raw === "-" || !token.raw.startsWith("-"))
    if (args.length === 0) {
      const home = environment(env, "HOME")
      if (["cd", "chdir"].includes(name) && home) return { values: [home], unknown: start > 0 }
      return { values: [], unknown: true }
    }
    const values = args.map((token) => directoryArgument(token.raw, false, cwd, shell, env))
    return {
      values: values.filter((value) => value !== undefined),
      unknown:
        start > 0 ||
        args.length > 1 ||
        values.some((value) => value === undefined) ||
        (Boolean(environment(env, "CDPATH")) &&
          values.some((value) => value !== undefined && !path.isAbsolute(value) && !value.startsWith("~"))),
    }
  }

  const start = tokens.findIndex((token) => token.value.toLowerCase() === command[0]?.toLowerCase())
  if (start < 0) return { values: [], unknown: true }
  const directories: string[] = []
  let unknown = false
  let expectsPath = false
  let argumentsSeen = 0
  for (const part of tokens.slice(start + 1).map((token) => token.raw)) {
    if (expectsPath) {
      const value = directoryArgument(part, true, cwd, shell, env)
      if (value) directories.push(value)
      else unknown = true
      argumentsSeen++
      expectsPath = false
      continue
    }
    if (part.startsWith("-")) {
      expectsPath = POWERSHELL_PATH_FLAGS.has(part.toLowerCase())
      continue
    }
    const value = directoryArgument(part, true, cwd, shell, env)
    if (value) directories.push(value)
    else unknown = true
    argumentsSeen++
  }
  if (expectsPath) unknown = true
  if (argumentsSeen === 0) {
    const home = environment(env, "HOME")
    if (["cd", "chdir", "set-location", "sl"].includes(name) && home) directories.push(home)
    else unknown = true
  }
  return { values: directories, unknown }
}

function directoryCommand(words: string[], powershell: boolean) {
  const name = powershell ? powerShellCommandName(words[0]) : words[0]
  if (CWD.has(name)) return { name, words, wrapped: false }
  if (powershell || !["builtin", "command"].includes(name ?? "")) return
  const index = words.findIndex((word, index) => index > 0 && !word.startsWith("-"))
  const wrapped = words[index]
  if (!CWD.has(wrapped)) return
  return { name: wrapped, words: words.slice(index), wrapped: true }
}

function sourceTokens(resource: string) {
  const tokens: SourceToken[] = []
  let raw = ""
  let value = ""
  let quote: "single" | "double" | "backtick" | undefined
  let substitution = 0
  let redirect = false

  const finish = () => {
    if (!raw) return
    if (!redirect) tokens.push({ raw, value })
    raw = ""
    value = ""
    redirect = false
  }

  for (let index = 0; index < resource.length; index++) {
    const char = resource[index]
    if (quote === "single") {
      raw += char
      if (char === "'") quote = undefined
      else value += char
      continue
    }
    if (quote === "double") {
      raw += char
      if (char === '"') quote = undefined
      else if (char === "\\" && index + 1 < resource.length) {
        const next = resource[index + 1]
        if ('$`"\\\n'.includes(next)) {
          raw += resource[++index]
          if (next !== "\n") value += next
        } else value += char
      } else value += char
      continue
    }
    if (quote === "backtick") {
      raw += char
      value += char
      if (char === "`" && resource[index - 1] !== "\\") quote = undefined
      continue
    }
    if (char === "'") {
      raw += char
      quote = "single"
      continue
    }
    if (char === '"') {
      raw += char
      quote = "double"
      continue
    }
    if (char === "`") {
      raw += char
      value += char
      quote = "backtick"
      continue
    }
    if (char === "\\" && index + 1 < resource.length) {
      if (resource[index + 1] === "\n") {
        finish()
        index++
        continue
      }
      if (!raw && /\s/.test(resource[index + 1])) {
        index++
        continue
      }
      raw += char + resource[++index]
      value += resource[index]
      continue
    }
    if ((char === "<" || char === ">") && resource[index + 1] === "(") {
      const end = bashParenthesizedEnd(resource, index + 1)
      if (raw) {
        raw += resource.slice(index, end + 1)
        value += resource.slice(index, end + 1)
      }
      index = end
      continue
    }
    if (char === "$" && resource[index + 1] === "(") substitution++
    if (char === ")" && substitution > 0) substitution--
    if (substitution === 0 && /\s/.test(char)) {
      finish()
      continue
    }
    if (substitution === 0 && (char === "<" || char === ">" || (char === "&" && resource[index + 1] === ">"))) {
      if (/^\d+$/.test(value)) {
        raw = ""
        value = ""
      } else finish()
      redirect = true
      if (char === "&") index++
      while (/[<>&|]/.test(resource[index + 1] ?? "")) index++
      continue
    }
    raw += char
    value += char
  }
  finish()

  return tokens
}

function bashSourcePrefix(tokens: SourceToken[], words: string[]) {
  const start = tokens.findIndex((token) => token.value === words[0])
  if (start < 0) {
    const command = tokens.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(token.raw))
    return prefix(tokens.slice(Math.max(0, command)).map((token) => token.raw)).join(" ")
  }
  const source = tokens
    .slice(start)
    .map((token) => token.raw)
    .filter((token) => !/^\$\([\s\S]*\)$/.test(token) && !/^`[\s\S]*`$/.test(token))
  return prefix(source).join(" ")
}

function powerShellSourcePrefix(tokens: SourceToken[], words: string[]) {
  const start = tokens.findIndex((token) => token.value.toLowerCase() === words[0]?.toLowerCase())
  if (start < 0) return prefix(words).join(" ")
  return prefix(tokens.slice(start).map((token) => token.raw)).join(" ")
}

function powerShellSourceTokens(resource: string) {
  const tokens: SourceToken[] = []
  let raw = ""
  let value = ""
  let quote: "single" | "double" | undefined
  let redirect = false

  const finish = () => {
    if (!raw) return
    if (!redirect) tokens.push({ raw, value })
    raw = ""
    value = ""
    redirect = false
  }

  for (let index = 0; index < resource.length; index++) {
    const char = resource[index]
    if (quote === "single") {
      raw += char
      if (char === "'" && resource[index + 1] === "'") {
        raw += resource[++index]
        value += "'"
      } else if (char === "'") quote = undefined
      else value += char
      continue
    }
    if (quote === "double") {
      raw += char
      if (char === '"') quote = undefined
      else if (char === "`" && index + 1 < resource.length) {
        raw += resource[++index]
        value += resource[index]
      } else value += char
      continue
    }
    if (char === "'") {
      raw += char
      quote = "single"
      continue
    }
    if (char === '"') {
      raw += char
      quote = "double"
      continue
    }
    if (char === "`" && index + 1 < resource.length) {
      raw += char + resource[++index]
      if (resource[index] !== "\n" && resource[index] !== "\r") value += resource[index]
      continue
    }
    if (char === "{" && !raw) {
      const end = powerShellBracedEnd(resource, index)
      raw = resource.slice(index, end + 1)
      value = raw
      index = end
      continue
    }
    if (/\s/.test(char)) {
      finish()
      continue
    }
    if (char === ">") {
      if (resource[index + 1] && !/[\s>&]/.test(resource[index + 1])) {
        raw += char
        value += char
        continue
      }
      if (/^\d+$/.test(value)) {
        raw = ""
        value = ""
      } else if (raw === "*") {
        raw = ""
        value = ""
      } else finish()
      redirect = true
      while (/[>&\d]/.test(resource[index + 1] ?? "")) index++
      continue
    }
    if ((char === "&" || char === ".") && !raw && tokens.length === 0) continue
    raw += char
    value += char
  }
  finish()
  return tokens
}

function powerShellBracedEnd(resource: string, start: number) {
  let level = 1
  let quote: "single" | "double" | undefined
  for (let index = start + 1; index < resource.length; index++) {
    const char = resource[index]
    if (char === "`" && quote !== "single") {
      index++
      continue
    }
    if (quote === "single") {
      if (char === "'" && resource[index + 1] === "'") index++
      else if (char === "'") quote = undefined
      continue
    }
    if (quote === "double") {
      if (char === '"') quote = undefined
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === '"') {
      quote = "double"
      continue
    }
    if (char === "{") level++
    if (char === "}" && --level === 0) return index
  }
  return resource.length - 1
}

function parts(node: Node) {
  return Array.from({ length: node.childCount }).flatMap((_, index): Part[] => {
    const child = node.child(index)
    if (!child) return []
    if (child.type === "command_elements")
      return Array.from({ length: child.childCount }).flatMap((_, itemIndex): Part[] => {
        const item = child.child(itemIndex)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") return []
        return [{ type: item.type, text: item.text }]
      })
    if (!["command_name", "command_name_expr", "word", "string", "raw_string", "concatenation"].includes(child.type))
      return []
    return [{ type: child.type, text: child.text }]
  })
}

function directoryArgs(command: Part[], powershell: boolean, cwd: string, shell: string) {
  if (!powershell)
    return command
      .slice(1)
      .filter((part) => !part.text.startsWith("-"))
      .map((part) => directoryArgument(part.text, powershell, cwd, shell))
      .filter((part) => part !== undefined)

  const directories: string[] = []
  let path = false
  for (const part of command.slice(1)) {
    if (path) {
      const value = directoryArgument(part.text, powershell, cwd, shell)
      if (value) directories.push(value)
      path = false
      continue
    }
    if (part.type === "command_parameter") {
      path = POWERSHELL_PATH_FLAGS.has(part.text.toLowerCase())
      continue
    }
    const value = directoryArgument(part.text, powershell, cwd, shell)
    if (value) directories.push(value)
  }
  return directories
}

function directoryArgument(
  value: string,
  powershell: boolean,
  cwd: string,
  shell: string,
  env: Record<string, string | undefined> = process.env,
) {
  const quote = value[0]
  const text = (quote === '"' || quote === "'") && value.at(-1) === quote ? value.slice(1, -1) : value
  if (!powershell) return expandKnownDirectory(text, env)

  // PowerShell exposes environment variables through $env:NAME and provides these
  // automatic directory variables. Expand only values we can determine without executing code.
  return expandKnownDirectory(
    text
      .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => environment(env, key) ?? "")
      .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => environment(env, key) ?? "")
      .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => {
        if (key.toUpperCase() === "HOME") return environment(env, "HOME") ?? ""
        if (key.toUpperCase() === "PWD") return cwd
        return path.dirname(shell)
      }),
    env,
  )
}

function expandKnownDirectory(value: string, env: Record<string, string | undefined> = process.env) {
  // Unknown shell expressions cannot be resolved safely during permission analysis.
  if (value.includes("$") || value.includes("`") || value.startsWith("(") || value === "-") return
  if (value === "~") return environment(env, "HOME")
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    const home = environment(env, "HOME")
    return home ? path.join(home, value.slice(2)) : undefined
  }
  if (value.startsWith("~")) return
  return value
}

function environment(env: Record<string, string | undefined>, key: string) {
  if (process.platform !== "win32") return env[key]
  const name = Object.keys(env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? env[name] : undefined
}

function powerShellCommandName(value: string | undefined) {
  const name = (value ?? "").toLowerCase()
  if (/^[a-z_][a-z0-9_.-]*\\[a-z_][a-z0-9_.-]*$/i.test(name)) return name.slice(name.lastIndexOf("\\") + 1)
  return name
}

function prefix(tokens: string[]) {
  for (let length = tokens.length; length > 0; length--) {
    const arity = ARITY[tokens.slice(0, length).join(" ")]
    if (arity !== undefined) return tokens.slice(0, arity)
  }
  return tokens.slice(0, 1)
}

function resolve(asset: string) {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (path.isAbsolute(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

const load = (() => {
  let loading: ReturnType<typeof initialize> | undefined
  return () => (loading ??= initialize())
})()

async function initialize() {
  const { Parser, Language } = await import("web-tree-sitter")
  await Parser.init({ locateFile: () => resolve(shellParserWasm.runtime) })
  const [bashLanguage, psLanguage] = await Promise.all([
    Language.load(resolve(shellParserWasm.bash)),
    Language.load(resolve(shellParserWasm.powershell)),
  ])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
}
