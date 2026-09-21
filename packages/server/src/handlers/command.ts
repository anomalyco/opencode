import { Command } from "@opencode/core/command"
import { Plugin } from "@opencode/core/plugin/service"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers.handle("command.list", () =>
    response(Plugin.awaitActivation.pipe(Effect.andThen(Command.Service.use((command) => command.list())))),
  ),
)
