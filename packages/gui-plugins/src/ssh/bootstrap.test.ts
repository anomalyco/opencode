import { expect, test } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testEffect } from "../../../core/test/lib/effect"
import { binaryPath, bootstrap, parseRegistration } from "./bootstrap"
import { parseTarget, sshFailureCode, SshFailure } from "./command"
import { RemoteCli } from "./remote-cli"

const it = testEffect(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))

// The stand-in remote runs the bootstrap scripts with `sh`, so these cases need a POSIX shell.
const bootTest = process.platform === "win32" ? it.live.skip : it.live

const VERSION = "2.0.26"

const URL = "http://127.0.0.1:54321"

const FIXED_URL = "http://127.0.0.1:49374"

test("ignores stopped services and registrations that do not match the healthy endpoint", () => {
  const registration = { url: "http://127.0.0.1:1234", password: "secret", version: "2.0.0", pid: 42 }
  const frame = `OPENCODE_SSH_REGISTRATION_BEGIN\n${JSON.stringify(registration)}\nOPENCODE_SSH_REGISTRATION_END\n`
  expect(parseRegistration(`OPENCODE_SSH_STATUS=stopped\n${frame}`)).toBeUndefined()
  expect(parseRegistration(`OPENCODE_SSH_STATUS=http://127.0.0.1:9999\n${frame}`)).toBeUndefined()
  expect(
    parseRegistration(
      `OPENCODE_SSH_STATUS=${registration.url}\nOPENCODE_SSH_REGISTRATION_BEGIN\ninvalid\nOPENCODE_SSH_REGISTRATION_END\n`,
    ),
  ).toBeUndefined()
})

test("rejects unsafe versions and platforms in remote installation paths", () => {
  expect(() => binaryPath('2.0.0"; whoami')).toThrow()
  expect(RemoteCli.archiveUrl("linux-x64-baseline-musl", "2.0.0-beta.1")).toBe(
    "https://registry.npmjs.org/@opencode/cli-linux-x64-baseline-musl/-/cli-linux-x64-baseline-musl-2.0.0-beta.1.tgz",
  )
  expect(() => RemoteCli.installScript({ version: '2.0.0"; whoami', source: { type: "installer" } })).toThrow()
  expect(() => RemoteCli.archiveUrl("linux-x64;whoami", "2.0.0")).toThrow()
})

test("keeps a remote command failure on its own step and OpenSSH failures as connections", () => {
  expect(sshFailureCode(255, "service")).toBe("connection")
  expect(sshFailureCode(1, "service")).toBe("service")
  expect(sshFailureCode(1)).toBe("connection")
})

// A stand-in remote: `ssh` runs the script it receives, and the private CLI answers
// `--version`, `service status`, and `service start` the way the shipping CLI does.
async function remote(cli: string) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "oc-ssh-bootstrap-"))
  const bin = path.join(home, "bin")

  await fs.mkdir(bin, { recursive: true })
  await fs.mkdir(path.dirname(path.join(home, ".opencode/desktop-ssh", VERSION, "opencode")), { recursive: true })
  await fs.mkdir(path.join(home, ".local/state/opencode"), { recursive: true })
  await fs.writeFile(path.join(bin, "ssh"), "#!/bin/sh\nexec sh -s\n", { mode: 0o755 })
  await fs.writeFile(path.join(home, ".opencode/desktop-ssh", VERSION, "opencode"), `#!/bin/sh\n${cli}\n`, {
    mode: 0o755,
  })

  return {
    home,
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  }
}

const service = `case "$2" in
  status)
    if [ -f "$HOME/.local/state/opencode/service.json" ]; then printf '%s\\n' "${URL}"; else printf '%s\\n' stopped; fi
    ;;
  start|restart)
    if [ "$3" = "--port" ] && [ "$4" = "0" ]; then
      printf '%s' '{"url":"${URL}","password":"secret","version":"${VERSION}","pid":7}' > "$HOME/.local/state/opencode/service.json"
      printf '%s\\n' "${URL}"
    else
      printf '%s\\n' "OPENCODE_SERVICE_PORT_OWNER=foreign" "Managed service port 49374 on 0.0.0.0 is already in use by another process." >&2
      exit 1
    fi
    ;;
  *)
    if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; fi
    ;;
esac`

const unavailable = `if [ "$2" = "start" ] || [ "$2" = "restart" ]; then
  printf '%s\\n' "OPENCODE_SERVICE_PORT_OWNER=opencode" "OPENCODE_SERVICE_PORT_OWNER_PID=999999" "Managed service port 49374 on 0.0.0.0 is already in use by another process." >&2
  exit 1
fi
if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; else printf '%s\\n' stopped; fi`

const reclaim = `case "$2" in
  status)
    if [ -f "$HOME/.local/state/opencode/restarted" ]; then printf '%s\\n' "${FIXED_URL}"; else printf '%s\\n' stopped; fi
    ;;
  start|restart)
    if [ "$3" = "--port" ] && [ "$4" = "0" ]; then
      printf '%s\\n' "Free-port fallback started a second service." >&2
      exit 1
    fi
    if [ -f "$HOME/.local/state/opencode/restarted" ]; then
      printf '%s' '{"url":"${FIXED_URL}","password":"secret","version":"${VERSION}","pid":7}' > "$HOME/.local/state/opencode/service.json"
      printf '%s\\n' "${FIXED_URL}"
    else
      touch "$HOME/.local/state/opencode/restarted"
      printf '%s\\n' "OPENCODE_SERVICE_PORT_OWNER=opencode" "OPENCODE_SERVICE_PORT_OWNER_PID=999999" "Managed service port 49374 on 0.0.0.0 is already in use by another process." >&2
      exit 1
    fi
    ;;
  *)
    if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; fi
    ;;
esac`

bootTest(
  "starts on a free port when the managed port is already taken",
  Effect.gen(function* () {
    const machine = yield* Effect.promise(() => remote(service))

    try {
      const endpoint = yield* bootstrap({ target: parseTarget("devbox"), version: VERSION, env: machine.env })
      expect(endpoint).toEqual({ host: "127.0.0.1", port: 54321, password: "secret" })
    } finally {
      yield* Effect.promise(() => fs.rm(machine.home, { recursive: true, force: true }))
    }
  }),
)

const foreignProfile = `case "$2" in
  status) printf '%s\\n' stopped ;;
  start|restart)
    if [ "$3" = "--port" ]; then touch "$HOME/.local/state/opencode/free-port"; fi
    printf '%s\\n' "OPENCODE_SERVICE_PORT_OWNER=opencode" "OPENCODE_SERVICE_PORT_OWNER_PID=999999" "Managed service port 49374 on 0.0.0.0 is already in use by another process." >&2
    exit 1
    ;;
  *)
    if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; fi
    ;;
esac`

bootTest(
  "restarts an OpenCode service that holds the managed port",
  Effect.gen(function* () {
    const machine = yield* Effect.promise(() => remote(reclaim))

    try {
      // An unhealthy service still leaves its registration, so the holder is this home's own.
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(machine.home, ".local/state/opencode/service.json"),
          JSON.stringify({ url: FIXED_URL, password: "secret", version: VERSION, pid: 999999 }),
        ),
      )
      const endpoint = yield* bootstrap({ target: parseTarget("devbox"), version: VERSION, env: machine.env })
      expect(endpoint).toEqual({ host: "127.0.0.1", port: 49374, password: "secret" })
    } finally {
      yield* Effect.promise(() => fs.rm(machine.home, { recursive: true, force: true }))
    }
  }),
)

bootTest(
  "reports an OpenCode service from another profile without touching it",
  Effect.gen(function* () {
    const machine = yield* Effect.promise(() => remote(foreignProfile))

    try {
      const error = yield* bootstrap({ target: parseTarget("devbox"), version: VERSION, env: machine.env }).pipe(
        Effect.flip,
      )

      expect(error.code).toBe("service")
      expect(
        yield* Effect.promise(() => Bun.file(path.join(machine.home, ".local/state/opencode/free-port")).exists()),
      ).toBe(false)
    } finally {
      yield* Effect.promise(() => fs.rm(machine.home, { recursive: true, force: true }))
    }
  }),
)

bootTest(
  "reports a remote start failure as a service error with its captured output",
  Effect.gen(function* () {
    const machine = yield* Effect.promise(() => remote(unavailable))

    try {
      const error = yield* bootstrap({ target: parseTarget("devbox"), version: VERSION, env: machine.env }).pipe(
        Effect.flip,
      )

      expect(error).toBeInstanceOf(SshFailure)
      expect(error.code).toBe("service")
      expect(error.detail).toContain("already in use")
    } finally {
      yield* Effect.promise(() => fs.rm(machine.home, { recursive: true, force: true }))
    }
  }),
)

// A released CLI without the port-owner markers only prints the user-facing message.
// `service set port` is its supported way to move off a taken port; `--port` is newer.
const unmarked = `case "$2" in
  status)
    if [ -f "$HOME/.local/state/opencode/service.json" ]; then
      port=$(cat "$HOME/.local/state/opencode/port")
      printf 'http://127.0.0.1:%s\\n' "$port"
    else
      printf '%s\\n' stopped
    fi
    ;;
  set)
    printf '%s' "$4" > "$HOME/.local/state/opencode/port"
    ;;
  start|restart)
    if [ -f "$HOME/.local/state/opencode/port" ]; then
      port=$(cat "$HOME/.local/state/opencode/port")
      printf '{"url":"http://127.0.0.1:%s","password":"secret","version":"${VERSION}","pid":7}' "$port" > "$HOME/.local/state/opencode/service.json"
      printf 'http://127.0.0.1:%s\\n' "$port"
    else
      printf '%s\\n' "Managed service port 49374 on 0.0.0.0 is already in use by another process." >&2
      exit 1
    fi
    ;;
  *)
    if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; fi
    ;;
esac`

bootTest(
  "offers a port choice when the remote CLI has no port-owner markers",
  Effect.gen(function* () {
    const machine = yield* Effect.promise(() => remote(unmarked))

    try {
      const error = yield* bootstrap({ target: parseTarget("devbox"), version: VERSION, env: machine.env }).pipe(
        Effect.flip,
      )

      expect(error).toBeInstanceOf(SshFailure)
      expect(error.code).toBe("port")
      expect(error.detail).toContain("already in use")
      expect(
        yield* Effect.promise(() => Bun.file(path.join(machine.home, ".local/state/opencode/port")).exists()),
      ).toBe(false)
    } finally {
      yield* Effect.promise(() => fs.rm(machine.home, { recursive: true, force: true }))
    }
  }),
)

bootTest(
  "persists a chosen port when the port choice asks for another one",
  Effect.gen(function* () {
    const machine = yield* Effect.promise(() => remote(unmarked))

    try {
      const endpoint = yield* bootstrap({
        target: parseTarget("devbox"),
        version: VERSION,
        env: machine.env,
        port: "free",
      })

      const port = Number(
        yield* Effect.promise(() => Bun.file(path.join(machine.home, ".local/state/opencode/port")).text()),
      )

      expect(port).toBeGreaterThanOrEqual(20000)
      expect(endpoint).toEqual({ host: "127.0.0.1", port, password: "secret" })
    } finally {
      yield* Effect.promise(() => fs.rm(machine.home, { recursive: true, force: true }))
    }
  }),
)

bootTest(
  "names the no-listener case instead of retrying the same port",
  Effect.gen(function* () {
    const portless = `case "$2" in
  status) printf '%s\\n' stopped ;;
  start|restart)
    printf '%s\\n' "Managed service port 59999 on 127.0.0.1 is already in use by another process." >&2
    exit 1
    ;;
  *)
    if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; fi
    ;;
esac`

    const machine = yield* Effect.promise(() => remote(portless))

    try {
      yield* Effect.promise(async () => {
        await fs.writeFile(path.join(machine.home, "bin/lsof"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
        await fs.writeFile(path.join(machine.home, "bin/ss"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
      })

      const error = yield* bootstrap({
        target: parseTarget("devbox"),
        version: VERSION,
        env: machine.env,
        port: "reclaim",
      }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(SshFailure)
      expect(error.code).toBe("port")
      expect(error.detail).toContain("No process is listening on port 59999")
      expect(error.detail).toContain("Use another port")
    } finally {
      yield* Effect.promise(() => fs.rm(machine.home, { recursive: true, force: true }))
    }
  }),
)

bootTest(
  "kills an OpenCode service holding the port when the port choice asks for it",
  Effect.gen(function* () {
    const holder = Bun.spawn(["sleep", "30"])

    const reclaimable = `case "$2" in
  status)
    if [ -f "$HOME/.local/state/opencode/service.json" ]; then printf '%s\\n' "${FIXED_URL}"; else printf '%s\\n' stopped; fi
    ;;
  start|restart)
    if kill -0 ${holder.pid} 2>/dev/null; then
      printf '%s\\n' "Managed service port 49374 on 0.0.0.0 is already in use by PID ${holder.pid} (opencode serve --service)." >&2
      exit 1
    fi
    printf '%s' '{"url":"${FIXED_URL}","password":"secret","version":"${VERSION}","pid":7}' > "$HOME/.local/state/opencode/service.json"
    printf '%s\\n' "${FIXED_URL}"
    ;;
  *)
    if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; fi
    ;;
esac`

    const machine = yield* Effect.promise(() => remote(reclaimable))

    try {
      // lsof names the holder; ps proves it is a managed service before anything is killed.
      yield* Effect.promise(async () => {
        await fs.writeFile(path.join(machine.home, "bin/lsof"), `#!/bin/sh\nprintf '%s\\n' ${holder.pid}\n`, {
          mode: 0o755,
        })
        await fs.writeFile(
          path.join(machine.home, "bin/ps"),
          `#!/bin/sh\nprintf '%s\\n' 'opencode serve --service'\n`,
          { mode: 0o755 },
        )
      })

      const endpoint = yield* bootstrap({
        target: parseTarget("devbox"),
        version: VERSION,
        env: machine.env,
        port: "reclaim",
      })

      expect(endpoint).toEqual({ host: "127.0.0.1", port: 49374, password: "secret" })
    } finally {
      holder.kill()
      yield* Effect.promise(() => fs.rm(machine.home, { recursive: true, force: true }))
    }
  }),
)
