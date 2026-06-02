import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { MessageGroup } from "./v2/message"
import { ModelGroup } from "./v2/model"
import { ProviderGroup } from "./v2/provider"
import { SessionGroup } from "./v2/session"
import { PermissionGroup, PermissionSavedGroup, SessionPermissionGroup } from "./v2/permission"
import { FileSystemGroup } from "./v2/fs"

export const V2Api = HttpApi.make("v2")
  .add(SessionGroup)
  .add(MessageGroup)
  .add(ModelGroup)
  .add(ProviderGroup)
  .add(PermissionGroup)
  .add(SessionPermissionGroup)
  .add(PermissionSavedGroup)
  .add(FileSystemGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
