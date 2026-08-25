import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Command } from "@opencode-ai/core/command"
import { Bus } from "@opencode-ai/core/bus"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { CommandPlugin } from "@opencode-ai/core/plugin/command"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/schema/session"
import { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { DateTime } from "effect"
import { emptyMcpLayer } from "../fixture/mcp"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const directory = AbsolutePath.make("/repo/packages/app")
const project = AbsolutePath.make("/repo")
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory }, { projectDirectory: project })),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Command.node, MCP.node, Bus.node]), [
    [MCP.node, emptyMcpLayer],
    [Location.node, locationLayer],
  ]),
)

describe("CommandPlugin.Plugin", () => {
  it.effect("registers built-in init and review commands", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: { text: string; files?: readonly { readonly uri: string }[] }[] = []
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
                prompts.push({ text: input.text, files: input.files })
                return SessionInbox.User.make({
                  id: SessionMessage.ID.make("msg_test"),
                  sessionID: input.sessionID,
                  timeCreated: DateTime.makeUnsafe(0),
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
      expect(prompts).toEqual([
        {
          text: expect.stringContaining("extra context"),
          files: [{ uri: "file:///tmp/context.md" }],
        },
      ])
    }),
  )
})
