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

export function startScript(version: string, replace = false) {
  const command = replace ? "restart" : "start"

  // A conflict keeps its fixed port when the holder is an OpenCode service recorded by
  // a registration in this state directory, for example one left behind by a dropped
  // connection: stop it and start again on the configured port. A foreign or absent
  // listener (the default port sits inside the Linux ephemeral range) falls back to a
  // free port. Any other OpenCode service belongs to another profile, so it is left
  // untouched and the failure is reported.
  return `set -eu
export OPENCODE_SERVICE_PORT_OWNER_MARKER=1
cli="${binaryPath(version)}"
start() { "$cli" service ${command} "$@"; }
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
          *opencode*serve*--service*)
            kill "$pid" 2>/dev/null || true
            i=0
            while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 5 ]; do
              sleep 1
              i=$((i + 1))
            done
            kill -9 "$pid" 2>/dev/null || true
            ;;
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
    *) printf '%s\\n' "$output" >&2; exit 1 ;;
  esac
fi
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

  const registration = parseRegistration(yield* run(startScript(version, input.replace), "service"))

  if (!registration) return yield* Effect.fail(new SshFailure("service"))

  if (!input.development && registration.version !== input.version)
    return yield* Effect.fail(new SshFailure("version", registration.version))

  return yield* Effect.try({
    try: () => connectionAddress(registration.url, registration.password),
    catch: SshFailure.from,
  })
})
