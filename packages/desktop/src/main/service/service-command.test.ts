import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { serviceCommand } from "./service-command"

test("desktop reads the supervisor command and rejects invalid policy without exposing credentials", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "desktop-service-command-"))
  const file = path.join(root, "service.json")
  const read = () => Effect.runPromise(serviceCommand(file).pipe(Effect.provide(NodeFileSystem.layer)))
  try {
    expect(await read()).toBeUndefined()
    await writeFile(file, JSON.stringify({ password: "private-canary" }))
    expect(await read()).toBeUndefined()
    const command = ["/managed/process-compose", "process", "start", "opencode"]
    await writeFile(file, JSON.stringify({ command, password: "private-canary" }))
    expect(await read()).toEqual(command)
    for (const command of [[], [""], "opencode", [1]]) {
      await writeFile(file, JSON.stringify({ command, password: "private-canary" }))
      await expect(read()).rejects.toThrow("Invalid service startup command configuration")
      await expect(read()).rejects.not.toThrow("private-canary")
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
