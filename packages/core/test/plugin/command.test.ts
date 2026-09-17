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
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime } from "effect"
import { emptyMcpLayer } from "../fixture/mcp"
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
  it.effect("registers built-in init and review commands", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: {
        id?: string
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
                prompts.push({ id: input.id, text: input.text, files: input.files, delivery: input.delivery })
                return SessionInbox.User.make({
                  id: input.id ?? SessionMessage.ID.make("msg_test"),
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
      const outcome = yield* command.execute({
        name: "init",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          messageID: SessionMessage.ID.make("msg_init"),
          prompt: { text: "extra context", files: [{ uri: "file:///tmp/context.md" }] },
          delivery: "queue",
        },
      })
      yield* command.execute({
        name: "review",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          messageID: SessionMessage.ID.make("msg_review"),
          prompt: { text: "  branch $& $$ $` $'  " },
          delivery: "steer",
        },
      })
      yield* command.execute({
        name: "init",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          messageID: SessionMessage.ID.make("msg_init_empty"),
          prompt: { text: "" },
          delivery: "steer",
        },
      })
      yield* command.execute({
        name: "review",
        invocation: {
          sessionID: Session.ID.make("ses_test"),
          messageID: SessionMessage.ID.make("msg_review_empty"),
          prompt: { text: "   " },
          delivery: "steer",
        },
      })
      expect(outcome).toEqual({ type: "prompt", inboxID: SessionMessage.ID.make("msg_init") })
      expect(prompts).toEqual([
        {
          id: "msg_init",
          text: PROMPT_INITIALIZE.replace("${path}", project).replaceAll("$ARGUMENTS", "extra context"),
          files: [{ uri: "file:///tmp/context.md" }],
          delivery: "queue",
        },
        {
          id: "msg_review",
          text: PROMPT_REVIEW.replace("${path}", project).replaceAll("$ARGUMENTS", () => "branch $& $$ $` $'"),
          files: undefined,
          delivery: "steer",
        },
        {
          id: "msg_init_empty",
          text: PROMPT_INITIALIZE.replace("${path}", project).replaceAll("$ARGUMENTS", ""),
          files: undefined,
          delivery: "steer",
        },
        {
          id: "msg_review_empty",
          text: PROMPT_REVIEW.replace("${path}", project).replaceAll("$ARGUMENTS", ""),
          files: undefined,
          delivery: "steer",
        },
      ])
    }),
  )
})
