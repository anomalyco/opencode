import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { FileAccess } from "@opencode-ai/core/file-access"
import { Location } from "@opencode-ai/core/location"
import { Permission } from "@opencode-ai/core/permission"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { tempLocationLayer } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity } from "./lib/tool"

const invocation = {
  ...toolIdentity,
  sessionID: Session.ID.make("ses_file_access"),
  id: Tool.CallID.make("call-read"),
}
const slash = (file: string) => file.replaceAll("\\", "/")

function provide(requests: Permission.AssertInput[], denied?: string) {
  return Effect.provide(
    AppNodeBuilder.build(LayerNode.group([FileAccess.node, Location.node]), [
      Location.node.replace(tempLocationLayer),
      Permission.node.replace(
        permissionLayer({
          assert: (input) =>
            Effect.gen(function* () {
              requests.push(input)
              if (input.action === denied)
                yield* new Permission.BlockedError({
                  rules: [],
                  permission: input.action,
                  resources: input.resources,
                })
            }),
        }),
      ),
    ]),
  )
}

describe("FileAccess.authorizeRead", () => {
  it.live("returns an absolute target and preserves invocation identity on the read assertion", () => {
    const requests: Permission.AssertInput[] = []
    return Effect.gen(function* () {
      const access = yield* FileAccess.Service
      const location = yield* Location.Service
      const target = yield* access.authorizeRead("src/../README.md", invocation)
      const absolute: AbsolutePath = target.absolute

      expect(absolute).toBe(AbsolutePath.make(path.join(location.directory, "README.md")))
      expect(target.externalDirectory).toBeUndefined()
      expect(requests).toEqual([
        {
          action: "read",
          resources: ["README.md"],
          save: ["*"],
          sessionID: invocation.sessionID,
          agent: invocation.agent,
          source: { type: "tool", messageID: invocation.messageID, id: invocation.id },
        },
      ])
    }).pipe(provide(requests))
  })

  it.live("authorizes an external directory before the file's read rules", () => {
    const requests: Permission.AssertInput[] = []
    return Effect.gen(function* () {
      const access = yield* FileAccess.Service
      const target = yield* access.authorizeRead("../notes.txt", invocation)

      expect(requests).toMatchObject([
        { action: "external_directory", resources: [slash(path.join(path.dirname(target.absolute), "*"))] },
        { action: "read", resources: [slash(target.absolute)] },
      ])
      for (const request of requests) {
        expect(request).toMatchObject({
          sessionID: invocation.sessionID,
          agent: invocation.agent,
          source: { type: "tool", messageID: invocation.messageID, id: invocation.id },
        })
      }
    }).pipe(provide(requests))
  })

  for (const action of ["external_directory", "read"]) {
    it.live(`propagates ${action} denial without continuing authorization`, () => {
      const requests: Permission.AssertInput[] = []
      return Effect.gen(function* () {
        const access = yield* FileAccess.Service
        const error = yield* access.authorizeRead("../notes.txt", invocation).pipe(Effect.flip)

        expect(error).toBeInstanceOf(Permission.BlockedError)
        expect(requests.map((request) => request.action)).toEqual(
          action === "external_directory" ? ["external_directory"] : ["external_directory", "read"],
        )
      }).pipe(provide(requests, action))
    })
  }

  it.live("reuses a sibling's directory approval only for the supplied recovery call", () => {
    const requests: Permission.AssertInput[] = []
    return Effect.gen(function* () {
      const access = yield* FileAccess.Service
      const requested = yield* access.authorizeRead("../report final.txt", invocation)
      const recovered = yield* access.authorizeRead("../report\u202ffinal.txt", invocation, { siblingOf: requested })
      yield* access.authorizeRead("../notes.txt", invocation)

      expect(requests.map((request) => request.action)).toEqual([
        "external_directory",
        "read",
        "read",
        "external_directory",
        "read",
      ])
      expect(requests[2].resources).toEqual([slash(recovered.absolute)])
    }).pipe(provide(requests))
  })

  it.live("checks the external directory for a target that is not a sibling", () => {
    const requests: Permission.AssertInput[] = []
    return Effect.gen(function* () {
      const access = yield* FileAccess.Service
      const requested = yield* access.authorizeRead("README.md", invocation)
      yield* access.authorizeRead("../notes.txt", invocation, { siblingOf: requested })

      expect(requests.map((request) => request.action)).toEqual(["read", "external_directory", "read"])
    }).pipe(provide(requests))
  })

  it.live("batches external resources in first-seen order and preserves broader repository saves", () => {
    const requests: Permission.AssertInput[] = []
    return Effect.gen(function* () {
      const external = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const git = path.join(external.path, "git")
      const hg = path.join(external.path, "hg")
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(git, ".git"), { recursive: true })
        await fs.mkdir(path.join(git, "nested"))
        await fs.mkdir(path.join(hg, ".hg"), { recursive: true })
        await fs.mkdir(path.join(hg, "nested"))
      })
      const access = yield* FileAccess.Service
      const first = yield* access.resolve({ path: path.join(git, "nested", "a.txt"), kind: "file" })
      const second = yield* access.resolve({ path: path.join(git, "nested", "b.txt"), kind: "file" })
      const third = yield* access.resolve({ path: path.join(hg, "nested", "c.txt"), kind: "file" })
      const internal = yield* access.resolve({ path: "README.md" })
      const metadata = { filepath: first.absolute, parentDir: path.dirname(first.absolute) }

      yield* access.authorizeExternal([first, internal, second, third, first], invocation, metadata)

      expect(requests).toEqual([
        {
          action: "external_directory",
          resources: [slash(path.join(git, "nested", "*")), slash(path.join(hg, "nested", "*"))],
          save: [slash(path.join(git, "*")), slash(path.join(hg, "*"))],
          metadata,
          sessionID: invocation.sessionID,
          agent: invocation.agent,
          source: { type: "tool", messageID: invocation.messageID, id: invocation.id },
        },
      ])

      yield* access.authorizeExternal([internal], invocation)
      expect(requests).toHaveLength(1)
      yield* access.authorizeExternal([second], invocation)
      expect(requests).toHaveLength(2)
      expect(requests[1].resources).toEqual([slash(path.join(git, "nested", "*"))])
      expect(Object.hasOwn(requests[1], "metadata")).toBe(false)
    }).pipe(provide(requests))
  })
})
