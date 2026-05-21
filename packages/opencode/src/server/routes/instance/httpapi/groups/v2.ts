import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { MessageGroup } from "./v2/message"
import { ModelGroup } from "./v2/model"
import { ProviderGroup } from "./v2/provider"
import { SessionGroup } from "./v2/session"

export const V2Api = HttpApi.make("v2")
  .add(SessionGroup)
  .add(MessageGroup)
  .add(ModelGroup)
  .add(ProviderGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
