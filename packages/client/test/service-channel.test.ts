import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Service as EffectService } from "../src/effect/service"
import { Service } from "../src/promise/service"

// The CLI writes service-<channel>.json for channels outside latest|dev|beta|next
// (packages/cli/src/services/service-config.ts:29-32). Discovery must resolve the
// same filename from the channel alone or the packaged desktop misses its sidecar.
const version = "2.1.0-next.1"

test("discovers the channel-specific registration file", async () => {
  await withService("service-prod.json", async () => {
    expect(await Service.discover({ channel: "prod", version })).toEqual(
      expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) }),
    )
  })
})

test("discovers the default registration file when no channel is given", async () => {
  await withService("service.json", async () => {
    expect(await Service.discover({ version })).toEqual(
      expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) }),
    )
  })
})

test("shared channels resolve to the default registration file", async () => {
  await withService("service.json", async () => {
    const endpoints = await Promise.all(
      ["latest", "dev", "beta", "next"].map((channel) => Service.discover({ channel, version })),
    )
    endpoints.forEach((endpoint) =>
      expect(endpoint).toEqual(expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) })),
    )
  })
})

test("sanitizes channel names into the registration filename", async () => {
  await withService("service-preview-a.json", async () => {
    expect(await Service.discover({ channel: "preview/a", version })).toEqual(
      expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) }),
    )
  })
})

test("the effect client resolves channel-specific registrations", async () => {
  await withService("service-prod.json", async () => {
    const endpoint = await Effect.runPromise(
      EffectService.discover({ channel: "prod", version }).pipe(Effect.provide(NodeFileSystem.layer)),
    )
    expect(endpoint).toEqual(expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) }))
  })
})

// Starts the fixture service registered under <XDG_STATE_HOME>/opencode/<name> so discovery can only
// succeed when the client derives that exact filename from the channel.
async function withService(name: string, run: () => Promise<void>) {
  const state = await mkdtemp(join(tmpdir(), "opencode-client-channel-"))
  const directory = join(state, "opencode")
  await mkdir(directory, { recursive: true })
  const registration = join(directory, name)
  const previous = process.env["XDG_STATE_HOME"]
  process.env["XDG_STATE_HOME"] = state
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "fixture/service.ts"), registration, "compatible"],
    { stdout: "ignore", stderr: "inherit" },
  )
  try {
    await waitForFile(registration)
    await run()
  } finally {
    if (previous === undefined) delete process.env["XDG_STATE_HOME"]
    else process.env["XDG_STATE_HOME"] = previous
    child.kill("SIGTERM")
    await child.exited
    await rm(state, { recursive: true, force: true })
  }
}

async function waitForFile(file: string) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (await Bun.file(file).exists()) return
    await Bun.sleep(5)
  }
  throw new Error(`Timed out waiting for ${file}`)
}
