// What the C.8 (`service`) and C.9 (`pair`) scenarios share. Both clients run in the sandbox as channel
// `local`, the channel of the TS CLI from source: config and registration are `service-local.json` under the
// sandbox's XDG roots. A registered service is the fake server, under this runner's pid, so discovery accepts
// it; no scenario stops a registered service, which would signal the runner. `opencode-rs` gets a TS binary that
// does not exist, so it can never start a real service.
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { command, type Side } from "../../cli/client"
import type { Route } from "../../lib/fake-server"

export const env = { OPENCODE_CHANNEL: "local", OPENCODE_TS_BIN: "/nonexistent/opencode-ts" }

export const configFile = "home/.config/opencode/service-local.json"

export async function writeConfig(root: string, config: unknown) {
  await mkdir(path.join(root, "home/.config/opencode"), { recursive: true })
  await writeFile(path.join(root, configFile), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
}

export async function register(root: string, server: string | undefined) {
  if (server === undefined) throw new Error("register needs a fake server")
  await mkdir(path.join(root, "home/.local/state/opencode"), { recursive: true })
  await writeFile(
    path.join(root, "home/.local/state/opencode/service-local.json"),
    JSON.stringify({ id: "fake", version: "local", url: server, pid: process.pid, password: "private" }),
    { mode: 0o600 },
  )
}

// `/api/info` of the registered fake service: the runner's pid, as in the registration.
export function info(urls: string[]): Route {
  return {
    path: "/api/info",
    json: { version: "local", pid: process.pid, urls, paths: { tmp: "/tmp" }, capabilities: { persistentPty: true } },
  }
}

export const pairRoute: Route = { method: "POST", path: "/api/pair", json: { code: "PAIRCODE42", expires_in: 600 } }

// Several commands in one shell, each followed by its exit code, then the config file, so a case compares what the
// edits wrote.
export function script(steps: string[][], options: { cat?: boolean } = {}) {
  return (side: Side) => {
    // TS from source prints a stack trace under an error; it names TS internals, so it is dropped.
    const lines = steps.map(
      (args) =>
        `${command(side, args).map(quote).join(" ")} 2>"$TMPDIR/stderr"; code=$?; grep -v '^    at ' "$TMPDIR/stderr" >&2; echo "exit $code"`,
    )
    if (options.cat) lines.push(`cat ${quote(path.join("..", configFile))}`)
    return ["sh", "-c", lines.join("\n")]
  }
}

export function quote(arg: string) {
  return `'${arg.replaceAll("'", `'\\''`)}'`
}

// One command, without the `--server` flag P-CLI otherwise appends: these commands find the service themselves.
export function only(args: string[]) {
  return (side: Side) => command(side, args)
}

// `only`, with the port numbers on stderr masked: `pair`'s SSH hint names the fake server's port, which differs
// between the sides.
export function masked(args: string[]) {
  return (side: Side) => [
    "sh",
    "-c",
    `${command(side, args).map(quote).join(" ")} 2>"$TMPDIR/stderr"; code=$?; sed -E 's/\\b[0-9]{4,5}\\b/<port>/g' "$TMPDIR/stderr" >&2; exit $code`,
  ]
}

// An OpenTunnel identity in the sandbox's XDG data directory, as the SDK stores it once the certificate is ready.
export async function tunnel(root: string, hostname: string) {
  const dir = path.join(root, "home/.local/share/opentunnel/default")
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, "tunnel.json"),
    JSON.stringify({ id: "tun_test", hostname, certificateExpiry: "2099-01-01T00:00:00.000Z" }),
  )
  for (const name of ["token", "private-key.pem", "certificate.pem", "chain.pem"])
    await writeFile(path.join(dir, name), name === "chain.pem" ? "" : "x")
}
