import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Bus } from "../../src/bus"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import type { PtyID } from "../../src/pty/schema"
import { tmpdir } from "../fixture/fixture"
import { setTimeout as sleep } from "node:timers/promises"

const env = {
  HOME: process.env.HOME,
}

afterEach(() => {
  if (env.HOME === undefined) delete process.env.HOME
  else process.env.HOME = env.HOME
})

const wait = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return
    await sleep(25)
  }
  throw new Error("timeout waiting for pty events")
}

const pick = (log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }>, id: PtyID) => {
  return log.filter((evt) => evt.id === id).map((evt) => evt.type)
}

describe("pty", () => {
  test("publishes created, exited, deleted in order for a short-lived process", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            const log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }> = []
            const off = [
              Bus.subscribe(Pty.Event.Created, (evt) => log.push({ type: "created", id: evt.properties.info.id })),
              Bus.subscribe(Pty.Event.Exited, (evt) => log.push({ type: "exited", id: evt.properties.id })),
              Bus.subscribe(Pty.Event.Deleted, (evt) => log.push({ type: "deleted", id: evt.properties.id })),
            ]

            let id: PtyID | undefined
            try {
              const info = yield* pty.create({
                command: "/usr/bin/env",
                args: ["sh", "-c", "sleep 0.1"],
                title: "sleep",
              })
              id = info.id

              yield* Effect.promise(() => wait(() => pick(log, id!).includes("exited")))

              yield* pty.remove(id)
              yield* Effect.promise(() => wait(() => pick(log, id!).length >= 3))
              expect(pick(log, id!)).toEqual(["created", "exited", "deleted"])
            } finally {
              off.forEach((x) => x())
              if (id) yield* pty.remove(id)
            }
          }),
        ),
    })
  })

  test("publishes created, exited, deleted in order for /bin/sh + remove", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir()

    await Instance.provide({
      directory: dir.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            const log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }> = []
            const off = [
              Bus.subscribe(Pty.Event.Created, (evt) => log.push({ type: "created", id: evt.properties.info.id })),
              Bus.subscribe(Pty.Event.Exited, (evt) => log.push({ type: "exited", id: evt.properties.id })),
              Bus.subscribe(Pty.Event.Deleted, (evt) => log.push({ type: "deleted", id: evt.properties.id })),
            ]

            let id: PtyID | undefined
            try {
              const info = yield* pty.create({ command: "/bin/sh", title: "sh" })
              id = info.id

              yield* Effect.promise(() => sleep(100))

              yield* pty.remove(id)
              yield* Effect.promise(() => wait(() => pick(log, id!).length >= 3))
              expect(pick(log, id!)).toEqual(["created", "exited", "deleted"])
            } finally {
              off.forEach((x) => x())
              if (id) yield* pty.remove(id)
            }
          }),
        ),
    })
  })

  test("preserves pty io through the sandbox wrapper", async () => {
    if (process.platform !== "darwin") return

    await using dir = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
          },
        },
      },
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const info = await Pty.create({ command: "cat", title: "cat" })
        try {
          const out: string[] = []
          const ws: Parameters<typeof Pty.connect>[1] = {
            readyState: 1,
            data: { id: info.id },
            send: (data: unknown) => {
              out.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {},
          }

          await Pty.connect(info.id, ws)
          out.length = 0
          await Pty.write(info.id, "AAA\n")
          await wait(() => out.join("").includes("AAA"))
        } finally {
          await Pty.remove(info.id)
        }
      },
    })
  })

  test("keeps pty shell startup deterministic in sandbox mode", async () => {
    if (process.platform !== "darwin") return

    await using home = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, ".bashrc"), 'printf hit > "$HOME/bashrc-hit"\n')
      },
    })
    await using dir = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
          },
        },
      },
    })
    process.env.HOME = home.path

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const info = await Pty.create({ command: "/bin/bash", title: "bash" })
        try {
          await sleep(150)
          const hit = await fs
            .access(path.join(home.path, "bashrc-hit"))
            .then(() => true)
            .catch(() => false)
          expect(hit).toBe(false)
        } finally {
          await Pty.remove(info.id)
        }
      },
    })
  })

  test("blocks excluded commands on initial pty spawn", async () => {
    await using dir = await tmpdir({
      config: {
        experimental: {
          sandbox: {
            enabled: true,
            excluded_commands: ["python"],
          },
        },
      },
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await expect(Pty.create({ command: "python", title: "py" })).rejects.toThrow("python")
        await expect(
          Pty.create({ command: "env", args: ["FOO=1", "python", "-c", "print(1)"], title: "env" }),
        ).rejects.toThrow("python")
        await expect(Pty.create({ command: "sh", args: ["-c", "python -c 'print(1)'"], title: "sh" })).rejects.toThrow(
          "python",
        )
      },
    })
  })
})
