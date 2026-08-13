export * as ShellParse from "./parse.js"

import { Effect } from "effect"
import { ShellScan } from "@opencode-ai/shell-scan"
import os from "os"
import path from "path"
import { ShellSelect } from "./select.js"

const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location", "sl"])
const POWERSHELL_PATH_FLAGS = new Set(["-literalpath", "-path"])

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

export const scan = Effect.fn("ShellParse.scan")(function* (command: string, shell: string, cwd: string) {
  return scanCommands(command, cwd, shell, ShellSelect.ps(shell))
})

function scanCommands(command: string, cwd: string, shell: string, powershell: boolean) {
  const result = powershell ? ShellScan.scanPowerShell(command) : ShellScan.scan(command)
  if (result.kind === "opaque")
    return {
      commands: [{ resource: command, save: command }],
      directories: [],
      opaque: true,
      directoryUnknown: true,
    }
  if (
    result.commands.some((item) => {
      const name = powershell ? item.words[0]?.toLowerCase() : item.words[0]
      if (!name || !CWD.has(name) || name === "popd" || name === "pop-location") return false
      return directoryArgs(item.words, powershell, cwd, shell).length === 0
    })
  )
    return { commands: [{ resource: command }], directories: [], opaque: true, directoryUnknown: true }
  return result.commands.reduce(
    (output, item) => {
      const name = powershell ? item.words[0]?.toLowerCase() : item.words[0]
      if (!name) return output
      if (CWD.has(name)) {
        output.directories.push(...directoryArgs(item.words, powershell, cwd, shell))
        return output
      }
      output.commands.push({ resource: item.resource, save: `${prefix(item.words).join(" ")} *` })
      return output
    },
    {
      commands: [] as Array<{ resource: string; save: string }>,
      directories: [] as string[],
      opaque: false,
    },
  )
}

function directoryArgs(command: string[], powershell: boolean, cwd: string, shell: string) {
  if (!powershell) {
    const values = command
      .slice(1)
      .filter((part) => !part.startsWith("-"))
      .map((part) => directoryArgument(part, powershell, cwd, shell))
      .filter((part) => part !== undefined)
    if (command[0] === "cd" && (values.length !== 1 || (!path.isAbsolute(values[0]) && Boolean(process.env.CDPATH))))
      return []
    return values
  }

  const directories: string[] = []
  let expectsPath = false
  for (const part of command.slice(1)) {
    if (expectsPath) {
      const value = directoryArgument(part, powershell, cwd, shell)
      if (value) directories.push(value)
      expectsPath = false
      continue
    }
    if (part.startsWith("-")) {
      expectsPath = POWERSHELL_PATH_FLAGS.has(part.toLowerCase())
      continue
    }
    const value = directoryArgument(part, powershell, cwd, shell)
    if (value) directories.push(value)
  }
  return directories
}

function directoryArgument(value: string, powershell: boolean, cwd: string, shell: string) {
  const quote = value[0]
  const text = (quote === '"' || quote === "'") && value.at(-1) === quote ? value.slice(1, -1) : value
  if (!powershell) return expandKnownDirectory(text)

  // PowerShell exposes environment variables through $env:NAME and provides these
  // automatic directory variables. Expand only values we can determine without executing code.
  return expandKnownDirectory(
    text
      .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => environment(key) ?? "")
      .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => environment(key) ?? "")
      .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => {
        if (key.toUpperCase() === "HOME") return os.homedir()
        if (key.toUpperCase() === "PWD") return cwd
        return path.dirname(shell)
      }),
  )
}

function expandKnownDirectory(value: string) {
  // Unknown shell expressions cannot be resolved safely during permission analysis.
  if (value.includes("$") || value.includes("`") || value.startsWith("(")) return
  if (value === "~") return os.homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2))
  if (value.startsWith("~")) return
  return value
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
