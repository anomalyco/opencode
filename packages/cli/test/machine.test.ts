import { NodeServices } from "@effect/platform-node"
import type { MachineInfo, MachineInvite } from "@opencode/client/promise"
import { describe, expect, test } from "bun:test"
import { Console, Effect, Option, Stdio } from "effect"
import { EOL } from "node:os"
import { Commands, Server } from "../src/commands/commands"
import {
  formatMachineAdd,
  formatMachineError,
  formatMachineList,
  machineReach,
} from "../src/commands/handlers/machine/common"
import { Runtime } from "../src/framework/runtime"
import { parseServerURL, serverURLs } from "../src/services/service-urls"

describe("machine reach", () => {
  test("puts reachable addresses first and loopback addresses last, converting http(s) to ws(s)", () => {
    expect(
      machineReach([
        "http://127.0.0.1:4096",
        "http://localhost:4096",
        "http://10.0.0.8:4096",
        "https://example.com",
        "http://[::1]:4096",
        "https://example.com/",
        "https://gpu.example.com:8443",
      ]),
    ).toEqual([
      { type: "url", url: "ws://10.0.0.8:4096/api/experimental/machine/link" },
      { type: "url", url: "wss://example.com/api/experimental/machine/link" },
      { type: "url", url: "wss://gpu.example.com:8443/api/experimental/machine/link" },
      { type: "url", url: "ws://127.0.0.1:4096/api/experimental/machine/link" },
      { type: "url", url: "ws://localhost:4096/api/experimental/machine/link" },
      { type: "url", url: "ws://[::1]:4096/api/experimental/machine/link" },
    ])
  })

  test("--url replaces server URLs with that single validated address", async () => {
    const client = {
      server: {
        info: async () => ({
          urls: ["http://127.0.0.1:4096", "https://example.com"],
        }),
      },
    }

    const override = parseServerURL("https://override.example.com:8443/")
    expect(override).toBe("https://override.example.com:8443")
    expect(machineReach(await Effect.runPromise(serverURLs(client, Option.some(override))))).toEqual([
      { type: "url", url: "wss://override.example.com:8443/api/experimental/machine/link" },
    ])
    expect(machineReach(await Effect.runPromise(serverURLs(client, Option.none())))).toEqual([
      { type: "url", url: "wss://example.com/api/experimental/machine/link" },
      { type: "url", url: "ws://127.0.0.1:4096/api/experimental/machine/link" },
    ])
    expect(() => parseServerURL("ftp://example.com")).toThrow()
    expect(() => parseServerURL("https://user:pass@example.com")).toThrow()
    expect(() => parseServerURL("https://example.com?a=1")).toThrow()
  })
})

describe("machine commands", () => {
  test("accept the global --server flag in any position", async () => {
    const url = "http://127.0.0.1:4096"
    const cases: ReadonlyArray<readonly [ReadonlyArray<string>, string, Option.Option<string>]> = [
      [["machine", "list", "--server", url], "list", Option.some(url)],
      [["machine", "--server", url, "add", "gpu"], "add", Option.some(url)],
      [["--server", url, "machine", "remove", "gpu"], "remove", Option.some(url)],
      [["machine", "list"], "list", Option.none()],
    ]

    for (const [args, command, server] of cases) {
      const result = await runMachine(args)
      expect(result.ran).toEqual([command])
      expect(result.servers).toEqual([server])
    }
  })
})

describe("machine output formatting", () => {
  test("prints only the join string when stdout is not a terminal, and full details on a terminal", () => {
    const reach = [{ type: "url" as const, url: "wss://example.com/api/experimental/machine/link" }]
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    const expires = now + 5 * 60_000

    expect(formatMachineAdd({ name: "gpu", join: "ocjoin_example", expires, reach, tty: false, now })).toBe(
      "ocjoin_example" + EOL,
    )

    const tty = formatMachineAdd({ name: "gpu", join: "ocjoin_example", expires, reach, tty: true, now })
    const lines = tty.trimEnd().split(EOL)
    expect(lines[0]).toBe("Machine: gpu")
    expect(lines[1]).toContain("Expires in 5 minutes")
    expect(lines).toContain("ocjoin_example")
    expect(lines).toContain("  wss://example.com/api/experimental/machine/link")
    expect(lines).toContain("Works from computers that can reach one of these addresses.")
  })

  test.each([
    {
      reach: [{ type: "url", url: "ws://localhost:4096" }, { type: "iroh" }],
      sentence: "Works from any network.",
    },
    {
      reach: [{ type: "url", url: "wss://example.com" }],
      sentence: "Works from computers that can reach one of these addresses.",
    },
    {
      reach: ["localhost", "127.0.0.1", "[::1]"].map((host) => ({ type: "url", url: `ws://${host}:4096` })),
      sentence: "Only works on this computer. Pass --url with an address other computers can reach.",
    },
  ] satisfies Array<{ reach: MachineInvite["reach"]; sentence: string }>)(
    "explains invite reach: $sentence",
    ({ reach, sentence }) => {
      const input = { name: "gpu", join: "ocjoin_example", expires: 300_000, now: 0, reach }
      const output = formatMachineAdd({ ...input, tty: true })
      expect(output).toContain(`${sentence}${EOL}Addresses:${EOL}`)
      for (const entry of reach) expect(output).toContain(`  ${entry.type === "iroh" ? "iroh" : entry.url}${EOL}`)
      expect(formatMachineAdd({ ...input, tty: false })).toBe(`ocjoin_example${EOL}`)
    },
  )

  test.each([
    [{ kind: "websocket" }, "websocket"],
    [{ kind: "iroh" }, "iroh"],
    [{ kind: "iroh", path: "direct", rtt: 81.6 }, "iroh direct 82ms"],
    [{ kind: "iroh", path: "relayed", rtt: 123 }, "iroh relayed 123ms"],
    [{ kind: "iroh", path: "direct", rtt: 0 }, "iroh direct 0ms"],
  ] satisfies Array<[MachineInfo["connection"], string]>)("prints connection %j", (connection, label) => {
    expect(formatMachineList([{ id: "gpu", paired: true, online: true, os: "linux", arch: "x64", connection }])).toBe(
      `gpu  paired  connected  linux/x64  ${label}`,
    )
    expect(formatMachineList([{ id: "gpu", paired: true, online: false, connection }])).toBe("gpu  paired  offline")
  })

  test("formats empty and populated machine lists", () => {
    expect(formatMachineList([])).toBe("No machines added.")
    expect(
      formatMachineList([
        { id: "gpu", paired: true, online: true, os: "linux", arch: "x64" },
        { id: "laptop", paired: true, online: false },
        { id: "worker", paired: false, online: false },
      ]),
    ).toBe(["gpu     paired   connected  linux/x64", "laptop  paired   offline", "worker  waiting  offline"].join(EOL))
  })

  test("formats actionable error messages", () => {
    expect(formatMachineError({ _tag: "ForbiddenError", message: "disabled" })).toContain("OPENCODE_FLAGS=machines")
    expect(formatMachineError({ _tag: "ForbiddenError", message: "disabled" })).toContain("experimental.machines: true")
    expect(formatMachineError({ _tag: "InvalidRequestError", kind: "invalid_name", message: "bad" }, "Bad")).toContain(
      "2 to 63",
    )
    const conflict = formatMachineError({ _tag: "ConflictError", resource: "gpu", message: "paired" }, "gpu")
    expect(conflict).toContain("--replace")
    expect(conflict).toContain("stops being able to connect")
    expect(formatMachineError({ _tag: "MachineNotFoundError", machine: "x", message: "missing" }, "x")).toBe(
      'No machine named "x".',
    )
  })
})

async function runMachine(args: ReadonlyArray<string>) {
  const ran: Array<string> = []
  const servers: Array<Option.Option<string>> = []
  const load = (name: string) => async () => ({
    default: () =>
      Effect.gen(function* () {
        ran.push(name)
        servers.push(yield* Effect.serviceOption(Server).pipe(Effect.map(Option.flatten)))
      }),
  })
  const machine = Commands.commands.machine.commands
  await Effect.runPromise(
    Runtime.run(
      Commands,
      [machine.add, machine.list, machine.remove].map((node) => ({ spec: node.spec, load: load(node.name) })),
      { version: "test" },
    ).pipe(
      Effect.provideService(Console.Console, Object.assign(Object.create(console), { log: () => {}, error: () => {} })),
      Effect.provide(Stdio.layerTest({ args: Effect.succeed(args) })),
      Effect.provide(NodeServices.layer),
    ),
  )
  return { ran, servers }
}
