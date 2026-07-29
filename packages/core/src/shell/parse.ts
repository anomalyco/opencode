export * as ShellParse from "./parse"

import { Effect } from "effect"
import { fileURLToPath } from "url"
import type { Node } from "web-tree-sitter"
import { ShellSelect } from "./select"

type Part = { type: string; text: string }

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

export const permissions = Effect.fn("ShellParse.permissions")(function* (command: string, shell: string) {
  const parsers = yield* Effect.promise(load)
  const tree = (ShellSelect.ps(shell) ? parsers.ps : parsers.bash).parse(command)
  if (!tree) return yield* Effect.fail(new Error("Failed to parse shell command"))

  return yield* Effect.acquireUseRelease(
    Effect.succeed(tree),
    (tree) =>
      Effect.sync(() =>
        tree.rootNode.descendantsOfType("command").flatMap((node) => {
          if (!node) return []
          const tokens = parts(node).map((part) => part.text)
          if (tokens.length === 0 || isChangeDirectory(tokens[0], shell)) return []
          return [{ resource: source(node), save: `${prefix(tokens).join(" ")} *` }]
        }),
      ),
    (tree) => Effect.sync(() => tree.delete()),
  )
})

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

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function isChangeDirectory(command: string, shell: string) {
  const name = ShellSelect.ps(shell) ? command.toLowerCase() : command
  return new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"]).has(name)
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
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

const load = (() => {
  let loading: ReturnType<typeof initialize> | undefined
  return () => (loading ??= initialize())
})()

async function initialize() {
  const { Parser, Language } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } })
  await Parser.init({ locateFile: () => resolve(treeWasm) })
  const [{ default: bashWasm }, { default: psWasm }] = await Promise.all([
    import("tree-sitter-bash/tree-sitter-bash.wasm" as string, { with: { type: "wasm" } }),
    import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, { with: { type: "wasm" } }),
  ])
  const [bashLanguage, psLanguage] = await Promise.all([
    Language.load(resolve(bashWasm)),
    Language.load(resolve(psWasm)),
  ])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
}
