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
      printf '%s\\n' "Managed service port 49374 on 0.0.0.0 is already in use by another process." >&2
      exit 1
    fi
    ;;
  *)
    if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; fi
    ;;
esac`

const unavailable = `if [ "$2" = "start" ] || [ "$2" = "restart" ]; then
  printf '%s\\n' "Managed service port 49374 on 0.0.0.0 is already in use by another process." >&2
  exit 1
fi
if [ "$1" = "--version" ]; then printf '%s\\n' "${VERSION}"; else printf '%s\\n' stopped; fi`

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
