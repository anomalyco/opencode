import {
  isConflictError,
  isForbiddenError,
  isInvalidRequestError,
  isMachineNotFoundError,
  OpenCode,
  type MachineInfo,
  type MachineInvite,
} from "@opencode/client/promise"
import { Service } from "@opencode/client/effect/service"
import { MACHINE_LINK_PATH, type MachineReach } from "@opencode/protocol/groups/machine"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Server, Standalone } from "../../commands"
import { ServerConnection } from "../../../services/server-connection"
import { ServiceConfig } from "../../../services/service-config"
import { isLoopback } from "../../../services/service-urls"
import { errorMessage } from "../../../util/error"

export const ensureMachineClient = Effect.fn("cli.machine.client")(function* () {
  const standalone = yield* Effect.serviceOption(Standalone)
  if (Option.getOrElse(standalone, () => false))
    return yield* Effect.fail(
      new Error("--standalone starts a server for this command only; a machine needs one that keeps running."),
    )
  const serverFlag = yield* Effect.serviceOption(Server).pipe(Effect.map(Option.flatten))
  const config = yield* ServiceConfig.read()
  if (Option.isNone(serverFlag) && config.disabled === true)
    return yield* Effect.fail(
      new Error("Managing machines requires the background service; run `opencode service unset disabled` first."),
    )
  const server = yield* ServerConnection.resolve()
  return OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
})

export function machineReach(urls: ReadonlyArray<string>): Array<MachineReach> {
  const parsed = urls.map((raw) => {
    const url = new URL(MACHINE_LINK_PATH, raw)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    return { href: url.href, loopback: isLoopback(url.hostname) }
  })
  const ordered = [...parsed.filter((entry) => !entry.loopback), ...parsed.filter((entry) => entry.loopback)]
  return [...new Set(ordered.map((entry) => entry.href))].map((url) => ({ type: "url" as const, url }))
}

export function formatMachineAdd(input: {
  readonly name: string
  readonly join: string
  readonly expires: number
  readonly reach: MachineInvite["reach"]
  readonly tty: boolean
  readonly now?: number
}) {
  if (!input.tty) return input.join + EOL
  const addresses = input.reach.length
    ? input.reach.map((entry) => `  ${entry.type === "iroh" ? "iroh" : entry.url}`)
    : ["  (none)"]
  const access = input.reach.some((entry) => entry.type === "iroh")
    ? "Works from any network."
    : input.reach.some((entry) => entry.type === "url" && !isLoopback(new URL(entry.url).hostname))
      ? "Works from computers that can reach one of these addresses."
      : "Only works on this computer. Pass --url with an address other computers can reach."
  return (
    [
      `Machine: ${input.name}`,
      formatExpiry(input.expires, input.now),
      "",
      input.join,
      "",
      access,
      "Addresses:",
      ...addresses,
    ].join(EOL) + EOL
  )
}

export function formatMachineList(machines: ReadonlyArray<MachineInfo>) {
  if (machines.length === 0) return "No machines added."
  const nameWidth = Math.max(...machines.map((machine) => machine.id.length))
  const pairedWidth = Math.max(...machines.map((machine) => (machine.paired ? "paired" : "waiting").length))
  const onlineWidth = Math.max(...machines.map((machine) => (machine.online ? "connected" : "offline").length))
  return machines
    .map((machine) => {
      const paired = (machine.paired ? "paired" : "waiting").padEnd(pairedWidth)
      const online = machine.online ? "connected" : "offline"
      const platform = machine.os && machine.arch ? `${machine.os}/${machine.arch}` : (machine.os ?? machine.arch)
      const connection = machine.online ? machine.connection : undefined
      const carrier = connection
        ? [
            connection.kind,
            connection.path,
            connection.rtt === undefined ? undefined : `${Math.round(connection.rtt)}ms`,
          ]
            .filter((part) => part !== undefined)
            .join(" ")
        : undefined
      const details = [platform, carrier].filter((part) => part !== undefined).join("  ")
      if (!details) return `${machine.id.padEnd(nameWidth)}  ${paired}  ${online}`
      return `${machine.id.padEnd(nameWidth)}  ${paired}  ${online.padEnd(onlineWidth)}  ${details}`
    })
    .join(EOL)
}

export function formatMachineError(error: unknown, name?: string) {
  if (isForbiddenError(error)) {
    return "Machines are experimental and disabled on this server. Turn them on with OPENCODE_FLAGS=machines or experimental.machines: true in your config."
  }
  if (isInvalidRequestError(error) && error.kind === "invalid_name") {
    const label = name === undefined ? "That name" : JSON.stringify(name)
    return `${label} is not a valid machine name. Use lowercase letters, digits, and hyphens, starting with a letter, 2 to 63 characters, and not "local".`
  }
  if (isMachineNotFoundError(error)) return `No machine named ${JSON.stringify(name ?? error.machine)}.`
  if (isConflictError(error)) {
    const target = name ?? error.resource
    const label = target === undefined ? "This machine" : `Machine ${JSON.stringify(target)}`
    return `${label} is already paired. Pass --replace to issue a new join string; once the new computer joins, the computer currently paired stops being able to connect.`
  }
  return errorMessage(error)
}

export function reportMachineError(error: unknown, name?: string) {
  return Effect.sync(() => {
    process.stderr.write(formatMachineError(error, name) + EOL)
    process.exitCode = 1
  })
}

function formatExpiry(expires: number, now = Date.now()) {
  const remaining = Math.max(0, expires - now)
  const minutes = Math.round(remaining / 60_000)
  const at = new Date(expires).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (minutes === 0) return `Expires in less than a minute (at ${at}).`
  return `Expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"} (at ${at}).`
}
