export * as WslPorts from "./wsl-ports"

import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

/**
 * Whether a running WSL distro is listening on the port. WSL forwards distro listeners onto the
 * Windows loopback (NAT `localhostForwarding` via wslrelay.exe, or mirrored networking), so a service
 * inside a distro makes the same port fail to bind on the host. Reading `/proc/net/tcp` inside each
 * distro answers this regardless of the networking mode, and needs no tooling in the distro.
 */
export const holds = Effect.fnUntraced(function* (port: number) {
  if (process.platform !== "win32") return false
  const distros = (yield* wsl(["--list", "--running", "--quiet"])).split(/\r?\n/).map((line) => line.trim())
  const tables = yield* Effect.forEach(
    distros.filter(Boolean),
    (distro) => wsl(["-d", distro, "--exec", "cat", "/proc/net/tcp", "/proc/net/tcp6"]),
    { concurrency: "unbounded" },
  )
  return tables.some((table) => listening(table).includes(port))
})

/** Listening TCP ports in `/proc/net/tcp` or `/proc/net/tcp6` text (state `0A`, hex port after the last colon). */
export function listening(table: string) {
  return table
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns[3] === "0A")
    .map((columns) => Number.parseInt(columns[1].slice(columns[1].lastIndexOf(":") + 1), 16))
}

// wsl.exe prints UTF-16 to pipes unless WSL_UTF8 is set. Failures read as no output so a wedged
// distro never blocks service startup.
const wsl = Effect.fnUntraced(function* (args: string[]) {
  const appProcess = yield* AppProcess.Service
  return yield* appProcess
    .run(ChildProcess.make("wsl", args, { env: { WSL_UTF8: "1" }, extendEnv: true }), {
      timeout: "5 seconds",
      maxOutputBytes: 1_000_000,
    })
    .pipe(
      Effect.map((result) => result.stdout.toString("utf8")),
      Effect.orElseSucceed(() => ""),
    )
})
