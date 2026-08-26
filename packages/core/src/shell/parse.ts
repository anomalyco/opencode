export * as ShellParse from "./parse.js"

import { Effect } from "effect"
import { fileURLToPath } from "url"
import path from "path"
import type { Node } from "web-tree-sitter"
import { shellParserWasm } from "#shell-parser-wasm"
import { ShellSelect } from "./select.js"

type Part = { type: string; text: string }
const BASH_CWD = new Set(["cd", "popd", "pushd"])
const POWERSHELL_CWD = new Set([...BASH_CWD, "chdir", "sl", "pop-location", "push-location", "set-location"])
const POWERSHELL_PATH_FLAGS = new Set(["-literalpath", "-path"])
const PORTABLE_BASH_SHELLS = new Set(["bash", "dash", "sh"])

export type Result = {
  commands: Array<{ resource: string; save?: string }>
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
const PREFIX_LENGTH = Math.max(...Object.keys(ARITY).map((command) => command.split(" ").length))

export const scan = Effect.fnUntraced(function* (
  command: string,
  shell: string,
  cwd: string,
  options?: { portable?: boolean; env?: Record<string, string | undefined> },
) {
  if (options?.portable) return yield* Effect.promise(() => scanPortable(command, shell, options.env ?? process.env))
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
            if (
              (powershell ? POWERSHELL_CWD : BASH_CWD).has(name) ||
              (ShellSelect.name(shell) === "zsh" && name === "chdir")
            ) {
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

async function scanPortable(command: string, shell: string, env: Record<string, string | undefined>): Promise<Result> {
  const powershell = ShellSelect.ps(shell)
  const shellName = ShellSelect.name(shell)
  const opaque: Result = {
    commands: [{ resource: command }],
    directories: [],
    analysis: "opaque",
    directoryUnknown: true,
  }
  // In particular, zsh loads .zshenv even for noninteractive invocations.
  if ((!powershell && !PORTABLE_BASH_SHELLS.has(shellName)) || shellStartupUnknown(shellName, env)) return opaque
  const { ShellScan } = await import("./scan.js")
  const result = powershell ? ShellScan.scanPowerShell(command) : ShellScan.scan(command)
  if (result.kind === "opaque") return opaque

  const directories: string[] = []
  let directoryUnknown = false
  for (const item of result.commands) {
    if (directoryUnknown) break
    const location = directoryCommand(item.words, powershell)
    if (!location) continue
    // Later changes may run in another branch, group, or directory stack.
    if (
      directories.length > 0 ||
      location.wrapped ||
      ["popd", "pushd", "pop-location", "push-location"].includes(location.name)
    ) {
      directoryUnknown = true
      continue
    }
    const args = item.words.slice(1)
    const first = command.trimStart().startsWith(item.resource) && /^cd(?:[ \t]|$)/.test(item.resource)
    if (!powershell && args.length === 0) {
      const home = environment(env, "HOME")
      if (first && home && path.posix.isAbsolute(home)) directories.push(home)
      else directoryUnknown = true
      continue
    }
    const endOfOptions = !powershell && args[0] === "--"
    if (!powershell && ["-L", "--"].includes(args[0])) args.shift()
    if (powershell) {
      if (POWERSHELL_PATH_FLAGS.has(args[0]?.toLowerCase())) args.shift()
      else {
        const parameter = /^-(?:literalpath|path):(.+)$/i.exec(args[0] ?? "")
        if (parameter) args[0] = parameter[1]
      }
    }
    const directory = args[0]
    // Decoded words do not retain quote provenance. Never guess whether a
    // wildcard, variable, tilde, or provider path is literal or expanded.
    if (
      args.length !== 1 ||
      !directory ||
      directory === "-" ||
      directory === "+" ||
      (!endOfOptions && directory.startsWith("-")) ||
      /[$`*?{}\[\]()~]/.test(directory) ||
      (powershell && directory.includes(":") && !/^[A-Za-z]:[\\/]/.test(directory))
    ) {
      directoryUnknown = true
      continue
    }
    // Bare relative Bash operands use CDPATH. Prior source or prefix assignments
    // can change the lookup environment, including through printf -vHOME.
    if (!powershell && !/^(?:\/|\.{1,2}(?:\/|$))/.test(directory) && (!first || environment(env, "CDPATH"))) {
      directoryUnknown = true
      continue
    }
    directories.push(directory)
  }
  return {
    commands: result.commands.map((item) => {
      const tokens = prefix(item.words)
      // Saved permissions are globs, not shell strings. Validate each decoded
      // token separately so quoting cannot introduce wildcards or word boundaries.
      const save = tokens.length > 0 && tokens.every((token) => /^[A-Za-z0-9_./:@%+=,-]+$/.test(token))
      return { resource: item.resource, ...(save ? { save: `${tokens.join(" ")} *` } : {}) }
    }),
    directories,
    analysis: "complete",
    directoryUnknown,
  }
}

function directoryCommand(words: string[], powershell: boolean) {
  let index = 0
  while (!powershell && ["builtin", "command"].includes(words[index] ?? "")) {
    index = words.findIndex((word, offset) => offset > index && !word.startsWith("-"))
    if (index < 0) return
  }
  const name = powershell ? powerShellCommandName(words[index]) : words[index]
  if (!(powershell ? POWERSHELL_CWD : BASH_CWD).has(name)) return
  return { name, wrapped: index > 0 }
}

function shellStartupUnknown(shell: string, env: Record<string, string | undefined>) {
  return (
    shell === "bash" &&
    (Boolean(environment(env, "BASH_ENV")) || Object.keys(env).some((key) => key.startsWith("BASH_FUNC_")))
  )
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

function directoryArgument(value: string, powershell: boolean, cwd: string, shell: string) {
  const quote = value[0]
  const text = (quote === '"' || quote === "'") && value.at(-1) === quote ? value.slice(1, -1) : value
  if (!powershell) return expandKnownDirectory(text, process.env)

  // PowerShell exposes environment variables through $env:NAME and provides these
  // automatic directory variables. Expand only values we can determine without executing code.
  return expandKnownDirectory(
    text
      .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => environment(process.env, key) ?? "")
      .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => environment(process.env, key) ?? "")
      .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => {
        if (key.toUpperCase() === "HOME") return environment(process.env, "HOME") ?? ""
        if (key.toUpperCase() === "PWD") return cwd
        return path.dirname(shell)
      }),
    process.env,
  )
}

function expandKnownDirectory(value: string, env: Record<string, string | undefined>) {
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
  const name = Object.keys(env)
    .filter((item) => item.toLowerCase() === key.toLowerCase())
    .sort()[0]
  return name ? env[name] : undefined
}

function powerShellCommandName(value: string | undefined) {
  const name = (value ?? "").toLowerCase()
  if (/^[a-z_][a-z0-9_.-]*\\[a-z_][a-z0-9_.-]*$/i.test(name)) return name.slice(name.lastIndexOf("\\") + 1)
  return name
}

function prefix(tokens: string[]) {
  for (let length = Math.min(tokens.length, PREFIX_LENGTH); length > 0; length--) {
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
