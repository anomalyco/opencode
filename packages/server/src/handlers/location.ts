import { Location } from "@opencode-ai/core/location"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  handlers.handle("location.get", () => Location.current),
)
