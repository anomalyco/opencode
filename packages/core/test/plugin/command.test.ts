import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Command } from "@opencode/core/command"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { CommandPlugin } from "@opencode/core/plugin/command"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/schema/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Workspace } from "@opencode/schema/workspace"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime } from "effect"
import { emptyMcp, emptyMcpLayer } from "../fixture/mcp"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "./host"
import PROMPT_INITIALIZE from "../../src/plugin/command/initialize.txt"
import PROMPT_REVIEW from "../../src/plugin/command/review.txt"

const directory = AbsolutePath.make("/repo/packages/app")
const project = AbsolutePath.make("/repo")
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory }, { projectDirectory: project })),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Command.node, Mcp.node, Bus.node]), [
    Mcp.node.replace(emptyMcpLayer),
    Location.node.replace(locationLayer),
  ]),
)

describe("CommandPlugin.Plugin", () => {
  it.effect("discovers MCP prompt commands on first lookup without starting them at plugin boot", () =>
    Effect.gen(function* () {
      const counts = { starts: 0, reloads: 0 }
      const bus = yield* Bus.Service
      const mcp = Layer.effect(
        Mcp.Service,
        Effect.gen(function* () {
          return Mcp.Service.of({
            ...emptyMcp,
            start: () =>
              Effect.gen(function* () {
                if (counts.starts) return
                counts.starts++
                yield* bus.publish(Mcp.PromptsChanged, { server: "demo" })
              }),
            prompts: () =>
              Effect.succeed(counts.starts ? [{ server: Mcp.ServerName.make("demo"), name: "first" }] : []),
          })
        }),
      )
      yield* Effect.gen(function* () {
        const command = yield* Command.Service
        yield* CommandPlugin.Plugin.effect(
          host({
            command: {
              list: () => Effect.die("unused command.list"),
              transform: command.transform,
              reload: () => Effect.sync(() => counts.reloads++).pipe(Effect.andThen(command.reload())),
            },
          }),
        )
        expect(counts.starts).toBe(0)
        yield* bus.publish(
          Mcp.PromptsChanged,
          { server: "demo" },
          {
            location: Location.Ref.make({ directory: AbsolutePath.make("/other") }),
          },
        )
        yield* bus.publish(
          Mcp.PromptsChanged,
          { server: "demo" },
          {
            location: Location.Ref.make({ directory, workspaceID: Workspace.ID.make("wrk_other") }),
          },
        )
        expect(counts.reloads).toBe(0)
        expect(yield* command.get("demo:first")).toMatchObject({ name: "demo:first" })
        expect((yield* command.list()).map((item) => item.name)).toContain("demo:first")
        expect(counts.starts).toBe(1)
        expect(counts.reloads).toBe(1)
      }).pipe(
        Effect.provide(
          Layer.fresh(Command.layer.pipe(Layer.provideMerge(mcp), Layer.provideMerge(Layer.succeed(Bus.Service, bus)))),
        ),
        Effect.provide(locationLayer),
      )
    }),
  )

  it.effect("registers built-in init and review commands", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: {
        text: string
        files?: readonly { readonly uri: string }[]
        delivery?: "steer" | "queue"
      }[] = []
      yield* CommandPlugin.Plugin.effect(
        host({
          command: {
            list: () => Effect.die("unused command.list"),
            transform: command.transform,
            reload: command.reload,
          },
          session: {
            prompt: (input) =>
              Effect.sync(() => {
                prompts.push({ text: input.text, files: input.files, delivery: input.delivery })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  time: { created: DateTime.makeUnsafe(0) },
                  type: "user",
                  payload: { text: input.text },
                  delivery: input.delivery ?? "steer",
                })
              }),
          },
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory }, { projectDirectory: project })),
        ),
      )

      expect(yield* command.get("init")).toMatchObject({
        name: "init",
        description: "guided AGENTS.md setup",
      })
      expect(yield* command.get("review")).toMatchObject({
        name: "review",
        description: "review changes [commit|branch|pr], defaults to uncommitted",
      })
      yield* command.execute({
        name: "init",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "extra context", files: [{ uri: "file:///tmp/context.md" }] },
          delivery: "queue",
        },
      })
      yield* command.execute({
        name: "review",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "  branch $& $$ $` $'  " },
          delivery: "steer",
        },
      })
      yield* command.execute({
        name: "init",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "" },
          delivery: "steer",
        },
      })
      yield* command.execute({
        name: "review",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          prompt: { text: "   " },
          delivery: "steer",
        },
      })
      expect(prompts).toEqual([
        {
          text: PROMPT_INITIALIZE.replace("${path}", project).replaceAll("$ARGUMENTS", "extra context"),
          files: [{ uri: "file:///tmp/context.md" }],
          delivery: "queue",
        },
        {
          text: PROMPT_REVIEW.replace("${path}", project).replaceAll("$ARGUMENTS", () => "branch $& $$ $` $'"),
          files: undefined,
          delivery: "steer",
        },
        {
          text: PROMPT_INITIALIZE.replace("${path}", project).replaceAll("$ARGUMENTS", ""),
          files: undefined,
          delivery: "steer",
        },
        {
          text: PROMPT_REVIEW.replace("${path}", project).replaceAll("$ARGUMENTS", ""),
          files: undefined,
          delivery: "steer",
        },
      ])
    }),
  )
})
