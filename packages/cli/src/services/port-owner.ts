import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import net from "node:net"

export * as PortOwner from "./port-owner"

/** Stable stderr lines for the SSH bootstrap, so it never matches the user-facing message text. */
export function marker(owner: Owner) {
  const lines = [`OPENCODE_SERVICE_PORT_OWNER=${owner.kind}`]
  if (owner.kind !== "none" && owner.pid !== undefined) lines.push(`OPENCODE_SERVICE_PORT_OWNER_PID=${owner.pid}`)
  return lines.join("\n")
}

export type Owner =
  | { readonly kind: "none" }
  | { readonly kind: "unknown"; readonly pid?: string }
  | { readonly kind: "opencode" | "foreign"; readonly pid: string; readonly command: string }

// Best effort: names the process listening on a TCP port so a failed bind can say who holds it.
// With no listener, a failed connection means only the port number is taken, for example by an
// ephemeral source port; that is safe to move away from. Windows has no cheap lsof equivalent.
export const inspect = Effect.fnUntraced(function* (port: number, hostname?: string) {
  if (process.platform === "win32") return yield* unowned(port, hostname)
  const appProcess = yield* AppProcess.Service
  const run = (command: string, args: ReadonlyArray<string>) =>
    appProcess
      .run(ChildProcess.make(command, args, { stdin: "ignore", killSignal: "SIGKILL" }), {
        timeout: "1 second",
        maxOutputBytes: 4096,
      })
      .pipe(
        Effect.map((result) => (result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "")),
        Effect.orElseSucceed(() => ""),
      )
  const found = listeners(yield* run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"])).find((listener) =>
    matches(listener.address, hostname),
  )
  if (found === undefined) return yield* unowned(port, hostname)
  const command = (yield* run("ps", ["-o", "command=", "-p", found.pid])).replace(/\s+/g, " ").trim()
  if (!command) return { kind: "unknown", pid: found.pid } satisfies Owner
  const kind = isManagedService(command) ? "opencode" : "foreign"
  return { kind, pid: found.pid, command } satisfies Owner
})

export const describe = Effect.fnUntraced(function* (port: number, hostname?: string) {
  const owner = yield* inspect(port, hostname)
  return owner.kind === "none" || (owner.kind === "unknown" && !("pid" in owner)) ? undefined : format(owner)
})

export function format(owner: Owner) {
  if (owner.kind === "none") return "another process"
  if (owner.kind === "unknown") return owner.pid === undefined ? "another process" : `PID ${owner.pid}`
  return `PID ${owner.pid} (${owner.command.length > 200 ? owner.command.slice(0, 199) + "…" : owner.command})`
}

/** The managed service runs `<opencode binary or entrypoint> serve --service`. */
export function isManagedService(command: string) {
  return (
    /(^|[/\\\s])opencode(?:\.(?:js|ts))?(?=\s|$)/.test(command) &&
    /(^|\s)serve(?=\s|$)/.test(command) &&
    /(^|\s)--service(?=\s|$)/.test(command)
  )
}

const unowned = (port: number, hostname?: string) =>
  Effect.promise(async () =>
    (await reachable(port, hostname)) === false ? { kind: "none" as const } : { kind: "unknown" as const },
  )

function reachable(port: number, hostname?: string) {
  return new Promise<boolean | undefined>((resolve) => {
    const socket = net.connect({ port, host: probeHost(hostname) })
    const done = (value: boolean | undefined) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(300, () => done(undefined))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

function probeHost(hostname?: string) {
  if (hostname === "0.0.0.0") return "127.0.0.1"
  if (hostname === "::" || hostname === "[::]") return "::1"
  return hostname && net.isIP(hostname) !== 0 ? hostname : "127.0.0.1"
}

function listeners(output: string) {
  const found: { pid: string; address: string }[] = []
  let pid: string | undefined
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = /^\d+$/.test(line.slice(1)) ? line.slice(1) : undefined
    if (line.startsWith("n") && pid !== undefined)
      found.push({ pid, address: line.slice(1, line.lastIndexOf(":")).replace(/^\[(.*)\]$/, "$1") })
  }
  return found
}

// lsof shows wildcard listeners as `*`; those also hold the port for any specific address.
function matches(address: string, hostname: string | undefined) {
  const host = hostname?.replace(/^\[(.*)\]$/, "$1")
  if (host === undefined || net.isIP(host) === 0 || host === "0.0.0.0" || host === "::") return true
  return address === "*" || address === host
}
