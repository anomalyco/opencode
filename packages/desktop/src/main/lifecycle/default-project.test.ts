import { expect } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Effect, FileSystem, Path } from "effect"
import { testEffect } from "../../../../core/test/lib/effect"
import { makeDefaultProject } from "./default-project"

const it = testEffect(NodeServices.layer)

it.live("creates an accessible default project", Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "onboarding-project-" })
  const directory = path.join(root, "Default Project")

  expect(yield* makeDefaultProject(directory)).toBe(directory)
  expect(yield* fs.exists(directory)).toBe(true)
}))

if (process.platform !== "win32")
  it.live("reports denied access to the default project and succeeds after access returns", Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "onboarding-denied-" })
    const parent = path.join(root, "protected")
    const directory = path.join(parent, "Default Project")
    yield* fs.makeDirectory(parent)
    yield* Effect.addFinalizer(() => fs.chmod(parent, 0o700))
    yield* fs.chmod(parent, 0o000)

    expect(yield* makeDefaultProject(directory)).toEqual({ permissionDenied: directory })

    yield* fs.chmod(parent, 0o700)
    expect(yield* makeDefaultProject(directory)).toBe(directory)
  }))
