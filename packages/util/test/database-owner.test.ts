import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  databaseOwnerAlive,
  databaseOwnerIdentity,
  ownsDatabase,
  parseDatabaseOwner,
  processExists,
} from "../src/database-owner.js"

test("module import does not generate randomness in global scope", () => {
  const file = new URL("../src/database-owner.ts", import.meta.url).href
  const code = `
    import { mock } from "bun:test";
    const crypto = await import("node:crypto");
    mock.module("node:crypto", () => ({ ...crypto, randomUUID() { throw new Error("global RNG forbidden") } }));
    await import(${JSON.stringify(file)});
    console.log("loaded without RNG");
  `
  const result = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 5000 })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain("loaded without RNG")
})

test("ownership is process-token specific; a PID alone is not our own lease", () => {
  const owner = { version: 1, ...databaseOwnerIdentity, refs: 1 } as const
  expect(ownsDatabase(owner)).toBe(true)
  expect(ownsDatabase({ ...owner, token: "another-runtime" })).toBe(false)
  expect(processExists(process.pid)).toBe(true)
})

test("unknown hosts fail closed; only proven local process death permits recovery", () => {
  const owner = { version: 1, ...databaseOwnerIdentity, refs: 1 } as const
  expect(databaseOwnerAlive(owner, { host: owner.host, exists: () => true })).toBe(true)
  expect(databaseOwnerAlive(owner, { host: owner.host, exists: () => false })).toBe(false)
  expect(databaseOwnerAlive(owner, { host: "other-host", exists: () => false })).toBe(true)
})

test("rejects malformed ownership records", () => {
  const owner = { version: 1, ...databaseOwnerIdentity, refs: 1 } as const
  expect(parseDatabaseOwner(owner)).toEqual(owner)
  for (const value of [null, {}, { ...owner, pid: 0 }, { ...owner, refs: -1 }, { ...owner, token: "" }])
    expect(() => parseDatabaseOwner(value)).toThrow()
})
