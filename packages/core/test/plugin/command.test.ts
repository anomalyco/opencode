import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Command } from "@opencode/core/command"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Plugin } from "@opencode/core/plugin"
import { CommandPlugin } from "@opencode/core/plugin/command"
import { PluginHost } from "@opencode/core/plugin/host"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/schema/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime } from "effect"
import { emptyMcp, emptyMcpLayer } from "../fixture/mcp"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
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
        text: string
        files?: readonly { readonly uri: string }[]
        delivery?: "steer" | "queue"
      }[] = []
      yield* CommandPlugin.Plugin.effect(
        host({
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
        source: "builtin",
      })
      expect(yield* command.get("review")).toMatchObject({
        name: "review",
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "builtin",
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

  it.effect("sends an MCP prompt's embedded text and explains missing or rejected arguments (#55181, #52446)", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const prompts: string[] = []
      const requested: Array<Record<string, string> | undefined> = []
      const mcp = Mcp.Service.of({
        ...emptyMcp,
        prompts: () =>
          Effect.succeed([
            {
              server: Mcp.ServerName.make("docs"),
              name: "explain",
              arguments: [{ name: "topic", required: true }, { name: "depth" }],
            },
          ]),
        prompt: (input) =>
          Effect.suspend(() => {
            requested.push(input.args)
            if (input.args?.topic === "rejected") return Effect.fail(new Error("Invalid topic"))
            return Effect.succeed({
              messages: [
                { role: "user" as const, content: { type: "text" as const, text: "Explain this file:" } },
                {
                  role: "user" as const,
                  content: {
                    type: "resource" as const,
                    resource: { uri: "docs://guide", mimeType: "text/plain", text: "the guide" },
                  },
                },
                {
                  role: "user" as const,
                  content: { type: "resource" as const, resource: { uri: "docs://logo", blob: "aGVsbG8=" } },
                },
              ],
            })
          }),
      })
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
                prompts.push(input.text)
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
      ).pipe(Effect.provideService(Mcp.Service, mcp), Effect.provide(locationLayer))
      const run = (text: string) =>
        command.execute({
          name: "docs:explain",
          invocation: { sessionID: Session.ID.make("ses_test"), prompt: { text }, delivery: "steer" },
        })

      yield* run("files")
      expect(prompts).toEqual(["Explain this file:\nthe guide"])
      expect(requested).toEqual([{ topic: "files" }])
      expect(yield* run("").pipe(Effect.flip)).toMatchObject({
        message: "/docs:explain needs topic. Usage: /docs:explain <topic> [depth]",
      })
      expect(yield* run("rejected").pipe(Effect.flip)).toMatchObject({
        message: "MCP prompt docs:explain failed: Invalid topic",
      })
      expect(requested).toEqual([{ topic: "files" }, { topic: "rejected" }])
    }),
  )
})

testEffect(PluginTestLayer).effect("ignores built-in metadata supplied by a plugin command", () =>
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const context = yield* PluginHost.make(yield* Plugin.Service, "test.custom-command")
    const definition = {
      name: "init",
      description: "Custom setup",
      source: "builtin" as const,
      execute: () => Effect.void,
    }

    yield* context.command.transform((editor) => editor.add(definition))

    expect(yield* commands.get("init")).toEqual(Command.Info.make({ name: "init", description: "Custom setup" }))
  }),
)
