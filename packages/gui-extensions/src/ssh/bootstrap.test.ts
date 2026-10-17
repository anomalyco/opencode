import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { binaryPath, bootstrap, parseRegistration } from "./bootstrap"
import { parseTarget, SshFailure } from "./command"
import { RemoteCli } from "./remote-cli"

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

// The stand-in below is a `#!/bin/sh` script, which Windows cannot spawn, so the lookup would fall
// through to the system `ssh.exe`; the classification these two tests cover is platform-independent.
const posixOnly = test.skipIf(process.platform === "win32")

posixOnly("reports a remote service start that exits non-zero as a service failure", async () => {
  const failure = await bootstrapAgainst(`#!/bin/sh
script=$(cat)
case "$script" in
  *"service start"*)
    printf '%s\\n' "Error: Managed service port 49374 on 0.0.0.0 is already in use by another process." >&2
    exit 1
    ;;
  *--version*) printf '2.0.26\\n' ;;
esac
`)

  expect(failure).toBeInstanceOf(SshFailure)
  expect(failure.code).toBe("service")
  expect(failure.detail).toContain("Managed service port 49374")
})

posixOnly("keeps a transport failure before the service starts a connection failure", async () => {
  const failure = await bootstrapAgainst(`#!/bin/sh
cat >/dev/null
printf '%s\\n' "ssh: connect to host remote-host port 22: Connection refused" >&2
exit 255
`)

  expect(failure.code).toBe("connection")
})

// Runs the real bootstrap against a stand-in ssh. The remote script arrives on stdin, as it does
// with `sh -l -s`, so the stand-in can answer per step. It resolves with the failure, never a connection.
async function bootstrapAgainst(ssh: string) {
  const directory = await mkdtemp(join(tmpdir(), "opencode-ssh-"))

  try {
    await writeFile(join(directory, "ssh"), ssh, { mode: 0o755 })

    return await Effect.runPromise(
      bootstrap({
        target: parseTarget("remote-host"),
        version: "2.0.26",
        env: { PATH: `${directory}:${process.env.PATH ?? ""}` },
        stage: () => Effect.void,
      }).pipe(Effect.flip, Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
