import { Config } from "@opencode-ai/core/config"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const ConfigHandler = HttpApiBuilder.group(Api, "server.config", (handlers) =>
  handlers.handle("config.get", () => Config.Service.use((config) => config.entries())),
)
