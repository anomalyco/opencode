import { Effect, Option, Schema } from "effect"
import { HttpClient } from "effect/http"
import { parseTarget, quote, runSsh, sshArgs, SshFailure } from "./command"
import { RemoteCli } from "./remote-cli"

// Use commands supported by released V2 CLIs. The registration is the service's
// complete private discovery contract; no remote Python/Node runtime is needed.
const registrationScript = `status=$("$cli" service status) || exit 0
if [ "$status" = stopped ]; then exit 0; fi
printf 'OPENCODE_SSH_STATUS=%s\\n' "$status"
for file in "\${XDG_STATE_HOME:-$HOME/.local/state}"/opencode/service*.json; do
  if [ ! -f "$file" ]; then continue; fi
  printf 'OPENCODE_SSH_REGISTRATION_BEGIN\\n'
  cat "$file"
  printf '\\nOPENCODE_SSH_REGISTRATION_END\\n'
done
`

export function discoverScript(version: string) {
  const own = binaryPath(version)

  return `set -eu
${RemoteCli.discoverScript({ fromPath: true, cache: { directory: ".opencode/desktop-ssh", prefix: "0.0.0-beta-" } })}
if [ -z "$cli" ] && [ -x "${own}" ]; then cli="${own}"; fi
if [ -z "$cli" ]; then exit 0; fi
${registrationScript}`
}

export function startScript(version: string, replace = false, mode?: "reclaim" | "free") {
  const command = replace ? "restart" : "start"

  // A conflict keeps its fixed port when the holder is an OpenCode service recorded by
  // a registration in this state directory, for example one left behind by a dropped
  // connection: stop it and start again on the configured port. A foreign or absent
  // listener (the default port sits inside the Linux ephemeral range) falls back to a
  // free port. Any other OpenCode service belongs to another profile, so it is left
  // untouched and the failure is reported.
  //
  // A released CLI that predates the port-owner markers only prints the user-facing
  // message. The dialog turns that into a choice: `reclaim` kills a listening OpenCode
  // service and retries the same port, `free` starts on another port.
  return `set -eu
export OPENCODE_SERVICE_PORT_OWNER_MARKER=1
cli="${binaryPath(version)}"
mode=${quote(mode ?? "")}
start() { "$cli" service ${command} "$@"; }
listener() {
  port=$1
  pid=
  if command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1)
  fi
  if [ -z "$pid" ] && command -v ss >/dev/null 2>&1; then
    pid=$(ss -lptn 2>/dev/null | grep -F ":$port " | sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p' | head -n 1)
  fi
  # Linux without lsof or ss: match the listening socket's inode in /proc/*/fd.
  if [ -z "$pid" ] && [ -r /proc/net/tcp ]; then
    inode=$(awk -v suffix=":$(printf '%04X' "$port")" '$4 == "0A" && substr($2, length($2) - length(suffix) + 1) == suffix { print $10; exit }' /proc/net/tcp /proc/net/tcp6 2>/dev/null)
    if [ -n "$inode" ]; then
      for fd in /proc/[0-9]*/fd/*; do
        if [ "$(readlink "$fd" 2>/dev/null)" = "socket:[$inode]" ]; then
          pid=\${fd#/proc/}
          pid=\${pid%%/*}
          break
        fi
      done
    fi
  fi
  printf '%s' "$pid"
}
conflict_port() {
  printf '%s\\n' "$1" | sed -n 's/.*Managed service port \\([0-9][0-9]*\\) on .*/\\1/p' | head -n 1
}
report_port() {
  printf '%s\\n' "OPENCODE_SERVICE_PORT_IN_USE=$1" >&2
  printf '%s\\n' "$2" >&2
  exit 1
}
kill_service() {
  kill "$1" 2>/dev/null || true
  i=0
  while kill -0 "$1" 2>/dev/null && [ "$i" -lt 5 ]; do
    sleep 1
    i=$((i + 1))
  done
  kill -9 "$1" 2>/dev/null || true
}
pick_port() {
  awk -v seed="$$$1" 'BEGIN { srand(seed); print 20000 + int(rand() * 30000) }'
}
# Persists the chosen port, so a later cold start does not fall back to the taken default.
free_port() {
  attempt=0
  output=
  while [ "$attempt" -lt 20 ]; do
    port=$(pick_port "$attempt")
    attempt=$((attempt + 1))
    if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$port "; then continue; fi
    if ! setout=$("$cli" service set port "$port" 2>&1); then
      output=$setout
      continue
    fi
    if output=$(start 2>&1); then return 0; fi
  done
  report_port "$(conflict_port "$output")" "$output"
}
reclaim() {
  port=$(conflict_port "$1")
  [ -n "$port" ] || report_port 0 "$1"
  pid=$(listener "$port")
  # A port can be unavailable without a listening process (a closed connection or a reserved
  # port). Killing cannot help there, so name that case instead of retrying the same port.
  if [ -z "$pid" ]; then
    report_port "$port" "No process is listening on port $port, so there is nothing to kill. Use \\"Use another port\\" to start the service on a free port."
  fi
  command=$(ps -o command= -p "$pid" 2>/dev/null || true)
  case "$command" in
    *opencode*serve*--service*) ;;
    *) report_port "$port" "Port $port is held by PID $pid ($command), which is not an OpenCode service. Use \\"Use another port\\" instead." ;;
  esac
  if ! kill "$pid" 2>/dev/null; then
    report_port "$port" "Could not stop PID $pid on port $port. Start on another port."
  fi
  i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 5 ]; do
    sleep 1
    i=$((i + 1))
  done
  kill -9 "$pid" 2>/dev/null || true
  if ! retry=$(start 2>&1); then report_port "$port" "$retry"; fi
}
case "$mode" in
  free)
    free_port
    ;;
  reclaim)
    if ! output=$(start 2>&1); then
      case "$output" in
        *"is already in use by "*) reclaim "$output" ;;
        *) printf '%s\\n' "$output" >&2; exit 1 ;;
      esac
    fi
    ;;
  *)
    if ! output=$(start 2>&1); then
      case "$output" in
        *"OPENCODE_SERVICE_PORT_OWNER=opencode"*)
          pid=$(printf '%s\\n' "$output" | sed -n 's/^OPENCODE_SERVICE_PORT_OWNER_PID=//p')
          own=
          for file in "\${XDG_STATE_HOME:-$HOME/.local/state}"/opencode/service*.json; do
            if [ -f "$file" ] && grep -Eq "\\"pid\\"[[:space:]]*:[[:space:]]*$pid([^0-9]|$)" "$file"; then
              own=1
              break
            fi
          done
          if [ "$own" = 1 ]; then
            verify=$(ps -o command= -p "$pid" 2>/dev/null || true)
            case "$verify" in
              *opencode*serve*--service*) kill_service "$pid" ;;
            esac
            if ! retry=$(start 2>&1); then
              printf '%s\\n%s\\n' "$output" "$retry" >&2
              exit 1
            fi
          else
            printf '%s\\n' "$output" >&2
            exit 1
          fi
          ;;
        *"OPENCODE_SERVICE_PORT_OWNER=foreign"*|*"OPENCODE_SERVICE_PORT_OWNER=none"*)
          if ! retry=$(start --port 0 2>&1); then
            printf '%s\\n%s\\n' "$output" "$retry" >&2
            exit 1
          fi
          ;;
        *"is already in use by "*)
          report_port "$(conflict_port "$output")" "$output"
          ;;
        *) printf '%s\\n' "$output" >&2; exit 1 ;;
      esac
    fi
    ;;
esac
${registrationScript}`
}

const Registration = Schema.fromJsonString(
  Schema.Struct({
    url: Schema.String,
    password: Schema.String,
    version: Schema.String,
    pid: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
)

export function parseRegistration(output: string) {
  const status = output
    .split(/\r?\n/)
    .findLast((line) => line.startsWith("OPENCODE_SSH_STATUS="))
    ?.slice("OPENCODE_SSH_STATUS=".length)

  if (!status) return undefined

  for (const match of output.matchAll(
    /OPENCODE_SSH_REGISTRATION_BEGIN\r?\n([\s\S]*?)\r?\nOPENCODE_SSH_REGISTRATION_END/g,
  )) {
    const result = Schema.decodeUnknownOption(Registration)(match[1])

    if (Option.isSome(result) && result.value.url === status) return result.value
  }

  return undefined
}

export function binaryPath(version: string) {
  return `$HOME/.opencode/desktop-ssh/${RemoteCli.requireVersion(version)}/opencode`
}

function connectionAddress(address: string, password: string) {
  const url = new URL(address)

  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "0.0.0.0", "[::]", "[::1]"].includes(url.hostname))
    throw new SshFailure("service")

  return {
    host: url.hostname === "[::1]" ? "[::1]" : "127.0.0.1",
    port: Number(url.port || 80),
    password,
  }
}

export const bootstrap = Effect.fn("Ssh.bootstrap")(function* (input: {
  target: ReturnType<typeof parseTarget>
  version: string
  development?: boolean
  env: NodeJS.ProcessEnv
  replace?: boolean
  /** How to resolve a port the remote service cannot bind. */
  port?: "reclaim" | "free"
}) {
  const run = (script: string, remoteFailure?: SshFailure["code"]) =>
    runSsh({
      args: [...sshArgs(input.target), input.target.host, "sh -l -s"],
      env: input.env,
      stdin: script,
      remoteFailure,
    })

  const discover = yield* Effect.try({ try: () => discoverScript(input.version), catch: SshFailure.from })
  const registered = parseRegistration(yield* run(discover))

  if (registered && (input.development || registered.version === input.version))
    return yield* Effect.try({
      try: () => connectionAddress(registered.url, registered.password),
      catch: SshFailure.from,
    })

  if (registered && !input.replace) return yield* Effect.fail(new SshFailure("version", registered.version))
  const destination = yield* Effect.try({ try: () => binaryPath(input.version), catch: SshFailure.from })
  const existing = yield* run(RemoteCli.versionScript(`"${destination}"`))
  const staged = RemoteCli.parseVersion(existing) === input.version

  // Source worktree versions are unpublished. Use the installer's beta channel
  // while retaining support for explicitly staged, matching development builds.
  const version =
    input.development && !staged ? yield* RemoteCli.latestBeta().pipe(Effect.mapError(SshFailure.from)) : input.version

  const setup = { version, directory: `.opencode/desktop-ssh/${version}` }

  if (!staged) {
    const output = yield* run(RemoteCli.probeScript, "platform")

    const target = output
      .split(/\r?\n/)
      .findLast((line) => line.startsWith("OPENCODE_REMOTE_TARGET="))
      ?.split("=")[1]

    const url = yield* Effect.try({ try: () => RemoteCli.archiveUrl(target ?? "", version), catch: SshFailure.from })
    yield* run(RemoteCli.installScript({ ...setup, source: { type: "download", url } })).pipe(
      Effect.catch(
        Effect.fnUntraced(function* (error) {
          const http = yield* HttpClient.HttpClient
          const response = yield* http.get(url).pipe(Effect.mapError(SshFailure.from))

          if (response.status < 200 || response.status >= 300)
            return yield* Effect.fail(
              new SshFailure(
                response.status === 404 ? "unpublished" : "install",
                JSON.stringify({ version, target, url, status: response.status }),
              ),
            )
          const archive = new Uint8Array(yield* response.arrayBuffer.pipe(Effect.mapError(SshFailure.from)))

          // The upload uses stdin; the script itself must be the remote command.
          return yield* runSsh({
            args: [
              ...sshArgs(input.target),
              input.target.host,
              `sh -c ${quote(RemoteCli.installScript({ ...setup, source: { type: "archive" } }))}`,
            ],
            env: input.env,
            stdin: archive,
          }).pipe(Effect.mapError(() => new SshFailure("install", error.message)))
        }),
      ),
    )
  }

  const registration = parseRegistration(
    yield* run(startScript(version, input.replace, input.port), "service").pipe(
      Effect.mapError((failure) =>
        /^OPENCODE_SERVICE_PORT_IN_USE=\d+$/m.test(failure.detail) ? new SshFailure("port", failure.detail) : failure,
      ),
    ),
  )

  if (!registration) return yield* Effect.fail(new SshFailure("service"))

  if (!input.development && registration.version !== input.version)
    return yield* Effect.fail(new SshFailure("version", registration.version))

  return yield* Effect.try({
    try: () => connectionAddress(registration.url, registration.password),
    catch: SshFailure.from,
  })
})
