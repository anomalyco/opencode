import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import net from "node:net"

export * as PortOwner from "./port-owner"

// Best effort: names the process listening on a TCP port so a failed bind can say who holds it.
// Windows has no cheap equivalent of lsof, so it keeps the generic message.
export const describe = Effect.fnUntraced(function* (port: number, hostname?: string) {
  if (process.platform === "win32") return undefined
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
  const pid = listeners(yield* run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"])).find((listener) =>
    matches(listener.address, hostname),
  )?.pid
  if (pid === undefined) return undefined
  const command = (yield* run("ps", ["-o", "command=", "-p", pid])).replace(/\s+/g, " ")
  if (!command) return `PID ${pid}`
  return `PID ${pid} (${command.length > 200 ? command.slice(0, 199) + "…" : command})`
})

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
