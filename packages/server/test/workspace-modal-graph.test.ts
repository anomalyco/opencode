import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "fs"
import { homedir, tmpdir } from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Shell } from "@opencode-ai/core/shell"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { ServerWorkspaceDrivers } from "../src/workspace/drivers"
import { ModalDriver } from "../src/workspace/modal"

const hasCredentials = process.env.MODAL_TOKEN_ID !== undefined || existsSync(path.join(homedir(), ".modal.toml"))

const databaseFile = path.join(mkdtempSync(path.join(tmpdir(), "opencode-modal-graph-")), "graph.db")

const layer = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, Workspace.node, LocationServiceMap.node]),
  [
    [Database.node, Database.configured({ path: databaseFile })],
    [WorkspaceDriver.registryNode, ServerWorkspaceDrivers.node],
  ],
)

// The complete hosted stack against real Modal: workspace creation, the full
// Location graph, file mutation, real bash in the sandbox, eviction, reconnect.
describe.skipIf(!hasCredentials)("hosted location graph on modal (live)", () => {
  test(
    "runs the location graph against a modal sandbox",
    async () => {
      await Effect.gen(function* () {
        const workspaces = yield* Workspace.Service
        const created = yield* workspaces.create({ provider: "modal" })
        const driver = yield* ModalDriver.make
        const found = yield* workspaces.binding(created.id)
        yield* Effect.addFinalizer(() => Effect.ignore(driver.destroy(found.binding)))

        const locations = yield* LocationServiceMap.Service
        const ref = Location.Ref.make({
          directory: AbsolutePath.make(created.root),
          workspaceID: created.id,
        })

        yield* Effect.gen(function* () {
          const location = yield* Location.Service
          expect(location.project.id).toBe(Project.ID.global)

          const mutation = yield* LocationMutation.Service
          const mutations = yield* FileMutation.Service
          const target = yield* mutation.resolve({ path: "hello.txt" })
          yield* mutations.write({ target, content: "hello from opencode\n" })

          const shell = yield* Shell.Service
          const command = yield* shell.create({
            command: "cat hello.txt && printf 'bash-made' > bash.txt && ln -s /etc escaped",
            timeout: 60_000,
          })
          const finished = yield* shell.wait(command.id)
          expect(finished.status).toBe("exited")
          const output = yield* shell.output(command.id)
          expect(output.output).toContain("hello from opencode")

          const filesystem = yield* FileSystem.Service
          const fromBash = yield* filesystem.read({ path: RelativePath.make("bash.txt") })
          expect(new TextDecoder().decode(fromBash.content)).toBe("bash-made")
          const root = yield* mutation.resolve({ path: "." })
          const entries = yield* filesystem.glob({ target: root, pattern: "*.txt", limit: 10 })
          expect(entries.map((entry) => String(entry.path)).sort()).toEqual(["bash.txt", "hello.txt"])
          const matches = yield* filesystem.grep({
            target: yield* mutation.resolve({ path: "hello.txt" }),
            pattern: "opencode",
            limit: 10,
          })
          expect(matches).toMatchObject([{ entry: { path: "hello.txt" }, line: 1 }])
          const escaped = yield* mutation.resolve({ path: "escaped/passwd" }).pipe(Effect.flip)
          expect(escaped).toMatchObject({ _tag: "LocationMutation.PathError", reason: "outside_workspace" })
        }).pipe(Effect.provide(locations.get(ref)))

        yield* locations.invalidate(ref)

        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const hello = yield* filesystem.read({ path: RelativePath.make("hello.txt") })
          expect(new TextDecoder().decode(hello.content)).toBe("hello from opencode\n")
        }).pipe(Effect.provide(locations.get(ref)))
      }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise)
    },
    { timeout: 600_000 },
  )
})
