import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { provideInstance, tmpdir } from "../fixture/fixture"

const run = <A, E>(eff: Effect.Effect<A, E, File.Service>) =>
  Effect.runPromise(provideInstance(Instance.directory)(eff.pipe(Effect.provide(File.defaultLayer))))
const status = () => run(File.Service.use((svc) => svc.status()))
const read = (file: string) => run(File.Service.use((svc) => svc.read(file)))

const wintest = process.platform === "win32" ? test : test.skip

describe("file fsmonitor", () => {
  wintest("status does not start fsmonitor for readonly git checks", async () => {
    await using tmp = await tmpdir({ git: true })
    const target = path.join(tmp.path, "tracked.txt")

    await fs.writeFile(target, "base\n")
    await $`git add tracked.txt`.cwd(tmp.path).quiet()
    await $`git commit -m init`.cwd(tmp.path).quiet()
    await $`git config core.fsmonitor true`.cwd(tmp.path).quiet()
    await $`git fsmonitor--daemon stop`.cwd(tmp.path).quiet().nothrow()
    await fs.writeFile(target, "next\n")
    await fs.writeFile(path.join(tmp.path, "new.txt"), "new\n")

    const before = await $`git fsmonitor--daemon status`.cwd(tmp.path).quiet().nothrow()
    expect(before.exitCode).not.toBe(0)

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        await status()
      },
    })

    const after = await $`git fsmonitor--daemon status`.cwd(tmp.path).quiet().nothrow()
    expect(after.exitCode).not.toBe(0)
  })

  wintest("read does not start fsmonitor for git diffs", async () => {
    await using tmp = await tmpdir({ git: true })
    const target = path.join(tmp.path, "tracked.txt")

    await fs.writeFile(target, "base\n")
    await $`git add tracked.txt`.cwd(tmp.path).quiet()
    await $`git commit -m init`.cwd(tmp.path).quiet()
    await $`git config core.fsmonitor true`.cwd(tmp.path).quiet()
    await $`git fsmonitor--daemon stop`.cwd(tmp.path).quiet().nothrow()
    await fs.writeFile(target, "next\n")

    const before = await $`git fsmonitor--daemon status`.cwd(tmp.path).quiet().nothrow()
    expect(before.exitCode).not.toBe(0)

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        await read("tracked.txt")
      },
    })

    const after = await $`git fsmonitor--daemon status`.cwd(tmp.path).quiet().nothrow()
    expect(after.exitCode).not.toBe(0)
  })
})
