import type { SshHostProbe, SshServerItem } from "../../preload/types"

export type SshDestination = {
  destination: string
  user: string | null
  host: string
  port: number | null
}

export const SSH_SERVER_EXIT_OPENCODE_MISSING = 27
export const SSH_OPENCODE_MISSING_MARKER = "OC_SSH_OPENCODE_MISSING"
export const SSH_PROBE_START_MARKER = "OC_SSH_PROBE_START"
export const SSH_PROBE_END_MARKER = "OC_SSH_PROBE_END"
export const SSH_PROBE_PATH_PREFIX = "OC_SSH_OPENCODE_PATH="
export const SSH_PROBE_VERSION_PREFIX = "OC_SSH_OPENCODE_VERSION="

const SSH_USER_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/
const SSH_HOST_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/
const SSH_IPV6_RE = /^[0-9A-Fa-f:.%]+$/

export function sshServerIdForHost(host: string) {
  return `ssh:${host}`
}

export function sshServerIdToRestart(servers: SshServerItem[], host: string) {
  return servers.find((item) => item.config.host === host)?.config.id
}

export function clearSshHostState(hostProbes: Record<string, SshHostProbe>, host: string) {
  const nextHostProbes = { ...hostProbes }
  delete nextHostProbes[host]
  return { hostProbes: nextHostProbes }
}

export function requireSshIpcString(name: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Invalid ${name}`)
}

/**
 * Parses `[user@]host[:port]` (including `[ipv6]:port` and bare ipv6) into the
 * destination handed to the system ssh client. Returns null for anything that
 * could be mistaken for an ssh option or smuggle extra arguments; the
 * destination is always passed after `--` as a single argv entry.
 */
export function parseSshDestination(input: string): SshDestination | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 256) return null
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) return null
  if (trimmed.startsWith("-")) return null

  const at = trimmed.lastIndexOf("@")
  const user = at === -1 ? null : trimmed.slice(0, at)
  const rest = at === -1 ? trimmed : trimmed.slice(at + 1)
  if (user !== null && !SSH_USER_RE.test(user)) return null
  if (!rest) return null

  const build = (host: string, port: number | null): SshDestination | null => {
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null
    const destination = user === null ? host : `${user}@${host}`
    return { destination, user, host, port }
  }

  const bracketed = rest.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/)
  if (bracketed) {
    if (!SSH_IPV6_RE.test(bracketed[1])) return null
    return build(bracketed[1], bracketed[2] ? Number.parseInt(bracketed[2], 10) : null)
  }

  const withPort = rest.match(/^([^:]+):(\d{1,5})$/)
  if (withPort && SSH_HOST_RE.test(withPort[1])) {
    return build(withPort[1], Number.parseInt(withPort[2], 10))
  }

  if (SSH_HOST_RE.test(rest)) return build(rest, null)
  // Bare IPv6 addresses contain multiple colons and are passed through as-is.
  if (rest.includes(":") && SSH_IPV6_RE.test(rest)) return build(rest, null)
  return null
}

export function normalizeSshHost(input: string) {
  const dest = parseSshDestination(input)
  if (!dest) return null
  const host = dest.host.includes(":") ? `[${dest.host}]` : dest.host
  const port = dest.port === null ? "" : `:${dest.port}`
  return `${dest.user === null ? "" : `${dest.user}@`}${host}${port}`
}

export function sshConnectionArgs(dest: SshDestination) {
  return [
    // The main process has no TTY to answer prompts on; fail fast instead of
    // hanging on password/2FA auth. Users fix auth interactively via openTerminal.
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    ...(dest.port === null ? [] : ["-p", String(dest.port)]),
  ]
}

export function sshRunArgs(dest: SshDestination) {
  // The script always travels over stdin (`sh -se`), never through remote
  // shell quoting.
  return [...sshConnectionArgs(dest), "--", dest.destination, "sh", "-se"]
}

export function sshTunnelArgs(dest: SshDestination, localPort: number, remotePort: number) {
  return [
    ...sshConnectionArgs(dest),
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    "--",
    dest.destination,
    "sh",
    "-se",
  ]
}

/**
 * The remote command that runs the opencode server. Wrapped in one compound
 * block so sh reads the entire script from stdin before executing it — the
 * stdin watchdog spawned inside would otherwise race sh for script bytes.
 * Stdin is kept open by the caller; when the ssh connection dies, the
 * watchdog sees EOF and stops the server so nothing is left running remotely.
 * POSIX assigns /dev/null to stdin of backgrounded commands, so the original
 * stdin is saved on fd 9 for the watchdog to read.
 */
export function buildSshServerScript(input: { password: string; remotePort: number; logLevel: string }) {
  return [
    "{",
    "set -eu",
    'if [ -x "$HOME/.opencode/bin/opencode" ]; then',
    '  OPENCODE="$HOME/.opencode/bin/opencode"',
    "elif command -v opencode >/dev/null 2>&1; then",
    '  OPENCODE="$(command -v opencode)"',
    "else",
    `  printf '%s\\n' "${SSH_OPENCODE_MISSING_MARKER}" >&2`,
    `  exit ${SSH_SERVER_EXIT_OPENCODE_MISSING}`,
    "fi",
    'cd "$HOME" || cd /',
    "export OPENCODE_CLIENT=desktop",
    `export OPENCODE_SERVER_USERNAME=${shellEscape("opencode")}`,
    `export OPENCODE_SERVER_PASSWORD=${shellEscape(input.password)}`,
    'export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"',
    "exec 9<&0",
    `"$OPENCODE" --print-logs --log-level ${input.logLevel} serve --hostname 127.0.0.1 --port ${input.remotePort} </dev/null &`,
    "OC_PID=$!",
    '{ cat 0<&9 >/dev/null 2>&1; kill "$OC_PID" 2>/dev/null; } &',
    'wait "$OC_PID"',
    "}",
    "",
  ].join("\n")
}

export function buildSshProbeScript() {
  return [
    "set -u",
    `printf '%s\\n' "${SSH_PROBE_START_MARKER}"`,
    'if [ -x "$HOME/.opencode/bin/opencode" ]; then',
    '  OPENCODE="$HOME/.opencode/bin/opencode"',
    "elif command -v opencode >/dev/null 2>&1; then",
    '  OPENCODE="$(command -v opencode)"',
    "else",
    '  OPENCODE=""',
    "fi",
    `printf '%s%s\\n' "${SSH_PROBE_PATH_PREFIX}" "$OPENCODE"`,
    'if [ -n "$OPENCODE" ]; then',
    `  printf '%s%s\\n' "${SSH_PROBE_VERSION_PREFIX}" "$("$OPENCODE" --version 2>/dev/null | head -n 1)"`,
    "fi",
    `printf '%s\\n' "${SSH_PROBE_END_MARKER}"`,
    "",
  ].join("\n")
}

export function buildSshInstallScript(version: string) {
  return [
    "set -eu",
    'command -v curl >/dev/null 2>&1 || { echo "curl is required to install opencode" >&2; exit 21; }',
    'command -v bash >/dev/null 2>&1 || { echo "bash is required to install opencode" >&2; exit 22; }',
    `curl -fsSL https://opencode.ai/install | bash -s -- --version ${shellEscape(version)}`,
    "",
  ].join("\n")
}

export function parseSshProbeOutput(stdout: string) {
  const lines = stdout.split(/\r?\n/g).map((line) => line.trim())
  const reachable = lines.includes(SSH_PROBE_END_MARKER)
  const pathLine = lines.find((line) => line.startsWith(SSH_PROBE_PATH_PREFIX))
  const versionLine = lines.find((line) => line.startsWith(SSH_PROBE_VERSION_PREFIX))
  const opencodePath = pathLine ? pathLine.slice(SSH_PROBE_PATH_PREFIX.length) : ""
  const opencodeVersion = versionLine ? versionLine.slice(SSH_PROBE_VERSION_PREFIX.length) : ""
  return {
    reachable,
    opencodePath: opencodePath.length > 0 ? opencodePath : null,
    opencodeVersion: opencodeVersion.length > 0 ? opencodeVersion : null,
  }
}

export function sshOutputIndicatesOpencodeMissing(output: string[], code: number | null) {
  if (code === SSH_SERVER_EXIT_OPENCODE_MISSING) return true
  return output.some((line) => line.includes(SSH_OPENCODE_MISSING_MARKER))
}

export function sshOutputIndicatesPortConflict(output: string[]) {
  return output.some((line) => /EADDRINUSE|address already in use|already in use|Is port \d+ in use/i.test(line))
}

export function windowsSshTerminalArgs(dest: SshDestination) {
  return ["/c", "start", "", "ssh", ...(dest.port === null ? [] : ["-p", String(dest.port)]), dest.destination]
}

export function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}
