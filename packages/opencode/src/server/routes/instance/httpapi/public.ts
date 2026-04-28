import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { ConfigApi } from "./config"
import { ControlApi } from "./control"
import { EventApi } from "./event"
import { ExperimentalApi } from "./experimental"
import { FileApi } from "./file"
import { GlobalApi } from "./global"
import { InstanceApi } from "./instance"
import { McpApi } from "./mcp"
import { PermissionApi } from "./permission"
import { ProjectApi } from "./project"
import { ProviderApi } from "./provider"
import { PtyApi, PtyConnectApi } from "./pty"
import { QuestionApi } from "./question"
import { SessionApi } from "./session"
import { SyncApi } from "./sync"
import { TuiApi } from "./tui"
import { WorkspaceApi } from "./workspace"

export const PublicApi = HttpApi.make("opencode")
  .addHttpApi(ControlApi)
  .addHttpApi(GlobalApi)
  .addHttpApi(EventApi)
  .addHttpApi(ConfigApi)
  .addHttpApi(ExperimentalApi)
  .addHttpApi(FileApi)
  .addHttpApi(InstanceApi)
  .addHttpApi(McpApi)
  .addHttpApi(PermissionApi)
  .addHttpApi(ProjectApi)
  .addHttpApi(ProviderApi)
  .addHttpApi(PtyApi)
  .addHttpApi(PtyConnectApi)
  .addHttpApi(QuestionApi)
  .addHttpApi(SessionApi)
  .addHttpApi(SyncApi)
  .addHttpApi(TuiApi)
  .addHttpApi(WorkspaceApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode",
      version: "1.0.0",
      description: "opencode api",
    }),
  )
