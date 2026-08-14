import { CommandV2 } from "@moks/core/command"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const CommandHandler = HttpApiBuilder.group(Api, "server.command", (handlers) =>
  handlers.handle("command.list", () => response(CommandV2.Service.use((command) => command.list()))),
)
